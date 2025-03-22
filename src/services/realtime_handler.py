"""
实时处理模块。
负责协调语音转文字(STT)和文字翻译服务，实现实时翻译功能。
"""

import logging
from typing import Dict, Any, Optional, Callable, List

# 创建日志记录器
logger = logging.getLogger(__name__)

class RealtimeHandler:
    """
    实时处理器，负责协调STT和翻译服务
    将STT的输出连接到翻译服务，实现实时翻译功能
    """
    
    def __init__(self, stt_service, translation_manager):
        """
        初始化实时处理器
        
        Args:
            stt_service: STT服务实例
            translation_manager: 翻译管理器实例
        """
        self.stt_service = stt_service
        self.translation_manager = translation_manager
        
        # 回调函数字典
        self.callbacks = {
            'on_realtime_translation': [],  # 实时翻译回调
            'on_final_translation': [],     # 最终翻译回调
            'on_error': []                  # 错误回调
        }
        
        # STT回调注册标志
        self._stt_callbacks_registered = False
        
        # 当前会话状态 - 始终为活跃状态
        self.session_active = True
        
        # 初始化时自动注册STT回调
        self._register_stt_callbacks()
        logger.info("实时翻译处理器已初始化，并自动注册STT回调")
        
    def register_callback(self, event_type: str, callback: Callable) -> bool:
        """
        注册回调函数
        
        Args:
            event_type: 事件类型，可以是'on_realtime_translation', 'on_final_translation', 'on_error'
            callback: 回调函数
            
        Returns:
            是否成功注册
        """
        if event_type in self.callbacks:
            self.callbacks[event_type].append(callback)
            logger.debug(f"已注册{event_type}回调函数")
            return True
        else:
            logger.error(f"未知事件类型: {event_type}")
            return False
    
    def unregister_callback(self, event_type: str, callback: Callable) -> bool:
        """
        取消注册回调函数
        
        Args:
            event_type: 事件类型
            callback: 回调函数
            
        Returns:
            是否成功取消注册
        """
        if event_type in self.callbacks and callback in self.callbacks[event_type]:
            self.callbacks[event_type].remove(callback)
            logger.debug(f"已取消注册{event_type}回调函数")
            return True
        else:
            logger.error(f"无法取消注册: 回调函数未找到")
            return False
            
    def _register_stt_callbacks(self):
        """注册STT服务的回调函数"""
        if not self._stt_callbacks_registered:
            # 注册实时转录回调
            self.stt_service.register_callback(
                'on_interim_result', 
                self._handle_realtime_transcript
            )
            
            # 注册最终转录回调
            self.stt_service.register_callback(
                'on_final_result',
                self._handle_final_transcript
            )
            
            self._stt_callbacks_registered = True
            logger.info("已注册STT回调函数")
    
    def _unregister_stt_callbacks(self):
        """取消注册STT服务的回调函数"""
        if self._stt_callbacks_registered:
            # 取消注册实时转录回调
            self.stt_service.unregister_callback(
                'on_interim_result', 
                self._handle_realtime_transcript
            )
            
            # 取消注册最终转录回调
            self.stt_service.unregister_callback(
                'on_final_result',
                self._handle_final_transcript
            )
            
            self._stt_callbacks_registered = False
            logger.info("已取消注册STT回调函数")
    
    def _handle_realtime_transcript(self, transcript_data: Dict[str, Any]):
        """
        处理实时转录结果
        
        Args:
            transcript_data: 转录数据，包含'text'字段
        """
        try:
            # 获取转录文本
            text = transcript_data.get('text', '')
            
            # 如果文本为空，直接返回
            if not text:
                return

            # 直接从翻译管理器获取最新的配置
            config = self.translation_manager.get_config()
            
            # 检查是否启用流式翻译
            if not config.get('use_streaming_translation', False):
                logger.debug(f"已收到实时转录，但未启用逐字翻译: {text}")
                return
                
            # 获取当前活动的服务
            active_service = config.get('active_service', 'google')
            # 获取服务特定配置
            service_config = config.get('services', {}).get(active_service, {})
            
            # 进行逐字翻译
            translation_result = self.translation_manager.translate(
                text=text,
                target_language=service_config.get('target_language', 'zh-CN'),
                source_language=service_config.get('source_language', 'auto'),
                service=active_service
            )
            
            # 构建翻译数据并触发回调
            translation_data = {
                'original_text': text,
                'translated_text': translation_result.get('translated_text', ''),
                'source_language': translation_result.get('detected_language', ''),
                'target_language': service_config.get('target_language', 'zh-CN'),
                'is_final': False,
                'service': translation_result.get('service', active_service)
            }
            
            # 触发回调
            for callback in self.callbacks['on_realtime_translation']:
                try:
                    callback(translation_data)
                except Exception as e:
                    logger.error(f"执行实时翻译回调时出错: {str(e)}")
                    
        except Exception as e:
            logger.error(f"处理实时转录时出错: {str(e)}")
            self._trigger_error(f"实时翻译失败: {str(e)}")
    
    def _handle_final_transcript(self, transcript_data: Dict[str, Any]):
        """
        处理最终转录结果
        
        Args:
            transcript_data: 转录数据，包含'text'字段
        """
        try:
            # 获取转录文本
            text = transcript_data.get('text', '')
            
            # 如果文本为空，直接返回
            if not text:
                return
                
            # 记录详细日志
            logger.info(f"处理最终转录: '{text}'")
                
            # 直接从翻译管理器获取最新的配置
            config = self.translation_manager.get_config()
            
            # 获取当前活动的服务
            active_service = config.get('active_service', 'google')
            # 获取服务特定配置
            service_config = config.get('services', {}).get(active_service, {})
            
            logger.info(f"使用翻译服务: {active_service}, 目标语言: {service_config.get('target_language', 'zh-CN')}")
            
            # 进行翻译
            translation_result = self.translation_manager.translate(
                text=text,
                target_language=service_config.get('target_language', 'zh-CN'),
                source_language=service_config.get('source_language', 'auto'),
                service=active_service
            )
            
            translated_text = translation_result.get('translated_text', '')
            detected_language = translation_result.get('detected_language', '')
            
            logger.info(f"翻译完成: 检测到源语言: {detected_language}")
            logger.info(f"翻译结果: '{translated_text}'")
            
            # 构建翻译数据并触发回调
            translation_data = {
                'original_text': text,
                'translated_text': translated_text,
                'source_language': detected_language,
                'target_language': service_config.get('target_language', 'zh-CN'),
                'is_final': True,
                'service': translation_result.get('service', active_service)
            }
            
            # 触发回调
            logger.debug("准备触发最终翻译回调")
            callbacks_count = len(self.callbacks['on_final_translation'])
            logger.debug(f"已注册的最终翻译回调数量: {callbacks_count}")
            
            for callback in self.callbacks['on_final_translation']:
                try:
                    callback(translation_data)
                    logger.debug("成功执行最终翻译回调")
                except Exception as e:
                    logger.error(f"执行最终翻译回调时出错: {str(e)}")
                    
        except Exception as e:
            logger.error(f"处理最终转录时出错: {str(e)}")
            self._trigger_error(f"最终翻译失败: {str(e)}")
    
    def _trigger_error(self, error_message: str):
        """
        触发错误回调
        
        Args:
            error_message: 错误信息
        """
        error_data = {
            'message': error_message,
            'timestamp': time.time()
        }
        
        # 触发回调
        for callback in self.callbacks['on_error']:
            try:
                callback(error_data)
            except Exception as e:
                logger.error(f"执行错误回调时出错: {str(e)}")
    
    def start_session(self) -> bool:
        """
        开始实时翻译会话
        注册STT回调
        
        Returns:
            是否成功启动
        """
        if not self.session_active:
            self._register_stt_callbacks()
            self.session_active = True
            logger.info("已启动实时翻译会话")
            return True
        else:
            logger.warning("实时翻译会话已经在运行中")
            return False
    
    def stop_session(self) -> bool:
        """
        停止实时翻译会话
        取消注册STT回调
        """
        if self.session_active:
            self._unregister_stt_callbacks()
            self.session_active = False
            logger.info("已停止实时翻译会话")
            return True
        else:
            logger.warning("没有运行中的实时翻译会话")
            return False
    
    def get_translation_config(self) -> Dict[str, Any]:
        """获取当前翻译配置"""
        return self.translation_manager.get_config()
    
    def is_session_active(self) -> bool:
        """检查会话是否活跃 - 始终返回True"""
        return True  # 始终返回True，表示翻译始终处于活跃状态
        
import time  # 为_trigger_error函数导入time模块 