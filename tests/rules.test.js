import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { planAiOrders } from "../js/ai.js";
import { BUILDING, NATIONS, NEUTRAL, SUPPLY_DEFENSE, dateOf, isWinter } from "../js/config.js";
import { generateMap } from "../js/map.js";
import {
  RAIL_RANGE,
  WORLD_EVENTS,
  atWar,
  warPending,
  attackStrength,
  canReach,
  flankBonus,
  areAllied,
  attackMultiplier,
  relativeTurn,
  warLength,
  buildCost,
  fortBonus,
  createInitialState,
  defenseMultiplier,
  emptyOrders,
  income,
  isSupplied,
  resolveTurn,
  sanitizeOrders,
  victoryGoal,
  victoryPoints,
} from "../js/rules.js";

const map = generateMap(4242);
const { provinces } = map;
const plainCity = (p) => p.land && p.city && p.capitalOf < 0;
const [home, front, depot] = provinces
  .filter(plainCity)
  .flatMap((a) =>
    a.neighbors
      .filter((b) => provinces[b].land && !provinces[b].city && provinces[b].terrain === 0)
      .map((b) => [
        a.id,
        b,
        provinces[b].neighbors.find(
          (d) => d !== a.id && plainCity(provinces[d]) && !provinces[d].neighbors.includes(a.id),
        ),
      ]),
  )
  .find(([, , d]) => d !== undefined);

function blankState() {
  const state = createInitialState(map);
  state.owner.fill(NEUTRAL);
  state.troops.fill(0);
  state.forts.fill(0);
  state.factories.fill(0);
  state.industry = NATIONS.map(() => 50);
  state.war = NATIONS.map(() => 0xff);
  for (const n of NATIONS.slice(0, map.nationCount)) {
    state.owner[map.capitals[n]] = n;
    state.troops[map.capitals[n]] = 1;
  }
  return state;
}

function frontline(attacker, attackers, defender, defenders) {
  const state = blankState();
  Object.assign(state.owner, { [home]: attacker, [front]: defender, [depot]: defender });
  Object.assign(state.troops, { [home]: attackers, [front]: defenders });
  return state;
}

const move = (from, to, count) => ({ ...emptyOrders(), moves: [{ from, to, count }] });
const ordersFor = (entries) => NATIONS.map((n) => entries[n] || emptyOrders());

