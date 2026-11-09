import assert from "node:assert/strict";
import { test } from "node:test";
import { pointInPolygon } from "../js/geometry.js";
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

test("random maps support two to eight nations at every size", () => {
  for (const size of ["small", "medium", "large"]) {
    for (const nations of [2, 3, 5, 8]) {
      const map = generateMap(31, { nations, size });
      assert.equal(map.nationCount, nations);
      assert.equal(new Set(map.capitals).size, nations);
      assert.ok(map.capitals.every((c) => map.provinces[c].land));
    }
  }
});

test("neighbor links are symmetric", () => {
  const map = generateMap(99);
  for (const p of map.provinces) {
    for (const n of p.neighbors) assert.ok(map.provinces[n].neighbors.includes(p.id));
  }
});

test("the Europe 1939 map is one connected continent with real powers", () => {
  const map = generateMap(1, { scenario: "europe" });
  const land = map.provinces.filter((p) => p.land);
  assert.ok(land.length > 150);
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
  const byName = (name) => map.provinces.find((p) => p.name === name);
  assert.equal(byName("Berlin").capitalOf, 0);
  assert.equal(byName("London").capitalOf, 1);
  assert.ok(byName("London").neighbors.includes(byName("Calais").id));
  assert.ok(!byName("Copenhagen").neighbors.includes(byName("Berlin").id));
  assert.equal(map.capitals.length, 8);
  assert.ok(map.capitals.every((c) => c >= 0));
});

test("Europe provinces follow 1939 borders with real shapes", () => {
  const map = generateMap(1, { scenario: "europe" });
  const byName = (name) => map.provinces.find((p) => p.name === name);
  const land = map.provinces.filter((p) => p.land);
  assert.ok(land.length >= 250 && land.length <= 330, `${land.length} provinces`);
  for (const p of land) {
    assert.ok(p.polygon.length >= 3, `${p.name} has no shape`);
    assert.ok(p.rings.length >= 1 && p.rings[0] === p.polygon);
    assert.ok(p.neighbors.length > 0, `${p.name} has no neighbors`);
    for (const n of p.neighbors) assert.ok(map.provinces[n].neighbors.includes(p.id));
    assert.ok(
      p.rings.some((ring) => pointInPolygon(ring, p.x, p.y)),
      `${p.name} anchor lies outside its province`,
    );
  }
  assert.ok(map.edges.every((e) => map.provinces[e.a] && map.provinces[e.b]));
  assert.ok(byName("Danzig").neighbors.includes(byName("Gdynia").id));
  assert.ok(byName("Königsberg").neighbors.some((n) => map.provinces[n].realm === "Lithuania"));
  assert.ok(byName("Wilno").neighbors.some((n) => map.provinces[n].realm === "Latvia"));
  assert.ok(byName("Viipuri").neighbors.includes(byName("Leningrad").id));
  assert.ok(byName("Ungvár").neighbors.some((n) => map.provinces[n].name === "Stanisławów"));
  assert.equal(map.start.owner[byName("Vienna").id], 0);
  assert.equal(map.start.owner[byName("Tirana").id], 4);
  assert.equal(byName("Chișinău").realm, "Romania");
});
