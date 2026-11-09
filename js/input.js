import { unlockAudio, playSound } from "./audio.js";
import {
  addMove,
  availableFrom,
  canOrder,
  canPlan,
  clearMovesFrom,
  endTurn,
  orderFromSelection,
  peaceMessage,
  selection,
  undoOrders,
} from "./game.js";
import { pointInPolygon } from "./geometry.js";
import { canEnter } from "./rules.js";
import { canvas } from "./render.js";
import { store } from "./store.js";
import { currentScreen, hideTooltip, keepAwake, renderPanel, renderTooltip, toast } from "./ui.js";
import { clampPan, resetZoom, screenToMap, screenToView, view, zoomAt } from "./view.js";

const DRAG_THRESHOLD = 9;
const PICK_RADIUS = 18;
const KEY_PAN = 70;

const touches = new Map();
let pinch = null;

function ringsOf(p) {
  return p.rings ?? [p.polygon];
}

export function provinceAt(x, y) {
  const { provinces } = store.map;
  for (const p of provinces) {
    if (p.land && ringsOf(p).some((ring) => pointInPolygon(ring, x, y))) return p.id;
  }

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
  game.box = null;
  game.hover = -1;
  game.pinching = true;
  pinch = {
    distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    zoom: game.zoom,
    anchor: screenToView((a.x + b.x) / 2, (a.y + b.y) / 2),
  };
}

function ownsProvince(game, id) {
  return id >= 0 && game.state.owner[id] === game.me;
}

function onPointerDown(event) {
  unlockAudio();
  const game = activeGame();
  if (!game) return;
  keepAwake();
  hideTooltip();
  const mouse = event.pointerType === "mouse";
  if (!mouse) touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
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
    button: event.button,
    mouse,
    shift: event.shiftKey,
    toggle: event.shiftKey || event.ctrlKey || event.metaKey,
  };
  game.drag = null;
  game.box = null;
  if (event.button !== 0) return;
  if (mouse && event.shiftKey && canPlan()) {
    game.box = { x0: x, y0: y, x1: x, y1: y, active: false };
    return;
  }
  if (canPlan() && ownsProvince(game, id) && availableFrom(id) > 0) {
    game.drag = { from: id, active: false, x, y };
  }
}

function updateHover(game, event) {
  const [x, y] = screenToMap(event.clientX, event.clientY);
  const id = provinceAt(x, y);
  if (id !== game.hover) game.hover = id;
  renderTooltip(event.clientX, event.clientY, id);
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
  if (!pointer || pointer.id !== event.pointerId) {
    if (event.pointerType === "mouse" && !currentScreen()) updateHover(game, event);
    return;
  }
  const moved = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > DRAG_THRESHOLD;
  const [x, y] = screenToMap(event.clientX, event.clientY);

  if (game.box) {
    game.box.x1 = x;
    game.box.y1 = y;
    if (moved) game.box.active = true;
    return;
  }
  if (game.drag) {
    game.drag.x = x;
    game.drag.y = y;
    if (moved) game.drag.active = true;
    game.hover = game.drag.active ? provinceAt(x, y) : -1;
    if (pointer.mouse && game.drag.active) renderTooltip(event.clientX, event.clientY, game.hover);
    return;
  }
  if (moved || pointer.panning) {
    pointer.panning = true;
    game.panX = pointer.panX - (event.clientX - pointer.startX) / view.scale;
    game.panY = pointer.panY - (event.clientY - pointer.startY) / view.scale;
    clampPan(game);
  }
}

function finishBox(game, box) {
  const { provinces } = store.map;
  const x0 = Math.min(box.x0, box.x1);
  const x1 = Math.max(box.x0, box.x1);
  const y0 = Math.min(box.y0, box.y1);
  const y1 = Math.max(box.y0, box.y1);
  const picked = provinces
    .filter((p) => p.land && ownsProvince(game, p.id) && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)
    .map((p) => p.id);
  game.selectedNation = -1;
  game.selected = picked[0] ?? -1;
  game.group = picked;
  if (picked.length) {
    playSound("click");
    toast(`${picked.length} provinces selected · right-click or tap a target to send them all`);
  }
  renderPanel();
}

function finishDrag(game, drag, target) {
  if (target === drag.from || target < 0) return;
  if (canOrder(drag.from, target)) {
    addMove(drag.from, target);
    game.selected = drag.from;
    game.group = [];
    renderPanel();
  } else if (!canEnter(game.state, game.me, game.state.owner[target])) {
    toast(peaceMessage(game.state.owner[target]));
  } else {
    toast("Too far: attack a neighbor, or redeploy up to 4 provinces through your own land");
  }
}

function toggleInGroup(game, target) {
  const group = selection();
  const at = group.indexOf(target);
  if (at >= 0) group.splice(at, 1);
  else group.push(target);
  game.group = group;
  game.selected = group[0] ?? -1;
  playSound("click");
  renderPanel();
}

