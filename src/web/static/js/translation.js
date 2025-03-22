/**
 * 翻译功能模块
 * 处理与翻译服务的交互
 */

// 调试函数：详细打印对象结构（包括嵌套结构）
function debugPrintObject(obj, label, depth = 3) {
    try {
        const replacer = (key, value) => {
            if (depth <= 0) return typeof value === 'object' ? '[Object]' : value;
            return value;
        };
        
        const output = JSON.stringify(obj, replacer, 2);
        console.log(`===== ${label} =====`);
        console.log(output);
        console.log(`===== END ${label} =====`);
    } catch (e) {
        console.error(`调试打印失败: ${e.message}`);
    }
}

// 确保socket变量可用
let translationSocket;

// 全局翻译配置管理器
const TranslationConfigManager = {
    config: null,
    listeners: [],
    
    // 初始化配置
    initialize: function(config) {
        this.config = config;
        console.log('初始化全局翻译配置:', config);
        this.notifyListeners();
    },
    
    // 获取当前配置
    getConfig: function() {
        return this.config;
    },
    
    // 更新配置
    updateConfig: function(config) {
        this.config = config;
        console.log('更新全局翻译配置:', config);
        this.notifyListeners();
    },
    
    // 添加配置更改监听器
    addListener: function(listener) {
        if (typeof listener === 'function') {
            this.listeners.push(listener);
            // 如果已有配置，立即通知新的监听器
            if (this.config) {
                listener(this.config);
            }
        }
    },
    
    // 移除监听器
    removeListener: function(listener) {
        const index = this.listeners.indexOf(listener);
        if (index !== -1) {
            this.listeners.splice(index, 1);
        }
    },
    
    // 通知所有监听器配置已更改
    notifyListeners: function() {
        if (!this.config) return;
        
        console.log('通知所有监听器配置已更改');
        this.listeners.forEach(listener => {
            try {
                listener(this.config);
            } catch (error) {
                console.error('通知监听器时出错:', error);
            }
        });
    },
    
    // 设置配置
    setConfig: function(config) {
        this.config = config;
        this.notifyListeners();
    }
};

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
    
    // 监听标签页变更事件
    document.addEventListener('tabChanged', function(event) {
        const tabName = event.detail.tabName;
        console.log(`翻译模块接收到标签变更事件: ${tabName}`);
        
        if (tabName === 'translation') {
            console.log('从tabChanged事件检测到切换到翻译标签页');
            // 切换到翻译标签页时初始化功能并刷新服务状态
            initTranslation();
            initTranslationSettings();
            
            // 主动获取最新的服务状态
            const config = TranslationConfigManager.getConfig();
            if (config) {
                const activeService = config.service || config.active_service || 'google';
                console.log(`标签页切换后，获取服务状态: ${activeService}`);
                // 重置超时计时器
                if (window.currentStatusTimeoutId) {
                    clearTimeout(window.currentStatusTimeoutId);
                    window.currentStatusTimeoutId = null;
                }
                // 立即请求服务状态
                translationSocket.emit('get_service_stats', { service: activeService });
            }
        }
    });
    
    // 等待socket连接建立
    setTimeout(function() {
        // 无论是否在翻译标签页，都获取一次翻译配置以更新全局配置管理器
        translationSocket.emit('get_translation_config');
        console.log('初始获取翻译配置以更新全局配置管理器');
        
        // 监听标签页切换，确保在切换到翻译标签页时初始化功能
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', function() {
                const pageName = this.getAttribute('data-page');
                if (pageName === 'translation') {
                    // 切换到翻译标签页时初始化功能
                    console.log('切换到翻译标签页，初始化翻译功能');
                    initTranslation();
                    initTranslationSettings();
                }
            });
        });
        
        // 仅当当前在翻译标签页时初始化
        if (isTranslationTabActive()) {
            console.log('当前在翻译标签页，初始化翻译功能');
            initTranslation();
            initTranslationSettings();
}

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
                console.warn('找不到服务状态UI元素，可能DOM尚未准备好或元素不在当前视图中');
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

    // 初始化翻译Socket连接
    translationSocket.on('connect', function() {
        console.log('翻译服务连接成功');
        updateTranslationStatus('已连接', 'success');
    });

    translationSocket.on('disconnect', function() {
        console.log('翻译服务连接断开');
        updateTranslationStatus('已断开', 'error');
    });
});

