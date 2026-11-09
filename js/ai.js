import { BUILDING, NATIONS, NEUTRAL } from "./config.js";
import {
  KEEP_OFFER,
  attackMultiplier,
  blocOf,
  buildCostAt,
  canBuild,
  defenseMultiplier,
  divisionCount,
  emptyOrders,
  factionCap,
  factionMembers,
  factionOf,
  factoryCount,
  isHostile,
  provinceCount,
  relativeTurn,
  supplyNetwork,
  victoryPoints,
} from "./rules.js";

export const DIFFICULTIES = {
  easy: { label: "EASY", margin: 2, attacks: 1, spend: 0.7, factories: -1, reserve: 0.8, bonus: -20 },
  normal: { label: "NORMAL", margin: 0, attacks: Infinity, spend: 1, factories: 0, reserve: 0.5, bonus: 0 },
  hard: { label: "HARD", margin: 0, attacks: Infinity, spend: 1, factories: 1, reserve: 0.4, bonus: 40 },
};

function planDiplomacy(map, state, nation) {
  const plan = { offer: KEEP_OFFER, breakAlliance: 0 };
  const alive = NATIONS.filter((n) => state.alive[n]);
  const points = NATIONS.map((n) => victoryPoints(map, state, n));
  const power = (n) => points[n] * 3 + provinceCount(state, n) + divisionCount(state, n) * 0.25;
  const blocPower = (n) => blocOf(state, n).reduce((sum, m) => sum + power(m), 0);
  const cap = factionCap(map);
  const roomIn = (n) => factionOf(state, n) < 0 || factionMembers(state, factionOf(state, n)).length < cap;
  const others = alive.filter((n) => n !== nation);

  if (factionOf(state, nation) >= 0) {
    const members = blocOf(state, nation);
    const partners = members.filter((n) => n !== nation);
    const outsiders = others.filter((n) => !members.includes(n));
    const rival = Math.max(0, ...outsiders.map(blocPower));
    const strongestPartner = Math.max(0, ...partners.map(power));
    const runaway = strongestPartner > power(nation) * 1.6 && strongestPartner > rival;
    const threatGone = rival < Math.max(...members.map(power)) * 0.8;
    const backstab =
      state.turn >= state.maxTurns && others.every((n) => points[nation] > points[n]) && outsiders.length > 0;
    if (runaway || threatGone || backstab) return { ...plan, breakAlliance: 1 };

    const ours = members.reduce((sum, m) => sum + power(m), 0);
    const requester = alive.find(
      (n) => factionOf(state, n) < 0 && state.offers[n] === nation && power(n) <= rival * 1.3,
    );
    if (requester !== undefined && members.length < cap && ours + power(requester) <= rival * 2.2) {
      plan.offer = requester;
    }
    const needy = partners.slice().sort((a, b) => power(a) - power(b) || a - b)[0];
    if (needy !== undefined && state.industry[nation] >= 14 && power(needy) < power(nation) * 0.7) {
      plan.aidTo = needy;
      plan.aidAmount = Math.min(6, Math.floor(state.industry[nation] * 0.25));
    }
    return plan;
  }

  const strongest = Math.max(0, ...others.map(blocPower));
  if (strongest < power(nation) * 1.25) return { ...plan, offer: NEUTRAL };
  const leader = others.slice().sort((a, b) => blocPower(b) - blocPower(a) || a - b)[0];
  const leaderBloc = blocOf(state, leader);
  const candidates = others.filter((n) => !leaderBloc.includes(n) && roomIn(n));
  const suitor = candidates.find((n) => state.offers[n] === nation);
  if (suitor !== undefined) return { ...plan, offer: suitor };
  const partner = candidates.sort((a, b) => blocPower(b) - blocPower(a) || a - b)[0];
  return { ...plan, offer: partner ?? NEUTRAL };
}

function encirclementGain(map, state, nation, target) {
  const enemy = state.owner[target];
  if (enemy === NEUTRAL) return 0;
  const owner = state.owner.slice();
  owner[target] = nation;
  const before = supplyNetwork(map, state);
  const after = supplyNetwork(map, { owner, faction: state.faction });
  let cut = 0;
  for (const p of map.provinces) {
    if (owner[p.id] === enemy && before[p.id] && !after[p.id]) cut += 1 + state.troops[p.id] * 0.15;
  }
  return cut;
}

