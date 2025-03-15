@echo off
echo 正在启动实时语音识别应用程序...

REM 检查虚拟环境是否存在
if not exist venv\Scripts\activate.bat (
    echo 创建虚拟环境...
    python -m venv venv
) else (
    echo 虚拟环境已存在
)

REM 激活虚拟环境
echo 激活虚拟环境...
call venv\Scripts\activate.bat

REM 安装依赖
echo 安装依赖...
pip install --upgrade pip
pip install -r requirements.txt

REM 启动应用
echo 启动应用程序...
python flask_stt_app.py

pause