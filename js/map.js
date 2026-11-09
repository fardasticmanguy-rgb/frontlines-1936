import { MAP_HEIGHT, MAP_WIDTH } from "./config.js";
import { centroid, distanceSquared, voronoiCell } from "./geometry.js";
import { createRng, createValueNoise } from "./random.js";

const SITE_COUNT = 150;
const SITE_CANDIDATES = 14;
const RELAX_PASSES = 2;
const LAND_SHARE = 0.86;
const EXTRA_CITIES = 18;
const BOUNDS_PADDING = 26;

const CAPITAL_ANCHORS = [
  [0.15, 0.2],
  [0.85, 0.2],
  [0.15, 0.8],
  [0.85, 0.8],
].map(([x, y]) => [x * MAP_WIDTH, y * MAP_HEIGHT]);

const NAME_HEADS = [
  "Vel",
  "Kor",
  "Ast",
  "Bra",
  "Dur",
  "Esk",
  "Fal",
  "Gor",
  "Hal",
  "Ist",
  "Jar",
  "Kas",
  "Lom",
  "Mar",
  "Nor",
  "Ost",
  "Pra",
  "Riv",
  "Sar",
  "Tor",
  "Ul",
  "Var",
  "Wes",
  "Zan",
  "Cal",
  "Ber",
  "Ard",
  "Mon",
  "Tal",
  "Ros",
  "Kel",
  "Dra",
  "Lin",
  "Stet",
  "Grau",
  "Pol",
];
const NAME_TAILS = [
  "ia",
  "mor",
  "grad",
  "holm",
  "burg",
  "ova",
  "enz",
  "ica",
  "stad",
  "mark",
  "ora",
  "avia",
  "heim",
  "polis",
  "ar",
  "os",
  "ene",
  "ania",
  "ford",
  "vik",
  "rest",
  "gard",
  "berg",
  "sk",
  "ow",
  "ach",
];

function scatterSites(rng) {
  const sites = [];
  while (sites.length < SITE_COUNT) {
    let best = null;
    let bestDistance = -1;
    for (let k = 0; k < SITE_CANDIDATES; k++) {
      const x = 20 + rng() * (MAP_WIDTH - 40);
      const y = 20 + rng() * (MAP_HEIGHT - 40);
      let nearest = Infinity;
      for (const s of sites) nearest = Math.min(nearest, distanceSquared(s[0], s[1], x, y));
      if (nearest > bestDistance) {
        bestDistance = nearest;
        best = [x, y];
      }
    }
    sites.push(best);
  }
  return sites;
}

function relaxSites(sites) {
  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    const cells = sites.map((_, i) => voronoiCell(sites, i, MAP_WIDTH, MAP_HEIGHT));
    cells.forEach((cell, i) => (sites[i] = centroid(cell)));
  }
  return sites;
}

function touchesBorder(polygon) {
  return polygon.some(([x, y]) => x < 0.5 || x > MAP_WIDTH - 0.5 || y < 0.5 || y > MAP_HEIGHT - 0.5);
}

function linkNeighbors(provinces) {
  const edges = [];
  for (const p of provinces) {
    const poly = p.polygon;
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k];
      const b = poly[(k + 1) % poly.length];
      if (distanceSquared(a[0], a[1], b[0], b[1]) < 4) continue;

      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const own = distanceSquared(mx, my, p.x, p.y);
      let match = -1;
      let error = Infinity;
      for (const q of provinces) {
        if (q === p) continue;
        const e = Math.abs(distanceSquared(mx, my, q.x, q.y) - own);
        if (e < error) {
          error = e;
          match = q.id;
        }
      }
      if (match < 0 || error >= own * 1e-4 + 0.5) continue;

      const q = provinces[match];
      if (!p.neighbors.includes(match)) p.neighbors.push(match);
      if (!q.neighbors.includes(p.id)) q.neighbors.push(p.id);
      if (p.id < match) edges.push({ a: p.id, b: match, x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
    }
  }
  return edges;
}

function raiseLand(provinces, rng) {
  const k = MAP_WIDTH / 1000;
  const blobs = CAPITAL_ANCHORS.map(([x, y]) => [x, y, (250 + rng() * 60) * k]);
  blobs.push([MAP_WIDTH / 2, MAP_HEIGHT / 2, (320 + rng() * 60) * k]);
  for (let i = 0; i < 4; i++) {
    blobs.push([MAP_WIDTH * (0.2 + rng() * 0.6), MAP_HEIGHT * (0.15 + rng() * 0.7), (170 + rng() * 90) * k]);
  }
  const noise = createValueNoise(rng, 7, 5, MAP_WIDTH, MAP_HEIGHT);

  const elevation = provinces.map((p) => {
    if (p.border) return -Infinity;
    let peak = 0;
    for (const [bx, by, radius] of blobs) {
      peak = Math.max(peak, 1 - distanceSquared(p.x, p.y, bx, by) / (radius * radius));
    }
    return peak * 0.9 + noise(p.x, p.y) * 0.5;
  });

  const candidates = provinces
    .map((p) => p.id)
    .filter((id) => elevation[id] > -Infinity)
    .sort((a, b) => elevation[b] - elevation[a] || a - b);

  for (const id of candidates.slice(0, Math.round(candidates.length * LAND_SHARE))) {
    provinces[id].land = true;
  }
}

