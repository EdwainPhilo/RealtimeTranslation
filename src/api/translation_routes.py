"""
实时翻译API路由模块。
提供翻译服务相关的HTTP API接口。
"""

import json
import logging
import time
import os
from typing import Dict, Any, Optional, List

from flask import Blueprint, request, jsonify, Response, stream_with_context
# 导入socketio，确保使用全局同一个实例
from flask_socketio import SocketIO

# 创建蓝图
translation_bp = Blueprint('translation', __name__)

# 创建日志记录器
logger = logging.getLogger(__name__)

# 全局的实时处理器实例
realtime_handler = None
# 添加全局socketio变量
socketio = None

# 全局的SSE客户端集合
sse_clients = []  # 改为列表而不是集合

def init_routes(app, _realtime_handler, _socketio=None):
    """
    初始化路由
    
    Args:
        app: Flask应用实例
        _realtime_handler: 实时处理器实例
        _socketio: SocketIO实例
    """
    global realtime_handler, socketio
    realtime_handler = _realtime_handler
    # 设置socketio全局实例
    socketio = _socketio
    
    # 注册蓝图
    app.register_blueprint(translation_bp, url_prefix='/api/translation')
    
    # 注册处理器回调
    if realtime_handler:
        realtime_handler.register_callback('on_realtime_translation', _handle_realtime_translation)
        realtime_handler.register_callback('on_final_translation', _handle_final_translation)
        realtime_handler.register_callback('on_error', _handle_error)
        
        logger.info("已初始化翻译API路由")
    else:
        logger.error("初始化翻译API路由失败：实时处理器未提供")

def _handle_realtime_translation(data: Dict[str, Any]):
    """处理实时翻译结果，发送到所有SSE客户端"""
    _broadcast_event('realtime_translation', data)

def _handle_final_translation(data: Dict[str, Any]):
    """处理最终翻译结果，发送到所有SSE客户端"""
    _broadcast_event('final_translation', data)

def _handle_error(data: Dict[str, Any]):
    """处理错误，发送到所有SSE客户端"""
    _broadcast_event('error_event', data)

def _broadcast_event(event_type: str, data: Dict[str, Any]):
    """
    向所有SSE客户端广播事件
    
    Args:
        event_type: 事件类型
        data: 事件数据
    """
    try:
        # 添加日志信息
        if event_type == 'final_translation':
            logger.info(f"广播最终翻译事件: 原文长度={len(data.get('original_text', ''))}, 翻译长度={len(data.get('translated_text', ''))}")
            logger.debug(f"翻译事件详情: 源语言={data.get('source_language', '未知')}, 目标语言={data.get('target_language', '未知')}")
        elif event_type == 'realtime_translation':
            logger.debug(f"广播实时翻译事件: 原文长度={len(data.get('original_text', ''))}, 翻译长度={len(data.get('translated_text', ''))}")
        elif event_type == 'error_event':
            logger.error(f"广播翻译错误事件: {data.get('message', '未知错误')}")
        else:
            logger.debug(f"广播其他事件: {event_type}")
        
        # 将数据转换为JSON字符串
        json_data = json.dumps(data)
        
        # 创建SSE格式的消息
        message = f"event: {event_type}\ndata: {json_data}\n\n"
        
        # 记录客户端数量
        client_count = len(sse_clients)
        logger.debug(f"当前SSE客户端数量: {client_count}")
        
        if client_count == 0:
            logger.warning(f"没有连接的SSE客户端，{event_type}事件未被发送")
            return
        
        # 创建一个已关闭客户端的列表，用于后续清理
        closed_clients = []
        
        # 向所有客户端发送消息
        for client in sse_clients:
            try:
                client['queue'].put(message)
                logger.debug(f"已向客户端[{client.get('id', '未知')}]发送{event_type}事件")
            except Exception as e:
                logger.error(f"向SSE客户端[{client.get('id', '未知')}]发送消息失败: {str(e)}")
                closed_clients.append(client)
        
        # 移除已关闭的客户端
        for client in closed_clients:
            try:
                sse_clients.remove(client)
                logger.info(f"已移除失效的SSE客户端: {client.get('id', '未知')}")
            except ValueError:
                pass
    except Exception as e:
        logger.error(f"广播事件时出错: {str(e)}", exc_info=True)

# 路由：启动实时翻译
@translation_bp.route('/start', methods=['POST'])
def start_translation():
    """启动实时翻译会话"""
    if not realtime_handler:
        return jsonify({
            'success': False,
            'error': '实时处理器未初始化'
        }), 500
    
    try:
        result = realtime_handler.start_session()
        
        return jsonify({
            'success': result,
            'error': None if result else '实时翻译会话已经在运行中'
        })
    except Exception as e:
        logger.error(f"启动实时翻译会话时出错: {str(e)}")
        return jsonify({
            'success': False,
            'error': f"启动实时翻译会话失败: {str(e)}"
        }), 500

