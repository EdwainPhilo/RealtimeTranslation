let socket = io();
let displayDiv = document.getElementById('textDisplay');
let server_available = false;
let mic_available = false;
let fullSentences = [];
let currentConfig = {}; // 存储当前配置信息
let waitingForConfigUpdate = false; // 是否正在等待配置更新
let useSimplifiedChinese = true; // 是否使用简体中文
let originalFullSentences = []; // 保存原始句子（未转换前）

// 处理文本转换的辅助函数
function processText(text) {
    return useSimplifiedChinese ? window.ChineseConverter.convertToSimplified(text) : text;
}

// 更新显示文本（考虑繁简转换）
function updateDisplay() {
    displayDiv.innerHTML = originalFullSentences.map((sentence, index) => {
        const processedSentence = processText(sentence);
        let span = document.createElement('span');
        span.textContent = processedSentence + " ";
        span.className = index % 2 === 0 ? 'yellow' : 'cyan';
        return span.outerHTML;
    }).join('');
}

// 切换繁简显示模式
function toggleChineseMode() {
    useSimplifiedChinese = !useSimplifiedChinese;
    // 更新显示
    updateDisplay();
    // 更新按钮文本
    const toggleButton = document.getElementById('toggle-chinese-mode');
    if (toggleButton) {
        toggleButton.textContent = useSimplifiedChinese ? '切换到繁体' : '切换到简体';
    }

    // 保存用户偏好到localStorage
    localStorage.setItem('useSimplifiedChinese', useSimplifiedChinese ? 'true' : 'false');

    // 显示状态消息
    showStatusMessage(useSimplifiedChinese ? '已切换到简体中文' : '已切换到繁体中文', true);
}

function displayRealtimeText(realtimeText, displayDiv) {
    let displayedText = fullSentences.map((sentence, index) => {
        let span = document.createElement('span');
        span.textContent = sentence + " ";
        span.className = index % 2 === 0 ? 'yellow' : 'cyan';
        return span.outerHTML;
    }).join('');

    // 添加实时文本（如果有）
    if (realtimeText) {
        let realtimeSpan = document.createElement('span');
        realtimeSpan.textContent = realtimeText;
        realtimeSpan.className = fullSentences.length % 2 === 0 ? 'yellow' : 'cyan';
        displayedText += realtimeSpan.outerHTML;
    }

    displayDiv.innerHTML = displayedText;
}

function start_msg() {
    if (!mic_available)
        displayRealtimeText("🎤  请允许麦克风访问  🎤", displayDiv);
    else if (!server_available)
        displayRealtimeText("🖥️  请启动服务器  🖥️", displayDiv);
    else
        displayRealtimeText("👄  开始说话  👄", displayDiv);
}

// 显示状态消息
function showStatusMessage(message, isSuccess) {
    const statusElement = document.getElementById('status-message');
    if (!statusElement) return;

    statusElement.textContent = message;

    if (isSuccess) {
        statusElement.className = 'status-message success';
    } else {
        statusElement.className = 'status-message error';
    }

    // 3秒后自动隐藏
    setTimeout(() => {
        statusElement.className = 'status-message';
    }, 3000);
}

