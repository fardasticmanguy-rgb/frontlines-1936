import { DEFAULT_TURNS, NATIONS, NEUTRAL } from "./config.js";
import { emptyOrders } from "./rules.js";

const UNOWNED = 9;

const numbers = (text) => text.split(",").map(Number);

export function encodeState(state, { deadline = -1, ready = [], absent = [] } = {}, events = null) {
  const header = [state.turn, state.winner, deadline, state.maxTurns].join(",");
  const nations = NATIONS.map((n) =>
    [state.industry[n], state.alive[n], ready[n] ? 1 : 0, absent[n] ? 1 : 0].join(","),
  ).join(";");
  const provinces = state.owner
    .map((o, i) => [o === NEUTRAL ? UNOWNED : o, state.troops[i], state.buildings[i]].join(","))
    .join(";");
  const e = events || { moves: [], battles: [], captures: [] };
  const moves = e.moves.map((m) => [m.nation, m.from, m.to, m.sent, m.stop < 1 ? 1 : 0].join(",")).join(";");
  const captures = e.captures
    .map((c) => [c.province, c.from === NEUTRAL ? UNOWNED : c.from, c.to].join(","))
    .join(";");
  return [header, nations, provinces, moves, e.battles.join(","), captures].join("|");
}

function isOwner(value) {
  return value === NEUTRAL || NATIONS.includes(value);
}

export function decodeState(text, provinceCount) {
  const parts = String(text).split("|");
  if (parts.length < 6) return null;

  const [turn, winner, deadline, maxTurns] = numbers(parts[0]);
  if (!Number.isInteger(turn) || turn < 1 || !Number.isInteger(winner)) return null;
  if (winner < -1 || winner > NATIONS.length) return null;

  const state = {
    turn,
    winner,
    maxTurns: maxTurns || DEFAULT_TURNS,
    owner: [],
    troops: [],
    buildings: [],
    industry: [],
    alive: [],
  };
  const ready = [];
  const absent = [];

  parts[1].split(";").forEach((row, n) => {
    const [industry, alive, isReady, isAbsent] = numbers(row);
    state.industry[n] = industry || 0;
    state.alive[n] = alive ? 1 : 0;
    ready[n] = isReady ? 1 : 0;
    absent[n] = isAbsent ? 1 : 0;
  });

  parts[2].split(";").forEach((row, i) => {
    const [owner, troops, building] = numbers(row);
    state.owner[i] = owner === UNOWNED ? NEUTRAL : owner;
    state.troops[i] = troops;
    state.buildings[i] = building;
  });

  const valid =
    state.owner.length === provinceCount &&
    state.industry.length === NATIONS.length &&
    state.owner.every(isOwner) &&
    state.troops.every((t) => Number.isInteger(t) && t >= 0) &&
    state.buildings.every((b) => b === 0 || b === 1 || b === 2) &&
    state.industry.every(Number.isFinite);
  if (!valid) return null;

  const events = { moves: [], battles: [], captures: [] };
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
  return [moves, recruits, builds].join("/");
}

export function decodeOrders(text) {
  const orders = emptyOrders();
  if (typeof text !== "string") return orders;
  const [moves, recruits, builds] = text.split("/");
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
  return orders;
}
