#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

const [, , file] = process.argv;
if (!file) {
  console.error("Usage: patch-loader.mjs <dosbox0743.js>");
  process.exit(1);
}

let source = readFileSync(file, "utf8");

function replaceOnce(label, needle, replacement) {
  const count = source.split(needle).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected 1 match, found ${count}`);
  }
  source = source.replace(needle, replacement);
}

if (!source.includes('if(Module["onAudio"]){var curtime=SDL.audioContext["currentTime"];')) {
  replaceOnce(
    "disable SDL WebAudio when Module.onAudio is installed",
    'if(sizeSamplesPerChannel!=SDL.audio.samples){throw"Received mismatching audio buffer size!"}var source=SDL.audioContext["createBufferSource"]();',
    'if(sizeSamplesPerChannel!=SDL.audio.samples){throw"Received mismatching audio buffer size!"}if(Module["onAudio"]){var curtime=SDL.audioContext["currentTime"];var playtime=Math.max(curtime+SDL.audio.bufferingDelay,SDL.audio.nextPlayTime);SDL.audio.nextPlayTime=playtime+SDL.audio.bufferDurationSecs;return}var source=SDL.audioContext["createBufferSource"]();',
  );
}

writeFileSync(file, source);
