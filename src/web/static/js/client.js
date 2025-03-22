let socket = io();
// 推迟 displayDiv 的初始化，保证在DOM加载完成后获取
let displayDiv = null;
let server_available = false;
let mic_available = false;
let fullSentences = [];
let currentConfig = {}; // 存储当前配置信息
let waitingForConfigUpdate = false; // 是否正在等待配置更新
let useSimplifiedChinese = true; // 是否使用简体中文
let originalFullSentences = []; // 保存原始句子（未转换前）
let currentWakewordStyle = 1; // 当前唤醒灯样式

// 全局变量，用于跟踪当前激活的导航标签
let currentNavTab = 'transcription'; // 默认为转录页面

// 音效播放函数
function playWakeSound() {
    const wakeSound = document.getElementById('wakeSound');
    if (wakeSound) {
        wakeSound.currentTime = 0;
        wakeSound.play().catch(error => console.log('播放唤醒音效失败:', error));
    }
}

function playTimeoutSound() {
    const timeoutSound = document.getElementById('timeoutSound');
    if (timeoutSound) {
        timeoutSound.currentTime = 0;
        timeoutSound.play().catch(error => console.log('播放超时音效失败:', error));
    }
}

// 添加防抖变量，用于跟踪上一次显示的状态消息
let lastRecorderStatusMessage = '';
let lastRecorderStatusTime = 0;
const RECORDER_STATUS_DEBOUNCE_TIME = 3000; // 3秒内不重复显示相同消息

// 添加音频分析功能
let audioContext;
let audioAnalyser;
let audioDataArray;
let animationFrameId;

let recorder = null;
let isFirstConnection = true;

// 防抖变量
let lastTranslatedText = '';
let translationDebounceTimer = null;
const TRANSLATION_DEBOUNCE_TIME = 1000; // 1秒内不重复翻译相同文本

// 处理文本转换的辅助函数
function processText(text) {
    // 执行简繁中文转换
    const processedText = useSimplifiedChinese ? window.ChineseConverter.convertToSimplified(text) : text;

    // 显示转录文本 - 先显示文本，再处理翻译请求
    displayRealtimeText(processedText, displayDiv);
    
    // 异步处理翻译请求，不阻塞主线程
    setTimeout(() => {
        // 将转录文本同步发送给翻译服务
        if (window.realtimeTranslationController) {
            // 直接处理转录文本进行翻译
            
            // 防抖逻辑：如果与上次翻译的文本相同，且在防抖时间内，则不重复发送请求
            if (processedText === lastTranslatedText && translationDebounceTimer) {
                console.log('跳过重复翻译请求:', processedText);
                return;
            }
            
            // 更新上次翻译的文本
            lastTranslatedText = processedText;
            
            // 清除之前的定时器
            if (translationDebounceTimer) {
                clearTimeout(translationDebounceTimer);
            }
            
            // 设置新的定时器
            translationDebounceTimer = setTimeout(() => {
                translationDebounceTimer = null;
            }, TRANSLATION_DEBOUNCE_TIME);
            
            console.log('将转录文本发送到翻译服务:', processedText);
        }
        
        // 检查socket连接状态并发送translate_text事件
        if (socket && socket.connected) {
            // 首先尝试从TranslationConfigManager获取配置
            let translationRequest;
            if (typeof TranslationConfigManager !== 'undefined' && TranslationConfigManager.getConfig()) {
                const config = TranslationConfigManager.getConfig();
                const service = config.active_service || config.service || 'google';
                const serviceConfig = config.services && config.services[service] || {};
                
                translationRequest = {
                    text: processedText,
                    source_language: serviceConfig.source_language || 'auto',
                    target_language: serviceConfig.target_language || 'en',
                    service: service,
                    original_text: processedText // 添加原始文本字段
                };
                
                console.log('使用TranslationConfigManager配置发送翻译请求:', translationRequest);
            } else {
                // 如果没有TranslationConfigManager配置，使用默认配置
                translationRequest = {
                    text: processedText,
                    source_language: 'auto',
                    target_language: 'en',
                    service: 'google',
                    original_text: processedText // 添加原始文本字段
                };
                
                console.log('使用默认配置发送翻译请求:', translationRequest);
            }
            
            socket.emit('translate_text', translationRequest);
            
            // 获取翻译配置 - 如果还没有完整配置，尝试获取
            if (typeof TranslationConfigManager === 'undefined' || !TranslationConfigManager.getConfig()) {
                console.log('尝试获取完整翻译配置');
                socket.emit('get_translation_config', {}, (data) => {
                    // 添加安全检查，确保data存在
                    if (!data) {
                        console.warn('翻译配置不可用 (data为空)，已使用默认配置');
                        // 使用默认配置
                        const defaultConfig = {
                            config: {
                                active_service: 'google',
                                use_streaming_translation: false,
                                services: {
                                    google: {
                                        use_official_api: false,
                                        target_language: 'zh-CN',
                                        source_language: 'auto'
                                    }
                                }
                            },
                            languages: {
                                google: {
                                    'en': '英语',
                                    'zh-CN': '中文（简体）',
                                    'zh-TW': '中文（繁体）',
                                    'ja': '日语',
                                    'ko': '韩语'
                                }
                            }
                        };
                        
                        // 如果存在全局TranslationConfigManager，更新配置
                        if (typeof TranslationConfigManager !== 'undefined') {
                            console.log('使用默认配置更新TranslationConfigManager');
                            TranslationConfigManager.setConfig(defaultConfig.config);
                        }
                        
                        return;
                    }
                    
                    // 检查是否为错误响应
                    if (data.error) {
                        console.warn('翻译配置返回错误:', data.error, '已使用默认配置');
                        return;
                    }
                    
                    try {
                        // 获取配置，既支持新的response_data格式也支持旧的仅config格式
                        const config = data.config || data;
                        
                        // 确保config对象存在且有services属性
                        if (config && config.services) {
                            // 获取活跃的服务和相关配置
                            const service = config.active_service || config.service || 'google';
                            const serviceConfig = config.services[service] || {};
                            
                            // 如果存在全局TranslationConfigManager，更新配置
                            if (typeof TranslationConfigManager !== 'undefined') {
                                console.log('使用服务器配置更新TranslationConfigManager');
                                TranslationConfigManager.setConfig(config);
                            }
                            
                            // 如果配置有效且与之前发送的请求配置不同，使用新配置发送第二次翻译请求
                            if (service !== translationRequest.service ||
                                serviceConfig.source_language !== translationRequest.source_language ||
                                serviceConfig.target_language !== translationRequest.target_language) {
                                
                                console.log('使用获取到的翻译配置发送第二次翻译请求');
                                socket.emit('translate_text', {
                                    text: processedText,
                                    source_language: serviceConfig.source_language || 'auto',
                                    target_language: serviceConfig.target_language || 'en',
                                    service: service,
                                    original_text: processedText // 添加原始文本字段
                                });
                            }
                        }
                    } catch (err) {
                        console.error('处理翻译配置时出错:', err);
                    }
                });
            }
        }
    }, 0); // 使用0延迟的setTimeout确保异步执行
    
    return processedText;
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
        toggleButton.textContent = useSimplifiedChinese ? '简' : '繁';
    }

    // 保存用户偏好到localStorage
    localStorage.setItem('useSimplifiedChinese', useSimplifiedChinese ? 'true' : 'false');

    // 显示状态消息
    showStatusMessage(useSimplifiedChinese ? '已切换到简体中文' : '已切换到繁体中文', true);
}

