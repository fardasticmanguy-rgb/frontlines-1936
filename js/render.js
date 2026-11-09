import {
  BUILDING,
  MAP_HEIGHT,
  MAP_WIDTH,
  NATION_COLORS,
  NATION_NAMES,
  NATIONS,
  TAU,
  clamp,
} from "./config.js";
import { flagCanvases } from "./flags.js";
import { canPlan } from "./game.js";
import { pointInPolygon } from "./geometry.js";
import { createRng } from "./random.js";
import { areAllied, attackStrength, defenseStrength, supplyNetwork, winterActive } from "./rules.js";
import { store } from "./store.js";
import { mapMatrix, updateLayout, view } from "./view.js";

export const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");

const ATTACK_COLOR = "#d8432c";
const MOVE_COLOR = "#5aa0d8";
const GOLD = "#f1cf6b";
const TERRAIN_FILL = ["#c4b688", "#9ba46d", "#ab9c82"];
const FONT = "Oswald, system-ui, sans-serif";

const grain = createGrain();
const pathCache = new WeakMap();
let baseLayer = null;
let reliefLayer = null;

const effects = [];
const flashes = new Map();
const sweeps = new Map();
const floaters = [];
const snowflakes = [];
const labelCache = new WeakMap();
const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const hatch = createHatch();
let shake = 0;
let winterAmount = 0;

function createCanvas(width, height) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

function createGrain() {
  const c = createCanvas(160, 160);
  const g = c.getContext("2d");
  const image = g.createImageData(160, 160);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = Math.random() * 255;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    image.data[i + 3] = 30;
  }
  g.putImageData(image, 0, 0);
  return c;
}

function createHatch() {
  const c = createCanvas(12, 12);
  const g = c.getContext("2d");
  g.strokeStyle = "rgba(30, 10, 6, 0.55)";
  g.lineWidth = 2.2;
  g.beginPath();
  for (const offset of [-12, 0, 12]) {
    g.moveTo(offset, 12);
    g.lineTo(offset + 12, 0);
  }
  g.stroke();
  return c;
}