// 更新UI以匹配配置
function updateSettingsUI(config) {
    if (!config) return;

    // 更新基本设置
    if (config.model && document.getElementById('model-size')) {
        document.getElementById('model-size').value = config.model;
    }

    if (config.language !== undefined && document.getElementById('language')) {
        document.getElementById('language').value = config.language || '';
    }

    if (config.realtime_model_type && document.getElementById('realtime-model')) {
        document.getElementById('realtime-model').value = config.realtime_model_type;
    }

    // 更新转写设置
    if (config.compute_type && document.getElementById('compute-type')) {
        document.getElementById('compute-type').value = config.compute_type;
    }

    if (config.beam_size !== undefined && document.getElementById('beam-size')) {
        document.getElementById('beam-size').value = config.beam_size.toString();
    }

    if (config.batch_size !== undefined && document.getElementById('batch-size')) {
        document.getElementById('batch-size').value = config.batch_size.toString();
    }

    if (config.beam_size_realtime !== undefined && document.getElementById('beam-size-realtime')) {
        document.getElementById('beam-size-realtime').value = config.beam_size_realtime.toString();
    }

    if (config.initial_prompt !== undefined && document.getElementById('initial-prompt')) {
        document.getElementById('initial-prompt').value = config.initial_prompt || '';
    }

    if (config.initial_prompt_realtime !== undefined && document.getElementById('initial-prompt-realtime')) {
        document.getElementById('initial-prompt-realtime').value = config.initial_prompt_realtime || '';
    }

    // 更新实时转写设置
    if (config.enable_realtime_transcription !== undefined && document.getElementById('enable-realtime')) {
        document.getElementById('enable-realtime').value = config.enable_realtime_transcription ? 'true' : 'false';
    }

    if (config.use_main_model_for_realtime !== undefined && document.getElementById('use-main-model-realtime')) {
        document.getElementById('use-main-model-realtime').value = config.use_main_model_for_realtime ? 'true' : 'false';
    }

    if (config.realtime_processing_pause !== undefined && document.getElementById('realtime-processing-pause')) {
        document.getElementById('realtime-processing-pause').value = config.realtime_processing_pause;
        document.getElementById('realtime-processing-pause-value').textContent = config.realtime_processing_pause;
    }

    if (config.init_realtime_after_seconds !== undefined && document.getElementById('init-realtime-after')) {
        document.getElementById('init-realtime-after').value = config.init_realtime_after_seconds;
        document.getElementById('init-realtime-after-value').textContent = config.init_realtime_after_seconds;
    }

    if (config.realtime_batch_size !== undefined && document.getElementById('realtime-batch-size')) {
        document.getElementById('realtime-batch-size').value = config.realtime_batch_size.toString();
    }

    // 更新语音活动检测设置
    if (config.silero_sensitivity !== undefined && document.getElementById('silero-sensitivity')) {
        document.getElementById('silero-sensitivity').value = config.silero_sensitivity;
        document.getElementById('silero-value').textContent = config.silero_sensitivity;
    }

    if (config.silero_use_onnx !== undefined && document.getElementById('silero-use-onnx')) {
        document.getElementById('silero-use-onnx').value = config.silero_use_onnx ? 'true' : 'false';
    }

    if (config.silero_deactivity_detection !== undefined && document.getElementById('silero-deactivity')) {
        document.getElementById('silero-deactivity').value = config.silero_deactivity_detection ? 'true' : 'false';
    }

    if (config.webrtc_sensitivity !== undefined && document.getElementById('webrtc-sensitivity')) {
        document.getElementById('webrtc-sensitivity').value = config.webrtc_sensitivity;
        document.getElementById('webrtc-value').textContent = config.webrtc_sensitivity;
    }

    if (config.post_speech_silence_duration !== undefined && document.getElementById('silence-duration')) {
        document.getElementById('silence-duration').value = config.post_speech_silence_duration;
        document.getElementById('silence-value').textContent = config.post_speech_silence_duration;
    }

    if (config.min_length_of_recording !== undefined && document.getElementById('min-recording-length')) {
        document.getElementById('min-recording-length').value = config.min_length_of_recording;
        document.getElementById('min-recording-length-value').textContent = config.min_length_of_recording;
    }

    if (config.min_gap_between_recordings !== undefined && document.getElementById('min-gap')) {
        document.getElementById('min-gap').value = config.min_gap_between_recordings;
        document.getElementById('min-gap-value').textContent = config.min_gap_between_recordings;
    }

    if (config.pre_recording_buffer_duration !== undefined && document.getElementById('pre-recording-buffer')) {
        document.getElementById('pre-recording-buffer').value = config.pre_recording_buffer_duration;
        document.getElementById('pre-recording-buffer-value').textContent = config.pre_recording_buffer_duration;
    }

    // 更新唤醒词设置
    if (config.wakeword_backend !== undefined && document.getElementById('wakeword-backend')) {
        // 如果使用pvporcupine且唤醒词为空，则显示为"不启用"
        if (config.wakeword_backend === 'pvporcupine' && (!config.wake_words || config.wake_words === '')) {
            document.getElementById('wakeword-backend').value = 'disabled';
        } else {
            document.getElementById('wakeword-backend').value = config.wakeword_backend;
        }
        // 触发后端切换事件，更新UI显示
        const event = new Event('change');
        document.getElementById('wakeword-backend').dispatchEvent(event);
    }

    if (config.wake_words !== undefined && document.getElementById('wake-words')) {
        document.getElementById('wake-words').value = config.wake_words || '';
    }

    if (config.openwakeword_model_paths !== undefined && document.getElementById('openwakeword-models')) {
        document.getElementById('openwakeword-models').value = Array.isArray(config.openwakeword_model_paths) ?
            config.openwakeword_model_paths.join(',') :
            (config.openwakeword_model_paths || '');
    }

    if (config.openwakeword_inference_framework !== undefined && document.getElementById('openwakeword-framework')) {
        document.getElementById('openwakeword-framework').value = config.openwakeword_inference_framework;
    }

    if (config.wake_words_sensitivity !== undefined && document.getElementById('wake-words-sensitivity')) {
        document.getElementById('wake-words-sensitivity').value = config.wake_words_sensitivity;
        document.getElementById('wake-words-sensitivity-value').textContent = config.wake_words_sensitivity;
    }

    if (config.wake_word_timeout !== undefined && document.getElementById('wake-word-timeout')) {
        document.getElementById('wake-word-timeout').value = config.wake_word_timeout;
        document.getElementById('wake-word-timeout-value').textContent = config.wake_word_timeout;
    }

    if (config.wake_word_buffer_duration !== undefined && document.getElementById('wake-word-buffer')) {
        document.getElementById('wake-word-buffer').value = config.wake_word_buffer_duration;
        document.getElementById('wake-word-buffer-value').textContent = config.wake_word_buffer_duration;
    }

    if (config.wake_word_activation_delay !== undefined && document.getElementById('wake-word-activation-delay')) {
        document.getElementById('wake-word-activation-delay').value = config.wake_word_activation_delay;
        document.getElementById('wake-word-activation-delay-value').textContent = config.wake_word_activation_delay;
    }

    // 更新系统设置
    if (config.buffer_size !== undefined && document.getElementById('buffer-size')) {
        document.getElementById('buffer-size').value = config.buffer_size.toString();
    }

    if (config.sample_rate !== undefined && document.getElementById('sample-rate')) {
        document.getElementById('sample-rate').value = config.sample_rate.toString();
    }

    if (config.suppress_tokens !== undefined && document.getElementById('suppress-tokens')) {
        document.getElementById('suppress-tokens').value = config.suppress_tokens.join(',');
    }

    if (config.print_transcription_time !== undefined && document.getElementById('print-transcription-time')) {
        document.getElementById('print-transcription-time').value = config.print_transcription_time ? 'true' : 'false';
    }

    if (config.early_transcription_on_silence !== undefined && document.getElementById('early-transcription-silence')) {
        document.getElementById('early-transcription-silence').value = config.early_transcription_on_silence;
        document.getElementById('early-transcription-silence-value').textContent = config.early_transcription_on_silence;
    }

    if (config.allowed_latency_limit !== undefined && document.getElementById('allowed-latency')) {
        document.getElementById('allowed-latency').value = config.allowed_latency_limit;
        document.getElementById('allowed-latency-value').textContent = config.allowed_latency_limit;
    }

    if (config.debug_mode !== undefined && document.getElementById('debug-mode')) {
        document.getElementById('debug-mode').value = config.debug_mode ? 'true' : 'false';
    }

    if (config.handle_buffer_overflow !== undefined && document.getElementById('handle-buffer-overflow')) {
        document.getElementById('handle-buffer-overflow').value = config.handle_buffer_overflow ? 'true' : 'false';
    }

    if (config.no_log_file !== undefined && document.getElementById('no-log-file')) {
        document.getElementById('no-log-file').value = config.no_log_file ? 'true' : 'false';
    }

    if (config.use_extended_logging !== undefined && document.getElementById('use-extended-logging')) {
        document.getElementById('use-extended-logging').value = config.use_extended_logging ? 'true' : 'false';
    }
}

