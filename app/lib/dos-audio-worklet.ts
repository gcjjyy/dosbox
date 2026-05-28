// Same-origin static AudioWorklet module. Blob worklet URLs have had Safari
// failures, so keep the processor in public/ and load it by URL.
export const PROCESSOR_NAME = "dos-audio-processor";
export const WORKLET_URL = "/dos-audio-processor.js";
