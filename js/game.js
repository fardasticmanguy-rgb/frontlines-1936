import { planAiOrders } from "./ai.js";
import { playSound, unlockAudio } from "./audio.js";
import { NATIONS, NATION_NAMES, isWinter } from "./config.js";
import { generateMap } from "./map.js";
import {
  hostBroadcast,
  hostCheckReady,
  networkTick,
  saveHostedGame,
  clearHostedGame,
  sendGuestOrders,
} from "./online.js";
import { randomSeed } from "./random.js";
import {
  addBlast,
  addFloater,
  addRing,
  addShake,
  addSmoke,
  addSparks,
  arrowCurve,
  clearEffects,
  curvePoint,
  flashProvince,
  sweepProvince,
} from "./render.js";
import {
  FACTORY_OUTPUT,
  attackStrength,
  buildCostAt,
  canBuild,
  createInitialState,
  defenseStrength,
  divisionCount,
  emptyOrders,
  income,
  ordersCost,
  resolveTurn,
  sanitizeOrders,
} from "./rules.js";
import { store } from "./store.js";
import {
  clearFeed,
  keepAwake,
  postFeed,
  postNews,
  postWorldEvent,
  renderGameOver,
  renderPanel,
  renderTopBar,
  setBanner,
  showScreen,
  toast,
} from "./ui.js";

const MOVE_DURATION = 1.1;
const ANIMATION_DURATION = 2.3;
const DEMO_TURN_DELAY = 1.2;

const freshOrders = () => NATIONS.map(emptyOrders);

export function newGame(mode, seats, seed, options = {}) {
  store.map = generateMap(seed);
  const game = {
    mode,
    seats,
    state: options.state || createInitialState(store.map, options.maxTurns),
    orders: freshOrders(),
    ready: NATIONS.map(() => 0),
    me: options.me ?? seats.findIndex((s) => s.type === "local"),
    phase: "plan",
    selected: -1,
    hover: -1,
    drag: null,
    pointer: null,
    animation: null,
    hint: null,
    report: null,
    timer: options.timer || 0,
    deadline: 0,
    lastTick: -1,
    demoClock: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    pinching: false,
  };
  store.game = game;

  clearEffects();
  clearFeed();
  setBanner(null);
  if (mode !== "demo") {
    showScreen(null);
    unlockAudio();
    keepAwake();
    playSound("turn");
    startPlanning();
  }
  renderTopBar();
  renderPanel();
}

export function startDemo() {
  newGame(
    "demo",
    NATIONS.map(() => ({ type: "ai" })),
    randomSeed(),
    { maxTurns: 40 },
  );
  store.game.demoClock = -0.5;
}

export function isOnline() {
  return store.game?.mode === "online" && store.net;
}

export function isHost() {
  return isOnline() && store.net.role === "host";
}

export function isGuest() {
  return isOnline() && store.net.role === "guest";
}

export function canPlan() {
  const game = store.game;
  return Boolean(
    game &&
    game.mode !== "demo" &&
    game.phase === "plan" &&
    !game.animation &&
    game.me >= 0 &&
    game.state.alive[game.me] &&
    game.state.winner < 0 &&
    !game.ready[game.me],
  );
}

export function availableFrom(id) {
  const game = store.game;
  const committed = game.orders[game.me].moves
    .filter((m) => m.from === id)
    .reduce((sum, m) => sum + m.count, 0);
  return game.state.troops[id] - committed;
}

export function industryLeft() {
  const game = store.game;
  return game.state.industry[game.me] - ordersCost(game.orders[game.me], game.me, game.state);
}

export function ordersChanged() {
  renderPanel();
  renderTopBar();
  if (isGuest()) sendGuestOrders();
}

export function addMove(from, to, count) {
  const game = store.game;
  const orders = game.orders[game.me];
  const free = availableFrom(from);
  const existing = orders.moves.find((m) => m.from === from && m.to === to);
  if (existing) existing.count += Math.min(count, free);
  else if (free > 0) orders.moves.push({ from, to, count: Math.min(count, free) });
  orders.moves = orders.moves.filter((m) => m.count > 0);
  playSound("order");
  ordersChanged();
}

