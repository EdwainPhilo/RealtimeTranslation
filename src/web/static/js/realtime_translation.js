/**
 * 实时翻译功能模块
 * 负责连接STT和翻译服务，展示翻译结果
 * 注意：现在只处理最终翻译结果，不进行流式实时翻译
 */

/**
 * 检查翻译标签页是否激活
 * @returns {boolean} 翻译标签页是否激活
 */
function isTranslationTabActive() {
    const translationTab = document.querySelector('.nav-tab[data-page="translation"]');
    if (!translationTab) return false;
    return translationTab.classList.contains('active');
}

/**
 * 实时翻译控制器类
 * 用于管理实时翻译的启动、停止、和UI更新
 */
class RealtimeTranslationController {
    /**
     * 实时翻译控制器
     * @constructor
     * @param {Object} options - 控制器选项
     */
    constructor(options = {}) {
        // 初始化状态
        this.isConnected = false;
        this.isActive = false;
        this._connectInProgress = false;
        
        // 初始化选项
        this.options = Object.assign({
            translatedTextDisplay: null,
            statusIndicator: null,
            forceInit: false
        }, options);
        
        // 初始化元素引用
        this._initUIElements(this.options);
        
        // 初始化空数据
        this.originalText = '';
        this.translatedText = '';
        this.sourceLanguage = '';
        
        // 初始化翻译面板
        this.translationPanel = {
            clear: () => {
                if (this.translatedTextDisplay) {
                    this.translatedTextDisplay.innerHTML = '';
                    console.log('已清空翻译面板');
                }
            },
            showError: (message) => {
                console.error('翻译面板错误:', message);
                if (this.translatedTextDisplay) {
                    const errorElement = document.createElement('div');
                    errorElement.className = 'translation-segment translation-error';
                    errorElement.textContent = message;
                    this.translatedTextDisplay.appendChild(errorElement);
                    this.translatedTextDisplay.scrollTop = this.translatedTextDisplay.scrollHeight;
                }
            }
        };
        
        // 注册回调函数
        this.callbacks = {
            onStart: [],
            onStop: [],
            onError: [],
            onConnectionStatusChange: []
        };
        
        // 自动连接和启动
        console.log('实时翻译控制器已初始化，功能将持续在后台运行');
        
        // 在下一个事件循环中自动启动，确保DOM已完全加载
        setTimeout(() => {
            // 无论当前是否在翻译标签页，都连接到翻译服务并自动启动
            console.log('自动连接并启动翻译服务（在后台运行）');
            this._connectEventSource();
            // 自动启动翻译
            this.start();
        }, 100); // 稍微延迟确保页面加载完成
        
        // 监听标签页切换事件
        document.addEventListener('tabChanged', (event) => {
            const tabName = event.detail.tabName;
            console.log(`页面切换至: ${tabName}`);
            
            // 如果切换到翻译页面，确保UI更新正确
            if (tabName === 'translation') {
                console.log('切换到翻译页面，确保UI正确显示');
                
                // 确保元素可见性
                if (this.translatedTextDisplay) {
                    this.translatedTextDisplay.style.display = '';
                }
                
                if (this.translationStatusIndicator) {
                    this.translationStatusIndicator.style.display = '';
                }
                
                // 如果未连接，重新建立连接
                if (!this.isConnected) {
                    this._connectEventSource();
                }
                
                // 如果未激活，自动启动
                if (!this.isActive) {
                    this.start();
                }
                
                // 刷新UI状态
                this._updateUIState();
            } else {
                // 在其他页面可以隐藏状态指示器，但保持连接
                if (this.translationStatusIndicator) {
                    this.translationStatusIndicator.style.display = 'none';
                }
            }
        });
    }
    
    /**
     * 初始化UI元素引用
     * @param {Object} options - UI元素选项
     * @private
     */
    _initUIElements(options) {
        // 无论当前在哪个标签页，都初始化UI元素
        console.log('初始化翻译UI元素');
        
        // 翻译结果显示区域
        this.translatedTextDisplay = options.translatedTextDisplay || document.getElementById('translated-text');
        
        // 翻译状态指示器 - 首先尝试options中提供的，然后查找DOM
        this.translationStatusIndicator = options.statusIndicator || document.getElementById('translation-status-indicator');
        
        // 如果未找到状态指示器，创建一个（即使在转录页面）
        if (!this.translationStatusIndicator) {
            console.log('未找到翻译状态指示器，创建新的状态指示器');
            this.translationStatusIndicator = document.createElement('div');
            this.translationStatusIndicator.id = 'translation-status-indicator';
            this.translationStatusIndicator.className = 'status-indicator';
            this.translationStatusIndicator.style.display = 'none'; // 在转录页面默认隐藏
            document.body.appendChild(this.translationStatusIndicator);
        }
        
        // 创建需要但找不到的翻译文本显示元素
        if (!this.translatedTextDisplay) {
            console.log('未找到翻译文本显示元素，创建新的显示元素');
            this.translatedTextDisplay = document.createElement('div');
            this.translatedTextDisplay.id = 'translated-text';
            this.translatedTextDisplay.style.display = 'none'; // 在转录页面默认隐藏
            document.body.appendChild(this.translatedTextDisplay);
        }
        
        // 更新UI状态
        this._updateUIState();
    }
    
