import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeOrders, decodeState, encodeOrders, encodeState } from "../js/codec.js";
import { generateMap } from "../js/map.js";
import { createInitialState } from "../js/rules.js";

const map = generateMap(12345);

test("state survives an encode/decode round trip", () => {
  const state = createInitialState(map);
  state.faction = [0, -1, -1, 0, -1, -1, -1, -1];
  state.offers = [-1, 2, -1, -1, -1, -1, -1, -1];
  state.rules = { winter: 0, events: 1 };
  state.troops[3] = 6;
  state.armor[3] = 2;
  state.guns[3] = 1;
  state.siege[4] = 2;
  const text = encodeState(state, { deadline: 30, ready: [1, 0, 1, 0], absent: [0, 0, 1, 0] });
  const decoded = decodeState(text, map.provinces.length);
  assert.deepEqual(decoded.state, state);
  assert.deepEqual(decoded.ready, [1, 0, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual(decoded.absent, [0, 0, 1, 0, 0, 0, 0, 0]);
  assert.equal(decoded.deadline, 30);
});

test("turn events survive an encode/decode round trip", () => {
  const state = createInitialState(map);
  const events = {
    moves: [{ nation: 1, from: 3, to: 7, sent: 5, stop: 0.5 }],
    battles: [7],
    captures: [{ province: 7, from: -1, to: 1 }],
    attrition: [{ province: 9, lost: 2, surrender: 1 }],
    world: { kind: "harvest", nation: -1, province: -1, amount: 2 },
    diplomacy: [
      { kind: "offer", a: 0, b: 2, amount: 0 },
      { kind: "form", a: 1, b: 3, amount: 0 },
      { kind: "aid", a: 2, b: 1, amount: 5 },
    ],
  };
  const decoded = decodeState(encodeState(state, {}, events), map.provinces.length);
  assert.deepEqual(decoded.events, events);
});

test("malformed or tampered state is rejected", () => {
  const text = encodeState(createInitialState(map));
  assert.equal(decodeState("garbage", map.provinces.length), null);
  assert.equal(decodeState(text, map.provinces.length + 1), null);
  const parts = text.split("|");
  parts[2] = parts[2].replace(/^\d+/, "8");
  assert.equal(decodeState(parts.join("|"), map.provinces.length), null);
});

test("orders survive an encode/decode round trip", () => {
  const orders = {
    moves: [{ from: 3, to: 7, count: 5, armor: 2, guns: 1 }],
    recruits: { 12: 4 },
    tanks: { 12: 1 },
    artillery: { 9: 2 },
    builds: { 12: 2 },
    offer: 2,
    breakAlliance: 1,
    aidTo: 3,
    aidAmount: 4,
  };
  assert.deepEqual(decodeOrders(encodeOrders(orders)), orders);
});
