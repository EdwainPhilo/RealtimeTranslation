"""
Google翻译服务模块。
提供使用Google Translate进行文本翻译的功能。
支持官方API和非官方库两种方式。
"""

import logging
import time
import os
from typing import Dict, Any, Optional, Union

# 尝试导入Google官方翻译API
try:
    from google.cloud import translate_v2 as google_translate_v2
    from google.cloud import translate_v3 as google_translate_v3
    from google.oauth2 import service_account
    GOOGLE_OFFICIAL_API_AVAILABLE = True
except ImportError:
    GOOGLE_OFFICIAL_API_AVAILABLE = False
    logging.warning("Google Cloud Translation API不可用，将使用非官方API")

# 尝试导入非官方Google翻译API
try:
    import googletrans
    from googletrans import Translator
    GOOGLETRANS_AVAILABLE = True
except ImportError:
    GOOGLETRANS_AVAILABLE = False
    logging.warning("googletrans库不可用，请安装: pip install googletrans==4.0.0-rc1")

# 创建日志记录器
logger = logging.getLogger(__name__)

class GoogleTranslationService:
    """Google翻译服务类，支持官方API和非官方库"""
    
    def __init__(self, config: Dict[str, Any] = None):
        """
        初始化Google翻译服务
        
        Args:
            config: 配置字典，包括:
                - api_key: Google API密钥（官方API方式）
                - credentials_file: Google凭证文件路径（官方API方式）
                - use_official_api: 是否使用官方API，默认False
                - target_language: 目标语言，默认'zh-CN'
                - source_language: 源语言，默认'auto'（自动检测）
                - proxy: HTTP代理设置，格式为"http://host:port"或"socks5://host:port"
        """
        self.config = config or {}
        self.use_official_api = self.config.get('use_official_api', False)
        self.target_language = self.config.get('target_language', 'zh-CN')
        self.source_language = self.config.get('source_language', 'auto')
        self.proxy = self.config.get('proxy', None)
        
        # 如果指定了代理，设置环境变量
        self._setup_proxy()
        
        # 翻译客户端
        self.official_client = None
        self.unofficial_client = None
        
        # 初始化翻译客户端
        self._initialize_client()
        
        # 统计信息
        self.stats = {
            'total_requests': 0,
            'successful_requests': 0,
            'failed_requests': 0,
            'total_chars_translated': 0,
            'last_request_time': 0,
            'average_response_time': 0
        }
    
    def _setup_proxy(self):
        """设置HTTP代理"""
        proxy = self.proxy
        if not proxy:
            # 检查环境变量中是否有代理设置
            proxy = os.environ.get('HTTP_PROXY') or os.environ.get('HTTPS_PROXY')
        
        if proxy:
            logger.info(f"使用代理: {proxy}")
            
            # 设置环境变量，这会影响requests和httpx等库
            os.environ['HTTP_PROXY'] = proxy
            os.environ['HTTPS_PROXY'] = proxy
            
            # 如果使用的是官方API，需要额外设置
            if self.use_official_api and GOOGLE_OFFICIAL_API_AVAILABLE:
                # Google Cloud库使用环境变量: HTTPS_PROXY
                pass
    
    def _initialize_client(self):
        """初始化翻译客户端"""
        if self.use_official_api and GOOGLE_OFFICIAL_API_AVAILABLE:
            try:
                # 使用官方API
                credentials_file = self.config.get('credentials_file')
                if credentials_file:
                    # 使用服务账号凭证
                    credentials = service_account.Credentials.from_service_account_file(
                        credentials_file
                    )
                    self.official_client = google_translate_v2.Client(credentials=credentials)
                else:
                    # 使用环境变量中的凭证
                    self.official_client = google_translate_v2.Client()
                
                logger.info("已初始化Google官方翻译API客户端")
            except Exception as e:
                logger.error(f"初始化Google官方翻译API客户端失败: {str(e)}")
                self.use_official_api = False
        
        # 如果官方API不可用或未配置，尝试使用非官方库
        if (not self.use_official_api or not self.official_client) and GOOGLETRANS_AVAILABLE:
            try:
                # 检查googletrans版本
                version = getattr(googletrans, '__version__', '3.0.0')
                logger.info(f"使用googletrans版本: {version}")
                
                # 初始化翻译器
                self.unofficial_client = Translator()
                
                # 尝试简单翻译测试连接
                test_result = None
                try:
                    if version.startswith('3.') or version.startswith('4.'):
                        # 异步版本测试
                        import asyncio
                        
                        async def test_translate():
                            return await self.unofficial_client.translate('hello', dest='zh-CN')
                        
                        try:
                            # 首先尝试获取或创建循环
                            try:
                                loop = asyncio.get_event_loop()
                                if loop.is_closed():
                                    loop = asyncio.new_event_loop()
                                    asyncio.set_event_loop(loop)
                            except RuntimeError:
                                loop = asyncio.new_event_loop()
                                asyncio.set_event_loop(loop)
                            
                            # 不关闭循环，让它可以在后续的翻译操作中重用
                            if loop.is_running():
                                # 如果循环正在运行，使用线程
                                import concurrent.futures
                                with concurrent.futures.ThreadPoolExecutor() as executor:
                                    future = executor.submit(lambda: asyncio.run(test_translate()))
                                    test_result = future.result()
                            else:
                                test_result = loop.run_until_complete(test_translate())
                        except Exception as e:
                            # 测试失败时，尝试使用asyncio.run
                            logger.warning(f"常规事件循环测试失败: {e}, 尝试使用asyncio.run")
                            test_result = asyncio.run(test_translate())
                    else:
                        # 同步版本测试
                        test_result = self.unofficial_client.translate('hello', dest='zh-CN')
                        
                    if test_result and hasattr(test_result, 'text'):
                        logger.info(f"非官方翻译API测试成功: hello -> {test_result.text}")
                    else:
                        logger.warning("非官方翻译API测试未返回预期结果")
                except Exception as e:
                    logger.warning(f"非官方翻译API测试失败: {str(e)}")
                
                logger.info("已初始化Google非官方翻译API客户端")
            except Exception as e:
                logger.error(f"初始化Google非官方翻译API客户端失败: {str(e)}")
                self.unofficial_client = None
    
    def translate(self, text: str, target_language: Optional[str] = None, 
                 source_language: Optional[str] = None) -> Dict[str, Any]:
        """
        翻译文本
        
        Args:
            text: 要翻译的文本
            target_language: 目标语言，默认使用初始化时的设置
            source_language: 源语言，默认使用初始化时的设置或自动检测
        
        Returns:
            字典，包含:
                - translated_text: 翻译后的文本
                - detected_language: 检测到的源语言（如果源语言为auto）
                - success: 是否成功
                - error: 错误信息（如果有）
        """
        if not text:
            return {
                'translated_text': '',
                'detected_language': '',
                'success': True,
                'error': None
            }
            
        # 更新统计信息
        self.stats['total_requests'] += 1
        self.stats['total_chars_translated'] += len(text)
        start_time = time.time()
        
        # 使用指定的语言或默认语言
        target = target_language or self.target_language
        source = source_language or self.source_language
        
        result = {
            'translated_text': '',
            'detected_language': '',
            'success': False,
            'error': None
        }
        
        try:
            # 检查是否有可用的翻译客户端
            if not self._has_available_client():
                raise Exception("没有可用的翻译客户端，请确保已安装相关依赖。运行 python install/install_translation_deps.py 安装依赖。")
                
            # 使用官方API
            if self.use_official_api and self.official_client:
                translation = self._translate_with_official_api(text, target, source)
                result.update(translation)
            # 使用非官方库
            elif self.unofficial_client:
                translation = self._translate_with_unofficial_api(text, target, source)
                result.update(translation)
            else:
                raise Exception("没有可用的翻译客户端")
                
            # 标记成功
            result['success'] = True
            self.stats['successful_requests'] += 1
            
        except Exception as e:
            logger.error(f"翻译失败: {str(e)}")
            result['error'] = str(e)
            
            # 尝试使用备选翻译库
            try:
                logger.info("尝试使用备选翻译库...")
                fallback_result = self._try_fallback_translators(text, target, source)
                if fallback_result:
                    result.update(fallback_result)
                    result['success'] = True
                    self.stats['successful_requests'] += 1
                    logger.info("备选翻译成功")
                else:
                    self.stats['failed_requests'] += 1
            except Exception as fallback_e:
                logger.error(f"备选翻译失败: {str(fallback_e)}")
                result['error'] = f"{str(e)}（备选翻译也失败: {str(fallback_e)}）"
                self.stats['failed_requests'] += 1
        
        # 更新响应时间统计
        end_time = time.time()
        response_time = end_time - start_time
        self.stats['last_request_time'] = response_time
        
        # 计算平均响应时间
        if self.stats['successful_requests'] > 1:
            prev_avg = self.stats['average_response_time']
            prev_count = self.stats['successful_requests'] - 1
            self.stats['average_response_time'] = (prev_avg * prev_count + response_time) / self.stats['successful_requests']
        else:
            self.stats['average_response_time'] = response_time
        
        return result
    
    def _translate_with_official_api(self, text, target, source):
        """使用官方API翻译"""
        if source == 'auto':
            # 自动检测源语言
            result = self.official_client.translate(
                text, target_language=target
            )
        else:
            result = self.official_client.translate(
                text, target_language=target, source_language=source
            )
        
        return {
            'translated_text': result['translatedText'],
            'detected_language': result.get('detectedSourceLanguage', source)
        }
    
    def _translate_with_unofficial_api(self, text, target, source):
        """使用非官方库翻译"""
        try:
            # 获取googletrans的版本
            version = getattr(googletrans, '__version__', '3.0.0')
            
            if version.startswith('3.') or version.startswith('4.'):
                # 新版本可能是异步API
                import asyncio
                
                async def async_translate():
                    if source == 'auto':
                        # 自动检测源语言
                        result = await self.unofficial_client.translate(text, dest=target)
                    else:
                        result = await self.unofficial_client.translate(text, src=source, dest=target)
                    return result
                
                # 使用更安全的方式运行异步任务
                try:
                    # 安全地获取或创建事件循环
                    try:
                        # 尝试获取当前事件循环
                        loop = asyncio.get_event_loop()
                    except RuntimeError:
                        # 如果没有当前事件循环，创建一个新的
                        loop = asyncio.new_event_loop()
                        asyncio.set_event_loop(loop)
                    
                    # 检查循环是否已关闭
                    if loop.is_closed():
                        logger.warning("原事件循环已关闭，创建新循环")
                        loop = asyncio.new_event_loop()
                        asyncio.set_event_loop(loop)
                    
                    # 直接在当前循环中运行协程，不关闭循环
                    if loop.is_running():
                        # 如果循环正在运行，在已有的循环中运行协程
                        # 为了同步运行结果，我们使用线程来封装异步调用
                        import concurrent.futures
                        with concurrent.futures.ThreadPoolExecutor() as executor:
                            future = executor.submit(lambda: asyncio.run(async_translate()))
                            result = future.result()
                    else:
                        # 如果循环没有运行，直接运行协程
                        result = loop.run_until_complete(async_translate())
                    
                    return {
                        'translated_text': result.text,
                        'detected_language': result.src
                    }
                except Exception as e:
                    logger.error(f"异步翻译失败: {str(e)}")
                    
                    # 尝试使用asyncio.run作为后备方案
                    try:
                        logger.info("尝试使用asyncio.run作为后备方案")
                        # 这将创建新的事件循环并在完成后关闭它
                        result = asyncio.run(async_translate())
                        return {
                            'translated_text': result.text,
                            'detected_language': result.src
                        }
                    except Exception as e2:
                        logger.error(f"后备翻译方案失败: {str(e2)}")
                        raise Exception(f"所有翻译尝试均失败: {str(e)} -> {str(e2)}")
            else:
                # 老版本是同步API
                if source == 'auto':
                    # 自动检测源语言
                    result = self.unofficial_client.translate(text, dest=target)
                else:
                    result = self.unofficial_client.translate(text, src=source, dest=target)
                
                return {
                    'translated_text': result.text,
                    'detected_language': result.src
                }
        except Exception as e:
            logger.error(f"非官方API翻译失败: {str(e)}")
            raise Exception(f"翻译失败: {str(e)}")
    
    def _try_fallback_translators(self, text, target, source):
        """尝试使用备选翻译库"""
        # 尝试使用deep-translator
        try:
            import importlib
            
            # 尝试deep-translator
            try:
                deep_translator = importlib.import_module('deep_translator')
                google_translator = getattr(deep_translator, 'GoogleTranslator')
                
                # 调整源语言和目标语言格式以适应deep-translator
                src = 'auto' if source == 'auto' else source.split('-')[0]
                tgt = target.split('-')[0]
                
                translator = google_translator(source=src, target=tgt)
                result = translator.translate(text)
                
                return {
                    'translated_text': result,
                    'detected_language': src if src != 'auto' else 'auto-detected'
                }
            except (ImportError, AttributeError, Exception) as e:
                logger.warning(f"deep-translator失败: {str(e)}")
            
            # 尝试translate库
            try:
                translate = importlib.import_module('translate')
                translator = translate.Translator(to_lang=target.split('-')[0])
                result = translator.translate(text)
                
                return {
                    'translated_text': result,
                    'detected_language': 'auto-detected'
                }
            except (ImportError, AttributeError, Exception) as e:
                logger.warning(f"translate库失败: {str(e)}")
                
        except Exception as e:
            logger.error(f"所有备选翻译库均失败: {str(e)}")
            
        return None
    
    def get_available_languages(self) -> Dict[str, str]:
        """
        获取可用的语言列表
        
        Returns:
            字典，语言代码到语言名称的映射
        """
        languages = {}
        
        try:
            if self.use_official_api and self.official_client:
                # 使用官方API获取语言列表
                results = self.official_client.get_languages()
                for language in results:
                    languages[language['language']] = language['name']
            elif GOOGLETRANS_AVAILABLE:
                # 使用非官方API的语言列表
                languages = googletrans.LANGUAGES
            
            logger.info(f"获取到{len(languages)}种可用语言")
        except Exception as e:
            logger.error(f"获取语言列表失败: {str(e)}")
        
        return languages
    
    def get_stats(self) -> Dict[str, Any]:
        """获取翻译服务的统计信息"""
        return self.stats
    
    def update_config(self, config: Dict[str, Any]) -> None:
        """
        更新配置
        
        Args:
            config: 新的配置字典
        """
        # 更新配置
        self.config.update(config)
        
        # 更新核心设置
        if 'use_official_api' in config:
            self.use_official_api = config['use_official_api']
        if 'target_language' in config:
            self.target_language = config['target_language']
        if 'source_language' in config:
            self.source_language = config['source_language']
        if 'proxy' in config:
            self.proxy = config['proxy']
            
        # 重新初始化客户端
        self._initialize_client()
        
        logger.info("已更新Google翻译服务配置")
    
    def _has_available_client(self) -> bool:
        """检查是否有可用的翻译客户端"""
        return self.official_client is not None or self.unofficial_client is not None
    
    @staticmethod
    def install_deps():
        """安装必要的依赖"""
        import subprocess
        import sys
        
        print("正在安装Google翻译所需依赖...")
        
        # 安装非官方API
        try:
            subprocess.check_call([
                sys.executable, "-m", "pip", "install", "googletrans==4.0.0-rc1"
            ])
            print("✓ 已安装googletrans")
        except subprocess.CalledProcessError:
            print("✗ 安装googletrans失败")
            
        # 安装官方API
        try:
            subprocess.check_call([
                sys.executable, "-m", "pip", "install", "google-cloud-translate==2.0.1"
            ])
            print("✓ 已安装google-cloud-translate")
        except subprocess.CalledProcessError:
            print("✗ 安装google-cloud-translate失败")
            
        print("依赖安装完成。重启应用以应用更改。") 