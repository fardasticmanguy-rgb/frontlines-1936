import assert from "node:assert/strict";
import { test } from "node:test";
import { generateMap } from "../js/map.js";

test("the same seed always produces the same map", () => {
  assert.equal(generateMap(777).hash, generateMap(777).hash);
  assert.notEqual(generateMap(777).hash, generateMap(778).hash);
});

test("maps have one connected landmass with four separate capitals", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const map = generateMap(seed);
    const land = map.provinces.filter((p) => p.land);
    assert.ok(land.length >= 30, `seed ${seed} has only ${land.length} land provinces`);

    const seen = new Set([land[0].id]);
    const queue = [land[0].id];
    while (queue.length) {
      for (const n of map.provinces[queue.pop()].neighbors) {
        if (map.provinces[n].land && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    assert.equal(seen.size, land.length);

    assert.equal(new Set(map.capitals).size, 4);
    for (const capital of map.capitals) {
      assert.ok(map.provinces[capital].land);
      assert.ok(map.capitals.every((other) => !map.provinces[capital].neighbors.includes(other)));
    }
  }
});

test("neighbor links are symmetric", () => {
  const map = generateMap(99);
  for (const p of map.provinces) {
    for (const n of p.neighbors) assert.ok(map.provinces[n].neighbors.includes(p.id));
  }
});
