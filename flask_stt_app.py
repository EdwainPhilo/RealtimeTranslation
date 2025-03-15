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

# 录音机配置
recorder_config = {
    'spinner': False,
    'use_microphone': False,
    'model': 'tiny',
    'language': 'zh',
    'silero_sensitivity': 0.4,
    'webrtc_sensitivity': 2,
    'post_speech_silence_duration': 0.7,
    'min_length_of_recording': 0,
    'min_gap_between_recordings': 0,
    'enable_realtime_transcription': True,
    'realtime_processing_pause': 0,
    'realtime_model_type': 'tiny',
    'on_realtime_transcription_stabilized': None,  # 将在初始化时设置
}

# 回调函数：当实时转录稳定时调用
def text_detected(text):
    socketio.emit('realtime', {'type': 'realtime', 'text': text})
    print(f"\r{text}", end='', flush=True)

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

# 运行录音机的线程函数
def run_recorder():
    global recorder, is_running
    print("初始化 RealtimeSTT...")
    # 设置回调函数
    recorder_config['on_realtime_transcription_stabilized'] = text_detected
    
    recorder = AudioToTextRecorder(**recorder_config)
    print("RealtimeSTT 初始化完成")
    recorder_ready.set()
    
    # 循环检查完整句子输出
    while is_running:
        try:
            full_sentence = recorder.text()
            if full_sentence:
                socketio.emit('fullSentence', {'type': 'fullSentence', 'text': full_sentence})
                print(f"\rSentence: {full_sentence}")
        except Exception as e:
            print(f"Error in recorder thread: {e}")
        time.sleep(0.1)  # 避免 CPU 占用过高

# 路由：主页
@app.route('/')
def index():
    return render_template('index.html')

# Socket.IO 事件：连接
@socketio.on('connect')
def handle_connect():
    print('客户端已连接')

# Socket.IO 事件：断开连接
@socketio.on('disconnect')
def handle_disconnect():
    print('客户端已断开连接')

# Socket.IO 事件：接收音频数据
@socketio.on('audio_data')
def handle_audio_data(data):
    if not recorder_ready.is_set():
        print("录音机未就绪")
        return
    
    try:
        # 解析数据
        audio_data = base64.b64decode(data['audio'])
        sample_rate = data['sampleRate']
        
        # 重采样
        resampled_audio = decode_and_resample(audio_data, sample_rate)
        
        # 送入录音机
        recorder.feed_audio(resampled_audio)
    except Exception as e:
        print(f"处理音频数据错误: {e}")
        logging.error(f"处理音频数据错误: {e}", exc_info=True)

# 启动应用
if __name__ == '__main__':
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