describe("resolveTurn", () => {
  test("equal armies meeting head-on destroy each other", () => {
    const state = frontline(1, 5, 3, 5);
    const { state: next } = resolveTurn(
      map,
      state,
      ordersFor({ 1: move(home, front, 5), 3: move(front, home, 5) }),
    );
    assert.equal(next.troops[home], 0);
    assert.equal(next.troops[front], 0);
    assert.equal(next.owner[home], 1);
    assert.equal(next.owner[front], 3);
  });

  test("the larger army wins a head-on clash and marches on", () => {
    const state = frontline(1, 7, 3, 3);
    const { state: next } = resolveTurn(
      map,
      state,
      ordersFor({ 1: move(home, front, 7), 3: move(front, home, 3) }),
    );
    assert.equal(next.owner[front], 1);
    assert.equal(next.troops[front], 4);
  });

  test("defenders multiply their strength", () => {
    const state = frontline(1, 9, 3, 4);
    state.forts[front] = 1;
    const defense = 4 * defenseMultiplier(map, state, front);
    const { state: next } = resolveTurn(map, state, ordersFor({ 1: move(home, front, 9) }));
    if (9 > defense) {
      assert.equal(next.owner[front], 1);
      assert.equal(next.troops[front], Math.ceil(9 - defense));
    } else {
      assert.equal(next.owner[front], 3);
    }
  });

  test("a failed attack loses the attacking army", () => {
    const state = frontline(1, 3, 3, 6);
    const { state: next } = resolveTurn(map, state, ordersFor({ 1: move(home, front, 3) }));
    assert.equal(next.owner[front], 3);
    assert.equal(next.troops[home], 0);
    assert.ok(next.troops[front] >= 1 && next.troops[front] <= 6);
  });

  test("recruits arrive after combat and cost industry", () => {
    const state = blankState();
    state.industry[0] = 10;
    const capital = map.capitals[0];
    const orders = sanitizeOrders(map, state, 0, { ...emptyOrders(), recruits: { [capital]: 4 } });
    const { state: next } = resolveTurn(map, state, [orders]);
    assert.equal(next.troops[capital], 5);
    assert.equal(next.industry[0], 6 + income(map, next, 0));
  });

  test("blitzkrieg attackers break an even defense", () => {
    const blitz = resolveTurn(map, frontline(0, 10, 1, 10), ordersFor({ 0: move(home, front, 10) })).state;
    const plain = resolveTurn(map, frontline(3, 10, 1, 10), ordersFor({ 3: move(home, front, 10) })).state;
    assert.equal(blitz.owner[front], 0);
    assert.equal(plain.owner[front], 1);
  });

  test("winter weakens attacks", () => {
    const summer = frontline(1, 10, 3, 9);
    const winter = frontline(1, 10, 3, 9);
    winter.turn = 10;
    assert.ok(isWinter(10) && !isWinter(summer.turn));
    assert.equal(resolveTurn(map, summer, ordersFor({ 1: move(home, front, 10) })).state.owner[front], 1);
    assert.equal(resolveTurn(map, winter, ordersFor({ 1: move(home, front, 10) })).state.owner[front], 3);
  });

  test("encircled provinces lose defense and suffer attrition", () => {
    const state = frontline(1, 1, 3, 8);
    state.owner[depot] = NEUTRAL;
    assert.equal(isSupplied(map, state, front), false);
    assert.equal(defenseMultiplier(map, state, front), SUPPLY_DEFENSE);
    const { state: next, events } = resolveTurn(map, state, ordersFor({}));
    assert.equal(next.troops[front], 6);
    assert.deepEqual(events.attrition, [{ province: front, lost: 2, surrender: 0 }]);
    assert.equal(next.siege[front], 1);
  });

  test("a pocket cut off for three turns surrenders", () => {
    let state = frontline(1, 1, 3, 30);
    state.owner[depot] = NEUTRAL;
    const losses = [];
    for (let turn = 0; turn < 3; turn++) {
      const result = resolveTurn(map, state, ordersFor({}));
      losses.push(result.events.attrition.find((a) => a.province === front));
      state = result.state;
    }
    assert.ok(losses[1].lost / 30 > 0.2);
    assert.equal(losses[2].surrender, 1);
    assert.equal(state.troops[front], 0);
    assert.equal(state.owner[front], 3);
  });

  test("mass mobilization trains a free division in every captured city", () => {
    const state = frontline(2, 4, 3, 1);
    state.owner[map.capitals[2]] = 2;
    const { state: next } = resolveTurn(map, state, ordersFor({}));
    assert.equal(next.troops[home], 5);
    assert.equal(next.troops[map.capitals[2]], 1);
    assert.equal(next.troops[map.capitals[1]], 1);
  });

  test("winter can be switched off and world events disabled", () => {
    const frozen = frontline(1, 10, 3, 9);
    frozen.turn = 10;
    frozen.rules = { winter: 0, events: 0 };
    const { state: next } = resolveTurn(map, frozen, ordersFor({ 1: move(home, front, 10) }));
    assert.equal(next.owner[front], 1);
    let quiet = createInitialState(map, 18, { winter: 1, events: 0 });
    for (let t = 0; t < 12; t++) {
      const result = resolveTurn(map, quiet, ordersFor({}));
      assert.equal(result.events.world, null);
      quiet = result.state;
    }
  });

  test("winter-hardened nations ignore the winter penalty", () => {
    const state = blankState();
    state.turn = 10;
    assert.equal(attackMultiplier(state, 4), 1);
    assert.equal(attackMultiplier(state, 1), 0.8);
  });

  test("national traits change construction costs", () => {
    assert.equal(buildCost(1, BUILDING.FACTORY), 6);
    assert.equal(buildCost(0, BUILDING.FACTORY), 8);
    assert.equal(buildCost(0, BUILDING.FACTORY, 2), 16);
    assert.equal(buildCost(3, BUILDING.FORT), 4);
    assert.equal(fortBonus(3), 0.75);
    assert.equal(buildCost(2, BUILDING.FORT), 6);
  });
});

