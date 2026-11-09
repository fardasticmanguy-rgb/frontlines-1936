import { DEFAULT_TURNS, NATIONS, NEUTRAL } from "./config.js";
import { DEFAULT_RULES, KEEP_OFFER, MAX_FACTORY_LEVEL, WORLD_EVENTS, emptyOrders } from "./rules.js";

const UNOWNED = 9;
const DIPLOMACY_KINDS = ["offer", "form", "join", "leave", "aid"];

const numbers = (text) => text.split(",").map(Number);

export function encodeState(state, { deadline = -1, ready = [], absent = [] } = {}, events = null) {
  const rules = state.rules ?? DEFAULT_RULES;
  const header = [
    state.turn,
    state.winner,
    deadline,
    state.maxTurns,
    state.firstTurn ?? 1,
    rules.winter ? 1 : 0,
    rules.events ? 1 : 0,
  ].join(",");
  const nations = NATIONS.map((n) =>
    [
      state.industry[n],
      state.alive[n],
      ready[n] ? 1 : 0,
      absent[n] ? 1 : 0,
      state.faction[n] ?? NEUTRAL,
      state.offers[n] ?? NEUTRAL,
      state.bonus?.[n] ?? 0,
    ].join(","),
  ).join(";");
  const provinces = state.owner
    .map((o, i) =>
      [o === NEUTRAL ? UNOWNED : o, state.troops[i], state.forts[i], state.factories[i]].join(","),
    )
    .join(";");
  const e = { moves: [], battles: [], captures: [], attrition: [], world: null, diplomacy: [], ...events };
  const moves = e.moves.map((m) => [m.nation, m.from, m.to, m.sent, m.stop < 1 ? 1 : 0].join(",")).join(";");
  const captures = e.captures
    .map((c) => [c.province, c.from === NEUTRAL ? UNOWNED : c.from, c.to].join(","))
    .join(";");
  const attrition = e.attrition.map((a) => [a.province, a.lost].join(",")).join(";");
  const w = e.world;
  const world = w
    ? [WORLD_EVENTS.indexOf(w.kind), w.nation === NEUTRAL ? UNOWNED : w.nation, w.province, w.amount].join(
        ",",
      )
    : "";
  const diplomacy = e.diplomacy
    .map((d) => [DIPLOMACY_KINDS.indexOf(d.kind), d.a, d.b, d.amount || 0].join(","))
    .join(";");
  return [header, nations, provinces, moves, e.battles.join(","), captures, attrition, world, diplomacy].join(
    "|",
  );
}

function isOwner(value) {
  return value === NEUTRAL || NATIONS.includes(value);
}

