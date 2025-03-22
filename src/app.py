import sys
import os
from multiprocessing import freeze_support
import json
import logging
import time
import psutil

# 将当前目录添加到 Python 路径
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import threading
import base64
import random
import re
import shutil
import signal

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(
            os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'logs', 'app.log'),
            encoding='utf-8')
    ]
)

# 降低不必要的日志级别
logging.getLogger('websockets').setLevel(logging.WARNING)
logging.getLogger('engineio.server').setLevel(logging.WARNING)
logging.getLogger('socketio.server').setLevel(logging.WARNING)
logging.getLogger('werkzeug').setLevel(logging.WARNING)  # 降低 Flask 开发服务器的日志级别

# 创建应用专用的日志记录器
app_logger = logging.getLogger('app')
app_logger.setLevel(logging.INFO)

# 函数：更新应用日志设置
def update_app_log_settings(stt_service):
    """根据STT服务配置更新应用的日志设置"""
    if not stt_service:
        return
    
    try:
        # 获取日志级别
        config = stt_service.current_config
        level_name = config.get('log_level', 'WARNING')
        level = getattr(logging, level_name, logging.WARNING)
        
        # 设置应用日志记录器级别
        app_logger.setLevel(level)
        
        # 如果启用调试模式，设置为DEBUG
        if config.get('debug_mode', False) and level > logging.DEBUG:
            app_logger.setLevel(logging.DEBUG)
        
        # 处理日志文件
        no_log_file = config.get('no_log_file', True)
        
        # 找到当前的文件处理程序
        handlers = app_logger.handlers[:]
        root_handlers = logging.getLogger().handlers[:]
        
        # 合并处理程序列表
        all_handlers = handlers + root_handlers
        
        # 处理日志文件选项
        file_handlers = [h for h in all_handlers if isinstance(h, logging.FileHandler)]
        
        if no_log_file:
            # 移除所有文件处理程序
            for handler in file_handlers:
                if handler in app_logger.handlers:
                    app_logger.removeHandler(handler)
                if handler in logging.getLogger().handlers:
                    logging.getLogger().removeHandler(handler)
        else:
            # 如果没有文件处理程序且需要启用日志文件，添加一个
            if not file_handlers:
                log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'logs')
                os.makedirs(log_dir, exist_ok=True)
                log_file = os.path.join(log_dir, 'app.log')
                file_handler = logging.FileHandler(log_file, encoding='utf-8')
                file_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
                file_handler.setLevel(level)
                app_logger.addHandler(file_handler)
        
        app_logger.info(f"已更新应用日志设置: 级别={level_name}, 文件日志={'禁用' if no_log_file else '启用'}")
    except Exception as e:
        print(f"更新应用日志设置时出错: {e}")

# 创建 Flask 应用
app = Flask(__name__,
            template_folder=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web', 'templates'),
            static_folder=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web', 'static'))
app.config['SECRET_KEY'] = 'your-secret-key'
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    max_http_buffer_size=1e8,  # 增加到 100MB
    ping_timeout=60,  # 增加 ping 超时时间
    ping_interval=25,  # 调整 ping 间隔
    async_mode='threading'  # 使用线程模式
)

# 导入STT服务和翻译服务
from src.services.stt.stt_service import STTService
from src.services.translation.translation_manager import TranslationManager
from src.services.realtime_handler import RealtimeHandler  # 导入实时处理器
from src.api.translation_routes import init_routes as init_translation_routes  # 导入翻译API路由初始化函数

# 全局变量
stt_service = None
translation_manager = None
realtime_handler = None  # 添加实时处理器实例

# STT 服务回调函数
def realtime_text_callback(text):
    """实时文本回调"""
    try:
        socketio.emit('realtime', {'type': 'realtime', 'text': text})
        app_logger.debug(f"实时文本: {text}")  # 使用 debug 级别避免日志过多
    except Exception as e:
        app_logger.error(f"发送实时文本时出错: {e}")


def full_sentence_callback(text):
    """完整句子回调"""
    try:
        socketio.emit('fullSentence', {'type': 'fullSentence', 'text': text})
        app_logger.info(f"完整句子: {text}")  # 使用 info 级别记录完整句子
    except Exception as e:
        app_logger.error(f"发送完整句子时出错: {e}")


def create_stt_service():
    """创建并初始化STT服务"""
    global stt_service
    if stt_service is None:
        app_logger.info("初始化STT服务...")
        stt_service = STTService(full_sentence_callback=full_sentence_callback, 
                                realtime_callback=realtime_text_callback)
    return stt_service