/**
 * 检查翻译标签页是否激活
 * @returns {boolean} 翻译标签页是否激活
 */
function isTranslationTabActive() {
    // 优先使用全局变量currentNavTab进行判断
    if (typeof currentNavTab !== 'undefined') {
        return currentNavTab === 'translation';
    }
    
    // 备选方案：从DOM检查
    const translationTab = document.querySelector('.nav-tab[data-page="translation"]');
    if (!translationTab) return false;
    return translationTab.classList.contains('active');
}

/**
 * 初始化翻译功能
 */
function initTranslation() {
    console.log('初始化翻译功能');
    
    // 获取翻译配置
    translationSocket.emit('get_translation_config');
    
    // 监听翻译配置响应
    translationSocket.on('translation_config', function(data) {
        console.log('收到翻译配置数据');
        
        // 确保数据符合预期的格式
        if (!data) {
            console.error('收到无效的翻译配置数据');
            return;
        }
        
        // 提取配置和语言数据
        const config = data.config || {};
        const languages = data.languages || {};
        
        // 记录收到的语言数据
        const servicesCount = Object.keys(languages).length;
        console.log(`收到 ${servicesCount} 个翻译服务的语言数据`);
        
        // 将语言数据合并到配置中，以便统一管理
        config.languages = languages;
        
        // 更新全局配置管理器
        TranslationConfigManager.setConfig(config);
        
        // 提取当前活跃服务的语言列表
        const activeService = config.service || 'google';
        if (languages[activeService]) {
            const languageCount = Object.keys(languages[activeService]).length;
            console.log(`当前活跃服务 ${activeService} 有 ${languageCount} 种可用语言`);
            
            // 当语言数量很多时只显示前几个示例
            if (languageCount > 0) {
                const firstFive = Object.entries(languages[activeService]).slice(0, 5);
                const examples = firstFive.map(([code, name]) => `${code}: ${name}`).join(', ');
                console.log(`语言示例: ${examples}...`);
            }
        } else {
            console.warn(`未找到活跃服务 ${activeService} 的语言数据`);
            const availableServices = Object.keys(languages).join(', ');
            console.log(`可用的翻译服务: ${availableServices || '无'}`);
        }
        
        // 更新翻译面板和设置UI
        updateTranslationPanel();
        updateTranslationSettingsUI();
    });
    
    // 监听翻译结果响应
    translationSocket.on('translation_result', function(data) {
        console.log('收到翻译结果:', data);
        
        // 显示翻译结果
        displayTranslationResult(data);
    });
    
    // 监听配置更新响应
    translationSocket.on('translation_config_updated', function(data) {
        console.log('翻译配置已更新:', data);
        
        // 清除保存超时计时器
        if (window.saveSettingsTimeoutId) {
            clearTimeout(window.saveSettingsTimeoutId);
            window.saveSettingsTimeoutId = null;
        }
        
        // 显示成功消息
        showTranslationMessage('翻译设置已成功保存', 'success');
        
        // 确保配置更新传播到全局管理器
        if (typeof TranslationConfigManager !== 'undefined' && data.config) {
            TranslationConfigManager.updateConfig({
                config: data.config,
                languages: {}  // 这里没有语言数据，但会在下一次获取配置时更新
            });
        }
        
        // 重新获取完整配置以更新UI和语言列表
        console.log('重新获取最新配置以更新UI和语言列表');
        setTimeout(function() {
            // 使用刷新语言函数重新获取配置和语言列表
            refreshTranslationLanguages();
        }, 500);
    });
    
    // 不再查找和使用在转录页面中可能存在的翻译相关按钮
}

let refreshInProgress = false;
let refreshLanguagesTimeoutId = null;

