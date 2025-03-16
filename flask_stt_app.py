import sys
import os

# 将当前目录添加到 Python 路径
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, render_template
from flask_socketio import SocketIO, emit
from utils.stt.audio_recorder import AudioToTextRecorder
import threading
import numpy as np
from scipy.signal import resample
import json
import base64
import logging
import time
import asyncio

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logging.getLogger('websockets').setLevel(logging.WARNING)

# 创建 Flask 应用
app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key'
socketio = SocketIO(app, cors_allowed_origins="*")

# 全局变量
recorder = None
recorder_ready = threading.Event()
is_running = True
config_lock = threading.Lock()  # 用于保护配置访问

# 默认配置
default_config = {
    # 基本设置
    'model': 'small',  # 主要转录模型大小 (从tiny改为small，提高准确性但仍保持较快速度)
    'download_root': None,  # 模型下载目录
    'language': 'zh',  # 语言设置
    'compute_type': 'float16',  # 计算类型
    'input_device_index': None,  # 输入设备索引
    'gpu_device_index': 0,  # GPU设备索引
    'device': 'cuda',  # 使用设备类型
    'spinner': False,  # 是否显示加载动画
    'use_microphone': False,  # 是否使用麦克风
    'ensure_sentence_starting_uppercase': True,  # 确保句首大写
    'ensure_sentence_ends_with_period': True,  # 确保句尾有句号
    'batch_size': 16,  # 批处理大小
    'level': logging.WARNING,  # 日志级别

    # 实时转写设置
    'enable_realtime_transcription': True,  # 启用实时转写
    'use_main_model_for_realtime': False,  # 对实时转写使用主模型
    'realtime_model_type': 'tiny',  # 实时转写模型大小
    'realtime_processing_pause': 0,  # 实时处理暂停时间
    'init_realtime_after_seconds': 0.1,  # 实时处理初始延迟 (从0.2减少到0.1，减少初始延迟)
    'realtime_batch_size': 24,  # 实时转写批处理大小 (从16增加到24，提高吞吐量)

    # 语音活动检测设置
    'silero_sensitivity': 0.5,  # Silero VAD灵敏度 (从0.4增加到0.5，提高检测灵敏度)
    'silero_use_onnx': True,  # 是否使用ONNX版Silero (启用ONNX加速)
    'silero_deactivity_detection': True,  # Silero去活动检测 (启用，减少句子中间被错误分段的情况)
    'webrtc_sensitivity': 1,  # WebRTC VAD灵敏度 (从2降低到1，提高灵敏度)
    'post_speech_silence_duration': 0.5,  # 语音后静音持续时间 (从0.7减少到0.5，加快句子结束检测)
    'min_length_of_recording': 0.3,  # 最小录音长度 (设置为0.3秒，过滤掉短暂噪音)
    'min_gap_between_recordings': 0.1,  # 录音间最小间隔 (设置为0.1秒，避免过于频繁的分段)
    'pre_recording_buffer_duration': 0.5,  # 预录制缓冲区长度 (从1.0减少到0.5，减少延迟)
    'on_vad_detect_start': None,  # VAD检测开始回调
    'on_vad_detect_stop': None,  # VAD检测结束回调

    # 唤醒词设置
    'wakeword_backend': "pvporcupine",  # 唤醒词后端
    'openwakeword_model_paths': None,  # 开放唤醒词模型路径
    'openwakeword_inference_framework': "onnx",  # 开放唤醒词推理框架
    'wake_words': "",  # 唤醒词
    'wake_words_sensitivity': 0.5,  # 唤醒词敏感度
    'wake_word_activation_delay': 0.0,  # 唤醒词激活延迟
    'wake_word_timeout': 5.0,  # 唤醒词超时
    'wake_word_buffer_duration': 3.0,  # 唤醒词缓冲区长度
    'on_wakeword_detected': None,  # 唤醒词检测回调
    'on_wakeword_timeout': None,  # 唤醒词超时回调
    'on_wakeword_detection_start': None,  # 唤醒词检测开始回调
    'on_wakeword_detection_end': None,  # 唤醒词检测结束回调

    # 高级设置
    'beam_size': 3,  # 主模型波束搜索大小 (从5减少到3，加快处理速度)
    'beam_size_realtime': 2,  # 实时模型波束搜索大小 (从3减少到2，加快实时处理)
    'buffer_size': 512,  # 缓冲区大小
    'sample_rate': 16000,  # 采样率
    'initial_prompt': "",  # 主模型初始提示 (添加提示以提高中文识别准确性)
    'initial_prompt_realtime': "",  # 实时模型初始提示 (添加简短提示)
    'suppress_tokens': [-1],  # 抑制令牌
    'print_transcription_time': False,  # 打印转写时间
    'early_transcription_on_silence': 0.3,  # 静音时提前转写 (设置为0.3秒，加快实时反馈)
    'allowed_latency_limit': 3.0,  # 允许的延迟限制 (从5.0减少到3.0，减少延迟)
    'debug_mode': False,  # 调试模式
    'handle_buffer_overflow': True,  # 处理缓冲区溢出
    'no_log_file': True,  # 不生成日志文件
    'use_extended_logging': False,  # 使用扩展日志记录
    'on_recording_start': None,  # 录音开始回调
    'on_recording_stop': None,  # 录音结束回调
    'on_transcription_start': None,  # 转写开始回调
    'on_recorded_chunk': None,  # 录制块回调
    'on_realtime_transcription_update': None  # 实时转写更新回调
}