// 从UI获取当前配置
function getConfigFromUI() {
    const config = {
        // 基本设置
        'model': document.getElementById('model-size').value,
        'language': document.getElementById('language').value,
        'download_root': null,
        'compute_type': document.getElementById('compute-type').value,
        'input_device_index': null,
        'gpu_device_index': 0,
        'device': 'cuda',
        'spinner': false,
        'use_microphone': false,
        'ensure_sentence_starting_uppercase': true,
        'ensure_sentence_ends_with_period': true,
        'batch_size': parseInt(document.getElementById('batch-size').value),
        'level': 30, // WARNING 级别

        // 实时转写设置
        'enable_realtime_transcription': document.getElementById('enable-realtime').value === 'true',
        'use_main_model_for_realtime': document.getElementById('use-main-model-realtime').value === 'true',
        'realtime_model_type': document.getElementById('realtime-model').value,
        'realtime_processing_pause': parseFloat(document.getElementById('realtime-processing-pause').value),
        'init_realtime_after_seconds': parseFloat(document.getElementById('init-realtime-after').value),
        'realtime_batch_size': parseInt(document.getElementById('realtime-batch-size').value),

        // 语音活动检测设置
        'silero_sensitivity': parseFloat(document.getElementById('silero-sensitivity').value),
        'silero_use_onnx': document.getElementById('silero-use-onnx').value === 'true',
        'silero_deactivity_detection': document.getElementById('silero-deactivity').value === 'true',
        'webrtc_sensitivity': parseInt(document.getElementById('webrtc-sensitivity').value),
        'post_speech_silence_duration': parseFloat(document.getElementById('silence-duration').value),
        'min_length_of_recording': parseFloat(document.getElementById('min-recording-length').value),
        'min_gap_between_recordings': parseFloat(document.getElementById('min-gap').value),
        'pre_recording_buffer_duration': parseFloat(document.getElementById('pre-recording-buffer').value),

        // 唤醒词设置
        'wakeword_backend': document.getElementById('wakeword-backend').value === 'disabled' ? 'pvporcupine' : document.getElementById('wakeword-backend').value,
        'openwakeword_model_paths': document.getElementById('openwakeword-models') ?
            document.getElementById('openwakeword-models').value.trim() || null :
            null,
        'openwakeword_inference_framework': document.getElementById('openwakeword-framework') ?
            document.getElementById('openwakeword-framework').value :
            "onnx",
        'wake_words': document.getElementById('wakeword-backend').value === 'disabled' ? '' : document.getElementById('wake-words').value,
        'wake_words_sensitivity': parseFloat(document.getElementById('wake-words-sensitivity').value),
        'wake_word_activation_delay': parseFloat(document.getElementById('wake-word-activation-delay').value),
        'wake_word_timeout': parseFloat(document.getElementById('wake-word-timeout').value),
        'wake_word_buffer_duration': parseFloat(document.getElementById('wake-word-buffer').value),

        // 高级设置
        'beam_size': parseInt(document.getElementById('beam-size').value),
        'beam_size_realtime': parseInt(document.getElementById('beam-size-realtime').value),
        'buffer_size': parseInt(document.getElementById('buffer-size').value),
        'sample_rate': parseInt(document.getElementById('sample-rate').value),
        'initial_prompt': document.getElementById('initial-prompt').value || null,
        'initial_prompt_realtime': document.getElementById('initial-prompt-realtime').value || null,
        'suppress_tokens': [-1], // 解析suppress-tokens的值可能需要更复杂的逻辑
        'print_transcription_time': document.getElementById('print-transcription-time').value === 'true',
        'early_transcription_on_silence': parseFloat(document.getElementById('early-transcription-silence').value),
        'allowed_latency_limit': parseFloat(document.getElementById('allowed-latency').value),
        'debug_mode': document.getElementById('debug-mode').value === 'true',
        'handle_buffer_overflow': document.getElementById('handle-buffer-overflow').value === 'true',
        'no_log_file': document.getElementById('no-log-file').value === 'true',
        'use_extended_logging': document.getElementById('use-extended-logging').value === 'true'
    };

    // 处理suppress-tokens
    if (document.getElementById('suppress-tokens').value) {
        try {
            const tokens = document.getElementById('suppress-tokens').value.split(',').map(t => parseInt(t.trim()));
            if (tokens.length > 0 && !isNaN(tokens[0])) {
                config.suppress_tokens = tokens;
            }
        } catch (e) {
            console.warn("无法解析suppress-tokens值，使用默认值");
        }
    }

    return config;
}