export function decodeState(text, provinceCount) {
  const parts = String(text).split("|");
  if (parts.length < 6) return null;

  const [turn, winner, deadline, maxTurns, firstTurn, winter, worldEvents] = numbers(parts[0]);
  if (!Number.isInteger(turn) || turn < 1 || !Number.isInteger(winner)) return null;
  if (winner < -1 || winner > NATIONS.length) return null;

  const state = {
    turn,
    winner,
    firstTurn: firstTurn || 1,
    maxTurns: maxTurns || DEFAULT_TURNS,
    owner: [],
    troops: [],
    forts: [],
    factories: [],
    industry: [],
    alive: [],
    faction: [],
    offers: [],
    bonus: [],
    rules: { winter: winter === 0 ? 0 : 1, events: worldEvents === 0 ? 0 : 1 },
  };
  const ready = [];
  const absent = [];

  parts[1].split(";").forEach((row, n) => {
    const [industry, alive, isReady, isAbsent, faction, offer, bonus] = numbers(row);
    state.industry[n] = industry || 0;
    state.alive[n] = alive ? 1 : 0;
    ready[n] = isReady ? 1 : 0;
    absent[n] = isAbsent ? 1 : 0;
    state.faction[n] = NATIONS.includes(faction) ? faction : NEUTRAL;
    state.offers[n] = NATIONS.includes(offer) && offer !== n ? offer : NEUTRAL;
    state.bonus[n] = Number.isInteger(bonus) && bonus >= -50 && bonus <= 100 ? bonus : 0;
  });

  parts[2].split(";").forEach((row, i) => {
    const [owner, troops, fort, factory] = numbers(row);
    state.owner[i] = owner === UNOWNED ? NEUTRAL : owner;
    state.troops[i] = troops;
    state.forts[i] = fort;
    state.factories[i] = factory;
  });

  const valid =
    state.owner.length === provinceCount &&
    state.industry.length === NATIONS.length &&
    state.owner.every(isOwner) &&
    state.troops.every((t) => Number.isInteger(t) && t >= 0) &&
    state.forts.every((f) => f === 0 || f === 1) &&
    state.factories.every((f) => Number.isInteger(f) && f >= 0 && f <= MAX_FACTORY_LEVEL) &&
    state.industry.every(Number.isFinite);
  if (!valid) return null;

  const events = { moves: [], battles: [], captures: [], attrition: [], world: null, diplomacy: [] };
  if (parts[3]) {
    events.moves = parts[3]
      .split(";")
      .map(numbers)
      .filter(([nation]) => NATIONS.includes(nation))
      .map(([nation, from, to, sent, halted]) => ({ nation, from, to, sent, stop: halted ? 0.5 : 1 }));
  }
  if (parts[4]) events.battles = numbers(parts[4]);
  if (parts[5]) {
    events.captures = parts[5].split(";").map((row) => {
      const [province, from, to] = numbers(row);
      return { province, from: from === UNOWNED ? NEUTRAL : from, to };
    });
  }
  if (parts[6]) {
    events.attrition = parts[6]
      .split(";")
      .map(numbers)
      .filter(([province, lost]) => Number.isInteger(province) && lost > 0)
      .map(([province, lost]) => ({ province, lost }));
  }
  if (parts[7]) {
    const [kind, nation, province, amount] = numbers(parts[7]);
    if (WORLD_EVENTS[kind]) {
      events.world = {
        kind: WORLD_EVENTS[kind],
        nation: nation === UNOWNED ? NEUTRAL : nation,
        province,
        amount,
      };
    }
  }

  if (parts[8]) {
    events.diplomacy = parts[8]
      .split(";")
      .map(numbers)
      .filter(([kind, a, b]) => DIPLOMACY_KINDS[kind] && NATIONS.includes(a) && NATIONS.includes(b))
      .map(([kind, a, b, amount]) => ({ kind: DIPLOMACY_KINDS[kind], a, b, amount: amount || 0 }));
  }

  return { state, ready, absent, deadline, events };
}

export function encodeOrders(orders) {
  const moves = orders.moves.map((m) => `${m.from}:${m.to}:${m.count}`).join(",");
  const recruits = Object.keys(orders.recruits)
    .map((id) => `${id}:${orders.recruits[id]}`)
    .join(",");
  const builds = Object.keys(orders.builds)
    .map((id) => `${id}:${orders.builds[id]}`)
    .join(",");
  const diplomacy = [
    orders.offer ?? KEEP_OFFER,
    orders.breakAlliance ? 1 : 0,
    orders.aidTo ?? NEUTRAL,
    orders.aidAmount || 0,
  ].join(":");
  return [moves, recruits, builds, diplomacy].join("/");
}

export function decodeOrders(text) {
  const orders = emptyOrders();
  if (typeof text !== "string") return orders;
  const [moves, recruits, builds, diplomacy] = text.split("/");
  const rows = (section) =>
    section
      ? section
          .split(",")
          .map((row) => row.split(":").map(Number))
          .filter((values) => values.every(Number.isFinite))
      : [];

  for (const v of rows(moves)) if (v.length === 3) orders.moves.push({ from: v[0], to: v[1], count: v[2] });
  for (const v of rows(recruits)) if (v.length === 2) orders.recruits[v[0]] = v[1];
  for (const v of rows(builds)) if (v.length === 2) orders.builds[v[0]] = v[1];
  const [offer, breakAlliance, aidTo, aidAmount] = (diplomacy || "").split(":").map(Number);
  if (Number.isInteger(offer)) orders.offer = offer;
  orders.breakAlliance = breakAlliance === 1 ? 1 : 0;
  if (Number.isInteger(aidTo) && Number.isInteger(aidAmount)) {
    orders.aidTo = aidTo;
    orders.aidAmount = aidAmount;
  }
  return orders;
}
