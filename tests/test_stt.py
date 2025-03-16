"""
STT 服务测试脚本
用于测试 STT 服务是否正常工作
"""

import time
import sys
import os

# 将当前目录添加到 Python 路径
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from src.utils.stt import STTService

def realtime_callback(text):
    """实时文本回调"""
    print(f"\r实时文本: {text}", end='', flush=True)

def full_sentence_callback(text):
    """完整句子回调"""
    print(f"\n完整句子: {text}")

def main():
    """主函数"""
    print("初始化 STT 服务...")
    
    # 创建 STT 服务
    stt_service = STTService(
        realtime_callback=realtime_callback,
        full_sentence_callback=full_sentence_callback
    )
    
    # 等待 STT 服务就绪
    print("等待 STT 服务就绪...")
    for _ in range(30):  # 最多等待30秒
        if stt_service.is_ready():
            print("STT 服务已就绪")
            break
        time.sleep(1)
    
    if not stt_service.is_ready():
        print("STT 服务未就绪，退出测试")
        return
    
    print("\nSTT 服务测试成功！")
    print("服务已准备好处理音频数据")
    print("按 Ctrl+C 退出测试")
    
    try:
        # 保持程序运行，直到用户按下 Ctrl+C
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n用户中断，退出测试")
    finally:
        # 关闭 STT 服务
        print("关闭 STT 服务...")
        stt_service.shutdown()

if __name__ == "__main__":
    main() 