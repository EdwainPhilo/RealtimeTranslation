/**
 * 翻译功能模块
 * 处理与翻译服务的交互
 */

// 确保socket变量可用
let translationSocket;

// 确保在DOM加载完成且socket连接建立后再初始化功能
document.addEventListener('DOMContentLoaded', function() {
    // 检查全局socket是否存在，如果存在则使用，否则创建新的socket连接
    if (typeof socket !== 'undefined') {
        translationSocket = socket;
        console.log('使用全局socket连接');
    } else {
        console.log('全局socket未找到，创建新的socket连接');
        translationSocket = io();
    }
    
    // 等待socket连接建立
    setTimeout(function() {
        // 初始化翻译功能
        initTranslation();
        
        // 初始化翻译设置面板功能
        initTranslationSettings();
        
        // 添加服务统计信息更新功能
        translationSocket.on('service_stats', function(data) {
            console.log('收到服务统计信息:', data);
            
            // 清除当前的超时计时器
            if (window.currentStatusTimeoutId) {
                clearTimeout(window.currentStatusTimeoutId);
                window.currentStatusTimeoutId = null;
            }
            
            if (!data) {
                console.error('服务统计信息为空');
                // 只在元素存在时更新UI
                const statusIndicator = document.getElementById('translation-status-indicator');
                if (statusIndicator) {
                    updateStatusUI('error', '数据错误');
                }
                return;
            }
            
            const statusIndicator = document.getElementById('translation-status-indicator');
            const requestsCount = document.getElementById('translation-requests-count');
            const successRate = document.getElementById('translation-success-rate');
            const avgTime = document.getElementById('translation-avg-time');
            
            // 确保所有必要的DOM元素都存在
            if (!statusIndicator || !requestsCount || !successRate || !avgTime) {
                console.warn('找不到服务状态UI元素，可能不在翻译标签页或DOM尚未准备好');
                return;
            }
            
            // 更新状态指示器
            if (data.status === 'ok') {
                statusIndicator.textContent = '正常';
                statusIndicator.className = 'status-value status-ok';
            } else if (data.status === 'inactive') {
                statusIndicator.textContent = '未使用';
                statusIndicator.className = 'status-value status-warning';
            } else {
                statusIndicator.textContent = data.error ? `错误: ${data.error}` : '异常';
                statusIndicator.className = 'status-value status-error';
            }
            
            // 确保stats对象存在
            const stats = data.stats || {
                total_requests: 0,
                successful_requests: 0,
                failed_requests: 0,
                average_response_time: 0
            };
            
            // 更新请求计数
            requestsCount.textContent = stats.total_requests || 0;
            
            // 更新成功率
            if (stats.total_requests > 0) {
                const rate = ((stats.successful_requests / stats.total_requests) * 100).toFixed(1);
                successRate.textContent = rate + '%';
            } else {
                successRate.textContent = '0%';
            }
            
            // 更新平均响应时间
            if (stats.average_response_time) {
                const time = (stats.average_response_time * 1000).toFixed(0);
                avgTime.textContent = time + 'ms';
            } else {
                avgTime.textContent = '0ms';
            }
        });
    }, 500); // 等待500ms确保socket连接已建立
});

/**
 * 初始化翻译功能
 */
function initTranslation() {
    // 获取翻译配置
    translationSocket.emit('get_translation_config');
    
    // 监听翻译配置响应
    translationSocket.on('translation_config', function(data) {
        console.log('收到翻译配置:', data);
        updateTranslationUI(data);
    });
    
    // 监听翻译结果响应
    translationSocket.on('translation_result', function(result) {
        console.log('收到翻译结果:', result);
        displayTranslationResult(result);
    });
    
    // 监听配置更新响应
    translationSocket.on('translation_config_updated', function(data) {
        console.log('翻译配置已更新:', data);
        // 重新获取配置以更新UI
        translationSocket.emit('get_translation_config');
    });
    
    // 添加事件监听器
    const translateBtn = document.getElementById('translateBtn');
    if (translateBtn) {
        translateBtn.addEventListener('click', translateText);
    }
    
    // 复制当前转写文本按钮
    const copySourceBtn = document.getElementById('copySourceBtn');
    if (copySourceBtn) {
        copySourceBtn.addEventListener('click', function() {
            const textDisplay = document.getElementById('textDisplay');
            const sourceText = document.getElementById('sourceText');
            if (textDisplay && sourceText) {
                sourceText.value = textDisplay.innerText.trim();
            }
        });
    }
}

/**
 * 初始化翻译设置面板功能
 */