# 当前配置 (复制默认配置)
current_config = default_config.copy()


# 回调函数：当实时转录稳定时调用
def text_detected(text):
    socketio.emit('realtime', {'type': 'realtime', 'text': text})
    print(f"\r{text}", end='', flush=True)


# 获取可序列化的配置 (移除回调函数等不可序列化的对象)
def get_serializable_config():
    with config_lock:
        serializable_config = {}
        for key, value in current_config.items():
            if not callable(value):  # 跳过函数类型
                serializable_config[key] = value
    return serializable_config


# 重采样函数
def decode_and_resample(audio_data, original_sample_rate, target_sample_rate=16000):
    try:
        audio_np = np.frombuffer(audio_data, dtype=np.int16)
        num_original_samples = len(audio_np)
        num_target_samples = int(num_original_samples * target_sample_rate / original_sample_rate)
        resampled_audio = resample(audio_np, num_target_samples)
        return resampled_audio.astype(np.int16).tobytes()
    except Exception as e:
        print(f"重采样错误: {e}")
        return audio_data


# 创建录音机
def create_recorder():
    global recorder, current_config, recorder_ready

    print("创建/重新创建录音机...")
    recorder_ready.clear()  # 重置就绪标志

    try:
        # 关闭旧录音机
        if recorder:
            try:
                print("关闭旧录音机...")
                if hasattr(recorder, 'stop'):
                    recorder.stop()
                if hasattr(recorder, 'shutdown'):
                    recorder.shutdown()
                del recorder
                recorder = None
                # 强制垃圾回收
                import gc
                gc.collect()
                print("旧录音机已关闭并释放资源")
            except Exception as e:
                print(f"关闭旧录音机时出错: {e}")
                recorder = None

        # 添加回调函数
        with config_lock:
            config_copy = current_config.copy()
            config_copy['on_realtime_transcription_stabilized'] = text_detected

        # 创建新录音机
        print("创建新录音机...")
        recorder = AudioToTextRecorder(**config_copy)

        # 设置为就绪状态
        recorder_ready.set()
        socketio.emit('recorder_status', {'ready': True})
        return True, None
    except Exception as e:
        print(f"创建录音机过程中出现异常: {e}")
        logging.error(f"创建录音机过程中出现异常", exc_info=True)
        # 不设置recorder_ready标志，保持为未就绪状态
        socketio.emit('recorder_status', {'ready': False})
        return False, str(e)


