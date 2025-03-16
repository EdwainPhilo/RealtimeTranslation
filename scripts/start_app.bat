@echo off
setlocal enabledelayedexpansion

:: 设置路径和环境变量
set "PROJECT_ROOT=%~dp0.."
set "PYTHON_PATH=%PROJECT_ROOT%\src"
set "PYTHONPATH=%PYTHONPATH%;%PYTHON_PATH%"

:: 切换到项目根目录
cd /d "%PROJECT_ROOT%"

:: 检查 Python 是否可用
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Python 未找到，请确保已正确安装 Python
    goto :error
)

:: 检查 virtualenv 是否激活
if not defined VIRTUAL_ENV (
    echo 警告: 未检测到激活的虚拟环境
    echo 建议在虚拟环境中运行此应用
    echo.
    timeout /t 2 >nul
)

:: 检查必要的包是否已安装
python -c "import flask_socketio" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo 正在安装必要的依赖...
    pip install -r "%PROJECT_ROOT%\requirements.txt"
    if %ERRORLEVEL% NEQ 0 goto :error
)

:: 设置环境变量
set "FLASK_APP=src.app:app"
set "FLASK_ENV=development"

:: 启动应用
echo 正在启动语音转写应用程序...
python -m src.app

:: 错误处理
if %ERRORLEVEL% NEQ 0 goto :error
goto :end

:error
echo.
echo 运行时出现错误!
echo 请查看上方的错误信息。
pause
exit /b 1

:end
echo.
echo 应用程序已退出。
pause
exit /b 0 