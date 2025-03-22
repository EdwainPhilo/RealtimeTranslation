"""
实时翻译API路由模块。
提供翻译服务相关的HTTP API接口。
"""

import json
import logging
import time
from typing import Dict, Any, Optional, List

from flask import Blueprint, request, jsonify, Response, stream_with_context

# 创建蓝图
translation_bp = Blueprint('translation', __name__)

# 创建日志记录器
logger = logging.getLogger(__name__)

# 全局的实时处理器实例
realtime_handler = None

# 全局的SSE客户端集合
sse_clients = set()

def init_routes(app, _realtime_handler):
    """
    初始化路由
    
    Args:
        app: Flask应用实例
        _realtime_handler: 实时处理器实例
    """
    global realtime_handler
    realtime_handler = _realtime_handler
    
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
    # 将数据转换为JSON字符串
    json_data = json.dumps(data)
    
    # 创建SSE格式的消息
    message = f"event: {event_type}\ndata: {json_data}\n\n"
    
    # 创建一个已关闭客户端的集合，用于后续清理
    closed_clients = set()
    
    # 向所有客户端发送消息
    for client in sse_clients:
        try:
            client['queue'].put(message)
        except Exception as e:
            logger.error(f"向SSE客户端发送消息失败: {str(e)}")
            closed_clients.add(client)
    
    # 移除已关闭的客户端
    for client in closed_clients:
        try:
            sse_clients.remove(client)
        except KeyError:
            pass

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
        config = realtime_handler.get_translation_config()
        
        return jsonify({
            'success': True,
            'config': {
                'target_language': config.get('target_language'),
                'source_language': config.get('source_language'),
                'service': config.get('service')
            }
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
        
        # 准备配置更新
        config_update = {}
        
        if 'target_language' in data:
            config_update['target_language'] = data['target_language']
            
        if 'source_language' in data:
            config_update['source_language'] = data['source_language']
            
        if 'service' in data:
            config_update['service'] = data['service']
        
        # 更新配置
        realtime_handler.update_translation_config(config_update)
        
        return jsonify({
            'success': True
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
        
        # 添加到客户端集合
        sse_clients.add(client)
        
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
            except KeyError:
                pass
    
    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    ) 