export function applyPanelAction(action, { from, to, id }) {
  if (!canPlan()) return;
  const game = store.game;
  const orders = game.orders[game.me];
  const move = orders.moves.find((m) => m.from === from && m.to === to);
  const removeMove = () => orders.moves.splice(orders.moves.indexOf(move), 1);

  switch (action) {
    case "more":
      if (move && availableFrom(from) > 0) move.count++;
      break;
    case "less":
      if (move && --move.count <= 0) removeMove();
      break;
    case "all":
      if (move) move.count += availableFrom(from);
      break;
    case "cancel":
      if (move) removeMove();
      break;
    case "recruit1":
    case "recruit5":
    case "recruitMax": {
      const wanted = { recruit1: 1, recruit5: 5, recruitMax: Infinity }[action];
      const count = Math.min(wanted, industryLeft());
      if (count > 0) orders.recruits[id] = (orders.recruits[id] || 0) + count;
      else toast("Not enough industry");
      break;
    }
    case "unrecruit":
      if (orders.recruits[id] && --orders.recruits[id] <= 0) delete orders.recruits[id];
      break;
    case "fort":
    case "factory": {
      const kind = action === "fort" ? 1 : 2;
      const previous = orders.builds[id];
      delete orders.builds[id];
      if (previous === kind) break;
      if (!canBuild(store.map, game.state, game.me, id, kind)) break;
      if (industryLeft() >= buildCostAt(game.state, game.me, id, kind)) orders.builds[id] = kind;
      else {
        if (previous) orders.builds[id] = previous;
        toast("Not enough industry");
      }
      break;
    }
  }
  playSound("click");
  ordersChanged();
}

function computeHint() {
  const game = store.game;
  const { map } = store;
  game.hint = null;
  if (game.state.turn > 2 || game.me < 0) return;

  let bestScore = 0;
  for (const p of map.provinces) {
    if (game.state.owner[p.id] !== game.me) continue;
    for (const n of p.neighbors) {
      if (!map.provinces[n].land || game.state.owner[n] === game.me) continue;
      const score =
        attackStrength(game.me, game.state.troops[p.id], game.state.turn) -
        defenseStrength(map, game.state, n) +
        (map.provinces[n].city ? 3 : 0);
      if (score > bestScore) {
        bestScore = score;
        game.hint = { from: p.id, to: n };
      }
    }
  }
}

export function startPlanning() {
  const game = store.game;
  game.phase = "plan";
  game.orders = freshOrders();
  game.ready = NATIONS.map(() => 0);
  game.selected = -1;
  game.lastTick = -1;
  computeHint();
  if (isHost()) {
    game.deadline = game.timer ? performance.now() + game.timer * 1000 : 0;
    saveHostedGame();
    hostBroadcast();
  }
  if (isGuest()) sendGuestOrders();
  renderTopBar();
  renderPanel();
}

export function endTurn() {
  const game = store.game;
  if (!game || game.animation || game.phase !== "plan") return;
  unlockAudio();

  if (isOnline()) {
    if (game.me < 0 || !game.state.alive[game.me] || game.state.winner >= 0) return;
    game.ready[game.me] = game.ready[game.me] ? 0 : 1;
    game.selected = -1;
    playSound("click");
    if (isGuest()) sendGuestOrders();
    else {
      hostBroadcast();
      hostCheckReady();
    }
    renderTopBar();
    renderPanel();
    return;
  }

  if (!canPlan()) return;
  game.selected = -1;
  resolveLocally();
}

function resolveLocally() {
  const { game, map } = store;
  const orders = NATIONS.map((n) =>
    sanitizeOrders(
      map,
      game.state,
      n,
      game.seats[n].type === "local" ? game.orders[n] : planAiOrders(map, game.state, n),
    ),
  );
  runResolution(orders);
}

export function runResolution(orders) {
  const { game, map } = store;
  const { state, events } = resolveTurn(map, game.state, orders);
  startAnimation(game.state, state, events);
  if (isHost()) {
    hostBroadcast(state, events);
    saveHostedGame(state);
  }
}