function polygonArea(polygon) {
  let area = 0;
  for (let k = 0; k < polygon.length; k++) {
    const p = polygon[k];
    const q = polygon[(k + 1) % polygon.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(area) / 2;
}

function pathsFor(map) {
  let paths = pathCache.get(map);
  if (paths) return paths;
  const land = new Path2D();
  const provinces = map.provinces.map((p) => {
    const path = new Path2D();
    p.polygon.forEach(([x, y], k) => (k ? path.lineTo(x, y) : path.moveTo(x, y)));
    path.closePath();
    if (p.land) land.addPath(path);
    return path;
  });
  paths = { land, provinces, areas: map.provinces.map((p) => polygonArea(p.polygon)) };
  pathCache.set(map, paths);
  return paths;
}

function upright(g, x, y) {
  g.save();
  g.translate(x, y);
  if (view.rotated) g.rotate(-Math.PI / 2);
}

function fillSea(g, width, height) {
  const gradient = g.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#24495b");
  gradient.addColorStop(1, "#163140");
  g.fillStyle = gradient;
  g.fillRect(0, 0, width, height);
}

function roundedRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function scatterInside(p, rng, count, spacing) {
  const xs = p.polygon.map((v) => v[0]);
  const ys = p.polygon.map((v) => v[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const spots = [];
  for (let tries = 0; spots.length < count && tries < 200; tries++) {
    const x = x0 + rng() * (x1 - x0);
    const y = y0 + rng() * (y1 - y0);
    if (!pointInPolygon(p.polygon, x, y)) continue;
    if ((x - p.x) ** 2 + (y - p.y) ** 2 < 400) continue;
    if (spots.some(([sx, sy]) => (sx - x) ** 2 + (sy - y) ** 2 < spacing * spacing)) continue;
    const margin = [
      [8, 0],
      [-8, 0],
      [0, 8],
      [0, -8],
    ];
    if (!margin.every(([dx, dy]) => pointInPolygon(p.polygon, x + dx, y + dy))) continue;
    spots.push([x, y]);
  }
  return spots;
}

function drawTree(g) {
  g.fillStyle = "rgba(40, 58, 28, 0.55)";
  g.beginPath();
  g.arc(1, 1.5, 4.2, 0, TAU);
  g.fill();
  g.fillStyle = "rgba(78, 104, 52, 0.9)";
  g.beginPath();
  g.arc(0, 0, 3.8, 0, TAU);
  g.fill();
  g.fillStyle = "rgba(120, 145, 80, 0.6)";
  g.beginPath();
  g.arc(-1.2, -1.2, 1.6, 0, TAU);
  g.fill();
}

function drawPeak(g, size) {
  g.fillStyle = "rgba(238, 230, 210, 0.85)";
  g.beginPath();
  g.moveTo(-size, size * 0.6);
  g.lineTo(0, -size * 0.8);
  g.lineTo(0, size * 0.6);
  g.closePath();
  g.fill();
  g.fillStyle = "rgba(92, 80, 62, 0.85)";
  g.beginPath();
  g.moveTo(0, -size * 0.8);
  g.lineTo(size, size * 0.6);
  g.lineTo(0, size * 0.6);
  g.closePath();
  g.fill();
  g.strokeStyle = "rgba(60, 50, 38, 0.6)";
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(-size, size * 0.6);
  g.lineTo(0, -size * 0.8);
  g.lineTo(size, size * 0.6);
  g.stroke();
}

function drawField(g) {
  g.strokeStyle = "rgba(120, 105, 60, 0.35)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(-5, 0);
  g.lineTo(5, 0);
  g.moveTo(-4, 3);
  g.lineTo(4, 3);
  g.stroke();
}

function strokeEdges(g, map, predicate) {
  g.beginPath();
  for (const e of map.edges) {
    if (!predicate(e)) continue;
    g.moveTo(e.x1, e.y1);
    g.lineTo(e.x2, e.y2);
  }
  g.stroke();
}

function buildLayers() {
  const map = store.map;
  const { provinces } = map;
  const paths = pathsFor(map);
  const b = view.bounds;
  const k = view.layerScale * view.dpr;
  const width = Math.ceil((b.x1 - b.x0) * k);
  const height = Math.ceil((b.y1 - b.y0) * k);
  baseLayer = createCanvas(width, height);
  reliefLayer = createCanvas(width, height);
  const matrix = mapMatrix(k, -b.x0 * k, -b.y0 * k);

  const g = baseLayer.getContext("2d");
  const pattern = g.createPattern(grain, "repeat");
  fillSea(g, width, height);
  g.fillStyle = pattern;
  g.fillRect(0, 0, width, height);
  g.setTransform(...matrix);

  g.strokeStyle = "rgba(190, 220, 225, 0.07)";
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 100; x < MAP_WIDTH; x += 100) {
    g.moveTo(x, 0);
    g.lineTo(x, MAP_HEIGHT);
  }
  for (let y = 100; y < MAP_HEIGHT; y += 100) {
    g.moveTo(0, y);
    g.lineTo(MAP_WIDTH, y);
  }
  g.stroke();

  g.lineJoin = "round";
  for (const [color, width] of [
    ["rgba(110, 170, 175, 0.22)", 30],
    ["rgba(135, 190, 190, 0.3)", 15],
    ["rgba(170, 210, 200, 0.32)", 6],
  ]) {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.stroke(paths.land);
  }
  for (const p of provinces) {
    if (!p.land) continue;
    g.fillStyle = TERRAIN_FILL[p.terrain];
    g.fill(paths.provinces[p.id]);
  }
  g.save();
  g.clip(paths.land);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = pattern;
  g.fillRect(0, 0, width, height);
  g.restore();

  const r = reliefLayer.getContext("2d");
  r.setTransform(...matrix);
  const rng = createRng(map.seed + 7);
  for (const p of provinces) {
    if (!p.land) continue;
    const count = [3, 11, 6][p.terrain];
    const spacing = p.terrain === 1 ? 9 : 17;
    for (const [x, y] of scatterInside(p, rng, count, spacing)) {
      upright(r, x, y);
      if (p.terrain === 1) drawTree(r);
      else if (p.terrain === 2) drawPeak(r, 7 + rng() * 4);
      else drawField(r);
      r.restore();
    }
  }
  r.strokeStyle = "rgba(55, 45, 28, 0.42)";
  r.lineWidth = 0.9;
  strokeEdges(r, map, (e) => provinces[e.a].land && provinces[e.b].land);
  r.strokeStyle = "rgba(30, 32, 26, 0.9)";
  r.lineWidth = 1.6;
  strokeEdges(r, map, (e) => provinces[e.a].land !== provinces[e.b].land);
  r.setLineDash([5, 4]);
  r.lineCap = "round";
  for (const [a, b] of map.links ?? []) {
    const pa = provinces[a];
    const pb = provinces[b];
    r.strokeStyle = "rgba(20, 30, 36, 0.55)";
    r.lineWidth = 3.4;
    r.beginPath();
    r.moveTo(pa.x, pa.y);
    r.lineTo(pb.x, pb.y);
    r.stroke();
    r.strokeStyle = "rgba(220, 236, 240, 0.85)";
    r.lineWidth = 1.6;
    r.stroke();
  }
  r.setLineDash([]);
}

export function addRing(x, y, radius, color, life) {
  effects.push({ kind: "ring", x, y, r: 3, radius, color, life, maxLife: life });
}

export function addSparks(x, y, color, count, speed) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * TAU;
    const s = speed * (0.3 + Math.random() * 0.7);
    const life = 0.5 + Math.random() * 0.5;
    effects.push({
      kind: "spark",
      x,
      y,
      vx: Math.cos(angle) * s,
      vy: Math.sin(angle) * s,
      color,
      life,
      maxLife: 1,
    });
  }
}

export function addSmoke(x, y) {
  for (let i = 0; i < 6; i++) {
    const rise = -10 - Math.random() * 12;
    const drift = (Math.random() - 0.5) * 8;
    effects.push({
      kind: "smoke",
      x: x + (Math.random() - 0.5) * 16,
      y: y + (Math.random() - 0.5) * 10,
      vx: view.rotated ? rise : drift,
      vy: view.rotated ? drift : rise,
      r: 5 + Math.random() * 5,
      life: 1.2 + Math.random() * 0.6,
      maxLife: 1.8,
    });
  }
}

export function addBlast(x, y, size, delay) {
  effects.push({ kind: "blast", x, y, size, delay, life: 0.5, maxLife: 0.5 });
}

export function addFloater(x, y, text, color, delay = 0) {
  floaters.push({ x, y, text, color, delay, life: 1.8 });
}

export function addShake(amount) {
  if (!reducedMotion) shake = Math.min(12, shake + amount);
}

export function flashProvince(id) {
  flashes.set(id, 1);
}

export function sweepProvince(id, from, x, y) {
  sweeps.set(id, { from, x, y, t: 0 });
}

export function clearEffects() {
  effects.length = 0;
  floaters.length = 0;
  flashes.clear();
  sweeps.clear();
  shake = 0;
}

export function arrowCurve(map, from, to) {
  const a = map.provinces[from];
  const b = map.provinces[to];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const sx = a.x + ux * 12;
  const sy = a.y + uy * 12;
  const ex = b.x - ux * 14;
  const ey = b.y - uy * 14;
  return [sx, sy, (sx + ex) / 2 - uy * length * 0.16, (sy + ey) / 2 + ux * length * 0.16, ex, ey];
}

export function curvePoint(c, t) {
  const u = 1 - t;
  return [u * u * c[0] + 2 * u * t * c[2] + t * t * c[4], u * u * c[1] + 2 * u * t * c[3] + t * t * c[5]];
}

function drawText(text, x, y, font, color) {
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(20, 18, 12, 0.75)";
  ctx.lineWidth = 3;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawArrow(map, from, to, color, alpha, label, winning) {
  const c = arrowCurve(map, from, to);
  const spine = [];
  for (let k = 0; k <= 16; k++) spine.push(curvePoint(c, (k / 16) * 0.86));
  const tip = curvePoint(c, 1);
  const neck = spine[spine.length - 1];
  const heading = Math.atan2(tip[1] - neck[1], tip[0] - neck[0]);

  const left = [];
  const right = [];
  spine.forEach((p, k) => {
    const next = spine[Math.min(k + 1, spine.length - 1)];
    const prev = spine[Math.max(k - 1, 0)];
    const angle = Math.atan2(next[1] - prev[1], next[0] - prev[0]);
    const half = 2.2 + 3.4 * (k / (spine.length - 1));
    left.push([p[0] + Math.cos(angle - Math.PI / 2) * half, p[1] + Math.sin(angle - Math.PI / 2) * half]);
    right.push([p[0] + Math.cos(angle + Math.PI / 2) * half, p[1] + Math.sin(angle + Math.PI / 2) * half]);
  });

  const head = 10.5;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  left.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.lineTo(
    neck[0] + Math.cos(heading - Math.PI / 2) * head,
    neck[1] + Math.sin(heading - Math.PI / 2) * head,
  );
  ctx.lineTo(tip[0], tip[1]);
  ctx.lineTo(
    neck[0] + Math.cos(heading + Math.PI / 2) * head,
    neck[1] + Math.sin(heading + Math.PI / 2) * head,
  );
  for (let k = right.length - 1; k >= 0; k--) ctx.lineTo(right[k][0], right[k][1]);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(c[0], c[1], tip[0], tip[1]);
  gradient.addColorStop(0, `${color}55`);
  gradient.addColorStop(1, color);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = "rgba(15, 12, 8, 0.9)";
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.stroke();

  if (label !== undefined) {
    const [mx, my] = curvePoint(c, 0.45);
    upright(ctx, mx, my);
    roundedRect(ctx, -11, -8, 22, 16, 2);
    ctx.fillStyle = "#1f2219";
    ctx.fill();
    ctx.strokeStyle = winning ? "#c9c09a" : "#ff8a6b";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = winning ? "#f1ead2" : "#ff8a6b";
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 0.5);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawCounter(x, y, troops, nation, lifted) {
  const text = String(troops);
  const numberWidth = 7 + text.length * 6.2;
  const flagWidth = nation >= 0 ? 14 : 0;
  const w = flagWidth + numberWidth + 4;
  const h = 15;
  const x0 = x - w / 2;
  const y0 = y - h / 2;

  if (lifted) {
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
    ctx.shadowBlur = 8;
  }
  roundedRect(ctx, x0, y0, w, h, 1.5);
  ctx.fillStyle = nation >= 0 ? "#2d3124" : "#4d4a40";
  ctx.fill();
  if (lifted) ctx.restore();
  ctx.strokeStyle = "#0d0e0a";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  if (nation >= 0) ctx.drawImage(flagCanvases[nation], x0 + 1.5, y0 + 1.5, flagWidth, h - 3.5);
  ctx.fillStyle = nation >= 0 ? "#f4eedb" : "#ddd6c0";
  ctx.font = `600 11px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x0 + flagWidth + 2 + numberWidth / 2, y0 + h / 2);
  if (nation >= 0) {
    ctx.fillStyle = "#69b543";
    ctx.fillRect(x0 + 1.5, y0 + h - 2.2, (w - 3) * Math.min(1, troops / 16), 1.4);
  }
}

function drawStar(x, y, r, color) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const angle = -Math.PI / 2 + (k * Math.PI) / 5;
    const radius = k % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function drawCityMarker(p) {
  if (p.capitalOf >= 0) {
    drawStar(0, -16, 7.5, GOLD);
  } else {
    ctx.fillStyle = "#f4eedb";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.rect(-3.6, -19.6, 7.2, 7.2);
    ctx.fill();
    ctx.stroke();
  }
  drawText(p.name.toUpperCase(), 0, -29, `600 10.5px ${FONT}`, p.capitalOf >= 0 ? "#ffe7a3" : "#f4eedb");
}

function drawFort() {
  ctx.strokeStyle = "#14130e";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#b9b6a8";
  ctx.beginPath();
  ctx.rect(-31, -1, 9, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#14130e";
  ctx.fillRect(-29.5, 2, 6, 1.6);
}

function drawFactory(level, time) {
  const width = 4 + level * 5;
  ctx.strokeStyle = "#14130e";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#d8c08a";
  ctx.beginPath();
  ctx.moveTo(22, 8);
  for (let k = 0; k < level; k++) {
    const x = 22 + k * 5;
    ctx.lineTo(x, 3);
    ctx.lineTo(x + 2.4, 1);
    ctx.lineTo(x + 2.4, -5 - k);
    ctx.lineTo(x + 4.6, -5 - k);
    ctx.lineTo(x + 4.6, 3);
  }
  ctx.lineTo(22 + width, 3);
  ctx.lineTo(22 + width, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (let k = 0; k < level; k++) {
    const phase = (time * 0.45 + k * 0.37) % 1;
    ctx.globalAlpha = 0.5 * (1 - phase);
    ctx.fillStyle = "#e8e2d2";
    ctx.beginPath();
    ctx.arc(22 + k * 5 + 3.5 + phase * 3, -7 - k - phase * 9, 1.4 + phase * 2.4, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawSwords(x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.fillStyle = "rgba(20, 18, 12, 0.85)";
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "#e9c35a";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.strokeStyle = "#f4eedb";
  ctx.lineCap = "round";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-6, -6);
  ctx.lineTo(6, 6);
  ctx.moveTo(6, -6);
  ctx.lineTo(-6, 6);
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-6, 2);
  ctx.lineTo(-2, 6);
  ctx.moveTo(6, 2);
  ctx.lineTo(2, 6);
  ctx.stroke();
  ctx.restore();
}

function visibleState(game) {
  return game.animation && !game.animation.applied ? game.animation.before : game.state;
}

function fillOwner(owner, path) {
  ctx.globalAlpha = owner >= 0 ? 0.8 : 0.16;
  ctx.fillStyle = owner >= 0 ? NATION_COLORS[owner] : "#6d6550";
  ctx.fill(path);
}

function drawSweep(p, owner, path, sweep, dt) {
  sweep.t += dt;
  const progress = clamp(sweep.t / 0.75, 0, 1);
  const eased = 1 - (1 - progress) ** 3;
  let reach = 0;
  for (const [x, y] of p.polygon) reach = Math.max(reach, Math.hypot(x - sweep.x, y - sweep.y));
  const radius = Math.max(0.1, eased * reach);
  fillOwner(sweep.from, path);
  ctx.save();
  ctx.clip(path);
  ctx.beginPath();
  ctx.arc(sweep.x, sweep.y, radius, 0, TAU);
  ctx.save();
  ctx.clip();
  fillOwner(owner, path);
  ctx.restore();
  ctx.globalAlpha = 0.85 * (1 - progress);
  ctx.strokeStyle = "#fff3c4";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
  if (progress >= 1) sweeps.delete(p.id);
}

function drawPolitical(map, state, paths, dt) {
  for (const p of map.provinces) {
    if (!p.land) continue;
    const owner = state.owner[p.id];
    const sweep = sweeps.get(p.id);
    if (sweep) drawSweep(p, owner, paths.provinces[p.id], sweep, dt);
    else fillOwner(owner, paths.provinces[p.id]);
  }
  ctx.globalAlpha = 1;
}

function drawSupply(map, state, paths) {
  const supplied = supplyNetwork(map, state);
  const pattern = ctx.createPattern(hatch, "repeat");
  ctx.fillStyle = pattern;
  for (const p of map.provinces) {
    if (!p.land || supplied[p.id] || state.owner[p.id] < 0) continue;
    ctx.fill(paths.provinces[p.id]);
  }
}

function drawWinter(paths, dt, winter) {
  winterAmount += ((winter ? 1 : 0) - winterAmount) * Math.min(1, dt * 1.5);
  if (winterAmount < 0.01) return;
  ctx.globalAlpha = 0.3 * winterAmount;
  ctx.fillStyle = "#eef4fa";
  ctx.fill(paths.land);
  ctx.globalAlpha = 1;
}

function drawSnowfall(dt) {
  if (winterAmount < 0.01 || reducedMotion) return;
  const wanted = Math.round(110 * winterAmount);
  while (snowflakes.length < wanted) {
    snowflakes.push({
      x: Math.random() * view.width,
      y: Math.random() * view.height,
      r: 0.8 + Math.random() * 1.8,
      speed: 18 + Math.random() * 30,
      sway: Math.random() * TAU,
    });
  }
  snowflakes.length = Math.min(snowflakes.length, wanted);
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = "#ffffff";
  for (const f of snowflakes) {
    f.y += f.speed * dt;
    f.sway += dt * 1.3;
    f.x += Math.sin(f.sway) * 12 * dt;
    if (f.y > view.height + 4) {
      f.y = -4;
      f.x = Math.random() * view.width;
    }
    ctx.globalAlpha = 0.55 * winterAmount;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function nationLabels(map, state, paths) {
  const cached = labelCache.get(state.owner);
  if (cached && cached.rotated === view.rotated) return cached.labels;
  const { provinces } = map;
  const labels = [];
  const turn = view.rotated ? Math.PI / 2 : 0;

  for (const nation of NATIONS) {
    const seen = new Set();
    let best = [];
    for (const p of provinces) {
      if (!p.land || state.owner[p.id] !== nation || seen.has(p.id)) continue;
      const group = [p.id];
      seen.add(p.id);
      for (let head = 0; head < group.length; head++) {
        for (const n of provinces[group[head]].neighbors) {
          if (!seen.has(n) && state.owner[n] === nation) {
            seen.add(n);
            group.push(n);
          }
        }
      }
      if (group.length > best.length) best = group;
    }
    if (best.length < 3) continue;

    let weight = 0;
    let mx = 0;
    let my = 0;
    for (const id of best) {
      const w = paths.areas[id];
      weight += w;
      mx += provinces[id].x * w;
      my += provinces[id].y * w;
    }
    mx /= weight;
    my /= weight;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const id of best) {
      const w = paths.areas[id];
      const dx = provinces[id].x - mx;
      const dy = provinces[id].y - my;
      sxx += dx * dx * w;
      syy += dy * dy * w;
      sxy += dx * dy * w;
    }
    let screen = 0.5 * Math.atan2(2 * sxy, sxx - syy) + turn;
    while (screen > Math.PI / 2) screen -= Math.PI;
    while (screen < -Math.PI / 2) screen += Math.PI;
    screen = clamp(screen, -0.45, 0.45);
    const angle = screen - turn;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);

    let along = 0;
    let across = 0;
    for (const id of best) {
      for (const [x, y] of provinces[id].polygon) {
        along = Math.max(along, Math.abs((x - mx) * ux + (y - my) * uy));
        across = Math.max(across, Math.abs(-(x - mx) * uy + (y - my) * ux));
      }
    }
    labels.push({ nation, x: mx, y: my, angle, length: along * 1.5, thickness: across });
  }
  labelCache.set(state.owner, { rotated: view.rotated, labels });
  return labels;
}

function drawNationLabels(map, state, paths) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const spaced = "letterSpacing" in ctx;
  for (const label of nationLabels(map, state, paths)) {
    const name = spaced ? NATION_NAMES[label.nation] : NATION_NAMES[label.nation].split("").join(" ");
    ctx.font = `700 100px ${FONT}`;
    if (spaced) ctx.letterSpacing = "18px";
    const width = ctx.measureText(name).width || 1;
    const size = clamp(Math.min((label.length / width) * 100, label.thickness * 0.5), 10, 44);
    ctx.font = `700 ${size}px ${FONT}`;
    if (spaced) ctx.letterSpacing = `${size * 0.18}px`;
    ctx.save();
    ctx.translate(label.x, label.y);
    ctx.rotate(label.angle);
    ctx.fillStyle = "rgba(24, 18, 10, 0.34)";
    ctx.fillText(name, 0, 0);
    ctx.restore();
  }
  if (spaced) ctx.letterSpacing = "0px";
  ctx.restore();
}

function drawFlashes(paths, dt) {
  for (const [id, strength] of flashes) {
    ctx.globalAlpha = strength * 0.65;
    ctx.fillStyle = "#fff6d8";
    ctx.fill(paths.provinces[id]);
    if (strength - dt * 1.3 <= 0) flashes.delete(id);
    else flashes.set(id, strength - dt * 1.3);
  }
  ctx.globalAlpha = 1;
}

function drawBorders(map, state, me) {
  const { provinces } = map;
  const bothLand = (e) => provinces[e.a].land && provinces[e.b].land;
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(18, 15, 10, 0.95)";
  ctx.lineWidth = 2.8;
  strokeEdges(ctx, map, (e) => {
    const a = state.owner[e.a];
    const b = state.owner[e.b];
    return bothLand(e) && a !== b && (a >= 0 || b >= 0) && !areAllied(state, a, b);
  });
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = "rgba(225, 240, 255, 0.85)";
  ctx.lineWidth = 2;
  strokeEdges(ctx, map, (e) => bothLand(e) && areAllied(state, state.owner[e.a], state.owner[e.b]));
  ctx.setLineDash([]);

  if (me < 0 || !state.alive[me]) return;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(255, 90, 60, 0.85)";
  ctx.lineWidth = 1.6;
  strokeEdges(ctx, map, (e) => {
    const a = state.owner[e.a];
    const b = state.owner[e.b];
    return bothLand(e) && a >= 0 && b >= 0 && a !== b && (a === me || b === me) && !areAllied(state, a, b);
  });
  ctx.setLineDash([]);
}

function drawSelection(game, map, state, paths) {
  const selected = map.provinces[game.selected];
  if (selected) {
    if (canPlan() && state.owner[selected.id] === game.me) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "rgba(255, 246, 216, 0.7)";
      ctx.lineWidth = 1.5;
      for (const n of selected.neighbors) if (map.provinces[n].land) ctx.stroke(paths.provinces[n]);
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#fff";
    ctx.fill(paths.provinces[selected.id]);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#fff6d8";
    ctx.lineWidth = 2.6;
    ctx.stroke(paths.provinces[selected.id]);
  }

  if (game.drag && game.hover >= 0) {
    const reachable = map.provinces[game.drag.from].neighbors.includes(game.hover);
    ctx.strokeStyle = reachable ? "#fff6d8" : "rgba(255, 120, 90, 0.8)";
    ctx.lineWidth = 2.6;
    ctx.stroke(paths.provinces[game.hover]);
  }
}

function drawProvinceMarkers(map, state) {
  const time = performance.now() / 1000;
  for (const p of map.provinces) {
    if (!p.land || !p.city) continue;
    upright(ctx, p.x, p.y);
    drawCityMarker(p);
    ctx.restore();
  }
  for (const p of map.provinces) {
    if (!p.land) continue;
    upright(ctx, p.x, p.y);
    drawCounter(0, 3, state.troops[p.id], state.owner[p.id]);
    if (state.forts[p.id]) drawFort();
    if (state.factories[p.id]) drawFactory(state.factories[p.id], time);
    ctx.restore();
  }
}

function drawOrders(game, map, state) {
  const orders = game.orders[game.me];
  for (const m of orders.moves) {
    const friendly = state.owner[m.to] === game.me;
    const winning = friendly || attackStrength(state, game.me, m.count) > defenseStrength(map, state, m.to);
    drawArrow(map, m.from, m.to, friendly ? MOVE_COLOR : ATTACK_COLOR, 0.92, m.count, winning);
  }
  for (const id in orders.recruits) {
    const p = map.provinces[id];
    upright(ctx, p.x, p.y);
    drawText(`+${orders.recruits[id]}`, 1, 18, `700 12px ${FONT}`, "#9fe07f");
    ctx.restore();
  }
  for (const id in orders.builds) {
    const p = map.provinces[id];
    upright(ctx, p.x, p.y);
    const label = orders.builds[id] === BUILDING.FORT ? "FORT ⚒" : `FACTORY L${state.factories[id] + 1} ⚒`;
    drawText(label, 0, 31, `600 10px ${FONT}`, GOLD);
    ctx.restore();
  }

  const hint = game.hint;
  if (hint && !orders.moves.length) {
    const phase = ((performance.now() / 1000) % 1.6) / 1.6;
    drawArrow(map, hint.from, hint.to, GOLD, 0.35 + 0.35 * Math.sin(phase * Math.PI));
    const [mx, my] = curvePoint(arrowCurve(map, hint.from, hint.to), 0.5);
    upright(ctx, mx, my);
    drawText("DRAG TO ATTACK", 0, -16, `700 11px ${FONT}`, GOLD);
    ctx.restore();
  }
}

function drawDragLine(game, map) {
  if (!game.drag || !game.drag.active) return;
  const p = map.provinces[game.drag.from];
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = ATTACK_COLOR;
  ctx.lineWidth = 4;
  ctx.setLineDash([9, 6]);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(game.drag.x, game.drag.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawAnimation(game, map, state) {
  const animation = game.animation;
  if (!animation) return;
  const progress = clamp(animation.time / 1.1, 0, 1);
  const eased = progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;

  if (!animation.applied) {
    for (const m of animation.events.moves) {
      const color = state.owner[m.to] === m.nation ? MOVE_COLOR : ATTACK_COLOR;
      drawArrow(map, m.from, m.to, color, 0.45);
    }
  }
  for (const m of animation.events.moves) {
    if (animation.applied && (m.stop < 1 || animation.time > 1.3)) continue;
    const [x, y] = curvePoint(arrowCurve(map, m.from, m.to), Math.min(eased, m.stop));
    upright(ctx, x, y);
    drawCounter(0, 0, m.sent, m.nation, true);
    ctx.restore();
  }
  if (animation.applied && animation.time < 2.2) {
    const grow = Math.min(1, (animation.time - 1.1) * 5);
    ctx.globalAlpha = clamp((2.2 - animation.time) * 3, 0, 1);
    for (const id of animation.events.battles) {
      const p = map.provinces[id];
      upright(ctx, p.x, p.y);
      drawSwords(17, -9, 0.8 * grow * (1 + 0.08 * Math.sin(animation.time * 12)));
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}

function drawBlast(f) {
  const progress = 1 - Math.max(0, f.life / f.maxLife);
  const radius = f.size * (0.35 + 0.65 * Math.sqrt(progress));
  const gradient = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, radius);
  gradient.addColorStop(0, "rgba(255, 250, 220, 1)");
  gradient.addColorStop(0.35, "rgba(255, 196, 90, 0.9)");
  gradient.addColorStop(0.7, "rgba(214, 84, 32, 0.45)");
  gradient.addColorStop(1, "rgba(120, 40, 20, 0)");
  ctx.globalAlpha = 1 - progress;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(f.x, f.y, radius, 0, TAU);
  ctx.fill();
}

function drawFloaters(dt) {
  for (const f of floaters) {
    if (f.delay > 0) {
      f.delay -= dt;
      continue;
    }
    f.life -= dt;
    const age = 1.8 - f.life;
    const rise = 22 * (1 - Math.exp(-age * 2.2));
    const pop = Math.min(1, age * 6);
    upright(ctx, f.x, f.y);
    ctx.globalAlpha = clamp(f.life * 1.5, 0, 1);
    ctx.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
    drawText(f.text, 0, -rise, `700 13px ${FONT}`, f.color);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  for (let i = floaters.length - 1; i >= 0; i--) if (floaters[i].life <= 0) floaters.splice(i, 1);
}

function drawEffects(dt) {
  for (const f of effects) {
    if (f.delay > 0) {
      f.delay -= dt;
      continue;
    }
    f.life -= dt;
    const fade = Math.max(0, f.life / f.maxLife);
    if (f.kind === "blast") {
      drawBlast(f);
    } else if (f.kind === "ring") {
      f.r += (f.radius - f.r) * Math.min(1, dt * 6);
      ctx.globalAlpha = fade;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2.5 * fade + 0.8;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, TAU);
      ctx.stroke();
    } else if (f.kind === "smoke") {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.r += dt * 8;
      ctx.globalAlpha = fade * 0.45;
      ctx.fillStyle = "#3a362c";
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, TAU);
      ctx.fill();
    } else {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vx *= 0.93;
      f.vy *= 0.93;
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.fillStyle = f.color;
      ctx.fillRect(f.x - 1.4, f.y - 1.4, 2.8, 2.8);
    }
  }
  ctx.globalAlpha = 1;
  for (let i = effects.length - 1; i >= 0; i--) if (effects[i].life <= 0) effects.splice(i, 1);
}

export function render(dt) {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  fillSea(ctx, view.width, view.height);

  const game = store.game;
  const map = store.map;
  if (!game || !map) return;
  if (updateLayout() || !baseLayer) buildLayers();

  const paths = pathsFor(map);
  const state = visibleState(game);
  shake *= Math.exp(-dt * 7);
  const shakeX = shake > 0.2 ? (Math.random() - 0.5) * shake : 0;
  const shakeY = shake > 0.2 ? (Math.random() - 0.5) * shake : 0;
  const originX = view.originX + shakeX;
  const originY = view.originY + shakeY;
  const layerZoom = view.scale / view.layerScale;
  const layerX = (originX + view.bounds.x0 * view.scale) * view.dpr;
  const layerY = (originY + view.bounds.y0 * view.scale) * view.dpr;
  const mapTransform = mapMatrix(view.scale * view.dpr, originX * view.dpr, originY * view.dpr);

  ctx.setTransform(layerZoom, 0, 0, layerZoom, layerX, layerY);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(baseLayer, 0, 0);
  ctx.setTransform(...mapTransform);
  drawPolitical(map, state, paths, dt);
  drawWinter(paths, dt, winterActive(state));
  drawSupply(map, state, paths);

  ctx.globalAlpha = 0.62;
  ctx.setTransform(layerZoom, 0, 0, layerZoom, layerX, layerY);
  ctx.drawImage(reliefLayer, 0, 0);
  ctx.globalAlpha = 1;
  ctx.setTransform(...mapTransform);

  drawNationLabels(map, state, paths);
  drawFlashes(paths, dt);
  drawBorders(map, state, game.me);
  drawSelection(game, map, state, paths);
  drawProvinceMarkers(map, state);
  if (canPlan()) drawOrders(game, map, state);
  drawDragLine(game, map);
  drawAnimation(game, map, state);
  drawEffects(dt);
  drawFloaters(dt);
  drawSnowfall(dt);
}