# 运行录音机的线程函数
def run_recorder():
    global recorder, is_running
    print("初始化 RealtimeSTT...")

    # 创建首次录音机
    try:
        create_recorder()
    except Exception as e:
        print(f"初始化录音机出错: {e}")

    retry_count = 0
    max_retries = 3

    # 循环检查完整句子输出
    while is_running:
        try:
            if recorder and recorder_ready.is_set():
                # 检查音频队列大小，如果过大则发出警告
                if hasattr(recorder, 'audio_queue') and hasattr(recorder.audio_queue, 'qsize'):
                    queue_size = recorder.audio_queue.qsize()
                    if queue_size > 20:
                        print(f"警告: 音频队列非常大 ({queue_size})")

                # 获取完整文本
                full_sentence = recorder.text()

                if full_sentence:
                    socketio.emit('fullSentence', {'type': 'fullSentence', 'text': full_sentence})
                    print(f"\rSentence: {full_sentence}")

                retry_count = 0  # 成功操作后重置重试计数
            elif retry_count < max_retries and not recorder_ready.is_set():
                # 如果录音机未就绪，尝试重新创建
                print(f"录音机未就绪，尝试重新创建 (尝试 {retry_count + 1}/{max_retries})...")

                try:
                    success, _ = create_recorder()
                    if success:
                        print("重新创建录音机成功")
                        retry_count = 0
                    else:
                        print("重新创建录音机失败")
                        retry_count += 1
                except Exception as e:
                    print(f"重新创建录音机出错: {e}")
                    retry_count += 1

        except Exception as e:
            print(f"录音机线程中出现错误: {e}")
            logging.error(f"录音机线程中出现错误: {e}", exc_info=True)

            # 如果连续多次出错，等待一段时间
            retry_count += 1
            if retry_count >= max_retries:
                print(f"连续出错{max_retries}次，等待一段时间后再重试...")
                time.sleep(5)
                retry_count = 0

        time.sleep(0.1)  # 避免 CPU 占用过高


# 路由：主页
@app.route('/')
def index():
    return render_template('index.html')


# Socket.IO 事件：连接
@socketio.on('connect')
def handle_connect():
    print('客户端已连接')
    # 发送当前配置
    emit('config', get_serializable_config())
    # 发送录音机状态
    emit('recorder_status', {'ready': recorder_ready.is_set()})


# Socket.IO 事件：断开连接
@socketio.on('disconnect')
def handle_disconnect():
    print('客户端已断开连接')


# Socket.IO 事件：获取配置
@socketio.on('get_config')
def handle_get_config():
    emit('config', get_serializable_config())


# Socket.IO 事件：更新配置
@socketio.on('update_config')
def handle_update_config(data):
    print(f"收到配置更新请求: {data}")

    try:
        # 保存当前配置到文件，以便重启后恢复
        save_config_to_file(data)

        # 通知客户端我们即将重启
        emit('restart_required', {
            'message': '正在重启应用以应用新配置...',
            'countdown': 5  # 5秒倒计时
        }, broadcast=True)

        print("配置已更新，准备重启应用...")

        # 使用线程延迟重启，确保消息发送到客户端
        import threading
        def delayed_restart():
            import time
            import os
            import sys

            # 等待2秒确保客户端收到重启消息
            time.sleep(2)

            print("重启应用程序...")
            # 使用Python的可执行文件路径重新启动脚本
            python = sys.executable
            os.execl(python, python, *sys.argv)

        restart_thread = threading.Thread(target=delayed_restart)
        restart_thread.daemon = True
        restart_thread.start()

    except Exception as e:
        print(f"处理配置更新请求时出错: {e}")
        emit('config_updated', {
            'success': False,
            'error': str(e)
        })


# Socket.IO 事件：恢复默认设置
@socketio.on('reset_to_default')
def handle_reset_to_default():
    print("收到恢复默认设置请求")

    try:
        # 复制默认配置
        with config_lock:
            global current_config, default_config
            current_config = default_config.copy()

        # 保存默认配置到文件
        config_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'last_config.json')
        serializable_config = get_serializable_config()

        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(serializable_config, f, indent=4, ensure_ascii=False)

        print(f"已恢复默认配置并保存到文件: {config_file}")

        # 通知客户端我们即将重启
        emit('restart_required', {
            'message': '正在恢复默认设置并重启应用...',
            'countdown': 5  # 5秒倒计时
        }, broadcast=True)

        print("已恢复默认设置，准备重启应用...")

        # 使用线程延迟重启，确保消息发送到客户端
        import threading
        def delayed_restart():
            import time
            import os
            import sys

            # 等待2秒确保客户端收到重启消息
            time.sleep(2)

            print("重启应用程序...")
            # 使用Python的可执行文件路径重新启动脚本
            python = sys.executable
            os.execl(python, python, *sys.argv)

        restart_thread = threading.Thread(target=delayed_restart)
        restart_thread.daemon = True
        restart_thread.start()

    except Exception as e:
        print(f"恢复默认设置时出错: {e}")
        emit('config_updated', {
            'success': False,
            'error': str(e)
        })


