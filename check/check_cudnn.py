import os
import sys

def check_cudnn_files():
    # 常见的 CUDA 安装路径
    cuda_paths = [
        r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v11.8",
        r"C:\Program Files\NVIDIA\CUDA\v11.8",
        os.environ.get('CUDA_PATH', '')
    ]
    
    # 需要检查的文件
    required_files = [
        'cudnn_ops64_9.dll',
        'cudnn_cnn64_9.dll',
        'cudnn_adv64_9.dll'
    ]
    
    print("检查 cuDNN 文件...")
    
    for cuda_path in cuda_paths:
        if not cuda_path:
            continue
            
        bin_path = os.path.join(cuda_path, 'bin')
        if not os.path.exists(bin_path):
            print(f"目录不存在: {bin_path}")
            continue
            
        print(f"\n检查目录: {bin_path}")
        for file in required_files:
            file_path = os.path.join(bin_path, file)
            if os.path.exists(file_path):
                print(f"✓ 找到文件: {file}")
            else:
                print(f"✗ 未找到文件: {file}")
                
        # 检查 PATH 环境变量
        path = os.environ.get('PATH', '')
        if bin_path in path:
            print(f"✓ {bin_path} 在 PATH 环境变量中")
        else:
            print(f"✗ {bin_path} 不在 PATH 环境变量中")

if __name__ == "__main__":
    check_cudnn_files() 