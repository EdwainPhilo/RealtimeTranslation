/**
 * 翻译功能模块
 * 处理与翻译服务的交互
 */
document.addEventListener('DOMContentLoaded', function() {
    // 初始化翻译功能
    initTranslation();
    
    // 初始化翻译设置面板功能
    initTranslationSettings();
});

/**
 * 初始化翻译功能
 */
function initTranslation() {
    // 获取翻译配置
    socket.emit('get_translation_config');
    
    // 监听翻译配置响应
    socket.on('translation_config', function(data) {
        console.log('收到翻译配置:', data);
        updateTranslationUI(data);
    });
    
    // 监听翻译结果响应
    socket.on('translation_result', function(result) {
        console.log('收到翻译结果:', result);
        displayTranslationResult(result);
    });
    
    // 监听配置更新响应
    socket.on('translation_config_updated', function(data) {
        console.log('翻译配置已更新:', data);
        // 重新获取配置以更新UI
        socket.emit('get_translation_config');
    });
    
    // 添加事件监听器
    document.getElementById('translateBtn').addEventListener('click', translateText);
    
    // 语言选择变更时保存配置
    document.getElementById('targetLanguage').addEventListener('change', function() {
        updateTranslationConfig();
    });
    
    // 翻译服务变更时保存配置
    document.getElementById('translationService').addEventListener('change', function() {
        updateTranslationConfig();
        // 更新语言选择列表
        updateLanguageOptions();
    });
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
            socket.emit('get_translation_config');
            showTranslationMessage('正在刷新可用语言...', 'info');
        });
    }
    
    // 监听翻译配置响应，同时更新翻译面板和设置面板
    socket.on('translation_config', function(data) {
        console.log('收到翻译配置:', data);
        // 更新翻译面板UI
        updateTranslationUI(data);
        // 更新设置面板UI
        updateTranslationSettingsUI(data);
    });
    
    // 初始次加载翻译配置
    socket.emit('get_translation_config');
}

/**
 * 更新翻译UI
 * @param {Object} data - 翻译配置数据
 */
function updateTranslationUI(data) {
    const config = data.config;
    const availableServices = data.available_services;
    const languages = data.languages;
    
    // 更新翻译服务选择器
    const serviceSelect = document.getElementById('translationService');
    serviceSelect.innerHTML = '';
    
    availableServices.forEach(service => {
        const option = document.createElement('option');
        option.value = service;
        option.textContent = getServiceDisplayName(service);
        option.selected = service === config.active_service;
        serviceSelect.appendChild(option);
    });
    
    // 更新语言选择器
    updateLanguageOptions(config.active_service, languages, config);
}

/**
 * 更新语言选择器选项
 * @param {string} service - 当前选择的翻译服务
 * @param {Object} allLanguages - 所有语言的映射
 * @param {Object} config - 当前配置
 */