# 保存配置到文件
def save_config_to_file(new_config):
    global current_config

    try:
        # 更新内存中的配置
        with config_lock:
            # 保存到当前配置
            for key, value in new_config.items():
                if key in current_config:
                    # 输出重要配置变化的日志
                    if str(current_config[key]) != str(value):
                        print(f"配置项 '{key}' 从 '{current_config[key]}' 更改为 '{value}'")
                    current_config[key] = value

        # 保存可序列化的配置到文件
        config_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'last_config.json')
        serializable_config = get_serializable_config()

        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(serializable_config, f, indent=4, ensure_ascii=False)

        print(f"配置已保存到文件: {config_file}")
        return True
    except Exception as e:
        print(f"保存配置到文件时出错: {e}")
        return False


# 从文件加载配置
def load_config_from_file():
    global current_config, default_config

    config_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'last_config.json')

    if os.path.exists(config_file):
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                saved_config = json.load(f)

            # 更新当前配置
            with config_lock:
                for key, value in saved_config.items():
                    if key in current_config:
                        current_config[key] = value

            print(f"从文件加载了配置: {config_file}")
            return True
        except Exception as e:
            print(f"从文件加载配置时出错: {e}")
            return False
    else:
        print("未找到配置文件，使用默认配置")
        return False


# Socket.IO 事件：接收音频数据
@socketio.on('audio_data')
def handle_audio_data(data):
    global recorder

    # 检查录音机是否就绪
    if not recorder_ready.is_set():
        print("录音机未就绪，忽略接收到的音频数据")
        emit('recorder_status', {'ready': False})
        return

    # 检查录音机是否为None
    if recorder is None:
        print("录音机对象为None，尽管标志显示就绪")
        recorder_ready.clear()  # 修正标志状态
        emit('recorder_status', {'ready': False})
        return

    # 如果配置锁被持有，说明配置正在更新中，暂停处理音频
    if config_lock.locked():
        print("配置更新中，暂停接收音频数据")
        return

    try:
        # 解析数据
        audio_data = base64.b64decode(data['audio'])
        sample_rate = data['sampleRate']

        # 重采样
        resampled_audio = decode_and_resample(audio_data, sample_rate)

        # 检查音频队列状态
        if hasattr(recorder, 'audio_queue'):
            # 检查队列大小，如果太大可能需要提醒用户
            queue_size = recorder.audio_queue.qsize() if hasattr(recorder.audio_queue, 'qsize') else -1
            if queue_size > 10:  # 队列积压严重
                print(f"警告: 音频队列积压 ({queue_size}), 可能需要调整延迟限制或减轻处理负担")

        # 送入录音机 (添加额外保护)
        if recorder and recorder_ready.is_set():
            recorder.feed_audio(resampled_audio)
        else:
            print("录音机状态在处理过程中发生变化，忽略此音频块")
            return
    except AttributeError as e:
        print(f"处理音频数据错误: {e}")
        logging.error(f"处理音频数据错误: {e}", exc_info=True)
        # 可能是recorder对象不完整或audio_queue不存在
        print("录音机结构错误，重置状态")
        recorder_ready.clear()
        emit('recorder_status', {'ready': False})
    except Exception as e:
        print(f"处理音频数据错误: {e}")
        logging.error(f"处理音频数据错误: {e}", exc_info=True)
        # 如果出现错误，可能是录音机状态有问题，尝试重置
        if "NoneType" in str(e) or "feed_audio" in str(e):
            print("检测到录音机状态异常，重置状态")
            recorder_ready.clear()
            emit('recorder_status', {'ready': False})


# 启动应用
if __name__ == '__main__':
    # 从文件加载上次保存的配置
    load_config_from_file()

    # 启动录音机线程
    recorder_thread = threading.Thread(target=run_recorder)
    recorder_thread.daemon = True
    recorder_thread.start()

    # 等待录音机就绪
    print("等待录音机就绪...")
    recorder_ready.wait()

    try:
        # 启动 Flask 应用
        print("启动 Flask 应用...")
        socketio.run(app, host='0.0.0.0', port=5000, debug=False)
    except KeyboardInterrupt:
        print("\n关闭应用...")
    finally:
        # 清理资源
        is_running = False
        if recorder:
            recorder.stop()
            recorder.shutdown()
            del recorder
