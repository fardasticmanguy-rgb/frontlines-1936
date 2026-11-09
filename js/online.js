import { planAiOrders } from "./ai.js";
import { NATIONS, NATION_NAMES, NATION_TRAITS } from "./config.js";
import { decodeOrders, decodeState, encodeOrders, encodeState } from "./codec.js";
import { flagImage } from "./flags.js";
import {
  applyAnimation,
  isGuest,
  isHost,
  newGame,
  runResolution,
  startAnimation,
  startDemo,
  startPlanning,
} from "./game.js";
import { transportReady } from "./net/transport.js";
import { randomSeed } from "./random.js";
import { emptyOrders, sanitizeOrders } from "./rules.js";
import { store } from "./store.js";
import {
  $,
  currentScreen,
  renderGameOver,
  renderPanel,
  renderTopBar,
  setBanner,
  showScreen,
  toast,
} from "./ui.js";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const HEARTBEAT_SECONDS = 1;
const SEAT_RECLAIM_MS = 15000;
const SAVE_LIFETIME_MS = 3 * 3600 * 1000;
const HOST_SAVE_KEY = "flHost2";
const NAME_KEY = "flName";
const NAME_LENGTH = 16;
const CODE_PATTERN = /^[A-Z0-9]{4}$/;
const GUEST_SAVE_KEY = "flGuest2";

export const playerId = (() => {
  let id = null;
  try {
    id = sessionStorage.getItem("flPid");
  } catch {}
  if (!id) {
    id = Math.random().toString(36).slice(2, 12);
    try {
      sessionStorage.setItem("flPid", id);
    } catch {}
  }
  return id;
})();

export function cleanName(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, "")
    .trim()
    .slice(0, NAME_LENGTH);
}

export function commanderName() {
  let name = "";
  try {
    name = cleanName(localStorage.getItem(NAME_KEY));
  } catch {}
  return name || `Commander ${playerId.slice(0, 3).toUpperCase()}`;
}

export function setCommanderName(value) {
  const name = cleanName(value);
  try {
    if (name) localStorage.setItem(NAME_KEY, name);
  } catch {}
}

let transportKind = null;
transportReady.then((transport) => (transportKind = transport?.kind ?? null));

export function onlineTransport() {
  return transportReady;
}

function readSave(key) {
  try {
    const save = JSON.parse(localStorage.getItem(key) || "null");
    return save && Date.now() - save.savedAt < SAVE_LIFETIME_MS ? save : null;
  } catch {
    return null;
  }
}

function writeSave(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ ...value, savedAt: Date.now() }));
  } catch {}
}

export const savedHostGame = () => readSave(HOST_SAVE_KEY);
export const savedGuestGame = () => readSave(GUEST_SAVE_KEY);
export const forgetGuestGame = () => writeSave(GUEST_SAVE_KEY, null);
export const clearHostedGame = () => writeSave(HOST_SAVE_KEY, null);

export function saveHostedGame(state) {
  const { game, map, net } = store;
  if (!isHost()) return;
  writeSave(HOST_SAVE_KEY, {
    code: net.code,
    gameId: net.gameId,
    seed: map.seed,
    timer: game.timer,
    seats: game.seats.map(({ type, playerId: id }) => ({ type, playerId: id })),
    state: state || game.state,
  });
}

let directory = null;
let directoryOpening = null;
let listingKey = null;

export function openDirectory() {
  if (directory) return Promise.resolve(directory);
  directoryOpening ??= transportReady
    .then((transport) => transport?.openDirectory({ browsing: () => currentScreen() === "online" }))
    .then((opened) => {
      if (!opened) return null;
      directory = opened;
      listingKey = null;
      opened.onPeers(() => renderPublicGames());
      renderPublicGames();
      return opened;
    })
    .catch(() => null)
    .finally(() => (directoryOpening = null));
  return directoryOpening;
}

export function closeDirectory() {
  const closing = directory;
  directory = null;
  listingKey = null;
  closing?.leave().catch(() => {});
  renderPublicGames();
}

function validListing(listing) {
  return (
    listing &&
    typeof listing.code === "string" &&
    CODE_PATTERN.test(listing.code) &&
    Number.isInteger(listing.players) &&
    listing.players >= 1 &&
    listing.players < NATIONS.length + 1
  );
}

