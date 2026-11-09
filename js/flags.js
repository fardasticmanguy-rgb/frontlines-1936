import { NATIONS, NATION_FLAGS, TAU, onRosterChange } from "./config.js";

function drawStar(g, cx, cy, r) {
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const angle = -Math.PI / 2 + (k * Math.PI) / 5;
    const radius = k % 2 ? r * 0.45 : r;
    g.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
  }
  g.closePath();
  g.fill();
}

const stripes = (g, w, h, colors, vertical) =>
  colors.forEach((color, k) => {
    g.fillStyle = color;
    if (vertical) g.fillRect((w / colors.length) * k, 0, w / colors.length + 1, h);
    else g.fillRect(0, (h / colors.length) * k, w, h / colors.length + 1);
  });

const DESIGNS = {
  karnia: (g, w, h) => {
    g.fillStyle = "#a32a26";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#111";
    g.fillRect(0, h * 0.36, w, h * 0.28);
    g.fillStyle = "#e9dfc6";
    g.fillRect(0, h * 0.3, w, h * 0.06);
    g.fillRect(0, h * 0.64, w, h * 0.06);
  },
  vestmark: (g, w, h) => {
    g.fillStyle = "#2d5a97";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#f0e9d6";
    g.fillRect(w * 0.28, 0, w * 0.16, h);
    g.fillRect(0, h * 0.4, w, h * 0.2);
    g.fillStyle = "#e0b43a";
    g.fillRect(w * 0.32, 0, w * 0.08, h);
    g.fillRect(0, h * 0.45, w, h * 0.1);
  },
  ostravia: (g, w, h) => {
    g.fillStyle = "#3c7a3a";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#efe8d2";
    g.fillRect(w / 3, 0, w / 3, h);
    g.fillStyle = "#3c7a3a";
    g.beginPath();
    g.arc(w / 2, h / 2, h * 0.17, 0, TAU);
    g.fill();
  },
  aurelia: (g, w, h) => {
    g.fillStyle = "#d9a933";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#1a1a1a";
    g.fillRect(0, h * 0.78, w, h * 0.22);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w * 0.42, h * 0.39);
    g.lineTo(0, h * 0.78);
    g.closePath();
    g.fill();
    g.fillStyle = "#d9a933";
    drawStar(g, w * 0.15, h * 0.39, h * 0.13);
  },
  borvia: (g, w, h) => {
    g.fillStyle = "#5f3f8f";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#efe8d2";
    g.lineWidth = h * 0.18;
    g.beginPath();
    g.moveTo(0, h);
    g.lineTo(w, 0);
    g.stroke();
  },
  tessara: (g, w, h) => {
    stripes(g, w, h, ["#2f8582", "#efe8d2", "#2f8582"]);
    g.fillStyle = "#c94f3b";
    g.beginPath();
    g.arc(w / 2, h / 2, h * 0.2, 0, TAU);
    g.fill();
  },
  valkor: (g, w, h) => {
    g.fillStyle = "#c46a2c";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#1c1c1c";
    g.fillRect(0, 0, w / 2, h / 2);
    g.fillRect(w / 2, h / 2, w / 2, h / 2);
  },
  istrena: (g, w, h) => {
    g.fillStyle = "#a8506d";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#efe8d2";
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w * 0.5, h * 0.5);
    g.lineTo(0, h);
    g.closePath();
    g.fill();
  },
  germany: (g, w, h) => stripes(g, w, h, ["#161616", "#f2f0e8", "#c8282c"]),
  uk: (g, w, h) => {
    g.fillStyle = "#1f3f8c";
    g.fillRect(0, 0, w, h);
    g.lineCap = "butt";
    g.strokeStyle = "#f2f0e8";
    g.lineWidth = h * 0.2;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w, h);
    g.moveTo(w, 0);
    g.lineTo(0, h);
    g.stroke();
    g.strokeStyle = "#c8282c";
    g.lineWidth = h * 0.07;
    g.stroke();
    g.fillStyle = "#f2f0e8";
    g.fillRect(w * 0.4, 0, w * 0.2, h);
    g.fillRect(0, h * 0.35, w, h * 0.3);
    g.fillStyle = "#c8282c";
    g.fillRect(w * 0.44, 0, w * 0.12, h);
    g.fillRect(0, h * 0.41, w, h * 0.18);
  },
  france: (g, w, h) => stripes(g, w, h, ["#1f3f8c", "#f2f0e8", "#c8282c"], true),
  ussr: (g, w, h) => {
    g.fillStyle = "#b5201e";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#f2c94c";
    drawStar(g, w * 0.2, h * 0.28, h * 0.16);
  },
  italy: (g, w, h) => stripes(g, w, h, ["#2e7d3a", "#f2f0e8", "#c8282c"], true),
  poland: (g, w, h) => stripes(g, w, h, ["#f2f0e8", "#c8282c"]),
  spain: (g, w, h) => stripes(g, w, h, ["#b5201e", "#f2c94c", "#f2c94c", "#b5201e"]),
  turkey: (g, w, h) => {
    g.fillStyle = "#c8282c";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#f2f0e8";
    g.beginPath();
    g.arc(w * 0.38, h / 2, h * 0.26, 0, TAU);
    g.fill();
    g.fillStyle = "#c8282c";
    g.beginPath();
    g.arc(w * 0.43, h / 2, h * 0.21, 0, TAU);
    g.fill();
    g.fillStyle = "#f2f0e8";
    drawStar(g, w * 0.6, h / 2, h * 0.12);
  },
};

function renderFlag(design) {
  const canvas = document.createElement("canvas");
  canvas.width = 60;
  canvas.height = 40;
  const g = canvas.getContext("2d");
  (DESIGNS[design] ?? DESIGNS.karnia)(g, canvas.width, canvas.height);
  g.fillStyle = "rgba(255, 255, 255, 0.08)";
  g.fillRect(0, 0, canvas.width, canvas.height / 2);
  return canvas;
}

const cache = new Map();
export const flagCanvases = [];
export const flagUrls = [];

function cached(design) {
  if (!cache.has(design)) {
    const canvas = renderFlag(design);
    cache.set(design, { canvas, url: canvas.toDataURL() });
  }
  return cache.get(design);
}

export function flagUrlFor(design) {
  return cached(design).url;
}

function syncFlags() {
  for (const n of NATIONS) {
    flagCanvases[n] = cached(NATION_FLAGS[n]).canvas;
    flagUrls[n] = cached(NATION_FLAGS[n]).url;
  }
}

onRosterChange(syncFlags);
if (NATION_FLAGS.length) syncFlags();

export function flagImage(nation) {
  return NATIONS.includes(nation) ? `<img src="${flagUrls[nation]}" alt="">` : "";
}
