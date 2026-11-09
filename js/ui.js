import { playSound } from "./audio.js";
import {
  BUILDING,
  NATIONS,
  NATION_NAMES,
  NATION_TRAITS,
  SUPPLY_DEFENSE,
  TERRAIN_NAMES,
  dateOf,
} from "./config.js";
import { flagImage, flagUrls } from "./flags.js";
import {
  applyPanelAction,
  availableFrom,
  canPlan,
  industryLeft,
  isGuest,
  isHotseat,
  isOnline,
  localSeats,
} from "./game.js";
import {
  FACTORY_OUTPUT,
  KEEP_OFFER,
  areAllied,
  attackStrength,
  blocOf,
  blocPoints,
  factionCap,
  factionMembers,
  factionOf,
  relativeTurn,
  warLength,
  winterActive,
  buildCostAt,
  canBuild,
  defenseMultiplier,
  defenseStrength,
  divisionCount,
  factoryCount,
  income,
  isSupplied,
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

const inDemo = () => !store.game || store.game.mode === "demo";

export function postFeed(message, nation) {
  if (inDemo()) return;
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
  if (inDemo()) return;
  newsQueue.push({ title, text, nation });
  if (!newsShowing) showNextNews();
}

export function postWorldEvent(event) {
  const { map } = store;
  const nation = NATION_NAMES[event.nation] ?? "";
  const place = map.provinces[event.province]?.name ?? "";
  const news = {
    volunteers: [`VOLUNTEERS FLOCK TO ${nation}`, `${event.amount} fresh divisions muster in ${place}.`],
    boom: [`INDUSTRIAL BOOM IN ${nation}`, `Factories run day and night: +${event.amount} ⚙ industry.`],
    strikes: [
      `GENERAL STRIKE IN ${nation}`,
      `Workers down tools across the country: −${event.amount} ⚙ industry.`,
    ],
    partisans: [
      `PARTISANS RISE IN ${place.toUpperCase()}`,
      `Resistance fighters ambush the ${nation} garrison: ${event.amount} divisions lost.`,
    ],
    harvest: [
      "BUMPER HARVEST",
      `Full granaries across the continent. Every nation gains +${event.amount} ⚙.`,
    ],
  }[event.kind];
  if (news) postNews(news[0], news[1], event.nation);
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

export function inPlay() {
  return NATIONS.slice(0, store.map?.nationCount ?? 4);
}

export function factionName(state, id) {
  if (id < 0) return "";
  const members = NATIONS.filter((n) => state.faction[n] === id);
  const named = store.map?.factionNames?.[id];
  if (named && members.some((n) => named.core.includes(n))) return named.name;
  return `${(members.length ? members : [id]).map((n) => NATION_NAMES[n]).join("–")} PACT`;
}

function pactClass(game, nation) {
  const { state, me } = game;
  if (me < 0 || nation === me || !state.alive[nation]) return "";
  if (areAllied(state, me, nation)) return "allied";
  if (state.offers[nation] === me && !areAllied(state, me, nation)) return "courting";
  return "";
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
    $("stat-factories").innerHTML = `🏭 ${factoryCount(state, me)}<small>FACTORY LV</small>`;
    const bloc = blocOf(state, me);
    $("stat-victory").innerHTML =
      bloc.length > 1
        ? `★ ${blocPoints(map, state, bloc)}/${victoryGoal(map, bloc.length)}<small>FACTION VP</small>`
        : `★ ${victoryPoints(map, state, me)}/${victoryGoal(map)}<small>VICTORY PTS</small>`;
  } else {
    flag.hidden = true;
    $("nation-name").textContent = "SPECTATOR";
    for (const id of ["stat-industry", "stat-factories", "stat-victory"]) $(id).innerHTML = "";
  }

  const shownTurn = Math.min(state.turn, state.maxTurns);
  const winter = winterActive({ ...state, turn: shownTurn });
  $("date").textContent = `${winter ? "❄ " : ""}${dateOf(shownTurn)}`;
  $("date").classList.toggle("winter", winter);
  $("nations").classList.toggle("crowded", inPlay().length > 5);
  $("nations").innerHTML = inPlay()
    .map(
      (n) => `
      <div class="nation ${me === n ? "me" : ""} ${state.alive[n] ? "" : "dead"} ${game.selectedNation === n ? "picked" : ""} ${pactClass(game, n)}" data-nation="${n}">
        <img src="${flagUrls[n]}" alt="">${nationBadge(game, n)}
        <span>★${victoryPoints(map, state, n)}</span>
      </div>`,
    )
    .join("");

  const button = $("end-turn");
  button.hidden =
    Boolean(game.animation) || me < 0 || !state.alive[me] || state.winner >= 0 || game.phase !== "plan";
  const waiting = isOnline() && game.ready[me];
  const handing = isHotseat(game) && localSeats(game).some((n) => n !== me && !game.planned[n]);
  button.textContent = waiting ? "READY ✓" : isOnline() ? "READY" : handing ? "DONE ➜" : "END TURN";
  button.classList.toggle("waiting", Boolean(waiting));
  updateClock();
}

export function updateClock() {
  const game = store.game;
  if (!game || game.mode === "demo") return;
  const { state } = game;
  let text = `TURN ${Math.min(relativeTurn(state), warLength(state))} / ${warLength(state)}`;
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
  if (relativeTurn(state) <= 2) {
    const button = isOnline() ? "READY" : "END TURN";
    return `<b class="gold">Drag</b> from your land onto a neighbor to attack. Tap a <b class="gold">city</b> to train divisions or build. When your plan is set, hit <b class="green">${button}</b>.`;
  }
  if (winterActive(state))
    return "❄ Winter: attacks are 20% weaker. A good month to dig in, train and build.";
  return "Drag from your land onto a neighbor to attack or move. Cut enemy provinces off from their cities to starve them.";
}

function traitLine(nation) {
  const trait = NATION_TRAITS[nation];
  return trait ? `<div class="trait"><b>${trait.name}</b> · ${trait.text}</div>` : "";
}

function reportLine(game) {
  const report = game.reports?.[game.me] ?? game.report;
  if (!report || game.animation || game.state.winner >= 0 || !game.state.alive[game.me]) return "";
  const chips = [];
  if (report.gained) chips.push(`<span class="good">+${report.gained} taken</span>`);
  if (report.lost) chips.push(`<span class="bad">−${report.lost} lost</span>`);
  if (report.attrition) chips.push(`<span class="bad">${report.attrition} starved</span>`);
  if (report.divisions) {
    chips.push(`<span>${report.divisions > 0 ? "+" : "−"}${Math.abs(report.divisions)} divisions</span>`);
  }
  chips.push(`<span class="good">⚙ +${report.income}</span>`);
  return `<div class="report"><b>LAST MONTH</b>${chips.join("")}</div>`;
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
      ${me >= 0 ? traitLine(me) : ""}
      ${reportLine(game)}
      <div class="hint">${idleMessage(game)}</div>
    </div>`;
}

function provinceInfo(map, state, id) {
  const p = map.provinces[id];
  const owner = state.owner[id];
  const level = state.factories[id];
  const building =
    (state.forts[id] ? " · Fort" : "") +
    (level ? ` · <b class="gold">Factory L${level}</b> (+${level * FACTORY_OUTPUT} ⚙)` : "");
  const city = p.city ? (p.capitalOf >= 0 ? " · <b>Capital ★3</b>" : " · <b>City ★1</b>") : "";
  const supply =
    owner >= 0 && !isSupplied(map, state, id)
      ? `<div class="meta bad">⚠ OUT OF SUPPLY · defense ×${SUPPLY_DEFENSE} · loses divisions every turn</div>`
      : "";
  return `
    <div class="info">
      <div class="info-head">${flagImage(owner)}
        <div>
          <div class="info-title">${p.name}</div>
          <div class="info-sub">${owner >= 0 ? NATION_NAMES[owner] : p.realm ? `Neutral ${p.realm}` : "Unclaimed territory"}</div>
        </div>
      </div>
      <div class="meta">${TERRAIN_NAMES[p.terrain]}${building}${city}</div>
      <div class="meta">${state.troops[id]} divisions · defense ×${round1(defenseMultiplier(map, state, id))}
        = <b>${round1(defenseStrength(map, state, id))}</b></div>
      ${supply}
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
    const strength = attackStrength(state, me, m.count);
    const winning = friendly || strength > defense;
    const verdict = friendly
      ? "reinforce"
      : `${round1(strength)} ${winning ? "✔ beats" : "✖ loses to"} ${round1(defense)}`;
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
  const fortOk = canBuild(map, state, me, id, BUILDING.FORT);
  const factoryOk = canBuild(map, state, me, id, BUILDING.FACTORY);
  if (fortOk || factoryOk) {
    const active = (kind) => (orders.builds[id] === kind ? "on" : "");
    const level = state.factories[id];
    const factoryLabel = level ? `UPGRADE TO L${level + 1}` : "FACTORY";
    const payback = `+${FACTORY_OUTPUT} ⚙/turn`;
    rows.push(`
      <div class="row">
        <span class="label">Construct</span>
        ${fortOk ? `<button class="${active(BUILDING.FORT)}" data-action="fort" data-id="${id}">FORT ⚙${buildCostAt(state, me, id, BUILDING.FORT)}</button>` : ""}
        ${factoryOk ? `<button class="${active(BUILDING.FACTORY)}" data-action="factory" data-id="${id}">${factoryLabel} ⚙${buildCostAt(state, me, id, BUILDING.FACTORY)}</button><span class="muted">${payback}</span>` : ""}
      </div>`);
  }
  return `<div class="actions">${rows.join("")}</div>`;
}

function relationOf(game, map, nation) {
  const { state, me } = game;
  const plan = me >= 0 ? game.orders[me] : null;
  const theirs = factionOf(state, nation);
  const mine = factionOf(state, me);
  const theirName = factionName(state, theirs);
  const myName = factionName(state, mine);
  const full = (id) => id >= 0 && factionMembers(state, id).length >= factionCap(map);
  if (!state.alive[nation]) return { text: "Defeated" };
  if (nation === me || me < 0 || !state.alive[me]) {
    const text = theirs >= 0 ? `Member of the <b class="gold">${theirName}</b>` : "No allies";
    if (nation !== me || mine < 0) return { text };
    return plan?.breakAlliance
      ? { text: `${text} · <span class="bad">leaving this turn</span>`, action: "diplo-keep", label: "STAY" }
      : { text, action: "diplo-break", label: `LEAVE THE ${myName}`, danger: true };
  }
  if (areAllied(state, me, nation)) {
    return plan?.breakAlliance
      ? {
          text: `🤝 Fellow member of the ${myName} · <span class="bad">you are leaving this turn</span>`,
          action: "diplo-keep",
          label: "STAY IN THE FACTION",
        }
      : {
          text: `🤝 <span class="good">Fellow member of the ${myName}</span> · you can't attack each other`,
          action: "diplo-break",
          label: `LEAVE THE ${myName}`,
          danger: true,
        };
  }
  const atWar = '<span class="bad">At war</span>';
  if (mine >= 0 && theirs >= 0) return { text: `${atWar} · member of the ${theirName}` };
  const standing = plan && plan.offer !== KEEP_OFFER ? plan.offer : state.offers[me];
  if (standing === nation) {
    return { text: "✉ Your offer is on the table", action: "diplo-withdraw", label: "WITHDRAW OFFER" };
  }
  if (full(theirs) || full(mine)) {
    return { text: `${atWar}${theirs >= 0 ? ` · member of the ${theirName}` : ""} · that faction is full` };
  }
  if (state.offers[nation] === me) {
    const label =
      theirs >= 0 ? `JOIN THE ${theirName}` : mine >= 0 ? `ACCEPT INTO THE ${myName}` : "ACCEPT ALLIANCE";
    return { text: '✉ <span class="good">They want an alliance!</span>', action: "diplo-offer", label };
  }
  const label =
    theirs >= 0 ? `ASK TO JOIN THE ${theirName}` : mine >= 0 ? `INVITE TO THE ${myName}` : "OFFER ALLIANCE";
  const text = theirs >= 0 ? `${atWar} · member of the ${theirName}` : atWar;
  return { text, action: "diplo-offer", label };
}

function aidRow(game, nation) {
  const { me } = game;
  if (!canPlan() || nation === me || me < 0 || !game.state.alive[nation]) return "";
  const plan = game.orders[me];
  const amount = plan.aidTo === nation ? plan.aidAmount : 0;
  return `
    <div class="row">
      <span class="label">Send aid</span>
      <button data-action="aid-less" data-id="${nation}">−</button><b>⚙ ${amount}</b>
      <button data-action="aid1" data-id="${nation}">+1</button>
      <button data-action="aid5" data-id="${nation}">+5</button>
      ${amount ? `<button data-action="aid-clear" data-id="${nation}">✕</button>` : ""}
      <span class="muted">arrives as industry next turn</span>
    </div>`;
}

function diplomacyPanel(game, map, nation) {
  const { state } = game;
  const relation = relationOf(game, map, nation);
  const trait = NATION_TRAITS[nation];
  const goals = `★ ${victoryGoal(map)} to win alone, ${victoryGoal(map, 2)} for two allies, ${victoryGoal(map, 3)} for three`;
  const button =
    relation.action && canPlan()
      ? `<div class="row"><button class="${relation.danger ? "danger" : "go"}" data-action="${relation.action}" data-id="${nation}">${relation.label}</button></div>
         <div class="row muted">Pacts form once both sides have offered. Factions share supply, fight together and win together (${goals}).</div>`
      : "";
  const actions =
    button || aidRow(game, nation) ? `<div class="actions">${button}${aidRow(game, nation)}</div>` : "";
  return `
    <div class="info">
      <div class="info-head">${flagImage(nation)}
        <div>
          <div class="info-title">${NATION_NAMES[nation]}</div>
          <div class="info-sub">★ ${victoryPoints(map, state, nation)} · ${provinceCount(state, nation)} provinces · ${divisionCount(state, nation)} divisions · 🏭 ${factoryCount(state, nation)} · ⚙ ${state.industry[nation]}</div>
        </div>
      </div>
      <div class="trait"><b>${trait.name}</b> · ${trait.text}</div>
      <div class="meta">${relation.text}</div>
    </div>${actions}`;
}

export function showHandoff(nation) {
  const { game, map } = store;
  $("handoff-flag").src = flagUrls[nation];
  $("handoff-name").textContent = NATION_NAMES[nation];
  const seat = localSeats(game).indexOf(nation) + 1;
  $("handoff-kicker").textContent = `PLAYER ${seat} · ${dateOf(game.state.turn)}`;
  const report = game.reports?.[nation];
  $("handoff-note").textContent = report
    ? `Last month: ${report.gained} taken, ${report.lost} lost. ★ ${victoryPoints(map, game.state, nation)}`
    : "Pass the device. No peeking at the other plans!";
  showScreen("handoff");
}

export function renderPanel() {
  const { game, map } = store;
  const panel = $("panel");
  panel.hidden = !game || game.mode === "demo";
  if (panel.hidden) return;

  if (NATIONS.includes(game.selectedNation)) {
    panel.innerHTML = diplomacyPanel(game, map, game.selectedNation) + economyBlock(game, map);
    return;
  }

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
  $("nations").addEventListener("click", (event) => {
    const game = store.game;
    const flag = event.target.closest("[data-nation]");
    if (!game || !flag) return;
    const nation = Number(flag.dataset.nation);
    game.selectedNation = game.selectedNation === nation ? -1 : nation;
    game.selected = -1;
    playSound("click");
    renderTopBar();
    renderPanel();
  });
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
  const winners = NATIONS.includes(winner) ? blocOf(state, winner) : [];
  const humans = game.mode === "online" ? [me] : NATIONS.filter((n) => game.seats[n].type === "local");
  const won = winners.some((n) => humans.includes(n));
  const hotseat = humans.length > 1;

  $("over-kicker").textContent = hotseat
    ? "THE WAR IS OVER"
    : won
      ? "VICTORY"
      : me >= 0
        ? "DEFEAT"
        : "THE WAR IS OVER";
  $("over-title").textContent =
    winner < 0
      ? `${NATION_NAMES[me]} HAS FALLEN`
      : winner < NATIONS.length
        ? winners.length > 1
          ? `${winners.map((n) => NATION_NAMES[n]).join(" & ")} WIN`
          : `${NATION_NAMES[winner]} WINS`
        : "NO NATION SURVIVES";
  $("over-flag").hidden = !NATIONS.includes(featured);
  if (NATIONS.includes(featured)) $("over-flag").src = flagUrls[featured];

  const ranking = inPlay().sort(
    (a, b) =>
      winners.includes(b) - winners.includes(a) ||
      victoryPoints(map, state, b) - victoryPoints(map, state, a) ||
      provinceCount(state, b) - provinceCount(state, a),
  );
  $("over-standings").innerHTML = ranking
    .map(
      (n) => `
        <div class="seat ${winners.includes(n) ? "winner" : ""}">${flagImage(n)}${NATION_NAMES[n]}
          <span>★${victoryPoints(map, state, n)} · ${provinceCount(state, n)} provinces</span>
        </div>`,
    )
    .join("");

  const guest = isGuest();
  $("over-again").hidden = guest;
  $("over-again").textContent = isOnline() ? "BACK TO LOBBY" : "PLAY AGAIN";
  $("over-note").textContent = guest ? "Waiting for the host to start a new war…" : "";
  playSound(won ? "victory" : "defeat");
  showScreen("over");
}
