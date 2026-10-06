/* Microphone capture shared by the app and the VoiceBench recorder.
   Records raw audio through an AudioWorklet (web/recorder.js), resamples it to 16 kHz mono and
   returns a WAV Blob, so the node never needs ffmpeg. Browsers open the mic only on a secure
   origin: localhost on the node, or the HTTPS address. Nothing is kept after stop(). */
(() => {
  "use strict";

  const canListen = Boolean(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia
    && window.AudioWorkletNode);
  const mic = { ctx: null, stream: null, src: null, node: null, sink: null, chunks: [], started: 0 };

  function beep(freq) {
    try {
      const ctx = mic.ctx;
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.06;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.09);
    } catch { /* no sound is fine */ }
  }

  async function start(meterBar) {
    if (!mic.stream) {
      mic.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    }
    if (!mic.ctx) {
      mic.ctx = new AudioContext();
      await mic.ctx.audioWorklet.addModule("/app/recorder.js");
      mic.sink = mic.ctx.createGain();
      mic.sink.gain.value = 0;  // keeps the worklet running without playing the mic back
      mic.sink.connect(mic.ctx.destination);
    }
    if (mic.ctx.state === "suspended") await mic.ctx.resume();
    mic.chunks = [];
    mic.src = mic.ctx.createMediaStreamSource(mic.stream);
    mic.node = new AudioWorkletNode(mic.ctx, "sahayak-recorder");
    mic.node.port.onmessage = (e) => {
      mic.chunks.push(e.data);
      if (!meterBar) return;
      let sum = 0;
      for (let i = 0; i < e.data.length; i += 1) sum += e.data[i] * e.data[i];
      meterBar.style.transform = `scaleX(${Math.min(1, Math.sqrt(sum / e.data.length) * 8).toFixed(3)})`;
    };
    mic.src.connect(mic.node).connect(mic.sink);
    mic.started = performance.now();
    beep(880);
  }

  // Returns a 16 kHz mono WAV Blob, or null if nothing (or under minSeconds) was recorded.
  function stop(minSeconds = 0.4) {
    if (!mic.node) return null;
    mic.src.disconnect();
    mic.node.disconnect();
    mic.node.port.onmessage = null;
    mic.node = null;
    beep(620);
    if ((performance.now() - mic.started) / 1000 < minSeconds) return null;
    const wav = encodeWav(mic.chunks, mic.ctx.sampleRate);
    mic.chunks = [];
    return wav;
  }

  function encodeWav(chunks, rate) {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const input = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) { input.set(c, offset); offset += c.length; }
    const ratio = rate / 16000;
    const n = Math.floor(total / ratio);
    const pcm = new Int16Array(n);
    for (let i = 0; i < n; i += 1) {  // average the source samples each output sample covers
      const from = Math.floor(i * ratio);
      const to = Math.min(total, Math.max(from + 1, Math.floor((i + 1) * ratio)));
      let s = 0;
      for (let j = from; j < to; j += 1) s += input[j];
      pcm[i] = Math.max(-1, Math.min(1, s / (to - from))) * 32767;
    }
    const buf = new ArrayBuffer(44 + n * 2);
    const dv = new DataView(buf);
    const ascii = (at, s) => { for (let i = 0; i < s.length; i += 1) dv.setUint8(at + i, s.charCodeAt(i)); };
    ascii(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); ascii(8, "WAVE"); ascii(12, "fmt ");
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 16000, true);
    dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    ascii(36, "data"); dv.setUint32(40, n * 2, true);
    new Int16Array(buf, 44).set(pcm);
    return new Blob([buf], { type: "audio/wav" });
  }

  window.SahayakMic = { canListen, start, stop, recording: () => Boolean(mic.node) };
})();
