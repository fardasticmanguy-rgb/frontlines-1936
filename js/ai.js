import { BUILDING, NATIONS, NEUTRAL } from "./config.js";
import {
  ARMOR_COST,
  ARMOR_DEFENSE,
  GUN_ATTACK,
  GUN_COST,
  GUN_DEFENSE,
  FACTORY_OUTPUT,
  KEEP_OFFER,
  RAIL_RANGE,
  armorOf,
  attackStrength,
  blocOf,
  blocPoints,
  buildCostAt,
  canBuild,
  defenseMultiplier,
  defenseStrength,
  divisionCount,
  emptyOrders,
  factionCap,
  factionMembers,
  factionOf,
  factoryCount,
  income,
  isHostile,
  specialCap,
  flankBonus,
  gunsOf,
  armorAttack,
  provinceCount,
  relativeTurn,
  resolveTurn,
  sanitizeOrders,
  supplyNetwork,
  victoryPoints,
} from "./rules.js";

export const DIFFICULTIES = {
  easy: {
    label: "EASY",
    margin: 1.6,
    attacks: 2,
    spend: 0.75,
    factories: -1,
    reserve: 0.9,
    bonus: -20,
    candidates: 0,
    tanks: 0.1,
    rail: false,
  },
  normal: {
    label: "NORMAL",
    margin: 1.08,
    attacks: Infinity,
    spend: 1,
    factories: 0,
    reserve: 0.55,
    bonus: 0,
    candidates: 2,
    tanks: 0.25,
    rail: true,
  },
  hard: {
    label: "HARD",
    margin: 1.08,
    attacks: Infinity,
    spend: 1,
    factories: 1,
    reserve: 0.55,
    bonus: 40,
    candidates: 6,
    tanks: 0.35,
    rail: true,
  },
};

const STYLE = { aggression: 1, reserve: 1, focus: 1.6, neutral: 1, capital: 1 };

function power(map, state, n) {
  return victoryPoints(map, state, n) * 3 + provinceCount(state, n) + divisionCount(state, n) * 0.25;
}

function planDiplomacy(map, state, nation) {
  const plan = { offer: KEEP_OFFER, breakAlliance: 0 };
  const alive = NATIONS.filter((n) => state.alive[n]);
  const points = NATIONS.map((n) => victoryPoints(map, state, n));
  const strength = NATIONS.map((n) => (state.alive[n] ? power(map, state, n) : 0));
  const blocPower = (n) => blocOf(state, n).reduce((sum, m) => sum + strength[m], 0);
  const cap = factionCap(map);
  const roomIn = (n) => factionOf(state, n) < 0 || factionMembers(state, factionOf(state, n)).length < cap;
  const others = alive.filter((n) => n !== nation);

  if (factionOf(state, nation) >= 0) {
    const members = blocOf(state, nation);
    const partners = members.filter((n) => n !== nation);
    const outsiders = others.filter((n) => !members.includes(n));
    const rival = Math.max(0, ...outsiders.map(blocPower));
    const strongestPartner = Math.max(0, ...partners.map((n) => strength[n]));
    const runaway = strongestPartner > strength[nation] * 1.8 && strongestPartner > rival;
    const threatGone = rival < Math.max(...members.map((n) => strength[n])) * 0.7;
    const backstab =
      state.turn >= state.maxTurns && others.every((n) => points[nation] > points[n]) && outsiders.length > 0;
    if (runaway || threatGone || backstab) return { ...plan, breakAlliance: 1 };

    const ours = members.reduce((sum, m) => sum + strength[m], 0);
    const requester = alive.find(
      (n) => factionOf(state, n) < 0 && state.offers[n] === nation && strength[n] <= rival * 1.3,
    );
    if (requester !== undefined && members.length < cap && ours + strength[requester] <= rival * 2.2) {
      plan.offer = requester;
    }
    const needy = partners.slice().sort((a, b) => strength[a] - strength[b] || a - b)[0];
    if (needy !== undefined && state.industry[nation] >= 14 && strength[needy] < strength[nation] * 0.7) {
      plan.aidTo = needy;
      plan.aidAmount = Math.min(6, Math.floor(state.industry[nation] * 0.25));
    }
    return plan;
  }

  const strongest = Math.max(0, ...others.map(blocPower));
  if (strongest < strength[nation] * 1.25) return { ...plan, offer: NEUTRAL };
  const leader = others.slice().sort((a, b) => blocPower(b) - blocPower(a) || a - b)[0];
  const leaderBloc = blocOf(state, leader);
  const candidates = others.filter((n) => !leaderBloc.includes(n) && roomIn(n));
  const suitor = candidates.find((n) => state.offers[n] === nation);
  if (suitor !== undefined) return { ...plan, offer: suitor };
  const partner = candidates.sort((a, b) => blocPower(b) - blocPower(a) || a - b)[0];
  return { ...plan, offer: partner ?? NEUTRAL };
}

