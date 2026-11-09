import { MAP_HEIGHT, MAP_WIDTH, clamp } from "./config.js";
import { store } from "./store.js";

const MAX_ZOOM = 6;
const ROTATE_KEY = "frontlines.rotateMap";

export const ROTATE_MODES = ["auto", "on", "off"];

function loadRotate() {
  try {
    const saved = localStorage.getItem(ROTATE_KEY);
    return ROTATE_MODES.includes(saved) ? saved : "auto";
  } catch {
    return "auto";
  }
}

export const viewSettings = { rotate: loadRotate() };

export function cycleRotate() {
  viewSettings.rotate = ROTATE_MODES[(ROTATE_MODES.indexOf(viewSettings.rotate) + 1) % ROTATE_MODES.length];
  try {
    localStorage.setItem(ROTATE_KEY, viewSettings.rotate);
  } catch {}
  return viewSettings.rotate;
}

function rotationAllowed() {
  if (viewSettings.rotate === "auto") return store.map?.scenario !== "europe";
  return viewSettings.rotate === "on";
}
const MAX_LAYER_PIXELS = 7e6;
const FULL_MAP = { x0: 0, y0: 0, x1: MAP_WIDTH, y1: MAP_HEIGHT };

export const view = {
  dpr: 1,
  width: 0,
  height: 0,
  topBar: 56,
  bottomBar: 148,
  scale: 1,
  originX: 0,
  originY: 0,
  fit: 1,
  centerX: 0,
  centerY: 0,
  bounds: FULL_MAP,
  rotated: false,
  layerScale: 1,
  layerKey: "",
};

export function resizeViewport(canvas) {
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.width = window.innerWidth;
  view.height = window.innerHeight;
  const short = view.height < 560;
  view.topBar = short ? 46 : 56;
  view.bottomBar = short ? 96 : 148;
  canvas.width = Math.floor(view.width * view.dpr);
  canvas.height = Math.floor(view.height * view.dpr);
}

function playing() {
  return store.game && store.game.mode !== "demo";
}

function rotateBounds(b) {
  return { x0: MAP_HEIGHT - b.y1, x1: MAP_HEIGHT - b.y0, y0: b.x0, y1: b.x1 };
}

export function updateLayout() {
  const game = store.game;
  const active = playing();
  const top = active ? view.topBar : 0;
  const available = view.height - top - (active ? view.bottomBar : 0);
  const mapBounds = active ? store.map.bounds : FULL_MAP;

  let rotated = false;
  if (active) {
    const w = mapBounds.x1 - mapBounds.x0;
    const h = mapBounds.y1 - mapBounds.y0;
    const upright = Math.min(view.width / w, available / h);
    const sideways = Math.min(view.width / h, available / w);
    rotated = rotationAllowed() && sideways > upright * 1.12;
    if (rotated !== view.rotated) resetZoom(game);
  }
  view.rotated = rotated;

  const bounds = rotated ? rotateBounds(mapBounds) : { ...mapBounds };
  view.bounds = bounds;
  const bw = bounds.x1 - bounds.x0;
  const bh = bounds.y1 - bounds.y0;
  view.fit = active
    ? Math.min(view.width / bw, available / bh) * 0.98
    : Math.max(view.width / bw, view.height / bh) * 1.05;

  if (active) clampPan(game);
  view.scale = view.fit * (active ? game.zoom : 1);
  view.centerX = view.width / 2;
  view.centerY = top + available / 2;
  view.originX = view.centerX - ((bounds.x0 + bounds.x1) / 2 + (active ? game.panX : 0)) * view.scale;
  view.originY = view.centerY - ((bounds.y0 + bounds.y1) / 2 + (active ? game.panY : 0)) * view.scale;

  const cap = Math.sqrt(MAX_LAYER_PIXELS / (bw * bh)) / view.dpr;
  const wanted = Math.min(view.scale, cap);
  const key = [store.map.seed, active, rotated, view.dpr, view.width, view.height].join("|");
  const stale = !(game && game.pinching) && Math.abs(wanted - view.layerScale) / view.layerScale > 0.12;
  if (key !== view.layerKey || stale) {
    view.layerKey = key;
    view.layerScale = wanted;
    return true;
  }
  return false;
}

export function clampPan(game) {
  const b = view.bounds;
  const limitX = ((b.x1 - b.x0) / 2) * (1 - 1 / game.zoom);
  const limitY = ((b.y1 - b.y0) / 2) * (1 - 1 / game.zoom);
  game.panX = clamp(game.panX, -limitX, limitX);
  game.panY = clamp(game.panY, -limitY, limitY);
}

export function zoomAt(game, zoom, screenX, screenY, viewX, viewY) {
  game.zoom = clamp(zoom, 1, MAX_ZOOM);
  const scale = view.fit * game.zoom;
  const b = view.bounds;
  game.panX = viewX - (b.x0 + b.x1) / 2 - (screenX - view.centerX) / scale;
  game.panY = viewY - (b.y0 + b.y1) / 2 - (screenY - view.centerY) / scale;
  clampPan(game);
}

export function resetZoom(game) {
  if (!game) return;
  game.zoom = 1;
  game.panX = 0;
  game.panY = 0;
}

export function mapMatrix(k, offsetX, offsetY) {
  return view.rotated ? [0, k, -k, 0, offsetX + MAP_HEIGHT * k, offsetY] : [k, 0, 0, k, offsetX, offsetY];
}

export function screenToView(x, y) {
  return [(x - view.originX) / view.scale, (y - view.originY) / view.scale];
}

export function screenToMap(x, y) {
  const [vx, vy] = screenToView(x, y);
  return view.rotated ? [vy, MAP_HEIGHT - vx] : [vx, vy];
}

export function mapToScreen(x, y) {
  const [vx, vy] = view.rotated ? [MAP_HEIGHT - y, x] : [x, y];
  return [view.originX + vx * view.scale, view.originY + vy * view.scale];
}