function publicListings() {
  if (!directory) return [];
  const seen = new Set();
  return directory
    .peers()
    .filter((p) => !p.sameTab)
    .map((p) => p.presence?.listing)
    .filter((listing) => validListing(listing) && !seen.has(listing.code) && seen.add(listing.code))
    .sort((a, b) => b.players - a.players || a.code.localeCompare(b.code));
}

export function renderPublicGames() {
  const list = $("public-games");
  if (!list) return;
  const games = publicListings();
  if (!games.length) {
    const note = document.createElement("div");
    note.className = "note";
    note.textContent = directory ? "No public games right now. Host one!" : "Looking for public games…";
    list.replaceChildren(note);
    return;
  }
  list.replaceChildren(
    ...games.map((game) => {
      const row = document.createElement("button");
      row.className = "listing";
      row.dataset.code = game.code;
      const title = document.createElement("span");
      title.textContent = `${cleanName(game.name) || "Someone"}'s war`;
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = `${game.players}/${NATIONS.length} · JOIN`;
      row.append(title, count);
      return row;
    }),
  );
}

function updateListing(players) {
  const net = store.net;
  const visible =
    net?.role === "host" &&
    net.visibility === "public" &&
    currentScreen() === "lobby" &&
    players < NATIONS.length;
  if (visible && !directory) {
    openDirectory().then(() => updateListing(players));
    return;
  }
  if (!directory) return;
  const listing = visible ? { code: net.code, name: commanderName(), players } : null;
  const key = JSON.stringify(listing);
  if (key === listingKey) return;
  listingKey = key;
  directory.presence({ listing }).catch(() => {});
}

