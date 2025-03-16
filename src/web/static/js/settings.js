// 设置面板显示/隐藏
document.addEventListener('DOMContentLoaded', function () {
    const settingsIcon = document.getElementById('settingsIcon');
    const settingsOverlay = document.getElementById('settingsOverlay');
    const closeSettings = document.getElementById('closeSettings');

    // 打开设置面板
    settingsIcon.addEventListener('click', function () {
        settingsOverlay.style.display = 'flex';
    });

    // 关闭设置面板
    closeSettings.addEventListener('click', function () {
        settingsOverlay.style.display = 'none';
    });

    // 点击外部区域关闭设置面板
    settingsOverlay.addEventListener('click', function (e) {
        if (e.target === settingsOverlay) {
            settingsOverlay.style.display = 'none';
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
}); 