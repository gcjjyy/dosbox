// public/dos-audio-processor.js
//
// AudioWorkletProcessor for DOS audio. It mirrors the previous jsdos-era web
// output path: the emulator pushes mono Float32Array chunks, and the audio
// thread drains them at the AudioContext rate.

class DosAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = [];
    this._queuedLength = 0;
    this._primed = false;
    this._maxQueue = 2048;
    this._primeThreshold = 512;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data && data.type === 'reset') {
        this._queue.length = 0;
        this._queuedLength = 0;
        this._primed = false;
        return;
      }
      if (!(data instanceof Float32Array) || data.length === 0) return;
      if (this._queuedLength >= this._maxQueue) return;
      this._queue.push(data);
      this._queuedLength += data.length;
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const channel = output[0];
    const need = channel.length;

    if (!this._primed) {
      if (this._queuedLength >= this._primeThreshold) {
        this._primed = true;
      } else {
        return true;
      }
    }

    let written = 0;
    while (written < need && this._queue.length > 0) {
      const head = this._queue[0];
      const take = need - written;
      if (head.length <= take) {
        channel.set(head, written);
        written += head.length;
        this._queuedLength -= head.length;
        this._queue.shift();
      } else {
        channel.set(head.subarray(0, take), written);
        this._queue[0] = head.subarray(take);
        this._queuedLength -= take;
        written += take;
      }
    }

    if (written < need) {
      for (let i = written; i < need; i++) channel[i] = 0;
    }
    for (let i = 1; i < output.length; i++) {
      output[i].set(channel);
    }
    return true;
  }
}

registerProcessor('dos-audio-processor', DosAudioProcessor);
