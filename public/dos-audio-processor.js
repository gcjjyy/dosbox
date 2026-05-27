// public/dos-audio-processor.js
//
// AudioWorkletProcessor for the DOS emulator. Loaded as a static URL by
// dos-emulator.ts via `audioCtx.audioWorklet.addModule('/dos-audio-processor.js')`.
//
// Why a static file instead of a Blob URL: iOS Safari has had repeated bugs
// loading AudioWorklet modules from blob: URLs (silent failure, no module
// registered, no error surfaced). Same-origin static URLs are the well-trodden
// path. The file is tiny (~1 KB) so caching it for forever is fine.
//
// Architecture mirrors a conventional DOS audio pipeline: a queue of mono
// Float32Array chunks pushed from the main thread, drained at the audio-thread
// rate inside process().
//
// Buffer sizing — picked to keep steady-state latency low. Once primed, the
// queue oscillates around its initial length (consumer rate = producer rate
// on average), so PRIME_THRESHOLD effectively *is* the baseline latency.
//   PRIME_THRESHOLD = 512   →  ~10.7 ms @ 48 kHz baseline before audio starts
//   MAX_QUEUE        = 2048 →  ~42.7 ms cap if producer briefly outpaces
// Our AudioWorklet runs at 128 samples per process() call (2.67 ms), so a
// 512-sample cushion still leaves 4x headroom for postMessage jitter.

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
      // Drop new chunks once the queue is saturated. The producer (WASM
      // Worker) will catch up when the audio thread drains us. We deliberately
      // keep this cap tight (~42 ms) so any startup burst can't push baseline
      // latency above one frame's worth of audio.
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
        return true; // silence until primed (output is pre-zeroed)
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

    // Mirror mono to any extra output channels. With outputChannelCount [1]
    // this loop never runs.
    for (let i = 1; i < output.length; i++) {
      output[i].set(channel);
    }

    return true;
  }
}

registerProcessor('dos-audio-processor', DosAudioProcessor);