def create_translation_manager():
    """创建并初始化翻译服务管理器"""
    global translation_manager
    if translation_manager is None:
        app_logger.info("初始化翻译服务管理器...")
        # 配置文件路径
        config_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config')
        os.makedirs(config_dir, exist_ok=True)
        config_path = os.path.join(config_dir, 'translation_config.json')
        
        # 创建配置文件（如果不存在）
        if not os.path.exists(config_path):
            default_config = {
                'active_service': 'google',
                'use_streaming_translation': False,
                'services': {
                    'google': {
                        'use_official_api': False,
                        'target_language': 'zh-CN',
                        'source_language': 'auto'
                    }
                }
            }
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(default_config, f, indent=4, ensure_ascii=False)
        
        # 初始化翻译管理器
        translation_manager = TranslationManager(config_path=config_path)
    return translation_manager

def create_realtime_handler():
    """创建并初始化实时处理器"""
    global realtime_handler, stt_service, translation_manager
    
    if realtime_handler is None:
        # 确保STT服务和翻译管理器已初始化
        if stt_service is None:
            stt_service = create_stt_service()
        
        if translation_manager is None:
            translation_manager = create_translation_manager()
        
        app_logger.info("初始化实时处理器...")
        realtime_handler = RealtimeHandler(stt_service, translation_manager)
    
    return realtime_handler

# 主页路由
@app.route('/')
def index():
    return render_template('index.html')

# 重启页面路由
@app.route('/restart')
def restart_page():
    return render_template('restart.html')


# Socket.IO 事件：连接
@socketio.on('connect')
def handle_connect():
    app_logger.info('客户端已连接')
    emit('config', stt_service.get_serializable_config())
    emit('recorder_status', {'ready': stt_service.is_ready()})


# Socket.IO 事件：断开连接
@socketio.on('disconnect')
def handle_disconnect():
    app_logger.info('客户端已断开连接')


# Socket.IO 事件：获取配置
@socketio.on('get_config')
def handle_get_config():
    emit('config', stt_service.get_serializable_config())


