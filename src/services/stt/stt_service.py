import threading
import numpy as np
from scipy.signal import resample
import logging
import time
import json
import os
import sys
import traceback
from threading import Thread, Event, Lock
from src.utils.stt.audio_recorder import AudioToTextRecorder
import importlib
import subprocess
from typing import Dict, Any, Optional, List, Union

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logging.getLogger('websockets').setLevel(logging.WARNING)

# 创建服务专用的日志记录器
stt_logger = logging.getLogger('stt_service')
stt_logger.setLevel(logging.INFO)

# 启动失败记录文件路径
STARTUP_ERROR_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'startup_error.json')

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
    'porcupine_access_key': "",  # Porcupine访问密钥
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


class STTService:
    def __init__(self, realtime_callback=None, full_sentence_callback=None, socketio=None):
        self.socketio = socketio
        self.recorder = None
        self.recorder_ready = threading.Event()
        self.is_running = True
        self.config_lock = threading.Lock()  # 用于保护配置访问
        self.current_config = default_config.copy()
        
        # 设置回调函数
        self.realtime_callback = realtime_callback
        self.full_sentence_callback = full_sentence_callback
        
        # 从文件加载上次保存的配置
        self.load_config_from_file()
        
        # 检查是否存在启动失败记录
        self.check_startup_error()
        
        # 先创建录音机
        print("初始化 STT 服务...")
        try:
            success, error = self.create_recorder()
            if not success:
                print(f"初始化录音机失败: {error}")
            else:
                print("录音机初始化成功")
        except Exception as e:
            print(f"初始化录音机出错: {e}")
            logging.error("初始化录音机出错", exc_info=True)
        
        # 只有在录音机创建成功后才启动监控线程
        if self.recorder and self.recorder_ready.is_set():
            self.recorder_thread = threading.Thread(target=self.run_recorder)
            self.recorder_thread.daemon = True
            self.recorder_thread.start()
            print("录音机监控线程已启动")
        else:
            print("录音机创建失败，不启动监控线程")

    def setup_wakeword_callbacks(self):
        """设置唤醒词回调函数"""
        if self.recorder:
            config_copy = self.current_config.copy()
            # 设置唤醒词检测回调
            config_copy['on_wakeword_detected'] = self.on_wakeword_detected
            config_copy['on_wakeword_timeout'] = self.on_wakeword_timeout
            config_copy['on_wakeword_detection_start'] = self.on_wakeword_detection_start
            config_copy['on_wakeword_detection_end'] = self.on_wakeword_detection_end
            
            # 更新录音机的回调
            with self.config_lock:
                for key, value in config_copy.items():
                    if key.startswith('on_') and hasattr(self.recorder, key):
                        setattr(self.recorder, key, value)

    def on_wakeword_detected(self):
        """唤醒词检测到的回调"""
        try:
            print("检测到唤醒词，超时时间为:", self.current_config.get('wake_word_timeout', 5.0), "秒")
            if self.socketio:
                self.socketio.emit('wakeword_status', {
                    'status': 'activated',
                    'message': '唤醒词已激活'
                })
                # 同时发送录音状态变更为激活
                self.socketio.emit('recording_status', {
                    'active': True,
                    'message': '录音已启用'
                })
        except Exception as e:
            print(f"发送唤醒词状态出错: {e}")

    def on_wakeword_timeout(self):
        """唤醒词超时的回调"""
        try:
            print("唤醒词超时")
            if self.socketio:
                self.socketio.emit('wakeword_status', {
                    'status': 'listening',
                    'message': '等待唤醒词'
                })
                # 同时发送录音状态变更为禁用
                self.socketio.emit('recording_status', {
                    'active': False,
                    'message': '录音已禁用'
                })
        except Exception as e:
            print(f"发送唤醒词状态出错: {e}")

    def on_wakeword_detection_start(self):
        """唤醒词检测开始的回调"""
        try:
            print("开始检测唤醒词")
            if self.socketio:
                self.socketio.emit('wakeword_status', {
                    'status': 'listening',
                    'message': '等待唤醒词'
                })
                # 同时发送录音状态变更为禁用
                self.socketio.emit('recording_status', {
                    'active': False,
                    'message': '录音已禁用'
                })
        except Exception as e:
            print(f"发送唤醒词状态出错: {e}")

    def on_wakeword_detection_end(self):
        """唤醒词检测结束的回调"""
        try:
            print("停止检测唤醒词")
            if self.socketio:
                self.socketio.emit('wakeword_status', {
                    'status': 'disabled',
                    'message': '唤醒词未启用'
                })
                # 同时发送录音状态变更为启用
                self.socketio.emit('recording_status', {
                    'active': True,
                    'message': '录音已启用'
                })
        except Exception as e:
            print(f"发送唤醒词状态出错: {e}")

    def text_detected(self, text):
        """当实时转录稳定时调用的回调函数"""
        if self.realtime_callback:
            self.realtime_callback(text)
        print(f"\r{text}", end='', flush=True)

    def get_serializable_config(self):
        """获取可序列化的配置，添加启动错误信息"""
        config = self.current_config.copy()
        
        # 添加启动错误信息（如果有）
        if hasattr(self, 'last_startup_error') and self.last_startup_error:
            config['startup_error'] = self.last_startup_error
        
        return config

    def decode_and_resample(self, audio_data, original_sample_rate, target_sample_rate=16000):
        """重采样函数"""
        try:
            audio_np = np.frombuffer(audio_data, dtype=np.int16)
            num_original_samples = len(audio_np)
            num_target_samples = int(num_original_samples * target_sample_rate / original_sample_rate)
            resampled_audio = resample(audio_np, num_target_samples)
            return resampled_audio.astype(np.int16).tobytes()
        except Exception as e:
            print(f"重采样错误: {e}")
            return audio_data

    def create_recorder(self):
        """创建并初始化录音机，如果成功返回True，否则返回False和错误信息"""
        try:
            if self.recorder is not None:
                try:
                    self.recorder.shutdown()
                    time.sleep(0.5)  # 等待资源释放
                except Exception as e:
                    print(f"关闭旧录音机时出现异常: {e}")
                self.recorder = None

            # 添加回调函数
            with self.config_lock:
                config_copy = self.current_config.copy()
                config_copy['on_realtime_transcription_stabilized'] = self.text_detected

            # 创建新录音机
            print("创建新录音机...")
            try:
                self.recorder = AudioToTextRecorder(**config_copy)
            except Exception as e:
                error_str = str(e)
                # 检查是否是OpenWakeWord模型加载错误
                if ('openwakeword' in error_str.lower() or 'onnx' in error_str.lower() or 
                    'protobuf' in error_str.lower() or 'model' in error_str.lower()):
                    
                    # 记录错误但继续尝试重置模型路径
                    print(f"OpenWakeWord模型加载失败: {e}")
                    logging.error(f"OpenWakeWord模型加载失败，将自动重置模型路径", exc_info=True)
                    
                    # 使用专门的方法重置模型路径
                    if self.reset_openwakeword_model_paths(e):
                        # 重置成功，尝试继续创建录音机
                        return self.recorder
                    else:
                        # 重置失败，抛出原始异常
                        raise e
                # 检查是否是Porcupine相关错误
                elif ('porcupine' in error_str.lower() or 'wake_words' in error_str.lower() or 
                     'wake word' in error_str.lower() or 'access_key' in error_str.lower() or
                     'api key' in error_str.lower() or 'keyword' in error_str.lower() or
                    'picovoice' in error_str.lower() or 'accesskey' in error_str.lower()or
                    'wakeword' in error_str.lower()):
                    
                    # 记录错误但继续尝试重置Porcupine设置
                    print(f"Porcupine初始化失败: {e}")
                    logging.error(f"Porcupine初始化失败，将自动重置相关设置", exc_info=True)
                    
                    # 使用专门的方法重置Porcupine设置
                    if self.reset_porcupine_settings(e):
                        # 重置成功，尝试继续创建录音机
                        return self.recorder
                    else:
                        # 重置失败，抛出原始异常
                        raise e
                else:
                    # 其他类型的错误，直接抛出
                    raise e

            # 设置为就绪状态
            self.recorder_ready.set()
            
            # 设置唤醒词回调函数
            self.setup_wakeword_callbacks()
            
            return True, None
        except Exception as e:
            print(f"创建录音机过程中出现异常: {e}")
            logging.error(f"创建录音机过程中出现异常", exc_info=True)
            # 不设置recorder_ready标志，保持为未就绪状态
            return False, str(e)

    def run_recorder(self):
        """运行录音机的线程函数"""
        print("启动录音机监控线程...")

        retry_count = 0
        max_retries = 3

        # 循环检查完整句子输出
        while self.is_running:
            try:
                if self.recorder and self.recorder_ready.is_set():
                    # 检查音频队列大小，如果过大则发出警告
                    if hasattr(self.recorder, 'audio_queue') and hasattr(self.recorder.audio_queue, 'qsize'):
                        queue_size = self.recorder.audio_queue.qsize()
                        if queue_size > 20:
                            print(f"警告: 音频队列非常大 ({queue_size})")

                    # 获取完整文本
                    full_sentence = self.recorder.text()

                    if full_sentence and self.full_sentence_callback:
                        self.full_sentence_callback(full_sentence)
                        print(f"\rSentence: {full_sentence}")

                    retry_count = 0  # 成功操作后重置重试计数
                elif not self.recorder_ready.is_set():
                    # 如果录音机未就绪，等待一段时间
                    print("录音机未就绪，等待...")
                    time.sleep(1)

            except Exception as e:
                print(f"录音机线程中出现错误: {e}")
                logging.error(f"录音机线程中出现错误: {e}", exc_info=True)
                time.sleep(1)  # 出错后等待一段时间

            time.sleep(0.1)  # 避免 CPU 占用过高

    def feed_audio(self, audio_data, sample_rate):
        """处理音频数据"""
        # 检查录音机是否就绪
        if not self.recorder_ready.is_set():
            print("录音机未就绪，忽略接收到的音频数据")
            return False

        # 检查录音机是否为None
        if self.recorder is None:
            print("录音机对象为None，尽管标志显示就绪")
            self.recorder_ready.clear()  # 修正标志状态
            return False

        # 如果配置锁被持有，说明配置正在更新中，暂停处理音频
        if self.config_lock.locked():
            print("配置更新中，暂停接收音频数据")
            return False

        try:
            # 重采样
            resampled_audio = self.decode_and_resample(audio_data, sample_rate)

            # 检查音频队列状态
            if hasattr(self.recorder, 'audio_queue'):
                # 检查队列大小，如果太大可能需要提醒用户
                queue_size = self.recorder.audio_queue.qsize() if hasattr(self.recorder.audio_queue, 'qsize') else -1
                if queue_size > 10:  # 队列积压严重
                    print(f"警告: 音频队列积压 ({queue_size}), 可能需要调整延迟限制或减轻处理负担")

            # 送入录音机 (添加额外保护)
            if self.recorder and self.recorder_ready.is_set():
                self.recorder.feed_audio(resampled_audio)
                return True
            else:
                print("录音机状态在处理过程中发生变化，忽略此音频块")
                return False
        except AttributeError as e:
            print(f"处理音频数据错误: {e}")
            logging.error(f"处理音频数据错误: {e}", exc_info=True)
            # 可能是recorder对象不完整或audio_queue不存在
            print("录音机结构错误，重置状态")
            self.recorder_ready.clear()
            return False
        except Exception as e:
            print(f"处理音频数据错误: {e}")
            logging.error(f"处理音频数据错误: {e}", exc_info=True)
            # 如果出现错误，可能是录音机状态有问题，尝试重置
            if "NoneType" in str(e) or "feed_audio" in str(e):
                print("检测到录音机状态异常，重置状态")
                self.recorder_ready.clear()
            return False

    def save_config_to_file(self, new_config):
        """保存配置到文件"""
        try:
            # 更新内存中的配置
            with self.config_lock:
                # 保存到当前配置
                for key, value in new_config.items():
                    if key in self.current_config:
                        # 输出重要配置变化的日志
                        if str(self.current_config[key]) != str(value):
                            print(f"配置项 '{key}' 从 '{self.current_config[key]}' 更改为 '{value}'")
                        self.current_config[key] = value

            # 保存可序列化的配置到文件
            config_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'last_config.json')
            serializable_config = self.get_serializable_config()

            with open(config_file, 'w', encoding='utf-8') as f:
                json.dump(serializable_config, f, indent=4, ensure_ascii=False)

            print(f"配置已保存到文件: {config_file}")
            return True
        except Exception as e:
            print(f"保存配置到文件时出错: {e}")
            return False

    def load_config_from_file(self):
        """从文件加载配置"""
        config_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'last_config.json')

        if os.path.exists(config_file):
            try:
                with open(config_file, 'r', encoding='utf-8') as f:
                    saved_config = json.load(f)

                # 更新当前配置
                with self.config_lock:
                    for key, value in saved_config.items():
                        if key in self.current_config:
                            self.current_config[key] = value

                print(f"从文件加载了配置: {config_file}")
                return True
            except Exception as e:
                print(f"从文件加载配置时出错: {e}")
                return False
        else:
            print("未找到配置文件，使用默认配置")
            return False

    def update_config(self, new_config):
        """更新配置"""
        return self.save_config_to_file(new_config)

    def reset_to_default(self):
        """恢复默认设置"""
        try:
            # 复制默认配置
            with self.config_lock:
                self.current_config = default_config.copy()

            # 保存默认配置到文件
            config_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'last_config.json')
            serializable_config = self.get_serializable_config()

            with open(config_file, 'w', encoding='utf-8') as f:
                json.dump(serializable_config, f, indent=4, ensure_ascii=False)

            print(f"已恢复默认配置并保存到文件: {config_file}")
            return True
        except Exception as e:
            print(f"恢复默认设置时出错: {e}")
            return False

    def is_ready(self):
        """检查录音机是否就绪"""
        return self.recorder_ready.is_set()

    def shutdown(self):
        """关闭服务，清除启动失败记录"""
        self.is_running = False
        if self.recorder:
            try:
                self.recorder.stop()
                self.recorder.shutdown()
            except:
                pass
        
        # 清除启动失败记录
        self.clear_startup_error()
        
        return True

    def check_startup_error(self):
        """检查是否存在启动失败记录，并记录到日志"""
        if os.path.exists(STARTUP_ERROR_FILE):
            try:
                with open(STARTUP_ERROR_FILE, 'r', encoding='utf-8') as f:
                    error_data = json.load(f)
                    
                stt_logger.warning(f"检测到上次启动失败: {error_data.get('message', '未知错误')}")
                stt_logger.warning(f"错误详情: {error_data.get('error', '无详细信息')}")
                stt_logger.warning(f"发生时间: {error_data.get('timestamp', '未知时间')}")
                
                # 记录到全局变量，供前端获取
                self.last_startup_error = error_data
            except Exception as e:
                stt_logger.error(f"读取启动失败记录出错: {e}")
                self.last_startup_error = None
        else:
            self.last_startup_error = None
    
    def record_startup_error(self, message, error_details):
        """记录启动失败信息到文件"""
        try:
            error_data = {
                "message": message,
                "error": str(error_details),
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
            }
            
            with open(STARTUP_ERROR_FILE, 'w', encoding='utf-8') as f:
                json.dump(error_data, f, ensure_ascii=False, indent=2)
                
            stt_logger.info(f"已记录启动失败信息: {message}")
        except Exception as e:
            stt_logger.error(f"记录启动失败信息出错: {e}")
    
    def clear_startup_error(self):
        """清除启动失败记录"""
        if os.path.exists(STARTUP_ERROR_FILE):
            try:
                os.remove(STARTUP_ERROR_FILE)
                stt_logger.info("已清除启动失败记录")
            except Exception as e:
                stt_logger.error(f"清除启动失败记录出错: {e}")
    
    def reset_openwakeword_model_paths(self, e):
        """重置OpenWakeWord模型路径并记录错误"""
        try:
            # 保存原始路径用于日志
            config_copy = self.current_config.copy()
            original_paths = config_copy.get('openwakeword_model_paths', None)
            
            # 重置模型路径
            config_copy['openwakeword_model_paths'] = None
            
            # 更新当前配置
            if 'openwakeword_model_paths' in self.current_config:
                self.current_config['openwakeword_model_paths'] = None
            
            # 保存到配置文件
            self.save_config_to_file({'openwakeword_model_paths': None})
            
            # 记录启动失败信息
            error_message = '检测到无效的模型文件，已自动重置为默认模型'
            self.record_startup_error(error_message, str(e))
            
            stt_logger.info(f"已重置OpenWakeWord模型路径从 '{original_paths}' 到 'None'")
            
            # 尝试全局访问socketio实例，通知前端
            try:
                from app import socketio
                socketio.emit('model_path_reset', {
                    'message': error_message,
                    'old_path': str(original_paths),
                    'error': str(e)
                })
            except Exception as emit_error:
                print(f"无法发送通知: {emit_error}")
            
            # 触发完整应用重启
            def delayed_restart():
                print("模型路径已重置，2秒后自动重启应用...")
                time.sleep(2)  # 等待2秒确保消息发送和配置保存完成
                
                try:
                    # 在Windows环境下重启应用
                    if sys.platform == 'win32':
                        python = sys.executable
                        script_path = sys.argv[0]
                        args = sys.argv[1:]
                        
                        # 使用subprocess启动新进程
                        subprocess.Popen([python, script_path] + args, 
                                       creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
                        
                        # 延迟退出当前进程
                        time.sleep(1)
                        print("正在关闭当前进程...")
                        os._exit(0)
                    else:
                        # Linux/Mac重启方式
                        os.execl(sys.executable, sys.executable, *sys.argv)
                except Exception as restart_error:
                    print(f"自动重启失败: {restart_error}")
                    logging.error(f"自动重启失败", exc_info=True)
            
            # 启动重启线程
            restart_thread = threading.Thread(target=delayed_restart)
            restart_thread.daemon = True
            restart_thread.start()
            
            # 临时创建默认模型以允许当前操作继续
            self.recorder = AudioToTextRecorder(**config_copy)
            return True
        except Exception as reset_error:
            print(f"重置模型路径时出错: {reset_error}")
            return False
            
    def reset_porcupine_settings(self, e):
        """重置Porcupine设置并记录错误"""
        try:
            # 保存原始设置用于日志
            config_copy = self.current_config.copy()
            original_wake_words = config_copy.get('wake_words', '')
            original_access_key = config_copy.get('porcupine_access_key', '')
            
            error_str = str(e).lower()
            error_message = ''
            
            # 根据错误类型决定重置策略
            if 'access_key' in error_str or 'invalid access key' in error_str or 'api key' in error_str or 'accesskey' in error_str:
                # Access Key错误，同时重置唤醒词和access_key
                config_copy['wake_words'] = ''
                config_copy['porcupine_access_key'] = ''
                
                # 更新当前配置
                self.current_config['wake_words'] = ''
                self.current_config['porcupine_access_key'] = ''
                
                # 保存到配置文件
                self.save_config_to_file({
                    'wake_words': '',
                    'porcupine_access_key': ''
                })
                
                error_message = 'Porcupine访问密钥无效，已自动重置唤醒词和访问密钥'
                stt_logger.info(f"已重置Porcupine访问密钥从 '{original_access_key}' 到 ''，重置唤醒词从 '{original_wake_words}' 到 ''")
            else:
                # 唤醒词错误，只重置唤醒词
                config_copy['wake_words'] = ''
                
                # 更新当前配置
                self.current_config['wake_words'] = ''
                
                # 保存到配置文件
                self.save_config_to_file({
                    'wake_words': ''
                })
                
                error_message = 'Porcupine唤醒词无效，已自动重置唤醒词'
                stt_logger.info(f"已重置Porcupine唤醒词从 '{original_wake_words}' 到 ''")
            
            # 记录启动失败信息
            self.record_startup_error(error_message, str(e))
            
            # 尝试全局访问socketio实例，通知前端
            try:
                from app import socketio
                socketio.emit('model_path_reset', {
                    'message': error_message,
                    'error': str(e)
                })
            except Exception as emit_error:
                print(f"无法发送通知: {emit_error}")
            
            # 触发完整应用重启
            def delayed_restart():
                print("Porcupine设置已重置，2秒后自动重启应用...")
                time.sleep(2)  # 等待2秒确保消息发送和配置保存完成
                
                try:
                    # 在Windows环境下重启应用
                    if sys.platform == 'win32':
                        python = sys.executable
                        script_path = sys.argv[0]
                        args = sys.argv[1:]
                        
                        # 使用subprocess启动新进程
                        subprocess.Popen([python, script_path] + args, 
                                       creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
                        
                        # 延迟退出当前进程
                        time.sleep(1)
                        print("正在关闭当前进程...")
                        os._exit(0)
                    else:
                        # Linux/Mac重启方式
                        os.execl(sys.executable, sys.executable, *sys.argv)
                except Exception as restart_error:
                    print(f"自动重启失败: {restart_error}")
                    logging.error(f"自动重启失败", exc_info=True)
            
            # 启动重启线程
            restart_thread = threading.Thread(target=delayed_restart)
            restart_thread.daemon = True
            restart_thread.start()
            
            # 临时创建默认模型以允许当前操作继续
            self.recorder = AudioToTextRecorder(**config_copy)
            return True
        except Exception as reset_error:
            print(f"重置Porcupine设置时出错: {reset_error}")
            return False 