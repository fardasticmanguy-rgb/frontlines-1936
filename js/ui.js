import { playSound } from "./audio.js";
import { BUILD_COST, BUILDING, NATIONS, NATION_NAMES, TERRAIN_NAMES, dateOf } from "./config.js";
import { flagImage, flagUrls } from "./flags.js";
import { applyPanelAction, availableFrom, canPlan, industryLeft, isGuest, isOnline } from "./game.js";
import {
  defenseMultiplier,
  defenseStrength,
  divisionCount,
  factoryCount,
  income,
  provinceCount,
  victoryGoal,
  victoryPoints,
} from "./rules.js";
import { store } from "./store.js";

export const $ = (id) => document.getElementById(id);

const round1 = (value) => Math.round(value * 10) / 10;
const NEWS_DURATION = 3000;
const FEED_LIMIT = 4;

export function showScreen(id) {
  for (const screen of document.querySelectorAll(".screen")) {
    screen.classList.toggle("on", screen.id === id);
  }
}

export function currentScreen() {
  return document.querySelector(".screen.on")?.id ?? null;
}

export function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 2600);
}

export function postFeed(message, nation) {
  const feed = $("feed");
  const item = document.createElement("div");
  item.className = "feed-item";
  item.innerHTML = flagImage(nation);
  item.append(message);
  feed.prepend(item);
  while (feed.children.length > FEED_LIMIT) feed.lastChild.remove();
  setTimeout(() => {
    item.style.opacity = 0;
    setTimeout(() => item.remove(), 700);
  }, 5500);
}

export function clearFeed() {
  $("feed").replaceChildren();
}

const newsQueue = [];
let newsShowing = false;

function showNextNews() {
  const card = $("news");
  const item = newsQueue.shift();
  newsShowing = Boolean(item);
  if (!item) {
    card.hidden = true;
    return;
  }
  $("news-title").textContent = item.title;
  $("news-text").textContent = item.text;
  $("news-flag").src = flagUrls[item.nation] ?? "";
  $("news-flag").hidden = !NATIONS.includes(item.nation);
  card.hidden = true;
  void card.offsetWidth;
  card.hidden = false;
  setTimeout(showNextNews, NEWS_DURATION);
}

export function postNews(title, text, nation) {
  newsQueue.push({ title, text, nation });
  if (!newsShowing) showNextNews();
}

export function setBanner(message) {
  const el = $("banner");
  if (!message) {
    el.hidden = true;
    return;
  }
  if (el.textContent !== message) el.textContent = message;
  el.hidden = false;
}

let wakeLock = null;

export async function keepAwake() {
  if (!navigator.wakeLock || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => (wakeLock = null));
  } catch {
    wakeLock = null;
  }
}

export function syncZoomButton() {
  const game = store.game;
  const zoomed = Boolean(game && game.mode !== "demo" && game.zoom > 1.04);
  const button = $("fit-button");
  if (button.hidden === zoomed) button.hidden = !zoomed;
}

function nationBadge(game, nation) {
  const { state } = game;
  if (!state.alive[nation]) return "";
  const seat = game.seats[nation];
  if (seat.type === "ai") return '<span class="badge ai">AI</span>';
  if (seat.type === "remote" && seat.absent) return '<span class="badge away">AI</span>';
  if (isOnline() && game.ready[nation] && game.phase === "plan") return '<span class="badge">✓</span>';
  return "";
}

export function renderTopBar() {
  const { game, map } = store;
  const bar = $("top-bar");
  bar.hidden = !game || game.mode === "demo";
  if (bar.hidden) return;

  const { state, me } = game;
  const flag = $("nation-flag");
  if (me >= 0) {
    if (flag.getAttribute("src") !== flagUrls[me]) flag.src = flagUrls[me];
    flag.hidden = false;
    $("nation-name").textContent = NATION_NAMES[me];
    const industry = canPlan() ? industryLeft() : state.industry[me];
    $("stat-industry").innerHTML = `⚙ ${industry} <b>+${income(map, state, me)}</b><small>INDUSTRY</small>`;
    $("stat-factories").innerHTML = `🏭 ${factoryCount(state, me)}<small>FACTORIES</small>`;
    $("stat-victory").innerHTML =
      `★ ${victoryPoints(map, state, me)}/${victoryGoal(map)}<small>VICTORY PTS</small>`;
  } else {
    flag.hidden = true;
    $("nation-name").textContent = "SPECTATOR";
    for (const id of ["stat-industry", "stat-factories", "stat-victory"]) $(id).innerHTML = "";
  }

  $("date").textContent = dateOf(Math.min(state.turn, state.maxTurns));
  $("nations").innerHTML = NATIONS.map(
    (n) => `
      <div class="nation ${me === n ? "me" : ""} ${state.alive[n] ? "" : "dead"}">
        <img src="${flagUrls[n]}" alt="">${nationBadge(game, n)}
        <span>★${victoryPoints(map, state, n)}</span>
      </div>`,
  ).join("");

  const button = $("end-turn");
  button.hidden =
    Boolean(game.animation) || me < 0 || !state.alive[me] || state.winner >= 0 || game.phase !== "plan";
  const waiting = isOnline() && game.ready[me];
  button.textContent = waiting ? "READY ✓" : isOnline() ? "READY" : "END TURN";
  button.classList.toggle("waiting", Boolean(waiting));
  updateClock();
}