describe("alliances", () => {
  const offer = (target) => ({ ...emptyOrders(), offer: target });
  const none = () => NATIONS.map(() => -1);
  const allied = (state) => Object.assign(state, { faction: [-1, 1, -1, 1, -1, -1, -1, -1], offers: none() });

  test("an alliance forms once both sides have offered it", () => {
    let state = blankState();
    let result = resolveTurn(map, state, ordersFor({ 1: offer(3) }));
    assert.deepEqual(result.state.faction, none());
    assert.equal(result.state.offers[1], 3);
    assert.deepEqual(result.events.diplomacy, [{ kind: "offer", a: 1, b: 3, amount: 0 }]);
    result = resolveTurn(map, result.state, ordersFor({ 3: offer(1) }));
    assert.deepEqual(result.state.faction, [-1, 1, -1, 1, -1, -1, -1, -1]);
    assert.deepEqual(result.state.offers, none());
    assert.ok(result.events.diplomacy.some((d) => d.kind === "form"));
  });

  test("allies cannot attack each other", () => {
    const state = allied(frontline(1, 6, 3, 1));
    const clean = sanitizeOrders(map, state, 1, move(home, front, 6));
    assert.deepEqual(clean.moves, []);
  });

  test("allies attacking the same province fight as one army", () => {
    const together = allied(frontline(1, 5, 3, 0));
    together.owner[front] = NEUTRAL;
    together.troops[front] = 8;
    together.troops[depot] = 5;
    const orders = ordersFor({ 1: move(home, front, 5), 3: move(depot, front, 5) });
    const joint = resolveTurn(map, together, orders).state;
    assert.ok([1, 3].includes(joint.owner[front]));
    assert.equal(joint.troops[front], 3);

    const apart = frontline(1, 5, 3, 0);
    apart.owner[front] = NEUTRAL;
    apart.troops[front] = 8;
    apart.troops[depot] = 5;
    assert.equal(resolveTurn(map, apart, orders).state.owner[front], NEUTRAL);
  });

  test("supply lines run through allied territory", () => {
    const chain = provinces
      .filter((p) => p.land && !p.city)
      .flatMap((p) =>
        p.neighbors
          .filter((q) => provinces[q].land && !provinces[q].city)
          .map((q) => [
            p.id,
            q,
            provinces[q].neighbors.find(
              (c) =>
                provinces[c].city && provinces[c].capitalOf < 0 && !provinces[p.id].neighbors.includes(c),
            ),
          ]),
      )
      .find(([, , c]) => c !== undefined);
    const [pocket, corridor, city] = chain;
    const state = blankState();
    Object.assign(state.owner, { [pocket]: 1, [corridor]: 3, [city]: 1 });
    assert.equal(isSupplied(map, state, pocket), false);
    allied(state);
    assert.equal(isSupplied(map, state, pocket), true);
  });

  test("breaking an alliance ends it at the end of the turn", () => {
    const state = allied(blankState());
    const { state: next, events } = resolveTurn(
      map,
      state,
      ordersFor({ 3: { ...emptyOrders(), breakAlliance: 1 } }),
    );
    assert.deepEqual(next.faction, none());
    assert.deepEqual(events.diplomacy, [{ kind: "leave", a: 3, b: 1, amount: 0 }]);
  });

  test("factions grow by invitation up to their size cap", () => {
    const big = generateMap(4242, { nations: 6 });
    let state = createInitialState(big);
    state.faction = [0, 0, -1, -1, -1, -1, -1, -1];
    const orders = (entries) => NATIONS.map((n) => entries[n] || emptyOrders());
    state = resolveTurn(big, state, orders({ 2: offer(1), 1: offer(2) })).state;
    assert.deepEqual(state.faction.slice(0, 4), [0, 0, 0, -1]);
    state = resolveTurn(big, state, orders({ 3: offer(0), 0: offer(3) })).state;
    assert.equal(state.faction[3], -1);
  });

  test("aid moves industry from one nation to another", () => {
    const state = blankState();
    const gift = sanitizeOrders(map, state, 0, { ...emptyOrders(), aidTo: 2, aidAmount: 7 });
    const { state: next, events } = resolveTurn(map, state, ordersFor({ 0: gift }));
    assert.equal(next.industry[0], 50 - 7 + income(map, next, 0));
    assert.equal(next.industry[2], 50 + 7 + income(map, next, 2));
    assert.deepEqual(events.diplomacy[0], { kind: "aid", a: 0, b: 2, amount: 7 });
    assert.equal(sanitizeOrders(map, state, 0, { ...emptyOrders(), aidTo: 0, aidAmount: 5 }).aidTo, -1);
  });

  test("an alliance wins together but needs a bigger share", () => {
    assert.ok(victoryGoal(map, 2) > victoryGoal(map));
    const state = blankState();
    let points = 6;
    for (const p of provinces) {
      if (!p.city || p.capitalOf >= 0 || points >= victoryGoal(map, 2)) continue;
      state.owner[p.id] = points % 2 ? 1 : 3;
      points++;
    }
    assert.ok(victoryPoints(map, state, 1) < victoryGoal(map));
    assert.ok(victoryPoints(map, state, 3) < victoryGoal(map));
    assert.equal(resolveTurn(map, state, ordersFor({})).state.winner, -1);
    const { state: next } = resolveTurn(map, allied(state), ordersFor({}));
    assert.ok([1, 3].includes(next.winner));
  });
});