// 更新唤醒词状态指示器
function updateWakewordStatusIndicator(status, message) {
    const indicator = document.getElementById('wakeword-status-indicator');
    if (!indicator) return;
    
    // 移除所有状态类
    indicator.classList.remove('disabled', 'listening', 'activated', 'timeout');
    
    // 设置文本
    const textElement = indicator.querySelector('span');
    
    // 根据状态设置类和文本
    switch (status) {
        case 'disabled':
            indicator.classList.add('disabled');
            if (textElement) textElement.textContent = message || '禁用';
            break;
        case 'listening':
            indicator.classList.add('listening');
            if (textElement) textElement.textContent = message || '等待';
            break;
        case 'activated':
            indicator.classList.add('activated');
            if (textElement) textElement.textContent = message || '激活';
            // 播放唤醒音效
            playWakeSound();
            break;
        case 'timeout':
            indicator.classList.add('timeout');
            if (textElement) textElement.textContent = message || '超时';
            // 播放超时音效
            playTimeoutSound();
            break;
    }
    
    // 同时更新录音状态
    if (status === 'disabled') {
        updateRecordingStatusIndicator(true, '聆听');
    } else if (status === 'listening') {
        updateRecordingStatusIndicator(false, '休眠');
    } else if (status === 'activated') {
        updateRecordingStatusIndicator(true, '聆听');
    } else if (status === 'timeout') {
        updateRecordingStatusIndicator(false, '休眠');
    }
    
    console.log(`唤醒词状态更新为: ${status}`);
}

// 更新录音状态指示器
function updateRecordingStatusIndicator(isActive, message) {
    const indicator = document.getElementById('recording-status-indicator');
    if (!indicator) return;
    
    // 移除所有状态类
    indicator.classList.remove('recording-active', 'recording-inactive');
    
    // 根据状态设置类
    if (isActive) {
        indicator.classList.add('recording-active');
        indicator.title = message || '聆听';
    } else {
        indicator.classList.add('recording-inactive');
        indicator.title = message || '休眠';
    }
    
    console.log(`录音状态更新为: ${isActive ? '聆听' : '休眠'}`);
}

function displayRealtimeText(realtimeText, displayDiv) {
    // 确保 displayDiv 存在
    if (!displayDiv) {
        console.warn('显示区域不存在，无法显示文本');
        return;
    }
    
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
    // 确保 displayDiv 已经初始化
    if (!displayDiv) {
        displayDiv = document.getElementById('textDisplay');
        if (!displayDiv) {
            console.warn('无法找到显示区域元素，可能是DOM尚未加载完成');
            // 等待DOM加载完成后再重试
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', start_msg);
                return;
            }
        }
    }
    
    console.log('显示初始消息，麦克风状态:', mic_available, '服务器状态:', server_available);
    
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

    if (config.porcupine_access_key !== undefined && document.getElementById('porcupine-access-key')) {
        document.getElementById('porcupine-access-key').value = config.porcupine_access_key;
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

    if (config.log_level !== undefined && document.getElementById('log-level')) {
        document.getElementById('log-level').value = config.log_level;
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
        'porcupine_access_key': document.getElementById('porcupine-access-key') ? 
            document.getElementById('porcupine-access-key').value.trim() : 
            '',
        'openwakeword_model_paths': document.getElementById('openwakeword-models') ?
            document.getElementById('openwakeword-models').value.trim() || null :
            null,
        'openwakeword_inference_framework': document.getElementById('openwakeword-framework') ?
            document.getElementById('openwakeword-framework').value :
            "onnx",
        'wake_words': document.getElementById('wakeword-backend').value === 'disabled' ? '' : 
            (document.getElementById('wakeword-backend').value === 'pvporcupine' && document.getElementById('wake-words') ? 
                document.getElementById('wake-words').value.trim() : 
                document.getElementById('wake-words').value),
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
        'use_extended_logging': document.getElementById('use-extended-logging').value === 'true',
        'log_level': document.getElementById('log-level').value
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
    
    // 更新显示状态
    if (displayDiv) {
        if (mic_available) {
            // 如果麦克风和服务器都可用，显示开始说话的提示
            displayRealtimeText("👄  开始说话  👄", displayDiv);
        } else {
            // 服务器可用但麦克风未就绪，提示允许麦克风访问
            displayRealtimeText("🎤  请允许麦克风访问  🎤", displayDiv);
        }
    }
    
    // 确保 DOM 已加载完成再调用 initApp
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            initApp();
        });
    } else {
        initApp();
    }

    // 连接后请求当前配置
    socket.emit('get_config');
});

socket.on('disconnect', function () {
    server_available = false;
    
    // 更新显示状态
    if (displayDiv) {
        // 服务器断开连接，显示服务器不可用的提示
        displayRealtimeText("🖥️  请启动服务器  🖥️", displayDiv);
    }
    
    // 确保 DOM 已加载完成再调用 initApp
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            initApp();
        });
    } else {
        initApp();
    }
});