export function startAnimation(before, after, events) {
  const game = store.game;
  game.animation = { time: 0, before, after, events, applied: false };
  game.phase = "anim";
  game.selected = -1;
  game.hint = null;
  playSound("march");
  renderTopBar();
  renderPanel();
}

function arrivalPoint(map, events, capture) {
  const move = events.moves.find((m) => m.to === capture.province && m.nation === capture.to && m.stop >= 1);
  const p = map.provinces[capture.province];
  if (!move) return [p.x, p.y];
  const curve = arrowCurve(map, move.from, move.to);
  return [curve[4], curve[5]];
}

function reportCaptures(animation) {
  const { map } = store;
  const { events, before } = animation;
  let captured = false;
  for (const c of events.captures) {
    const p = map.provinces[c.province];
    if (!p) continue;
    flashProvince(c.province);
    sweepProvince(c.province, c.from, ...arrivalPoint(map, events, c));
    captured = true;
    if (c.to < 0) continue;
    addFloater(p.x, p.y - 8, p.city ? "CAPTURED" : "TAKEN", p.city ? "#ffe08a" : "#fff3d6", 0.15);
    if (p.capitalOf >= 0 && c.from === p.capitalOf) {
      addShake(10);
      postNews(
        `${p.name.toUpperCase()} HAS FALLEN`,
        `${NATION_NAMES[c.to]} troops march into the capital of ${NATION_NAMES[c.from]}.`,
        c.to,
      );
    } else if (c.from >= 0 || p.city) {
      const from = c.from >= 0 ? ` from ${NATION_NAMES[c.from]}` : "";
      postFeed(`${NATION_NAMES[c.to]} took ${p.name}${from}`, c.to);
    }
  }
  for (const id of events.battles) {
    if (events.captures.some((c) => c.province === id)) continue;
    const p = map.provinces[id];
    const holder = before.owner[id];
    if (p && holder >= 0) addFloater(p.x, p.y - 8, "HELD", "#cfe6ff", 0.15);
  }
  return captured;
}

function reportIndustry(animation) {
  const { map } = store;
  const { before, after, events } = animation;
  for (const c of events.captures) {
    const p = map.provinces[c.province];
    if (p && before.factories[c.province] > 0)
      addFloater(p.x + 26, p.y + 2, "FACTORY DAMAGED", "#ff9b7a", 0.5);
  }
  for (const p of map.provinces) {
    const level = after.factories[p.id];
    if (!level || after.owner[p.id] < 0) continue;
    const built = level > before.factories[p.id] && before.owner[p.id] === after.owner[p.id];
    addFloater(
      p.x + 26,
      p.y - 6,
      built ? `FACTORY L${level}!` : `+${level * FACTORY_OUTPUT} ⚙`,
      "#ffd76a",
      built ? 0.3 : 0.9,
    );
  }
}

function reportAttrition(events) {
  const { map } = store;
  for (const a of events.attrition || []) {
    const p = map.provinces[a.province];
    if (!p) continue;
    addFloater(p.x, p.y + 4, `−${a.lost} SUPPLY`, "#ff9b7a", 0.6);
  }
}

function reportSeason(before, after) {
  if (isWinter(after.turn) && !isWinter(before.turn)) {
    postNews("WINTER SETS IN", "Frozen roads slow every offensive. Attacks are 20% weaker until March.", -1);
    playSound("wind");
  } else if (!isWinter(after.turn) && isWinter(before.turn)) {
    postNews("THE THAW", "Spring returns to the front. Offensives regain their full strength.", -1);
  }
}

function reportWorldEvent(event) {
  if (!event) return;
  const { map } = store;
  const p = map.provinces[event.province];
  if (p) {
    addRing(p.x, p.y, 34, event.kind === "partisans" ? "#ff8a6b" : "#9fe07f", 1);
    flashProvince(p.id);
  }
  postWorldEvent(event);
  playSound("news");
}