describe("scenarios", () => {
  test("Europe starts in September 1939 with the historical factions", () => {
    const europe = generateMap(1, { scenario: "europe" });
    const state = createInitialState(europe, 18);
    assert.equal(dateOf(state.turn), "SEP 1939");
    assert.equal(relativeTurn(state), 1);
    assert.equal(warLength(state), 18);
    assert.deepEqual(state.faction, [0, 1, 1, -1, 0, 1, -1, -1]);
    assert.ok(areAllied(state, 0, 4) && areAllied(state, 1, 2) && !areAllied(state, 0, 1));
    const orders = NATIONS.map((n) => sanitizeOrders(europe, state, n, planAiOrders(europe, state, n)));
    const next = resolveTurn(europe, state, orders).state;
    assert.equal(dateOf(next.turn), "OCT 1939");
    assert.ok(next.troops.every((t) => Number.isInteger(t) && t >= 0));
  });

  test("difficulty bonuses scale income", () => {
    const state = blankState();
    const base = income(map, state, 0);
    state.bonus[0] = 40;
    assert.equal(income(map, state, 0), Math.floor(base * 1.4));
  });
});

describe("factories", () => {
  test("factories upgrade level by level and pay out every turn", () => {
    const state = frontline(0, 4, 3, 1);
    state.industry[0] = 40;
    const build = { ...emptyOrders(), builds: { [home]: BUILDING.FACTORY } };
    const base = income(map, state, 0);
    let next = resolveTurn(map, state, ordersFor({ 0: sanitizeOrders(map, state, 0, build) })).state;
    assert.equal(next.factories[home], 1);
    assert.equal(next.industry[0], 40 - 8 + base + 3);
    next = resolveTurn(map, next, ordersFor({ 0: sanitizeOrders(map, next, 0, build) })).state;
    assert.equal(next.factories[home], 2);
    next.factories[home] = 3;
    assert.deepEqual(sanitizeOrders(map, next, 0, build).builds, {});
  });

  test("capturing a factory damages it by one level", () => {
    const state = frontline(1, 20, 3, 1);
    state.factories[front] = 0;
    state.factories[depot] = 2;
    Object.assign(state.troops, { [depot]: 1 });
    const otherSide = map.provinces[depot].neighbors.find((n) => n === front);
    assert.equal(otherSide, front);
    state.owner[front] = 1;
    state.troops[front] = 20;
    const { state: next } = resolveTurn(map, state, ordersFor({ 1: move(front, depot, 20) }));
    assert.equal(next.owner[depot], 1);
    assert.equal(next.factories[depot], 1);
  });

  test("a city can hold a fort and a factory at once", () => {
    const state = frontline(0, 4, 3, 1);
    state.industry[0] = 40;
    state.factories[home] = 1;
    const clean = sanitizeOrders(map, state, 0, { ...emptyOrders(), builds: { [home]: BUILDING.FORT } });
    const next = resolveTurn(map, state, ordersFor({ 0: clean })).state;
    assert.equal(next.forts[home], 1);
    assert.equal(next.factories[home], 1);
  });
});

