"""
Google翻译服务模块。
提供使用Google Translate进行文本翻译的功能。
支持官方API和非官方库两种方式。
"""

import logging
import time
import os
import asyncio
import concurrent.futures
import re  # 添加正则表达式支持
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

# 辅助函数：在新的事件循环中运行异步函数
def run_async_in_new_loop(async_func, *args, **kwargs):
    """
    在新事件循环中运行异步函数，带有超时控制和完整的资源清理
    
    Args:
        async_func: 要运行的异步函数
        *args, **kwargs: 传递给函数的参数
    
    Returns:
        异步函数的结果
    """
    # 获取超时时间，默认10秒
    timeout = kwargs.pop('_timeout', 10.0)
    
    # 创建新的事件循环
    new_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(new_loop)
    
    # 创建一个任务
    task = None
    
    try:
        # 带超时的协程
        async def run_with_timeout():
            # 添加超时控制
            return await asyncio.wait_for(async_func(*args, **kwargs), timeout=timeout)
        
        # 运行任务
        task = new_loop.create_task(run_with_timeout())
        return new_loop.run_until_complete(task)
    
    except asyncio.TimeoutError as e:
        logger.error(f"异步任务超时（{timeout}秒）: {str(e)}")
        if task and not task.done():
            task.cancel()
        raise Exception(f"翻译超时，请稍后重试")
    
    except Exception as e:
        logger.error(f"在新事件循环中运行异步函数失败: {str(e)}")
        if task and not task.done():
            task.cancel()
        raise
    
    finally:
        # 正确清理资源
        try:
            # 取消所有未完成的任务
            pending = asyncio.all_tasks(new_loop) if hasattr(asyncio, 'all_tasks') else []
            for pending_task in pending:
                pending_task.cancel()
            
            # 给任务一个机会完成取消
            if pending:
                new_loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
            
            # 停止事件循环
            new_loop.run_until_complete(new_loop.shutdown_asyncgens())
            new_loop.close()
        except Exception as cleanup_error:
            logger.warning(f"清理事件循环资源时发生错误: {str(cleanup_error)}")

