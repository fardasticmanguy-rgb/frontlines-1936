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
const MAX_RECRUITS = 99;
const FACTORY_COSTS = [8, 12, 16];
export const MAX_FACTORY_LEVEL = 3;
export const FACTORY_OUTPUT = 3;
const BLITZ_ATTACK = 1.1;
const FORTRESS_FORT_BONUS = 0.75;
const FORTRESS_CITY_BONUS = 0.5;
const EVENT_CHANCE = 0.5;

export const WORLD_EVENTS = ["volunteers", "boom", "strikes", "partisans", "harvest"];

const supplyCache = new WeakMap();
const BLOC_SHARES = [0.6, 0.75, 0.85, 0.9];
const ROUGH_BONUS = 0.25;
const MAX_AID = 50;

export const KEEP_OFFER = -2;
export const DEFAULT_RULES = Object.freeze({ winter: 1, events: 1 });

export function emptyOrders() {
  return {
    moves: [],
    recruits: {},
    builds: {},
    offer: KEEP_OFFER,
    breakAlliance: 0,
    aidTo: NEUTRAL,
    aidAmount: 0,
  };
}

export function factionOf(state, nation) {
  return nation >= 0 ? (state.faction?.[nation] ?? NEUTRAL) : NEUTRAL;
}

export function areAllied(state, a, b) {
  return (
    a >= 0 && b >= 0 && a !== b && factionOf(state, a) >= 0 && factionOf(state, a) === factionOf(state, b)
  );
}

export function isHostile(state, nation, other) {
  return other !== nation && !areAllied(state, nation, other);
}

export function factionMembers(state, id) {
  return id < 0 ? [] : NATIONS.filter((n) => state.alive[n] && state.faction[n] === id);
}

export function alliesOf(state, nation) {
  return factionMembers(state, factionOf(state, nation)).filter((n) => n !== nation);
}

export function blocOf(state, nation) {
  const members = factionMembers(state, factionOf(state, nation));
  return members.length > 1 ? members : [nation];
}

export function blocs(state) {
  const seen = new Set();
  const result = [];
  for (const n of NATIONS) {
    if (!state.alive[n] || seen.has(n)) continue;
    const bloc = blocOf(state, n);
    bloc.forEach((m) => seen.add(m));
    result.push(bloc);
  }
  return result;
}

export function factionCap(map) {
  return Math.max(2, Math.floor(map.nationCount / 2));
}

export function relativeTurn(state) {
  return state.turn - (state.firstTurn ?? 1) + 1;
}

export function warLength(state) {
  return state.maxTurns - (state.firstTurn ?? 1) + 1;
}

export function winterActive(state) {
  return Boolean((state.rules ?? DEFAULT_RULES).winter) && isWinter(state.turn);
}