function initTranslationSettings() {
    // 添加API类型切换事件
    const apiTypeSelect = document.getElementById('translation-api-type');
    if (apiTypeSelect) {
        apiTypeSelect.addEventListener('change', function() {
            toggleCredentialsSection(this.value === 'true');
        });
    }
    
    // 添加保存翻译设置按钮事件
    const saveButton = document.getElementById('save-translation-settings');
    if (saveButton) {
        saveButton.addEventListener('click', saveTranslationSettings);
    }
    
    // 添加刷新可用语言按钮事件
    const refreshButton = document.getElementById('refresh-translation-languages');
    if (refreshButton) {
        refreshButton.addEventListener('click', function() {
            translationSocket.emit('get_translation_config');
            showTranslationMessage('正在刷新可用语言...', 'info');
        });
    }
    
    // 监听翻译配置响应，同时更新翻译面板和设置面板
    translationSocket.on('translation_config', function(data) {
        console.log('收到翻译配置:', data);
        // 更新翻译面板UI
        updateTranslationUI(data);
        // 更新设置面板UI
        updateTranslationSettingsUI(data);
        // 更新服务状态
        if (data.config && data.config.active_service) {
            updateTranslationServiceStatus(data.config.active_service);
        }
    });
    
    // 监听标签页切换事件
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const pageName = this.getAttribute('data-page');
            if (pageName === 'translation') {
                // 切换到翻译标签页时刷新服务状态
                translationSocket.emit('get_translation_config');
            }
        });
    });
    
    // 初始次加载翻译配置
    translationSocket.emit('get_translation_config');
}

/**
 * 更新翻译UI
 * @param {Object} data - 翻译配置数据
 */
function updateTranslationUI(data) {
    const config = data.config;
    const languages = data.languages;
    
    // 更新语言信息显示
    if (config.services.google && languages.google) {
        const targetLang = config.services.google.target_language;
        const langName = languages.google[targetLang] || targetLang;
        
        const sourceLanguageInfo = document.getElementById('sourceLanguageInfo');
        if (sourceLanguageInfo) {
            sourceLanguageInfo.textContent = `目标语言: ${langName} (${targetLang})`;
        }
    }
}

/**
 * 执行文本翻译
 */
function translateText() {
    // 获取待翻译文本
    const sourceTextElement = document.getElementById('sourceText');
    if (!sourceTextElement) {
        console.error('未找到源文本输入框');
        return;
    }
    
    const textToTranslate = sourceTextElement.value.trim();
    if (!textToTranslate) {
        showMessage('请输入要翻译的文本', 'warning');
        return;
    }
    
    // 显示加载状态
    const translationResultElement = document.getElementById('translationResult');
    if (translationResultElement) {
        translationResultElement.textContent = '翻译中...';
    }
    
    // 发送翻译请求
    translationSocket.emit('translate_text', {
        text: textToTranslate
    });
}

/**
 * 显示翻译结果
 * @param {Object} result - 翻译结果
 */
function displayTranslationResult(result) {
    const resultElement = document.getElementById('translationResult');
    if (!resultElement) {
        console.error('未找到翻译结果显示元素');
        return;
    }
    
    if (result.success) {
        // 成功显示翻译结果
        resultElement.textContent = result.translated_text;
        resultElement.classList.remove('error');
        
        // 显示检测到的源语言（如果有）
        if (result.detected_language) {
            const sourceLanguageInfo = document.getElementById('sourceLanguageInfo');
            if (sourceLanguageInfo) {
                const langName = result.detected_language_name || result.detected_language;
                sourceLanguageInfo.textContent = `检测到语言: ${langName} (${result.detected_language})`;
            }
        }
    } else {
        // 显示错误信息
        resultElement.textContent = `翻译失败: ${result.error}`;
        resultElement.classList.add('error');
    }
}

/**
 * 显示消息提示
 * @param {string} message - 消息内容
 * @param {string} type - 消息类型（info, success, warning, error）
 */
function showMessage(message, type = 'info') {
    const messageElement = document.getElementById('message');
    messageElement.textContent = message;
    messageElement.className = `message ${type}`;
    messageElement.classList.remove('hidden');
    
    // 3秒后自动隐藏
    setTimeout(() => {
        messageElement.classList.add('hidden');
    }, 3000);
}

/**
 * 更新翻译设置UI
 * @param {Object} data - 翻译配置数据
 */
