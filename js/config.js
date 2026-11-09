export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 700;
export const TAU = Math.PI * 2;

export const NATION_NAMES = ["KARNIA", "VESTMARK", "OSTRAVIA", "AURELIA"];
export const NATION_COLORS = ["#a8463d", "#4b77ad", "#6a9650", "#cfa63c"];
export const NATIONS = [0, 1, 2, 3];
export const NEUTRAL = -1;

export const TERRAIN_NAMES = ["Plains", "Forest", "Mountains"];
export const TERRAIN_DEFENSE = [1, 1.25, 1.5];
export const FORT_BONUS = 0.5;
export const CAPITAL_BONUS = 0.25;

export const BUILDING = { NONE: 0, FORT: 1, FACTORY: 2 };
export const BUILD_COST = { [BUILDING.FORT]: 6, [BUILDING.FACTORY]: 10 };

export const STARTING_INDUSTRY = 6;
export const DEFAULT_TURNS = 15;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function dateOf(turn) {
  const month = MONTHS[(turn - 1) % 12];
  const year = 1936 + Math.floor((turn - 1) / 12);
  return `${month} ${year}`;
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}