// 初始化Socket.IO连接
socket.on('connect', function () {
    server_available = true;
    start_msg();

    // 连接后请求当前配置
    socket.emit('get_config');
});

socket.on('disconnect', function () {
    server_available = false;
    start_msg();
});

// 处理模型路径重置事件
socket.on('model_path_reset', function(data) {
    console.warn('模型路径重置:', data);
    
    // 显示通知
    showStatusMessage(data.message, false);
    
    // 如果当前正在设置页面，更新UI并高亮显示
    const modelPathInput = document.getElementById('openwakeword-models');
    if (modelPathInput) {
        // 清空输入框
        modelPathInput.value = '';
        
        // 显示重置的详细信息
        showValidationError('openwakeword-models', 
            `检测到无效模型文件，已自动重置路径。\n原因: ${data.error}`);
        
        // 更新配置
        if (currentConfig) {
            currentConfig.openwakeword_model_paths = null;
        }
    }
});

socket.on('realtime', function (data) {
    if (data.type === 'realtime') {
        // 使用辅助函数处理文本
        const processedText = processText(data.text);
        displayRealtimeText(processedText, displayDiv);
    }
});

socket.on('fullSentence', function (data) {
    if (data.type === 'fullSentence') {
        // 保存原始句子（未转换）
        originalFullSentences.push(data.text);
        // 使用辅助函数处理文本
        const processedText = processText(data.text);
        fullSentences.push(processedText);

        // 更新显示
        updateDisplay();
    }
});