function refreshTranslationLanguages() {
    if (refreshInProgress) {
        console.log("正在刷新翻译语言列表，请稍候...");
        return;
    }

    refreshInProgress = true;
    
    // 显示加载状态
    $('#refreshLanguagesBtn').attr('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 刷新中...');

    // 清除之前的超时计时器（如果存在）
    if (refreshLanguagesTimeoutId) {
        clearTimeout(refreshLanguagesTimeoutId);
    }

    // 创建一个超时计时器，如果15秒内没有收到响应，则显示错误消息
    refreshLanguagesTimeoutId = setTimeout(() => {
        console.error("获取翻译语言列表超时");
        $('#refreshLanguagesBtn').attr('disabled', false).html('<i class="fas fa-sync-alt"></i> 刷新语言');
        showTranslationMessage("获取翻译语言列表超时，请重试", "error");
        refreshInProgress = false;
    }, 15000);
    
    try {
        // 添加时间戳防止缓存
        const requestData = { _t: Date.now() };
        
        // 发送一次性请求获取最新配置
        translationSocket.emit('get_translation_config', requestData, function(data) {
            try {
                // 清除超时计时器
                if (refreshLanguagesTimeoutId) {
                    clearTimeout(refreshLanguagesTimeoutId);
                    refreshLanguagesTimeoutId = null;
                }
                
                console.log(`收到翻译配置响应，包含 ${Object.keys(data.languages || {}).length} 个服务的语言数据`);
                debugPrintObject(data, "强制刷新获取到的翻译配置");
                
                // 更新全局配置
                if (data && data.config) {
                    TranslationConfigManager.setConfig(data.config);
                }
                
                // 更新UI
                if (data && data.languages) {
                    // 获取活跃翻译服务
                    const activeService = TranslationConfigManager.getConfig().service || "google";
                    
                    if (data.languages[activeService]) {
                        const languageCount = Object.keys(data.languages[activeService]).length;
                        console.log(`活跃翻译服务 ${activeService} 有 ${languageCount} 种可用语言`);
                        
                        if (languageCount > 0) {
                            showTranslationMessage(`成功获取 ${languageCount} 种可用语言`, "success");
                            
                            // 始终更新UI，不再检查标签页状态
                            updateTranslationSettingsUI();
                        } else {
                            showTranslationMessage(`未找到可用的语言数据，请检查翻译服务配置`, "warning");
                        }
                    } else {
                        showTranslationMessage(`未找到翻译服务 ${activeService} 的语言数据`, "warning");
                    }
                } else {
                    showTranslationMessage("获取语言列表失败，返回数据格式不正确", "error");
                }
                
                // 恢复按钮状态
                $('#refreshLanguagesBtn').attr('disabled', false).html('<i class="fas fa-sync-alt"></i> 刷新语言');
                refreshInProgress = false;
            } catch (error) {
                console.error("处理翻译配置数据时出错:", error);
                $('#refreshLanguagesBtn').attr('disabled', false).html('<i class="fas fa-sync-alt"></i> 刷新语言');
                showTranslationMessage("处理翻译配置数据时出错", "error");
                refreshInProgress = false;
            }
        });
    } catch (error) {
        console.error("请求翻译语言列表时出错:", error);
        $('#refreshLanguagesBtn').attr('disabled', false).html('<i class="fas fa-sync-alt"></i> 刷新语言');
        showTranslationMessage("请求翻译语言列表时出错", "error");
        
        if (refreshLanguagesTimeoutId) {
            clearTimeout(refreshLanguagesTimeoutId);
            refreshLanguagesTimeoutId = null;
        }
        
        refreshInProgress = false;
    }
}

/**
 * 初始化翻译设置面板功能
 */