    /**
     * 初始化事件监听
     * @private
     */
    _initEventListeners() {
        // 无论在哪个标签页都初始化事件监听器
        console.log('初始化翻译事件监听器');
        
        // 只有当按钮元素存在时才绑定事件
        const startTranslationBtn = document.getElementById('start-translation');
        if (startTranslationBtn) {
            console.log('绑定开始翻译按钮事件');
            this.startTranslationBtn = startTranslationBtn;
            this.startTranslationBtn.addEventListener('click', () => {
                console.log('开始翻译按钮点击（内部）');
                this.start();
            });
        }
        
        const stopTranslationBtn = document.getElementById('stop-translation');
        if (stopTranslationBtn) {
            console.log('绑定停止翻译按钮事件');
            this.stopTranslationBtn = stopTranslationBtn;
            this.stopTranslationBtn.addEventListener('click', () => {
                console.log('停止翻译按钮点击（内部）');
                this.stop();
            });
        }
        
        // 查找并绑定语言选择相关元素
        const targetLanguageSelect = document.getElementById('target-language');
        if (targetLanguageSelect) {
            this.targetLanguageSelect = targetLanguageSelect;
            this.targetLanguageSelect.addEventListener('change', this._handleLanguageChange);
        }
        
        const sourceLanguageSelect = document.getElementById('source-language');
        if (sourceLanguageSelect) {
            this.sourceLanguageSelect = sourceLanguageSelect;
            this.sourceLanguageSelect.addEventListener('change', this._handleLanguageChange);
        }
        
        const translationServiceSelect = document.getElementById('translation-service');
        if (translationServiceSelect) {
            this.translationServiceSelect = translationServiceSelect;
            this.translationServiceSelect.addEventListener('change', this._handleServiceChange);
        }
    }
    
    /**
     * 处理语言设置变更
     * @private
     */
    _handleLanguageChange = () => {
        console.log('语言设置变更');
        if (this.targetLanguageSelect) {
            this.config.targetLanguage = this.targetLanguageSelect.value;
        }
        
        if (this.sourceLanguageSelect) {
            this.config.sourceLanguage = this.sourceLanguageSelect.value;
        }
        
        this._updateConfig();
    }
    
    /**
     * 处理翻译服务变更
     * @private
     */
    _handleServiceChange = () => {
        console.log('翻译服务变更');
        if (this.translationServiceSelect) {
            this.config.service = this.translationServiceSelect.value;
        }
        
        this._updateConfig();
        
        // 更新服务状态
        if (socket && this.config.service) {
            socket.emit('get_service_stats', { service: this.config.service });
        }
    }
    
    /**
     * 更新配置
     * @param {Object} data - 配置数据
     */
    updateConfig(data) {
        if (!data) return;
        
        console.log('收到翻译配置更新:', data);
        
        // 更新翻译通知提示
        if (typeof updateTranslationNotice === 'function') {
            const config = data.config || data;
            updateTranslationNotice(config.use_streaming_translation);
        }
        
        // 如果正在进行翻译，重新建立连接以应用新配置
        if (this.isActive) {
            console.log('重新连接以应用新的翻译配置');
            this._disconnectEventSource();
            this._connectEventSource();
        }
        
        // 更新UI以反映最新配置
        this._updateUIFromConfig(data);
    }
    
    /**
     * 从配置更新UI元素
     * @param {Object} data - 配置数据
     * @private
     */
    _updateUIFromConfig(data) {
        if (!data) return;
        
        const config = data.config || data;
        const activeService = config.active_service || 'google';
        const serviceConfig = config.services && config.services[activeService] || {};
        
        // 更新界面元素
        if (this.translationServiceSelect && activeService) {
            this.translationServiceSelect.value = activeService;
        }
        
        if (this.targetLanguageSelect && serviceConfig.target_language) {
            this.targetLanguageSelect.value = serviceConfig.target_language;
        }
        
        if (this.sourceLanguageSelect && serviceConfig.source_language) {
            this.sourceLanguageSelect.value = serviceConfig.source_language;
        }
    }
    
    /**
     * 注册回调函数
     * @param {string} eventType - 事件类型
     * @param {Function} callback - 回调函数
     * @returns {boolean} - 是否成功注册
     */
    registerCallback(eventType, callback) {
        if (eventType in this.callbacks) {
            this.callbacks[eventType].push(callback);
            return true;
        }
        return false;
    }
    
    /**
     * 取消注册回调函数
     * @param {string} eventType - 事件类型
     * @param {Function} callback - 回调函数
     * @returns {boolean} - 是否成功取消注册
     */
    unregisterCallback(eventType, callback) {
        if (eventType in this.callbacks) {
            const index = this.callbacks[eventType].indexOf(callback);
            if (index !== -1) {
                this.callbacks[eventType].splice(index, 1);
                return true;
            }
        }
        return false;
    }
    
