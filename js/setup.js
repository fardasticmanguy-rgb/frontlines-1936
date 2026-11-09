import { MAX_NATIONS, TRAITS } from "./config.js";
import { flagUrlFor } from "./flags.js";
import { newGame } from "./game.js";
import { RANDOM_ROSTER } from "./nations.js";
import { randomSeed } from "./random.js";
import { EUROPE_ROSTER } from "./scenarios/europe.js";

const KEY = "flSetup";
const DEFAULTS = {
  scenario: "random",
  nations: 4,
  size: "medium",
  difficulty: "normal",
  length: 18,
  winter: 1,
  events: 1,
  factions: 1,
  seats: ["local"],
};

const $ = (id) => document.getElementById(id);

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

const setup = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(setup));
  } catch {}
}

export function rosterFor(scenario) {
  return scenario === "europe" ? EUROPE_ROSTER : RANDOM_ROSTER;
}

export function nationCountFor(options) {
  return options.scenario === "europe" ? EUROPE_ROSTER.length : Math.min(MAX_NATIONS, options.nations);
}

function seatsFor(count) {
  const seats = Array.from({ length: count }, (_, n) => (setup.seats[n] === "local" ? "local" : "ai"));
  if (!seats.includes("local")) seats[0] = "local";
  return seats;
}

function syncRow(id, value) {
  for (const button of $(id).querySelectorAll("button")) {
    button.classList.toggle("on", button.dataset.value === String(value));
  }
}

export function renderSetup() {
  const europe = setup.scenario === "europe";
  syncRow("setup-scenario", setup.scenario);
  syncRow("setup-nations", setup.nations);
  syncRow("setup-size", setup.size);
  syncRow("setup-difficulty", setup.difficulty);
  syncRow("setup-length", setup.length);
  syncRow("setup-winter", setup.winter);
  syncRow("setup-events", setup.events);
  syncRow("setup-factions", setup.factions);
  $("setup-nations").hidden = europe;
  $("setup-size").hidden = europe;
  $("setup-factions").hidden = !europe;

  const roster = rosterFor(setup.scenario);
  const seats = seatsFor(nationCountFor(setup));
  let player = 0;
  $("setup-seats").replaceChildren(
    ...seats.map((seat, n) => {
      const row = document.createElement("div");
      row.className = `seat ${seat}`;
      row.dataset.nation = n;
      const flag = document.createElement("img");
      flag.src = flagUrlFor(roster[n].flag);
      const name = document.createElement("span");
      name.textContent = roster[n].name;
      const trait = document.createElement("span");
      trait.className = "trait-tag";
      trait.textContent = TRAITS[roster[n].trait].name;
      name.append(trait);
      const role = document.createElement("span");
      role.className = "role";
      role.textContent = seat === "local" ? `PLAYER ${++player}` : "AI";
      row.append(flag, name, role);
      return row;
    }),
  );

  const humans = seats.filter((s) => s === "local").length;
  $("setup-note").textContent =
    humans > 1
      ? `${humans} players pass this device around. Each plans in secret, then all orders happen at once.`
      : europe
        ? "September 1939. Germany and Italy stand against Britain, France and Poland."
        : "You against the AI. Tap more nations to add friends for pass-and-play.";
}

export function setupOption(key, value) {
  if (key === "scenario") setup.scenario = value === "europe" ? "europe" : "random";
  else if (key === "size") setup.size = value;
  else if (key === "difficulty") setup.difficulty = value;
  else setup[key] = Number(value);
  save();
  renderSetup();
}

export function toggleSeat(nation) {
  const seats = seatsFor(nationCountFor(setup));
  seats[nation] = seats[nation] === "local" ? "ai" : "local";
  if (!seats.includes("local")) seats[nation] = "local";
  setup.seats = seats;
  save();
  renderSetup();
}

export function gameOptions(source = setup) {
  return {
    mapOptions: { scenario: source.scenario, nations: source.nations, size: source.size },
    maxTurns: source.length,
    rules: { winter: source.winter, events: source.events },
    difficulty: source.difficulty,
    factions: source.factions,
  };
}

export function startSetupGame() {
  const seats = seatsFor(nationCountFor(setup)).map((type) => ({ type }));
  newGame("practice", seats, randomSeed(), gameOptions());
}
