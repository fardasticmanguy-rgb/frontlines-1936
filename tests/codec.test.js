import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeOrders, decodeState, encodeOrders, encodeState } from "../js/codec.js";
import { generateMap } from "../js/map.js";
import { createInitialState } from "../js/rules.js";

const map = generateMap(12345);

test("state survives an encode/decode round trip", () => {
  const state = createInitialState(map);
  const text = encodeState(state, { deadline: 30, ready: [1, 0, 1, 0], absent: [0, 0, 1, 0] });
  const decoded = decodeState(text, map.provinces.length);
  assert.deepEqual(decoded.state, state);
  assert.deepEqual(decoded.ready, [1, 0, 1, 0]);
  assert.deepEqual(decoded.absent, [0, 0, 1, 0]);
  assert.equal(decoded.deadline, 30);
});

test("malformed or tampered state is rejected", () => {
  const text = encodeState(createInitialState(map));
  assert.equal(decodeState("garbage", map.provinces.length), null);
  assert.equal(decodeState(text, map.provinces.length + 1), null);
  const parts = text.split("|");
  parts[2] = parts[2].replace(/^\d+/, "7");
  assert.equal(decodeState(parts.join("|"), map.provinces.length), null);
});

test("orders survive an encode/decode round trip", () => {
  const orders = { moves: [{ from: 3, to: 7, count: 5 }], recruits: { 12: 4 }, builds: { 12: 2 } };
  assert.deepEqual(decodeOrders(encodeOrders(orders)), orders);
});
