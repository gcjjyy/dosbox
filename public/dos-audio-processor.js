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
// Architecture mirrors the upstream js-dos audio pipeline: a queue of mono
// Float32Array chunks pushed from the main thread, drained at the audio-thread
// rate inside process(). PRIME_THRESHOLD=2048 silences the first few process()
// callbacks until enough samples are buffered. MAX_QUEUE_SAMPLES=6144 caps
// producer overrun so worst-case AV lag stays around 140 ms @ 44.1 kHz.

class DosAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = [];
    this._queuedLength = 0;
    this._primed = false;
    this._maxQueue = 6144;
    this._primeThreshold = 2048;
    this._totalReceived = 0;
    this._processCalls = 0;
    this._lastReportAt = 0;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data && data.type === 'reset') {
        this._queue.length = 0;
        this._queuedLength = 0;
        this._primed = false;
        return;
      }
      if (!(data instanceof Float32Array) || data.length === 0) return;
      // Drop new chunks once the queue is saturated. Matches js-dos's 6144
      // backpressure cap. The producer (WASM Worker) will catch up when the
      // audio thread drains us.
      if (this._queuedLength >= this._maxQueue) return;
      this._queue.push(data);
      this._queuedLength += data.length;
      this._totalReceived += data.length;
    };
  }

  process(_inputs, outputs) {
    this._processCalls++;
    // Periodic heartbeat back to the main thread so the audio-status badge can
    // tell "worklet alive" from "worklet never ran" (the iOS suspended-context
    // failure mode). One message per ~1 s @ 128-frame quantum is cheap.
    if (this._processCalls % 200 === 0) {
      this.port.postMessage({
        type: 'tick',
        processCalls: this._processCalls,
        queued: this._queuedLength,
        totalReceived: this._totalReceived,
        primed: this._primed,
      });
    }

    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const channel = output[0];
    const need = channel.length;

    if (!this._primed) {
      if (this._queuedLength >= this._primeThreshold) {
        this._primed = true;
        this.port.postMessage({ type: 'primed', queued: this._queuedLength });
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