export function generateCode() {
  let code = "";
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

function roomPeers() {
  const room = store.net?.room;
  if (!room) return [];
  try {
    return room.peers().filter((p) => p.presence?.role === "host" || p.presence?.role === "guest");
  } catch {
    return [];
  }
}

function hostPeer() {
  const room = store.net.room;
  return roomPeers().find(
    (p) => p.presence.role === "host" && !p.sameTab && (!room.hostId || p.peer === room.hostId),
  );
}

export async function openRoom(code, role, resume = false) {
  const transport = await transportReady;
  if (!transport) throw { code: "unavailable" };
  const room = await transport.join(code, role, resume);
  store.net = {
    role,
    room,
    code,
    joinOrder: [],
    gameId: null,
    lastState: null,
    seatsKey: null,
    lobbyKey: null,
    timer: 45,
    maxTurns: 15,
    visibility: "private",
    hostMissingFor: 0,
    offlineFor: 0,
    sinceBroadcast: 0,
    unsubscribe: [room.onPeers(onRoomChange, () => {})],
  };
  const name = commanderName();
  const presence = role === "host" ? { role, phase: "lobby", playerId, name } : { role, playerId, name };
  await room.presence(presence).catch(() => {});
  if (role === "guest") writeSave(GUEST_SAVE_KEY, { code });
  return room;
}

export function leaveRoom() {
  const net = store.net;
  if (!net) return;
  for (const stop of net.unsubscribe) {
    try {
      stop();
    } catch {}
  }
  net.room.leave().catch(() => {});
  store.net = null;
  closeDirectory();
  setBanner(null);
}

function lobbySeats() {
  const net = store.net;
  const guests = [];
  for (const p of roomPeers()) {
    const id = p.presence.playerId;
    if (p.presence.role === "guest" && !p.sameTab && typeof id === "string" && !guests.includes(id)) {
      guests.push(id);
    }
  }
  net.joinOrder = net.joinOrder.filter((id) => guests.includes(id));
  for (const id of guests) if (!net.joinOrder.includes(id)) net.joinOrder.push(id);
  const seats = [playerId, ...net.joinOrder.slice(0, NATIONS.length - 1)];
  while (seats.length < NATIONS.length) seats.push("ai");
  return seats;
}

function seatRow(nation, title, detail) {
  const row = document.createElement("div");
  row.className = "seat";
  row.innerHTML = flagImage(nation);
  const name = document.createElement("span");
  name.className = "seat-name";
  name.textContent = title;
  const info = document.createElement("span");
  info.textContent = detail;
  row.append(name, info);
  return row;
}

function guestName(id) {
  const peer = roomPeers().find((p) => p.presence.playerId === id);
  return cleanName(peer?.presence.name);
}

export function renderLobby() {
  const net = store.net;
  if (!net) return;
  const hosting = net.role === "host";
  let seats = [];
  let names = [];

  if (hosting) {
    seats = lobbySeats();
    names = seats.map((id) => (id === "ai" ? "" : id === playerId ? commanderName() : guestName(id)));
    const key = JSON.stringify([seats, names, net.timer, net.maxTurns]);
    if (key !== net.lobbyKey) {
      net.lobbyKey = key;
      net.room
        .presence({
          role: "host",
          phase: "lobby",
          playerId,
          name: commanderName(),
          lobby: seats.join(","),
          names,
          timer: net.timer,
          length: net.maxTurns,
        })
        .catch(() => {});
    }
  } else {
    const host = hostPeer();
    if (typeof host?.presence.lobby === "string") seats = host.presence.lobby.split(",");
    if (Array.isArray(host?.presence.names)) names = host.presence.names;
  }

  $("lobby-code").textContent = net.code;
  $("lobby-seats").replaceChildren(
    ...seats.slice(0, NATIONS.length).map((id, n) => {
      const role = id === "ai" ? "AI COMMANDER" : n === 0 ? "HOST" : "PLAYER";
      const you = id === playerId ? " · YOU" : "";
      const title = id === "ai" ? NATION_NAMES[n] : `${NATION_NAMES[n]} · ${cleanName(names[n]) || "Player"}`;
      return seatRow(n, title, `${NATION_TRAITS[n].name} · ${role}${you}`);
    }),
  );

  for (const id of ["launch", "option-timer", "option-length", "option-visibility"]) $(id).hidden = !hosting;
  $("lobby-link").textContent =
    transportKind === "peer"
      ? "Friends open this same link, tap PLAY ONLINE and enter the code."
      : "Friends open this game on claude.ai, tap PLAY ONLINE and enter the code.";

  const humans = seats.filter((id) => id !== "ai").length;
  if (hosting) {
    updateListing(humans);
    const visibility =
      net.visibility === "public"
        ? "Listed in Public Games."
        : "Private: only people with the code can join.";
    $("lobby-note").textContent =
      humans < 2
        ? `Waiting for players… Empty seats are played by AI. ${visibility}`
        : `${humans} players in. Empty seats are played by AI. ${visibility}`;
    return;
  }
  const host = hostPeer();
  const settings =
    host && host.presence.timer !== undefined
      ? ` (${host.presence.length || 15} months, ${host.presence.timer ? `${host.presence.timer}s turns` : "no timer"})`
      : "";
  $("lobby-note").textContent = host
    ? `Connected! Waiting for the host to declare war…${settings}`
    : "Looking for the host… double-check the code.";
}

export function syncOptionButtons() {
  const net = store.net;
  if (!net) return;
  for (const [row, key] of [
    ["option-timer", "timer"],
    ["option-length", "maxTurns"],
    ["option-visibility", "visibility"],
  ]) {
    for (const button of $(row).querySelectorAll("button")) {
      button.classList.toggle("on", button.dataset.value === String(net[key]));
    }
  }
}

export function setLobbyOption(key, value) {
  const net = store.net;
  if (!net || net.role !== "host") return;
  net[key] = key === "visibility" ? (value === "public" ? "public" : "private") : Number(value);
  syncOptionButtons();
  renderLobby();
}

function onRoomChange() {
  const net = store.net;
  if (!net) return;
  if (currentScreen() === "lobby") renderLobby();
  if (net.role !== "guest") return;

  const host = hostPeer();
  if (!host) return;
  const presence = host.presence;
  if (
    presence.phase === "play" &&
    presence.gameId &&
    presence.gameId !== net.gameId &&
    typeof presence.state === "string"
  ) {
    net.gameId = presence.gameId;
    startGuestGame(presence);
  } else if (presence.phase === "lobby" && store.game?.mode === "online") {
    net.gameId = null;
    startDemo();
    showScreen("lobby");
    renderLobby();
  }
}

function seatsString() {
  return store.game.seats.map((s) => (s.type === "ai" ? "ai" : s.playerId)).join(",");
}

function deadlineSeconds(game) {
  if (!game.timer || !game.deadline || game.phase !== "plan") return -1;
  return Math.max(0, Math.round((game.deadline - performance.now()) / 1000));
}

export function launchGame() {
  const net = store.net;
  const seats = lobbySeats().map((id) => {
    if (id === playerId) return { type: "local", playerId };
    if (id === "ai") return { type: "ai" };
    return { type: "remote", playerId: id };
  });
  net.gameId = Math.random().toString(36).slice(2, 8);
  closeDirectory();
  newGame("online", seats, randomSeed(), { timer: net.timer, me: 0, maxTurns: net.maxTurns });
}

export function resumeHostedGame(save) {
  store.net.gameId = save.gameId;
  store.net.timer = save.timer;
  newGame(
    "online",
    save.seats.map((s) => ({ ...s })),
    save.seed,
    {
      timer: save.timer,
      me: 0,
      maxTurns: save.state.maxTurns,
      state: save.state,
    },
  );
}

export function hostBroadcast(state, events) {
  const { game, map, net } = store;
  if (!isHost()) return;
  net.sinceBroadcast = 0;
  const animation = game.animation;
  const shownState = state || (animation ? animation.after : game.state);
  const shownEvents = events || (animation ? animation.events : null);
  const extras = {
    deadline: deadlineSeconds(game),
    ready: game.ready,
    absent: game.seats.map((s) => Boolean(s.absent)),
  };
  net.room
    .presence({
      role: "host",
      playerId,
      phase: game.phase === "over" ? "over" : "play",
      gameId: net.gameId,
      seed: map.seed,
      hash: map.hash,
      seats: seatsString(),
      state: encodeState(shownState, extras, shownEvents),
      lobby: null,
      names: null,
    })
    .catch(() => {});
}

function seatPeer(nation) {
  const seat = store.game.seats[nation];
  if (seat.type !== "remote") return null;
  let latest = null;
  for (const p of roomPeers()) {
    if (p.presence.role !== "guest" || p.presence.playerId !== seat.playerId) continue;
    if (!latest || (p.updatedAt || 0) >= (latest.updatedAt || 0)) latest = p;
  }
  return latest;
}

function reassignAbandonedSeats(game) {
  const seated = new Set(game.seats.filter((s) => s.type !== "ai").map((s) => s.playerId));
  let changed = false;
  for (const p of roomPeers()) {
    const id = p.presence.playerId;
    if (p.presence.role !== "guest" || typeof id !== "string" || seated.has(id)) continue;
    const nation = game.seats.findIndex(
      (s, n) =>
        s.type === "remote" &&
        game.state.alive[n] &&
        s.absentSince &&
        performance.now() - s.absentSince > SEAT_RECLAIM_MS &&
        !seatPeer(n),
    );
    if (nation < 0) continue;
    Object.assign(game.seats[nation], { playerId: id, absent: false, absentSince: 0 });
    seated.add(id);
    changed = true;
    saveHostedGame();
  }
  return changed;
}

export function hostCheckReady() {
  const { game, map } = store;
  if (!isHost() || game.phase !== "plan" || game.animation) return;
  const { state } = game;
  let changed = reassignAbandonedSeats(game);
  let everyoneReady = true;

  for (const n of NATIONS) {
    if (!state.alive[n]) continue;
    const seat = game.seats[n];
    if (seat.type === "local") {
      if (!game.ready[n]) everyoneReady = false;
    } else if (seat.type === "remote") {
      const p = seatPeer(n);
      const absent = !p;
      if (Boolean(seat.absent) !== absent) {
        seat.absent = absent;
        seat.absentSince = absent ? performance.now() : 0;
        changed = true;
      }
      if (p) {
        const ready = p.presence.turn === state.turn && p.presence.ready ? 1 : 0;
        if (game.ready[n] !== ready) {
          game.ready[n] = ready;
          changed = true;
        }
        if (!ready) everyoneReady = false;
      }
    }
  }
  if (changed) {
    renderTopBar();
    hostBroadcast();
  }

  const expired = game.timer && game.deadline && performance.now() > game.deadline;
  if (!everyoneReady && !expired) return;

  const orders = NATIONS.map((n) => {
    const seat = game.seats[n];
    let planned;
    if (seat.type === "local") planned = game.orders[n];
    else if (seat.type === "remote" && seatPeer(n)) {
      const presence = seatPeer(n).presence;
      planned = presence.turn === state.turn ? decodeOrders(presence.orders) : emptyOrders();
    } else planned = planAiOrders(map, state, n);
    return sanitizeOrders(map, state, n, planned);
  });
  runResolution(orders);
}

export function sendGuestOrders() {
  const { game, net } = store;
  if (!isGuest()) return;
  const me = game.me;
  net.room
    .presence({
      role: "guest",
      playerId,
      name: commanderName(),
      turn: game.state.turn,
      orders: me >= 0 ? encodeOrders(game.orders[me]) : "",
      ready: me >= 0 && game.ready[me] ? 1 : 0,
    })
    .catch(() => {});
}

function seatsFrom(text) {
  const ids = String(text || "").split(",");
  const seats = NATIONS.map((n) => {
    const id = ids[n];
    if (!id || id === "ai") return { type: "ai" };
    return { type: id === playerId ? "local" : "remote", playerId: id };
  });
  return seats;
}

function startGuestGame(presence) {
  const net = store.net;
  const seats = seatsFrom(presence.seats);
  const me = seats.findIndex((s) => s.type === "local");
  newGame("online", seats, Number(presence.seed), { me });
  net.seatsKey = String(presence.seats || "");
  if (presence.hash !== store.map.hash) toast("Map mismatch with the host. Try leaving and rejoining.");
  net.lastState = null;
  applyHostPresence(presence, true);
  if (me < 0) toast("This war already started. You are spectating.");
}

function syncSeats(presence) {
  const { game, net } = store;
  const key = String(presence.seats || "");
  if (!key || key === net.seatsKey || game.phase === "over") {
    if (key) net.seatsKey = key;
    return;
  }
  net.seatsKey = key;
  seatsFrom(key).forEach((seat, n) => (game.seats[n] = { ...seat, absent: game.seats[n].absent }));
  const me = game.seats.findIndex((s) => s.type === "local");
  if (me === game.me) return;
  game.me = me;
  game.orders = NATIONS.map(() => emptyOrders());
  if (me >= 0) {
    game.ready[me] = 0;
    toast(`You are back in command of ${NATION_NAMES[me]}`);
    sendGuestOrders();
  }
  renderTopBar();
  renderPanel();
}

function applyHostPresence(presence, first) {
  const { game, map, net } = store;
  if (!first) syncSeats(presence);
  if (typeof presence.state !== "string" || presence.state === net.lastState) return;

  const decoded = decodeState(presence.state, map.provinces.length);
  if (!decoded) {
    net.lastState = presence.state;
    return;
  }
  const { state, ready, absent, deadline, events } = decoded;
  const applyMeta = () => {
    if (deadline >= 0) {
      const next = performance.now() + deadline * 1000;
      if (!game.deadline || Math.abs(next - game.deadline) > 1500) game.deadline = next;
    } else {
      game.deadline = 0;
    }
    game.timer = deadline >= 0 ? 1 : 0;
    game.seats.forEach((seat, n) => {
      if (seat.type === "remote") seat.absent = Boolean(absent[n]);
    });
  };

  if (state.turn > game.state.turn && !first) {
    net.lastState = presence.state;
    applyMeta();
    if (game.animation) {
      if (!game.animation.applied) applyAnimation();
      game.animation = null;
    }
    startAnimation(game.state, state, events);
    return;
  }
  if (game.animation) return;
  net.lastState = presence.state;
  if (!first && state.turn < game.state.turn) return;

  applyMeta();
  game.state = state;
  if (first) {
    if (state.winner >= 0) game.phase = "over";
    else startPlanning();
  }
  for (const n of NATIONS) if (n !== game.me) game.ready[n] = ready[n];
  if (state.winner >= 0 && (first || game.phase !== "over")) {
    game.phase = "over";
    renderGameOver();
  }
  renderTopBar();
  if (first) renderPanel();
}

export function networkTick(dt) {
  const { net } = store;
  if (net.role === "host") {
    net.sinceBroadcast += dt;
    if (net.sinceBroadcast > HEARTBEAT_SECONDS) hostBroadcast();
    if (!store.game.animation) hostCheckReady();
    const online = !net.room.connected || net.room.connected();
    net.offlineFor = online ? 0 : net.offlineFor + dt;
    setBanner(net.offlineFor > 4 ? "Connection lost. Reconnecting…" : null);
    return;
  }

  const host = hostPeer();
  if (host) {
    net.hostMissingFor = 0;
    setBanner(null);
    applyHostPresence(host.presence, false);
  } else if (store.game.phase !== "over") {
    net.hostMissingFor += dt;
    if (net.hostMissingFor > 3) setBanner("Host disconnected. Waiting for them to come back…");
  }
}

export function returnToLobby() {
  const net = store.net;
  net.gameId = null;
  net.lobbyKey = null;
  startDemo();
  net.room
    .presence({ role: "host", playerId, phase: "lobby", state: null, gameId: null, seats: null })
    .catch(() => {});
  showScreen("lobby");
  syncOptionButtons();
  renderLobby();
}

export function syncGuestLobby() {
  onRoomChange();
}
