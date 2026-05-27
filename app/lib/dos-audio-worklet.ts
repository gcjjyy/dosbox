// app/lib/dos-audio-worklet.ts
//
// Single source of truth for the AudioWorklet processor URL + name. The
// processor source lives under public/ so AudioContext.audioWorklet.addModule()
// loads it from a same-origin static URL.

export const PROCESSOR_NAME = "dos-audio-processor";
export const WORKLET_URL = "/dos-audio-processor.js";
