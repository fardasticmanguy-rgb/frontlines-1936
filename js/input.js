import { unlockAudio, playSound } from "./audio.js";
import { addMove, availableFrom, canPlan } from "./game.js";
import { pointInPolygon } from "./geometry.js";
import { canvas } from "./render.js";
import { store } from "./store.js";
import { keepAwake, renderPanel, toast } from "./ui.js";
import { clampPan, screenToMap, screenToView, view, zoomAt } from "./view.js";

const DRAG_THRESHOLD = 12;
const PICK_RADIUS = 24;

const touches = new Map();
let pinch = null;

function provinceAt(x, y) {
  const { provinces } = store.map;
  for (const p of provinces) if (p.land && pointInPolygon(p.polygon, x, y)) return p.id;

  let nearest = -1;
  let best = PICK_RADIUS * PICK_RADIUS;
  for (const p of provinces) {
    if (!p.land) continue;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < best) {
      best = d;
      nearest = p.id;
    }
  }
  return nearest;
}

function activeGame() {
  const game = store.game;
  return game && game.mode !== "demo" ? game : null;
}

function startPinch(game) {
  const [a, b] = [...touches.values()];
  game.drag = null;
  game.pointer = null;
  game.hover = -1;
  game.pinching = true;
  pinch = {
    distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    zoom: game.zoom,
    anchor: screenToView((a.x + b.x) / 2, (a.y + b.y) / 2),
  };
}

function onPointerDown(event) {
  unlockAudio();
  const game = activeGame();
  if (!game) return;
  keepAwake();
  touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {}

  if (touches.size === 2) {
    startPinch(game);
    return;
  }
  if (touches.size > 2) return;

  const [x, y] = screenToMap(event.clientX, event.clientY);
  const id = provinceAt(x, y);
  game.pointer = {
    id: event.pointerId,
    province: id,
    startX: event.clientX,
    startY: event.clientY,
    panX: game.panX,
    panY: game.panY,
    panning: false,
  };
  game.drag = null;
  if (id >= 0 && canPlan() && game.state.owner[id] === game.me && availableFrom(id) > 0) {
    game.drag = { from: id, active: false, x, y };
  }
}

function onPointerMove(event) {
  const game = activeGame();
  if (!game) return;
  if (touches.has(event.pointerId)) touches.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (pinch && touches.size >= 2) {
    const [a, b] = [...touches.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    zoomAt(game, (pinch.zoom * distance) / pinch.distance, (a.x + b.x) / 2, (a.y + b.y) / 2, ...pinch.anchor);
    return;
  }

  const pointer = game.pointer;
  if (!pointer || pointer.id !== event.pointerId) return;
  const moved = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > DRAG_THRESHOLD;
  const [x, y] = screenToMap(event.clientX, event.clientY);

  if (game.drag) {
    game.drag.x = x;
    game.drag.y = y;
    if (moved) game.drag.active = true;
    game.hover = game.drag.active ? provinceAt(x, y) : -1;
  } else if (moved && game.zoom > 1.01) {
    pointer.panning = true;
    game.panX = pointer.panX - (event.clientX - pointer.startX) / view.scale;
    game.panY = pointer.panY - (event.clientY - pointer.startY) / view.scale;
    clampPan(game);
  }
}

function finishDrag(game, drag, target) {
  const reachable =
    target >= 0 && target !== drag.from && store.map.provinces[drag.from].neighbors.includes(target);
  if (reachable && canPlan()) {
    addMove(drag.from, target, availableFrom(drag.from));
    game.selected = drag.from;
    renderPanel();
  } else if (target >= 0 && target !== drag.from) {
    toast("You can only move into a neighboring province");
  }
}

function handleTap(game, target) {
  if (target < 0) {
    game.selected = -1;
    renderPanel();
    return;
  }
  const selected = game.selected;
  const attackFromSelection =
    selected >= 0 &&
    selected !== target &&
    canPlan() &&
    game.state.owner[selected] === game.me &&
    game.state.owner[target] !== game.me &&
    store.map.provinces[selected].neighbors.includes(target) &&
    availableFrom(selected) > 0;

  if (attackFromSelection) {
    addMove(selected, target, availableFrom(selected));
    return;
  }
  game.selected = target === selected ? -1 : target;
  playSound("click");
  renderPanel();
}

function onPointerEnd(event) {
  touches.delete(event.pointerId);
  const game = activeGame();
  if (!game) return;

  if (pinch) {
    if (touches.size < 2) {
      pinch = null;
      game.pinching = false;
      game.pointer = null;
      game.drag = null;
    }
    return;
  }

  const pointer = game.pointer;
  if (!pointer || pointer.id !== event.pointerId) return;
  const drag = game.drag;
  game.pointer = null;
  game.drag = null;
  game.hover = -1;
  if (event.type === "pointercancel" || pointer.panning) return;

  const target = provinceAt(...screenToMap(event.clientX, event.clientY));
  if (drag?.active) finishDrag(game, drag, target);
  else handleTap(game, target);
}

function onWheel(event) {
  const game = activeGame();
  if (!game) return;
  event.preventDefault();
  const anchor = screenToView(event.clientX, event.clientY);
  zoomAt(game, game.zoom * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY, ...anchor);
}

export function bindMapInput() {
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerEnd);
  canvas.addEventListener("pointercancel", onPointerEnd);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
}