function updateTranslationSettingsUI(data) {
    if (!data || !data.config) {
        console.error('翻译配置数据无效');
        return;
    }
    
    const config = data.config;
    const languages = data.languages || {};
    
    // 检查是否有活动服务
    if (!config.active_service) {
        console.warn('没有活动的翻译服务');
        return;
    }
    
    // 更新服务选择
    const serviceSelect = document.getElementById('translation-service');
    if (!serviceSelect) {
        console.warn('找不到翻译服务选择器元素');
    } else if (config.active_service) {
        serviceSelect.value = config.active_service;
    }
    
    // 获取当前服务配置
    const serviceConfig = config.services[config.active_service] || {};
    
    // 更新API类型
    const apiTypeSelect = document.getElementById('translation-api-type');
    if (!apiTypeSelect) {
        console.warn('找不到API类型选择器元素');
    } else {
        apiTypeSelect.value = String(serviceConfig.use_official_api || false);
        // 只有在元素存在时才切换凭证区域
        toggleCredentialsSection(serviceConfig.use_official_api);
    }
    
    // 更新凭证文件路径
    const credentialsInput = document.getElementById('translation-credentials-file');
    if (!credentialsInput) {
        console.warn('找不到凭证文件输入元素');
    } else {
        credentialsInput.value = serviceConfig.credentials_file || '';
    }
    
    // 更新代理设置
    const proxyInput = document.getElementById('translation-proxy');
    if (!proxyInput) {
        console.warn('找不到代理设置输入元素');
    } else {
        proxyInput.value = serviceConfig.proxy || '';
    }
    
    // 更新目标语言
    const targetLangSelect = document.getElementById('translation-target-language');
    if (!targetLangSelect) {
        console.warn('找不到目标语言选择器元素');
    } else if (languages[config.active_service]) {
        // 保存当前选择
        const currentValue = serviceConfig.target_language || 'zh-CN';
        
        // 清空选择器
        targetLangSelect.innerHTML = '';
        
        // 添加语言选项
        Object.keys(languages[config.active_service]).sort((a, b) => {
            return languages[config.active_service][a].localeCompare(languages[config.active_service][b]);
        }).forEach(langCode => {
            const option = document.createElement('option');
            option.value = langCode;
            option.textContent = `${languages[config.active_service][langCode]} (${langCode})`;
            option.selected = langCode === currentValue;
            targetLangSelect.appendChild(option);
        });
    }
    
    // 更新源语言
    const sourceLangSelect = document.getElementById('translation-source-language');
    if (!sourceLangSelect) {
        console.warn('找不到源语言选择器元素');
    } else {
        sourceLangSelect.value = serviceConfig.source_language || 'auto';
    }
    
    // 更新翻译服务状态部分（只有在有活动服务时）
    if (config.active_service) {
        updateTranslationServiceStatus(config.active_service);
    }
}

/**
 * 显示或隐藏凭证文件路径区域
 * @param {boolean} show - 是否显示
 */
