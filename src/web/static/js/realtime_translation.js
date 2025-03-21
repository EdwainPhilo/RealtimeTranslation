/**
 * 实时翻译功能模块
 * 负责连接STT和翻译服务，展示实时翻译结果
 */

// 实时翻译控制器
class RealtimeTranslationController {
    constructor() {
        // 状态标志
        this.isActive = false;
        this.isConnected = false;
        
        // 事件源
        this.eventSource = null;
        
        // 回调函数
        this.callbacks = {
            onRealtimeTranslation: [], 
            onFinalTranslation: [],
            onStart: [],
            onStop: [],
            onError: []
        };
        
        // 配置
        this.config = {
            targetLanguage: 'zh-CN',
            sourceLanguage: 'auto',
            service: null
        };
        
        // 绑定事件处理方法，以确保this指向正确
        this._handleRealtimeTranslation = this._handleRealtimeTranslation.bind(this);
        this._handleFinalTranslation = this._handleFinalTranslation.bind(this);
        this._handleError = this._handleError.bind(this);
        this._handleConnectionOpen = this._handleConnectionOpen.bind(this);
        this._handleConnectionClose = this._handleConnectionClose.bind(this);
        
        // 初始化UI元素
        this._initUIElements();
        
        // 初始化事件监听
        this._initEventListeners();
    }
    
    /**
     * 初始化UI元素引用
     * @private
     */
    _initUIElements() {
        // 翻译控制按钮
        this.startTranslationBtn = document.getElementById('start-translation-btn');
        this.stopTranslationBtn = document.getElementById('stop-translation-btn');
        
        // 翻译结果显示区域
        this.originalTextDisplay = document.getElementById('original-text-display');
        this.translatedTextDisplay = document.getElementById('translated-text-display');
        
        // 翻译状态指示器
        this.translationStatusIndicator = document.getElementById('translation-status');
        
        // 翻译设置面板
        this.translationSettingsPanel = document.getElementById('translation-settings-panel');
        this.targetLanguageSelect = document.getElementById('target-language-select');
        this.sourceLanguageSelect = document.getElementById('source-language-select');
        this.translationServiceSelect = document.getElementById('translation-service-select');
    }
    
    /**
     * 初始化事件监听器
     * @private
     */
    _initEventListeners() {
        // 如果相关UI元素存在，添加事件监听
        if (this.startTranslationBtn) {
            this.startTranslationBtn.addEventListener('click', () => this.start());
        }
        
        if (this.stopTranslationBtn) {
            this.stopTranslationBtn.addEventListener('click', () => this.stop());
        }
        
        // 翻译设置变更监听
        if (this.targetLanguageSelect) {
            this.targetLanguageSelect.addEventListener('change', () => {
                this.config.targetLanguage = this.targetLanguageSelect.value;
                this._updateConfig();
            });
        }
        
        if (this.sourceLanguageSelect) {
            this.sourceLanguageSelect.addEventListener('change', () => {
                this.config.sourceLanguage = this.sourceLanguageSelect.value;
                this._updateConfig();
            });
        }
        
        if (this.translationServiceSelect) {
            this.translationServiceSelect.addEventListener('change', () => {
                this.config.service = this.translationServiceSelect.value;
                this._updateConfig();
            });
        }
    }
    
