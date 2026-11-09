import { DIFFICULTIES, planAiOrders, planProduction } from "./ai.js";
import { playSound, unlockAudio } from "./audio.js";
import { NATIONS, NATION_NAMES } from "./config.js";
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
  flankBonus,
  ARMOR_COST,
  FACTORY_OUTPUT,
  GUN_COST,
  armorOf,
  canDeploy,
  canReach,
  gunsOf,
  specialCap,
  areAllied,
  attackStrength,
  buildCostAt,
  canBuild,
  createInitialState,
  relativeTurn,
  winterActive,
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
  factionName,
  postWorldEvent,
  renderGameOver,
  showHandoff,
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
  store.map = generateMap(seed, options.mapOptions);
  const paddedSeats = NATIONS.map((n) => seats[n] ?? { type: "ai" });
  const game = {
    mode,
    seats: paddedSeats,
    mapOptions: store.map.options ?? { scenario: store.map.scenario },
    difficulty: options.difficulty || "normal",
    state: options.state || createInitialState(store.map, options.maxTurns, options.rules),
    orders: freshOrders(),
    ready: NATIONS.map(() => 0),
    planned: NATIONS.map(() => 0),
    me: options.me ?? paddedSeats.findIndex((s) => s.type === "local"),
    phase: "plan",
    selected: -1,
    hover: -1,
    drag: null,
    pointer: null,
    animation: null,
    hint: null,
    report: null,
    selectedNation: -1,
    group: [],
    history: [],
    production: NATIONS.map(() => null),
    panelView: "",
    timer: options.timer || 0,
    deadline: 0,
    lastTick: -1,
    demoClock: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    pinching: false,
  };
  if (options.factions === 0) game.state.faction = NATIONS.map(() => -1);
  if (!options.state) {
    const bonus = DIFFICULTIES[game.difficulty]?.bonus ?? 0;
    game.state.bonus = NATIONS.map((n) => (paddedSeats[n].type === "ai" ? bonus : 0));
  }
  game.options = options;
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
  const nations = [4, 4, 5, 6][Math.floor(Math.random() * 4)];
  newGame(
    "demo",
    NATIONS.map(() => ({ type: "ai" })),
    randomSeed(),
    { maxTurns: 40, mapOptions: { nations, size: "medium" } },
  );
  store.game.demoClock = -0.5;
}

export function localSeats(game = store.game) {
  return NATIONS.filter((n) => game.seats[n].type === "local" && game.state.alive[n]);
}