export function updateClock() {
  const game = store.game;
  if (!game || game.mode === "demo") return;
  const { state } = game;
  let text = `TURN ${Math.min(state.turn, state.maxTurns)} / ${state.maxTurns}`;
  let urgent = false;

  if (game.phase === "plan" && !game.animation && game.deadline) {
    const seconds = Math.max(0, Math.ceil((game.deadline - performance.now()) / 1000));
    text += ` · ⏱ ${seconds}s`;
    urgent = seconds <= 10;
    if (urgent && seconds > 0 && seconds !== game.lastTick && canPlan()) {
      game.lastTick = seconds;
      playSound("tick");
    }
  }
  const el = $("clock");
  if (el.textContent !== text) el.textContent = text;
  el.classList.toggle("urgent", urgent);
}

function idleMessage(game) {
  const { state, me } = game;
  if (me < 0) return "You are watching this war as a spectator.";
  if (state.winner >= 0) return "The war is over.";
  if (!state.alive[me]) return "Your nation has been defeated. Watch the rest of the war unfold.";
  if (game.animation) return "Orders are being carried out…";
  if (game.ready[me])
    return "Orders locked in. Waiting for the other nations… Tap READY again to change your plan.";
  if (state.turn <= 2) {
    const button = isOnline() ? "READY" : "END TURN";
    return `<b class="gold">Drag</b> from your land onto a neighbor to attack. Tap a <b class="gold">city</b> to train divisions or build. When your plan is set, hit <b class="green">${button}</b>.`;
  }
  return "Drag from your land onto a neighbor to attack or move. Tap a city to train divisions or build.";
}

function economyBlock(game, map) {
  if (game.me < 0) return "";
  const { state, me } = game;
  const industry = canPlan() ? industryLeft() : state.industry[me];
  return `
    <div class="economy">
      ⚙ <b>${industry}</b> industry<br>
      +${income(map, state, me)} per turn<br>
      ★ <b>${victoryPoints(map, state, me)}</b> / ${victoryGoal(map)} VP
    </div>`;
}

function overviewPanel(game, map) {
  const { state, me } = game;
  const summary =
    me >= 0 ? ` · ${provinceCount(state, me)} provinces · ${divisionCount(state, me)} divisions` : "";
  return `
    <div class="info wide">
      <div class="info-head">${flagImage(me)}
        <div>
          <div class="info-title">${me >= 0 ? NATION_NAMES[me] : "SPECTATOR"}</div>
          <div class="info-sub">${dateOf(Math.min(state.turn, state.maxTurns))}${summary}</div>
        </div>
      </div>
      <div class="hint">${idleMessage(game)}</div>
    </div>`;
}

function provinceInfo(map, state, id) {
  const p = map.provinces[id];
  const owner = state.owner[id];
  const building =
    { [BUILDING.FORT]: " · Fort", [BUILDING.FACTORY]: " · Factory" }[state.buildings[id]] ?? "";
  const city = p.city ? (p.capitalOf >= 0 ? " · <b>Capital ★3</b>" : " · <b>City ★1</b>") : "";
  return `
    <div class="info">
      <div class="info-head">${flagImage(owner)}
        <div>
          <div class="info-title">${p.name}</div>
          <div class="info-sub">${owner >= 0 ? NATION_NAMES[owner] : "Unclaimed territory"}</div>
        </div>
      </div>
      <div class="meta">${TERRAIN_NAMES[p.terrain]}${building}${city}</div>
      <div class="meta">${state.troops[id]} divisions · defense ×${round1(defenseMultiplier(map, state, id))}
        = <b>${round1(defenseStrength(map, state, id))}</b></div>
    </div>`;
}

