import sys
import os
from multiprocessing import freeze_support

# 将当前目录添加到 Python 路径
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, render_template
from flask_socketio import SocketIO, emit
import threading
import json
import base64
import logging
import time
import asyncio
import psutil

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

# 导入 STT 服务
from src.services.stt import STTService


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
    """创建 STT 服务的函数"""
    app_logger.info("初始化 STT 服务...")
    try:
        service = STTService(
            realtime_callback=realtime_text_callback,
            full_sentence_callback=full_sentence_callback
        )
        app_logger.info("STT 服务初始化成功")
        return service
    except Exception as e:
        app_logger.error(f"STT 服务初始化失败: {e}", exc_info=True)
        raise


# 全局 STT 服务实例
stt_service = None


# 路由：主页
@app.route('/')
def index():
    return render_template('index.html')


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

        # 通知客户端我们即将重启
        emit('restart_required', {
            'message': '正在重启应用以应用新配置...',
            'countdown': 5  # 5秒倒计时
        })

        print("配置已更新，准备重启应用...")

        # 使用线程延迟重启，确保消息发送到客户端
        def delayed_restart():
            import time
            import os
            import sys

            # 等待2秒确保客户端收到重启消息
            time.sleep(2)

            print("重启应用程序...")
            # 使用Python的可执行文件路径重新启动脚本
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
            'countdown': 5  # 5秒倒计时
        })

        print("已恢复默认设置，准备重启应用...")

        # 使用线程延迟重启，确保消息发送到客户端
        def delayed_restart():
            import time
            import os
            import sys

            # 等待2秒确保客户端收到重启消息
            time.sleep(2)

            print("重启应用程序...")
            # 使用Python的可执行文件路径重新启动脚本
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


# Socket.IO 事件：接收音频数据
@socketio.on('audio_data')
def handle_audio_data(data):
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
            try:
                success = stt_service.feed_audio(audio_data, sample_rate)
                if not success:
                    app_logger.warning("音频处理失败")
                    socketio.emit('recorder_status', {'ready': stt_service.is_ready()})
            except Exception as e:
                app_logger.error(f"音频处理错误: {e}")
                socketio.emit('recorder_status', {'ready': False})

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


def main():
    """主函数"""
    global stt_service

    try:
        app_logger.info("启动应用程序...")

        # 设置进程优先级（仅在 Windows 上）
        if sys.platform == 'win32':
            try:
                process = psutil.Process()
                process.nice(psutil.HIGH_PRIORITY_CLASS)
                app_logger.info("已设置高进程优先级")
            except Exception as e:
                app_logger.warning(f"设置进程优先级失败: {e}")

        # 创建 STT 服务
        stt_service = create_stt_service()

        # 启动各监控线程
        app_logger.info("启动监控线程...")

        # 资源监控线程
        monitor_thread = threading.Thread(target=monitor_resources, daemon=True)
        monitor_thread.start()

        # 性能指标发送线程
        metrics_thread = threading.Thread(target=send_performance_metrics, daemon=True)
        metrics_thread.start()

        # 健康检查线程
        health_thread = threading.Thread(target=check_service_health, daemon=True)
        health_thread.start()

        # 等待 STT 服务就绪
        app_logger.info("等待 STT 服务就绪...")
        ready_timeout = time.time() + 30  # 30秒超时

        while time.time() < ready_timeout:
            if stt_service.is_ready():
                app_logger.info("STT 服务已就绪")
                break
            time.sleep(1)

        if not stt_service.is_ready():
            app_logger.warning("STT 服务未在预期时间内就绪，但仍将继续启动应用...")

        # 启动 Flask 应用
        app_logger.info("启动 Flask 应用...")
        socketio.run(
            app,
            host='0.0.0.0',
            port=5000,
            debug=False,
            use_reloader=False,  # 禁用重载器以提高性能
            log_output=False  # 禁用 socketio 的日志输出
        )
    except KeyboardInterrupt:
        app_logger.info("收到用户中断，正在关闭应用...")
    except Exception as e:
        app_logger.error(f"应用运行时错误: {e}", exc_info=True)
    finally:
        # 清理资源
        app_logger.info("清理资源...")
        if stt_service:
            try:
                stt_service.shutdown()
                app_logger.info("STT 服务已关闭")
            except Exception as e:
                app_logger.error(f"关闭 STT 服务时出错: {e}")
        app_logger.info("应用程序已退出")


if __name__ == '__main__':
    freeze_support()  # 添加 Windows 多进程支持
    main()