// 接收服务器配置
socket.on('config', function (config) {
    currentConfig = config;
    updateSettingsUI(config);
    console.log('收到服务器配置:', config);
});

// 配置更新响应
socket.on('config_updated', function (response) {
    if (response.success) {
        currentConfig = response.config;
        updateSettingsUI(response.config);
        showStatusMessage('设置已成功应用，等待录音机就绪...', true);
        // 记录正在等待录音机就绪
        waitingForConfigUpdate = true;
    } else {
        showStatusMessage('设置应用失败: ' + response.error, false);
        // 配置更新失败，重置等待状态
        waitingForConfigUpdate = false;
    }
});

// 设置录音机状态
socket.on('recorder_status', function (data) {
    if (data.ready) {
        if (waitingForConfigUpdate) {
            // 如果是配置更新后的状态变更，则关闭设置面板
            waitingForConfigUpdate = false;
            showStatusMessage('录音机已准备就绪', true);

            // 延迟一秒关闭设置面板，让用户看到成功消息
            setTimeout(() => {
                const settingsOverlay = document.getElementById('settingsOverlay');
                if (settingsOverlay) {
                    settingsOverlay.style.display = 'none';
                }
            }, 1000);
        } else {
            showStatusMessage('录音机已准备就绪', true);
        }
    } else {
        showStatusMessage('录音机未就绪', false);
    }
});

// 处理应用重启消息
socket.on('restart_required', function (data) {
    console.log('应用即将重启:', data);

    // 创建重启提示对话框
    const restartDialog = document.createElement('div');
    restartDialog.style.position = 'fixed';
    restartDialog.style.top = '50%';
    restartDialog.style.left = '50%';
    restartDialog.style.transform = 'translate(-50%, -50%)';
    restartDialog.style.backgroundColor = '#333';
    restartDialog.style.color = '#fff';
    restartDialog.style.padding = '20px';
    restartDialog.style.borderRadius = '8px';
    restartDialog.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.3)';
    restartDialog.style.zIndex = '2000';
    restartDialog.style.textAlign = 'center';

    // 添加图标和文字
    restartDialog.innerHTML = `
        <div style="font-size: 24px; margin-bottom: 15px;">
            <i class="fas fa-sync-alt" style="color: #00aaff;"></i>
        </div>
        <div style="font-size: 18px; margin-bottom: 15px;">
            ${data.message || '应用正在重启...'}
        </div>
        <div style="font-size: 16px;" id="restart-countdown">
            页面将在 <span style="color: #00aaff; font-weight: bold;">${data.countdown || 5}</span> 秒后自动刷新
        </div>
    `;

    // 添加到页面
    document.body.appendChild(restartDialog);

    // 设置倒计时
    let countdown = data.countdown || 5;
    const countdownInterval = setInterval(() => {
        countdown--;
        const countdownElement = document.getElementById('restart-countdown');
        if (countdownElement) {
            countdownElement.innerHTML = `页面将在 <span style="color: #00aaff; font-weight: bold;">${countdown}</span> 秒后自动刷新`;
        }

        if (countdown <= 0) {
            clearInterval(countdownInterval);
            // 刷新页面
            window.location.reload();
        }
    }, 1000);
});

start_msg();