function nationSupply(map, owner, faction, nation) {
  const { provinces } = map;
  const side = faction[nation];
  const passable = (id) =>
    owner[id] === nation || (side >= 0 && owner[id] >= 0 && faction[owner[id]] === side);
  const reached = new Uint8Array(provinces.length);
  const queue = [];
  for (const p of provinces) {
    if (p.land && p.city && owner[p.id] === nation) {
      reached[p.id] = 1;
      queue.push(p.id);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    for (const n of provinces[queue[head]].neighbors) {
      if (!reached[n] && passable(n)) {
        reached[n] = 1;
        queue.push(n);
      }
    }
  }
  return reached;
}

function encirclementGain(map, state, nation, target, before) {
  const enemy = state.owner[target];
  if (enemy === NEUTRAL) return 0;
  const owner = state.owner.slice();
  owner[target] = nation;
  const after = nationSupply(map, owner, state.faction, enemy);
  let cut = 0;
  for (const p of map.provinces) {
    if (owner[p.id] === enemy && before[p.id] && !after[p.id]) cut += 1 + state.troops[p.id] * 0.2;
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

function railReach(provinces, owns, from) {
  const reach = new Map([[from, 0]]);
  let frontier = [from];
  for (let step = 1; step <= RAIL_RANGE && frontier.length; step++) {
    const next = [];
    for (const id of frontier) {
      for (const n of provinces[id].neighbors) {
        if (reach.has(n) || !owns(n) || !provinces[n].land) continue;
        reach.set(n, step);
        next.push(n);
      }
    }
    frontier = next;
  }
  reach.delete(from);
  return reach;
}

function threatMap(map, state, nation, memo = null) {
  const { provinces } = map;
  const armor = armorOf(state);
  return provinces.map((p) => {
    if (!p.land || state.owner[p.id] !== nation) return 0;
    const guard = memo?.guard.get(p.id) ?? 0;
    const pushes = [];
    for (const n of p.neighbors) {
      const other = state.owner[n];
      if (!provinces[n].land || other === NEUTRAL || !isHostile(state, nation, other)) continue;
      pushes.push(attackStrength(state, other, state.troops[n], armor[n], p.terrain, gunsOf(state)[n]));
    }
    if (!pushes.length) return guard;
    pushes.sort((a, b) => b - a);
    return guard + pushes[0] + pushes.slice(1).reduce((sum, v) => sum + v * 0.45, 0);
  });
}

function pickFocus(map, state, nation, mine) {
  const { provinces } = map;
  const contact = new Map();
  for (const id of mine) {
    for (const n of provinces[id].neighbors) {
      const other = state.owner[n];
      if (!provinces[n].land || other === NEUTRAL || !isHostile(state, nation, other)) continue;
      contact.set(other, (contact.get(other) ?? 0) + 1);
    }
  }
  let best = NEUTRAL;
  let bestScore = -Infinity;
  const ours = power(map, state, nation);
  for (const [enemy, borders] of contact) {
    const theirs = blocOf(state, enemy).reduce((sum, n) => sum + power(map, state, n), 0);
    const score = borders * 0.5 + (ours / Math.max(1, theirs)) * 4 + victoryPoints(map, state, enemy) * 0.2;
    if (score > bestScore) {
      bestScore = score;
      best = enemy;
    }
  }
  return best;
}

function planEconomy(map, state, nation, level, orders, context, funds = null) {
  const { provinces } = map;
  const { cities, threat, distance, turnsLeft } = context;
  let budget = funds ?? Math.floor(state.industry[nation] * level.spend) - (orders.aidAmount || 0);

  const scale = map.incomeScale ?? 1;
  const factories = factoryCount(state, nation);
  const factoryCap = 2 + Math.floor(relativeTurn(state) / 3) + level.factories * 2;
  if (factories < factoryCap) {
    const sites = cities
      .filter((id) => canBuild(map, state, nation, id, BUILDING.FACTORY) && threat[id] <= state.troops[id])
      .sort((a, b) => distance[b] - distance[a] || state.factories[b] - state.factories[a] || a - b);
    const builds = level.factories > 0 && state.industry[nation] > 30 ? 2 : 1;
    for (const site of sites.slice(0, builds)) {
      const cost = buildCostAt(state, nation, site, BUILDING.FACTORY);
      const payoff = (turnsLeft - 1) * FACTORY_OUTPUT * scale;
      if (payoff < cost * 1.4 || budget < cost + 3) break;
      orders.builds[site] = BUILDING.FACTORY;
      budget -= cost;
    }
  }

  const exposed = cities
    .filter((id) => canBuild(map, state, nation, id, BUILDING.FORT) && !orders.builds[id])
    .map((id) => ({ id, gap: threat[id] - defenseStrength(map, state, id) }))
    .filter((c) => c.gap > 0)
    .sort((a, b) => (provinces[b.id].capitalOf >= 0) - (provinces[a.id].capitalOf >= 0) || b.gap - a.gap)[0];
  if (exposed && turnsLeft > 2) {
    const cost = buildCostAt(state, nation, exposed.id, BUILDING.FORT);
    if (budget >= cost + 3) {
      orders.builds[exposed.id] = BUILDING.FORT;
      budget -= cost;
    }
  }

  const { mine, friendly } = context;
  const supplied = supplyNetwork(map, state);
  const deployable = mine.filter((id) => supplied[id]);
  let open = 0;
  let fronts = 0;
  let pressure = 0;
  for (const id of mine) {
    pressure += Math.max(0, threat[id] - defenseStrength(map, state, id));
    for (const n of provinces[id].neighbors) {
      if (!provinces[n].land || friendly(n)) continue;
      fronts++;
      if (provinces[n].terrain === 0) open++;
    }
  }
  const openShare = fronts ? open / fronts : 0;
  const calm = pressure < state.industry[nation] * 0.5;
  const heavy = Math.min(specialCap(state, nation), Math.floor((budget * (0.3 + level.tanks)) / 2));
  const tankCount = calm && openShare > 0.4 ? Math.round(heavy * openShare * 0.8) : 0;
  const gunCount = heavy - tankCount;
  const gap = (id) => threat[id] - defenseStrength(map, state, id);
  const stages = deployable.filter((id) => distance[id] <= 1).sort((a, b) => gap(b) - gap(a) || a - b);
  const stage = (k) => stages[k % Math.max(1, Math.min(8, stages.length))] ?? deployable[0];
  for (let k = 0; k < tankCount; k++) {
    const id = stage(k);
    if (id === undefined || budget < ARMOR_COST) break;
    orders.tanks[id] = (orders.tanks[id] || 0) + 1;
    budget -= ARMOR_COST;
  }
  for (let k = 0; k < gunCount; k++) {
    const id = stage(k);
    if (id === undefined || budget < GUN_COST) break;
    orders.artillery[id] = (orders.artillery[id] || 0) + 1;
    budget -= GUN_COST;
  }

  const added = {};
  const sites = deployable.length ? deployable : cities;
  while (budget > 0 && sites.length) {
    let neediest = sites[0];
    let bestNeed = -Infinity;
    for (const id of sites) {
      const garrison =
        state.troops[id] +
        (added[id] || 0) +
        (orders.tanks[id] || 0) * ARMOR_DEFENSE +
        (orders.artillery[id] || 0) * GUN_DEFENSE;
      const need =
        (threat[id] * 1.25) / Math.max(0.5, defenseMultiplier(map, state, id)) -
        garrison -
        Math.min(distance[id], 9) * 1.5 +
        (provinces[id].capitalOf >= 0 ? 2 : 0);
      if (need > bestNeed) {
        bestNeed = need;
        neediest = id;
      }
    }
    added[neediest] = (added[neediest] || 0) + 1;
    budget--;
  }
  for (const id in added) orders.recruits[id] = added[id];
}

const KINDS = ["armor", "guns", "infantry"];

function unitValue(kind, terrain) {
  if (kind === "armor") return armorAttack(terrain);
  if (kind === "guns") return GUN_ATTACK;
  return 1;
}

function sendStrength(state, nation, kit, terrain) {
  const count = kit.armor + kit.guns + kit.infantry;
  return attackStrength(state, nation, count, kit.armor, terrain, kit.guns);
}

function planMilitary(map, state, nation, level, style, orders, context) {
  const { provinces } = map;
  const armor = armorOf(state);
  const guns = gunsOf(state);
  const { mine, owns, friendly, threat, distance, lateGame } = context;
  const focus = pickFocus(map, state, nation, mine);
  const supplied = supplyNetwork(map, state);

  const pool = {};
  const reserve = {};
  for (const id of mine) {
    const armored = armor[id];
    const artillery = Math.min(guns[id], state.troops[id] - armored);
    pool[id] = { armor: armored, guns: artillery, infantry: state.troops[id] - armored - artillery };
    const holdFactor = (lateGame ? 0.45 : level.reserve) * style.reserve;
    const multiplier = Math.max(0.5, defenseMultiplier(map, state, id));
    const wanted = Math.ceil((threat[id] * holdFactor) / multiplier);
    reserve[id] = Math.min(
      state.troops[id],
      wanted + (provinces[id].capitalOf >= 0 && threat[id] > 0 ? 1 : 0),
    );
  }
  const total = (id) => pool[id].armor + pool[id].guns + pool[id].infantry;
  const spare = (id) => total(id) - reserve[id];
  const pocketed = new Set(mine.filter((id) => !supplied[id]));

  const targets = new Set();
  for (const id of mine) {
    for (const n of provinces[id].neighbors) if (provinces[n].land && !friendly(n)) targets.add(n);
  }

  const plans = [...targets].map((target) => {
    const p = provinces[target];
    const holder = state.owner[target];
    const enemy = holder !== NEUTRAL;
    const defense = defenseStrength(map, state, target);
    let backup = 0;
    if (enemy) {
      for (const n of p.neighbors) {
        if (state.owner[n] === holder && n !== target) backup = Math.max(backup, state.troops[n]);
      }
    }
    const reinforcement = enemy ? backup * 0.4 * defenseMultiplier(map, state, target) : 0;
    const caution = context.memo?.avoid.get(target) ?? 1;
    const need = (defense + reinforcement) * level.margin * style.aggression * caution + (enemy ? 1 : 0.5);
    const points = p.city ? (p.capitalOf >= 0 ? 3 : 1) : 0;
    let value =
      points * 6 +
      (p.capitalOf >= 0 ? 8 * style.capital : 0) +
      (state.factories[target] || 0) * 2.5 +
      (enemy ? 2 : 1.2 * style.neutral) +
      encirclementGain(map, state, nation, target, supplied) * 1.4;
    if (enemy && blocOf(state, holder).includes(focus)) value *= style.focus;
    if (enemy && !supplied[target]) value += 1.5;
    if (p.neighbors.some((n) => pocketed.has(n))) value += 4;
    if (lateGame) value += points * 5;
    return { target, need, enemy, value, terrain: p.terrain, score: value / Math.sqrt(need + 2) };
  });
  plans.sort((a, b) => b.score - a.score || a.target - b.target);

  let launched = 0;
  for (const plan of plans) {
    if (launched >= level.attacks) break;
    const sources = provinces[plan.target].neighbors
      .filter((id) => owns(id) && spare(id) > 0)
      .sort((a, b) => spare(b) - spare(a) || a - b);
    const order = KINDS.slice().sort((a, b) => unitValue(b, plan.terrain) - unitValue(a, plan.terrain));
    const flank = 1 + flankBonus(sources.length);
    const potential =
      sources.reduce((sum, id) => {
        let free = spare(id);
        const kit = { armor: 0, guns: 0, infantry: 0 };
        for (const kind of order) {
          const take = Math.min(pool[id][kind], free);
          kit[kind] = take;
          free -= take;
        }
        return sum + sendStrength(state, nation, kit, plan.terrain);
      }, 0) * flank;
    if (potential < plan.need) continue;

    launched++;
    const committed = [];
    let gathered = 0;
    const measure = () =>
      committed.reduce((sum, c) => sum + sendStrength(state, nation, c.kit, plan.terrain), 0) *
      (1 + flankBonus(committed.filter((c) => c.kit.armor + c.kit.guns + c.kit.infantry > 0).length));
    for (const id of sources) {
      if (gathered >= plan.need) break;
      const entry = { id, kit: { armor: 0, guns: 0, infantry: 0 } };
      committed.push(entry);
      let free = spare(id);
      while (free > 0 && gathered < plan.need) {
        const kind = order.find((k) => pool[id][k] - entry.kit[k] > 0);
        if (!kind) break;
        entry.kit[kind]++;
        free--;
        gathered = measure();
      }
      const overkill = plan.enemy ? Math.min(2, free) : 0;
      for (let k = 0; k < overkill; k++) {
        const kind = ["infantry", "guns", "armor"].find((name) => pool[id][name] - entry.kit[name] > 0);
        if (kind) entry.kit[kind]++;
      }
    }
    for (const { id, kit } of committed) {
      const count = kit.armor + kit.guns + kit.infantry;
      if (count <= 0) continue;
      orders.moves.push({ from: id, to: plan.target, count, armor: kit.armor, guns: kit.guns });
      for (const kind of KINDS) pool[id][kind] -= kit[kind];
    }
  }

  const deficit = (id) =>
    threat[id] * 1.1 -
    (pool[id].infantry + pool[id].armor * ARMOR_DEFENSE + pool[id].guns * GUN_DEFENSE) *
      defenseMultiplier(map, state, id);
  const staging = new Map();
  for (const plan of plans.slice(0, 6)) {
    for (const n of provinces[plan.target].neighbors) {
      if (owns(n)) staging.set(n, Math.max(staging.get(n) ?? 0, plan.value));
    }
  }

  for (const id of mine) {
    const free = total(id) - (distance[id] <= 1 ? reserve[id] : 0);
    if (free <= 0 || distance[id] === Infinity) continue;
    if (distance[id] <= 1 && deficit(id) > -2) continue;
    let destination = -1;
    let bestScore = 0;
    if (level.rail) {
      for (const [n, steps] of railReach(provinces, owns, id)) {
        if (distance[n] !== 1) continue;
        const score = Math.max(0, deficit(n)) * 1.5 + (staging.get(n) ?? 0) * 0.6 - steps * 0.4;
        if (score > bestScore) {
          bestScore = score;
          destination = n;
        }
      }
    }
    if (destination < 0 && distance[id] > 1) {
      destination =
        provinces[id].neighbors
          .filter((n) => owns(n) && distance[n] < distance[id])
          .sort((a, b) => distance[a] - distance[b] || threat[b] - threat[a] || a - b)[0] ?? -1;
    }
    if (destination < 0 || destination === id) continue;
    const sendTanks = Math.min(pool[id].armor, free);
    const sendGuns = Math.min(pool[id].guns, free - sendTanks);
    const sendInfantry = Math.min(pool[id].infantry, free - sendTanks - sendGuns);
    const count = sendTanks + sendGuns + sendInfantry;
    if (count <= 0) continue;
    orders.moves.push({ from: id, to: destination, count, armor: sendTanks, guns: sendGuns });
    pool[id].armor -= sendTanks;
    pool[id].guns -= sendGuns;
    pool[id].infantry -= sendInfantry;
  }
}

function planningContext(map, state, nation, memo) {
  const { provinces } = map;
  const owns = (id) => state.owner[id] === nation;
  const friendly = (id) => owns(id) || !isHostile(state, nation, state.owner[id]);
  const mine = provinces.filter((p) => p.land && owns(p.id)).map((p) => p.id);
  const context = {
    mine,
    owns,
    friendly,
    cities: mine.filter((id) => provinces[id].city),
    threat: threatMap(map, state, nation, memo),
    memo,
    distance: frontDistances(provinces, owns, friendly, mine),
    turnsLeft: state.maxTurns - state.turn + 1,
    lateGame: state.turn > state.maxTurns - 4,
  };
  return context;
}

export function planProduction(map, state, nation, budget) {
  const orders = emptyOrders();
  if (!state.alive[nation] || budget <= 0) return orders;
  const context = planningContext(map, state, nation, null);
  planEconomy(map, state, nation, DIFFICULTIES.normal, orders, context, budget);
  return orders;
}

function planWithStyle(map, state, nation, level, style, memo = null) {
  const orders = emptyOrders();
  if (!state.alive[nation]) return orders;
  Object.assign(orders, planDiplomacy(map, state, nation));
  const context = planningContext(map, state, nation, memo);
  planEconomy(map, state, nation, level, orders, context);
  planMilitary(map, state, nation, level, style, orders, context);
  return orders;
}

function evaluate(map, state, nation) {
  if (!state.alive[nation]) return -1e6;
  const { provinces } = map;
  const bloc = blocOf(state, nation);
  const threat = threatMap(map, state, nation);
  const supplied = supplyNetwork(map, state);
  let exposure = 0;
  let starving = 0;
  for (const p of provinces) {
    if (!p.land || state.owner[p.id] !== nation) continue;
    const gap = threat[p.id] - defenseStrength(map, state, p.id);
    if (gap > 0) exposure += gap * (p.capitalOf >= 0 ? 3 : p.city ? 1.6 : 0.6);
    if (!supplied[p.id]) starving++;
  }
  let enemies = 0;
  for (const n of NATIONS)
    if (state.alive[n] && isHostile(state, nation, n)) enemies += divisionCount(state, n);
  return (
    blocPoints(map, state, bloc) * 12 +
    provinceCount(state, nation) * 2.5 +
    divisionCount(state, nation) * 0.5 +
    income(map, state, nation) * 1 +
    state.industry[nation] * 0.2 -
    exposure * 0.4 -
    starving * 1.5 -
    enemies * 0.4
  );
}

function learn(map, before, after, nation, orders, memo) {
  const next = { avoid: new Map(memo?.avoid ?? []), guard: new Map(memo?.guard ?? []) };
  for (const m of orders.moves) {
    if (before.owner[m.to] === nation || after.owner[m.to] === nation) continue;
    next.avoid.set(m.to, (next.avoid.get(m.to) ?? 1) * 1.35);
  }
  for (const p of map.provinces) {
    if (!p.land || before.owner[p.id] !== nation || after.owner[p.id] === nation) continue;
    const pressure = defenseStrength(map, before, p.id) * 0.5 + 2;
    next.guard.set(p.id, (next.guard.get(p.id) ?? 0) + pressure);
  }
  return next;
}

export function planAiOrders(map, state, nation, difficulty = "normal") {
  const level = DIFFICULTIES[difficulty] ?? DIFFICULTIES.normal;
  if (!state.alive[nation]) return emptyOrders();
  const style = STYLE;
  let best = planWithStyle(map, state, nation, level, style);
  if (!level.candidates) return best;

  const predicted = NATIONS.map((n) =>
    n === nation || !state.alive[n]
      ? emptyOrders()
      : sanitizeOrders(map, state, n, planWithStyle(map, state, n, DIFFICULTIES.normal, style)),
  );
  const simulate = (orders) => {
    const all = predicted.slice();
    all[nation] = sanitizeOrders(map, state, nation, orders);
    return { orders: all[nation], next: resolveTurn(map, state, all).state };
  };

  let trial = simulate(best);
  let bestScore = evaluate(map, trial.next, nation);
  let memo = null;
  for (let pass = 1; pass < level.candidates; pass++) {
    memo = learn(map, state, trial.next, nation, trial.orders, memo);
    const orders = planWithStyle(map, state, nation, level, style, memo);
    trial = simulate(orders);
    const score = evaluate(map, trial.next, nation);
    if (score > bestScore) {
      bestScore = score;
      best = orders;
    }
  }
  return best;
}