# Socket.IO 事件：更新配置
@socketio.on('update_config')
def handle_update_config(data):
    print(f"收到配置更新请求: {data}")

    try:
        # 保存当前配置到文件，以便重启后恢复
        stt_service.update_config(data)
        
        # 更新应用日志设置
        if any(key in data for key in ['log_level', 'debug_mode', 'no_log_file', 'use_extended_logging']):
            update_app_log_settings(stt_service)

        # 通知客户端我们即将重启，并重定向到重启页面
        emit('restart_required', {
            'message': '正在重启应用以应用新配置...',
            'countdown': 3,  # 3秒倒计时
            'redirect_to': '/restart'  # 重定向到重启页面
        })

        print("配置已更新，准备重启应用...")

        # 使用线程延迟重启，确保消息发送到客户端
        def delayed_restart():
            import time
            import os
            import sys
            import subprocess

            # 等待2秒确保客户端收到重启消息并重定向
            time.sleep(2)

            print("重启应用程序...")
            # 在Windows环境下使用subprocess启动新进程并退出当前进程
            if sys.platform == 'win32':
                python = sys.executable
                args = [python] + sys.argv
                app_logger.info(f"使用Windows方式重启应用: {args}")
                # 创建无窗口的进程
                subprocess.Popen(args, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
                # 关闭STT服务
                if stt_service:
                    try:
                        stt_service.shutdown()
                    except Exception as e:
                        app_logger.error(f"关闭STT服务时出错: {e}")
                # 等待一小段时间确保新进程已启动
                time.sleep(1)
                os._exit(0)  # 强制退出当前进程
            else:
                # 在Unix系统上使用execl
                python = sys.executable
                os.execl(python, python, *sys.argv)

        restart_thread = threading.Thread(target=delayed_restart)
        restart_thread.daemon = True
        restart_thread.start()

    except Exception as e:
        print(f"处理配置更新请求时出错: {e}")
        emit('config_updated', {
            'success': False,
            'error': str(e)
        })


# Socket.IO 事件：恢复默认设置
@socketio.on('reset_to_default')
def handle_reset_to_default():
    print("收到恢复默认设置请求")

    try:
        # 恢复默认配置
        stt_service.reset_to_default()

        # 通知客户端我们即将重启
        emit('restart_required', {
            'message': '正在恢复默认设置并重启应用...',
            'countdown': 3,  # 3秒倒计时
            'redirect_to': '/restart'  # 重定向到重启页面
        })

        print("已恢复默认设置，准备重启应用...")

        # 使用线程延迟重启，确保消息发送到客户端
        def delayed_restart():
            import time
            import os
            import sys
            import subprocess

            # 等待2秒确保客户端收到重启消息
            time.sleep(2)

            print("重启应用程序...")
            # 在Windows环境下使用subprocess启动新进程并退出当前进程
            if sys.platform == 'win32':
                python = sys.executable
                args = [python] + sys.argv
                app_logger.info(f"使用Windows方式重启应用: {args}")
                # 创建无窗口的进程
                subprocess.Popen(args, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
                # 关闭STT服务
                if stt_service:
                    try:
                        stt_service.shutdown()
                    except Exception as e:
                        app_logger.error(f"关闭STT服务时出错: {e}")
                # 等待一小段时间确保新进程已启动
                time.sleep(1)
                os._exit(0)  # 强制退出当前进程
            else:
                # 在Unix系统上使用execl
                python = sys.executable
                os.execl(python, python, *sys.argv)

        restart_thread = threading.Thread(target=delayed_restart)
        restart_thread.daemon = True
        restart_thread.start()

    except Exception as e:
        print(f"恢复默认设置时出错: {e}")
        emit('config_updated', {
            'success': False,
            'error': str(e)
        })


# 添加防抖变量
last_recorder_status_time = 0
RECORDER_STATUS_DEBOUNCE_TIME = 3  # 3秒内不重复发送相同状态

# Socket.IO 事件：接收音频数据
@socketio.on('audio_data')
def handle_audio_data(data):
    global last_recorder_status_time
    
    try:
        # 检查数据大小
        if len(data['audio']) > 1e6:  # 限制单个数据包大小为1MB
            app_logger.warning("音频数据包过大，已跳过")
            return

        # 解析数据
        audio_data = base64.b64decode(data['audio'])
        sample_rate = data['sampleRate']

        # 使用线程处理音频数据
        def process_audio():
            global last_recorder_status_time
            try:
                success = stt_service.feed_audio(audio_data, sample_rate)
                if not success:
                    current_time = time.time()
                    # 检查是否需要发送状态消息（防抖）
                    if current_time - last_recorder_status_time >= RECORDER_STATUS_DEBOUNCE_TIME:
                        app_logger.warning("录音机未就绪，忽略接收到的音频数据")
                        socketio.emit('recorder_status', {'ready': False})
                        last_recorder_status_time = current_time
            except Exception as e:
                current_time = time.time()
                # 检查是否需要发送状态消息（防抖）
                if current_time - last_recorder_status_time >= RECORDER_STATUS_DEBOUNCE_TIME:
                    app_logger.error(f"音频处理错误: {e}")
                    socketio.emit('recorder_status', {'ready': False})
                    last_recorder_status_time = current_time

        thread = threading.Thread(target=process_audio)
        thread.daemon = True
        thread.start()

    except Exception as e:
        app_logger.error(f"处理音频数据错误: {e}", exc_info=True)
        emit('recorder_status', {'ready': False})


def monitor_resources():
    """监控系统资源使用情况"""
    last_warning_time = 0  # 上次警告时间
    warning_interval = 300  # 警告间隔（秒）
    baseline_memory = None  # 基准内存使用量

    while True:
        try:
            process = psutil.Process()

            # 获取资源使用情况
            cpu_percent = process.cpu_percent()
            memory_info = process.memory_info()
            memory_percent = process.memory_percent()

            # 设置基准内存使用量
            if baseline_memory is None:
                baseline_memory = memory_info.rss
                app_logger.info(f"基准内存使用量: {baseline_memory / 1e6:.1f}MB")

            current_time = time.time()

            # 只在内存使用显著增加时发出警告
            if memory_info.rss > baseline_memory * 1.5 and current_time - last_warning_time > warning_interval:
                app_logger.warning(
                    f"内存使用显著增加: {memory_info.rss / 1e6:.1f}MB (较基准值增加 {(memory_info.rss - baseline_memory) / 1e6:.1f}MB)")
                last_warning_time = current_time

                # 尝试进行内存回收
                import gc
                gc.collect()

            # CPU 使用率警告（仅在持续高负载时）
            if cpu_percent > 80:
                app_logger.warning(f"CPU 使用率较高: {cpu_percent}%")

            # 定期记录资源使用情况
            if current_time % 600 < 1:  # 每10分钟记录一次
                app_logger.info(
                    f"资源使用情况 - CPU: {cpu_percent}%, 内存: {memory_info.rss / 1e6:.1f}MB ({memory_percent:.1f}%)")

            time.sleep(60)  # 每分钟检查一次

        except Exception as e:
            app_logger.error(f"资源监控错误: {e}")
            time.sleep(120)


def send_performance_metrics():
    """定期发送性能指标到客户端"""
    while True:
        try:
            process = psutil.Process()

            # 获取系统信息
            cpu_percent = process.cpu_percent()
            memory_info = process.memory_info()
            memory_percent = process.memory_percent()

            # 获取系统总体信息
            sys_memory = psutil.virtual_memory()
            sys_cpu = psutil.cpu_percent()

            # 组装指标数据
            metrics = {
                'process': {
                    'cpu': cpu_percent,
                    'memory_mb': memory_info.rss / 1e6,
                    'memory_percent': memory_percent
                },
                'system': {
                    'cpu': sys_cpu,
                    'memory_percent': sys_memory.percent,
                    'memory_available_mb': sys_memory.available / 1e6,
                    'memory_total_mb': sys_memory.total / 1e6
                },
                'timestamp': time.time()
            }

            # 发送到客户端
            socketio.emit('performance_metrics', metrics)

            # 记录到日志
            if time.time() % 300 < 1:  # 每5分钟记录一次
                app_logger.info(
                    f"性能指标 - 进程: CPU {cpu_percent}%, 内存 {memory_info.rss / 1e6:.1f}MB; 系统: CPU {sys_cpu}%, 内存 {sys_memory.percent}%")

            time.sleep(5)  # 每5秒发送一次

        except Exception as e:
            app_logger.error(f"发送性能指标错误: {e}")
            time.sleep(30)  # 出错后等待更长时间


# 添加服务状态检查和恢复功能
def check_service_health():
    """检查服务健康状态并尝试恢复"""
    global stt_service

    consecutive_failures = 0
    max_failures = 3

    while True:
        try:
            # 检查 STT 服务是否正常
            if stt_service and not stt_service.is_ready():
                consecutive_failures += 1
                app_logger.warning(f"STT 服务状态异常 (失败计数: {consecutive_failures}/{max_failures})")

                # 如果连续多次失败，尝试重启服务
                if consecutive_failures >= max_failures:
                    app_logger.error("STT 服务连续多次失败，尝试重新初始化...")

                    try:
                        # 关闭现有服务
                        if stt_service:
                            stt_service.shutdown()

                        # 重新创建服务
                        stt_service = create_stt_service()
                        app_logger.info("STT 服务已重新初始化")

                        # 重置失败计数
                        consecutive_failures = 0

                        # 通知所有客户端服务已恢复
                        socketio.emit('recorder_status', {'ready': stt_service.is_ready()})

                    except Exception as e:
                        app_logger.error(f"重新初始化 STT 服务失败: {e}", exc_info=True)
            else:
                # 服务正常，重置失败计数
                consecutive_failures = 0

            # 执行内存回收
            if time.time() % 600 < 1:  # 每10分钟执行一次
                import gc
                collected = gc.collect()
                app_logger.debug(f"执行垃圾回收，回收了 {collected} 个对象")

            time.sleep(30)  # 每30秒检查一次

        except Exception as e:
            app_logger.error(f"健康检查异常: {e}")
            time.sleep(60)  # 出错后等待更长时间


# Socket.IO 事件：接收关闭服务请求
@socketio.on('shutdown_service')
def handle_shutdown():
    app_logger.info("收到关闭服务请求")

    try:
        # 通知所有客户端服务即将关闭
        socketio.emit('service_shutdown', {
            'message': '服务正在关闭...',
            'countdown': 3  # 3秒倒计时
        })

        # 使用线程延迟关闭，确保消息发送到客户端
        def delayed_shutdown():
            time.sleep(2)  # 等待2秒确保客户端收到消息
            app_logger.info("正在关闭服务...")

            # 清理资源
            if stt_service:
                try:
                    stt_service.shutdown()
                    app_logger.info("STT 服务已关闭")
                except Exception as e:
                    app_logger.error(f"关闭 STT 服务时出错: {e}")

            # 退出程序
            os._exit(0)  # 强制退出，确保所有线程都被终止

        shutdown_thread = threading.Thread(target=delayed_shutdown)
        shutdown_thread.daemon = True
        shutdown_thread.start()

    except Exception as e:
        app_logger.error(f"处理关闭请求时出错: {e}", exc_info=True)
        emit('error', {'message': f'关闭服务失败: {str(e)}'})


# Socket.IO 事件：验证文件路径
@socketio.on('validate_file_path')
def handle_validate_file_path(data):
    """验证文件路径是否存在"""
    app_logger.info(f"收到文件路径验证请求: {data}")
    
    result = {
        'valid': True,
        'messages': [],
        'path': data.get('path', '')
    }
    
    # 如果路径为空，返回有效
    if not data.get('path') or data.get('path').strip() == '':
        emit('file_path_validation_result', result)
        return
    
    # 验证每个路径
    paths = data.get('path', '').split(',')
    invalid_paths = []
    
    for path in paths:
        path = path.strip()
        if not path:
            continue
            
        try:
            # 验证文件是否存在
            if not os.path.exists(path):
                invalid_paths.append({
                    'path': path,
                    'reason': '文件不存在'
                })
                continue
                
            # 验证是否为文件(不是目录)
            if not os.path.isfile(path):
                invalid_paths.append({
                    'path': path,
                    'reason': '路径不是文件'
                })
                continue
                
            # 验证是否可读
            if not os.access(path, os.R_OK):
                invalid_paths.append({
                    'path': path,
                    'reason': '文件不可读'
                })
                continue
                
            # 检查是否为有效的模型文件
            is_valid_model = False
            
            # 检查文件扩展名
            file_ext = os.path.splitext(path)[1].lower()
            if file_ext in ['.onnx', '.bin', '.tflite']:
                try:
                    # 检查文件头信息（基本格式验证）
                    with open(path, 'rb') as f:
                        header = f.read(16)  # 读取前16字节
                        
                        # ONNX文件通常以"ONNX"开头或有特定的二进制标识
                        if file_ext == '.onnx' and (b'ONNX' in header or b'onnx' in header or b'proto' in header):
                            is_valid_model = True
                        # TFLite文件有特定的魔数
                        elif file_ext == '.tflite' and header.startswith(b'TFL3'):
                            is_valid_model = True
                        # .bin文件需要额外检查
                        elif file_ext == '.bin':
                            # 检查是否为常见图像格式
                            is_image = False
                            image_signatures = [
                                b'\xff\xd8\xff',  # JPEG
                                b'\x89\x50\x4e\x47',  # PNG
                                b'GIF',  # GIF
                                b'BM',  # BMP
                                b'\x00\x00\x01\x00'  # ICO
                            ]
                            for sig in image_signatures:
                                if header.startswith(sig):
                                    is_image = True
                                    break
                            
                            if is_image:
                                invalid_paths.append({
                                    'path': path,
                                    'reason': '图片文件不是有效的模型文件'
                                })
                                continue
                            
                            # 简单启发式检查，查找协议缓冲区或模型特征 
                            if (b'proto' in header or b'layer' in header or 
                                b'model' in header or b'weight' in header or 
                                b'tensor' in header):
                                is_valid_model = True
                            else:
                                # 检查文件大小，过小可能不是模型
                                file_size = os.path.getsize(path)
                                if file_size < 10000:  # 小于10KB可能不是模型
                                    invalid_paths.append({
                                        'path': path,
                                        'reason': f'文件过小（{file_size}字节），可能不是有效的模型文件'
                                    })
                                    continue
                                else:
                                    # 大文件假设可能是模型
                                    is_valid_model = True
                except Exception as e:
                    invalid_paths.append({
                        'path': path,
                        'reason': f'模型文件读取错误: {str(e)}'
                    })
                    continue
            else:
                invalid_paths.append({
                    'path': path,
                    'reason': f'不支持的文件类型: {file_ext}，应为.onnx、.bin或.tflite'
                })
                continue
                
            if not is_valid_model:
                invalid_paths.append({
                    'path': path,
                    'reason': '文件不是有效的模型格式'
                })
                
        except Exception as e:
            invalid_paths.append({
                'path': path,
                'reason': f'验证出错: {str(e)}'
            })
    
    if invalid_paths:
        result['valid'] = False
        result['messages'] = invalid_paths
    
    # 返回验证结果
    emit('file_path_validation_result', result)


@socketio.on('translate_text')
def handle_translate_text(data):
    """处理文本翻译请求"""
    try:
        if not translation_manager:
            emit('error', {'message': '翻译服务未初始化'})
            return
        
        # 获取请求参数
        text = data.get('text', '')
        target_language = data.get('target_language')
        source_language = data.get('source_language')
        service = data.get('service')
        
        if not text:
            emit('error', {'message': '未提供要翻译的文本'})
            return
        
        # 执行翻译
        result = translation_manager.translate(
            text=text,
            target_language=target_language,
            source_language=source_language,
            service=service
        )
        
        # 发送翻译结果
        emit('translation_result', result)
        
    except Exception as e:
        app_logger.error(f"翻译文本时出错: {str(e)}", exc_info=True)
        emit('error', {'message': f'翻译失败: {str(e)}'})

@socketio.on('get_translation_config')
def handle_get_translation_config(data=None):
    """获取翻译服务配置"""
    # 添加请求信息日志
    if isinstance(data, dict):
        app_logger.info(f"收到配置请求，包含参数: {data}")
    else:
        app_logger.info(f"收到配置请求，数据类型: {type(data).__name__}")
    
    try:
        # 准备默认响应数据
        default_response = {
            'config': {
                'active_service': 'google',
                'use_streaming_translation': False,
                'services': {
                    'google': {
                        'use_official_api': False,
                        'target_language': 'zh-CN',
                        'source_language': 'auto'
                    }
                }
            },
            'available_services': ['google'],
            'languages': {
                'google': {
                    'en': '英语',
                    'zh-CN': '中文（简体）',
                    'zh-TW': '中文（繁体）',
                    'ja': '日语',
                    'ko': '韩语',
                    'fr': '法语',
                    'de': '德语',
                    'es': '西班牙语',
                    'it': '意大利语',
                    'ru': '俄语'
                }
            },
            'time': int(time.time()) # 添加时间戳
        }
        
        if not translation_manager:
            app_logger.warning('翻译服务未初始化，返回默认配置')
            response_data = default_response
            
            # 如果客户端提供了回调，直接通过回调返回数据
            if callable(data):
                app_logger.info("通过回调返回默认配置")
                data(response_data)
            else:
                app_logger.info("通过事件返回默认配置")
                emit('translation_config', response_data)
            return
        
        # 获取配置和可用服务
        app_logger.debug("从translation_manager获取配置")
        config = translation_manager.get_config()
        if not config:
            app_logger.warning("translation_manager返回的配置为空，使用默认配置")
            config = default_response['config']
            
        app_logger.debug("获取可用翻译服务")
        available_services = translation_manager.get_available_services()
        if not available_services:
            app_logger.warning("未找到可用的翻译服务，使用默认服务")
            available_services = ['google']
        
        # 对于每个可用的服务，获取可用的语言
        languages = {}
        app_logger.debug(f"获取 {len(available_services)} 个翻译服务的语言列表")
        
        # 检查是否有强制刷新标志
        force_refresh = False
        if isinstance(data, dict) and data.get('_t', False):
            force_refresh = True
            app_logger.info("检测到强制刷新请求")
            
        for service in available_services:
            try:
                service_languages = translation_manager.get_available_languages(service)
                if service_languages:
                    languages[service] = service_languages
                    app_logger.debug(f"服务 {service} 有 {len(service_languages)} 种可用语言")
                else:
                    app_logger.warning(f"服务 {service} 返回的语言列表为空，使用默认语言")
                    languages[service] = default_response['languages'].get(service, default_response['languages']['google'])
            except Exception as e:
                app_logger.error(f"获取服务 {service} 语言列表时出错: {str(e)}")
                languages[service] = default_response['languages'].get(service, default_response['languages']['google'])
        
        # 确保至少有一个服务有语言数据
        if not languages or not any(languages.values()):
            app_logger.warning("所有服务的语言列表均为空，使用默认语言列表")
            languages = default_response['languages']
        
        # 发送配置
        response_data = {
            'config': config,
            'available_services': available_services,
            'languages': languages,
            'time': int(time.time()) # 添加时间戳
        }
        
        app_logger.info(f"准备返回配置，语言列表包含 {len(languages)} 个服务")
        
        # 如果客户端提供了回调，直接通过回调返回数据
        # 否则通过事件返回数据
        if callable(data):
            app_logger.info("通过回调返回翻译配置")
            data(response_data)  # 返回完整的response_data而不仅是config
        else:
            app_logger.info("通过事件返回翻译配置")
            emit('translation_config', response_data)
        
    except Exception as e:
        app_logger.error(f"获取翻译配置时出错: {str(e)}", exc_info=True)
        
        # 出错时也返回默认配置而不是错误信息
        default_response = {
            'config': {
                'active_service': 'google',
                'use_streaming_translation': False,
                'services': {
                    'google': {
                        'use_official_api': False,
                        'target_language': 'zh-CN',
                        'source_language': 'auto'
                    }
                }
            },
            'languages': {
                'google': {
                    'en': '英语',
                    'zh-CN': '中文（简体）',
                    'zh-TW': '中文（繁体）',
                    'ja': '日语',
                    'ko': '韩语',
                    'fr': '法语',
                    'de': '德语',
                    'es': '西班牙语',
                    'it': '意大利语',
                    'ru': '俄语'
                }
            },
            'time': int(time.time()) # 添加时间戳
        }
        
        app_logger.warning("由于错误返回默认配置")
        
        if callable(data):
            app_logger.info("通过回调返回默认配置")
            data(default_response)
        else:
            app_logger.info("通过事件返回默认配置")
            emit('translation_config', default_response)
            emit('error', {'message': f'获取翻译配置出错，已使用默认配置: {str(e)}'})

@socketio.on('update_translation_config')
def handle_update_translation_config(data):
    """更新翻译服务配置"""
    try:
        if not translation_manager:
            emit('error', {'message': '翻译服务未初始化'})
            return
        
        # 配置文件路径
        config_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config')
        config_path = os.path.join(config_dir, 'translation_config.json')
        
        # 更新配置
        translation_manager.update_config(data, save_path=config_path)
        
        # 返回更新后的配置
        config = translation_manager.get_config()
        emit('translation_config_updated', {'config': config})
        
    except Exception as e:
        app_logger.error(f"更新翻译配置时出错: {str(e)}", exc_info=True)
        emit('error', {'message': f'更新翻译配置失败: {str(e)}'})

@socketio.on('get_service_stats')
def handle_get_service_stats(data):
    """获取服务统计信息"""
    try:
        if not translation_manager:
            app_logger.error('翻译服务未初始化，无法获取服务状态')
            emit('service_stats', {
                'service': data.get('service', 'unknown'),
                'status': 'error',
                'stats': {
                    'total_requests': 0,
                    'successful_requests': 0,
                    'failed_requests': 0,
                    'average_response_time': 0
                }
            })
            return
        
        service = data.get('service')
        if not service:
            service = translation_manager.config.get('active_service', 'google')
            app_logger.debug(f'未指定服务，使用活跃服务: {service}')
        
        # 获取服务统计信息
        app_logger.debug(f'获取服务统计信息: {service}')
        stats = translation_manager.get_service_stats(service)
        app_logger.debug(f'获取到统计信息: {stats}')
        
        # 确保有默认值，防止空数据
        if not stats:
            stats = {
                'total_requests': 0,
                'successful_requests': 0,
                'failed_requests': 0,
                'average_response_time': 0
            }
        
        # 发送统计信息
        response_data = {
            'service': service,
            'status': 'ok' if stats.get('total_requests', 0) > 0 else 'inactive',
            'stats': stats
        }
        app_logger.debug(f'发送服务统计信息: {response_data}')
        emit('service_stats', response_data)
        
    except Exception as e:
        app_logger.error(f"获取服务统计信息时出错: {str(e)}", exc_info=True)
        # 即使出错也要发送响应，避免客户端超时等待
        emit('service_stats', {
            'service': data.get('service', 'unknown'),
            'status': 'error',
            'error': str(e),
            'stats': {
                'total_requests': 0,
                'successful_requests': 0,
                'failed_requests': 0,
                'average_response_time': 0
            }
        })

@socketio.on('start_translation')
def handle_start_translation():
    """确认实时翻译会话状态"""
    app_logger.debug("收到翻译状态查询请求")
    try:
        if not realtime_handler:
            app_logger.error("实时处理器未初始化")
            emit('error', {'message': '实时处理器未初始化'})
            return
            
        # 始终返回活跃状态
        emit('translation_status', {
            'active': True,
            'message': '实时翻译已启动'
        })
    except Exception as e:
        app_logger.error(f"查询翻译状态时出错: {str(e)}", exc_info=True)
        emit('error', {'message': f'查询翻译状态失败: {str(e)}'})

@socketio.on('get_translation_status')
def handle_get_translation_status(data=None):
    """获取实时翻译会话状态"""
    app_logger.debug("收到获取翻译会话状态请求")
    
    try:
        if not realtime_handler:
            status = {
                'active': False,
                'error': '实时处理器未初始化'
            }
        else:
            is_active = realtime_handler.is_session_active()
            status = {
                'active': is_active,
                'message': '翻译会话正在运行' if is_active else '翻译会话未启动'
            }
            
        # 如果提供了回调函数，通过回调返回
        if callable(data):
            data(status)
        else:
            # 否则通过事件发送
            emit('translation_status', status)
            
    except Exception as e:
        app_logger.error(f"获取翻译会话状态时出错: {str(e)}", exc_info=True)
        error_status = {
            'active': False,
            'error': f'获取翻译会话状态失败: {str(e)}'
        }
        
        if callable(data):
            data(error_status)
        else:
            emit('error', {'message': error_status['error']})

@socketio.on('stop_translation')
def handle_stop_translation():
    """处理停止翻译请求 - 现在仅清空显示"""
    app_logger.debug("收到停止实时翻译请求 - 仅清空显示")
    try:
        # 返回仍处于活跃状态的消息
        emit('translation_status', {
            'active': True,
            'message': '翻译会话已重置'
        })
    except Exception as e:
        app_logger.error(f"停止翻译处理时出错: {str(e)}", exc_info=True)
        emit('error', {'message': f'处理请求失败: {str(e)}'})

@socketio.on('reset_translation_session')
def handle_reset_translation_session():
    """重置实时翻译会话状态(清除缓冲区并重新连接回调)"""
    app_logger.info("收到重置翻译会话状态请求")
    try:
        if not realtime_handler:
            app_logger.error("实时处理器未初始化，无法重置会话")
            emit('error', {'message': '实时处理器未初始化'})
            return
            
        # 首先取消注册回调
        realtime_handler._unregister_stt_callbacks()
        
        # 然后重新注册回调
        realtime_handler._register_stt_callbacks()
        
        app_logger.info("翻译会话已重置")
        
        emit('translation_status', {
            'active': True,
            'message': '会话已重置并保持活跃状态'
        })
    except Exception as e:
        app_logger.error(f"重置翻译会话时出错: {str(e)}", exc_info=True)
        emit('error', {'message': f'重置翻译会话失败: {str(e)}'})

@socketio.on('test_translation')
def handle_test_translation(data):
    """处理测试翻译请求"""
    app_logger.info("收到测试翻译请求")
    try:
        if not realtime_handler:
            app_logger.error("实时处理器未初始化，无法测试翻译")
            emit('error', {'message': '实时处理器未初始化'})
            return
            
        # 发送一个测试消息，确认实时翻译功能正常
        test_message = data.get('message', '这是一条测试消息')
        
        # 模拟一个转录数据结构
        transcript_data = {
            'text': test_message,
            'is_final': True
        }
        
        # 调用实时处理器的处理方法
        realtime_handler._handle_interim_transcript(transcript_data)
        
        # 发送确认消息
        emit('test_translation_result', {
            'success': True,
            'message': '测试翻译请求已处理'
        })
    except Exception as e:
        app_logger.error(f"处理测试翻译请求时出错: {str(e)}", exc_info=True)
        emit('error', {'message': f'测试翻译失败: {str(e)}'})

def main():
    """主函数入口点"""
    # 处理冻结多进程应用程序的兼容性
    freeze_support()
    
    try:
        # 创建必要的目录
        os.makedirs(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'logs'), exist_ok=True)
        
        # 初始化服务
        global stt_service, translation_manager, realtime_handler
        stt_service = create_stt_service()
        translation_manager = create_translation_manager()
        realtime_handler = create_realtime_handler()  # 初始化实时处理器
        
        # 更新日志配置
        update_app_log_settings(stt_service)
        
        # 初始化API路由
        init_translation_routes(app, realtime_handler, socketio)  # 注册翻译API路由，传递socketio实例
        
        # 启动资源监控
        resource_monitor_thread = threading.Thread(target=monitor_resources, daemon=True)
        resource_monitor_thread.start()
        
        # 启动健康检查
        health_check_thread = threading.Thread(target=check_service_health, daemon=True)
        health_check_thread.start()
        
        # 启动Web服务器
        port = 5000
        app_logger.info(f"启动Web服务器，端口: {port}")
        socketio.run(app, host='0.0.0.0', port=port, debug=False, allow_unsafe_werkzeug=True)
    except Exception as e:
        app_logger.error(f"启动时出错: {e}")
        import traceback
        app_logger.error(traceback.format_exc())
        sys.exit(1)

if __name__ == "__main__":
    main()