# 路由：停止实时翻译
@translation_bp.route('/stop', methods=['POST'])
def stop_translation():
    """停止实时翻译会话"""
    if not realtime_handler:
        return jsonify({
            'success': False,
            'error': '实时处理器未初始化'
        }), 500
    
    try:
        result = realtime_handler.stop_session()
        
        return jsonify({
            'success': result,
            'error': None if result else '没有运行中的实时翻译会话'
        })
    except Exception as e:
        logger.error(f"停止实时翻译会话时出错: {str(e)}")
        return jsonify({
            'success': False,
            'error': f"停止实时翻译会话失败: {str(e)}"
        }), 500

# 路由：获取翻译配置
@translation_bp.route('/config', methods=['GET'])
def get_translation_config():
    """获取当前翻译配置"""
    if not realtime_handler:
        return jsonify({
            'success': False,
            'error': '实时处理器未初始化'
        }), 500
    
    try:
        # 从翻译管理器获取完整配置
        config = realtime_handler.translation_manager.get_config()
        
        # 获取所有可用翻译服务
        services = realtime_handler.translation_manager.get_available_services()
        
        # 始终刷新语言列表，确保获取到最新数据
        languages = {}
        for service in services:
            try:
                logger.info(f"正在刷新服务 {service} 的可用语言列表")
                service_languages = realtime_handler.translation_manager.get_available_languages(service)
                languages[service] = service_languages
                logger.info(f"服务 {service} 有 {len(service_languages)} 种可用语言")
            except Exception as e:
                logger.error(f"获取服务 {service} 语言列表时出错: {str(e)}")
                languages[service] = {}
        
        return jsonify({
            'success': True,
            'config': config,
            'languages': languages
        })
    except Exception as e:
        logger.error(f"获取翻译配置时出错: {str(e)}")
        return jsonify({
            'success': False,
            'error': f"获取翻译配置失败: {str(e)}"
        }), 500

# 路由：更新翻译配置
@translation_bp.route('/config', methods=['POST'])
def update_translation_config():
    """更新翻译配置"""
    if not realtime_handler:
        return jsonify({
            'success': False,
            'error': '实时处理器未初始化'
        }), 500
    
    try:
        # 从请求中获取配置
        data = request.json
        
        # 直接从翻译管理器获取配置文件路径
        config_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'config')
        config_path = os.path.join(config_dir, 'translation_config.json')
        
        # 直接通过翻译管理器更新配置
        realtime_handler.translation_manager.update_config(data, save_path=config_path)
        
        return jsonify({
            'success': True,
            'config': realtime_handler.translation_manager.get_config()
        })
    except Exception as e:
        logger.error(f"更新翻译配置时出错: {str(e)}")
        return jsonify({
            'success': False,
            'error': f"更新翻译配置失败: {str(e)}"
        }), 500

# 路由：获取可用翻译服务
@translation_bp.route('/services', methods=['GET'])
def get_translation_services():
    """获取可用的翻译服务列表"""
    if not realtime_handler:
        return jsonify({
            'success': False,
            'error': '实时处理器未初始化'
        }), 500
    
    try:
        # 通过翻译管理器获取可用服务
        services = realtime_handler.translation_manager.get_available_services()
        
        return jsonify({
            'success': True,
            'services': services
        })
    except Exception as e:
        logger.error(f"获取翻译服务列表时出错: {str(e)}")
        return jsonify({
            'success': False,
            'error': f"获取翻译服务列表失败: {str(e)}"
        }), 500

# 路由：获取可用语言
@translation_bp.route('/languages', methods=['GET'])
def get_translation_languages():
    """获取可用的语言列表"""
    if not realtime_handler:
        return jsonify({
            'success': False,
            'error': '实时处理器未初始化'
        }), 500
    
    try:
        # 通过翻译管理器获取可用语言
        service = request.args.get('service', None)
        languages = realtime_handler.translation_manager.get_available_languages(service)
        
        return jsonify({
            'success': True,
            'languages': languages
        })
    except Exception as e:
        logger.error(f"获取语言列表时出错: {str(e)}")
        return jsonify({
            'success': False,
            'error': f"获取语言列表失败: {str(e)}"
        }), 500

# 路由：获取SSE事件流
@translation_bp.route('/stream', methods=['GET'])
def stream():
    """提供SSE实时事件流接口"""
    import queue
    
    def event_stream():
        """SSE事件流生成器"""
        # 创建一个队列用于存放事件
        client_queue = queue.Queue()
        
        # 创建客户端对象
        client = {
            'id': time.time(),
            'queue': client_queue
        }
        
        # 添加到客户端列表
        sse_clients.append(client)
        logger.info(f"SSE客户端已连接: {client['id']}")
        
        # 发送连接成功消息
        client_queue.put(f"event: connected\ndata: {json.dumps({'success': True})}\n\n")
        
        try:
            # 循环发送事件
            while True:
                message = client_queue.get(timeout=30)  # 30秒超时
                yield message
        except:
            pass
        finally:
            # 移除客户端
            try:
                sse_clients.remove(client)
                logger.debug(f"SSE客户端已断开连接: {client['id']}")
            except ValueError:
                pass
    
    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )

def handle_get_translation_config(data=None):
    """
    获取翻译配置
    
    Args:
        data: 客户端传递的数据或回调函数
    """
    # 记录请求信息
    logger.info(f"接收到获取翻译配置请求: data类型={type(data).__name__}")
    
    # 检查socketio是否可用
    global socketio
    if socketio is None:
        logger.error("socketio实例未初始化，无法通过事件返回数据")
        # 仍然可以通过回调返回数据
        if callable(data):
            # 创建默认配置用于返回
            default_result = {
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
                }
            }
            logger.warning("由于socketio不可用，只能通过回调返回默认配置")
            data(default_result)
        return
    
    # 默认配置和语言列表，确保在任何情况下都有数据返回
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
    
    default_languages = {
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
    }
    
    # 准备默认结果
    default_result = {
        'config': default_config,
        'languages': default_languages
    }
    
    try:
        # 检查是否有回调函数
        is_callback = callable(data)
        logger.info(f"是否有回调函数: {is_callback}")
        
        # 获取完整配置
        if not realtime_handler or not realtime_handler.translation_manager:
            logger.warning("翻译管理器未初始化，返回默认配置")
            result = default_result
            
            # 检查是否需要通过回调返回
            if is_callback:
                logger.info("通过回调返回默认配置")
                data(result)
            else:
                # 发送翻译配置事件 - 注意：不使用命名空间，确保与前端一致
                logger.info("通过事件返回默认配置，不使用命名空间")
                socketio.emit('translation_config', result)
            return
        
        # 获取基本配置
        config = realtime_handler.translation_manager.get_config()
        if not config:
            logger.warning("获取到的配置为空，使用默认配置")
            config = default_config
        
        # 获取可用服务
        try:
            services = realtime_handler.translation_manager.get_available_services()
            if not services:
                logger.warning("获取到的服务列表为空，使用默认服务")
                services = ['google']
        except Exception as e:
            logger.error(f"获取可用服务列表时出错: {str(e)}")
            services = ['google']
        
        # 获取每个服务的可用语言
        languages = {}
        for service in services:
            try:
                # 检查是否有强制刷新标志
                force_refresh = False
                if isinstance(data, dict) and data.get('_t', False):
                    force_refresh = True
                    logger.info(f"强制刷新服务 {service} 的可用语言列表")
                
                # 获取语言列表，如果出错则使用默认列表
                service_languages = realtime_handler.translation_manager.get_available_languages(service)
                if not service_languages:
                    logger.warning(f"服务 {service} 的语言列表为空，使用默认列表")
                    service_languages = default_languages.get(service, {})
                
                languages[service] = service_languages
                logger.info(f"服务 {service} 有 {len(service_languages)} 种可用语言")
            except Exception as e:
                logger.error(f"获取服务 {service} 语言列表时出错: {str(e)}")
                languages[service] = default_languages.get(service, {})
        
        # 确保至少有一个服务有语言数据
        if not any(languages.values()):
            logger.warning("所有服务的语言列表均为空，使用默认语言列表")
            languages = default_languages
        
        # 组合结果
        result = {
            'config': config,
            'languages': languages,
            'time': int(time.time())  # 添加时间戳，方便客户端判断新鲜度
        }
        
        # 记录完整的返回数据
        logger.info(f"准备返回翻译配置: 配置长度={len(str(config))}, 语言列表个数={len(languages)}")
        
        # 检查是否需要通过回调返回
        if is_callback:
            logger.info("通过回调返回翻译配置")
            data(result)
        else:
            # 发送翻译配置事件，不使用命名空间，确保与前端一致
            logger.info("通过事件返回翻译配置，不使用命名空间")
            socketio.emit('translation_config', result)
    except Exception as e:
        logger.error(f"获取翻译配置时出错: {str(e)}", exc_info=True)
        
        # 出错时也返回默认配置
        logger.warning("由于错误返回默认配置")
        
        # 确保回调函数被调用
        if callable(data):
            logger.info("通过回调返回默认配置（错误处理）")
            data(default_result)
        else:
            # 发送事件，不使用命名空间，确保与前端一致
            logger.info("通过事件返回默认配置（错误处理），不使用命名空间")
            if socketio:
                socketio.emit('translation_config', default_result)
                socketio.emit('error', {'message': f'获取翻译配置出错，已使用默认配置: {str(e)}'})
            else:
                logger.error("socketio实例未初始化，无法通过事件返回错误信息")