    /**
     * 触发回调函数
     * @param {string} callbackName - 回调名称
     * @param {*} data - 回调数据
     * @private
     */
    _triggerCallbacks(callbackName, data) {
        if (this.callbacks[callbackName]) {
            this.callbacks[callbackName].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`执行 ${callbackName} 回调时出错:`, error);
                }
            });
        }
    }
    
    /**
     * 启动翻译
     */
    async start() {
        if (this.isActive) {
            console.log('翻译已经在进行中');
            return;
        }
        
        try {
            console.log('启动翻译会话...');
            
            // 获取最新配置
            try {
                // 先检查TranslationConfigManager
                if (typeof TranslationConfigManager !== 'undefined' && TranslationConfigManager.getConfig()) {
                    this.config = TranslationConfigManager.getConfig();
                    console.log('使用TranslationConfigManager中的配置:', this.config);
                } else {
                    // 如果TranslationConfigManager中没有配置，从服务器获取
                    await this._fetchConfig();
                    console.log('已从服务器获取最新配置');
                }
            } catch (error) {
                console.error('获取配置失败，使用默认配置:', error);
                this._setDefaultConfig();
            }
            
            // 连接到事件源
            this._connectEventSource();
            
            // 设置为活跃状态
            this.isActive = true;
            
            // 清空翻译面板
            if (this.translationPanel) {
                this.translationPanel.clear();
            }
            
            console.log('翻译会话已启动');
        } catch (error) {
            console.error('启动翻译会话时出错:', error);
            this._handleError({message: `启动翻译失败: ${error.message}`});
            this.isActive = false;
        }
    }
    
    /**
     * 获取最新配置
     * @private
     */
    _fetchConfig() {
        return new Promise((resolve, reject) => {
            // 首先检查TranslationConfigManager是否存在且有配置
            if (typeof TranslationConfigManager !== 'undefined' && TranslationConfigManager.getConfig()) {
                console.log('从TranslationConfigManager获取翻译配置');
                const config = TranslationConfigManager.getConfig();
                this.config = config;
                resolve(config);
                return;
            }
            
            // 如果没有TranslationConfigManager或其中没有配置，从服务器获取
            console.log('从服务器获取翻译配置');
            
            try {
                // 确保socket存在并已连接
                if (!socket || !socket.connected) {
                    console.warn('Socket未连接，使用默认配置');
                    const defaultConfig = this._setDefaultConfig();
                    resolve(defaultConfig);
                    return;
                }
                
                // 添加超时处理
                let timeoutId = setTimeout(() => {
                    console.warn('获取翻译配置超时，使用默认配置');
                    const defaultConfig = this._setDefaultConfig();
                    resolve(defaultConfig);
                }, 5000);
                
                // 发送配置请求
                socket.emit('get_translation_config', {}, (response) => {
                    // 清除超时定时器
                    clearTimeout(timeoutId);
                    
                    // 详细记录响应情况
                    console.log('收到翻译配置响应:', response);
                    
                    if (!response) {
                        console.error('获取翻译配置失败：响应为空');
                        const defaultConfig = this._setDefaultConfig();
                        resolve(defaultConfig);
                        return;
                    }
                    
                    if (response.error) {
                        console.error('获取翻译配置失败:', response.error);
                        const defaultConfig = this._setDefaultConfig();
                        resolve(defaultConfig);
                        return;
                    }
                    
                    try {
                        // 获取配置，既支持新的response_data格式也支持旧的仅config格式
                        const config = response.config || response;
                        
                        // 确保config对象存在
                        if (!config) {
                            throw new Error('配置对象为空');
                        }
                        
                        // 保存配置
                        this.config = config;
                        
                        // 如果存在TranslationConfigManager，更新其配置
                        if (typeof TranslationConfigManager !== 'undefined') {
                            console.log('更新TranslationConfigManager配置');
                            TranslationConfigManager.setConfig(config);
                        }
                        
                        resolve(config);
                    } catch (err) {
                        console.error('处理翻译配置时出错:', err);
                        const defaultConfig = this._setDefaultConfig();
                        resolve(defaultConfig);
                    }
                });
            } catch (error) {
                console.error('获取翻译配置请求出错:', error);
                const defaultConfig = this._setDefaultConfig();
                resolve(defaultConfig);
            }
        });
    }
    
    /**
     * 停止翻译
     * @returns {boolean} 操作是否成功
     */
    stop() {
        console.log('停止翻译...');
        
        if (!this.isConnected) {
            console.warn('未连接到翻译服务，无法停止');
            return false;
        }
        
        if (!this.isActive) {
            console.warn('翻译已经是非活动状态，无需停止');
            return false;
        }
        
        // 发送停止请求
        if (typeof socket !== 'undefined' && socket.connected) {
            console.log('发送停止翻译请求');
            socket.emit('stop_translation', {}, (result) => {
                if (result && result.success) {
                    console.log('服务器确认停止翻译成功');
                } else {
                    console.warn('服务器停止翻译请求失败或会话未在运行中');
                }
            });
        }
        
        // 关闭SSE连接
        if (this.eventSource) {
            try {
                console.log('关闭SSE事件流连接');
                this.eventSource.close();
                this.eventSource = null;
            } catch (error) {
                console.error('关闭SSE事件流连接时出错:', error);
            }
        }
        
        // 更新状态
        this.isActive = false;
        
        // 更新UI
        this._updateUIState();
        
        // 触发回调
        this._triggerCallbacks('onStop');
        
        return true;
    }
    
    /**
     * 重置翻译会话
     * 用于修复会话状态不一致的问题
     */
    resetSession() {
        console.log('正在重置翻译会话...');
        
        try {
            // 断开事件源
            this._disconnectEventSource();
            
            // 发送重置会话请求
            if (socket) {
                socket.emit('reset_translation_session');
                
                // 监听翻译状态响应
                socket.once('translation_status', (data) => {
                    console.log('收到翻译会话重置状态:', data);
                    
                    // 更新本地状态
                    this.isActive = data.active;
                    
                    if (data.active) {
                        console.log('翻译会话已重置并激活');
                        // 重新连接事件源
                        this._connectEventSource();
                    } else {
                        console.warn('翻译会话重置但未激活:', data.message);
                    }
                    
                    // 更新UI
                    this._updateUIState();
                    
                    // 显示状态消息
                    alert('翻译会话已重置。' + data.message);
                });
            }
        } catch (error) {
            console.error('重置翻译会话时出错:', error);
            this._triggerCallbacks('onError', {
                message: '重置翻译会话失败: ' + error.message
            });
        }
    }
    
    /**
     * 连接到事件源
     * @private
     */
    _connectEventSource() {
        // 如果已连接，就不再重复连接
        if (this.eventSource && this.eventSource.connected) {
            console.log('已经连接到翻译服务，不需要重新连接');
            return;
        }

        // 添加日志
        console.log('正在连接到翻译服务...');

        // 设置连接状态
        this.setConnectionStatus('connecting');

        // 检查全局socket是否可用
        if (typeof socket !== 'undefined' && socket.connected) {
            console.log('使用全局socket连接');
            this.eventSource = socket;
            this.eventSourceOwned = false;
        } else {
            // 如果全局socket不可用，创建一个新的连接
            console.log('全局socket不可用或未连接，创建新的socket.io连接');
            this.eventSource = io({ path: '/socket.io/' });
            this.eventSourceOwned = true;
        }

        // 连接成功事件
        this.eventSource.on('connect', () => {
            console.log('已连接到实时翻译服务, socket.id =', this.eventSource.id);
            this.isConnected = true;
            this.setConnectionStatus('connected');

            // 总是在连接后立即发送启动请求，无需等待用户点击
            console.log('自动发送翻译启动请求');
            this.eventSource.emit('start_translation');

            // 主动请求配置（使用时间戳避免缓存）
            console.log('请求最新翻译配置...');
            this.eventSource.emit('get_translation_config', { _t: Date.now() }, (response) => {
                console.log('首次请求配置回调响应:', response);
                if (response) {
                    try {
                        this._handleConfigResponse(response);
                    } catch (error) {
                        console.error('处理配置响应时出错:', error);
                        this._setDefaultConfig();
                    }
                } else {
                    console.warn('配置响应为空，使用默认配置');
                    this._setDefaultConfig();
                }
            });
        });

        // 监听翻译配置事件
        this.eventSource.on('translation_config', (data) => {
            console.log('收到翻译配置事件:', data);
            this._handleConfigResponse(data);
        });

        // 监听实时翻译事件
        this.eventSource.on('realtime_translation', (data) => {
            this._handleRealtimeTranslation(data);
        });

        // 监听最终翻译事件
        this.eventSource.on('final_translation', (data) => {
            this._handleFinalTranslation(data);
        });

        // 监听连接错误
        this.eventSource.on('connect_error', (error) => {
            console.error('连接到翻译服务时出错:', error);
            this.isConnected = false;
            this.setConnectionStatus('error', error.message || '连接错误');
        });

        // 监听断开连接
        this.eventSource.on('disconnect', (reason) => {
            console.log('与翻译服务断开连接:', reason);
            this.isConnected = false;
            this.setConnectionStatus('disconnected');
            
            // 如果是因为传输关闭而断开，尝试重新连接
            if (reason === 'transport close' || reason === 'io server disconnect') {
                console.log('服务器断开连接，5秒后尝试重新连接...');
                setTimeout(() => {
                    if (!this.isConnected) {
                        this._connectEventSource();
                    }
                }, 5000); // 5秒后重试
            }
        });

        // 监听错误事件
        this.eventSource.on('error_event', (data) => {
            console.error('翻译服务错误:', data);
            this.translationPanel.showError(data.message || '翻译服务出错');
        });

        // 翻译服务状态
        this.eventSource.on('service_stats', (data) => {
            console.log('翻译服务状态:', data);
            // 更新服务状态UI
            this._updateServiceStats(data);
        });
    }
    
    /**
     * 断开事件源连接
     * @private
     */
    _disconnectEventSource() {
        // 现在使用 socket.io，所以我们只需要移除监听器
        if (typeof socket !== 'undefined') {
            console.log('移除翻译socket事件监听...');
            socket.off('realtime_translation');
            socket.off('final_translation');
            socket.off('translation_status');
        }
        
        // 更新连接状态
        this.isConnected = false;
        console.log('翻译事件监听已移除');
    }
    
    /**
     * 处理连接打开事件
     * @private
     */
    _handleConnectionOpen() {
        console.log('实时翻译事件流连接已打开');
        this.isConnected = true;
        
        // 更新UI中的连接状态指示
        if (this.translationStatusIndicator) {
            this.translationStatusIndicator.textContent = '已连接';
            this.translationStatusIndicator.classList.remove('status-error');
            this.translationStatusIndicator.classList.add('status-connected');
        }
    }
    
    /**
     * 处理连接关闭事件
     * @param {Event} event - 事件对象
     * @private
     */
    _handleConnectionClose(event) {
        // 只在确实断开时处理
        if (this.isConnected) {
            console.log('实时翻译事件流连接已关闭', event);
            this.isConnected = false;
            
            // 更新UI中的连接状态指示
            if (this.translationStatusIndicator) {
                this.translationStatusIndicator.textContent = '已断开';
                this.translationStatusIndicator.classList.remove('status-connected');
                this.translationStatusIndicator.classList.add('status-error');
            }
            
            // 如果不是主动关闭，且翻译功能仍在活跃状态，尝试重连
            if (this.isActive && this.eventSource) {
                console.log('尝试重新连接...');
                setTimeout(() => {
                    this._connectEventSource();
                }, 2000); // 2秒后重连
            }
        }
    }
    
    /**
     * 处理实时翻译事件
     * @param {Object} data - 翻译数据
     * @private
     */
    _handleRealtimeTranslation(data) {
        console.log('收到实时翻译:', data);
        
        try {
            // 提取翻译数据
            const translatedText = data.translated_text || '';
            
            // 更新翻译文本显示
            if (this.translatedTextDisplay) {
                this.translatedTextDisplay.textContent = translatedText;
                console.log('已更新翻译文本显示:', translatedText);
            } else {
                console.warn('translatedTextDisplay元素未找到');
            }
            
            // 触发回调
            this._triggerCallbacks('onRealtimeTranslation', data);
        } catch (error) {
            console.error('处理实时翻译时出错:', error);
        }
    }
    
    /**
     * 处理最终翻译结果
     * @private
     * @param {Object} data - 翻译数据
     */
    _handleFinalTranslation(data) {
        try {
            console.log('收到最终翻译结果:', data);
            
            // 如果数据无效，则返回
            if (!data) {
                console.warn('收到无效的翻译数据 (data为空)');
                return;
            }
            
            // 获取翻译页面文本显示区域，无论当前页面是什么
            const translatedTextDisplay = document.getElementById('translated-text');
            if (!translatedTextDisplay) {
                console.error('找不到翻译文本显示区域');
                return;
            }
            
            // 处理翻译失败的情况，显示错误信息
            if (data.success === false || data.error) {
                console.warn('翻译失败:', data.error || '未知错误');
                
                // 创建翻译错误元素
                const errorElement = document.createElement('div');
                errorElement.className = 'translation-segment translation-error';
                errorElement.textContent = data.error ? `翻译失败: ${data.error}` : '翻译失败';
                
                // 添加到翻译显示区域
                translatedTextDisplay.appendChild(errorElement);
                
                // 滚动到底部
                translatedTextDisplay.scrollTop = translatedTextDisplay.scrollHeight;
                return;
            }
            
            // 如果translated_text不存在或为空，尝试获取error信息
            if (!data.translated_text || data.translated_text.trim() === '') {
                console.warn('翻译结果为空');
                
                // 创建翻译警告元素
                const warningElement = document.createElement('div');
                warningElement.className = 'translation-segment translation-warning';
                warningElement.textContent = '翻译结果为空';
                
                // 添加到翻译显示区域
                translatedTextDisplay.appendChild(warningElement);
                
                // 滚动到底部
                translatedTextDisplay.scrollTop = translatedTextDisplay.scrollHeight;
                return;
            }
            
            // 处理成功的翻译结果
            // 创建翻译结果元素
            const translationElement = document.createElement('div');
            translationElement.className = 'translation-segment';
            
            // 如果有检测到的语言，显示语言信息
            if (data.detected_language && data.detected_language !== 'auto') {
                const detectedLang = document.createElement('span');
                detectedLang.className = 'detected-language';
                detectedLang.textContent = `[${data.detected_language}] `;
                translationElement.appendChild(detectedLang);
            }
            
            // 添加翻译文本
            const textSpan = document.createElement('span');
            textSpan.textContent = data.translated_text;
            translationElement.appendChild(textSpan);
            
            // 添加到翻译显示区域
            translatedTextDisplay.appendChild(translationElement);
            
            // 滚动到底部
            translatedTextDisplay.scrollTop = translatedTextDisplay.scrollHeight;
            
            // 更新内部状态
            this.translatedText = data.translated_text;
            this.sourceLanguage = data.detected_language || '';
            
            // 触发 socket.io 翻译结果事件，兼容其他依赖此事件的代码
            if (socket && socket.connected) {
                socket.emit('translation_result', {
                    success: true,
                    original_text: data.original_text,
                    translated_text: data.translated_text,
                    detected_language: data.detected_language || '',
                    detected_language_name: data.detected_language_name || ''
                });
            }
        } catch (error) {
            console.error('处理最终翻译结果时出错:', error);
            
            try {
                // 尝试在UI上显示错误
                const translatedTextDisplay = document.getElementById('translated-text');
                if (translatedTextDisplay) {
                    const errorElement = document.createElement('div');
                    errorElement.className = 'translation-segment translation-error';
                    errorElement.textContent = `处理翻译结果时出错: ${error.message || '未知错误'}`;
                    translatedTextDisplay.appendChild(errorElement);
                    translatedTextDisplay.scrollTop = translatedTextDisplay.scrollHeight;
                }
            } catch (uiError) {
                console.error('显示翻译错误时出错:', uiError);
            }
        }
    }
    
    /**
     * 处理错误事件
     * @param {Object} error - 错误对象，可能包含message字段
     * @private
     */
    _handleError(error) {
        try {
            console.error('翻译错误:', error);
            
            // 获取错误消息
            let errorMessage = '未知错误';
            if (typeof error === 'string') {
                errorMessage = error;
            } else if (error.message) {
                errorMessage = error.message;
            } else if (error.data) {
                try {
                    // 尝试解析data字段，可能是JSON字符串
                    const parsedData = typeof error.data === 'string' ? JSON.parse(error.data) : error.data;
                    errorMessage = parsedData.message || '未知错误';
                } catch (parseError) {
                    errorMessage = String(error.data);
                }
            }
            
            // 更新UI显示错误
            if (this.translatedTextDisplay) {
                const errorElement = document.createElement('div');
                errorElement.classList.add('translation-error');
                errorElement.textContent = '错误: ' + errorMessage;
                
                this.translatedTextDisplay.appendChild(errorElement);
                
                // 自动滚动到底部
                this.translatedTextDisplay.scrollTop = this.translatedTextDisplay.scrollHeight;
            } else if (this.translationPanel && typeof this.translationPanel.showError === 'function') {
                this.translationPanel.showError(errorMessage);
            }
            
            // 触发回调
            this._triggerCallbacks('onError', { message: errorMessage });
        } catch (handlingError) {
            console.error('处理错误事件时出错:', handlingError);
        }
    }
    
    /**
     * 更新UI状态以反映当前控制器状态
     * @private
     */
    _updateUIState() {
        console.log('更新UI状态, 翻译激活状态:', this.isActive);
        
        // 如果DOM元素未找到，再次尝试查找
        if (!this.translatedTextDisplay) {
            this.translatedTextDisplay = document.getElementById('translated-text');
            if (!this.translatedTextDisplay) {
                console.warn('未找到翻译文本显示元素');
            }
        }
        
        // 更新翻译状态指示器
        if (!this.translationStatusIndicator) {
            this.translationStatusIndicator = document.getElementById('translation-status-indicator');
        }
        
        if (this.translationStatusIndicator) {
            if (this.isActive) {
                this.translationStatusIndicator.textContent = '翻译中';
                this.translationStatusIndicator.classList.remove('status-inactive');
                this.translationStatusIndicator.classList.add('status-active');
            } else if (this.isConnected) {
                this.translationStatusIndicator.textContent = '已连接';
                this.translationStatusIndicator.classList.remove('status-inactive');
                this.translationStatusIndicator.classList.add('status-active');
            } else {
                this.translationStatusIndicator.textContent = '未连接';
                this.translationStatusIndicator.classList.remove('status-active');
                this.translationStatusIndicator.classList.add('status-inactive');
            }
        } else {
            console.log('未找到翻译状态指示器元素');
        }
    }
    
    /**
     * 清空显示文本
     */
    clearDisplay() {
        console.log('清空翻译显示');
        
        // 如果页面加载时DOM元素未找到，再次尝试查找
        if (!this.translatedTextDisplay) {
            this._findElements();
        }
        
        // 清空翻译显示
        if (this.translatedTextDisplay) {
            this.translatedTextDisplay.innerHTML = '';
        } else {
            console.warn('未找到翻译文本显示元素，无法清空');
        }
        
        console.log('翻译显示区域已清空');
    }
    
    /**
     * 加载翻译语言选项
     */
    async loadLanguageOptions() {
        try {
            const response = await fetch('/api/translation/languages');
            const data = await response.json();
            
            if (data.success) {
                // 填充目标语言选择器
                if (this.targetLanguageSelect) {
                    this.targetLanguageSelect.innerHTML = '';
                    Object.entries(data.languages).forEach(([code, name]) => {
                        const option = document.createElement('option');
                        option.value = code;
                        option.textContent = name;
                        this.targetLanguageSelect.appendChild(option);
                    });
                    
                    // 设置默认选中值
                    if (this.config.targetLanguage) {
                        this.targetLanguageSelect.value = this.config.targetLanguage;
                    }
                }
                
                // 填充源语言选择器 (通常包含"自动检测"选项)
                if (this.sourceLanguageSelect) {
                    this.sourceLanguageSelect.innerHTML = '';
                    
                    // 添加自动检测选项
                    const autoOption = document.createElement('option');
                    autoOption.value = 'auto';
                    autoOption.textContent = '自动检测';
                    this.sourceLanguageSelect.appendChild(autoOption);
                    
                    // 添加其他语言选项
                    Object.entries(data.languages).forEach(([code, name]) => {
                        const option = document.createElement('option');
                        option.value = code;
                        option.textContent = name;
                        this.sourceLanguageSelect.appendChild(option);
                    });
                    
                    // 设置默认选中值
                    if (this.config.sourceLanguage) {
                        this.sourceLanguageSelect.value = this.config.sourceLanguage;
                    }
                }
            } else {
                console.error('加载语言列表失败:', data.error);
            }
        } catch (error) {
            console.error('请求语言列表时出错:', error);
        }
    }
    
    /**
     * 加载翻译服务选项
     */
    async loadServiceOptions() {
        try {
            const response = await fetch('/api/translation/services');
            const data = await response.json();
            
            if (data.success) {
                // 填充服务选择器
                if (this.translationServiceSelect) {
                    this.translationServiceSelect.innerHTML = '';
                    data.services.forEach(service => {
                        const option = document.createElement('option');
                        option.value = service;
                        option.textContent = service.charAt(0).toUpperCase() + service.slice(1);
                        this.translationServiceSelect.appendChild(option);
                    });
                    
                    // 设置默认选中值
                    if (this.config.service) {
                        this.translationServiceSelect.value = this.config.service;
                    }
                }
            } else {
                console.error('加载服务列表失败:', data.error);
            }
        } catch (error) {
            console.error('请求服务列表时出错:', error);
        }
    }
    
    /**
     * 加载当前翻译配置
     */
    async loadConfig() {
        try {
            const response = await fetch('/api/translation/config');
            const data = await response.json();
            
            if (data.success) {
                // 更新配置
                this.config = {
                    targetLanguage: data.config.target_language || 'zh-CN',
                    sourceLanguage: data.config.source_language || 'auto',
                    service: data.config.service || 'google'
                };
                
                // 更新UI选择器
                if (this.targetLanguageSelect) {
                    this.targetLanguageSelect.value = this.config.targetLanguage;
                }
                
                if (this.sourceLanguageSelect) {
                    this.sourceLanguageSelect.value = this.config.sourceLanguage;
                }
                
                if (this.translationServiceSelect && this.config.service) {
                    this.translationServiceSelect.value = this.config.service;
                }
                
                console.log('已加载翻译配置');
            } else {
                console.error('加载翻译配置失败:', data.error);
            }
        } catch (error) {
            console.error('请求翻译配置时出错:', error);
        }
    }
    
    /**
     * 初始化翻译设置
     */
    async initSettings() {
        await this.loadLanguageOptions();
        await this.loadServiceOptions();
        await this.loadConfig();
    }

    /**
     * 初始化控制器
     */
    initialize() {
        console.log('初始化实时翻译控制器');
        
        // 查找DOM元素
        this._findElements();
        
        // 注册事件监听器
        this._registerEventListeners();
        
        // 尝试获取翻译配置
        this._fetchConfig();
        
        console.log('实时翻译控制器初始化完成');
    }
    
    /**
     * 查找DOM元素
     * @private
     */
    _findElements() {
        // 查找翻译结果显示元素和状态指示器
        this.translatedTextDisplay = document.getElementById('translated-text');
        this.translationStatusIndicator = document.getElementById('translation-status-indicator');
        
        // 记录元素查找状态
        console.log('DOM元素查找状态:', {
            'translatedTextDisplay': !!this.translatedTextDisplay,
            'translationStatusIndicator': !!this.translationStatusIndicator
        });
        
        // 创建需要但找不到的翻译文本显示元素
        if (!this.translatedTextDisplay) {
            console.log('未找到翻译文本显示元素，创建新的显示元素');
            this.translatedTextDisplay = document.createElement('div');
            this.translatedTextDisplay.id = 'translated-text';
            // 保持可见，以便在标签间切换时能够显示翻译内容
            document.body.appendChild(this.translatedTextDisplay);
        }
        
        // 创建需要但找不到的状态指示器
        if (!this.translationStatusIndicator) {
            console.log('未找到翻译状态指示器，创建新的状态指示器');
            this.translationStatusIndicator = document.createElement('div');
            this.translationStatusIndicator.id = 'translation-status-indicator';
            this.translationStatusIndicator.className = 'status-indicator';
            document.body.appendChild(this.translationStatusIndicator);
        }
    }
    
    /**
     * 注册事件监听器
     * @private
     */
    _registerEventListeners() {
        // 获取控制按钮
        const startButton = document.getElementById('start-translation');
        const stopButton = document.getElementById('stop-translation');
        
        // 为开始按钮添加事件监听
        if (startButton) {
            startButton.addEventListener('click', () => {
                console.log('开始翻译按钮点击');
                this.start();
            });
        } else {
            console.warn('未找到开始翻译按钮');
        }
        
        // 为停止按钮添加事件监听
        if (stopButton) {
            stopButton.addEventListener('click', () => {
                console.log('停止翻译按钮点击');
                this.stop();
            });
        } else {
            console.warn('未找到停止翻译按钮');
        }
        
        // 监听页面切换事件
        document.addEventListener('tabChanged', (event) => {
            const tabName = event.detail.tabName;
            console.log(`页面切换至: ${tabName}`);
            
            if (tabName === 'translation' && !this.isActive) {
                // 当切换到翻译页面时，如果翻译未激活，自动启动
                console.log('切换到翻译页面，自动启动翻译');
                this.start();
            }
        });
    }

    /**
     * 设置默认配置
     * @private
     */
    _setDefaultConfig() {
        const defaultConfig = {
            active_service: 'google',
            use_streaming_translation: false,
            services: {
                google: {
                    use_official_api: false,
                    target_language: 'zh-CN',
                    source_language: 'auto'
                }
            },
            languages: {
                google: {
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
        };
        
        console.log('创建默认翻译配置:', defaultConfig);
        this.config = defaultConfig;
        
        // 如果存在TranslationConfigManager，并且它还没有配置，则更新其配置
        if (typeof TranslationConfigManager !== 'undefined') {
            if (!TranslationConfigManager.getConfig()) {
                console.log('更新TranslationConfigManager默认配置');
                TranslationConfigManager.setConfig(defaultConfig);
            } else {
                console.log('TranslationConfigManager已有配置，不覆盖');
            }
        }
        
        return defaultConfig;
    }

    /**
     * 设置连接状态并更新UI
     * @param {string} status - 连接状态: 'connecting', 'connected', 'disconnected', 'error'
     * @param {string} message - 可选的状态消息
     */
    setConnectionStatus(status, message = '') {
        console.log(`设置连接状态: ${status}${message ? ', ' + message : ''}`);
        
        // 更新内部状态
        this.isConnected = status === 'connected';
        
        // 更新UI显示
        if (this.translationStatusIndicator) {
            // 移除所有状态类
            this.translationStatusIndicator.classList.remove(
                'status-connecting', 
                'status-connected', 
                'status-disconnected', 
                'status-error'
            );
            
            // 添加当前状态类
            this.translationStatusIndicator.classList.add(`status-${status}`);
            
            // 更新文本
            let statusText = '';
            switch (status) {
                case 'connecting':
                    statusText = '正在连接...';
                    break;
                case 'connected':
                    statusText = '已连接';
                    break;
                case 'disconnected':
                    statusText = '已断开';
                    break;
                case 'error':
                    statusText = message || '连接错误';
                    break;
                default:
                    statusText = status;
            }
            
            this.translationStatusIndicator.textContent = statusText;
        } else {
            console.warn('未找到翻译状态指示器，无法更新状态UI');
        }
        
        // 触发状态变更回调
        this._triggerCallbacks('onConnectionStatusChange', { status, message });
    }

    /**
     * 更新服务状态UI
     * @param {Object} data - 服务状态数据
     * @private
     */
    _updateServiceStats(data) {
        if (!data) return;
        
        console.log('更新服务状态UI:', data);
        
        try {
            // 查找状态显示元素
            const serviceStatsContainer = document.getElementById('translation-service-stats');
            if (!serviceStatsContainer) {
                console.warn('未找到服务状态容器元素');
                return;
            }
            
            // 清空当前状态
            serviceStatsContainer.innerHTML = '';
            
            // 创建状态信息元素
            const statusElement = document.createElement('div');
            statusElement.className = 'service-status';
            
            // 添加服务名称
            const serviceNameElement = document.createElement('span');
            serviceNameElement.className = 'service-name';
            serviceNameElement.textContent = `${data.service || '未知服务'}: `;
            statusElement.appendChild(serviceNameElement);
            
            // 添加状态指示器
            const statusIndicator = document.createElement('span');
            statusIndicator.className = `status-indicator ${data.available ? 'available' : 'unavailable'}`;
            statusIndicator.textContent = data.available ? '可用' : '不可用';
            statusElement.appendChild(statusIndicator);
            
            // 如果有详细信息，添加详情
            if (data.details) {
                const detailsElement = document.createElement('div');
                detailsElement.className = 'service-details';
                
                // 请求限制信息
                if (data.details.quota) {
                    const quotaElement = document.createElement('div');
                    quotaElement.className = 'quota-info';
                    quotaElement.textContent = `配额: ${data.details.quota.used || 0}/${data.details.quota.limit || '无限制'}`;
                    detailsElement.appendChild(quotaElement);
                }
                
                // 错误信息
                if (data.details.error) {
                    const errorElement = document.createElement('div');
                    errorElement.className = 'error-info';
                    errorElement.textContent = `错误: ${data.details.error}`;
                    detailsElement.appendChild(errorElement);
                }
                
                // 添加到状态容器
                statusElement.appendChild(detailsElement);
            }
            
            // 添加到页面
            serviceStatsContainer.appendChild(statusElement);
        } catch (error) {
            console.error('更新服务状态UI时出错:', error);
        }
    }

    /**
     * 处理配置响应数据
     * @param {Object} data - 配置数据
     * @private
     */
    _handleConfigResponse(data) {
        if (!data) {
            console.warn('收到空的翻译配置响应，将使用默认配置');
            this._setDefaultConfig();
            return;
        }
        
        try {
            // 检查和调试配置数据结构
            console.log('收到的翻译配置数据结构:', JSON.stringify(data, null, 2));
            
            // 提取配置信息，处理不同的响应格式
            const config = data.config || data;
            
            // 确保config对象存在并有效
            if (!config) {
                console.warn('翻译配置对象为空，将使用默认配置');
                this._setDefaultConfig();
                return;
            }
            
            // 记录语言列表信息
            if (data.languages) {
                const langCount = Object.values(data.languages).reduce((total, langs) => total + Object.keys(langs).length, 0);
                console.log(`收到语言列表，共有 ${Object.keys(data.languages).length} 个服务，总计 ${langCount} 种语言`);
            }
            
            // 获取活跃服务
            const activeService = config.active_service || 'google';
            console.log(`当前活跃的翻译服务: ${activeService}`);
            
            // 如果存在TranslationConfigManager，更新其配置
            if (typeof TranslationConfigManager !== 'undefined') {
                console.log('接收到新配置，更新TranslationConfigManager配置');
                TranslationConfigManager.setConfig(config);
                console.log('已更新TranslationConfigManager配置');
            }
            
            // 更新本地配置
            this.config = config;
            console.log('本地翻译配置已更新');
            
            // 更新UI显示
            this._updateUIFromConfig(data);
        } catch (error) {
            console.error('处理翻译配置事件时出错:', error);
            this._setDefaultConfig();
        }
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    // 创建实时翻译控制器并绑定到window对象以便全局访问
    window.realtimeTranslationController = new RealtimeTranslationController();
    
    // 确保初始化事件监听器
    window.realtimeTranslationController._initEventListeners();
    
    // 配置清空按钮等其他UI元素
    // 为清空按钮绑定事件
    const clearButton = document.getElementById('clear-translation');
    if (clearButton) {
        clearButton.addEventListener('click', function() {
            console.log('清空翻译按钮点击');
            window.realtimeTranslationController.clearDisplay();
        });
    }
    
    // 为重置按钮绑定事件
    const resetButton = document.getElementById('reset-translation');
    if (resetButton) {
        resetButton.addEventListener('click', function() {
            console.log('重置翻译会话按钮点击');
            if (confirm('确定要重置翻译会话状态吗？这将尝试修复会话状态不一致的问题。')) {
                window.realtimeTranslationController.resetSession();
            }
        });
    }
}); 