function buildReport(animation) {
  const { game, map } = store;
  const { before, after, events } = animation;
  const me = game.me;
  if (me < 0 || !before.alive[me]) return null;
  return {
    gained: events.captures.filter((c) => c.to === me).length,
    lost: events.captures.filter((c) => c.from === me && c.to !== me).length,
    attrition: (events.attrition || [])
      .filter((a) => after.owner[a.province] === me)
      .reduce((sum, a) => sum + a.lost, 0),
    divisions: divisionCount(after, me) - divisionCount(before, me),
    income: income(map, after, me),
  };
}

export function applyAnimation() {
  const { game, map } = store;
  const animation = game.animation;
  animation.applied = true;
  game.state = animation.after;

  let fighting = 0;
  for (const id of animation.events.battles) {
    const p = map.provinces[id];
    if (!p) continue;
    addRing(p.x, p.y, 40, "#f1cf6b", 0.7);
    addSparks(p.x, p.y, "#ffcf6a", 14, 80);
    addSmoke(p.x, p.y);
    for (let k = 0; k < 3; k++) {
      addBlast(
        p.x + (Math.random() - 0.5) * 26,
        p.y + (Math.random() - 0.5) * 20,
        14 + Math.random() * 10,
        k * 0.14,
      );
    }
    fighting++;
  }
  for (const m of animation.events.moves) {
    if (m.stop >= 1) continue;
    const [x, y] = curvePoint(arrowCurve(map, m.from, m.to), 0.5);
    addRing(x, y, 26, "#ffcf6a", 0.6);
    addSparks(x, y, "#ffcf6a", 10, 70);
    addSmoke(x, y);
    addBlast(x, y, 16, 0);
    fighting++;
  }
  if (fighting) addShake(Math.min(9, 2.5 + fighting * 0.8));

  const captured = reportCaptures(animation);
  reportAttrition(animation.events);
  reportIndustry(animation);
  reportSeason(animation.before, animation.after);
  reportWorldEvent(animation.events.world);
  game.report = buildReport(animation);
  for (const n of NATIONS) {
    if (animation.before.alive[n] && !animation.after.alive[n]) {
      postNews(`${NATION_NAMES[n]} CAPITULATES`, `The government of ${NATION_NAMES[n]} has collapsed.`, n);
      playSound("defeat");
    }
  }
  if (game.me >= 0 && animation.events.captures.some((c) => c.from === game.me && c.to !== game.me)) {
    setTimeout(() => playSound("defeat"), 300);
  }
  if (fighting) playSound("battle");
  if (captured) setTimeout(() => playSound("capture"), 240);
  renderTopBar();
  renderPanel();
}

function endGame() {
  const game = store.game;
  game.phase = "over";
  setTimeout(() => renderGameOver(), 900);
  renderTopBar();
  renderPanel();
}

function finishAnimation() {
  const game = store.game;
  game.animation = null;
  if (isGuest()) store.net.lastState = null;

  if (game.state.winner >= 0) {
    if (isHost()) {
      clearHostedGame();
      game.phase = "over";
      hostBroadcast();
    }
    endGame();
    return;
  }
  if (game.mode === "demo") {
    game.phase = "plan";
    return;
  }
  if (game.mode === "practice" && !game.state.alive[game.me]) {
    endGame();
    return;
  }
  playSound("turn");
  startPlanning();
}

function runDemo(dt) {
  const { game, map } = store;
  game.demoClock += dt;
  if (game.demoClock < DEMO_TURN_DELAY) return;
  game.demoClock = 0;
  if (game.state.winner >= 0 || game.state.turn > 22) {
    startDemo();
    return;
  }
  const orders = NATIONS.map((n) => sanitizeOrders(map, game.state, n, planAiOrders(map, game.state, n)));
  const { state, events } = resolveTurn(map, game.state, orders);
  startAnimation(game.state, state, events);
}

export function tick(dt) {
  const game = store.game;
  if (!game) return;
  if (game.animation) {
    game.animation.time += dt;
    if (!game.animation.applied && game.animation.time >= MOVE_DURATION) applyAnimation();
    if (game.animation.time >= ANIMATION_DURATION) finishAnimation();
  }
  if (game.mode === "demo" && !game.animation) runDemo(dt);
  if (isOnline()) networkTick(dt);
}
