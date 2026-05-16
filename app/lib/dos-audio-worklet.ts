// app/lib/dos-audio-worklet.ts
//
// AudioWorklet processor for the DOS emulator. Source is shipped as a string
// and loaded into the AudioContext at runtime via a Blob URL — no separate
// public/ file, no build-config changes.
//
// Architecture mirrors the upstream js-dos audio pipeline (a pull-based ring
// buffer drained by the audio thread), but uses AudioWorkletNode instead of
// the deprecated ScriptProcessorNode. The processor sits on the audio thread,
// owns its own queue of Float32Array chunks, and refills the output buffer in
// process() at the rate the audio clock demands. The main thread just posts
// new chunks via the node's port — no scheduling, no per-chunk allocation of
// AudioBuffer/AudioBufferSourceNode, no future-scheduling cap that drops
// bursty arrivals (which was killing mobile audio in the old design).
//
// PRIME_THRESHOLD matches js-dos's 2048 — wait until the queue has enough
// samples before unmuting, so the first few process() callbacks don't emit
// stuttery half-filled buffers while the WASM worker is still warming up.
// MAX_QUEUE_SAMPLES matches js-dos's 6144 — once the queue is that deep,
// drop incoming chunks rather than let the producer outrun consumption
// indefinitely (caps the worst-case AV lag at ~140ms @ 44100Hz).

export const PROCESSOR_NAME = "dos-audio-processor";

export const WORKLET_SOURCE = `
class DosAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = [];
    this._queuedLength = 0;
    this._primed = false;
    this._maxQueue = 6144;
    this._primeThreshold = 2048;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data && data.type === 'reset') {
        this._queue.length = 0;
        this._queuedLength = 0;
        this._primed = false;
        return;
      }
      if (!(data instanceof Float32Array) || data.length === 0) return;
      // Drop new chunks if the queue is already saturated. Matches js-dos's
      // 6144-sample backpressure cap.
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
        // Silence until we have enough buffered. process() returning true keeps
        // the node alive; the output is already zero-filled by the runtime.
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
      // Underrun: fill the rest with silence. Don't drop priming so we keep
      // pulling — a brief gap is better than re-entering the prime delay.
      for (let i = written; i < need; i++) channel[i] = 0;
    }

    // DOS audio is mono; mirror to any additional output channels the host
    // gave us. With outputChannelCount: [1] this loop is a no-op.
    for (let i = 1; i < output.length; i++) {
      output[i].set(channel);
    }

    return true;
  }
}

registerProcessor('${PROCESSOR_NAME}', DosAudioProcessor);
`;

export function createWorkletModuleUrl(): string {
  const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
  return URL.createObjectURL(blob);
}
