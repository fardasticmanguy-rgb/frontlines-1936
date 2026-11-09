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

export const ARMOR_COST = 2;
export const ARMOR_ATTACK = [3, 2, 1.25];
export const ARMOR_DEFENSE = 1.5;
export const ARMOR_PER_FACTORY = 2;
export const GUN_COST = 2;
export const GUN_ATTACK = 2.5;
export const GUN_DEFENSE = 2;
export const RAIL_RANGE = 4;
export const FLANK_BONUS = 0.1;
export const MAX_FLANK = 0.3;
export const POCKET_SURRENDER = 3;

export const KEEP_OFFER = -2;
export const DEFAULT_RULES = Object.freeze({ winter: 1, events: 1 });

export function emptyOrders() {
  return {
    moves: [],
    recruits: {},
    tanks: {},
    artillery: {},
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
    armor: new Array(count).fill(0),
    guns: new Array(count).fill(0),
    siege: new Array(count).fill(0),
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
    if (map.start.armor) state.armor = map.start.armor.map((a, i) => Math.min(a, state.troops[i]));
    if (map.start.guns) {
      state.guns = map.start.guns.map((g, i) => Math.min(g, state.troops[i] - state.armor[i]));
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

export function armorOf(state) {
  if (!state.armor) state.armor = state.troops.map(() => 0);
  return state.armor;
}

export function gunsOf(state) {
  if (!state.guns) state.guns = state.troops.map(() => 0);
  return state.guns;
}

export function siegeOf(state) {
  if (!state.siege) state.siege = state.troops.map(() => 0);
  return state.siege;
}

export function armorAttack(terrain = 0) {
  return ARMOR_ATTACK[terrain] ?? 1;
}

function attackUnits(count, armor, guns, terrain) {
  const tanks = Math.min(armor, count);
  const artillery = Math.min(guns, count - tanks);
  return count + tanks * (armorAttack(terrain) - 1) + artillery * (GUN_ATTACK - 1);
}

function holdUnits(count, armor, guns) {
  const tanks = Math.min(armor, count);
  const artillery = Math.min(guns, count - tanks);
  return count + tanks * (ARMOR_DEFENSE - 1) + artillery * (GUN_DEFENSE - 1);
}

export function attackStrength(state, nation, count, armor = 0, terrain = 0, guns = 0) {
  return attackUnits(count, armor, guns, terrain) * attackMultiplier(state, nation);
}

export function flankBonus(directions) {
  return Math.min(MAX_FLANK, Math.max(0, directions - 1) * FLANK_BONUS);
}

export function specialCap(state, nation) {
  return factoryCount(state, nation) * ARMOR_PER_FACTORY;
}

export function maxTanks(state, id) {
  const nation = state.owner[id];
  return nation >= 0 ? specialCap(state, nation) : 0;
}

export function canDeploy(map, state, nation, id) {
  const p = map.provinces[id];
  return Boolean(p && p.land && state.owner[id] === nation && isSupplied(map, state, id));
}

export function railPath(map, state, nation, from, to) {
  const { provinces } = map;
  if (from === to || !provinces[from] || !provinces[to]) return null;
  if (provinces[from].neighbors.includes(to)) return [from, to];
  if (state.owner[to] !== nation) return null;
  const previous = new Map([[from, -1]]);
  let frontier = [from];
  for (let step = 0; step < RAIL_RANGE && frontier.length; step++) {
    const next = [];
    for (const id of frontier) {
      for (const n of provinces[id].neighbors) {
        if (previous.has(n) || state.owner[n] !== nation || !provinces[n].land) continue;
        previous.set(n, id);
        if (n === to) {
          const path = [to];
          for (let at = id; at !== -1; at = previous.get(at)) path.unshift(at);
          return path;
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

export function canReach(map, state, nation, from, to) {
  return railPath(map, state, nation, from, to) !== null;
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
  const units = holdUnits(state.troops[id], armorOf(state)[id], gunsOf(state)[id]);
  return units * defenseMultiplier(map, state, id);
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

export function armorCount(state, nation) {
  const armor = armorOf(state);
  return state.owner.reduce((sum, o, i) => (o === nation ? sum + armor[i] : sum), 0);
}

export function factoryCount(state, nation) {
  return state.owner.reduce((sum, o, i) => (o === nation ? sum + state.factories[i] : sum), 0);
}

export function ordersCost(orders, nation, state) {
  let cost = 0;
  for (const id in orders.recruits) cost += orders.recruits[id];
  for (const id in orders.tanks ?? {}) cost += orders.tanks[id] * ARMOR_COST;
  for (const id in orders.artillery ?? {}) cost += orders.artillery[id] * GUN_COST;
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
    if (!canDeploy(map, state, nation, id)) continue;
    const count = Math.min(Math.floor(Number(orders.recruits[key]) || 0), budget, MAX_RECRUITS);
    if (count <= 0) continue;
    budget -= count;
    clean.recruits[id] = count;
  }

  let cap = specialCap(state, nation);
  for (const [key, cost] of [
    ["tanks", ARMOR_COST],
    ["artillery", GUN_COST],
  ]) {
    for (const entry in orders[key] || {}) {
      const id = Number(entry);
      if (!canDeploy(map, state, nation, id)) continue;
      const count = Math.min(Math.floor(Number(orders[key][entry]) || 0), Math.floor(budget / cost), cap);
      if (count <= 0) continue;
      budget -= count * cost;
      cap -= count;
      clean[key][id] = count;
    }
  }

  const armor = armorOf(state);
  const guns = gunsOf(state);
  const usedInfantry = {};
  const usedArmor = {};
  const usedGuns = {};
  for (const move of orders.moves || []) {
    const from = Math.floor(Number(move.from));
    const to = Math.floor(Number(move.to));
    if (!owns(from) || !provinces[to] || !provinces[to].land) continue;
    if (areAllied(state, nation, state.owner[to])) continue;
    if (!canReach(map, state, nation, from, to)) continue;
    const freeArmor = armor[from] - (usedArmor[from] || 0);
    const freeGuns = guns[from] - (usedGuns[from] || 0);
    const freeInfantry = state.troops[from] - armor[from] - guns[from] - (usedInfantry[from] || 0);
    const wanted = Math.max(0, Math.floor(Number(move.count) || 0));
    const tanks = Math.max(0, Math.min(Math.floor(Number(move.armor) || 0), freeArmor, wanted));
    const artillery = Math.max(0, Math.min(Math.floor(Number(move.guns) || 0), freeGuns, wanted - tanks));
    const infantry = Math.max(0, Math.min(wanted - tanks - artillery, freeInfantry));
    if (tanks + artillery + infantry <= 0) continue;
    usedArmor[from] = (usedArmor[from] || 0) + tanks;
    usedGuns[from] = (usedGuns[from] || 0) + artillery;
    usedInfantry[from] = (usedInfantry[from] || 0) + infantry;
    clean.moves.push({ from, to, count: tanks + artillery + infantry, armor: tanks, guns: artillery });
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

function shareKit(armor, guns, count, survivors) {
  if (count <= 0 || survivors <= 0) return [0, 0];
  const keep = (units) => Math.max(0, units - Math.round(((count - survivors) * units * 0.5) / count));
  let tanks = keep(armor);
  let artillery = keep(guns);
  artillery = Math.min(artillery, survivors - Math.min(tanks, survivors));
  tanks = Math.min(tanks, survivors - artillery);
  return [tanks, artillery];
}

function settleHeadOnClashes(moves, state) {
  for (const a of moves) {
    for (const b of moves) {
      if (a === b || a.nation === b.nation || a.count <= 0 || b.count <= 0) continue;
      if (a.from !== b.to || a.to !== b.from) continue;
      const sa = attackStrength(state, a.nation, a.count, a.armor, 0, a.guns);
      const sb = attackStrength(state, b.nation, b.count, b.armor, 0, b.guns);
      const ca = survivorsOf(a.count, sa, sb);
      const cb = survivorsOf(b.count, sb, sa);
      [a.armor, a.guns] = shareKit(a.armor, a.guns, a.count, ca);
      [b.armor, b.guns] = shareKit(b.armor, b.guns, b.count, cb);
      a.count = ca;
      b.count = cb;
      if (a.count === 0) a.stop = 0.5;
      if (b.count === 0) b.stop = 0.5;
    }
  }
}

function fightBattles(map, state, moves, owner, troops, armor, guns) {
  const incoming = map.provinces.map(() => NATIONS.map(() => 0));
  const incomingArmor = map.provinces.map(() => NATIONS.map(() => 0));
  const incomingGuns = map.provinces.map(() => NATIONS.map(() => 0));
  const sources = map.provinces.map(() => NATIONS.map(() => null));
  for (const m of moves) {
    if (m.count <= 0) continue;
    incoming[m.to][m.nation] += m.count;
    incomingArmor[m.to][m.nation] += m.armor;
    incomingGuns[m.to][m.nation] += m.guns;
    (sources[m.to][m.nation] ??= new Set()).add(m.from);
  }

  const battles = [];
  const captures = [];

  for (const p of map.provinces) {
    const id = p.id;
    if (!p.land || !incoming[id].some((n) => n > 0)) continue;
    const holder = owner[id];
    const multiplier = defenseMultiplier(map, state, id);

    const sides = new Map();
    const join = (side, nation, count, strength, tanks, artillery, from, home) => {
      const entry = sides.get(side) ?? {
        count: 0,
        armor: 0,
        guns: 0,
        strength: 0,
        hold: 0,
        sources: new Set(),
        lead: nation,
        leadStrength: -1,
        holder: false,
      };
      entry.count += count;
      entry.armor += tanks;
      entry.guns += artillery;
      if (home) entry.hold += strength;
      else entry.strength += strength;
      for (const source of from ?? []) entry.sources.add(source);
      if (strength > entry.leadStrength) {
        entry.lead = nation;
        entry.leadStrength = strength;
      }
      if (nation === holder) entry.holder = true;
      sides.set(side, entry);
    };
    for (const nation of NATIONS) {
      const home = nation === holder;
      const count = incoming[id][nation] + (home ? troops[id] : 0);
      if (count <= 0) continue;
      const tanks = Math.min(count, incomingArmor[id][nation] + (home ? armor[id] : 0));
      const artillery = Math.min(count - tanks, incomingGuns[id][nation] + (home ? guns[id] : 0));
      const strength = home
        ? holdUnits(count, tanks, artillery) * multiplier
        : attackStrength(state, nation, count, tanks, p.terrain, artillery);
      const side = factionOf(state, nation);
      const key = side >= 0 ? `f${side}` : `n${nation}`;
      join(key, nation, count, strength, tanks, artillery, sources[id][nation], home);
    }
    if (holder === NEUTRAL && troops[id] > 0) {
      join("neutral", NEUTRAL, troops[id], troops[id] * multiplier, 0, 0, null, true);
    }

    const forces = [...sides.values()].map((side) => ({
      nation: side.holder ? holder : side.lead,
      count: side.count,
      armor: side.armor,
      guns: side.guns,
      strength: side.hold + side.strength * (1 + (side.holder ? 0 : flankBonus(side.sources.size))),
    }));
    if (forces.length === 1) {
      const [victor] = forces;
      if (victor.nation !== holder) captures.push({ province: id, from: holder, to: victor.nation });
      owner[id] = victor.nation;
      troops[id] = victor.count;
      armor[id] = victor.armor;
      guns[id] = victor.guns;
      continue;
    }

    forces.sort((a, b) => b.strength - a.strength || a.nation - b.nation);
    battles.push(id);
    const [victor, runnerUp] = forces;
    const survivors = survivorsOf(victor.count, victor.strength, runnerUp.strength);
    if (survivors === 0) {
      troops[id] = 0;
      armor[id] = 0;
      guns[id] = 0;
      continue;
    }
    if (victor.nation !== holder) captures.push({ province: id, from: holder, to: victor.nation });
    owner[id] = victor.nation;
    troops[id] = survivors;
    [armor[id], guns[id]] = shareKit(victor.armor, victor.guns, victor.count, survivors);
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
  const armor = armorOf(state).slice();
  const guns = gunsOf(state).slice();
  const siege = siegeOf(state).slice();
  const forts = state.forts.slice();
  const factories = state.factories.slice();
  const industry = state.industry.slice();

  const moves = [];
  for (const nation of NATIONS) {
    const orders = ordersByNation[nation];
    if (!orders || !state.alive[nation]) continue;
    for (const m of orders.moves) {
      const tanks = Math.min(m.armor || 0, m.count);
      const artillery = Math.min(m.guns || 0, m.count - tanks);
      troops[m.from] -= m.count;
      armor[m.from] -= tanks;
      guns[m.from] -= artillery;
      moves.push({
        nation,
        from: m.from,
        to: m.to,
        count: m.count,
        armor: tanks,
        guns: artillery,
        sent: m.count,
        stop: 1,
      });
    }
  }

  settleHeadOnClashes(moves, state);
  const { battles, captures } = fightBattles(map, state, moves, owner, troops, armor, guns);
  for (const c of captures) siege[c.province] = 0;
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
    for (const key in orders.tanks ?? {}) {
      const id = Number(key);
      industry[nation] -= orders.tanks[key] * ARMOR_COST;
      if (owner[id] !== nation) continue;
      troops[id] += orders.tanks[key];
      armor[id] += orders.tanks[key];
    }
    for (const key in orders.artillery ?? {}) {
      const id = Number(key);
      industry[nation] -= orders.artillery[key] * GUN_COST;
      if (owner[id] !== nation) continue;
      troops[id] += orders.artillery[key];
      guns[id] += orders.artillery[key];
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
    if (!p.land || owner[p.id] === NEUTRAL || supplied[p.id]) {
      siege[p.id] = 0;
      continue;
    }
    siege[p.id]++;
    if (troops[p.id] <= 0) continue;
    const surrender = siege[p.id] >= POCKET_SURRENDER;
    const rate = Math.min(0.6, 0.15 + 0.1 * siege[p.id]);
    const lost = surrender ? troops[p.id] : Math.max(1, Math.floor(troops[p.id] * rate));
    const left = troops[p.id] - lost;
    armor[p.id] = Math.min(left, armor[p.id] - Math.round((armor[p.id] * lost) / troops[p.id]));
    guns[p.id] = Math.min(left - armor[p.id], guns[p.id] - Math.round((guns[p.id] * lost) / troops[p.id]));
    armor[p.id] = Math.max(0, armor[p.id]);
    guns[p.id] = Math.max(0, guns[p.id]);
    troops[p.id] = left;
    attrition.push({ province: p.id, lost, surrender: surrender ? 1 : 0 });
  }

  const next = {
    turn: state.turn + 1,
    firstTurn: state.firstTurn ?? 1,
    maxTurns: state.maxTurns,
    winner: -1,
    owner,
    troops,
    armor,
    guns,
    siege,
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
    armorOf(next)[province] = Math.min(next.armor[province], next.troops[province]);
    gunsOf(next)[province] = Math.min(next.guns[province], next.troops[province] - next.armor[province]);
    return { kind, nation: leader, province, amount };
  }
  for (const n of alive) next.industry[n] += 2;
  return { kind, nation: NEUTRAL, province: -1, amount: 2 };
}