// 当DOM加载完成，设置按钮事件
document.addEventListener('DOMContentLoaded', function () {
    const applySettingsBtn = document.getElementById('apply-settings');
    if (applySettingsBtn) {
        applySettingsBtn.addEventListener('click', async function () {
            const config = getConfigFromUI();
            
            // 验证OpenWakeWord模型路径
            if (config.wakeword_backend === 'openwakeword' && document.getElementById('openwakeword-models')) {
                const pathsString = document.getElementById('openwakeword-models').value;
                
                // 首先进行格式验证
                const formatValidation = validateOpenWakeWordPaths(pathsString);
                if (!formatValidation.valid) {
                    showValidationError('openwakeword-models', formatValidation.message);
                    showStatusMessage('设置验证失败，请修正错误后重试', false);
                    return; // 阻止提交
                }
                
                // 然后验证文件是否存在（如果路径不为空）
                if (pathsString.trim()) {
                    try {
                        showStatusMessage('正在验证文件路径...', true);
                        const fileValidation = await validateFilePath(pathsString);
                        
                        // 显示验证结果
                        showFileValidationResult('openwakeword-models', fileValidation);
                        
                        // 如果验证失败，阻止提交
                        if (!fileValidation.valid) {
                            showStatusMessage('文件路径验证失败，请修正错误后重试', false);
                            return;
                        }
                    } catch (error) {
                        console.error('文件验证出错:', error);
                        // 如果验证过程出错，仍然允许提交，但显示警告
                        showStatusMessage('文件验证过程出错，将继续提交设置，但可能导致录音服务启动失败', false);
                    }
                }
                
                clearValidationError('openwakeword-models', true); // 显示成功状态
            }
            
            socket.emit('update_config', config);
            console.log('发送配置到服务器:', config);
            
            // 显示正在更新的消息
            showStatusMessage('正在应用设置...', true);
            // 不立即关闭设置面板，而是等待响应
            waitingForConfigUpdate = true;
        });
    }

    // 恢复默认设置按钮
    const resetToDefaultBtn = document.getElementById('reset-to-default');
    if (resetToDefaultBtn) {
        resetToDefaultBtn.addEventListener('click', function () {
            if (confirm('确定要恢复所有设置到默认值吗？此操作无法撤销。')) {
                socket.emit('reset_to_default');
                console.log('发送恢复默认设置请求');

                // 显示正在恢复的消息
                showStatusMessage('正在恢复默认设置...', true);
            }
        });
    }

    // 从localStorage加载用户的简繁中文偏好
    const savedPreference = localStorage.getItem('useSimplifiedChinese');
    if (savedPreference !== null) {
        useSimplifiedChinese = savedPreference === 'true';
        // 更新切换按钮文本
        const toggleButton = document.getElementById('toggle-chinese-mode');
        if (toggleButton) {
            toggleButton.textContent = useSimplifiedChinese ? '切换到繁体' : '切换到简体';
        }
    }

    // 获取按钮和对话框元素
    const shutdownIcon = document.getElementById('shutdownIcon');
    const shutdownDialog = document.getElementById('shutdownConfirmDialog');
    const confirmShutdownBtn = document.getElementById('confirmShutdown');
    const cancelShutdownBtn = document.getElementById('cancelShutdown');

    // 显示确认对话框
    shutdownIcon.addEventListener('click', function () {
        shutdownDialog.style.display = 'flex';
    });

    // 取消关闭
    cancelShutdownBtn.addEventListener('click', function () {
        shutdownDialog.style.display = 'none';
    });

    // 确认关闭
    confirmShutdownBtn.addEventListener('click', function () {
        shutdownDialog.style.display = 'none';

        // 发送关闭请求到服务器
        socket.emit('shutdown_service');

        // 显示关闭状态
        displayDiv.innerHTML = '<span class="shutdown-message">服务正在关闭，请稍候...</span>';
    });

    // 点击对话框外部区域关闭对话框
    shutdownDialog.addEventListener('click', function (event) {
        if (event.target === shutdownDialog) {
            shutdownDialog.style.display = 'none';
        }
    });

    // 监听服务关闭事件
    socket.on('service_shutdown', function (data) {
        console.log('服务正在关闭:', data);

        // 显示关闭倒计时
        displayDiv.innerHTML = `<span class="shutdown-message">服务正在关闭，${data.countdown}秒后将自动断开连接...</span>`;

        // 倒计时结束后刷新页面
        setTimeout(function () {
            displayDiv.innerHTML = '<span class="shutdown-message">服务已关闭，请关闭浏览器或刷新页面重新连接</span>';
        }, data.countdown * 1000);
    });

    // 初始化唤醒词设置UI状态
    const wakewordBackend = document.getElementById('wakeword-backend');
    if (wakewordBackend) {
        const settingGroup = wakewordBackend.closest('.setting-group');
        if (settingGroup) {
            // 默认显示OpenWakeWord设置
            settingGroup.classList.add('openwakeword-active');
        }
    }

    // 为OpenWakeWord模型路径输入框添加验证事件
    const openwakewordModelsInput = document.getElementById('openwakeword-models');
    if (openwakewordModelsInput) {
        // 实时格式验证
        openwakewordModelsInput.addEventListener('input', function() {
            const formatValidation = validateOpenWakeWordPaths(this.value);
            if (!formatValidation.valid) {
                showValidationError('openwakeword-models', formatValidation.message);
            } else {
                // 只清除错误，不显示成功状态（留给文件存在验证）
                clearValidationError('openwakeword-models');
            }
        });
        
        // 添加失去焦点时验证文件路径
        openwakewordModelsInput.addEventListener('blur', async function() {
            // 首先进行格式验证
            const formatValidation = validateOpenWakeWordPaths(this.value);
            if (!formatValidation.valid) {
                showValidationError('openwakeword-models', formatValidation.message);
                return;
            }
            
            // 如果格式验证通过且值不为空，验证文件路径
            if (this.value.trim()) {
                try {
                    const fileValidation = await validateFilePath(this.value);
                    showFileValidationResult('openwakeword-models', fileValidation);
                } catch (error) {
                    console.error('文件验证出错:', error);
                    // 显示警告但不阻止用户继续
                    showValidationError('openwakeword-models', '无法验证文件是否存在: ' + error.message);
                }
            } else {
                clearValidationError('openwakeword-models');
            }
        });
        
        // 初始格式验证
        const formatValidation = validateOpenWakeWordPaths(openwakewordModelsInput.value);
        if (formatValidation.valid && openwakewordModelsInput.value.trim()) {
            // 如果初始值格式正确且不为空，尝试验证文件存在性
            validateFilePath(openwakewordModelsInput.value)
                .then(result => showFileValidationResult('openwakeword-models', result))
                .catch(error => console.error('初始文件验证失败:', error));
        } else if (!formatValidation.valid) {
            showValidationError('openwakeword-models', formatValidation.message);
        }
    }
});

