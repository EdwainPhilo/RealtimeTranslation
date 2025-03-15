from audio_recorder import AudioToTextRecorder
import time

def on_recording_start():
    print("开始录音...")

def on_vad_detect_start():
    print("检测到语音...")

def on_transcription_start():
    print("开始转写...")

def text_detected(text):
    print(f"识别结果: {text}")

def main():
    # 创建录音器实例
    recorder = AudioToTextRecorder(
        model="tiny",  # 使用较小的模型，速度更快
        language="zh",  # 设置为中文
        silero_sensitivity=0.2,  # 语音检测灵敏度
        webrtc_sensitivity=3,    # WebRTC VAD灵敏度
        on_recording_start=on_recording_start,
        on_vad_detect_start=on_vad_detect_start,
        on_transcription_start=on_transcription_start,
        post_speech_silence_duration=0.4,  # 语音结束后的静音时间
        min_length_of_recording=0.3,       # 最小录音长度
        min_gap_between_recordings=0.01,   # 录音之间的最小间隔
        enable_realtime_transcription=True, # 启用实时转写
        realtime_processing_pause=0.01,    # 实时处理间隔
        realtime_model_type="tiny",        # 实时转写使用的模型
        on_realtime_transcription_stabilized=text_detected  # 实时转写结果回调
    )

    try:
        print("开始录音，按Ctrl+C停止...")
        while True:
            # 等待语音输入
            text = recorder.text()
            if text:
                print(f"最终识别结果: {text}")
            time.sleep(0.1)

    except KeyboardInterrupt:
        print("\n停止录音")
    finally:
        recorder.shutdown()

if __name__ == "__main__":
    main()