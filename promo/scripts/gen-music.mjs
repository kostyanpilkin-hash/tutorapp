import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "music.wav");
mkdirSync(dirname(out), { recursive: true });

const SR = 44100;
const DURATION = 40; // seconds — full promo length
const N = Math.floor(SR * DURATION);

// Warm ambient progression — 10s per chord, long crossfades, no gaps.
const CHORDS = [
  [130.81, 164.81, 196.0, 246.94], // Cmaj7
  [110.0, 164.81, 196.0, 246.94],  // Am9-ish
  [87.31, 130.81, 164.81, 220.0],  // Fmaj7
  [98.0, 146.83, 196.0, 246.94],   // Gadd9
];
const CHORD_LEN = DURATION / CHORDS.length;
const XFADE = 3.0; // seconds — seamless transitions

function padSample(t) {
  const idx = Math.min(Math.floor(t / CHORD_LEN), CHORDS.length - 1);
  const local = t - idx * CHORD_LEN;
  const fadeIn = Math.min(local / XFADE, 1);
  const fadeOut = Math.min((CHORD_LEN - local) / XFADE, 1);
  const env = Math.min(fadeIn, fadeOut);
  const chord = CHORDS[idx];
  let s = 0;
  for (const f of chord) {
    s += Math.sin(2 * Math.PI * f * t) * 0.45;
    s += Math.sin(2 * Math.PI * (f * 1.0035) * t) * 0.28; // gentle detune shimmer
  }
  s /= chord.length;
  s *= 1 + 0.1 * Math.sin(2 * Math.PI * 0.15 * t); // slow tremolo
  s += Math.sin(2 * Math.PI * (chord[0] / 2) * t) * 0.2; // quiet sub
  return s * env;
}

// Soft sparse bells — gentle attack, long decay, every ~4s
const BELLS = [
  [3.0, 659.25], [7.0, 783.99], [11.5, 587.33], [15.0, 880.0],
  [19.0, 659.25], [23.0, 783.99], [27.0, 698.46], [31.5, 587.33],
  [35.0, 659.25], [38.0, 523.25],
];
function bellSample(t) {
  let s = 0;
  for (const [start, f] of BELLS) {
    const dt = t - start;
    if (dt <= 0 || dt > 3.5) continue;
    const env = (1 - Math.exp(-dt * 14)) * Math.exp(-dt * 2.2); // soft attack + long decay
    s += Math.sin(2 * Math.PI * f * dt) * env;
    s += Math.sin(2 * Math.PI * f * 3 * dt) * env * 0.1; // faint overtone
  }
  return s * 0.35;
}

const data = new Int16Array(N * 2);
let peak = 0;
const samples = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const edge = Math.min(t / 1.5, 1) * Math.min((DURATION - t) / 2.0, 1);
  const v = (padSample(t) * 0.85 + bellSample(t) * 0.45) * edge;
  samples[i] = v;
  if (Math.abs(v) > peak) peak = Math.abs(v);
}
const norm = peak > 0 ? 0.32 / peak : 1;
for (let i = 0; i < N; i++) {
  const v = Math.max(-1, Math.min(1, samples[i] * norm));
  data[i * 2] = Math.round(v * 32767);
  data[i * 2 + 1] = data[i * 2];
}

const buf = Buffer.alloc(44 + data.length * 2);
buf.write("RIFF", 0);
buf.writeUInt32LE(36 + data.length * 2, 4);
buf.write("WAVE", 8);
buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write("data", 36);
buf.writeUInt32LE(data.length * 2, 40);
Buffer.from(data.buffer).copy(buf, 44);

writeFileSync(out, buf);
console.log(`wrote ${out} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