function toggleCredentialsSection(show) {
    const section = document.querySelector('.credentials-section');
    if (!section) {
        console.warn('凭证区域元素不存在，无法切换显示状态');
        return;
    }
    
    if (show) {
        section.classList.remove('hidden');
        // 确保说明区域可见，并滚动到可见区域
        const instructions = section.querySelector('.api-instructions');
        if (instructions) {
            instructions.style.display = 'block';
            // 延迟一下再滚动，确保DOM已更新
            setTimeout(() => {
                // 确保元素仍然存在后再滚动
                if (section && document.body.contains(section)) {
                    // 平滑滚动到凭证输入区域
                    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 100);
        }
    } else {
        section.classList.add('hidden');
    }
}

/**
 * 保存翻译设置
 */
function saveTranslationSettings() {
    // 获取必需的DOM元素
    const serviceSelect = document.getElementById('translation-service');
    const apiTypeSelect = document.getElementById('translation-api-type');
    const targetLangSelect = document.getElementById('translation-target-language');
    const sourceLangSelect = document.getElementById('translation-source-language');
    
    // 检查必需的元素是否存在
    if (!serviceSelect || !apiTypeSelect || !targetLangSelect || !sourceLangSelect) {
        console.error('无法保存翻译设置：部分或所有必需DOM元素不存在');
        showTranslationMessage('无法保存设置，请刷新页面后重试', 'error');
        return;
    }
    
    const service = serviceSelect.value;
    const useOfficialApi = apiTypeSelect.value === 'true';
    const targetLanguage = targetLangSelect.value;
    const sourceLanguage = sourceLangSelect.value;
    
    // 配置对象
    const config = {
        active_service: service,
        services: {
            [service]: {
                use_official_api: useOfficialApi,
                target_language: targetLanguage,
                source_language: sourceLanguage
            }
        }
    };
    
    // 如果使用官方API，添加凭证文件路径和代理
    if (useOfficialApi) {
        const credentialsInput = document.getElementById('translation-credentials-file');
        const proxyInput = document.getElementById('translation-proxy');
        
        // 检查可选元素是否存在
        if (!credentialsInput || !proxyInput) {
            console.warn('凭证或代理设置元素不存在，这些设置将被忽略');
        } else {
            const credentialsFile = credentialsInput.value.trim();
            config.services[service].credentials_file = credentialsFile;
            
            // 处理代理设置
            const proxyServer = proxyInput.value.trim();
            if (proxyServer) {
                config.services[service].proxy = proxyServer;
            }
        }
    }
    
    // 发送配置更新请求
    translationSocket.emit('update_translation_config', config);
    showTranslationMessage('正在保存翻译设置...', 'info');
}

/**
 * 更新翻译服务状态
 * @param {string} service - 服务名称
 * @param {number} retryCount - 重试计数
 */
function updateTranslationServiceStatus(service, retryCount = 0) {
    if (!service) return;
    
    // 最大重试次数
    const MAX_RETRIES = 3;
    
    // 获取状态显示元素
    const statusIndicator = document.getElementById('translation-status-indicator');
    const requestsCount = document.getElementById('translation-requests-count');
    const successRate = document.getElementById('translation-success-rate');
    const avgTime = document.getElementById('translation-avg-time');
    
    // 检查必要的元素是否存在
    const elementsExist = statusIndicator && requestsCount && successRate && avgTime;
    if (!elementsExist) {
        console.warn('部分或全部翻译服务状态元素不存在，可能不在翻译标签页');
        return;
    }
    
    // 更新状态显示
    statusIndicator.textContent = retryCount > 0 ? `获取中...(重试 ${retryCount}/${MAX_RETRIES})` : '获取中...';
    requestsCount.textContent = '0';
    successRate.textContent = '0%';
    avgTime.textContent = '0ms';
    
    // 发送获取服务状态请求
    console.log(`获取服务状态: ${service}${retryCount > 0 ? ' (重试 ' + retryCount + ')' : ''}`);
    translationSocket.emit('get_service_stats', { service: service });
    
    // 设置超时，如果5秒内没有收到响应，尝试重试或显示错误状态
    const timeoutId = setTimeout(() => {
        // 再次检查元素是否存在
        if (statusIndicator && statusIndicator.textContent.includes('获取中')) {
            if (retryCount < MAX_RETRIES) {
                // 尝试重试
                console.warn(`获取服务状态超时，正在重试 (${retryCount + 1}/${MAX_RETRIES})...`);
                updateTranslationServiceStatus(service, retryCount + 1);
            } else {
                // 超过最大重试次数，显示错误
                console.error('获取翻译服务状态失败，已达到最大重试次数');
                updateStatusUI('error', '连接超时');
            }
        }
    }, 5000);
    
    // 存储超时ID，当收到响应时可以清除
    window.currentStatusTimeoutId = timeoutId;
}

/**
 * 显示翻译设置消息
 * @param {string} message - 消息内容
 * @param {string} type - 消息类型
 */
function showTranslationMessage(message, type = 'info') {
    const messageElement = document.getElementById('translation-message');
    if (!messageElement) {
        console.warn('无法显示翻译消息：消息元素不存在');
        return;
    }
    
    messageElement.textContent = message;
    messageElement.className = `message ${type}`;
    messageElement.classList.remove('hidden');
    
    // 自动隐藏
    setTimeout(() => {
        // 再次检查元素是否存在，以防在超时期间被移除
        if (messageElement && !messageElement.classList.contains('hidden')) {
            messageElement.classList.add('hidden');
        }
    }, 3000);
}

/**
 * 获取翻译服务的显示名称
 * @param {string} serviceKey - 服务键名
 * @returns {string} 服务显示名称
 */
function getServiceDisplayName(serviceKey) {
    const serviceNames = {
        'google': 'Google 翻译',
        // 可以添加更多服务的显示名称
    };
    
    return serviceNames[serviceKey] || serviceKey;
}

/**
 * 更新状态UI显示
 * @param {string} status - 状态类型: 'ok', 'error', 'warning'
 * @param {string} message - 状态消息
 */
function updateStatusUI(status, message) {
    const statusIndicator = document.getElementById('translation-status-indicator');
    if (!statusIndicator) {
        console.warn('无法更新状态UI：状态指示器元素不存在');
        return;
    }
    
    statusIndicator.textContent = message || '未知状态';
    statusIndicator.className = 'status-value status-' + status;
} 