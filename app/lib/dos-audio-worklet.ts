// app/lib/dos-audio-worklet.ts
//
// Single source of truth for the AudioWorklet processor URL + name. The
// processor source itself lives at `public/dos-audio-processor.js` so that
// AudioContext.audioWorklet.addModule() loads it from a same-origin static
// URL — iOS Safari has had repeated bugs loading worklets from blob: URLs,
// silently failing with no module registered and no error surfaced.

export const PROCESSOR_NAME = "dos-audio-processor";
export const WORKLET_URL = "/dos-audio-processor.js";
