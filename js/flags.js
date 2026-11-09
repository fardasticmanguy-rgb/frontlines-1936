import { NATIONS, TAU } from "./config.js";

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

const DESIGNS = [
  (g, w, h) => {
    g.fillStyle = "#a32a26";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#111";
    g.fillRect(0, h * 0.36, w, h * 0.28);
    g.fillStyle = "#e9dfc6";
    g.fillRect(0, h * 0.3, w, h * 0.06);
    g.fillRect(0, h * 0.64, w, h * 0.06);
  },
  (g, w, h) => {
    g.fillStyle = "#2d5a97";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#f0e9d6";
    g.fillRect(w * 0.28, 0, w * 0.16, h);
    g.fillRect(0, h * 0.4, w, h * 0.2);
    g.fillStyle = "#e0b43a";
    g.fillRect(w * 0.32, 0, w * 0.08, h);
    g.fillRect(0, h * 0.45, w, h * 0.1);
  },
  (g, w, h) => {
    g.fillStyle = "#3c7a3a";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#efe8d2";
    g.fillRect(w / 3, 0, w / 3, h);
    g.fillStyle = "#3c7a3a";
    g.beginPath();
    g.arc(w / 2, h / 2, h * 0.17, 0, TAU);
    g.fill();
  },
  (g, w, h) => {
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
];

function renderFlag(nation) {
  const canvas = document.createElement("canvas");
  canvas.width = 60;
  canvas.height = 40;
  const g = canvas.getContext("2d");
  DESIGNS[nation](g, canvas.width, canvas.height);
  g.fillStyle = "rgba(255, 255, 255, 0.08)";
  g.fillRect(0, 0, canvas.width, canvas.height / 2);
  return canvas;
}

export const flagCanvases = NATIONS.map(renderFlag);
export const flagUrls = flagCanvases.map((canvas) => canvas.toDataURL());

export function flagImage(nation) {
  return NATIONS.includes(nation) ? `<img src="${flagUrls[nation]}" alt="">` : "";
}
