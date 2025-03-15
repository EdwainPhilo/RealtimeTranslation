import numpy as np
import soundfile as sf

def create_test_audio():
    # 创建一个简单的正弦波
    duration = 3  # 秒
    sample_rate = 16000
    t = np.linspace(0, duration, int(sample_rate * duration))
    audio = np.sin(2 * np.pi * 440 * t)  # 440 Hz 的音调
    
    # 保存为 WAV 文件
    sf.write('test.wav', audio, sample_rate)
    print("测试音频文件已创建：test.wav")

if __name__ == "__main__":
    create_test_audio() 