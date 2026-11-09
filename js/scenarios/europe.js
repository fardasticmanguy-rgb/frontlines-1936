import { NATIONS, NEUTRAL, applyRoster } from "../config.js";
import { EUROPE_DECOR, EUROPE_LINKS, EUROPE_PROVINCES, EUROPE_SCALE, EUROPE_SIZE } from "./europe-data.js";

export const EUROPE_ROSTER = [
  { name: "GERMANY", color: "#6e7378", flag: "germany", trait: "blitz" },
  { name: "BRITAIN", color: "#c45f73", flag: "uk", trait: "industry" },
  { name: "FRANCE", color: "#4b77ad", flag: "france", trait: "fortress" },
  { name: "USSR", color: "#8e2f2a", flag: "ussr", trait: "winter" },
  { name: "ITALY", color: "#5f8f4a", flag: "italy", trait: "rough" },
  { name: "POLAND", color: "#9c7cc0", flag: "poland", trait: "mobilization" },
  { name: "SPAIN", color: "#cfa63c", flag: "spain", trait: "rough" },
  { name: "TURKEY", color: "#c9773a", flag: "turkey", trait: "fortress" },
];

const OWNERS = { GER: 0, UK: 1, FRA: 2, SOV: 3, ITA: 4, POL: 5, SPA: 6, TUR: 7 };
const STARTING_KIT = [
  [8, 6],
  [1, 3],
  [3, 6],
  [6, 6],
  [1, 3],
  [1, 3],
  [0, 2],
  [0, 2],
];
const FIRST_TURN = 43;
const GARRISON_BONUS = { FRA: 1, POL: 1, UK: 1 };
const INDUSTRY = [10, 12, 12, 12, 8, 8, 6, 6];
const FACTIONS = [0, 1, 1, NEUTRAL, 0, 1, NEUTRAL, NEUTRAL];
const FACTION_NAMES = {
  0: { name: "AXIS", core: [0, 4] },
  1: { name: "ALLIES", core: [1, 2] },
};
const INCOME_SCALE = 0.5;

export const EUROPE_WIDTH = EUROPE_SIZE[0];
export const EUROPE_HEIGHT = EUROPE_SIZE[1];

function decodeRing(text) {
  const values = text.split(",").map(Number);
  const ring = [];
  let x = 0;
  let y = 0;
  for (let k = 0; k + 1 < values.length; k += 2) {
    x += values[k];
    y += values[k + 1];
    ring.push([x / EUROPE_SCALE, y / EUROPE_SCALE]);
  }
  return ring;
}

function pointKey([x, y]) {
  return `${Math.round(x * EUROPE_SCALE)},${Math.round(y * EUROPE_SCALE)}`;
}