function updateLanguageOptions(service, allLanguages, config) {
    if (!service) {
        service = document.getElementById('translationService').value;
    }
    if (!allLanguages) {
        return;
    }
    if (!config) {
        return;
    }
    
    const languages = allLanguages[service] || {};
    const targetLanguageSelect = document.getElementById('targetLanguage');
    
    // 保存当前选择的值
    const currentValue = targetLanguageSelect.value || 
                         config.services[service].target_language || 
                         'zh-CN';
    
    // 清空选择器
    targetLanguageSelect.innerHTML = '';
    
    // 添加语言选项
    Object.keys(languages).sort((a, b) => {
        return languages[a].localeCompare(languages[b]);
    }).forEach(langCode => {
        const option = document.createElement('option');
        option.value = langCode;
        option.textContent = `${languages[langCode]} (${langCode})`;
        option.selected = langCode === currentValue;
        targetLanguageSelect.appendChild(option);
    });
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
 * 执行文本翻译
 */
function translateText() {
    // 获取待翻译文本
    const textToTranslate = document.getElementById('sourceText').value.trim();
    if (!textToTranslate) {
        showMessage('请输入要翻译的文本', 'warning');
        return;
    }
    
    // 获取翻译参数
    const targetLanguage = document.getElementById('targetLanguage').value;
    const service = document.getElementById('translationService').value;
    
    // 显示加载状态
    document.getElementById('translationResult').textContent = '翻译中...';
    
    // 发送翻译请求
    socket.emit('translate_text', {
        text: textToTranslate,
        target_language: targetLanguage,
        service: service
    });
}

/**
 * 显示翻译结果
 * @param {Object} result - 翻译结果
 */
function displayTranslationResult(result) {
    const resultElement = document.getElementById('translationResult');
    
    if (result.success) {
        // 成功显示翻译结果
        resultElement.textContent = result.translated_text;
        resultElement.classList.remove('error');
        
        // 显示源语言信息（如果有）
        if (result.detected_language) {
            const sourceLanguageInfo = document.getElementById('sourceLanguageInfo');
            if (sourceLanguageInfo) {
                sourceLanguageInfo.textContent = `检测到的源语言: ${result.detected_language}`;
            }
        }
    } else {
        // 显示错误信息
        resultElement.textContent = `翻译失败: ${result.error || '未知错误'}`;
        resultElement.classList.add('error');
    }
}

/**
 * 更新翻译配置
 */
function updateTranslationConfig() {
    const service = document.getElementById('translationService').value;
    const targetLanguage = document.getElementById('targetLanguage').value;
    
    const config = {
        active_service: service,
        services: {
            [service]: {
                target_language: targetLanguage
            }
        }
    };
    
    // 发送配置更新请求
    socket.emit('update_translation_config', config);
}

/**
 * 显示消息提示
 * @param {string} message - 消息内容
 * @param {string} type - 消息类型（info, success, warning, error）
 */
function showMessage(message, type = 'info') {
    const messageElement = document.getElementById('message');
    if (!messageElement) return;
    
    messageElement.textContent = message;
    messageElement.className = `message ${type}`;
    messageElement.style.display = 'block';
    
    // 自动隐藏
    setTimeout(() => {
        messageElement.style.display = 'none';
    }, 3000);
}

/**
 * 更新翻译设置UI
 * @param {Object} data - 翻译配置数据
 */
function updateTranslationSettingsUI(data) {
    const config = data.config;
    const availableServices = data.available_services;
    const languages = data.languages;
    
    // 更新翻译服务选择器
    const serviceSelect = document.getElementById('translation-service');
    if (serviceSelect) {
        serviceSelect.innerHTML = '';
        
        availableServices.forEach(service => {
            const option = document.createElement('option');
            option.value = service;
            option.textContent = getServiceDisplayName(service);
            option.selected = service === config.active_service;
            serviceSelect.appendChild(option);
        });
    }
    
    // 获取当前服务配置
    const serviceConfig = config.services[config.active_service] || {};
    
    // 更新API类型选择
    const apiTypeSelect = document.getElementById('translation-api-type');
    if (apiTypeSelect) {
        apiTypeSelect.value = serviceConfig.use_official_api ? 'true' : 'false';
        // 根据API类型显示或隐藏凭证区域
        toggleCredentialsSection(serviceConfig.use_official_api);
    }
    
    // 更新凭证文件路径
    const credentialsInput = document.getElementById('translation-credentials-file');
    if (credentialsInput) {
        credentialsInput.value = serviceConfig.credentials_file || '';
    }
    
    // 更新代理设置
    const proxyInput = document.getElementById('translation-proxy');
    if (proxyInput) {
        proxyInput.value = serviceConfig.proxy || '';
    }
    
    // 更新目标语言选择器
    const targetLangSelect = document.getElementById('translation-target-language');
    if (targetLangSelect) {
        updateSettingsLanguageOptions(targetLangSelect, languages[config.active_service], 
                                     serviceConfig.target_language || 'zh-CN');
    }
    
    // 更新源语言选择器
    const sourceLangSelect = document.getElementById('translation-source-language');
    if (sourceLangSelect) {
        // 添加自动选项
        updateSettingsLanguageOptions(sourceLangSelect, 
                                     {'auto': '自动检测', ...languages[config.active_service]}, 
                                     serviceConfig.source_language || 'auto');
    }
    
    // 更新翻译服务状态
    updateTranslationServiceStatus(config.active_service);
}

/**
 * 更新设置面板中的语言选择器
 * @param {HTMLElement} selectElement - 选择器元素
 * @param {Object} languages - 语言对象
 * @param {string} selectedValue - 选中的值
 */
function updateSettingsLanguageOptions(selectElement, languages, selectedValue) {
    if (!languages) return;
    
    // 保存当前值
    const currentValue = selectedValue || selectElement.value;
    
    // 清空选择器
    selectElement.innerHTML = '';
    
    // 如果是源语言选择器，添加自动检测选项
    if (selectElement.id === 'translation-source-language' && !languages['auto']) {
        const autoOption = document.createElement('option');
        autoOption.value = 'auto';
        autoOption.textContent = '自动检测';
        autoOption.selected = currentValue === 'auto';
        selectElement.appendChild(autoOption);
    }
    
    // 添加语言选项
    Object.keys(languages).sort((a, b) => {
        if (a === 'auto') return -1;
        if (b === 'auto') return 1;
        return languages[a].localeCompare(languages[b]);
    }).forEach(langCode => {
        if (langCode === 'auto' && selectElement.id !== 'translation-source-language') {
            return; // 只在源语言选择器中显示自动选项
        }
        
        const option = document.createElement('option');
        option.value = langCode;
        option.textContent = langCode === 'auto' ? 
                            '自动检测' : 
                            `${languages[langCode]} (${langCode})`;
        option.selected = langCode === currentValue;
        selectElement.appendChild(option);
    });
}

/**
 * 显示或隐藏凭证文件路径区域
 * @param {boolean} show - 是否显示
 */
function toggleCredentialsSection(show) {
    const section = document.querySelector('.credentials-section');
    if (section) {
        if (show) {
            section.classList.remove('hidden');
            // 确保说明区域可见，并滚动到可见区域
            const instructions = section.querySelector('.api-instructions');
            if (instructions) {
                instructions.style.display = 'block';
                // 延迟一下再滚动，确保DOM已更新
                setTimeout(() => {
                    // 平滑滚动到凭证输入区域
                    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            }
        } else {
            section.classList.add('hidden');
        }
    }
}

/**
 * 保存翻译设置
 */
function saveTranslationSettings() {
    const service = document.getElementById('translation-service').value;
    const useOfficialApi = document.getElementById('translation-api-type').value === 'true';
    const targetLanguage = document.getElementById('translation-target-language').value;
    const sourceLanguage = document.getElementById('translation-source-language').value;
    
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
        const credentialsFile = document.getElementById('translation-credentials-file').value.trim();
        config.services[service].credentials_file = credentialsFile;
        
        // 处理代理设置
        const proxyServer = document.getElementById('translation-proxy').value.trim();
        if (proxyServer) {
            config.services[service].proxy = proxyServer;
        }
    }
    
    // 发送配置更新请求
    socket.emit('update_translation_config', config);
    showTranslationMessage('正在保存翻译设置...', 'info');
}

/**
 * 更新翻译服务状态
 * @param {string} service - 服务名称
 */
function updateTranslationServiceStatus(service) {
    // 发送获取服务状态请求
    socket.emit('get_service_stats', { service: service });
    
    // 临时更新状态指示器
    document.getElementById('translation-status-indicator').textContent = '获取中...';
}

/**
 * 显示翻译设置消息
 * @param {string} message - 消息内容
 * @param {string} type - 消息类型
 */
function showTranslationMessage(message, type = 'info') {
    const messageElement = document.getElementById('translation-message');
    if (!messageElement) return;
    
    messageElement.textContent = message;
    messageElement.className = `message ${type}`;
    messageElement.classList.remove('hidden');
    
    // 自动隐藏
    setTimeout(() => {
        messageElement.classList.add('hidden');
    }, 3000);
}

// 添加服务统计信息更新功能
socket.on('service_stats', function(data) {
    if (!data || !data.service) return;
    
    const statusIndicator = document.getElementById('translation-status-indicator');
    const requestsCount = document.getElementById('translation-requests-count');
    const successRate = document.getElementById('translation-success-rate');
    const avgTime = document.getElementById('translation-avg-time');
    
    if (statusIndicator) {
        statusIndicator.textContent = data.status === 'ok' ? '正常' : '异常';
        statusIndicator.className = 'status-value ' + (data.status === 'ok' ? 'status-ok' : 'status-error');
    }
    
    if (requestsCount) {
        requestsCount.textContent = data.stats.total_requests || 0;
    }
    
    if (successRate && data.stats.total_requests > 0) {
        const rate = ((data.stats.successful_requests / data.stats.total_requests) * 100).toFixed(1);
        successRate.textContent = rate + '%';
    }
    
    if (avgTime) {
        const time = (data.stats.average_response_time * 1000).toFixed(0);
        avgTime.textContent = time + 'ms';
    }
}); 