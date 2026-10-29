import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "music.wav");
mkdirSync(dirname(out), { recursive: true });

const SR = 44100;
const DURATION = 35; // seconds
const N = Math.floor(SR * DURATION);

// Chord progression (Hz), each ~8.75s — soft pad
const CHORDS = [
  [130.81, 164.81, 196.0, 246.94], // Cmaj7
  [110.0, 130.81, 164.81, 196.0],  // Am7
  [87.31, 110.0, 130.81, 164.81],  // Fmaj7
  [98.0, 123.47, 146.83, 196.0],   // G6-ish
];
const CHORD_LEN = DURATION / CHORDS.length;
const XFADE = 1.5; // crossfade seconds

function padSample(t) {
  const idx = Math.min(Math.floor(t / CHORD_LEN), CHORDS.length - 1);
  const local = t - idx * CHORD_LEN;
  const a = Math.min(local / XFADE, 1); // fade-in within chord
  const b = Math.min((CHORD_LEN - local) / XFADE, 1); // fade-out before next
  const env = Math.min(a, b);
  let s = 0;
  const chord = CHORDS[idx];
  for (let i = 0; i < chord.length; i++) {
    const f = chord[i];
    // two detuned sines per note -> softer "analog" pad
    s += Math.sin(2 * Math.PI * f * t) * 0.5;
    s += Math.sin(2 * Math.PI * (f * 1.004) * t) * 0.3;
  }
  s /= chord.length;
  // slow tremolo for movement
  s *= 1 + 0.12 * Math.sin(2 * Math.PI * 0.18 * t);
  // sub bass root
  s += Math.sin(2 * Math.PI * (chord[0] / 2) * t) * 0.25;
  return s * env;
}

// sparse pluck melody for some motion
const PLUCKS = [
  [2.0, 523.25], [5.5, 659.25], [10.0, 587.33], [14.5, 783.99],
  [18.0, 659.25], [22.0, 523.25], [26.5, 698.46], [30.0, 587.33], [33.0, 659.25],
];
function pluckSample(t) {
  let s = 0;
  for (const [start, f] of PLUCKS) {
    const dt = t - start;
    if (dt <= 0 || dt > 2.5) continue;
    const env = Math.exp(-dt * 3.2);
    s += Math.sin(2 * Math.PI * f * dt) * env * 0.6;
    s += Math.sin(2 * Math.PI * f * 2 * dt) * env * 0.15;
  }
  return s;
}

const data = new Int16Array(N * 2);
let peak = 0;
const samples = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const t = i / SR;
  // global fade in/out
  const g = Math.min(t / 1.2, 1) * Math.min((DURATION - t) / 1.5, 1);
  const v = (padSample(t) * 0.8 + pluckSample(t) * 0.5) * g;
  samples[i] = v;
  if (Math.abs(v) > peak) peak = Math.abs(v);
}
const norm = peak > 0 ? 0.35 / peak : 1;
for (let i = 0; i < N; i++) {
  const v = Math.max(-1, Math.min(1, samples[i] * norm));
  data[i * 2] = Math.round(v * 32767);
  data[i * 2 + 1] = data[i * 2];
}

// WAV header
const buf = Buffer.alloc(44 + data.length * 2);
buf.write("RIFF", 0);
buf.writeUInt32LE(36 + data.length * 2, 4);
buf.write("WAVE", 8);
buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); // PCM
buf.writeUInt16LE(2, 22); // stereo
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write("data", 36);
buf.writeUInt32LE(data.length * 2, 40);
Buffer.from(data.buffer).copy(buf, 44);

writeFileSync(out, buf);
console.log(`wrote ${out} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