function linkProvinces(provinces, landCount, seaId) {
  const segments = new Map();
  for (let id = 0; id < landCount; id++) {
    for (const ring of [...provinces[id].rings, ...provinces[id].holes]) {
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k];
        const b = ring[(k + 1) % ring.length];
        const ka = pointKey(a);
        const kb = pointKey(b);
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const entry = segments.get(key);
        if (entry) entry.owners.push(id);
        else segments.set(key, { a, b, owners: [id] });
      }
    }
  }
  const edges = [];
  for (const { a, b, owners } of segments.values()) {
    const [first, second] = owners;
    const other = second !== undefined && second !== first ? second : seaId;
    if (other !== seaId) {
      if (!provinces[first].neighbors.includes(other)) provinces[first].neighbors.push(other);
      if (!provinces[other].neighbors.includes(first)) provinces[other].neighbors.push(first);
    }
    edges.push({ a: first, b: other, x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
  }
  for (const p of provinces) p.neighbors.sort((u, v) => u - v);
  return edges;
}

function bounds(provinces) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of provinces) {
    for (const ring of p.rings) {
      for (const [x, y] of ring) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return {
    x0: Math.max(0, x0 - 10),
    y0: Math.max(0, y0 - 10),
    x1: Math.min(EUROPE_WIDTH, x1 + 10),
    y1: Math.min(EUROPE_HEIGHT, y1 + 10),
  };
}

function garrison(owner, terrain, flags) {
  const override = flags.find((f) => f.startsWith("T"));
  if (override) return Number(override.slice(1));
  if (flags.includes("C")) return 8;
  if (flags.includes("x")) return flags.includes("c") ? 3 : [1, 2, 2][terrain];
  const neutral = OWNERS[owner] === undefined;
  const bonus = GARRISON_BONUS[owner] ?? 0;
  if (flags.includes("c")) return (neutral ? 6 : 4) + bonus;
  return (neutral ? [4, 5, 6][terrain] : [2, 3, 3][terrain]) + bonus;
}

let cached = null;

function buildEurope() {
  const landCount = EUROPE_PROVINCES.length;
  const seaId = landCount;
  const provinces = EUROPE_PROVINCES.map(([name, owner, terrain, flagText, x, y, rings, holes], id) => {
    const flags = flagText.split(" ").filter(Boolean);
    const decoded = rings.map(decodeRing);
    return {
      id,
      x,
      y,
      polygon: decoded[0],
      rings: decoded,
      holes: holes.map(decodeRing),
      neighbors: [],
      border: false,
      land: true,
      terrain,
      city: flags.includes("C") || flags.includes("c"),
      capitalOf: flags.includes("C") ? OWNERS[owner] : -1,
      name,
      realm: OWNERS[owner] === undefined ? owner : "",
      owner,
      flags,
    };
  });
  provinces.push({
    id: seaId,
    x: 0,
    y: 0,
    polygon: [],
    rings: [],
    holes: [],
    neighbors: [],
    border: true,
    land: false,
    terrain: 0,
    city: false,
    capitalOf: -1,
    name: "",
    realm: "",
    owner: "",
    flags: [],
  });

  const edges = linkProvinces(provinces, landCount, seaId);
  const byName = new Map(provinces.slice(0, landCount).map((p) => [p.name, p.id]));
  const links = EUROPE_LINKS.map(([a, b]) => [byName.get(a), byName.get(b)]);
  for (const [a, b] of links) {
    if (!provinces[a].neighbors.includes(b)) provinces[a].neighbors.push(b);
    if (!provinces[b].neighbors.includes(a)) provinces[b].neighbors.push(a);
  }

  const count = provinces.length;
  const start = {
    owner: new Array(count).fill(NEUTRAL),
    troops: new Array(count).fill(0),
    forts: new Array(count).fill(0),
    factories: new Array(count).fill(0),
    industry: NATIONS.map((n) => INDUSTRY[n] ?? 0),
    faction: NATIONS.map((n) => FACTIONS[n] ?? NEUTRAL),
    armor: new Array(count).fill(0),
    guns: new Array(count).fill(0),
  };
  for (const p of provinces.slice(0, landCount)) {
    start.owner[p.id] = OWNERS[p.owner] ?? NEUTRAL;
    start.troops[p.id] = garrison(p.owner, p.terrain, p.flags);
    start.forts[p.id] = p.flags.includes("f") ? 1 : 0;
    const factory = p.flags.find((f) => /^F\d$/.test(f));
    start.factories[p.id] = factory ? Number(factory[1]) : 0;
  }
  STARTING_KIT.forEach(([tanks, guns], nation) => {
    const strongest = provinces
      .slice(0, landCount)
      .filter((p) => start.owner[p.id] === nation)
      .sort((a, b) => start.troops[b.id] - start.troops[a.id] || a.id - b.id);
    const place = (key, amount) => {
      for (let k = 0; k < amount && strongest.length; k++) {
        const id = strongest[k % Math.min(4, strongest.length)].id;
        start.troops[id]++;
        start[key][id]++;
      }
    };
    place("armor", tanks);
    place("guns", guns);
  });

  const capitals = NATIONS.slice(0, EUROPE_ROSTER.length).map((n) =>
    provinces.findIndex((p) => p.capitalOf === n),
  );
  return {
    seed: 1939,
    options: { scenario: "europe" },
    scenario: "europe",
    nationCount: EUROPE_ROSTER.length,
    roster: EUROPE_ROSTER,
    firstTurn: FIRST_TURN,
    factionNames: FACTION_NAMES,
    incomeScale: INCOME_SCALE,
    width: EUROPE_WIDTH,
    height: EUROPE_HEIGHT,
    decor: EUROPE_DECOR.map(decodeRing),
    links,
    provinces,
    edges,
    capitals,
    start,
    bounds: bounds(provinces.slice(0, landCount)),
    hash: 19390901 + landCount * 7 + edges.length,
    totalVictoryPoints: provinces.reduce((sum, p) => sum + (p.city ? (p.capitalOf >= 0 ? 3 : 1) : 0), 0),
  };
}

export function generateEurope(seed = 1939) {
  applyRoster(EUROPE_ROSTER);
  if (!cached) cached = buildEurope();
  return { ...cached, seed };
}