class GoogleTranslationService:
    """Google翻译服务类，支持官方API和非官方库"""
    
    def __init__(self, config=None):
        """
        初始化Google翻译服务
        
        Args:
            config: 配置字典，可包含:
                - use_official_api: 是否使用官方API
                - api_key: API密钥（官方API需要）
                - credentials_file: 凭据文件路径（官方API需要）
                - project_id: 项目ID（官方API需要）
                - proxy: 代理设置
        """
        # 默认配置
        self.config = {
            'use_official_api': False,
            'api_key': None,
            'credentials_file': None,
            'project_id': None,
            'proxy': None,
            'max_text_length': 5000,  # 添加最大文本长度限制，避免API崩溃
            'max_repeated_chars': 10  # 添加最大重复字符数限制
        }
        
        # 更新配置
        if config:
            self.config.update(config)
        
        # 初始化客户端
        self.official_client = None
        self.unofficial_client = None
        
        # 统计信息
        self.stats = {
            'successful_requests': 0,
            'failed_requests': 0,
            'last_request_time': 0,
            'average_response_time': 0
        }
        
        # 初始化翻译客户端
        self._initialize_client()
    
    def _setup_proxy(self):
        """设置HTTP代理"""
        proxy = self.config.get('proxy', None)
        if not proxy:
            # 检查环境变量中是否有代理设置
            proxy = os.environ.get('HTTP_PROXY') or os.environ.get('HTTPS_PROXY')
        
        if proxy:
            logger.info(f"使用代理: {proxy}")
            
            # 设置环境变量，这会影响requests和httpx等库
            os.environ['HTTP_PROXY'] = proxy
            os.environ['HTTPS_PROXY'] = proxy
            
            # 如果使用的是官方API，需要额外设置
            if self.config['use_official_api'] and GOOGLE_OFFICIAL_API_AVAILABLE:
                # Google Cloud库使用环境变量: HTTPS_PROXY
                pass
    
    def _initialize_client(self):
        """初始化翻译客户端"""
        if self.config['use_official_api'] and GOOGLE_OFFICIAL_API_AVAILABLE:
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
                self.config['use_official_api'] = False
        
        # 如果官方API不可用或未配置，尝试使用非官方库
        if (not self.config['use_official_api'] or not self.official_client) and GOOGLETRANS_AVAILABLE:
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
                                with concurrent.futures.ThreadPoolExecutor() as executor:
                                    future = executor.submit(lambda: run_async_in_new_loop(test_translate))
                                    test_result = future.result()
                            else:
                                test_result = loop.run_until_complete(test_translate())
                        except Exception as e:
                            # 测试失败时，尝试使用新事件循环
                            logger.warning(f"常规事件循环测试失败: {e}, 尝试使用新事件循环")
                            test_result = run_async_in_new_loop(test_translate)
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
    
    def translate(self, text, target_language=None, source_language=None):
        """
        翻译文本
        
        Args:
            text: 要翻译的文本
            target_language: 目标语言
            source_language: 源语言，默认为auto（自动检测）
            
        Returns:
            翻译结果字典
        """
        # 记录开始时间，用于计算响应时间
        start_time = time.time()
        
        # 初始化结果字典
        result = {
            'translated_text': '',
            'detected_language': '',
            'success': False,
            'error': None
        }
        
        # 如果文本为空，直接返回空结果
        if not text or text.strip() == '':
            result['success'] = True
            return result
            
        # 预处理文本，处理异常模式
        processed_text, was_processed = self._preprocess_text(text)
        if was_processed:
            logger.info(f"文本已预处理: 原始长度={len(text)}，处理后长度={len(processed_text)}")
        
        # 使用服务配置中的目标语言和源语言（如果未提供）
        target = target_language or self.config.get('target_language', 'en')
        source = source_language or self.config.get('source_language', 'auto')
        
        try:
            # 检查是否有可用的翻译客户端
            if not self._has_available_client():
                raise Exception("没有可用的翻译客户端，请确保已安装相关依赖。运行 python install/install_translation_deps.py 安装依赖。")
                
            # 使用官方API
            if self.config['use_official_api'] and self.official_client:
                translation = self._translate_with_official_api(processed_text, target, source)
                result.update(translation)
            # 使用非官方库
            elif self.unofficial_client:
                translation = self._translate_with_unofficial_api(processed_text, target, source)
                result.update(translation)
            else:
                raise Exception("没有可用的翻译客户端")
                
            # 标记成功
            result['success'] = True
            self.stats['successful_requests'] += 1
            
        except Exception as e:
            logger.error(f"翻译失败: {str(e)}")
            result['error'] = str(e)
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
    
    def _preprocess_text(self, text):
        """
        预处理文本，处理异常模式如大量重复字符
        
        Args:
            text: 原始文本
            
        Returns:
            (处理后的文本, 是否进行了处理)
        """
        original_text = text
        was_processed = False
        
        # 检查文本长度，如果超过最大长度则截断
        max_length = self.config.get('max_text_length', 5000)
        if len(text) > max_length:
            text = text[:max_length]
            was_processed = True
            logger.warning(f"文本过长，已截断至{max_length}字符")
        
        # 处理重复字符模式 (如 "小小小小小小小小小...")
        max_repeats = self.config.get('max_repeated_chars', 10)
        
        # 检测连续相同字符
        repeated_char_pattern = re.compile(r'(.)\1{' + str(max_repeats) + ',}')
        match = repeated_char_pattern.search(text)
        
        if match:
            # 找到重复字符，将其限制为最大允许重复次数
            char = match.group(1)
            text = re.sub(r'(' + re.escape(char) + r')\1{' + str(max_repeats) + ',}', 
                         char * max_repeats, text)
            was_processed = True
            logger.warning(f"检测到异常重复字符模式，已处理")
        
        return text, was_processed
    
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
        """使用非官方库翻译，具有多重后备机制"""
        try:
            # 获取googletrans的版本
            version = getattr(googletrans, '__version__', '3.0.0')
            
            if version.startswith('3.') or version.startswith('4.'):
                # 直接使用同步HTTP请求作为首选方法，这是最稳定的
                try:
                    logger.info("使用直接HTTP请求进行翻译")
                    
                    # 使用httpx直接请求谷歌翻译API
                    import httpx
                    import urllib.parse
                    
                    # 转义文本
                    escaped_text = urllib.parse.quote(text)
                    
                    # 构建URL
                    url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl={source}&tl={target}&dt=t&q={escaped_text}"
                    
                    # 使用同步请求
                    with httpx.Client() as client:
                        response = client.get(url, timeout=10.0)
                        
                        if response.status_code == 200:
                            data = response.json()
                            if data and len(data) > 0 and len(data[0]) > 0:
                                # 提取翻译结果
                                translated_text = ''.join([item[0] for item in data[0] if item and item[0]])
                                detected_language = data[2] if len(data) > 2 else source
                                
                                return {
                                    'translated_text': translated_text,
                                    'detected_language': detected_language
                                }
                        
                        logger.warning(f"HTTP请求返回非200状态码或无效数据: {response.status_code}")
                except Exception as http_err:
                    logger.warning(f"直接HTTP请求失败，尝试异步API: {str(http_err)}")
                
                # 如果直接HTTP请求失败，尝试使用异步API
                try:
                    logger.info("尝试使用异步API作为后备方案")
                    
                    # 定义异步翻译函数
                    async def async_translate():
                        if source == 'auto':
                            # 自动检测源语言
                            result = await self.unofficial_client.translate(text, dest=target)
                        else:
                            result = await self.unofficial_client.translate(text, src=source, dest=target)
                        return result
                    
                    # 使用改进的run_async_in_new_loop函数（带超时控制）
                    result = run_async_in_new_loop(async_translate, _timeout=15.0)
                    return {
                        'translated_text': result.text,
                        'detected_language': result.src
                    }
                except Exception as e:
                    logger.error(f"异步API翻译后备方案失败: {str(e)}")
                    # 所有方法都失败，返回原文
                    return {
                        'translated_text': text,
                        'detected_language': 'unknown',
                        'error': f"翻译失败: {str(e)}"
                    }
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
            # 始终返回有效响应，即使是错误情况
            return {
                'translated_text': text,
                'detected_language': 'unknown',
                'error': f"翻译失败: {str(e)}"
            }
    
    def get_available_languages(self) -> Dict[str, str]:
        """
        获取可用的语言列表
        
        Returns:
            字典，语言代码到语言名称的映射
        """
        languages = {}
        
        try:
            if self.config['use_official_api'] and self.official_client:
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