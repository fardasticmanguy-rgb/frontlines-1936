import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { planAiOrders } from "../js/ai.js";
import { BUILDING, NATIONS, NEUTRAL, SUPPLY_DEFENSE, isWinter } from "../js/config.js";
import { generateMap } from "../js/map.js";
import {
  WORLD_EVENTS,
  buildCost,
  fortBonus,
  createInitialState,
  defenseMultiplier,
  emptyOrders,
  income,
  isSupplied,
  resolveTurn,
  sanitizeOrders,
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
  for (const n of NATIONS) {
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
    assert.deepEqual(events.attrition, [{ province: front, lost: 2 }]);
  });

  test("mass mobilization trains a free division in every captured city", () => {
    const state = frontline(2, 4, 3, 1);
    state.owner[map.capitals[2]] = 2;
    const { state: next } = resolveTurn(map, state, ordersFor({}));
    assert.equal(next.troops[home], 5);
    assert.equal(next.troops[map.capitals[2]], 1);
    assert.equal(next.troops[map.capitals[1]], 1);
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