export function createInitialState(map, length = DEFAULT_TURNS, rules = DEFAULT_RULES) {
  const count = map.provinces.length;
  const firstTurn = map.firstTurn ?? 1;
  const state = {
    turn: firstTurn,
    firstTurn,
    maxTurns: firstTurn + length - 1,
    winner: -1,
    owner: new Array(count).fill(NEUTRAL),
    troops: new Array(count).fill(0),
    forts: new Array(count).fill(0),
    factories: new Array(count).fill(0),
    industry: NATIONS.map((n) => (n < map.nationCount ? STARTING_INDUSTRY : 0)),
    alive: NATIONS.map((n) => (n < map.nationCount ? 1 : 0)),
    faction: NATIONS.map(() => NEUTRAL),
    offers: NATIONS.map(() => NEUTRAL),
    rules: { winter: rules.winter ? 1 : 0, events: rules.events ? 1 : 0 },
    bonus: NATIONS.map(() => 0),
  };

  if (map.start) {
    for (const key of ["owner", "troops", "forts", "factories", "industry", "faction"]) {
      state[key] = map.start[key].slice();
    }
    return state;
  }

  const rng = createRng(map.seed ^ 0x5bd1e995);
  for (const p of map.provinces) {
    if (!p.land) continue;
    state.troops[p.id] = p.city ? 4 : [1 + Math.floor(rng() * 2), 2, 3][p.terrain];
  }

  for (const nation of NATIONS.slice(0, map.nationCount)) {
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

export function buildCost(nation, kind, level = 0) {
  if (kind === BUILDING.FACTORY) {
    return FACTORY_COSTS[Math.min(level, MAX_FACTORY_LEVEL - 1)] - (hasTrait(nation, "industry") ? 2 : 0);
  }
  return hasTrait(nation, "fortress") ? 4 : BUILD_COST[kind];
}

export function buildCostAt(state, nation, id, kind) {
  return buildCost(nation, kind, state.factories[id]);
}

export function canBuild(map, state, nation, id, kind) {
  const p = map.provinces[id];
  if (!p || !p.city || state.owner[id] !== nation) return false;
  if (kind === BUILDING.FORT) return !state.forts[id];
  if (kind === BUILDING.FACTORY) return state.factories[id] < MAX_FACTORY_LEVEL;
  return false;
}

export function fortBonus(nation) {
  return hasTrait(nation, "fortress") ? FORTRESS_FORT_BONUS : FORT_BONUS;
}

export function attackMultiplier(state, nation) {
  const cold = winterActive(state) && !hasTrait(nation, "winter");
  return (hasTrait(nation, "blitz") ? BLITZ_ATTACK : 1) * (cold ? WINTER_ATTACK : 1);
}

export function attackStrength(state, nation, count) {
  return count * attackMultiplier(state, nation);
}

export function supplyNetwork(map, state) {
  const owner = state.owner;
  const faction = state.faction ?? NATIONS.map(() => NEUTRAL);
  const key = `${owner.join(",")}|${faction.join(",")}`;
  const cached = supplyCache.get(owner);
  if (cached && cached.key === key) return cached.supplied;

  const { provinces } = map;
  const supplied = new Uint8Array(provinces.length);
  for (const p of provinces) if (owner[p.id] === NEUTRAL || !p.land) supplied[p.id] = 1;

  for (const nation of NATIONS) {
    const side = faction[nation];
    const passable = (id) =>
      owner[id] === nation || (side >= 0 && owner[id] >= 0 && faction[owner[id]] === side);
    const visited = new Uint8Array(provinces.length);
    const queue = [];
    for (const p of provinces) {
      if (p.land && p.city && owner[p.id] === nation) {
        visited[p.id] = 1;
        queue.push(p.id);
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head];
      if (owner[id] === nation) supplied[id] = 1;
      for (const n of provinces[id].neighbors) {
        if (!visited[n] && passable(n)) {
          visited[n] = 1;
          queue.push(n);
        }
      }
    }
  }
  supplyCache.set(owner, { key, supplied });
  return supplied;
}

export function isSupplied(map, state, id) {
  return supplyNetwork(map, state)[id] === 1;
}

export function defenseMultiplier(map, state, id) {
  const p = map.provinces[id];
  const holder = state.owner[id];
  const base =
    TERRAIN_DEFENSE[p.terrain] +
    (state.forts[id] ? fortBonus(holder) : 0) +
    (p.capitalOf >= 0 ? CAPITAL_BONUS : 0) +
    (p.city && hasTrait(holder, "fortress") ? FORTRESS_CITY_BONUS : 0) +
    (p.terrain > 0 && hasTrait(holder, "rough") ? ROUGH_BONUS : 0);
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
    factories += state.factories[p.id];
  }
  const total = 2 + Math.floor(provinces / 2) + 2 * cities + 4 * capitals + FACTORY_OUTPUT * factories;
  return Math.floor(total * (map.incomeScale ?? 1) * (1 + (state.bonus?.[nation] ?? 0) / 100));
}

export function victoryPoints(map, state, nation) {
  let points = 0;
  for (const p of map.provinces) {
    if (p.city && state.owner[p.id] === nation) points += p.capitalOf >= 0 ? 3 : 1;
  }
  return points;
}

export function victoryGoal(map, size = 1) {
  return Math.ceil(map.totalVictoryPoints * BLOC_SHARES[Math.min(size, BLOC_SHARES.length) - 1]);
}

export function provinceCount(state, nation) {
  return state.owner.filter((o) => o === nation).length;
}

export function divisionCount(state, nation) {
  return state.owner.reduce((sum, o, i) => (o === nation ? sum + state.troops[i] : sum), 0);
}

export function factoryCount(state, nation) {
  return state.owner.reduce((sum, o, i) => (o === nation ? sum + state.factories[i] : sum), 0);
}

export function ordersCost(orders, nation, state) {
  let cost = 0;
  for (const id in orders.recruits) cost += orders.recruits[id];
  for (const id in orders.builds) cost += buildCostAt(state, nation, id, orders.builds[id]);
  return cost + (orders.aidTo >= 0 ? orders.aidAmount || 0 : 0);
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
    if (!canBuild(map, state, nation, id, kind)) continue;
    const cost = buildCostAt(state, nation, id, kind);
    if (budget < cost) continue;
    budget -= cost;
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
    if (areAllied(state, nation, state.owner[to])) continue;
    if (!provinces[from].neighbors.includes(to)) continue;
    const free = state.troops[from] - (committed[from] || 0);
    const count = Math.min(Math.floor(Number(move.count) || 0), free);
    if (count <= 0) continue;
    committed[from] = (committed[from] || 0) + count;
    clean.moves.push({ from, to, count });
  }

  const offer = Math.floor(Number(orders.offer ?? KEEP_OFFER));
  if (offer === NEUTRAL || offer === KEEP_OFFER) clean.offer = offer;
  else if (NATIONS.includes(offer) && offer !== nation && state.alive[offer]) clean.offer = offer;
  clean.breakAlliance = orders.breakAlliance && factionOf(state, nation) >= 0 ? 1 : 0;

  const aidTo = Math.floor(Number(orders.aidTo ?? NEUTRAL));
  const aidAmount = Math.min(Math.floor(Number(orders.aidAmount) || 0), budget, MAX_AID);
  if (NATIONS.includes(aidTo) && aidTo !== nation && state.alive[aidTo] && aidAmount > 0) {
    clean.aidTo = aidTo;
    clean.aidAmount = aidAmount;
  }
  return clean;
}

