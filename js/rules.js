import {
  BUILD_COST,
  BUILDING,
  CAPITAL_BONUS,
  DEFAULT_TURNS,
  FORT_BONUS,
  NATIONS,
  NEUTRAL,
  STARTING_INDUSTRY,
  SUPPLY_DEFENSE,
  TERRAIN_DEFENSE,
  WINTER_ATTACK,
  hasTrait,
  isWinter,
} from "./config.js";
import { createRng } from "./random.js";

const CAPITAL_GARRISON = 8;
const BORDERLAND_GARRISON = 3;
const VICTORY_SHARE = 0.6;
const MAX_RECRUITS = 99;
const BLITZ_ATTACK = 1.1;
const FORTRESS_FORT_BONUS = 0.75;
const FORTRESS_CITY_BONUS = 0.5;
const EVENT_CHANCE = 0.5;

export const WORLD_EVENTS = ["volunteers", "boom", "strikes", "partisans", "harvest"];

const supplyCache = new WeakMap();

export function emptyOrders() {
  return { moves: [], recruits: {}, builds: {} };
}

export function createInitialState(map, maxTurns = DEFAULT_TURNS) {
  const count = map.provinces.length;
  const state = {
    turn: 1,
    maxTurns,
    winner: -1,
    owner: new Array(count).fill(NEUTRAL),
    troops: new Array(count).fill(0),
    buildings: new Array(count).fill(BUILDING.NONE),
    industry: NATIONS.map(() => STARTING_INDUSTRY),
    alive: NATIONS.map(() => 1),
  };

  const rng = createRng(map.seed ^ 0x5bd1e995);
  for (const p of map.provinces) {
    if (!p.land) continue;
    state.troops[p.id] = p.city ? 4 : [1 + Math.floor(rng() * 2), 2, 3][p.terrain];
  }

  for (const nation of NATIONS) {
    const capital = map.capitals[nation];
    state.owner[capital] = nation;
    state.troops[capital] = CAPITAL_GARRISON;
    for (const n of map.provinces[capital].neighbors) {
      const q = map.provinces[n];
      if (q.land && !q.city && state.owner[n] === NEUTRAL) {
        state.owner[n] = nation;
        state.troops[n] = BORDERLAND_GARRISON;
      }
    }
  }
  return state;
}

export function buildCost(nation, kind) {
  if (kind === BUILDING.FACTORY && hasTrait(nation, "industry")) return 7;
  if (kind === BUILDING.FORT && hasTrait(nation, "fortress")) return 4;
  return BUILD_COST[kind];
}

export function fortBonus(nation) {
  return hasTrait(nation, "fortress") ? FORTRESS_FORT_BONUS : FORT_BONUS;
}

export function attackMultiplier(nation, turn) {
  return (hasTrait(nation, "blitz") ? BLITZ_ATTACK : 1) * (isWinter(turn) ? WINTER_ATTACK : 1);
}

export function attackStrength(nation, count, turn) {
  return count * attackMultiplier(nation, turn);
}