function orderRows(game, map, id) {
  const { state, me } = game;
  const p = map.provinces[id];
  const orders = game.orders[me];
  const outgoing = orders.moves.filter((m) => m.from === id);
  const rows = [];

  if (!outgoing.length) {
    rows.push(
      `<div class="row muted">Drag onto a neighbor to send divisions (${availableFrom(id)} free)</div>`,
    );
  }
  for (const m of outgoing) {
    const friendly = state.owner[m.to] === me;
    const defense = defenseStrength(map, state, m.to);
    const winning = friendly || m.count > defense;
    const verdict = friendly ? "reinforce" : `${winning ? "✔ beats" : "✖ loses to"} ${round1(defense)}`;
    const data = `data-from="${id}" data-to="${m.to}"`;
    rows.push(`
      <div class="row">
        <span class="label">→ ${map.provinces[m.to].name}</span>
        <button data-action="less" ${data}>−</button><b>${m.count}</b>
        <button data-action="more" ${data}>+</button>
        <button data-action="all" ${data}>ALL</button>
        <span class="${winning ? "good" : "bad"}">${verdict}</span>
        <button data-action="cancel" ${data}>✕</button>
      </div>`);
  }

  if (p.city) {
    rows.push(`
      <div class="row">
        <span class="label">Train divisions</span>
        <button data-action="unrecruit" data-id="${id}">−</button><b>${orders.recruits[id] || 0}</b>
        <button data-action="recruit1" data-id="${id}">+1</button>
        <button data-action="recruit5" data-id="${id}">+5</button>
        <button data-action="recruitMax" data-id="${id}">MAX</button>
      </div>`);
  }
  if (p.city && state.buildings[id] === BUILDING.NONE) {
    const active = (kind) => (orders.builds[id] === kind ? "on" : "");
    rows.push(`
      <div class="row">
        <span class="label">Construct</span>
        <button class="${active(BUILDING.FORT)}" data-action="fort" data-id="${id}">FORT ⚙${BUILD_COST[BUILDING.FORT]}</button>
        <button class="${active(BUILDING.FACTORY)}" data-action="factory" data-id="${id}">FACTORY ⚙${BUILD_COST[BUILDING.FACTORY]}</button>
      </div>`);
  }
  return `<div class="actions">${rows.join("")}</div>`;
}

export function renderPanel() {
  const { game, map } = store;
  const panel = $("panel");
  panel.hidden = !game || game.mode === "demo";
  if (panel.hidden) return;

  const id = game.selected;
  if (!map.provinces[id]) {
    panel.innerHTML = overviewPanel(game, map) + economyBlock(game, map);
    return;
  }
  const mine = canPlan() && game.state.owner[id] === game.me;
  panel.innerHTML =
    provinceInfo(map, game.state, id) + (mine ? orderRows(game, map, id) : "") + economyBlock(game, map);
}

export function bindPanel() {
  $("panel").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const { action, from, to, id } = button.dataset;
    applyPanelAction(action, { from: Number(from), to: Number(to), id: Number(id) });
  });
}

export function renderGameOver() {
  const { game, map } = store;
  if (!game || game.mode === "demo" || game.phase !== "over") return;
  const { state, me } = game;
  const winner = state.winner;
  const featured = winner >= 0 ? winner : me;

  $("over-kicker").textContent = winner === me ? "VICTORY" : me >= 0 ? "DEFEAT" : "THE WAR IS OVER";
  $("over-title").textContent =
    winner < 0
      ? `${NATION_NAMES[me]} HAS FALLEN`
      : winner < 4
        ? `${NATION_NAMES[winner]} WINS`
        : "NO NATION SURVIVES";
  $("over-flag").hidden = !NATIONS.includes(featured);
  if (NATIONS.includes(featured)) $("over-flag").src = flagUrls[featured];

  const ranking = NATIONS.slice().sort(
    (a, b) =>
      (b === winner) - (a === winner) ||
      victoryPoints(map, state, b) - victoryPoints(map, state, a) ||
      provinceCount(state, b) - provinceCount(state, a),
  );
  $("over-standings").innerHTML = ranking
    .map(
      (n) => `
        <div class="seat ${n === winner ? "winner" : ""}">${flagImage(n)}${NATION_NAMES[n]}
          <span>★${victoryPoints(map, state, n)} · ${provinceCount(state, n)} provinces</span>
        </div>`,
    )
    .join("");

  const guest = isGuest();
  $("over-again").hidden = guest;
  $("over-again").textContent = isOnline() ? "BACK TO LOBBY" : "PLAY AGAIN";
  $("over-note").textContent = guest ? "Waiting for the host to start a new war…" : "";
  playSound(winner === me ? "victory" : "defeat");
  showScreen("over");
}