function handleTap(game, target, pointer) {
  game.selectedNation = -1;
  if (target < 0) {
    game.selected = -1;
    game.group = [];
    renderPanel();
    return;
  }
  if (pointer?.toggle && canPlan() && ownsProvince(game, target)) {
    toggleInGroup(game, target);
    return;
  }
  const hostile = !ownsProvince(game, target) && canEnter(game.state, game.me, game.state.owner[target]);
  if (hostile && selection().some((id) => canOrder(id, target) && availableFrom(id) > 0)) {
    orderFromSelection(target);
    return;
  }
  game.group = [];
  game.selected = target === game.selected ? -1 : target;
  playSound("click");
  renderPanel();
}

function handleRightClick(game, target, pointer) {
  if (target < 0) {
    game.selected = -1;
    game.group = [];
    renderPanel();
    return;
  }
  if (!canPlan()) return;
  const sources = selection();
  if (!sources.length) {
    if (ownsProvince(game, target)) {
      game.selected = target;
      game.group = [];
      renderPanel();
    } else toast("Select your province first, then right-click where to send it");
    return;
  }
  if (sources.length === 1 && sources[0] === target) {
    clearMovesFrom([target]);
    return;
  }
  if (!orderFromSelection(target, pointer.shift ? 0.5 : 1)) {
    toast(
      !canEnter(game.state, game.me, game.state.owner[target])
        ? peaceMessage(game.state.owner[target])
        : "Out of reach: attack a neighbor, or redeploy up to 4 provinces through your own land",
    );
  }
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
  const box = game.box;
  game.pointer = null;
  game.drag = null;
  game.box = null;
  if (event.pointerType !== "mouse") game.hover = -1;
  if (event.type === "pointercancel") return;
  if (box?.active) {
    finishBox(game, box);
    return;
  }
  if (pointer.panning) return;

  const target = provinceAt(...screenToMap(event.clientX, event.clientY));
  if (drag?.active) finishDrag(game, drag, target);
  else if (pointer.button === 2) handleRightClick(game, target, pointer);
  else if (pointer.button === 0) handleTap(game, target, pointer);
}

function onWheel(event) {
  const game = activeGame();
  if (!game) return;
  event.preventDefault();
  const anchor = screenToView(event.clientX, event.clientY);
  zoomAt(game, game.zoom * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY, ...anchor);
}

function zoomCenter(game, factor) {
  const x = view.centerX;
  const y = view.centerY;
  zoomAt(game, game.zoom * factor, x, y, ...screenToView(x, y));
}

function panKeys(game, dx, dy) {
  game.panX += dx / view.scale;
  game.panY += dy / view.scale;
  clampPan(game);
}

function onKeyDown(event) {
  const game = activeGame();
  if (!game || currentScreen()) return;
  if (event.target instanceof HTMLInputElement) return;
  const key = event.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;
  const command = event.ctrlKey || event.metaKey;

  if (command && lower === "z") {
    event.preventDefault();
    undoOrders();
    return;
  }
  if (command) return;
  const pans = {
    ArrowLeft: [-KEY_PAN, 0],
    a: [-KEY_PAN, 0],
    ArrowRight: [KEY_PAN, 0],
    d: [KEY_PAN, 0],
    ArrowUp: [0, -KEY_PAN],
    w: [0, -KEY_PAN],
    ArrowDown: [0, KEY_PAN],
    s: [0, KEY_PAN],
  };
  if (pans[lower]) {
    event.preventDefault();
    const [dx, dy] = pans[lower];
    panKeys(game, view.rotated ? -dy : dx, view.rotated ? dx : dy);
    return;
  }
  if (lower === "+" || lower === "=" || lower === "e") zoomCenter(game, 1.25);
  else if (lower === "-" || lower === "_" || lower === "q") zoomCenter(game, 0.8);
  else if (lower === "f" || key === "Home") resetZoom(game);
  else if (key === "Enter" || key === " ") {
    event.preventDefault();
    endTurn();
  } else if (key === "Escape") {
    game.selected = -1;
    game.group = [];
    game.selectedNation = -1;
    game.panelView = "";
    renderPanel();
  } else if (key === "Delete" || key === "Backspace" || lower === "x") {
    event.preventDefault();
    clearMovesFrom(selection());
  } else if (lower === "z") undoOrders();
  else if (lower === "p") {
    game.panelView = game.panelView === "production" ? "" : "production";
    renderPanel();
  }
}

export function bindMapInput() {
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerEnd);
  canvas.addEventListener("pointercancel", onPointerEnd);
  canvas.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "mouse") return;
    const game = activeGame();
    if (game && !game.pointer) game.hover = -1;
    hideTooltip();
  });
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("keydown", onKeyDown);
}