function frontDistances(provinces, owns, friendly, mine) {
  const distance = new Array(provinces.length).fill(Infinity);
  const queue = [];
  for (const id of mine) {
    if (provinces[id].neighbors.some((n) => provinces[n].land && !friendly(n))) {
      distance[id] = 1;
      queue.push(id);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    for (const n of provinces[id].neighbors) {
      if (owns(n) && distance[n] > distance[id] + 1) {
        distance[n] = distance[id] + 1;
        queue.push(n);
      }
    }
  }
  return distance;
}

export function planAiOrders(map, state, nation, difficulty = "normal") {
  const level = DIFFICULTIES[difficulty] ?? DIFFICULTIES.normal;
  const orders = emptyOrders();
  if (!state.alive[nation]) return orders;
  Object.assign(orders, planDiplomacy(map, state, nation));

  const { provinces } = map;
  const owns = (id) => state.owner[id] === nation;
  const friendly = (id) => owns(id) || !isHostile(state, nation, state.owner[id]);
  const mine = provinces.filter((p) => p.land && owns(p.id)).map((p) => p.id);
  const threat = (id) =>
    provinces[id].neighbors.reduce((max, n) => {
      const other = state.owner[n];
      return provinces[n].land && other !== NEUTRAL && isHostile(state, nation, other)
        ? Math.max(max, state.troops[n])
        : max;
    }, 0);
  const distance = frontDistances(provinces, owns, friendly, mine);
  const lateGame = state.turn > state.maxTurns - 4;
  let budget = Math.floor(state.industry[nation] * level.spend) - (orders.aidAmount || 0);

  const cities = mine.filter((id) => provinces[id].city);
  const factories = factoryCount(state, nation);
  const age = relativeTurn(state);
  const factoryTarget = (age < 6 ? 2 : age < 10 ? 4 : 5) + level.factories;
  const attack = attackMultiplier(state, nation);
  if (!lateGame && factories < factoryTarget) {
    const site = cities
      .filter((id) => canBuild(map, state, nation, id, BUILDING.FACTORY) && threat(id) <= state.troops[id])
      .sort((a, b) => distance[b] - distance[a] || state.factories[b] - state.factories[a] || a - b)[0];
    const cost = site === undefined ? Infinity : buildCostAt(state, nation, site, BUILDING.FACTORY);
    if (budget >= cost + 4) {
      orders.builds[site] = BUILDING.FACTORY;
      budget -= cost;
    }
  }

  for (const id of cities) {
    if (!canBuild(map, state, nation, id, BUILDING.FORT) || orders.builds[id]) continue;
    const exposed = threat(id) > state.troops[id] * defenseMultiplier(map, state, id);
    const cost = buildCostAt(state, nation, id, BUILDING.FORT);
    if (exposed && budget >= cost + 3) {
      orders.builds[id] = BUILDING.FORT;
      budget -= cost;
      break;
    }
  }

  while (budget > 0 && cities.length) {
    let neediest = cities[0];
    let bestNeed = -Infinity;
    for (const id of cities) {
      const garrison = state.troops[id] + (orders.recruits[id] || 0);
      const need = threat(id) * 1.3 - garrison - Math.min(distance[id], 9) * 2;
      if (need > bestNeed) {
        bestNeed = need;
        neediest = id;
      }
    }
    orders.recruits[neediest] = (orders.recruits[neediest] || 0) + 1;
    budget--;
  }

  const available = {};
  const reserve = {};
  for (const id of mine) {
    available[id] = state.troops[id];
    reserve[id] = Math.min(available[id], Math.ceil(threat(id) * (lateGame ? 0.32 : level.reserve)));
  }
  const spare = (id) => available[id] - reserve[id];

  const targets = new Set();
  for (const id of mine) {
    for (const n of provinces[id].neighbors) if (provinces[n].land && !friendly(n)) targets.add(n);
  }

  const plans = [...targets]
    .map((target) => {
      const enemy = state.owner[target] !== NEUTRAL;
      const defense = state.troops[target] * defenseMultiplier(map, state, target);
      const need = Math.max(
        1,
        Math.ceil((defense + (enemy ? state.troops[target] * 0.35 + 1 : 0)) / attack) + 1 + level.margin,
      );
      const value =
        (provinces[target].city ? 5 : 1) +
        (provinces[target].capitalOf >= 0 ? 8 : 0) +
        (enemy ? 1.5 : 0.5) +
        encirclementGain(map, state, nation, target) -
        need * 0.15;
      return { target, need, enemy, value };
    })
    .sort((a, b) => b.value - a.value || a.target - b.target);

  let launched = 0;
  for (const plan of plans) {
    if (launched >= level.attacks) break;
    const sources = provinces[plan.target].neighbors
      .filter((id) => owns(id) && spare(id) > 0)
      .sort((a, b) => spare(b) - spare(a) || a - b);
    const total = sources.reduce((sum, id) => sum + spare(id), 0);
    if (total < plan.need) continue;

    launched++;
    let remaining = plan.need + (plan.enemy ? 2 : 0);
    for (const id of sources) {
      if (remaining <= 0) break;
      const count = Math.min(spare(id), remaining);
      if (count <= 0) continue;
      orders.moves.push({ from: id, to: plan.target, count });
      available[id] -= count;
      remaining -= count;
    }
  }

  for (const id of mine) {
    if (distance[id] <= 1 || distance[id] === Infinity || available[id] <= 0) continue;
    const step = provinces[id].neighbors
      .filter((n) => owns(n) && distance[n] < distance[id])
      .sort((a, b) => distance[a] - distance[b] || threat(b) - threat(a) || a - b)[0];
    if (step === undefined) continue;
    orders.moves.push({ from: id, to: step, count: available[id] });
    available[id] = 0;
  }

  return orders;
}