function initTranslationSettings() {
    console.log('初始化翻译设置面板...');
    
    // 添加API类型切换事件
    const apiTypeSelect = document.getElementById('translation-api-type');
    if (apiTypeSelect) {
        apiTypeSelect.addEventListener('change', function() {
            console.log('API类型变更为:', this.value);
            toggleCredentialsSection(this.value === 'true');
        });
    } else {
        console.warn('未找到API类型选择器元素');
    }
    
    // 添加保存翻译设置按钮事件
    const saveButton = document.getElementById('save-translation-settings');
    if (saveButton) {
        console.log('找到保存按钮，绑定点击事件');
        saveButton.onclick = function() {
            console.log('保存按钮被点击');
            saveTranslationSettings();
        };
    } else {
        console.warn('未找到保存翻译设置按钮');
    }
    
    // 添加刷新可用语言按钮事件
    const refreshButton = document.getElementById('refresh-translation-languages');
    if (refreshButton) {
        console.log('找到刷新按钮，绑定点击事件');
        refreshButton.onclick = function() {
            console.log('刷新按钮被点击');
            refreshTranslationLanguages();
        };
    } else {
        console.warn('未找到刷新可用语言按钮');
    }
    
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
 * 更新翻译设置UI
 */
function updateTranslationSettingsUI() {
    try {
        // 从全局配置管理器获取配置
        const config = TranslationConfigManager.getConfig();
        if (!config) {
            console.error('updateTranslationSettingsUI: 无法获取配置');
            return;
        }
        
        console.log('更新翻译设置UI');
        
        // 获取活跃服务
        const activeService = config.service || config.active_service || 'google';
        
        // 更新服务选择器
        const serviceSelect = document.getElementById('translation-service');
        if (serviceSelect && activeService) {
            serviceSelect.value = activeService;
        }
        
        // 获取当前服务的配置
        const serviceConfig = config.services && config.services[activeService] || {};
        
        // 更新API类型选择器
        const apiTypeSelect = document.getElementById('translation-api-type');
        if (apiTypeSelect && serviceConfig.use_official_api !== undefined) {
            apiTypeSelect.value = String(serviceConfig.use_official_api);
            // 根据API类型切换凭证部分的显示
            toggleCredentialsSection(serviceConfig.use_official_api);
        }
        
        // 1. 首先从全局配置获取语言数据
        let languageData = {};
        
        // 尝试从config.languages获取语言列表
        if (config.languages && config.languages[activeService]) {
            languageData = config.languages[activeService];
            console.log(`从config.languages获取到${Object.keys(languageData).length}种语言`);
        }
        // 如果从config没有获取到，尝试从全局TranslationLanguages获取
        else if (window.TranslationLanguages && window.TranslationLanguages[activeService]) {
            languageData = window.TranslationLanguages[activeService];
            console.log(`从全局TranslationLanguages获取到${Object.keys(languageData).length}种语言`);
        }
        
        // 2. 如果找到了语言数据，更新源语言和目标语言选择器
        if (Object.keys(languageData).length > 0) {
            console.log(`更新语言选择器，找到${Object.keys(languageData).length}种语言`);
            
            // 获取当前选择的源语言和目标语言
            const currentSourceLang = serviceConfig.source_language || 'auto';
            const currentTargetLang = serviceConfig.target_language || 'zh-CN';
            
            // 更新源语言选择器
            const sourceLangSelect = document.getElementById('translation-source-language');
            if (sourceLangSelect) {
                // 清空现有选项
                sourceLangSelect.innerHTML = '';
                
                // 添加"自动检测"选项
                const autoOption = document.createElement('option');
                autoOption.value = 'auto';
                autoOption.textContent = '自动检测';
                sourceLangSelect.appendChild(autoOption);
                
                // 添加所有可用语言
                for (const [code, name] of Object.entries(languageData)) {
                    const option = document.createElement('option');
                    option.value = code;
                    option.textContent = name;
                    sourceLangSelect.appendChild(option);
                }
                
                // 设置当前选中值
                sourceLangSelect.value = currentSourceLang;
            }
            
            // 更新目标语言选择器
            const targetLangSelect = document.getElementById('translation-target-language');
            if (targetLangSelect) {
                // 清空现有选项
                targetLangSelect.innerHTML = '';
                
                // 添加所有可用语言
                for (const [code, name] of Object.entries(languageData)) {
                    const option = document.createElement('option');
                    option.value = code;
                    option.textContent = name;
                    targetLangSelect.appendChild(option);
                }
                
                // 设置当前选中值
                targetLangSelect.value = currentTargetLang;
            }
        } else {
            console.warn(`未找到服务 ${activeService} 的语言数据, 无法更新语言选择器`);
        }
        
        // 更新流式翻译复选框
        const useStreamingTranslation = document.getElementById('use-streaming-translation');
        if (useStreamingTranslation && config.use_streaming_translation !== undefined) {
            useStreamingTranslation.checked = config.use_streaming_translation;
            updateTranslationNotice(config.use_streaming_translation);
        }
        
        // 更新API凭证设置
        const apiKeyInput = document.getElementById('translation-api-key');
        if (apiKeyInput && serviceConfig.api_key) {
            apiKeyInput.value = serviceConfig.api_key;
        }
        
        const apiRegionInput = document.getElementById('translation-api-region');
        if (apiRegionInput && serviceConfig.api_region) {
            apiRegionInput.value = serviceConfig.api_region;
        }
        
        const endpointInput = document.getElementById('translation-endpoint');
        if (endpointInput && serviceConfig.endpoint) {
            endpointInput.value = serviceConfig.endpoint;
        }
        
        const proxyInput = document.getElementById('translation-proxy');
        if (proxyInput && serviceConfig.proxy) {
            proxyInput.value = serviceConfig.proxy;
        }
    } catch (error) {
        console.error('更新翻译设置UI时出错:', error);
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
 * 注意：此函数被暴露为全局函数，以便从其他脚本调用
 */
window.saveTranslationSettings = function() {
    console.log('执行保存翻译设置操作');
    
    // 获取必需的DOM元素
    const serviceSelect = document.getElementById('translation-service');
    const apiTypeSelect = document.getElementById('translation-api-type');
    const targetLangSelect = document.getElementById('translation-target-language');
    const sourceLangSelect = document.getElementById('translation-source-language');
    const useStreamingTranslation = document.getElementById('use-streaming-translation');
    
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
    const streamingTranslation = useStreamingTranslation ? useStreamingTranslation.checked : false;
    
    // 配置对象
    const config = {
        active_service: service,
        use_streaming_translation: streamingTranslation,  // 添加流式翻译设置
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
    
    console.log('保存翻译设置:', JSON.stringify(config, null, 2));
    
    // 发送配置更新请求
    if (typeof translationSocket !== 'undefined') {
        try {
            // 显示保存中提示
            showTranslationMessage('正在保存翻译设置...', 'info');
            
            // 清除之前的超时计时器（如果有）
            if (window.saveSettingsTimeoutId) {
                clearTimeout(window.saveSettingsTimeoutId);
            }
            
            // 发送配置更新请求
            translationSocket.emit('update_translation_config', config);
            
            // 设置超时检查
            window.saveSettingsTimeoutId = setTimeout(function() {
                console.warn('保存翻译设置请求超时，未收到服务器响应');
                showTranslationMessage('保存设置请求超时，请重试', 'warning');
            }, 5000);
            
            // 预先更新本地配置（乐观更新）
            if (typeof TranslationConfigManager !== 'undefined') {
                const currentConfig = TranslationConfigManager.getConfig();
                if (currentConfig) {
                    const updatedConfig = {
                        ...currentConfig,
                        config: {
                            ...currentConfig.config,
                            active_service: config.active_service,
                            use_streaming_translation: config.use_streaming_translation,
                            services: {
                                ...currentConfig.config.services,
                                [config.active_service]: config.services[config.active_service]
                            }
                        }
                    };
                    console.log('乐观更新本地配置');
                    TranslationConfigManager.updateConfig(updatedConfig);
                }
            }
        } catch (error) {
            console.error('发送翻译设置更新请求时发生错误:', error);
            showTranslationMessage('发送设置请求失败: ' + error.message, 'error');
        }
    } else {
        console.error('无法保存翻译设置：translationSocket未定义');
        showTranslationMessage('无法保存设置：连接错误', 'error');
    }
};

// 保持兼容性
function saveTranslationSettings() {
    window.saveTranslationSettings();
}

/**
 * 更新翻译服务状态
 * @param {string} service - 服务名称
 * @param {number} retryCount - 重试计数
 */
function updateTranslationServiceStatus(service, retryCount = 0) {
    if (!service) {
        console.warn('更新翻译服务状态：未提供服务名称');
        service = 'google'; // 默认使用google
    }
    
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
        console.warn('部分或全部翻译服务状态元素不存在，可能DOM尚未准备好');
        return;
    }
    
    // 更新状态显示
    statusIndicator.textContent = retryCount > 0 ? `获取中...(重试 ${retryCount}/${MAX_RETRIES})` : '获取中...';
    requestsCount.textContent = '0';
    successRate.textContent = '0%';
    avgTime.textContent = '0ms';
    
    // 发送获取服务状态请求
    console.log(`获取服务状态: ${service}${retryCount > 0 ? ' (重试 ' + retryCount + ')' : ''}`);
    
    try {
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
                    
                    // 显示一条消息给用户
                    showTranslationMessage('无法获取翻译服务状态，请检查服务器连接', 'error');
                }
            }
        }, 5000);
        
        // 存储超时ID，当收到响应时可以清除
        window.currentStatusTimeoutId = timeoutId;
    } catch (error) {
        console.error('发送获取服务状态请求时出错:', error);
        updateStatusUI('error', '请求错误');
        showTranslationMessage('发送状态请求时出错: ' + error.message, 'error');
    }
}

