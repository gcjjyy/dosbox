// AudioWorkletProcessor for DOSBox PCM. The emulator pushes interleaved
// Float32 chunks; the audio thread drains them at the AudioContext rate.

class DosAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = [];
    this._queuedFrames = 0;
    this._channels = 2;
    this._primed = false;
    this._primeFrames = 1024;
    this._maxFrames = 4096;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data && data.type === "reset") {
        this._reset();
        return;
      }
      if (!data || data.type !== "audio" || !(data.samples instanceof Float32Array)) return;
      const channels = data.channels === 1 ? 1 : 2;
      const samples = data.samples;
      const frames = Math.floor(samples.length / channels);
      if (frames <= 0) return;
      if (channels !== this._channels) {
        this._reset();
        this._channels = channels;
      }
      while (this._queuedFrames + frames > this._maxFrames && this._queue.length > 0) {
        const head = this._queue[0];
        const headFrames = Math.floor((head.samples.length - head.offset) / this._channels);
        this._queuedFrames -= headFrames;
        this._queue.shift();
      }
      this._queue.push({ samples, offset: 0 });
      this._queuedFrames += frames;
    };
  }

  _reset() {
    this._queue.length = 0;
    this._queuedFrames = 0;
    this._primed = false;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const need = output[0].length;
    if (!this._primed) {
      if (this._queuedFrames >= this._primeFrames) this._primed = true;
      else return true;
    }

    for (let i = 0; i < output.length; i++) output[i].fill(0);

    let written = 0;
    while (written < need && this._queue.length > 0) {
      const head = this._queue[0];
      const availableFrames = Math.floor((head.samples.length - head.offset) / this._channels);
      const takeFrames = Math.min(need - written, availableFrames);
      for (let frame = 0; frame < takeFrames; frame++) {
        const src = head.offset + frame * this._channels;
        for (let ch = 0; ch < output.length; ch++) {
          const srcCh = this._channels === 1 ? 0 : Math.min(ch, this._channels - 1);
          output[ch][written + frame] = head.samples[src + srcCh] || 0;
        }
      }
      head.offset += takeFrames * this._channels;
      this._queuedFrames -= takeFrames;
      written += takeFrames;
      if (head.offset >= head.samples.length) this._queue.shift();
    }

    if (written < need) this._primed = false;
    return true;
  }
}

registerProcessor("dos-audio-processor", DosAudioProcessor);
