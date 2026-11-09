import { store } from "./store.js";

const VOLUME = 0.5;
let context = null;
let master = null;
let noiseBuffer = null;
let muted = readMuted();

function readMuted() {
  try {
    return localStorage.getItem("flMuted") === "1";
  } catch {
    return false;
  }
}

export function unlockAudio() {
  if (context) {
    if (context.state === "suspended") context.resume().catch(() => {});
    return;
  }
  try {
    context = new (window.AudioContext || window.webkitAudioContext)();
    master = context.createGain();
    master.gain.value = muted ? 0 : VOLUME;
    master.connect(context.destination);
    noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  } catch {
    context = null;
  }
}

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = value;
  try {
    localStorage.setItem("flMuted", muted ? "1" : "0");
  } catch {}
  if (master) master.gain.value = muted ? 0 : VOLUME;
}

function tone(frequency, duration, type = "square", volume = 0.1, slideTo = 0, delay = 0) {
  const start = context.currentTime + delay;
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), start + duration);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(master);
  osc.start(start);
  osc.stop(start + duration + 0.03);
}

function noise(duration, volume, cutoff = 1500, delay = 0) {
  const start = context.currentTime + delay;
  const source = context.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(cutoff, start);
  filter.frequency.exponentialRampToValueAtTime(60, start + duration);
  const gain = context.createGain();
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  source.start(start);
  source.stop(start + duration + 0.02);
}

const arpeggio = (notes, step, length, type, volume) =>
  notes.forEach((f, i) => tone(f, length, type, volume, 0, i * step));

const SOUNDS = {
  click: () => tone(520, 0.04, "square", 0.025),
  order: () => {
    noise(0.08, 0.12, 1200);
    tone(180, 0.08, "triangle", 0.08, 120);
  },
  march: () => {
    for (let i = 0; i < 7; i++) noise(0.06, 0.13, 700, i * 0.12);
    tone(98, 0.8, "sawtooth", 0.04, 82);
  },
  battle: () => {
    noise(0.6, 0.32, 1100);
    tone(70, 0.5, "sine", 0.22, 30);
  },
  capture: () => arpeggio([392, 494, 587], 0.08, 0.18, "triangle", 0.07),
  turn: () => {
    tone(392, 0.12, "triangle", 0.07);
    tone(587, 0.2, "triangle", 0.07, 0, 0.11);
  },
  victory: () => arpeggio([392, 494, 587, 784, 988], 0.13, 0.32, "triangle", 0.08),
  defeat: () => arpeggio([294, 247, 196, 147], 0.16, 0.4, "sawtooth", 0.06),
  tick: () => tone(1000, 0.03, "square", 0.02),
};

export function playSound(name) {
  if (!context || !store.game || store.game.mode === "demo") return;
  SOUNDS[name]?.();
}