function survivorsOf(count, strength, enemyStrength) {
  if (strength - enemyStrength < 1e-9) return 0;
  const perTroop = strength / count;
  return Math.min(count, Math.max(1, Math.ceil((strength - enemyStrength) / perTroop - 1e-9)));
}

function settleHeadOnClashes(moves, state) {
  for (const a of moves) {
    for (const b of moves) {
      if (a === b || a.nation === b.nation || a.count <= 0 || b.count <= 0) continue;
      if (a.from !== b.to || a.to !== b.from) continue;
      const sa = attackStrength(state, a.nation, a.count);
      const sb = attackStrength(state, b.nation, b.count);
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

    const sides = new Map();
    const join = (side, nation, count, strength) => {
      const entry = sides.get(side) ?? {
        count: 0,
        strength: 0,
        lead: nation,
        leadStrength: -1,
        holder: false,
      };
      entry.count += count;
      entry.strength += strength;
      if (strength > entry.leadStrength) {
        entry.lead = nation;
        entry.leadStrength = strength;
      }
      if (nation === holder) entry.holder = true;
      sides.set(side, entry);
    };
    for (const nation of NATIONS) {
      const count = incoming[id][nation] + (nation === holder ? troops[id] : 0);
      if (count <= 0) continue;
      const strength = nation === holder ? count * multiplier : attackStrength(state, nation, count);
      const side = factionOf(state, nation);
      join(side >= 0 ? `f${side}` : `n${nation}`, nation, count, strength);
    }
    if (holder === NEUTRAL && troops[id] > 0) join("neutral", NEUTRAL, troops[id], troops[id] * multiplier);

    const forces = [...sides.values()].map((side) => ({
      nation: side.holder ? holder : side.lead,
      count: side.count,
      strength: side.strength,
    }));
    if (forces.length === 1) {
      const [victor] = forces;
      if (victor.nation !== holder) captures.push({ province: id, from: holder, to: victor.nation });
      owner[id] = victor.nation;
      troops[id] = victor.count;
      continue;
    }

    forces.sort((a, b) => b.strength - a.strength || a.nation - b.nation);
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

export function blocGoal(map, bloc) {
  return victoryGoal(map, bloc.length);
}

export function blocPoints(map, state, bloc) {
  return bloc.reduce((sum, n) => sum + victoryPoints(map, state, n), 0);
}

function decideWinner(map, next) {
  const alive = NATIONS.filter((n) => next.alive[n]);
  if (alive.length === 0) return NATIONS.length;

  const points = NATIONS.map((n) => victoryPoints(map, next, n));
  const sum = (bloc, measure) => bloc.reduce((total, n) => total + measure(n), 0);
  const ranked = blocs(next).sort(
    (a, b) =>
      sum(b, (n) => points[n]) - sum(a, (n) => points[n]) ||
      sum(b, (n) => provinceCount(next, n)) - sum(a, (n) => provinceCount(next, n)) ||
      sum(b, (n) => divisionCount(next, n)) - sum(a, (n) => divisionCount(next, n)) ||
      a[0] - b[0],
  );
  const [leader, second] = ranked;
  const head = leader.slice().sort((a, b) => points[b] - points[a] || a - b)[0];
  if (ranked.length === 1) return head;
  const leaderPoints = sum(leader, (n) => points[n]);
  if (leaderPoints >= blocGoal(map, leader) && leaderPoints > sum(second, (n) => points[n])) return head;
  if (next.turn > next.maxTurns) return head;
  return -1;
}

function freeFactionId(faction, preferred) {
  if (!faction.includes(preferred)) return preferred;
  return NATIONS.find((id) => !faction.includes(id));
}

function resolveDiplomacy(map, state, next, ordersByNation) {
  const faction = state.faction.slice();
  const offers = state.offers.slice();
  const diplomacy = [];
  const cap = factionCap(map);
  const size = (id) => NATIONS.filter((n) => next.alive[n] && faction[n] === id).length;

  for (const nation of NATIONS) {
    const orders = ordersByNation[nation];
    if (!orders || !state.alive[nation] || !orders.breakAlliance || faction[nation] < 0) continue;
    diplomacy.push({ kind: "leave", a: nation, b: faction[nation], amount: 0 });
    faction[nation] = NEUTRAL;
    offers[nation] = NEUTRAL;
  }
  for (const nation of NATIONS) {
    const orders = ordersByNation[nation];
    if (!orders || !state.alive[nation] || orders.offer === undefined || orders.offer === KEEP_OFFER)
      continue;
    const previous = offers[nation];
    offers[nation] = orders.offer;
    if (orders.offer >= 0 && orders.offer !== previous) {
      diplomacy.push({ kind: "offer", a: nation, b: orders.offer, amount: 0 });
    }
  }
  for (const nation of NATIONS) {
    if (next.alive[nation]) continue;
    faction[nation] = NEUTRAL;
    offers[nation] = NEUTRAL;
  }
  for (const a of NATIONS) {
    for (const b of NATIONS) {
      if (b <= a || offers[a] !== b || offers[b] !== a || !next.alive[a] || !next.alive[b]) continue;
      const fa = faction[a];
      const fb = faction[b];
      if (fa >= 0 && fb >= 0) continue;
      if (fa < 0 && fb < 0) {
        const id = freeFactionId(faction, a);
        faction[a] = id;
        faction[b] = id;
        diplomacy.push({ kind: "form", a, b, amount: 0 });
      } else {
        const id = fa >= 0 ? fa : fb;
        const joiner = fa >= 0 ? b : a;
        if (size(id) >= cap) continue;
        faction[joiner] = id;
        diplomacy.push({ kind: "join", a: joiner, b: fa >= 0 ? a : b, amount: 0 });
      }
      offers[a] = NEUTRAL;
      offers[b] = NEUTRAL;
    }
  }
  for (const id of NATIONS) {
    const members = NATIONS.filter((n) => next.alive[n] && faction[n] === id);
    if (members.length === 1) faction[members[0]] = NEUTRAL;
  }
  for (const n of NATIONS) {
    const target = offers[n];
    if (target < 0) continue;
    const together = faction[n] >= 0 && faction[n] === faction[target];
    const bothTaken = faction[n] >= 0 && faction[target] >= 0;
    if (together || bothTaken || !next.alive[target]) offers[n] = NEUTRAL;
  }
  next.faction = faction;
  next.offers = offers;
  return diplomacy;
}

export function resolveTurn(map, state, ordersByNation) {
  const owner = state.owner.slice();
  const troops = state.troops.slice();
  const forts = state.forts.slice();
  const factories = state.factories.slice();
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

  settleHeadOnClashes(moves, state);
  const { battles, captures } = fightBattles(map, state, moves, owner, troops);
  for (const c of captures) if (factories[c.province] > 0) factories[c.province]--;

  for (const nation of NATIONS) {
    const orders = ordersByNation[nation];
    if (!orders || !state.alive[nation]) continue;
    for (const key in orders.builds) {
      const id = Number(key);
      const kind = orders.builds[key];
      industry[nation] -= buildCostAt(state, nation, id, kind);
      if (owner[id] !== nation) continue;
      if (kind === BUILDING.FORT) forts[id] = 1;
      else if (kind === BUILDING.FACTORY) factories[id] = Math.min(MAX_FACTORY_LEVEL, factories[id] + 1);
    }
    for (const key in orders.recruits) {
      const id = Number(key);
      industry[nation] -= orders.recruits[key];
      if (owner[id] === nation) troops[id] += orders.recruits[key];
    }
  }

  const aid = [];
  for (const nation of NATIONS) {
    const orders = ordersByNation[nation];
    if (!orders || !state.alive[nation] || !(orders.aidTo >= 0) || !(orders.aidAmount > 0)) continue;
    industry[nation] -= orders.aidAmount;
    aid.push({ kind: "aid", a: nation, b: orders.aidTo, amount: orders.aidAmount });
  }

  for (const p of map.provinces) {
    const holder = owner[p.id];
    if (p.city && p.capitalOf < 0 && holder !== NEUTRAL && hasTrait(holder, "mobilization")) troops[p.id]++;
  }

  const attrition = [];
  const supplied = supplyNetwork(map, { owner, faction: state.faction });
  for (const p of map.provinces) {
    if (!p.land || supplied[p.id] || troops[p.id] <= 0) continue;
    const lost = Math.max(1, Math.floor(troops[p.id] / 4));
    troops[p.id] -= lost;
    attrition.push({ province: p.id, lost });
  }

  const next = {
    turn: state.turn + 1,
    firstTurn: state.firstTurn ?? 1,
    maxTurns: state.maxTurns,
    winner: -1,
    owner,
    troops,
    forts,
    factories,
    industry,
    alive: NATIONS.map(() => 0),
    faction: state.faction.slice(),
    offers: state.offers.slice(),
    rules: { ...(state.rules ?? DEFAULT_RULES) },
    bonus: (state.bonus ?? NATIONS.map(() => 0)).slice(),
  };
  for (const nation of NATIONS) {
    next.alive[nation] = provinceCount(next, nation) > 0 ? 1 : 0;
    next.industry[nation] = next.alive[nation]
      ? Math.max(0, next.industry[nation]) + income(map, next, nation)
      : 0;
  }
  for (const gift of aid) if (next.alive[gift.b]) next.industry[gift.b] += gift.amount;
  const diplomacy = [...aid, ...resolveDiplomacy(map, state, next, ordersByNation)];
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
      diplomacy,
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
  if (!next.rules.events || relativeTurn(next) < 3 || rng() > EVENT_CHANCE) return null;
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