describe("sanitizeOrders", () => {
  test("rejects impossible moves and caps troops", () => {
    const state = blankState();
    Object.assign(state.owner, { [home]: 0, [front]: 0 });
    Object.assign(state.troops, { [home]: 4, [front]: 0 });
    const clean = sanitizeOrders(map, state, 0, {
      moves: [
        { from: home, to: front, count: 3 },
        { from: home, to: front, count: 3 },
        { from: front, to: home, count: 2 },
        { from: home, to: home, count: 1 },
        { from: home, to: 9999, count: 1 },
        { from: home, to: front, count: -4 },
      ],
      recruits: { [map.capitals[1]]: 3 },
      builds: {},
    });
    const sent = clean.moves.filter((m) => m.from === home).reduce((sum, m) => sum + m.count, 0);
    assert.ok(sent <= 4);
    assert.ok(clean.moves.every((m) => m.count > 0 && map.provinces[m.from].neighbors.includes(m.to)));
    assert.equal(clean.recruits[map.capitals[1]], undefined);
  });

  test("never spends more industry than the nation has", () => {
    const state = blankState();
    state.industry[0] = 3;
    const capital = map.capitals[0];
    const clean = sanitizeOrders(map, state, 0, {
      moves: [],
      recruits: { [capital]: 99 },
      builds: { [capital]: BUILDING.FACTORY },
    });
    assert.ok((clean.recruits[capital] || 0) <= 3);
    assert.equal(clean.builds[capital], undefined);
  });
});

describe("full games", () => {
  test("AI games never produce negative or fractional values", () => {
    const seen = new Set();
    for (let g = 0; g < 10; g++) {
      const gameMap = generateMap(300 + g);
      let state = createInitialState(gameMap);
      while (state.winner < 0) {
        const orders = NATIONS.map((n) => sanitizeOrders(gameMap, state, n, planAiOrders(gameMap, state, n)));
        const result = resolveTurn(gameMap, state, orders);
        state = result.state;
        if (result.events.world) seen.add(result.events.world.kind);
        assert.ok(state.troops.every((t) => Number.isInteger(t) && t >= 0));
        assert.ok(state.industry.every((v) => Number.isInteger(v) && v >= 0));
      }
      assert.ok(state.turn <= state.maxTurns + 1);
    }
    assert.ok([...seen].every((kind) => WORLD_EVENTS.includes(kind)));
    assert.ok(seen.size >= 3);
  });

  test("turn resolution is deterministic", () => {
    const gameMap = generateMap(55);
    let state = createInitialState(gameMap);
    for (let t = 0; t < 8; t++) {
      const orders = NATIONS.map((n) => sanitizeOrders(gameMap, state, n, planAiOrders(gameMap, state, n)));
      const a = resolveTurn(gameMap, state, orders);
      const b = resolveTurn(gameMap, state, orders);
      assert.deepEqual(a, b);
      state = a.state;
    }
  });
});

