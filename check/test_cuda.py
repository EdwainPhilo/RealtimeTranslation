import torch
import sys
import os

def print_cuda_info():
    print(f"Python 版本: {sys.version}")
    print(f"PyTorch 版本: {torch.__version__}")
    print(f"CUDA 是否可用: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"CUDA 版本: {torch.version.cuda}")
        print(f"当前 CUDA 设备: {torch.cuda.get_device_name(0)}")
        print(f"CUDA 设备数量: {torch.cuda.device_count()}")
    
    # 打印环境变量
    print("\n环境变量:")
    cuda_path = os.environ.get('CUDA_PATH')
    path = os.environ.get('PATH')
    print(f"CUDA_PATH: {cuda_path}")
    print("\nPATH 中的 CUDA 相关路径:")
    for p in path.split(';'):
        if 'cuda' in p.lower():
            print(p)

if __name__ == "__main__":
    print_cuda_info() 