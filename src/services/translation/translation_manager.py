"""
翻译服务管理器模块。
负责管理和协调不同的翻译服务。
"""

import logging
import json
import os
from typing import Dict, Any, Optional, List, Union

from .google_translation import GoogleTranslationService

# 创建日志记录器
logger = logging.getLogger(__name__)

class TranslationManager:
    """翻译服务管理器，负责协调各种翻译服务"""
    
    def __init__(self, config_path: Optional[str] = None):
        """
        初始化翻译服务管理器
        
        Args:
            config_path: 配置文件路径，如果提供，将从中加载配置
        """
        # 默认配置
        self.config = {
            'active_service': 'google',  # 默认使用Google翻译
            'use_streaming_translation': False,  # 默认使用段落翻译模式
            'services': {
                'google': {
                    'use_official_api': False,
                    'target_language': 'zh-CN',
                    'source_language': 'auto'
                }
            }
        }
        
        # 从文件加载配置（如果提供）
        if config_path and os.path.exists(config_path):
            self._load_config(config_path)
        
        # 翻译服务实例
        self.services = {}
        
        # 初始化翻译服务
        self._initialize_services()
    
    def _load_config(self, config_path: str) -> None:
        """从文件加载配置"""
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                loaded_config = json.load(f)
                self.config.update(loaded_config)
            logger.info(f"从{config_path}加载了翻译配置")
        except Exception as e:
            logger.error(f"加载翻译配置失败: {str(e)}")
    
    def _save_config(self, config_path: str) -> None:
        """保存配置到文件"""
        try:
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(self.config, f, indent=4, ensure_ascii=False)
            logger.info(f"保存翻译配置到{config_path}")
        except Exception as e:
            logger.error(f"保存翻译配置失败: {str(e)}")
    
    def _initialize_services(self) -> None:
        """初始化翻译服务"""
        # 初始化Google翻译服务
        if 'google' in self.config['services']:
            try:
                self.services['google'] = GoogleTranslationService(
                    config=self.config['services']['google']
                )
                logger.info("已初始化Google翻译服务")
            except Exception as e:
                logger.error(f"初始化Google翻译服务失败: {str(e)}")
        
        # 这里可以初始化其他翻译服务
    
    def translate(self, text: str, target_language: Optional[str] = None, 
                 source_language: Optional[str] = None, 
                 service: Optional[str] = None) -> Dict[str, Any]:
        """
        翻译文本
        
        Args:
            text: 要翻译的文本
            target_language: 目标语言，覆盖默认设置
            source_language: 源语言，覆盖默认设置
            service: 使用的翻译服务，默认使用active_service
            
        Returns:
            翻译结果字典，包含:
                - translated_text: 翻译后的文本
                - detected_language: 检测到的源语言
                - success: 是否成功
                - error: 错误信息（如果有）
                - service: 使用的翻译服务
        """
        # 确定使用的翻译服务
        service_name = service or self.config['active_service']
        
        # 检查服务是否存在
        if service_name not in self.services:
            return {
                'translated_text': text,
                'detected_language': '',
                'success': False,
                'error': f"翻译服务'{service_name}'不可用",
                'service': service_name
            }
        
        # 调用翻译服务
        result = self.services[service_name].translate(
            text, target_language, source_language
        )
        
        # 添加服务信息
        result['service'] = service_name
        
        return result
    
    def get_available_languages(self, service: Optional[str] = None) -> Dict[str, str]:
        """
        获取可用的语言列表
        
        Args:
            service: 使用的翻译服务，默认使用active_service
            
        Returns:
            字典，语言代码到语言名称的映射
        """
        # 确定使用的翻译服务
        service_name = service or self.config['active_service']
        
        # 检查服务是否存在
        if service_name not in self.services:
            logger.error(f"翻译服务'{service_name}'不可用")
            return {}
        
        # 调用翻译服务的语言列表方法
        return self.services[service_name].get_available_languages()
    
    def get_service_stats(self, service: Optional[str] = None) -> Dict[str, Any]:
        """
        获取翻译服务的统计信息
        
        Args:
            service: 使用的翻译服务，默认使用active_service
            
        Returns:
            统计信息字典
        """
        # 确定使用的翻译服务
        service_name = service or self.config['active_service']
        
        # 检查服务是否存在
        if service_name not in self.services:
            logger.error(f"翻译服务'{service_name}'不可用")
            return {}
        
        # 调用翻译服务的统计方法
        return self.services[service_name].get_stats()
    
    def get_config(self) -> Dict[str, Any]:
        """获取当前配置"""
        return self.config
    
    def update_config(self, config: Dict[str, Any], save_path: Optional[str] = None) -> None:
        """
        更新配置
        
        Args:
            config: 新配置，可以是部分配置
            save_path: 如果提供，将配置保存到此路径
        """
        # 更新配置
        if 'active_service' in config:
            self.config['active_service'] = config['active_service']
        
        # 处理流式翻译配置
        if 'use_streaming_translation' in config:
            self.config['use_streaming_translation'] = config['use_streaming_translation']
            logger.info(f"流式翻译模式已设置为: {config['use_streaming_translation']}")
        
        if 'services' in config:
            for service_name, service_config in config['services'].items():
                if service_name not in self.config['services']:
                    self.config['services'][service_name] = {}
                self.config['services'][service_name].update(service_config)
                
                # 如果服务已初始化，更新其配置
                if service_name in self.services:
                    self.services[service_name].update_config(service_config)
        
        # 保存配置（如果提供路径）
        if save_path:
            self._save_config(save_path)
            
        logger.info("已更新翻译管理器配置")
    
    def get_available_services(self) -> List[str]:
        """获取可用的翻译服务列表"""
        return list(self.services.keys())
    
    def set_active_service(self, service: str) -> bool:
        """
        设置活动翻译服务
        
        Args:
            service: 服务名称
            
        Returns:
            是否成功设置
        """
        if service in self.services:
            self.config['active_service'] = service
            logger.info(f"已将活动翻译服务设置为{service}")
            return True
        else:
            logger.error(f"无法设置活动翻译服务：{service}不可用")
            return False 