// 处理模型路径重置事件
socket.on('model_path_reset', function (data) {
    console.warn('配置重置:', data);

    // 显示简短通知
    showStatusMessage(data.message || '检测到配置错误，已自动重置相关设置', false);

    // 检测错误类型并更新相应UI
    if (data.error && data.error.toLowerCase().includes('porcupine')) {
        // Porcupine相关错误
        
        // 清空唤醒词输入框
        const wakeWordsInput = document.getElementById('wake-words');
        if (wakeWordsInput) {
            wakeWordsInput.value = '';
            wakeWordsInput.classList.add('validation-error');
            showValidationError('wake-words', '检测到无效的唤醒词，已自动重置');
        }
        
        // 如果是access_key错误，也清空access_key输入框
        if (data.error.toLowerCase().includes('access_key') || 
            data.error.toLowerCase().includes('api key')) {
            const accessKeyInput = document.getElementById('porcupine-access-key');
            if (accessKeyInput) {
                accessKeyInput.value = '';
                accessKeyInput.classList.add('validation-error');
                showValidationError('porcupine-access-key', '检测到无效的访问密钥，已自动重置');
            }
        }
    } else {
        // OpenWakeWord模型路径错误
        const modelPathInput = document.getElementById('openwakeword-models');
        if (modelPathInput) {
            // 清空输入框
            modelPathInput.value = '';

            // 添加错误样式
            modelPathInput.classList.add('validation-error');

            // 显示错误消息
            showValidationError('openwakeword-models', '检测到无效的模型文件，已自动重置为默认值');
        }
    }

    // 不需要额外的倒计时和刷新逻辑，重启页面会处理这些
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

// 处理唤醒词状态事件
socket.on('wakeword_status', function (data) {
    console.log('唤醒词状态更新:', data);
    updateWakewordStatusIndicator(data.status, data.message);
});

// 处理录音状态事件
socket.on('recording_status', function (data) {
    console.log('录音状态更新:', data);
    updateRecordingStatusIndicator(data.active, data.message);
});

// 接收服务器配置
socket.on('config', function (config) {
    currentConfig = config;
    updateSettingsUI(config);
    console.log('收到服务器配置:', config);

    // 根据配置设置初始唤醒词状态
    if (config.wakeword_backend === 'pvporcupine' && (!config.wake_words || config.wake_words === '')) {
        // 唤醒词为空，视为未启用
        updateWakewordStatusIndicator('disabled', '禁用');
        // 唤醒词未启用时，录音是启用的
        updateRecordingStatusIndicator(true, '聆听');
    } else if (config.wakeword_backend === 'disabled') {
        // 明确禁用
        updateWakewordStatusIndicator('disabled', '禁用');
        // 唤醒词未启用时，录音是启用的
        updateRecordingStatusIndicator(true, '聆听');
    } else {
        // 唤醒词已配置，默认为监听状态
        updateWakewordStatusIndicator('listening', '等待');
        // 等待唤醒时，录音是禁用的
        updateRecordingStatusIndicator(false, '休眠');
    }

    // 检查是否有启动错误信息
    if (config.startup_error) {
        showStartupErrorDialog(config.startup_error);
    }
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
    const currentTime = Date.now();
    const message = data.ready ? '录音机已准备就绪' : '录音机未就绪';
    
    // 如果是相同消息且时间间隔小于防抖时间，则不显示
    if (message === lastRecorderStatusMessage && 
        (currentTime - lastRecorderStatusTime) < RECORDER_STATUS_DEBOUNCE_TIME) {
        return;
    }
    
    // 更新最后显示的消息和时间
    lastRecorderStatusMessage = message;
    lastRecorderStatusTime = currentTime;
    
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

    // 如果提供了重定向URL，则在倒计时结束后重定向
    if (data.redirect_to) {
        // 显示简单的重启消息
        displayDiv.innerHTML = `<span class="restart-message">应用正在重启，${data.countdown || 3}秒后将跳转到重启页面...</span>`;

        // 倒计时结束后重定向
        setTimeout(function () {
            window.location.href = data.redirect_to;
        }, (data.countdown || 3) * 1000);

        return; // 不显示对话框，直接返回
    }

    // 旧的处理逻辑已被移除，现在所有重启都应该使用重定向
    console.warn('收到没有重定向URL的重启请求，将刷新页面');

    // 显示简单的重启消息
    displayDiv.innerHTML = `<span class="restart-message">应用正在重启，页面将在5秒后刷新...</span>`;

    // 5秒后刷新页面（兼容旧版本）
    setTimeout(function () {
        window.location.reload();
    }, 5000);
});

// 当DOM加载完成，设置按钮事件
document.addEventListener('DOMContentLoaded', function () {
    const applySettingsBtn = document.getElementById('apply-settings');
    if (applySettingsBtn) {
        applySettingsBtn.addEventListener('click', async function () {
            const config = getConfigFromUI();

            // 验证Porcupine设置
            if (config.wakeword_backend === 'pvporcupine') {
                // 只有当唤醒词不为空时，才要求access_key必填
                if (config.wake_words && config.wake_words.trim() && !config.porcupine_access_key) {
                    showValidationError('porcupine-access-key', 'Porcupine访问密钥不能为空（唤醒词存在时必填）');
                    showStatusMessage('设置验证失败，请修正错误后重试', false);
                    return; // 阻止提交
                }
            }

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
            toggleButton.textContent = useSimplifiedChinese ? '简' : '繁';
        }
    }
    
    // 从localStorage加载唤醒灯样式偏好
    const savedWakewordStyle = localStorage.getItem('wakewordStyle');
    if (savedWakewordStyle !== null) {
        currentWakewordStyle = parseInt(savedWakewordStyle);
    }
    // 应用唤醒灯样式
    updateWakewordStyle();
    
    // 添加点击唤醒灯切换样式的事件
    const wakewordIndicator = document.getElementById('wakeword-status-indicator');
    if (wakewordIndicator) {
        wakewordIndicator.addEventListener('dblclick', function(e) {
            // 双击打开唤醒灯样式选择面板
            openWakewordStyleDialog();
            e.stopPropagation(); // 阻止事件冒泡
        });
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
        openwakewordModelsInput.addEventListener('input', function () {
            const formatValidation = validateOpenWakeWordPaths(this.value);
            if (!formatValidation.valid) {
                showValidationError('openwakeword-models', formatValidation.message);
            } else {
                // 只清除错误，不显示成功状态（留给文件存在验证）
                clearValidationError('openwakeword-models');
            }
        });

        // 添加失去焦点时验证文件路径
        openwakewordModelsInput.addEventListener('blur', async function () {
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

    // 为输入框添加input事件监听器，当用户输入内容时自动清除错误状态
    const porcupineAccessKey = document.getElementById('porcupine-access-key');
    const wakeWords = document.getElementById('wake-words');
    const wakewordBackendSelect = document.getElementById('wakeword-backend');
    
    if (wakewordBackendSelect) {
        wakewordBackendSelect.addEventListener('change', function() {
            // 当切换到非pvporcupine时，清除相关错误状态
            if (this.value !== 'pvporcupine') {
                clearValidationError('porcupine-access-key');
                clearValidationError('wake-words');
            }
        });
    }
    
    if (porcupineAccessKey) {
        porcupineAccessKey.addEventListener('input', function() {
            if (this.value.trim()) {
                clearValidationError('porcupine-access-key');
            }
        });
    }
    
    if (wakeWords) {
        wakeWords.addEventListener('input', function() {
            if (this.value.trim()) {
                clearValidationError('wake-words');
            }
        });
    }

    // 设置唤醒灯样式选择面板的事件
    const styleDialog = document.getElementById('wakewordStyleDialog');
    const closeStyleDialogBtn = document.getElementById('closeWakewordStyleDialog');
    
    // 点击选项切换样式
    document.querySelectorAll('.wakeword-style-option').forEach(option => {
        option.addEventListener('click', function() {
            const style = parseInt(this.getAttribute('data-style'));
            currentWakewordStyle = style;
            updateWakewordStyle();
            updateSelectedStyle();
            
            // 保存用户偏好到localStorage
            localStorage.setItem('wakewordStyle', currentWakewordStyle.toString());
            
            // 显示状态消息
            showStatusMessage(`唤醒灯样式已切换到样式${currentWakewordStyle}`, true);
        });
    });
    
    // 关闭对话框
    if (closeStyleDialogBtn) {
        closeStyleDialogBtn.addEventListener('click', function() {
            styleDialog.style.display = 'none';
        });
    }
    
    // 点击对话框外部区域关闭对话框
    if (styleDialog) {
        styleDialog.addEventListener('click', function(event) {
            if (event.target === styleDialog) {
                styleDialog.style.display = 'none';
            }
        });
    }

    // 处理标签页切换
    initNavigationTabs();
});

// 在文档加载完成后初始化 displayDiv
document.addEventListener('DOMContentLoaded', function() {
    // 初始化导航选项卡
    initNavigationTabs();
    
    // 检查URL参数，看是否需要激活特定页面
    const urlParams = new URLSearchParams(window.location.search);
    const page = urlParams.get('page');
    if (page) {
        const tab = document.querySelector(`.nav-tab[data-page="${page}"]`);
        if (tab) {
            tab.click();
        }
    }
});

/**
 * 初始化应用程序
 */
function initApp() {
    console.log('初始化应用程序...');
    
    // 初始化显示元素
    displayDiv = document.getElementById('textDisplay');
    
    // 如果页面上已经有TranslationConfigManager，确保初始化
    if (typeof TranslationConfigManager !== 'undefined') {
        // 初始化默认配置
        TranslationConfigManager.initialize({
            active_service: 'google',
            use_streaming_translation: false,
            services: {
                google: {
                    use_official_api: false,
                    target_language: 'zh-CN',
                    source_language: 'auto'
                }
            }
        });
        console.log('初始化TranslationConfigManager默认配置');
    }

    // 初始化录音状态指示器
    updateRecordingStatusIndicator(false, '准备中');

    // 初始化唤醒词状态指示器
    updateWakewordStatusIndicator('disabled', '禁用');

    // 连接到服务器
    socket.on('connect', function () {
        server_available = true;
        
        // 更新显示状态
        if (displayDiv) {
            if (mic_available) {
                // 如果麦克风和服务器都可用，显示开始说话的提示
                displayRealtimeText("👄  开始说话  👄", displayDiv);
            } else {
                // 服务器可用但麦克风未就绪，提示允许麦克风访问
                displayRealtimeText("🎤  请允许麦克风访问  🎤", displayDiv);
            }
        }
        
        // 确保 DOM 已加载完成再调用 initApp
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                initApp();
            });
        } else {
            initApp();
        }

        // 连接后请求当前配置
        socket.emit('get_config');
    });

    socket.on('disconnect', function () {
        server_available = false;
        
        // 更新显示状态
        if (displayDiv) {
            // 服务器断开连接，显示服务器不可用的提示
            displayRealtimeText("🖥️  请启动服务器  🖥️", displayDiv);
        }
        
        // 确保 DOM 已加载完成再调用 initApp
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                initApp();
            });
        } else {
            initApp();
        }
    });

    // 处理模型路径重置事件
    socket.on('model_path_reset', function (data) {
        console.warn('配置重置:', data);

        // 显示简短通知
        showStatusMessage(data.message || '检测到配置错误，已自动重置相关设置', false);

        // 检测错误类型并更新相应UI
        if (data.error && data.error.toLowerCase().includes('porcupine')) {
            // Porcupine相关错误
            
            // 清空唤醒词输入框
            const wakeWordsInput = document.getElementById('wake-words');
            if (wakeWordsInput) {
                wakeWordsInput.value = '';
                wakeWordsInput.classList.add('validation-error');
                showValidationError('wake-words', '检测到无效的唤醒词，已自动重置');
            }
            
            // 如果是access_key错误，也清空access_key输入框
            if (data.error.toLowerCase().includes('access_key') || 
                data.error.toLowerCase().includes('api key')) {
                const accessKeyInput = document.getElementById('porcupine-access-key');
                if (accessKeyInput) {
                    accessKeyInput.value = '';
                    accessKeyInput.classList.add('validation-error');
                    showValidationError('porcupine-access-key', '检测到无效的访问密钥，已自动重置');
                }
            }
        } else {
            // OpenWakeWord模型路径错误
            const modelPathInput = document.getElementById('openwakeword-models');
            if (modelPathInput) {
                // 清空输入框
                modelPathInput.value = '';

                // 添加错误样式
                modelPathInput.classList.add('validation-error');

                // 显示错误消息
                showValidationError('openwakeword-models', '检测到无效的模型文件，已自动重置为默认值');
            }
        }

        // 不需要额外的倒计时和刷新逻辑，重启页面会处理这些
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

    // 处理唤醒词状态事件
    socket.on('wakeword_status', function (data) {
        console.log('唤醒词状态更新:', data);
        updateWakewordStatusIndicator(data.status, data.message);
    });

    // 处理录音状态事件
    socket.on('recording_status', function (data) {
        console.log('录音状态更新:', data);
        updateRecordingStatusIndicator(data.active, data.message);
    });

    // 接收服务器配置
    socket.on('config', function (config) {
        currentConfig = config;
        updateSettingsUI(config);
        console.log('收到服务器配置:', config);

        // 根据配置设置初始唤醒词状态
        if (config.wakeword_backend === 'pvporcupine' && (!config.wake_words || config.wake_words === '')) {
            // 唤醒词为空，视为未启用
            updateWakewordStatusIndicator('disabled', '禁用');
            // 唤醒词未启用时，录音是启用的
            updateRecordingStatusIndicator(true, '聆听');
        } else if (config.wakeword_backend === 'disabled') {
            // 明确禁用
            updateWakewordStatusIndicator('disabled', '禁用');
            // 唤醒词未启用时，录音是启用的
            updateRecordingStatusIndicator(true, '聆听');
        } else {
            // 唤醒词已配置，默认为监听状态
            updateWakewordStatusIndicator('listening', '等待');
            // 等待唤醒时，录音是禁用的
            updateRecordingStatusIndicator(false, '休眠');
        }

        // 检查是否有启动错误信息
        if (config.startup_error) {
            showStartupErrorDialog(config.startup_error);
        }
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
        const currentTime = Date.now();
        const message = data.ready ? '录音机已准备就绪' : '录音机未就绪';
        
        // 如果是相同消息且时间间隔小于防抖时间，则不显示
        if (message === lastRecorderStatusMessage && 
            (currentTime - lastRecorderStatusTime) < RECORDER_STATUS_DEBOUNCE_TIME) {
            return;
        }
        
        // 更新最后显示的消息和时间
        lastRecorderStatusMessage = message;
        lastRecorderStatusTime = currentTime;
        
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

        // 如果提供了重定向URL，则在倒计时结束后重定向
        if (data.redirect_to) {
            // 显示简单的重启消息
            displayDiv.innerHTML = `<span class="restart-message">应用正在重启，${data.countdown || 3}秒后将跳转到重启页面...</span>`;

            // 倒计时结束后重定向
            setTimeout(function () {
                window.location.href = data.redirect_to;
            }, (data.countdown || 3) * 1000);

            return; // 不显示对话框，直接返回
        }

        // 旧的处理逻辑已被移除，现在所有重启都应该使用重定向
        console.warn('收到没有重定向URL的重启请求，将刷新页面');

        // 显示简单的重启消息
        displayDiv.innerHTML = `<span class="restart-message">应用正在重启，页面将在5秒后刷新...</span>`;

        // 5秒后刷新页面（兼容旧版本）
        setTimeout(function () {
            window.location.reload();
        }, 5000);
    });

    // 设置重置按钮事件处理
    const resetButton = document.getElementById('resetButton');
    if (resetButton) {
        resetButton.onclick = function() {
            fullSentences = [];
            originalFullSentences = [];
            if (displayDiv) {
                displayDiv.innerHTML = '';
            }
            start_msg();
        };
    }
    
    // 设置清空按钮事件处理
    const clearButton = document.getElementById('clearButton');
    if (clearButton) {
        clearButton.onclick = function() {
            if (displayDiv) {
                displayDiv.innerHTML = '';
            }
        };
    }
    
    // 设置设置图标点击事件
    const settingsIcon = document.getElementById('settingsIcon');
    if (settingsIcon) {
        settingsIcon.onclick = function() {
            // 直接显示设置面板
            const settingsOverlay = document.getElementById('settingsOverlay');
            if (settingsOverlay) {
                settingsOverlay.style.display = 'flex';
            } else {
                console.error('未找到设置面板元素');
            }
        };
    }
    
    // 设置关闭图标点击事件
    const shutdownIcon = document.getElementById('shutdownIcon');
    if (shutdownIcon) {
        shutdownIcon.onclick = function() {
            openDialog('shutdownConfirmDialog');
        };
    }
    
    // 初始化导航标签页
    initNavigationTabs();
    
    // 初始化并启动实时翻译控制器
    window.realtimeTranslationController = new RealtimeTranslationController({
        translatedTextDisplay: document.getElementById('translated-text'),
        statusIndicator: document.getElementById('translation-status-indicator'),
        forceInit: true
    });
    
    // 立即连接翻译服务并开始翻译，无论当前是哪个标签页
    window.realtimeTranslationController._connectEventSource();
    window.realtimeTranslationControllerInitialized = true;
    console.log('实时翻译控制器已初始化并启动');

    // 添加标签页变更事件监听
    document.addEventListener('tabChanged', function(event) {
        const tabName = event.detail.tabName;
        console.log(`标签页已切换到 ${tabName}`);
        
        // 无需在切换到翻译页面时重新初始化翻译控制器，因为它已经在应用启动时初始化
    });
    
    // 监听配置变更
    socket.on('config_updated', function(data) {
        console.log('收到配置更新:', data);
        updateSettingsUI(data.config);
        waitingForConfigUpdate = false;
    });
    
    // 监听录音状态
    socket.on('recorder_status', function(data) {
        if (!data) return;
        console.log('收到录音状态更新:', data);
        
        // 状态变更通知
        if (data.status) {
            // 应用防抖逻辑
            const now = Date.now();
            const isDuplicate = (
                data.message === lastRecorderStatusMessage && 
                (now - lastRecorderStatusTime) < RECORDER_STATUS_DEBOUNCE_TIME
            );
            
            if (!isDuplicate) {
                showStatusMessage(data.message, data.status === 'success');
                lastRecorderStatusMessage = data.message;
                lastRecorderStatusTime = now;
            }
            
            // 若收到录音成功的消息，说明服务器已就绪
            if (data.status === 'success') {
                // 确认麦克风已准备就绪，显示录音激活状态
                mic_available = true;
                updateRecordingStatusIndicator(true, data.message || '录音中');
            } else if (data.status === 'error') {
                // 麦克风故障或录音错误，显示错误状态
                mic_available = false;
                updateRecordingStatusIndicator(false, data.message || '录音错误');
            }
        }
        
        // 收到关于唤醒词状态的消息
        if (data.wakeword_detection) {
            if (data.wakeword_detection.status === 'active') {
                updateWakewordStatusIndicator('listening', '聆听中');
            } else if (data.wakeword_detection.status === 'detected') {
                updateWakewordStatusIndicator('active', '已唤醒');
                playWakeSound();
            } else if (data.wakeword_detection.status === 'timeout') {
                updateWakewordStatusIndicator('listening', '聆听中');
                playTimeoutSound();
            } else if (data.wakeword_detection.status === 'error') {
                updateWakewordStatusIndicator('error', '错误');
            } else {
                // reset to default state
                updateWakewordStatusIndicator('disabled', '禁用');
            }
        }
    });
    
    // 初始消息显示
    start_msg();

// 请求麦克风访问权限并设置音频处理
navigator.mediaDevices.getUserMedia({audio: true})
        .then(async stream => {
            // 创建音频上下文
        audioContext = new AudioContext();
        let source = audioContext.createMediaStreamSource(stream);

        // 创建音频分析器并连接
        audioAnalyser = audioContext.createAnalyser();
        audioAnalyser.fftSize = 256; // 增大FFT大小以获取更详细的频率数据
        const bufferLength = audioAnalyser.frequencyBinCount;
        audioDataArray = new Uint8Array(bufferLength);
        
            // 连接音频分析器
        source.connect(audioAnalyser);
            
            // 使用 AudioWorklet 或回退到 ScriptProcessorNode
            let processor;
            let isUsingWorklet = false;
            
            try {
                // 检查浏览器是否支持 AudioWorklet
                if (audioContext.audioWorklet) {
                    // 加载音频处理器 - 使用Blob URL方式
                    console.log('尝试加载AudioWorklet处理器...');
                    
                    let processorUrl;
                    // 检查全局变量中是否有预先创建的Blob URL
                    if (window.audioProcessorBlobURL) {
                        processorUrl = window.audioProcessorBlobURL;
                        console.log('使用内联创建的Blob URL:', processorUrl);
                    } else {
                        // 回退到尝试使用普通路径
                        const possiblePaths = [
                            './static/js/audio-processor.js',
                            '/static/js/audio-processor.js',
                            window.location.origin + '/static/js/audio-processor.js'
                        ];
                        
                        // 使用第一个路径
                        processorUrl = possiblePaths[0];
                        console.log('使用常规路径:', processorUrl);
                    }
                    
                    // 尝试加载处理器
                    await audioContext.audioWorklet.addModule(processorUrl);
                    console.log('成功加载AudioWorklet处理器');
                    
                    // 创建 AudioWorkletNode 
                    console.log('创建 AudioWorkletNode...');
                    const workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
                    console.log('AudioWorkletNode 创建成功');
                    
                    // 监听从处理器发来的消息
                    workletNode.port.onmessage = (event) => {
                        const { audioData, sampleRate } = event.data;
                        
                        // 将音频数据转换为 Base64 编码并发送到服务器
                        if (socket.connected) {
                            const audioBlob = new Blob([audioData.buffer], { type: 'application/octet-stream' });
                            const reader = new FileReader();
                            
                            reader.onloadend = () => {
                                const base64data = reader.result.split(',')[1];
                                
                                socket.emit('audio_data', {
                                    audio: base64data,
                                    sampleRate: sampleRate
                                });
                            };
                            
                            reader.readAsDataURL(audioBlob);
                        }
                    };
                    
                    // 连接节点
                    source.connect(workletNode);
                    workletNode.connect(audioContext.destination);
                    isUsingWorklet = true;
                    
                    console.log('使用 AudioWorklet 处理音频 - 更高性能、更低延迟');
                }
            } catch (err) {
                console.error('设置 AudioWorklet 失败，回退到 ScriptProcessorNode:', err);
                console.error('错误详情:', err.message);
                console.error('错误栈:', err.stack);
            }
            
            // 如果 AudioWorklet 不可用或设置失败，回退到 ScriptProcessorNode
            if (!isUsingWorklet) {
                console.warn('当前浏览器不支持 AudioWorklet 或设置失败，使用 ScriptProcessorNode (已弃用)');
                
                // 创建 ScriptProcessorNode
                processor = audioContext.createScriptProcessor(256, 1, 1);
                
                // 连接音频节点
                source.connect(processor);
                processor.connect(audioContext.destination);
                
                // 添加音频处理函数
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
            }
            
            // 开始音频可视化
            updateAudioVisualization();
            
            // 显式更新麦克风状态并重新显示初始消息
            mic_available = true;
            
            // 通知服务器麦克风已就绪
            if (socket && socket.connected) {
                socket.emit('client_ready', { mic_ready: true });
            }
            
            // 更新UI显示
            updateRecordingStatusIndicator(true, '录音中');
            
            // 麦克风已获取到，更新显示消息
            console.log('麦克风初始化完成，更新状态和显示');
            if (displayDiv) {
                // 重新显示初始消息，基于当前状态
                start_msg();
            }
            
    })
    .catch(e => {
        console.error('麦克风访问错误:', e);
            
            if (document.readyState !== 'loading' && displayDiv) {
        displayRealtimeText("⚠️ 麦克风访问被拒绝，请允许访问麦克风并刷新页面 ⚠️", displayDiv);
            } else {
                // 等待 DOM 加载完成再显示错误
                document.addEventListener('DOMContentLoaded', function() {
                    displayDiv = document.getElementById('textDisplay');
                    if (displayDiv) {
                        displayRealtimeText("⚠️ 麦克风访问被拒绝，请允许访问麦克风并刷新页面 ⚠️", displayDiv);
                    }
                });
            }
        });
}

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
        socket.emit('validate_file_path', {path: path});

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

/**
 * 显示启动错误对话框
 * @param {Object} errorData - 错误数据对象
 */
function showStartupErrorDialog(errorData) {
    console.warn('检测到上次启动失败:', errorData);

    // 移除可能已存在的对话框
    const existingOverlay = document.querySelector('.startup-error-overlay');
    if (existingOverlay) {
        document.body.removeChild(existingOverlay);
    }

    // 创建遮罩层
    const overlay = document.createElement('div');
    overlay.className = 'startup-error-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 2000;
    `;

    // 创建对话框容器
    const dialogContainer = document.createElement('div');
    dialogContainer.style.cssText = `
        background-color: #1e1e1e;
        color: #fff;
        padding: 25px;
        border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        width: 500px;
        max-width: 90%;
        position: relative;
        max-height: 80vh;
        overflow-y: auto;
    `;

    // 添加内容
    let contentHtml = `
        <div style="display: flex; align-items: center; margin-bottom: 20px;">
            <i class="fas fa-exclamation-triangle" style="color: #ff5252; font-size: 24px; margin-right: 15px;"></i>
            <h3 style="margin: 0; color: #ff5252; font-size: 20px;">启动错误提醒</h3>
        </div>
        <div style="margin-bottom: 20px; line-height: 1.5;">
            <p><strong>错误信息:</strong> ${errorData.message}</p>
            <p><strong>发生时间:</strong> ${errorData.timestamp}</p>
    `;

    // 如果是模型文件问题，添加特殊说明
    if (errorData.message.includes('模型文件')) {
        contentHtml += `
            <div style="background-color: rgba(255, 82, 82, 0.1); padding: 15px; border-radius: 5px; margin-top: 15px; border-left: 4px solid #ff5252;">
                <p style="margin: 0; font-weight: bold;">模型文件问题说明:</p>
                <p style="margin-top: 10px; margin-bottom: 0;">系统检测到您配置的OpenWakeWord模型文件存在问题，可能是文件损坏或格式不正确。系统已自动清空模型路径并恢复使用默认模型。</p>
            </div>
        `;
    }

    // 添加详细错误信息（可折叠）
    contentHtml += `
        <div style="margin-top: 20px;">
            <details>
                <summary style="cursor: pointer; color: #00aaff; margin-bottom: 10px;">查看详细错误信息</summary>
                <pre style="background-color: #252525; padding: 10px; border-radius: 5px; overflow-x: auto; max-height: 150px; font-size: 12px;">${errorData.error}</pre>
            </details>
        </div>
    `;

    // 添加关闭按钮
    contentHtml += `
        <div style="text-align: right; margin-top: 25px;">
            <button id="closeErrorDialogBtn" style="background-color: #00aaff; color: white; border: none; padding: 8px 20px; border-radius: 5px; cursor: pointer; font-weight: bold; transition: all 0.3s;">我知道了</button>
        </div>
    `;

    dialogContainer.innerHTML = contentHtml;
    overlay.appendChild(dialogContainer);
    document.body.appendChild(overlay);

    // 阻止点击对话框内容时关闭
    dialogContainer.addEventListener('click', function (e) {
        e.stopPropagation();
    });

    // 点击遮罩层背景关闭对话框
    overlay.addEventListener('click', function () {
        document.body.removeChild(overlay);
    });

    // 点击关闭按钮关闭对话框
    document.getElementById('closeErrorDialogBtn').addEventListener('click', function () {
        document.body.removeChild(overlay);
    });
}

// 更新音频可视化
function updateAudioVisualization() {
    if (!audioAnalyser) return;
    
    // 获取频域数据（而不是时域数据）
    audioAnalyser.getByteFrequencyData(audioDataArray);
    
    // 更新波形条
    updateWaveformBars(audioDataArray);
    
    // 请求下一帧更新
    animationFrameId = requestAnimationFrame(updateAudioVisualization);
}

// 更新波形条，基于频率数据
function updateWaveformBars(frequencyData) {
    const bars = document.querySelectorAll('.wave-bar');
    if (!bars.length) return;
    
    // 最小和最大高度（像素）
    const minHeight = 3;
    const maxHeight = 22;
    
    // 人声频率区间优化（基于48kHz采样率，6个波形条）
    // FFT 256点，频率分辨率约为 48000/256 = 187.5 Hz/点
    // 人声基本频率：成人男性约85-180Hz，女性约165-255Hz
    // 人声主要共振频率：第一共振峰约500-800Hz，第二共振峰约1000-2000Hz，第三共振峰约2500-3500Hz
    const frequencyBands = [
        [0, 1],      // 次低频（0-187.5Hz）- 部分男声基频
        [1, 3],      // 低频（187.5-562.5Hz）- 男女声基频
        [3, 5],      // 中低频（562.5-937.5Hz）- 第一共振峰开始
        [5, 8],      // 中频（937.5-1500Hz）- 第一共振峰和第二共振峰开始
        [8, 12],     // 中高频（1500-2250Hz）- 第二共振峰核心区域
        [12, 18]     // 高频（2250-3375Hz）- 辅音和齿音
    ];
    
    // 波形参数
    const noiseThreshold = 0.08; // 保持较低的噪声门限
    const loudSoundThreshold = 0.99; // 保持高阈值，确保只有非常响亮的声音才会触发绿色效果
    const smoothingFactor = 0.5; // 保持平滑因子
    const globalSensitivityScale = 0.7; // 保持适中的全局灵敏度
    // 优化频带权重，将2-5波的权重提高
    const bandWeights = [0.7, 1.0, 1.0, 0.95, 0.9, 0.6];
    
    // 计算整体能量水平（用于判断是否有明显声音输入）
    let totalEnergy = 0;
    for (let i = 0; i < 25; i++) { // 只考虑0-4.6kHz范围内的频率
        totalEnergy += frequencyData[i];
    }
    const avgEnergy = totalEnergy / 25 / 255;
    
    // 如果整体能量低于噪声门限，则将所有条设置为最小高度
    if (avgEnergy < noiseThreshold) {
        bars.forEach(bar => {
            // 缓慢降到最小高度，而不是直接跳变
            const currentHeight = parseFloat(bar.dataset.prevHeight || minHeight);
            const newHeight = Math.max(minHeight, currentHeight * 0.8); // 每帧降低20%
            bar.style.height = `${newHeight}px`;
            bar.dataset.prevHeight = newHeight;
            
            // 移除任何强调效果
            bar.classList.remove('loud-sound');
        });
        return;
    }
    
    // 为每个波形条计算对应频段的加权平均能量
    bars.forEach((bar, index) => {
        const [start, end] = frequencyBands[index];
        let sum = 0;
        let count = 0;
        
        // 计算频段内的平均能量
        for (let i = start; i < end; i++) {
            sum += frequencyData[i];
            count++;
        }
        
        // 应用频段权重和全局灵敏度缩放
        const average = (sum / count / 255) * bandWeights[index] * globalSensitivityScale;
        
        // 使用更平缓的指数曲线，让普通说话也能有明显变化
        const scale = Math.min(1, Math.pow(average * 1.5, 1.8)); // 增加基数，降低指数值
        
        // 应用平滑滤波
        if (!bar.dataset.prevHeight) {
            bar.dataset.prevHeight = minHeight;
        }
        
        // 平滑过渡，增加前一帧权重，使变化更平滑
        const targetHeight = minHeight + (maxHeight - minHeight) * scale;
        const smoothedHeight = parseFloat(bar.dataset.prevHeight) * smoothingFactor + targetHeight * (1 - smoothingFactor);
        
        // 更新高度
        bar.style.height = `${smoothedHeight}px`;
        bar.dataset.prevHeight = smoothedHeight;
        
        // 响亮声音视觉增强，只有非常大的声音才会触发
        if (scale > loudSoundThreshold) {
            bar.classList.add('loud-sound');
        } else {
            bar.classList.remove('loud-sound');
        }
    });
}

// 停止音频分析
function stopAudioVisualization() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    
    if (audioContext && audioContext.state !== 'closed') {
        audioAnalyser = null;
    }
}

// 切换唤醒灯样式
function toggleWakewordStyle() {
    currentWakewordStyle = (currentWakewordStyle % 5) + 1;
    updateWakewordStyle();
    
    // 保存用户偏好到localStorage
    localStorage.setItem('wakewordStyle', currentWakewordStyle.toString());
    
    // 显示状态消息
    showStatusMessage(`唤醒灯样式已切换到样式${currentWakewordStyle}`, true);
}

// 更新唤醒灯样式
function updateWakewordStyle() {
    const indicator = document.getElementById('wakeword-status-indicator');
    if (!indicator) return;
    
    // 移除所有样式类
    indicator.classList.remove('wakeword-style-1', 'wakeword-style-2', 'wakeword-style-3', 'wakeword-style-4', 'wakeword-style-5');
    
    // 添加当前样式类
    indicator.classList.add(`wakeword-style-${currentWakewordStyle}`);
}

// 打开唤醒灯样式选择面板
function openWakewordStyleDialog() {
    const dialog = document.getElementById('wakewordStyleDialog');
    if (!dialog) return;
    
    // 更新当前选中的样式
    updateSelectedStyle();
    
    // 显示对话框
    dialog.style.display = 'flex';
}

// 更新样式选择面板中选中的样式
function updateSelectedStyle() {
    // 移除所有选项的选中状态
    document.querySelectorAll('.wakeword-style-option').forEach(option => {
        option.classList.remove('selected');
    });
    
    // 添加当前样式的选中状态
    const currentOption = document.querySelector(`.wakeword-style-option[data-style="${currentWakewordStyle}"]`);
    if (currentOption) {
        currentOption.classList.add('selected');
    }
}

// 导航选项卡切换功能
function initNavigationTabs() {
    // 获取所有导航选项卡
    const navTabs = document.querySelectorAll('.nav-tab');
    
    // 初始化时检查当前哪个标签页是激活的
    const activeTab = document.querySelector('.nav-tab.active');
    if (activeTab) {
        currentNavTab = activeTab.getAttribute('data-page');
        console.log(`初始化：当前活跃标签页为 ${currentNavTab}`);
    }
    
    // 为每个选项卡添加点击事件
    navTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            // 获取目标页面ID
            const targetPage = this.getAttribute('data-page');
            
            // 如果当前选项卡已经激活，不做任何操作
            if (this.classList.contains('active')) {
                return;
            }
            
            console.log(`切换到${targetPage}页面`);
            
            // 更新当前激活的标签页变量
            currentNavTab = targetPage;
            console.log(`当前活跃标签页: ${currentNavTab}`);
            
            // 移除所有选项卡和页面的active类
            navTabs.forEach(t => t.classList.remove('active'));
            
            // 隐藏所有页面，并移除active类，但不清空内容
            document.querySelectorAll('.page').forEach(p => {
                p.classList.remove('active');
                p.classList.add('hidden');
                console.log(`隐藏页面: ${p.id}`);
            });
            
            // 激活当前选项卡
            this.classList.add('active');
            
            // 找到对应的页面并激活
            const targetPageElement = document.getElementById(`${targetPage}-page`);
            if (targetPageElement) {
                targetPageElement.classList.add('active');
                targetPageElement.classList.remove('hidden');
                console.log(`显示页面: ${targetPageElement.id}`);
            } else {
                console.error(`找不到目标页面: ${targetPage}-page`);
            }
            
            // 触发标签页变更事件，让其他组件可以响应
            document.dispatchEvent(new CustomEvent('tabChanged', {
                detail: { tabName: targetPage }
            }));
        });
    });
}

// 在文档加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    // 初始化导航选项卡
    initNavigationTabs();
    
    // 检查URL参数，看是否需要激活特定页面
    const urlParams = new URLSearchParams(window.location.search);
    const page = urlParams.get('page');
    if (page) {
        const tab = document.querySelector(`.nav-tab[data-page="${page}"]`);
        if (tab) {
            tab.click();
        }
    }
});

/**
 * 打开指定 ID 的对话框
 * @param {string} dialogId - 对话框的 ID
 */
function openDialog(dialogId) {
    const dialog = document.getElementById(dialogId);
    if (!dialog) {
        console.error(`未找到ID为 ${dialogId} 的对话框元素`);
        return;
    }
    
    // 显示对话框
    dialog.style.display = 'flex';
} 