export function supplyNetwork(map, state) {
  const owner = state.owner;
  const key = owner.join(",");
  const cached = supplyCache.get(owner);
  if (cached && cached.key === key) return cached.supplied;

  const { provinces } = map;
  const supplied = new Uint8Array(provinces.length);
  const queue = [];
  for (const p of provinces) {
    if (owner[p.id] === NEUTRAL || !p.land) supplied[p.id] = 1;
    else if (p.city) {
      supplied[p.id] = 1;
      queue.push(p.id);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    for (const n of provinces[id].neighbors) {
      if (!supplied[n] && owner[n] === owner[id]) {
        supplied[n] = 1;
        queue.push(n);
      }
    }
  }
  supplyCache.set(owner, { key, supplied });
  return supplied;
}

export function isSupplied(map, state, id) {
  return supplyNetwork(map, state)[id] === 1;
}

export function defenseMultiplier(map, state, id, building = state.buildings[id]) {
  const p = map.provinces[id];
  const holder = state.owner[id];
  const base =
    TERRAIN_DEFENSE[p.terrain] +
    (building === BUILDING.FORT ? fortBonus(holder) : 0) +
    (p.capitalOf >= 0 ? CAPITAL_BONUS : 0) +
    (p.city && hasTrait(holder, "fortress") ? FORTRESS_CITY_BONUS : 0);
  return holder !== NEUTRAL && !isSupplied(map, state, id) ? base * SUPPLY_DEFENSE : base;
}

export function defenseStrength(map, state, id) {
  return state.troops[id] * defenseMultiplier(map, state, id);
}

export function income(map, state, nation) {
  let provinces = 0;
  let cities = 0;
  let capitals = 0;
  let factories = 0;
  for (const p of map.provinces) {
    if (state.owner[p.id] !== nation) continue;
    provinces++;
    if (p.capitalOf >= 0) capitals++;
    else if (p.city) cities++;
    if (state.buildings[p.id] === BUILDING.FACTORY) factories++;
  }
  return 2 + Math.floor(provinces / 2) + 2 * cities + 4 * capitals + 3 * factories;
}

export function victoryPoints(map, state, nation) {
  let points = 0;
  for (const p of map.provinces) {
    if (p.city && state.owner[p.id] === nation) points += p.capitalOf >= 0 ? 3 : 1;
  }
  return points;
}

export function victoryGoal(map) {
  return Math.ceil(map.totalVictoryPoints * VICTORY_SHARE);
}

export function provinceCount(state, nation) {
  return state.owner.filter((o) => o === nation).length;
}

export function divisionCount(state, nation) {
  return state.owner.reduce((sum, o, i) => (o === nation ? sum + state.troops[i] : sum), 0);
}

export function factoryCount(state, nation) {
  return state.owner.filter((o, i) => o === nation && state.buildings[i] === BUILDING.FACTORY).length;
}

export function ordersCost(orders, nation) {
  let cost = 0;
  for (const id in orders.recruits) cost += orders.recruits[id];
  for (const id in orders.builds) cost += buildCost(nation, orders.builds[id]);
  return cost;
}

export function sanitizeOrders(map, state, nation, orders) {
  const clean = emptyOrders();
  if (!orders || !state.alive[nation]) return clean;
  const { provinces } = map;
  let budget = state.industry[nation];
  const owns = (id) => provinces[id] && state.owner[id] === nation;

  for (const key in orders.builds || {}) {
    const id = Number(key);
    const kind = Number(orders.builds[key]);
    if (!owns(id) || !provinces[id].city || state.buildings[id] !== BUILDING.NONE) continue;
    if (kind !== BUILDING.FORT && kind !== BUILDING.FACTORY) continue;
    if (budget < buildCost(nation, kind)) continue;
    budget -= buildCost(nation, kind);
    clean.builds[id] = kind;
  }

  for (const key in orders.recruits || {}) {
    const id = Number(key);
    if (!owns(id) || !provinces[id].city) continue;
    const count = Math.min(Math.floor(Number(orders.recruits[key]) || 0), budget, MAX_RECRUITS);
    if (count <= 0) continue;
    budget -= count;
    clean.recruits[id] = count;
  }

  const committed = {};
  for (const move of orders.moves || []) {
    const from = Math.floor(Number(move.from));
    const to = Math.floor(Number(move.to));
    if (!owns(from) || !provinces[to] || !provinces[to].land) continue;
    if (!provinces[from].neighbors.includes(to)) continue;
    const free = state.troops[from] - (committed[from] || 0);
    const count = Math.min(Math.floor(Number(move.count) || 0), free);
    if (count <= 0) continue;
    committed[from] = (committed[from] || 0) + count;
    clean.moves.push({ from, to, count });
  }
  return clean;
}

function survivorsOf(count, strength, enemyStrength) {
  if (strength - enemyStrength < 1e-9) return 0;
  const perTroop = strength / count;
  return Math.min(count, Math.max(1, Math.ceil((strength - enemyStrength) / perTroop - 1e-9)));
}

function settleHeadOnClashes(moves, turn) {
  for (const a of moves) {
    for (const b of moves) {
      if (a === b || a.nation === b.nation || a.count <= 0 || b.count <= 0) continue;
      if (a.from !== b.to || a.to !== b.from) continue;
      const sa = attackStrength(a.nation, a.count, turn);
      const sb = attackStrength(b.nation, b.count, turn);
      a.count = survivorsOf(a.count, sa, sb);
      b.count = survivorsOf(b.count, sb, sa);
      if (a.count === 0) a.stop = 0.5;
      if (b.count === 0) b.stop = 0.5;
    }
  }
}

function fightBattles(map, state, moves, owner, troops) {
  const incoming = map.provinces.map(() => NATIONS.map(() => 0));
  for (const m of moves) if (m.count > 0) incoming[m.to][m.nation] += m.count;

  const battles = [];
  const captures = [];

  for (const p of map.provinces) {
    const id = p.id;
    if (!p.land || !incoming[id].some((n) => n > 0)) continue;
    const holder = owner[id];
    const multiplier = defenseMultiplier(map, state, id);

    const forces = [];
    for (const nation of NATIONS) {
      const count = incoming[id][nation] + (nation === holder ? troops[id] : 0);
      if (count > 0) {
        const strength = nation === holder ? count * multiplier : attackStrength(nation, count, state.turn);
        forces.push({ nation, count, strength });
      }
    }
    if (holder === NEUTRAL && troops[id] > 0) {
      forces.push({ nation: NEUTRAL, count: troops[id], strength: troops[id] * multiplier });
    }

    if (forces.length === 1) {
      const [victor] = forces;
      if (victor.nation !== holder) captures.push({ province: id, from: holder, to: victor.nation });
      owner[id] = victor.nation;
      troops[id] = victor.count;
      continue;
    }

    forces.sort((a, b) => b.strength - a.strength);
    battles.push(id);
    const [victor, runnerUp] = forces;
    const survivors = survivorsOf(victor.count, victor.strength, runnerUp.strength);
    if (survivors === 0) {
      troops[id] = 0;
      continue;
    }
    if (victor.nation !== holder) captures.push({ province: id, from: holder, to: victor.nation });
    owner[id] = victor.nation;
    troops[id] = survivors;
  }
  return { battles, captures };
}

function decideWinner(map, next) {
  const alive = NATIONS.filter((n) => next.alive[n]);
  if (alive.length === 1) return alive[0];
  if (alive.length === 0) return NATIONS.length;

  const points = NATIONS.map((n) => victoryPoints(map, next, n));
  const ranked = alive
    .slice()
    .sort(
      (a, b) =>
        points[b] - points[a] ||
        provinceCount(next, b) - provinceCount(next, a) ||
        divisionCount(next, b) - divisionCount(next, a),
    );
  const [leader, second] = ranked;
  if (points[leader] >= victoryGoal(map) && points[leader] > points[second]) return leader;
  if (next.turn > next.maxTurns) return leader;
  return -1;
}

export function resolveTurn(map, state, ordersByNation) {
  const owner = state.owner.slice();
  const troops = state.troops.slice();
  const buildings = state.buildings.slice();
  const industry = state.industry.slice();

  const moves = [];
  for (const nation of NATIONS) {
    const orders = ordersByNation[nation];
    if (!orders || !state.alive[nation]) continue;
    for (const m of orders.moves) {
      troops[m.from] -= m.count;
      moves.push({ nation, from: m.from, to: m.to, count: m.count, sent: m.count, stop: 1 });
    }
  }

  settleHeadOnClashes(moves, state.turn);
  const { battles, captures } = fightBattles(map, state, moves, owner, troops);

  for (const nation of NATIONS) {
    const orders = ordersByNation[nation];
    if (!orders || !state.alive[nation]) continue;
    for (const key in orders.builds) {
      const id = Number(key);
      industry[nation] -= buildCost(nation, orders.builds[key]);
      if (owner[id] === nation && buildings[id] === BUILDING.NONE) buildings[id] = orders.builds[key];
    }
    for (const key in orders.recruits) {
      const id = Number(key);
      industry[nation] -= orders.recruits[key];
      if (owner[id] === nation) troops[id] += orders.recruits[key];
    }
  }

  for (const p of map.provinces) {
    const holder = owner[p.id];
    if (p.city && p.capitalOf < 0 && holder !== NEUTRAL && hasTrait(holder, "mobilization")) troops[p.id]++;
  }

  const attrition = [];
  const supplied = supplyNetwork(map, { owner });
  for (const p of map.provinces) {
    if (!p.land || supplied[p.id] || troops[p.id] <= 0) continue;
    const lost = Math.max(1, Math.floor(troops[p.id] / 4));
    troops[p.id] -= lost;
    attrition.push({ province: p.id, lost });
  }

  const next = {
    turn: state.turn + 1,
    maxTurns: state.maxTurns,
    winner: -1,
    owner,
    troops,
    buildings,
    industry,
    alive: NATIONS.map(() => 0),
  };
  for (const nation of NATIONS) {
    next.alive[nation] = provinceCount(next, nation) > 0 ? 1 : 0;
    next.industry[nation] = next.alive[nation]
      ? Math.max(0, next.industry[nation]) + income(map, next, nation)
      : 0;
  }
  const world = rollWorldEvent(map, next);
  next.winner = decideWinner(map, next);

  return {
    state: next,
    events: {
      moves: moves.map(({ nation, from, to, sent, stop }) => ({ nation, from, to, sent, stop })),
      battles,
      captures,
      attrition,
      world,
    },
  };
}

function strongestNation(map, state, alive) {
  return alive
    .slice()
    .sort(
      (a, b) =>
        victoryPoints(map, state, b) - victoryPoints(map, state, a) ||
        provinceCount(state, b) - provinceCount(state, a) ||
        a - b,
    )[0];
}

function rollWorldEvent(map, next) {
  const rng = createRng((map.seed ^ Math.imul(next.turn, 0x2c1b3c6d)) >>> 0);
  if (next.turn < 3 || rng() > EVENT_CHANCE) return null;
  const alive = NATIONS.filter((n) => next.alive[n]);
  if (alive.length < 2) return null;

  const kind = WORLD_EVENTS[Math.floor(rng() * WORLD_EVENTS.length)];
  const leader = strongestNation(map, next, alive);
  const underdog = alive.slice().sort((a, b) => provinceCount(next, a) - provinceCount(next, b) || a - b)[0];
  const random = alive[Math.floor(rng() * alive.length)];

  if (kind === "volunteers") {
    const capital = map.capitals[underdog];
    const province =
      next.owner[capital] === underdog
        ? capital
        : map.provinces.find((p) => p.city && next.owner[p.id] === underdog)?.id;
    if (province === undefined) return null;
    next.troops[province] += 3;
    return { kind, nation: underdog, province, amount: 3 };
  }
  if (kind === "boom") {
    next.industry[random] += 5;
    return { kind, nation: random, province: -1, amount: 5 };
  }
  if (kind === "strikes") {
    const amount = Math.min(4, next.industry[leader]);
    if (amount <= 0) return null;
    next.industry[leader] -= amount;
    return { kind, nation: leader, province: -1, amount };
  }
  if (kind === "partisans") {
    const spots = map.provinces.filter(
      (p) => !p.city && next.owner[p.id] === leader && next.troops[p.id] >= 2,
    );
    if (!spots.length) return null;
    const province = spots[Math.floor(rng() * spots.length)].id;
    const amount = Math.ceil(next.troops[province] / 2);
    next.troops[province] -= amount;
    return { kind, nation: leader, province, amount };
  }
  for (const n of alive) next.industry[n] += 2;
  return { kind, nation: NEUTRAL, province: -1, amount: 2 };
}