describe("tanks and redeployment", () => {
  test("tanks hit hardest on open ground", () => {
    const state = blankState();
    assert.ok(attackStrength(state, 1, 4, 4, 0) > attackStrength(state, 1, 4, 4, 1));
    assert.ok(attackStrength(state, 1, 4, 4, 1) > attackStrength(state, 1, 4, 4, 2));
    assert.ok(attackStrength(state, 1, 4, 4, 0) > attackStrength(state, 1, 8, 0, 0));
  });

  test("a tank-led attack breaks a line that infantry alone cannot", () => {
    const infantryOnly = frontline(1, 6, 3, 6);
    const { state: held } = resolveTurn(map, infantryOnly, ordersFor({ 1: move(home, front, 6) }));
    assert.equal(held.owner[front], 3);

    const armored = frontline(1, 6, 3, 6);
    armored.armor[home] = 4;
    const orders = sanitizeOrders(map, armored, 1, {
      ...emptyOrders(),
      moves: [{ from: home, to: front, count: 6, armor: 4 }],
    });
    const { state: taken } = resolveTurn(map, armored, ordersFor({ 1: orders }));
    assert.equal(taken.owner[front], 1);
    assert.ok(taken.armor[front] >= 1 && taken.armor[front] <= taken.troops[front]);
  });

  test("tanks need a factory and cost two industry each", () => {
    const state = blankState();
    state.owner[home] = 1;
    state.industry[1] = 9;
    const ask = { ...emptyOrders(), tanks: { [home]: 5 } };
    assert.deepEqual(sanitizeOrders(map, state, 1, ask).tanks, {});
    state.factories[home] = 1;
    const clean = sanitizeOrders(map, state, 1, ask);
    assert.deepEqual(clean.tanks, { [home]: 2 });
    const { state: next } = resolveTurn(map, state, ordersFor({ 1: clean }));
    assert.equal(next.armor[home], 2);
    assert.equal(next.troops[home], 2);
  });

  test("divisions redeploy through friendly land but not past the rail range", () => {
    const state = blankState();
    const path = [provinces.find((p) => p.land && p.id !== home && p.id !== front).id];
    while (path.length < RAIL_RANGE + 2) {
      const last = provinces[path[path.length - 1]];
      const next = last.neighbors.find(
        (n) =>
          provinces[n].land &&
          !path.includes(n) &&
          path.every((id, k) => k === path.length - 1 || !provinces[id].neighbors.includes(n)),
      );
      if (next === undefined) break;
      path.push(next);
    }
    assert.ok(path.length >= RAIL_RANGE + 1);
    for (const id of path) {
      state.owner[id] = 1;
      state.troops[id] = 1;
    }
    state.troops[path[0]] = 7;
    const far = path[RAIL_RANGE];
    assert.ok(canReach(map, state, 1, path[0], far));
    const orders = sanitizeOrders(map, state, 1, {
      ...emptyOrders(),
      moves: [{ from: path[0], to: far, count: 7 }],
    });
    assert.equal(orders.moves.length, 1);
    const { state: next } = resolveTurn(map, state, ordersFor({ 1: orders }));
    assert.equal(next.troops[far], 8);

    state.owner[path[1]] = 3;
    const blocked = sanitizeOrders(map, state, 1, {
      ...emptyOrders(),
      moves: [{ from: path[0], to: far, count: 7 }],
    });
    assert.equal(blocked.moves.length, 0);
    if (path.length > RAIL_RANGE + 1) {
      state.owner[path[1]] = 1;
      assert.ok(!canReach(map, state, 1, path[0], path[RAIL_RANGE + 1]));
    }
  });
});