function keepLargestLandmass(provinces) {
  const component = new Array(provinces.length).fill(-1);
  let largest = -1;
  let largestSize = 0;

  for (const start of provinces) {
    if (!start.land || component[start.id] >= 0) continue;
    const queue = [start.id];
    component[start.id] = start.id;
    for (let head = 0; head < queue.length; head++) {
      for (const n of provinces[queue[head]].neighbors) {
        if (provinces[n].land && component[n] < 0) {
          component[n] = start.id;
          queue.push(n);
        }
      }
    }
    if (queue.length > largestSize) {
      largestSize = queue.length;
      largest = start.id;
    }
  }

  for (const p of provinces) {
    if (p.land && component[p.id] !== largest) p.land = false;
  }
}

function assignTerrain(provinces, rng) {
  const noise = createValueNoise(rng, 9, 6, MAP_WIDTH, MAP_HEIGHT);
  for (const p of provinces) {
    if (!p.land) continue;
    const roughness = noise(p.x, p.y) * 0.7 + rng() * 0.3;
    p.terrain = roughness > 0.64 ? 2 : roughness > 0.5 ? 1 : 0;
  }
}

function placeCapitals(provinces) {
  const capitals = [];
  CAPITAL_ANCHORS.forEach(([ax, ay], nation) => {
    let best = -1;
    let bestDistance = Infinity;
    for (const p of provinces) {
      if (!p.land || capitals.includes(p.id)) continue;
      if (capitals.some((c) => provinces[c].neighbors.includes(p.id))) continue;
      const d = distanceSquared(p.x, p.y, ax, ay);
      if (d < bestDistance) {
        bestDistance = d;
        best = p.id;
      }
    }
    capitals.push(best);
    Object.assign(provinces[best], { capitalOf: nation, city: true, terrain: 0 });
  });
  return capitals;
}

function placeCities(provinces, capitals) {
  const cities = capitals.slice();
  for (let k = 0; k < EXTRA_CITIES; k++) {
    let best = -1;
    let bestSpread = -1;
    for (const p of provinces) {
      if (!p.land || p.city) continue;
      let nearest = Infinity;
      for (const c of cities) {
        nearest = Math.min(nearest, distanceSquared(p.x, p.y, provinces[c].x, provinces[c].y));
      }
      if (nearest > bestSpread) {
        bestSpread = nearest;
        best = p.id;
      }
    }
    if (best < 0) break;
    provinces[best].city = true;
    cities.push(best);
  }
  return cities;
}

function nameProvinces(provinces, rng) {
  const used = new Set();
  const pick = (list) => list[Math.floor(rng() * list.length)];
  for (const p of provinces) {
    if (!p.land) continue;
    let name;
    let attempts = 0;
    do {
      name = pick(NAME_HEADS) + pick(NAME_TAILS);
      attempts++;
    } while (used.has(name) && attempts < 40);
    used.add(name);
    p.name = name;
  }
}

function landBounds(provinces) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of provinces) {
    if (!p.land) continue;
    for (const [x, y] of p.polygon) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return {
    x0: Math.max(0, x0 - BOUNDS_PADDING),
    y0: Math.max(0, y0 - BOUNDS_PADDING),
    x1: Math.min(MAP_WIDTH, x1 + BOUNDS_PADDING),
    y1: Math.min(MAP_HEIGHT, y1 + BOUNDS_PADDING),
  };
}

function fingerprint(provinces) {
  const text = provinces
    .map((p) => {
      const neighbors = p.neighbors
        .slice()
        .sort((a, b) => a - b)
        .join(".");
      return `${p.land ? 1 : 0}:${neighbors}:${p.city ? 1 : 0}${p.capitalOf}`;
    })
    .join("|");
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 33) + text.charCodeAt(i)) >>> 0;
  return hash;
}

export function generateMap(seed) {
  const rng = createRng(seed);
  const sites = relaxSites(scatterSites(rng));

  const provinces = sites.map(([x, y], id) => {
    const polygon = voronoiCell(sites, id, MAP_WIDTH, MAP_HEIGHT);
    return {
      id,
      x,
      y,
      polygon,
      neighbors: [],
      border: touchesBorder(polygon),
      land: false,
      terrain: 0,
      city: false,
      capitalOf: -1,
      name: "",
    };
  });

  const edges = linkNeighbors(provinces);
  raiseLand(provinces, rng);
  keepLargestLandmass(provinces);
  assignTerrain(provinces, rng);
  const capitals = placeCapitals(provinces);
  const cities = placeCities(provinces, capitals);
  nameProvinces(provinces, rng);

  return {
    seed,
    provinces,
    edges,
    capitals,
    bounds: landBounds(provinces),
    hash: fingerprint(provinces),
    totalVictoryPoints: cities.length + capitals.length * 2,
  };
}
