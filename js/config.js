export const MAP_WIDTH = 1300;
export const MAP_HEIGHT = 900;
export const TAU = Math.PI * 2;

export const MAX_NATIONS = 8;
export const NATIONS = Array.from({ length: MAX_NATIONS }, (_, n) => n);
export const NATION_NAMES = [];
export const NATION_COLORS = [];
export const NATION_TRAITS = [];
export const NATION_FLAGS = [];
export const NEUTRAL = -1;

export const TERRAIN_NAMES = ["Plains", "Forest", "Mountains"];
export const TERRAIN_DEFENSE = [1, 1.25, 1.5];
export const FORT_BONUS = 0.5;
export const CAPITAL_BONUS = 0.25;

export const BUILDING = { NONE: 0, FORT: 1, FACTORY: 2 };
export const BUILD_COST = { [BUILDING.FORT]: 6, [BUILDING.FACTORY]: 10 };

export const STARTING_INDUSTRY = 6;
export const DEFAULT_TURNS = 18;

export const WINTER_ATTACK = 0.8;
export const SUPPLY_DEFENSE = 0.75;

export const TRAITS = {
  blitz: { name: "BLITZKRIEG", text: "Attacking divisions strike 10% harder" },
  industry: { name: "INDUSTRIAL BASE", text: "Factories and upgrades cost 2 less" },
  mobilization: { name: "MASS MOBILIZATION", text: "Every captured city trains 1 free division each turn" },
  fortress: { name: "FORTRESS DOCTRINE", text: "Cities defend +0.5 stronger. Forts cost 4 and give +0.75" },
  winter: { name: "GENERAL WINTER", text: "Ignores the winter penalty when attacking" },
  rough: { name: "MOUNTAIN TROOPS", text: "Forests and mountains defend +0.25 stronger" },
};

const rosterListeners = [];

export function onRosterChange(listener) {
  rosterListeners.push(listener);
}

export function applyRoster(roster) {
  const key = roster.map((nation) => nation.name).join(",");
  if (applyRoster.key === key) return;
  applyRoster.key = key;
  for (const n of NATIONS) {
    const nation = roster[n] ?? roster[n % roster.length];
    NATION_NAMES[n] = nation.name;
    NATION_COLORS[n] = nation.color;
    NATION_FLAGS[n] = nation.flag;
    NATION_TRAITS[n] = { kind: nation.trait, ...TRAITS[nation.trait] };
  }
  rosterListeners.forEach((listener) => listener());
}

export function hasTrait(nation, kind) {
  return NATION_TRAITS[nation]?.kind === kind;
}

const START_MONTH = 2;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function monthOf(turn) {
  return (turn - 1 + START_MONTH) % 12;
}

export function isWinter(turn) {
  const month = monthOf(turn);
  return month === 11 || month <= 1;
}

export function dateOf(turn) {
  const year = 1936 + Math.floor((turn - 1 + START_MONTH) / 12);
  return `${MONTHS[monthOf(turn)]} ${year}`;
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}
