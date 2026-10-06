/* AudioWorklet: hands raw microphone samples to the page, which resamples them to 16 kHz
   mono and posts a WAV to the node. Nothing is recorded unless the mic button is held. */
class SahayakRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("sahayak-recorder", SahayakRecorder);