    /**
     * 更新翻译配置
     * @private
     */
    _updateConfig() {
        // 发送配置更新请求
        fetch('/api/translation/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                target_language: this.config.targetLanguage,
                source_language: this.config.sourceLanguage,
                service: this.config.service
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('翻译配置已更新');
            } else {
                console.error('翻译配置更新失败:', data.error);
                this._triggerCallbacks('onError', {
                    message: '翻译配置更新失败: ' + data.error
                });
            }
        })
        .catch(error => {
            console.error('发送翻译配置请求时出错:', error);
            this._triggerCallbacks('onError', {
                message: '发送翻译配置请求时出错: ' + error.message
            });
        });
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
     * @param {string} eventType - 事件类型
     * @param {Object} data - 回调数据
     * @private
     */
    _triggerCallbacks(eventType, data) {
        if (eventType in this.callbacks) {
            for (const callback of this.callbacks[eventType]) {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`执行${eventType}回调时出错:`, error);
                }
            }
        }
    }
    
    /**
     * 启动实时翻译
     * @returns {Promise<boolean>} - 是否成功启动
     */
    async start() {
        if (this.isActive) {
            console.warn('实时翻译已经在运行中');
            return false;
        }
        
        try {
            // 发送启动请求
            const response = await fetch('/api/translation/start', {
                method: 'POST'
            });
            
            const data = await response.json();
            
            if (data.success) {
                // 成功启动后，连接事件流
                this._connectEventSource();
                
                // 更新状态
                this.isActive = true;
                
                // 更新UI
                this._updateUIForActiveState();
                
                // 触发回调
                this._triggerCallbacks('onStart', {
                    timestamp: new Date().getTime()
                });
                
                console.log('实时翻译已启动');
                return true;
            } else {
                console.error('启动实时翻译失败:', data.error);
                this._triggerCallbacks('onError', {
                    message: '启动实时翻译失败: ' + data.error
                });
                return false;
            }
        } catch (error) {
            console.error('发送启动请求时出错:', error);
            this._triggerCallbacks('onError', {
                message: '发送启动请求时出错: ' + error.message
            });
            return false;
        }
    }
    
    /**
     * 停止实时翻译
     * @returns {Promise<boolean>} - 是否成功停止
     */
    async stop() {
        if (!this.isActive) {
            console.warn('实时翻译未在运行');
            return false;
        }
        
        try {
            // 关闭事件源
            this._disconnectEventSource();
            
            // 发送停止请求
            const response = await fetch('/api/translation/stop', {
                method: 'POST'
            });
            
            const data = await response.json();
            
            // 无论后端是否成功，前端都认为已停止
            // 更新状态
            this.isActive = false;
            
            // 更新UI
            this._updateUIForInactiveState();
            
            // 触发回调
            this._triggerCallbacks('onStop', {
                timestamp: new Date().getTime(),
                success: data.success
            });
            
            if (data.success) {
                console.log('实时翻译已停止');
            } else {
                console.warn('实时翻译停止请求返回错误，但前端已停止:', data.error);
            }
            
            return true;
        } catch (error) {
            console.error('发送停止请求时出错:', error);
            
            // 即使请求出错，也认为前端已停止
            this.isActive = false;
            this._updateUIForInactiveState();
            
            this._triggerCallbacks('onError', {
                message: '发送停止请求时出错: ' + error.message
            });
            
            this._triggerCallbacks('onStop', {
                timestamp: new Date().getTime(),
                success: false
            });
            
            return true; // 返回true因为前端已停止
        }
    }
    
    /**
     * 连接事件源
     * @private
     */
    _connectEventSource() {
        // 如果已存在连接，先关闭
        if (this.eventSource) {
            this._disconnectEventSource();
        }
        
        // 创建新的事件源连接
        this.eventSource = new EventSource('/api/translation/stream');
        
        // 添加事件监听
        this.eventSource.addEventListener('open', this._handleConnectionOpen);
        this.eventSource.addEventListener('error', this._handleConnectionClose);
        this.eventSource.addEventListener('realtime_translation', this._handleRealtimeTranslation);
        this.eventSource.addEventListener('final_translation', this._handleFinalTranslation);
        this.eventSource.addEventListener('error_event', this._handleError);
    }
    
    /**
     * 断开事件源连接
     * @private
     */
    _disconnectEventSource() {
        if (this.eventSource) {
            // 移除事件监听
            this.eventSource.removeEventListener('open', this._handleConnectionOpen);
            this.eventSource.removeEventListener('error', this._handleConnectionClose);
            this.eventSource.removeEventListener('realtime_translation', this._handleRealtimeTranslation);
            this.eventSource.removeEventListener('final_translation', this._handleFinalTranslation);
            this.eventSource.removeEventListener('error_event', this._handleError);
            
            // 关闭连接
            this.eventSource.close();
            this.eventSource = null;
            
            // 更新连接状态
            this.isConnected = false;
        }
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
     * @param {Event} event - 事件对象
     * @private
     */
    _handleRealtimeTranslation(event) {
        try {
            const data = JSON.parse(event.data);
            
            // 更新UI
            this._updateTranslationDisplay(data, false);
            
            // 触发回调
            this._triggerCallbacks('onRealtimeTranslation', data);
        } catch (error) {
            console.error('处理实时翻译事件时出错:', error);
            this._triggerCallbacks('onError', {
                message: '处理实时翻译事件时出错: ' + error.message
            });
        }
    }
    
    /**
     * 处理最终翻译事件
     * @param {Event} event - 事件对象
     * @private
     */
    _handleFinalTranslation(event) {
        try {
            const data = JSON.parse(event.data);
            
            // 更新UI
            this._updateTranslationDisplay(data, true);
            
            // 触发回调
            this._triggerCallbacks('onFinalTranslation', data);
        } catch (error) {
            console.error('处理最终翻译事件时出错:', error);
            this._triggerCallbacks('onError', {
                message: '处理最终翻译事件时出错: ' + error.message
            });
        }
    }
    
    /**
     * 处理错误事件
     * @param {Event} event - 事件对象
     * @private
     */
    _handleError(event) {
        try {
            const data = JSON.parse(event.data);
            console.error('翻译错误:', data.message);
            
            // 更新UI显示错误
            if (this.translatedTextDisplay) {
                const errorElement = document.createElement('div');
                errorElement.classList.add('translation-error');
                errorElement.textContent = '错误: ' + data.message;
                
                this.translatedTextDisplay.appendChild(errorElement);
                
                // 自动滚动到底部
                this.translatedTextDisplay.scrollTop = this.translatedTextDisplay.scrollHeight;
            }
            
            // 触发回调
            this._triggerCallbacks('onError', data);
        } catch (error) {
            console.error('处理错误事件时出错:', error);
        }
    }
    
    /**
     * 更新翻译显示
     * @param {Object} data - 翻译数据
     * @param {boolean} isFinal - 是否为最终结果
     * @private
     */
    _updateTranslationDisplay(data, isFinal) {
        // 更新原文显示
        if (this.originalTextDisplay) {
            const textElement = document.createElement('div');
            textElement.classList.add(isFinal ? 'final-text' : 'interim-text');
            textElement.textContent = data.original_text;
            
            if (!isFinal) {
                // 如果是实时结果，替换上一个实时结果
                const existingInterim = this.originalTextDisplay.querySelector('.interim-text');
                if (existingInterim) {
                    existingInterim.replaceWith(textElement);
                } else {
                    this.originalTextDisplay.appendChild(textElement);
                }
            } else {
                // 如果是最终结果，移除实时结果并添加最终结果
                const existingInterim = this.originalTextDisplay.querySelector('.interim-text');
                if (existingInterim) {
                    existingInterim.remove();
                }
                this.originalTextDisplay.appendChild(textElement);
            }
            
            // 自动滚动到底部
            this.originalTextDisplay.scrollTop = this.originalTextDisplay.scrollHeight;
        }
        
        // 更新翻译文本显示
        if (this.translatedTextDisplay) {
            const textElement = document.createElement('div');
            textElement.classList.add(isFinal ? 'final-text' : 'interim-text');
            textElement.textContent = data.translated_text;
            
            if (!isFinal) {
                // 如果是实时结果，替换上一个实时结果
                const existingInterim = this.translatedTextDisplay.querySelector('.interim-text');
                if (existingInterim) {
                    existingInterim.replaceWith(textElement);
                } else {
                    this.translatedTextDisplay.appendChild(textElement);
                }
            } else {
                // 如果是最终结果，移除实时结果并添加最终结果
                const existingInterim = this.translatedTextDisplay.querySelector('.interim-text');
                if (existingInterim) {
                    existingInterim.remove();
                }
                this.translatedTextDisplay.appendChild(textElement);
            }
            
            // 自动滚动到底部
            this.translatedTextDisplay.scrollTop = this.translatedTextDisplay.scrollHeight;
        }
    }
    
    /**
     * 更新UI以反映活跃状态
     * @private
     */
    _updateUIForActiveState() {
        if (this.startTranslationBtn) {
            this.startTranslationBtn.disabled = true;
        }
        
        if (this.stopTranslationBtn) {
            this.stopTranslationBtn.disabled = false;
        }
        
        if (this.translationStatusIndicator) {
            this.translationStatusIndicator.textContent = '运行中';
            this.translationStatusIndicator.classList.remove('status-inactive');
            this.translationStatusIndicator.classList.add('status-active');
        }
    }
    
    /**
     * 更新UI以反映非活跃状态
     * @private
     */
    _updateUIForInactiveState() {
        if (this.startTranslationBtn) {
            this.startTranslationBtn.disabled = false;
        }
        
        if (this.stopTranslationBtn) {
            this.stopTranslationBtn.disabled = true;
        }
        
        if (this.translationStatusIndicator) {
            this.translationStatusIndicator.textContent = '已停止';
            this.translationStatusIndicator.classList.remove('status-active');
            this.translationStatusIndicator.classList.add('status-inactive');
        }
    }
    
    /**
     * 清空翻译显示
     */
    clearDisplay() {
        if (this.originalTextDisplay) {
            this.originalTextDisplay.innerHTML = '';
        }
        
        if (this.translatedTextDisplay) {
            this.translatedTextDisplay.innerHTML = '';
        }
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
                    service: data.config.service || null
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
}

// 创建全局控制器实例
const realtimeTranslationController = new RealtimeTranslationController();

// 在文档加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    // 仅初始化控制器，但不加载设置
    // 设置将在切换到翻译标签页时加载
    console.log('实时翻译控制器已创建');
});

// 导出控制器实例供其他模块使用
window.realtimeTranslationController = realtimeTranslationController; 