/**
 * AudioWorklet 处理器
 * 用于高性能音频处理，替代被弃用的 ScriptProcessorNode
 */
class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._bufferSize = 256;
        this._buffer = new Float32Array(this._bufferSize);
    }
    
    process(inputs, outputs, parameters) {
        const input = inputs[0][0];
        if (!input) return true;
        
        // 将输入复制到缓冲区
        this._buffer.set(input);
        
        // 将Float32Array转换为Int16Array
        const outputData = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
            outputData[i] = Math.max(-32768, Math.min(32767, input[i] * 32768));
        }
        
        // 发送消息给主线程
        this.port.postMessage({
            audioData: outputData,
            sampleRate: sampleRate
        });
        
        return true;
    }
}

registerProcessor('audio-processor', AudioProcessor); 