import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { planAiOrders } from "../js/ai.js";
import { BUILDING, NATIONS, NEUTRAL } from "../js/config.js";
import { generateMap } from "../js/map.js";
import {
  createInitialState,
  defenseMultiplier,
  emptyOrders,
  income,
  resolveTurn,
  sanitizeOrders,
} from "../js/rules.js";

const map = generateMap(4242);
const [a, b] = map.provinces
  .filter((p) => p.land)
  .map((p) => [p.id, p.neighbors.find((n) => map.provinces[n].land)])
  .find(([, n]) => n !== undefined);

function blankState() {
  const state = createInitialState(map);
  state.owner.fill(NEUTRAL);
  state.troops.fill(0);
  state.buildings.fill(BUILDING.NONE);
  state.industry = NATIONS.map(() => 50);
  for (const n of NATIONS) {
    state.owner[map.capitals[n]] = n;
    state.troops[map.capitals[n]] = 1;
  }
  return state;
}

const move = (from, to, count) => ({ ...emptyOrders(), moves: [{ from, to, count }] });

describe("resolveTurn", () => {
  test("equal armies meeting head-on destroy each other", () => {
    const state = blankState();
    Object.assign(state.owner, { [a]: 0, [b]: 1 });
    Object.assign(state.troops, { [a]: 5, [b]: 5 });
    const { state: next } = resolveTurn(map, state, [move(a, b, 5), move(b, a, 5)]);
    assert.equal(next.troops[a], 0);
    assert.equal(next.troops[b], 0);
    assert.equal(next.owner[a], 0);
    assert.equal(next.owner[b], 1);
  });

  test("the larger army wins a head-on clash and marches on", () => {
    const state = blankState();
    Object.assign(state.owner, { [a]: 0, [b]: 1 });
    Object.assign(state.troops, { [a]: 7, [b]: 3 });
    const { state: next } = resolveTurn(map, state, [move(a, b, 7), move(b, a, 3)]);
    assert.equal(next.owner[b], 0);
    assert.equal(next.troops[b], 4);
  });

  test("defenders multiply their strength", () => {
    const state = blankState();
    Object.assign(state.owner, { [a]: 0, [b]: 1 });
    Object.assign(state.troops, { [a]: 9, [b]: 4 });
    state.buildings[b] = BUILDING.FORT;
    const defense = 4 * defenseMultiplier(map, state, b);
    const { state: next } = resolveTurn(map, state, [move(a, b, 9), emptyOrders()]);
    if (9 > defense) {
      assert.equal(next.owner[b], 0);
      assert.equal(next.troops[b], Math.ceil(9 - defense));
    } else {
      assert.equal(next.owner[b], 1);
    }
  });

  test("a failed attack loses the attacking army", () => {
    const state = blankState();
    Object.assign(state.owner, { [a]: 0, [b]: 1 });
    Object.assign(state.troops, { [a]: 3, [b]: 6 });
    const { state: next } = resolveTurn(map, state, [move(a, b, 3), emptyOrders()]);
    assert.equal(next.owner[b], 1);
    assert.equal(next.troops[a], 0);
    assert.ok(next.troops[b] >= 1 && next.troops[b] <= 6);
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
});

describe("sanitizeOrders", () => {
  test("rejects impossible moves and caps troops", () => {
    const state = blankState();
    Object.assign(state.owner, { [a]: 0, [b]: 0 });
    Object.assign(state.troops, { [a]: 4, [b]: 0 });
    const clean = sanitizeOrders(map, state, 0, {
      moves: [
        { from: a, to: b, count: 3 },
        { from: a, to: b, count: 3 },
        { from: b, to: a, count: 2 },
        { from: a, to: a, count: 1 },
        { from: a, to: 9999, count: 1 },
        { from: a, to: b, count: -4 },
      ],
      recruits: { [map.capitals[1]]: 3 },
      builds: {},
    });
    const sent = clean.moves.filter((m) => m.from === a).reduce((sum, m) => sum + m.count, 0);
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
    for (let g = 0; g < 10; g++) {
      const gameMap = generateMap(300 + g);
      let state = createInitialState(gameMap);
      while (state.winner < 0) {
        const orders = NATIONS.map((n) => sanitizeOrders(gameMap, state, n, planAiOrders(gameMap, state, n)));
        state = resolveTurn(gameMap, state, orders).state;
        assert.ok(state.troops.every((t) => Number.isInteger(t) && t >= 0));
        assert.ok(state.industry.every((v) => v >= 0));
      }
      assert.ok(state.turn <= state.maxTurns + 1);
    }
  });
});
