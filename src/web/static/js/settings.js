// 设置面板显示/隐藏
document.addEventListener('DOMContentLoaded', function () {
    const settingsIcon = document.getElementById('settingsIcon');
    const settingsOverlay = document.getElementById('settingsOverlay');
    const closeSettings = document.getElementById('closeSettings');
    const saveSettings = document.getElementById('saveSettings');

    // 打开设置面板
    settingsIcon.addEventListener('click', function () {
        settingsOverlay.style.display = 'flex';
    });

    // 关闭设置面板
    closeSettings.addEventListener('click', function () {
        settingsOverlay.style.display = 'none';
    });

    // 保存设置前验证
    if (saveSettings) {
        saveSettings.addEventListener('click', function(e) {
            // 如果验证失败，阻止保存
            if (!validateSettings()) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        });
    }

    // 验证设置
    function validateSettings() {
        let isValid = true;
        const wakewordBackend = document.getElementById('wakeword-backend');
        
        // 清除所有验证错误
        clearValidationErrors();
        
        // 如果选择了Porcupine后端，并且唤醒词不为空，则验证access_key
        if (wakewordBackend && wakewordBackend.value === 'pvporcupine') {
            const accessKey = document.getElementById('porcupine-access-key');
            const wakeWords = document.getElementById('wake-words');
            
            // 只有当唤醒词不为空时，才要求access_key必填
            if (wakeWords && wakeWords.value.trim() && !accessKey.value.trim()) {
                showValidationError(accessKey, 'porcupine-access-key-error', 'Porcupine访问密钥不能为空（唤醒词存在时必填）');
                isValid = false;
            }
        }
        
        return isValid;
    }
    
    // 显示验证错误
    function showValidationError(element, errorId, message) {
        element.classList.add('validation-error');
        const errorElement = document.getElementById(errorId);
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        }
    }
    
    // 清除所有验证错误
    function clearValidationErrors() {
        // 移除所有验证错误类
        document.querySelectorAll('.validation-error').forEach(element => {
            element.classList.remove('validation-error');
        });
        
        // 隐藏所有错误消息
        document.querySelectorAll('.validation-error-message').forEach(element => {
            element.style.display = 'none';
        });
    }

    // 为外部区域关闭添加更精确的判断
    let mouseDownTarget = null;
    let isSelectingText = false;
    
    // 判断是否正在选择文本
    document.addEventListener('selectionchange', function() {
        isSelectingText = document.getSelection().toString().length > 0;
    });
    
    // 记录鼠标按下的目标
    settingsOverlay.addEventListener('mousedown', function(e) {
        mouseDownTarget = e.target;
    });
    
    // 只有当mousedown和mouseup都在覆盖层上时才关闭设置
    settingsOverlay.addEventListener('mouseup', function(e) {
        // 如果正在选择文本，不关闭
        if (isSelectingText) {
            setTimeout(() => { isSelectingText = false; }, 100);
            return;
        }
        
        // 只有当鼠标按下和释放都在同一个覆盖层元素上才算有效点击
        if (e.target === settingsOverlay && mouseDownTarget === settingsOverlay) {
            settingsOverlay.style.display = 'none';
        }
        
        mouseDownTarget = null;
    });

    // 阻止原始click事件关闭面板
    // 因为我们已经在mouseup中处理了关闭逻辑
    settingsOverlay.addEventListener('click', function(e) {
        if (e.target === settingsOverlay) {
            // 阻止冒泡，防止触发其他click监听器
            e.stopPropagation();
        }
    });

    // 选项卡切换
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    const asrButtons = document.getElementById('asr-buttons');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // 移除所有active类
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            // 添加active类到当前选中的选项卡
            tab.classList.add('active');
            document.getElementById(tab.dataset.tab + '-tab').classList.add('active');

            // 根据选项卡显示或隐藏按钮
            if (tab.dataset.tab === 'asr') {
                asrButtons.classList.add('active');
            } else {
                asrButtons.classList.remove('active');
            }
        });
    });

    // 高级设置切换
    const advancedToggle = document.getElementById('toggle-advanced');
    const advancedSettings = document.getElementById('advanced-settings');

    advancedToggle.addEventListener('click', function () {
        if (advancedSettings.classList.contains('show')) {
            advancedSettings.classList.remove('show');
            advancedToggle.textContent = '显示高级设置';
        } else {
            advancedSettings.classList.add('show');
            advancedToggle.textContent = '隐藏高级设置';
        }
    });

    // 全部设置切换
    const allSettingsToggle = document.getElementById('toggle-all-settings');
    const allSettings = document.getElementById('all-settings');

    if (allSettingsToggle && allSettings) {
        allSettingsToggle.addEventListener('click', function () {
            if (allSettings.classList.contains('show')) {
                allSettings.classList.remove('show');
                allSettingsToggle.textContent = '显示全部设置';
            } else {
                allSettings.classList.add('show');
                allSettingsToggle.textContent = '隐藏全部设置';
            }
        });
    }

    // 滑块值显示更新
    const sliders = [
        'silero-sensitivity',
        'webrtc-sensitivity',
        'silence-duration',
        'early-transcription-silence',
        'allowed-latency',
        'min-recording-length',
        'min-gap',
        'pre-recording-buffer',
        'realtime-processing-pause',
        'init-realtime-after',
        'wake-words-sensitivity',
        'wake-word-timeout',
        'wake-word-buffer',
        'wake-word-activation-delay'
    ];

    sliders.forEach(id => {
        const slider = document.getElementById(id);
        const valueId = id + '-value';
        const value = document.getElementById(valueId);

        if (slider && value) {
            // 初始化显示值
            value.textContent = slider.value;

            // 添加事件监听器
            slider.addEventListener('input', () => {
                value.textContent = slider.value;
            });
        }
    });
    
    // 处理唤醒词后端切换
    const wakewordBackend = document.getElementById('wakeword-backend');
    if (wakewordBackend) {
        // 初始化显示
        updateWakewordSettings(wakewordBackend.value);
        
        wakewordBackend.addEventListener('change', function() {
            updateWakewordSettings(this.value);
        });
    }
    
    // 为输入框添加input事件监听器，当用户输入内容时自动清除错误状态
    const porcupineAccessKey = document.getElementById('porcupine-access-key');
    const wakeWords = document.getElementById('wake-words');
    
    // 页面加载时初始化access_key的必填状态
    const requiredSpan = document.getElementById('access-key-required');
    if (requiredSpan && wakeWords) {
        // 如果唤醒词为空，则隐藏必填标记
        if (!wakeWords.value.trim()) {
            requiredSpan.style.display = 'none';
        }
    }
    
    if (porcupineAccessKey) {
        porcupineAccessKey.addEventListener('input', function() {
            if (this.value.trim()) {
                // 清除错误状态
                this.classList.remove('validation-error');
                const errorElement = document.getElementById('porcupine-access-key-error');
                if (errorElement) {
                    errorElement.style.display = 'none';
                }
            }
        });
    }
    
    if (wakeWords) {
        wakeWords.addEventListener('input', function() {
            if (this.value.trim()) {
                // 清除错误状态
                this.classList.remove('validation-error');
                const errorElement = document.getElementById('wake-words-error');
                if (errorElement) {
                    errorElement.style.display = 'none';
                }
                
                // 设置access_key为必填
                const requiredSpan = document.getElementById('access-key-required');
                if (requiredSpan) {
                    requiredSpan.style.display = '';
                }
            } else {
                // 设置access_key为非必填
                const requiredSpan = document.getElementById('access-key-required');
                if (requiredSpan) {
                    requiredSpan.style.display = 'none';
                }
            }
        });
    }
    
    // 更新唤醒词设置界面
    function updateWakewordSettings(backend) {
        const settingGroup = wakewordBackend.closest('.setting-group');
        
        // 移除所有激活类
        settingGroup.classList.remove('openwakeword-active');
        settingGroup.classList.remove('porcupine-active');
        settingGroup.classList.remove('disabled-active');
        
        // 添加对应的激活类
        if (backend === 'openwakeword') {
            settingGroup.classList.add('openwakeword-active');
        } else if (backend === 'pvporcupine') {
            settingGroup.classList.add('porcupine-active');
            
            // 检查唤醒词内容，更新access_key的必填标记
            const requiredSpan = document.getElementById('access-key-required');
            
            if (requiredSpan) {
                if (wakeWords && wakeWords.value.trim()) {
                    requiredSpan.style.display = '';
                } else {
                    requiredSpan.style.display = 'none';
                }
            }
        } else if (backend === 'disabled') {
            settingGroup.classList.add('disabled-active');
            // 当选择"不启用"时，实际上我们使用pvporcupine但将唤醒词设为空
            document.getElementById('wake-words').value = '';
            
            // 隐藏access_key的必填标记
            const requiredSpan = document.getElementById('access-key-required');
            if (requiredSpan) {
                requiredSpan.style.display = 'none';
            }
        }
    }

    // 如果存在翻译配置管理器，使用它来更新翻译设置
    if (typeof TranslationConfigManager !== 'undefined') {
        // 添加配置变更监听器
        TranslationConfigManager.addListener(function(config) {
            // 更新翻译设置部分
            const translationSection = document.getElementById('translation-settings-section');
            if (translationSection) {
                console.log('设置面板收到翻译配置更新:', config);
                // 调用翻译设置更新函数（如果存在）
                if (typeof updateTranslationSettingsUI === 'function') {
                    updateTranslationSettingsUI(config);
                }
            }
        });
    }

    // 初始化设置面板
    console.log('初始化设置面板...');
    
    // 检查翻译设置按钮是否存在
    const saveTranslationButton = document.getElementById('save-translation-settings');
    const refreshTranslationButton = document.getElementById('refresh-translation-languages');
    
    if (saveTranslationButton) {
        console.log('找到保存翻译设置按钮');
        saveTranslationButton.onclick = function() {
            console.log('直接绑定点击：保存翻译设置');
            if (typeof saveTranslationSettings === 'function') {
                saveTranslationSettings();
            } else {
                console.error('saveTranslationSettings函数未定义');
            }
        };
    } else {
        console.warn('未找到保存翻译设置按钮');
    }
    
    if (refreshTranslationButton) {
        console.log('找到刷新翻译语言按钮');
        refreshTranslationButton.onclick = function() {
            console.log('直接绑定点击：刷新翻译语言');
            if (typeof translationSocket !== 'undefined') {
                translationSocket.emit('get_translation_config');
                
                // 显示消息提示
                const messageElement = document.getElementById('translation-message');
                if (messageElement) {
                    messageElement.textContent = '正在刷新可用语言...';
                    messageElement.className = 'message info';
                    messageElement.classList.remove('hidden');
                    
                    // 3秒后自动隐藏
                    setTimeout(() => {
                        messageElement.classList.add('hidden');
                    }, 3000);
                }
            } else {
                console.error('translationSocket未定义');
            }
        };
    } else {
        console.warn('未找到刷新翻译语言按钮');
    }
}); 