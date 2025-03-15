import torch
import sys

def check_versions():
    print(f"Python 版本: {sys.version}")
    print(f"PyTorch 版本: {torch.__version__}")
    print(f"CUDA 是否可用: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"CUDA 版本: {torch.version.cuda}")
        print(f"cuDNN 版本: {torch.backends.cudnn.version()}")
        print(f"当前 CUDA 设备: {torch.cuda.get_device_name(0)}")
        
        # 测试 CUDA 功能
        try:
            x = torch.rand(5, 3).cuda()
            print("\nCUDA 张量测试成功！")
        except Exception as e:
            print(f"\nCUDA 张量测试失败: {str(e)}")

if __name__ == "__main__":
    check_versions() 