describe("artillery, flanking and deployment", () => {
  test("attacking from two directions earns a flanking bonus", () => {
    const state = blankState();
    const target = provinces.find(
      (p) => p.land && p.terrain === 0 && p.neighbors.filter((n) => provinces[n].land).length >= 2,
    );
    const [a, b] = target.neighbors.filter((n) => provinces[n].land);
    Object.assign(state.owner, { [a]: 1, [b]: 1, [target.id]: 3 });
    Object.assign(state.troops, { [a]: 5, [b]: 5, [target.id]: 10 });
    const pincer = resolveTurn(
      map,
      state,
      ordersFor({
        1: {
          ...emptyOrders(),
          moves: [
            { from: a, to: target.id, count: 5 },
            { from: b, to: target.id, count: 5 },
          ],
        },
      }),
    ).state;
    assert.equal(pincer.owner[target.id], 1);
    assert.ok(flankBonus(2) > 0 && flankBonus(9) <= 0.3);
  });

  test("artillery shells defenders in any terrain", () => {
    const state = blankState();
    assert.equal(attackStrength(state, 1, 4, 0, 2, 4), attackStrength(state, 1, 4, 0, 0, 4));
    assert.ok(attackStrength(state, 1, 4, 0, 2, 4) > attackStrength(state, 1, 4, 4, 2, 0));
  });

  test("new units deploy anywhere supplied, and tanks plus guns share the factory cap", () => {
    const state = blankState();
    Object.assign(state.owner, { [home]: 1, [front]: 1 });
    state.factories[home] = 1;
    state.industry[1] = 20;
    const clean = sanitizeOrders(map, state, 1, {
      ...emptyOrders(),
      recruits: { [front]: 3 },
      tanks: { [front]: 1 },
      artillery: { [home]: 5 },
    });
    assert.deepEqual(clean.recruits, { [front]: 3 });
    assert.deepEqual(clean.tanks, { [front]: 1 });
    assert.deepEqual(clean.artillery, { [home]: 1 });
    const { state: next } = resolveTurn(map, state, ordersFor({ 1: clean }));
    assert.equal(next.guns[home], 1);
    assert.equal(next.armor[front], 1);
    assert.equal(next.troops[front], 4);
  });
});

describe("declaring war", () => {
  test("nations at peace cannot attack, and a declaration takes a full turn to bite", () => {
    let state = frontline(1, 9, 3, 1);
    state.war = NATIONS.map(() => 0);
    const attack = move(home, front, 9);
    assert.deepEqual(sanitizeOrders(map, state, 1, attack).moves, []);

    const declare = sanitizeOrders(map, state, 1, { ...emptyOrders(), declare: 3 });
    assert.equal(declare.declare, 3);
    const first = resolveTurn(map, state, ordersFor({ 1: declare }));
    assert.ok(first.events.diplomacy.some((d) => d.kind === "declare" && d.a === 1 && d.b === 3));
    state = first.state;
    assert.equal(atWar(state, 1, 3), false);
    assert.equal(warPending(state, 3, 1), true);
    assert.deepEqual(sanitizeOrders(map, state, 1, attack).moves, []);

    state = resolveTurn(map, state, ordersFor({})).state;
    assert.equal(atWar(state, 3, 1), true);
    assert.equal(sanitizeOrders(map, state, 1, attack).moves.length, 1);
  });

  test("allies are dragged into each other's wars", () => {
    let state = blankState();
    state.war = NATIONS.map(() => 0);
    state.faction = NATIONS.map((n) => (n === 1 || n === 2 ? 1 : NEUTRAL));
    state = resolveTurn(map, state, ordersFor({ 3: { ...emptyOrders(), declare: 1 } })).state;
    state = resolveTurn(map, state, ordersFor({})).state;
    assert.equal(atWar(state, 3, 1), true);
    assert.equal(atWar(state, 3, 2), true);
    assert.equal(atWar(state, 1, 2), false);
  });
});