// 请求麦克风访问权限
navigator.mediaDevices.getUserMedia({audio: true})
    .then(stream => {
        let audioContext = new AudioContext();
        let source = audioContext.createMediaStreamSource(stream);
        let processor = audioContext.createScriptProcessor(256, 1, 1);

        source.connect(processor);
        processor.connect(audioContext.destination);
        mic_available = true;
        start_msg();

        processor.onaudioprocess = function (e) {
            let inputData = e.inputBuffer.getChannelData(0);
            let outputData = new Int16Array(inputData.length);

            // Convert to 16-bit PCM
            for (let i = 0; i < inputData.length; i++) {
                outputData[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
            }

            // 将音频数据转换为 Base64 编码并发送到服务器
            if (socket.connected) {
                const audioBlob = new Blob([outputData.buffer], {type: 'application/octet-stream'});
                const reader = new FileReader();

                reader.onloadend = () => {
                    const base64data = reader.result.split(',')[1];

                    socket.emit('audio_data', {
                        audio: base64data,
                        sampleRate: audioContext.sampleRate
                    });
                };

                reader.readAsDataURL(audioBlob);
            }
        };
    })
    .catch(e => {
        console.error('麦克风访问错误:', e);
        displayRealtimeText("⚠️ 麦克风访问被拒绝，请允许访问麦克风并刷新页面 ⚠️", displayDiv);
    });

/**
 * 验证OpenWakeWord模型路径格式
 * @param {string} pathsString - 模型路径字符串，用逗号分隔
 * @returns {Object} - 包含验证结果和错误消息的对象
 */
function validateOpenWakeWordPaths(pathsString) {
    // 空路径是允许的，表示使用预训练模型
    if (!pathsString || pathsString.trim() === '') {
        return {valid: true, message: ''};
    }

    const paths = pathsString.split(',').map(p => p.trim());
    const results = {valid: true, message: '', invalidPaths: []};

    // 检查每个路径
    for (const path of paths) {
        // 检查基本格式
        if (path.includes('|') || path.includes('>') || path.includes('<') || path.includes('*') || path.includes('?') || path.includes(';')) {
            results.invalidPaths.push(`"${path}" 包含无效字符 (|, >, <, *, ?, ;)`);
            continue;
        }

        // 检查文件扩展名
        const validExtensions = ['.bin', '.onnx', '.tflite'];
        const hasValidExtension = validExtensions.some(ext => path.toLowerCase().endsWith(ext));
        if (!hasValidExtension) {
            results.invalidPaths.push(`"${path}" 不是有效的模型文件，应以 .bin, .onnx 或 .tflite 结尾`);
            continue;
        }

        // 检查路径长度
        if (path.length > 260) {
            results.invalidPaths.push(`"${path}" 路径过长，超过260个字符`);
            continue;
        }

        // 检查Windows路径格式
        if (path.includes('\\')) {
            // 确保Windows路径格式正确
            const windowsPathRegex = /^[a-zA-Z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*$/;
            if (!windowsPathRegex.test(path)) {
                results.invalidPaths.push(`"${path}" Windows路径格式无效`);
                continue;
            }
        }

        // 检查Linux/Mac路径格式
        if (path.startsWith('/')) {
            // 确保Linux/Mac路径格式正确
            const unixPathRegex = /^\/(?:[^\/\0]+\/)*[^\/\0]*$/;
            if (!unixPathRegex.test(path)) {
                results.invalidPaths.push(`"${path}" Unix路径格式无效`);
                continue;
            }
        }

        // 如果是相对路径但以 ./ 或 ../ 开头，可能存在安全问题
        if (path.startsWith('./') || path.startsWith('../')) {
            results.invalidPaths.push(`"${path}" 使用相对路径可能导致问题，建议使用绝对路径`);
            continue;
        }

        // 检查是否包含空格但没有引号（可能导致命令行解析问题）
        if (path.includes(' ') && !path.startsWith('"') && !path.endsWith('"')) {
            // 这只是一个警告，不会使验证失败
            results.invalidPaths.push(`警告: "${path}" 包含空格，可能需要用引号包围`);
        }
    }

    // 处理验证结果
    if (results.invalidPaths.length > 0) {
        results.valid = false;
        results.message = `发现 ${results.invalidPaths.length} 个问题:\n` + results.invalidPaths.join('\n');
    }

    return results;
}

/**
 * 显示验证错误消息
 * @param {string} inputId - 输入框ID
 * @param {string} message - 错误消息
 */
function showValidationError(inputId, message) {
    const input = document.getElementById(inputId);
    if (!input) return;

    // 设置错误样式
    input.classList.add('validation-error');

    // 显示错误消息
    let errorElem = document.getElementById(`${inputId}-error`);
    if (!errorElem) {
        errorElem = document.createElement('div');
        errorElem.id = `${inputId}-error`;
        errorElem.className = 'validation-error-message';
        input.parentNode.insertBefore(errorElem, input.nextSibling);
    }
    errorElem.textContent = message;
    errorElem.style.display = message ? 'block' : 'none';
}

/**
 * 清除验证错误并显示成功状态
 * @param {string} inputId - 输入框ID
 * @param {boolean} showSuccess - 是否显示成功状态
 */
function clearValidationError(inputId, showSuccess = false) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.classList.remove('validation-error');

    const errorElem = document.getElementById(`${inputId}-error`);
    if (errorElem) {
        errorElem.style.display = 'none';
    }

    // 如果需要显示成功状态
    if (showSuccess) {
        input.classList.add('validation-success');

        // 2秒后移除成功状态
        setTimeout(() => {
            input.classList.remove('validation-success');
        }, 2000);
    }
}

/**
 * 验证文件路径是否存在于服务器上
 * @param {string} path - 要验证的文件路径
 * @returns {Promise} - 解析为包含验证结果的Promise
 */
function validateFilePath(path) {
    return new Promise((resolve, reject) => {
        // 设置超时
        const timeout = setTimeout(() => {
            reject(new Error('验证请求超时'));
        }, 5000);
        
        // 请求验证
        socket.emit('validate_file_path', { path: path });
        
        // 一次性事件监听器
        function validationResultHandler(result) {
            clearTimeout(timeout);
            socket.off('file_path_validation_result', validationResultHandler);
            resolve(result);
        }
        
        // 监听验证结果
        socket.on('file_path_validation_result', validationResultHandler);
    });
}

/**
 * 显示文件验证结果
 * @param {string} inputId - 输入框ID
 * @param {Object} result - 验证结果
 */
function showFileValidationResult(inputId, result) {
    const input = document.getElementById(inputId);
    if (!input) return;
    
    if (result.valid) {
        clearValidationError(inputId, result.path.trim() !== '');
    } else {
        // 构建错误消息
        const errorMessages = result.messages.map(item => 
            `"${item.path}": ${item.reason}`
        ).join('\n');
        
        showValidationError(inputId, `文件路径验证失败:\n${errorMessages}`);
    }
} 