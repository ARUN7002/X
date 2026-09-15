/**
 * X-MUX PCM capture worklet.
 *
 * Runs on the audio rendering thread; posts copied Float32 chunks to the
 * main thread, which converts them to base64 Int16 PCM for Socket.IO
 * transport to the X-MUX backend.
 */

class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      // copy: the underlying buffer is reused by the audio system
      this.port.postMessage(new Float32Array(input[0]));
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