export function isHotseat(game = store.game) {
  return Boolean(game && game.mode !== "online" && game.mode !== "demo" && localSeats(game).length > 1);
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

export function availableArmor(id) {
  const game = store.game;
  const committed = game.orders[game.me].moves
    .filter((m) => m.from === id)
    .reduce((sum, m) => sum + (m.armor || 0), 0);
  return armorOf(game.state)[id] - committed;
}

export function availableGuns(id) {
  const game = store.game;
  const committed = game.orders[game.me].moves
    .filter((m) => m.from === id)
    .reduce((sum, m) => sum + (m.guns || 0), 0);
  return gunsOf(game.state)[id] - committed;
}

function availableInfantry(id) {
  return availableFrom(id) - availableArmor(id) - availableGuns(id);
}

export function specialsLeft() {
  const game = store.game;
  const orders = game.orders[game.me];
  const queued = [orders.tanks, orders.artillery].reduce(
    (sum, list) => sum + Object.values(list ?? {}).reduce((a, n) => a + n, 0),
    0,
  );
  return specialCap(game.state, game.me) - queued;
}

export function selection() {
  const game = store.game;
  if (!game || game.selected < 0) return [];
  return [game.selected, ...game.group.filter((id) => id !== game.selected)].filter(
    (id) => game.state.owner[id] === game.me,
  );
}

export function canOrder(from, to) {
  const game = store.game;
  return (
    from !== to &&
    game.state.owner[from] === game.me &&
    !areAllied(game.state, game.me, game.state.owner[to]) &&
    store.map.provinces[to]?.land &&
    canReach(store.map, game.state, game.me, from, to)
  );
}

function remember() {
  const game = store.game;
  if (game.me < 0) return;
  game.history.push(JSON.stringify(game.orders[game.me]));
  if (game.history.length > 60) game.history.shift();
}

export function undoOrders() {
  const game = store.game;
  if (!canPlan() || !game.history.length) {
    toast("Nothing to undo");
    return;
  }
  game.orders[game.me] = JSON.parse(game.history.pop());
  playSound("click");
  ordersChanged();
}

export function clearMovesFrom(ids) {
  const game = store.game;
  if (!canPlan()) return;
  const orders = game.orders[game.me];
  if (!orders.moves.some((m) => ids.includes(m.from))) return;
  remember();
  orders.moves = orders.moves.filter((m) => !ids.includes(m.from));
  playSound("click");
  ordersChanged();
}

export function orderFromSelection(target, share = 1) {
  const game = store.game;
  if (!canPlan()) return false;
  const sources = selection().filter((id) => canOrder(id, target) && availableFrom(id) > 0);
  if (!sources.length) return false;
  remember();
  for (const from of sources) placeMove(from, target, share);
  playSound("order");
  ordersChanged();
  return true;
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

function kitFor(count, armor, guns, infantry) {
  const total = armor + guns + infantry;
  if (count >= total) return { count: total, armor, guns };
  let tanks = Math.min(armor, Math.round((armor * count) / total));
  let artillery = Math.min(guns, Math.round((guns * count) / total));
  while (count - tanks - artillery > infantry) {
    if (tanks < armor) tanks++;
    else artillery++;
  }
  while (tanks + artillery > count) {
    if (artillery > 0) artillery--;
    else tanks--;
  }
  return { count, armor: tanks, guns: artillery };
}

function splitAcross(from, targets) {
  const game = store.game;
  const orders = game.orders[game.me];
  orders.moves = orders.moves.filter((m) => m.from !== from);
  let armor = armorOf(game.state)[from];
  let guns = gunsOf(game.state)[from];
  let infantry = game.state.troops[from] - armor - guns;
  targets.forEach((to, k) => {
    const left = armor + guns + infantry;
    const share = Math.ceil(left / (targets.length - k));
    const kit = kitFor(share, armor, guns, infantry);
    if (kit.count <= 0) return;
    orders.moves.push({ from, to, ...kit });
    armor -= kit.armor;
    guns -= kit.guns;
    infantry -= kit.count - kit.armor - kit.guns;
  });
}

function placeMove(from, to, share) {
  const game = store.game;
  const orders = game.orders[game.me];
  const free = availableFrom(from);
  const others = orders.moves.filter((m) => m.from === from && m.to !== to).map((m) => m.to);
  if (free <= 0 && others.length && !orders.moves.some((m) => m.from === from && m.to === to)) {
    splitAcross(from, [...others, to]);
    return;
  }
  const count = share >= 1 ? free : Math.max(1, Math.floor(free * share));
  const kit = kitFor(count, availableArmor(from), availableGuns(from), availableInfantry(from));
  const existing = orders.moves.find((m) => m.from === from && m.to === to);
  if (existing) {
    existing.count += kit.count;
    existing.armor = (existing.armor || 0) + kit.armor;
    existing.guns = (existing.guns || 0) + kit.guns;
  } else if (kit.count > 0) orders.moves.push({ from, to, ...kit });
  orders.moves = orders.moves.filter((m) => m.count > 0);
}

export function launchOffensive(ids) {
  const { game, map } = store;
  if (!canPlan()) return 0;
  const { state, me } = game;
  const hostile = (n) =>
    map.provinces[n].land && state.owner[n] !== me && !areAllied(state, me, state.owner[n]);
  const targets = new Map();
  for (const id of ids) {
    if (availableFrom(id) <= 0) continue;
    for (const n of map.provinces[id].neighbors) {
      if (!hostile(n)) continue;
      const entry = targets.get(n) ?? { id: n, sources: [], power: 0 };
      entry.sources.push(id);
      entry.power += attackStrength(
        state,
        me,
        availableFrom(id),
        availableArmor(id),
        map.provinces[n].terrain,
        availableGuns(id),
      );
      targets.set(n, entry);
    }
  }
  const ranked = [...targets.values()]
    .map((t) => {
      const p = map.provinces[t.id];
      const defense = defenseStrength(map, state, t.id);
      const value = (p.city ? 3 : 1) + (p.capitalOf >= 0 ? 4 : 0);
      return { ...t, defense, score: (t.power / Math.max(0.5, defense)) * value };
    })
    .filter((t) => t.power * 1.2 > t.defense)
    .sort((a, b) => b.score - a.score || a.id - b.id);
  remember();
  const used = new Set();
  let launched = 0;
  for (const target of ranked) {
    const sources = target.sources.filter((id) => !used.has(id));
    if (!sources.length) continue;
    const power = sources.reduce(
      (sum, id) =>
        sum +
        attackStrength(
          state,
          me,
          availableFrom(id),
          availableArmor(id),
          map.provinces[target.id].terrain,
          availableGuns(id),
        ),
      0,
    );
    if (power * (1 + flankBonus(sources.length)) <= target.defense) continue;
    for (const id of sources) {
      placeMove(id, target.id, 1);
      used.add(id);
    }
    launched++;
  }
  if (!launched) {
    game.history.pop();
    toast("No target here can be beaten. Mass more divisions first.");
    return 0;
  }
  playSound("order");
  ordersChanged();
  return launched;
}

export function addMove(from, to, share = 1) {
  const game = store.game;
  if (areAllied(game.state, game.me, game.state.owner[to])) {
    toast("You can't attack your ally");
    return;
  }
  if (!canReach(store.map, game.state, game.me, from, to)) {
    toast("Too far: attack a neighbor, or redeploy up to 4 provinces through your own land");
    return;
  }
  if (availableFrom(from) <= 0) return;
  remember();
  placeMove(from, to, share);
  playSound("order");
  ordersChanged();
}

export function applyPanelAction(action, { from, to, id }) {
  if (!canPlan()) return;
  const game = store.game;
  if (action === "undo") {
    undoOrders();
    return;
  }
  remember();
  const orders = game.orders[game.me];
  const move = orders.moves.find((m) => m.from === from && m.to === to);
  const removeMove = () => orders.moves.splice(orders.moves.indexOf(move), 1);

  switch (action) {
    case "more":
      if (move && availableInfantry(from) > 0) move.count++;
      else if (move && availableGuns(from) > 0) {
        move.count++;
        move.guns = (move.guns || 0) + 1;
      } else if (move && availableArmor(from) > 0) {
        move.count++;
        move.armor = (move.armor || 0) + 1;
      }
      break;
    case "less":
      if (move && move.count - (move.armor || 0) - (move.guns || 0) > 0) move.count--;
      else if (move && move.guns > 0) {
        move.count--;
        move.guns--;
      } else if (move && move.armor > 0) {
        move.count--;
        move.armor--;
      }
      if (move && move.count <= 0) removeMove();
      break;
    case "half":
      if (move) {
        const armor = (move.armor || 0) + availableArmor(from);
        const guns = (move.guns || 0) + availableGuns(from);
        const infantry = move.count - (move.armor || 0) - (move.guns || 0) + availableInfantry(from);
        Object.assign(
          move,
          kitFor(Math.max(1, Math.floor((armor + guns + infantry) / 2)), armor, guns, infantry),
        );
      }
      break;
    case "all":
      if (move) {
        move.armor = (move.armor || 0) + availableArmor(from);
        move.guns = (move.guns || 0) + availableGuns(from);
        move.count += availableFrom(from);
      }
      break;
    case "gun-more":
      if (move && availableGuns(from) > 0) {
        if (move.count - (move.armor || 0) - (move.guns || 0) <= 0) move.count++;
        move.guns = (move.guns || 0) + 1;
      }
      break;
    case "gun-less":
      if (move && move.guns > 0) {
        if (availableInfantry(from) <= 0) move.count--;
        move.guns--;
        if (move.count <= 0) removeMove();
      }
      break;
    case "offensive":
      launchOffensive(selection());
      return;
    case "split": {
      const targets = store.map.provinces[id].neighbors.filter(
        (n) => store.map.provinces[n].land && canOrder(id, n) && game.state.owner[n] !== game.me,
      );
      if (targets.length) splitAcross(id, targets);
      else toast("No enemy next to this province");
      break;
    }
    case "tank-more":
      if (move && availableArmor(from) > 0) {
        if (move.count - (move.armor || 0) - (move.guns || 0) <= 0) move.count++;
        move.armor = (move.armor || 0) + 1;
      }
      break;
    case "tank-less":
      if (move && move.armor > 0) {
        if (availableInfantry(from) <= 0) move.count--;
        move.armor--;
        if (move.count <= 0) removeMove();
      }
      break;
    case "cancel":
      if (move) removeMove();
      break;
    case "clear-orders":
      orders.moves = [];
      orders.recruits = {};
      orders.tanks = {};
      orders.artillery = {};
      orders.builds = {};
      break;
    case "clear-production":
      orders.recruits = {};
      orders.tanks = {};
      orders.artillery = {};
      orders.builds = {};
      break;
    case "auto-production": {
      orders.recruits = {};
      orders.tanks = {};
      orders.artillery = {};
      orders.builds = {};
      const plan = planProduction(store.map, game.state, game.me, industryLeft());
      Object.assign(orders.recruits, plan.recruits);
      Object.assign(orders.tanks, plan.tanks);
      Object.assign(orders.artillery, plan.artillery);
      Object.assign(orders.builds, plan.builds);
      break;
    }
    case "repeat":
      game.repeat = !repeatOn();
      saveRepeat(game.repeat);
      break;
    case "tank1":
    case "tankMax":
    case "gun1":
    case "gunMax": {
      const tank = action.startsWith("tank");
      const list = tank ? orders.tanks : orders.artillery;
      const room = specialsLeft();
      const cost = tank ? ARMOR_COST : GUN_COST;
      const wanted = action.endsWith("1") ? 1 : room;
      const count = Math.min(wanted, room, Math.floor(industryLeft() / cost));
      if (!canDeploy(store.map, game.state, game.me, id))
        toast("Units can only deploy in supplied provinces");
      else if (room <= 0)
        toast("Tanks and artillery are limited to 2 per factory level each turn. Build factories!");
      else if (count > 0) list[id] = (list[id] || 0) + count;
      else toast("Not enough industry");
      break;
    }
    case "untank":
      if (orders.tanks[id] && --orders.tanks[id] <= 0) delete orders.tanks[id];
      break;
    case "ungun":
      if (orders.artillery[id] && --orders.artillery[id] <= 0) delete orders.artillery[id];
      break;
    case "recruit1":
    case "recruit5":
    case "recruitMax": {
      const wanted = { recruit1: 1, recruit5: 5, recruitMax: Infinity }[action];
      const count = Math.min(wanted, industryLeft());
      if (!canDeploy(store.map, game.state, game.me, id))
        toast("Units can only deploy in supplied provinces");
      else if (count > 0) orders.recruits[id] = (orders.recruits[id] || 0) + count;
      else toast("Not enough industry");
      break;
    }
    case "unrecruit":
      if (orders.recruits[id] && --orders.recruits[id] <= 0) delete orders.recruits[id];
      break;
    case "aid1":
    case "aid5": {
      if (orders.aidTo !== id) {
        orders.aidTo = id;
        orders.aidAmount = 0;
      }
      const wanted = action === "aid5" ? 5 : 1;
      const count = Math.min(wanted, industryLeft());
      if (count > 0) orders.aidAmount += count;
      else toast("Not enough industry");
      break;
    }
    case "aid-less":
      if (orders.aidTo === id && --orders.aidAmount <= 0) {
        orders.aidTo = -1;
        orders.aidAmount = 0;
      }
      break;
    case "aid-clear":
      orders.aidTo = -1;
      orders.aidAmount = 0;
      break;
    case "diplo-offer":
      orders.offer = id;
      break;
    case "diplo-withdraw":
      orders.offer = -1;
      break;
    case "diplo-break":
      orders.breakAlliance = 1;
      break;
    case "diplo-keep":
      orders.breakAlliance = 0;
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
  if (relativeTurn(game.state) > 2 || game.me < 0) return;

  let bestScore = 0;
  for (const p of map.provinces) {
    if (game.state.owner[p.id] !== game.me) continue;
    for (const n of p.neighbors) {
      if (!map.provinces[n].land || game.state.owner[n] === game.me) continue;
      const score =
        attackStrength(game.state, game.me, game.state.troops[p.id]) -
        defenseStrength(map, game.state, n) +
        (map.provinces[n].city ? 3 : 0);
      if (score > bestScore) {
        bestScore = score;
        game.hint = { from: p.id, to: n };
      }
    }
  }
}

const REPEAT_KEY = "frontlines.repeatProduction";

function saveRepeat(on) {
  try {
    localStorage.setItem(REPEAT_KEY, on ? "1" : "0");
  } catch {}
}

export function repeatOn() {
  const game = store.game;
  if (game && typeof game.repeat === "boolean") return game.repeat;
  try {
    return localStorage.getItem(REPEAT_KEY) !== "0";
  } catch {
    return true;
  }
}

function rememberProduction(nation) {
  const game = store.game;
  const orders = game.orders[nation];
  game.production[nation] = {
    recruits: { ...orders.recruits },
    tanks: { ...orders.tanks },
    artillery: { ...orders.artillery },
  };
}

function repeatProduction(nation) {
  const { game, map } = store;
  const last = game.production[nation];
  if (!last || !repeatOn()) return;
  const orders = game.orders[nation];
  let budget = game.state.industry[nation];
  let cap = specialCap(game.state, nation);
  for (const [kind, cost] of [
    ["tanks", ARMOR_COST],
    ["artillery", GUN_COST],
  ]) {
    for (const key in last[kind] ?? {}) {
      const id = Number(key);
      if (!canDeploy(map, game.state, nation, id)) continue;
      const count = Math.min(last[kind][key], cap, Math.floor(budget / cost));
      if (count <= 0) continue;
      orders[kind][id] = count;
      budget -= count * cost;
      cap -= count;
    }
  }
  for (const key in last.recruits) {
    const id = Number(key);
    if (!canDeploy(map, game.state, nation, id)) continue;
    const count = Math.min(last.recruits[key], budget);
    if (count <= 0) continue;
    orders.recruits[id] = count;
    budget -= count;
  }
}

export function startPlanning() {
  const game = store.game;
  game.phase = "plan";
  game.orders = freshOrders();
  game.history = [];
  game.group = [];
  for (const n of NATIONS) {
    const mine = n === game.me || (game.mode !== "online" && game.seats[n].type === "local");
    if (mine && game.state.alive[n]) repeatProduction(n);
  }
  game.ready = NATIONS.map(() => 0);
  game.planned = NATIONS.map(() => 0);
  game.selected = -1;
  game.selectedNation = -1;
  game.lastTick = -1;
  if (isHotseat(game)) {
    game.me = localSeats(game)[0];
    showHandoff(game.me);
  }
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
    if (game.ready[game.me]) rememberProduction(game.me);
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
  rememberProduction(game.me);
  game.selected = -1;
  game.selectedNation = -1;
  game.group = [];
  game.planned[game.me] = 1;
  const next = localSeats(game).find((n) => !game.planned[n]);
  if (next !== undefined) {
    game.me = next;
    computeHint();
    playSound("click");
    showHandoff(next);
    renderTopBar();
    renderPanel();
    return;
  }
  resolveLocally();
}

function resolveLocally() {
  const { game, map } = store;
  const orders = NATIONS.map((n) =>
    sanitizeOrders(
      map,
      game.state,
      n,
      game.seats[n].type === "local" ? game.orders[n] : planAiOrders(map, game.state, n, game.difficulty),
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

function reportAttrition(animation) {
  const { map } = store;
  const { events, before, after } = animation;
  for (const a of events.attrition || []) {
    const p = map.provinces[a.province];
    if (!p) continue;
    addFloater(p.x, p.y + 4, a.surrender ? `${a.lost} SURRENDER` : `−${a.lost} SUPPLY`, "#ff9b7a", 0.6);
  }
  const surrendered = new Map();
  for (const a of events.attrition || []) {
    if (!a.surrender) continue;
    const owner = after.owner[a.province];
    const entry = surrendered.get(owner) ?? { lost: 0, place: map.provinces[a.province]?.name ?? "" };
    entry.lost += a.lost;
    surrendered.set(owner, entry);
  }
  for (const [owner, entry] of surrendered) {
    postNews(
      `THE ${entry.place.toUpperCase()} POCKET SURRENDERS`,
      `${entry.lost} ${NATION_NAMES[owner] ?? ""} divisions lay down their arms after weeks without supplies.`,
      owner,
    );
    addShake(6);
  }
  const trapped = new Map();
  const beforeSiege = before.siege ?? [];
  for (const p of map.provinces) {
    const owner = after.owner[p.id];
    if (!p.land || owner < 0 || (after.siege?.[p.id] ?? 0) !== 1 || (beforeSiege[p.id] ?? 0) > 0) continue;
    const entry = trapped.get(owner) ?? { divisions: 0, place: p.name };
    entry.divisions += after.troops[p.id];
    trapped.set(owner, entry);
  }
  for (const [owner, entry] of trapped) {
    if (entry.divisions <= 0) continue;
    postNews(
      `ENCIRCLED NEAR ${entry.place.toUpperCase()}`,
      `${entry.divisions} ${NATION_NAMES[owner]} divisions are cut off. Break the ring within 3 turns or they surrender.`,
      owner,
    );
  }
}

function reportSeason(before, after) {
  if (winterActive(after) && !winterActive(before)) {
    postNews("WINTER SETS IN", "Frozen roads slow every offensive. Attacks are 20% weaker until March.", -1);
    playSound("wind");
  } else if (!winterActive(after) && winterActive(before)) {
    postNews("THE THAW", "Spring returns to the front. Offensives regain their full strength.", -1);
  }
}

function reportDiplomacy(animation) {
  const { game } = store;
  const { events, before, after } = animation;
  const ours = (n) => n === game.me || (game.mode !== "online" && game.seats[n]?.type === "local");
  for (const d of events.diplomacy || []) {
    const a = NATION_NAMES[d.a];
    const b = NATION_NAMES[d.b];
    if (d.kind === "form") {
      postNews(
        `${a} AND ${b} SIGN A PACT`,
        "A new faction is born. They share supply lines and fight side by side.",
        d.a,
      );
      playSound("pact");
    } else if (d.kind === "join") {
      postNews(
        `${a} JOINS THE ${factionName(after, after.faction[d.a])}`,
        `${a} enters the war alongside ${b}.`,
        d.a,
      );
      playSound("pact");
    } else if (d.kind === "leave") {
      const name = factionName(before, d.b);
      const betrayed = NATIONS.filter((n) => before.faction[n] === d.b && n !== d.a && ours(n));
      if (betrayed.length) {
        postNews(`${a} BETRAYS THE ${name}`, `${a} has torn up the pact. Watch your borders!`, d.a);
      } else {
        postNews(`${a} LEAVES THE ${name}`, `${a} walks away from its allies.`, d.a);
      }
      playSound("defeat");
    } else if (d.kind === "offer" && ours(d.b)) {
      const inFaction = before.faction[d.a] >= 0;
      postNews(
        inFaction
          ? `${a} INVITES ${b} TO THE ${factionName(before, before.faction[d.a])}`
          : `${a} PROPOSES AN ALLIANCE`,
        `${b}: tap their flag in the top bar to accept or ignore it.`,
        d.a,
      );
      playSound("news");
    } else if (d.kind === "aid" && (ours(d.a) || ours(d.b))) {
      postFeed(`${a} sent ${d.amount} ⚙ of aid to ${b}`, d.a);
    }
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

function buildReport(animation, me) {
  const { map } = store;
  const { before, after, events } = animation;
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
  reportAttrition(animation);
  reportIndustry(animation);
  reportSeason(animation.before, animation.after);
  reportWorldEvent(animation.events.world);
  reportDiplomacy(animation);
  game.reports = Object.fromEntries(
    NATIONS.filter((n) => n === game.me || game.seats[n].type === "local").map((n) => [
      n,
      buildReport(animation, n),
    ]),
  );
  game.report = game.reports[game.me] ?? null;
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
  if (game.mode === "practice" && !localSeats(game).length) {
    endGame();
    return;
  }
  if (game.mode === "practice" && !game.state.alive[game.me]) game.me = localSeats(game)[0];
  playSound("turn");
  startPlanning();
}

function runDemo(dt) {
  const { game, map } = store;
  game.demoClock += dt;
  if (game.demoClock < DEMO_TURN_DELAY) return;
  game.demoClock = 0;
  if (game.state.winner >= 0 || relativeTurn(game.state) > 22) {
    startDemo();
    return;
  }
  const orders = NATIONS.map((n) =>
    sanitizeOrders(map, game.state, n, planAiOrders(map, game.state, n, "easy")),
  );
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
