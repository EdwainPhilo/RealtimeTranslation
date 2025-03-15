let socket = io();
let displayDiv = document.getElementById('textDisplay');
let server_available = false;
let mic_available = false;
let fullSentences = [];

function displayRealtimeText(realtimeText, displayDiv) {
    let displayedText = fullSentences.map((sentence, index) => {
        let span = document.createElement('span');
        span.textContent = sentence + " ";
        span.className = index % 2 === 0 ? 'yellow' : 'cyan';
        return span.outerHTML;
    }).join('') + realtimeText;

    displayDiv.innerHTML = displayedText;
}

function start_msg() {
    if (!mic_available)
        displayRealtimeText("🎤  please allow microphone access  🎤", displayDiv);
    else if (!server_available)
        displayRealtimeText("🖥️  please start server  🖥️", displayDiv);
    else
        displayRealtimeText("👄  start speaking  👄", displayDiv);
}

// 初始化Socket.IO连接
socket.on('connect', function() {
    server_available = true;
    start_msg();
});

socket.on('disconnect', function() {
    server_available = false;
    start_msg();
});

socket.on('realtime', function(data) {
    if (data.type === 'realtime') {
        displayRealtimeText(data.text, displayDiv);
    }
});

socket.on('fullSentence', function(data) {
    if (data.type === 'fullSentence') {
        fullSentences.push(data.text);
        displayRealtimeText("", displayDiv); // Refresh display with new full sentence
    }
});

start_msg();

// Request access to the microphone
navigator.mediaDevices.getUserMedia({ audio: true })
.then(stream => {
    let audioContext = new AudioContext();
    let source = audioContext.createMediaStreamSource(stream);
    let processor = audioContext.createScriptProcessor(256, 1, 1);

    source.connect(processor);
    processor.connect(audioContext.destination);
    mic_available = true;
    start_msg();

    processor.onaudioprocess = function(e) {
        let inputData = e.inputBuffer.getChannelData(0);
        let outputData = new Int16Array(inputData.length);

        // Convert to 16-bit PCM
        for (let i = 0; i < inputData.length; i++) {
            outputData[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
        }

        // 将音频数据转换为 Base64 编码并发送到服务器
        if (socket.connected) {
            const audioBlob = new Blob([outputData.buffer], { type: 'application/octet-stream' });
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
.catch(e => console.error(e)); 