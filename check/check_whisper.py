import faster_whisper
import sys

def check_whisper():
    print(f"faster-whisper 版本: {faster_whisper.__version__}")
    print(f"Python 版本: {sys.version}")
    
    # 尝试加载模型
    try:
        model = faster_whisper.WhisperModel("tiny", device="cuda")
        print("\n模型加载成功！")
        
        # 测试转录
        segments, info = model.transcribe("test.wav", beam_size=5)
        print("\n转录测试成功！")
    except Exception as e:
        print(f"\n错误: {str(e)}")

if __name__ == "__main__":
    check_whisper() 