/**
 * 显示翻译设置消息
 * @param {string} message - 消息内容
 * @param {string} type - 消息类型
 */
window.showTranslationMessage = function(message, type = 'info') {
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
};

// 保持兼容性
function showTranslationMessage(message, type = 'info') {
    window.showTranslationMessage(message, type);
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

/**
 * 加载翻译设置
 */
function loadTranslationSettings() {
    console.log('加载翻译设置...');
    
    fetch('/api/translation/config')
        .then(response => response.json())
        .then(data => {
            console.log('获取到翻译设置:', data);
            
            // 保存原始配置
            config = data;
            
            // 更新UI
            updateTranslationUI(data);
        })
        .catch(error => {
            console.error('获取翻译设置失败:', error);
        });
}

/**
 * 更新翻译通知提示
 * @param {boolean} useStreamingTranslation - 是否启用流式翻译
 */
function updateTranslationNotice(useStreamingTranslation) {
    const noticeElement = document.querySelector('.translation-notice');
    if (!noticeElement) return;
    
    if (useStreamingTranslation) {
        noticeElement.textContent = '注意：已启用实时逐字翻译，每个字都会触发翻译请求，这可能消耗更多API调用';
        noticeElement.classList.add('streaming-enabled');
    } else {
        noticeElement.textContent = '注意：翻译会在一段话完全转录后进行，而非实时逐字翻译';
        noticeElement.classList.remove('streaming-enabled');
    }
}

// 监听流式翻译设置变化
document.addEventListener('DOMContentLoaded', function() {
    const streamingTranslationCheckbox = document.getElementById('use-streaming-translation');
    if (streamingTranslationCheckbox) {
        streamingTranslationCheckbox.addEventListener('change', function() {
            updateTranslationNotice(this.checked);
        });
        
        // 初始显示
        updateTranslationNotice(streamingTranslationCheckbox.checked);
    }
});

/**
 * 更新翻译面板，显示当前配置状态
 */
function updateTranslationPanel() {
    try {
        // 获取当前配置
        const config = TranslationConfigManager.getConfig();
        if (!config) {
            console.warn('updateTranslationPanel: 无法获取配置');
            return;
        }
        
        // 更新翻译服务状态
        const activeService = config.service || 'google';
        updateTranslationServiceStatus(activeService);
        
        // 更新翻译UI
        updateTranslationUI(config);
        
        console.log('已更新翻译面板');
    } catch (error) {
        console.error('更新翻译面板时出错:', error);
    }
}

/**
 * 根据配置更新翻译UI
 */
function updateTranslationUI(config) {
    // 确保配置对象存在
    if (!config) {
        console.error('updateTranslationUI: 未提供配置对象，尝试从ConfigManager获取');
        config = TranslationConfigManager.getConfig();
        if (!config || Object.keys(config).length === 0) {
            console.error('无法获取有效的翻译配置');
            return;
        }
    }
    
    // 更新目标语言和源语言选择器
    const targetLangSelect = document.getElementById('translation-target-language');
    const sourceLangSelect = document.getElementById('translation-source-language');
    const serviceSelect = document.getElementById('translation-service');
    const apiTypeSelect = document.getElementById('translation-api-type');
    const useStreamingTranslation = document.getElementById('use-streaming-translation');
    
    // 获取当前激活的服务
    const activeService = config.service || config.active_service || 'google';
    
    if (activeService) {
        if (serviceSelect) {
            serviceSelect.value = activeService;
        }
        
        // 获取当前服务的配置
        const serviceConfig = config.services && config.services[activeService] || {};
        
        // 设置API类型
        if (apiTypeSelect && serviceConfig.use_official_api !== undefined) {
            apiTypeSelect.value = String(serviceConfig.use_official_api);
            toggleCredentialsSection(serviceConfig.use_official_api);
        }
        
        // 设置目标语言
        if (targetLangSelect && serviceConfig.target_language) {
            targetLangSelect.value = serviceConfig.target_language;
        }
        
        // 设置源语言
        if (sourceLangSelect && serviceConfig.source_language) {
            sourceLangSelect.value = serviceConfig.source_language;
        }
        
        // 设置流式翻译选项
        if (useStreamingTranslation && config.use_streaming_translation !== undefined) {
            useStreamingTranslation.checked = config.use_streaming_translation;
            // 更新翻译提示信息
            updateTranslationNotice(config.use_streaming_translation);
        }
        
        // 更新API凭证设置
        const apiKeyInput = document.getElementById('translation-api-key');
        if (apiKeyInput) {
            apiKeyInput.value = serviceConfig.api_key || '';
        }
        
        // 更新代理设置
        const proxyInput = document.getElementById('translation-proxy');
        if (proxyInput) {
            proxyInput.value = serviceConfig.proxy || '';
        }
    } else {
        console.warn('updateTranslationUI: 配置中未找到激活的翻译服务');
    }
    
    // 更新源语言信息显示
    const sourceLanguageInfo = document.getElementById('source-language-info');
    // 确保languages变量存在且有效
    const languages = config.languages || {};
    if (sourceLanguageInfo && languages) {
        const services = config.services || {};
        const service = services[activeService] || {};
        const serviceLanguages = languages[activeService];
        
        if (service && serviceLanguages) {
            const targetLang = service.target_language;
            const langName = serviceLanguages[targetLang] || targetLang;
            sourceLanguageInfo.textContent = `翻译目标: ${langName}`;
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
    // 获取翻译结果显示元素
    const resultElement = document.getElementById('translated-text');
    if (!resultElement) {
        console.error('未找到翻译结果显示元素');
        return;
    }
    
    if (result.success) {
        // 成功显示翻译结果
        const translatedText = result.translated_text;
        
        // 添加翻译结果到显示区域
        const translationElement = document.createElement('div');
        translationElement.className = 'translation-segment';
        translationElement.textContent = translatedText;
        resultElement.appendChild(translationElement);
        
        // 滚动到底部
        resultElement.scrollTop = resultElement.scrollHeight;
    } else {
        // 显示错误信息
        console.error(`翻译失败: ${result.error}`);
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
 * 更新翻译服务连接状态
 * @param {string} status - 连接状态文本
 * @param {string} type - 状态类型（success, error, warning）
 */
function updateTranslationStatus(status, type = 'info') {
    // 首先尝试获取专用的连接状态元素
    let statusElement = document.getElementById('translation-connection-status');
    
    // 如果专用元素不存在，尝试使用通用的翻译状态指示器
    if (!statusElement) {
        statusElement = document.getElementById('translation-status-indicator');
        // 如果两个元素都不存在，静默返回
        if (!statusElement) {
            return;
        }
    }
    
    statusElement.textContent = status;
    statusElement.className = 'status-value status-' + type;
} 