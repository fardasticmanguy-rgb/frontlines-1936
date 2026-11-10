import { isMuted, setMuted, unlockAudio } from "./audio.js";
import { NATIONS } from "./config.js";
import * as gameFlow from "./game.js";
import { endTurn, isGuest, isHost, isOnline, newGame, startDemo, tick } from "./game.js";
import { bindMapInput } from "./input.js";
import * as online from "./online.js";
import {
  clearHostedGame,
  closeDirectory,
  commanderName,
  forgetGuestGame,
  generateCode,
  launchGame,
  leaveRoom,
  onLobbyClosed,
  onlineTransport,
  openDirectory,
  openRoom,
  renderLobby,
  renderPublicGames,
  resumeHostedGame,
  returnToLobby,
  savedGuestGame,
  savedHostGame,
  setCommanderName,
  setLobbyOption,
  syncGuestLobby,
  syncOptionButtons,
} from "./online.js";
import { randomSeed } from "./random.js";
import { canvas, render } from "./render.js";
import * as rules from "./rules.js";
import { store } from "./store.js";
import {
  $,
  bindPanel,
  keepAwake,
  renderPanel,
  renderTopBar,
  showScreen,
  syncZoomButton,
  toast,
  updateClock,
} from "./ui.js";
import { renderSetup, setupOption, startSetupGame, toggleSeat } from "./setup.js";
import { cycleRotate, resetZoom, resizeViewport, view, viewSettings } from "./view.js";

const ERROR_MESSAGES = {
  not_found: "No game found with that code.",
  gone: "That lobby just closed. Pick another or host your own.",
  unavailable: "Online play is not available here.",
  not_permitted: "Online rooms are not available for this account.",
  timeout: "Connection timed out. Check your internet and try again.",
};

function on(id, handler) {
  $(id).addEventListener("click", (event) => {
    unlockAudio();
    handler(event);
  });
}

let onlineBusy = false;

function setOnlineBusy(busy, message) {
  onlineBusy = busy;
  $("host-game").disabled = busy;
  $("join-game").disabled = busy;
  $("public-games").classList.toggle("busy", busy);
  if (message) $("online-note").textContent = message;
}

function reportNetworkError(error, joining) {
  const message =
    ERROR_MESSAGES[error?.code] ?? (joining ? "Could not join. Try again." : "Could not host. Try again.");
  toast(message);
  $("online-note").textContent = message;
}

function refreshResumeButton() {
  const button = $("resume-game");
  const hosted = savedHostGame();
  const joined = savedGuestGame();
  button.hidden = !hosted && !joined;
  if (hosted) {
    button.textContent = `RESUME HOSTED WAR · ${hosted.code}`;
    button.dataset.kind = "host";
  } else if (joined) {
    button.textContent = `REJOIN WAR · ${joined.code}`;
    button.dataset.kind = "guest";
  }
}

function backToMenu() {
  leaveRoom();
  closeDirectory();
  startDemo();
  refreshResumeButton();
  renderTopBar();
  renderPanel();
  showScreen("menu");
}

function openLobby() {
  showScreen("lobby");
  syncOptionButtons();
  renderLobby();
}

async function hostGame() {
  if (onlineBusy) return;
  setCommanderName($("commander-name").value);
  setOnlineBusy(true, "Creating game…");
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await openRoom(generateCode(), "host");
      setOnlineBusy(false);
      openLobby();
      return;
    } catch (error) {
      if (error?.code === "taken") continue;
      reportNetworkError(error, false);
      break;
    }
  }
  setOnlineBusy(false);
}

async function joinGame(code, listed = false) {
  if (onlineBusy) return;
  const clean = String(code)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (clean.length !== 4) {
    toast("Enter the 4-letter code");
    return;
  }
  setCommanderName($("commander-name").value);
  setOnlineBusy(true, "Joining…");
  try {
    await openRoom(clean, "guest");
    closeDirectory();
    openLobby();
    syncGuestLobby();
  } catch (error) {
    reportNetworkError(listed && error?.code === "not_found" ? { code: "gone" } : error, true);
  }
  setOnlineBusy(false);
}

async function resumeSavedGame() {
  const button = $("resume-game");
  const kind = button.dataset.kind;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "RECONNECTING…";
  try {
    if (kind === "host") {
      const save = savedHostGame();
      await openRoom(save.code, "host", true);
      resumeHostedGame(save);
    } else {
      await openRoom(savedGuestGame().code, "guest");
      openLobby();
      syncGuestLobby();
    }
  } catch (error) {
    reportNetworkError(error, kind !== "host");
    toast(
      kind === "host"
        ? "Could not resume. The game may have expired."
        : "Could not rejoin. The game may be over.",
    );
    if (kind !== "host" && error?.code === "not_found") forgetGuestGame();
  }
  button.disabled = false;
  button.textContent = label;
  refreshResumeButton();
}

function showOnlineScreen() {
  showScreen("online");
  $("commander-name").value = commanderName();
  setOnlineBusy(true, "Connecting…");
  renderPublicGames();
  onlineTransport().then((transport) => {
    if (!transport) {
      $("online-note").textContent =
        "Online play could not start here. Check your internet connection and reload.";
      return;
    }
    $("online-note").textContent =
      transport.kind === "peer"
        ? "Tap an open lobby to join it, or host your own. Up to 8 players."
        : "Tap an open lobby to join it, or host your own. Friends need this game open on claude.ai.";
    setOnlineBusy(false);
    openDirectory();
  });
}

function lobbyClosed(reason) {
  if (store.net?.role !== "guest") return;
  forgetGuestGame();
  leaveRoom();
  refreshResumeButton();
  showOnlineScreen();
  toast(reason === "closed" ? "The host closed the lobby." : "Could not reach the host.");
}

function bindMenus() {
  on("play-online", showOnlineScreen);
  on("practice", () => {
    renderSetup();
    showScreen("setup");
  });
  on("setup-start", startSetupGame);
  on("setup-back", () => showScreen("menu"));
  for (const [row, key] of [
    ["setup-scenario", "scenario"],
    ["setup-nations", "nations"],
    ["setup-size", "size"],
    ["setup-difficulty", "difficulty"],
    ["setup-length", "length"],
    ["setup-winter", "winter"],
    ["setup-events", "events"],
    ["setup-factions", "factions"],
  ]) {
    $(row).addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (button) setupOption(key, button.dataset.value);
    });
  }
  $("setup-seats").addEventListener("click", (event) => {
    const seat = event.target.closest("[data-nation]");
    if (seat) toggleSeat(Number(seat.dataset.nation));
  });
  on("handoff-go", () => showScreen(null));
  on("resume-game", resumeSavedGame);
  on("how-to-play", () => {
    $("help").dataset.back = "menu";
    showScreen("help");
  });
  on("help-close", () => showScreen($("help").dataset.back === "pause" ? "pause" : "menu"));

  on("online-back", () => {
    closeDirectory();
    showScreen("menu");
  });
  on("host-game", hostGame);
  on("join-game", () => joinGame($("code-input").value));
  $("code-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") joinGame($("code-input").value);
  });
  $("public-games").addEventListener("click", (event) => {
    const listing = event.target.closest(".listing");
    if (listing) joinGame(listing.dataset.code, true);
  });

  on("launch", launchGame);
  on("leave-lobby", () => {
    if (store.net?.role === "guest") forgetGuestGame();
    if (store.net?.role === "host") clearHostedGame();
    leaveRoom();
    showScreen("menu");
    refreshResumeButton();
  });
  for (const [row, key] of [
    ["option-timer", "timer"],
    ["option-length", "maxTurns"],
    ["option-visibility", "visibility"],
    ["option-scenario", "scenario"],
    ["option-nations", "nations"],
    ["option-size", "size"],
    ["option-difficulty", "difficulty"],
  ]) {
    $(row).addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (button) setLobbyOption(key, button.dataset.value);
    });
  }

  on("end-turn", endTurn);
  on("production-button", () => {
    const game = store.game;
    if (!game) return;
    game.panelView = game.panelView === "production" ? "" : "production";
    game.selectedNation = -1;
    renderPanel();
  });
  on("pause-rotate", () => {
    $("pause-rotate").textContent = `ROTATE ON PORTRAIT: ${cycleRotate().toUpperCase()}`;
  });
  on("fit-button", () => resetZoom(store.game));
  on("menu-button", () => {
    $("pause-note").textContent = isOnline() ? `Game code ${store.net.code}` : "";
    $("pause-sound").textContent = `SOUND: ${isMuted() ? "OFF" : "ON"}`;
    $("pause-rotate").textContent = `ROTATE ON PORTRAIT: ${viewSettings.rotate.toUpperCase()}`;
    showScreen("pause");
  });
  on("pause-resume", () => showScreen(null));
  on("pause-help", () => {
    $("help").dataset.back = "pause";
    showScreen("help");
  });
  on("pause-sound", () => {
    setMuted(!isMuted());
    $("pause-sound").textContent = `SOUND: ${isMuted() ? "OFF" : "ON"}`;
  });
  on("pause-quit", () => {
    if (isGuest()) forgetGuestGame();
    backToMenu();
  });

  on("over-again", () => {
    const game = store.game;
    if (isHost()) returnToLobby();
    else if (game)
      newGame(
        game.mode,
        game.seats.map(({ type }) => ({ type })),
        randomSeed(),
        game.options,
      );
  });
  on("over-menu", () => {
    if (isHost()) clearHostedGame();
    if (isGuest()) forgetGuestGame();
    backToMenu();
  });
}

function bindGlobalKeys() {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && store.game && store.game.mode !== "demo") keepAwake();
  });
}

let lastFrame = performance.now();

function step() {
  const now = performance.now();
  const dt = Math.min(0.25, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  tick(dt);
  updateClock();
  syncZoomButton();
  return dt;
}

function frame() {
  try {
    render(Math.min(step(), 0.05));
  } catch (error) {
    console.error(error);
  }
  requestAnimationFrame(frame);
}

function exposeDebugHandle() {
  if (!new URLSearchParams(location.search).has("debug")) return;
  window.frontlines = { store, view, rules, game: gameFlow, online };
}

resizeViewport(canvas);
window.addEventListener("resize", () => resizeViewport(canvas));
bindMapInput();
bindPanel();
bindMenus();
onLobbyClosed(lobbyClosed);
bindGlobalKeys();
exposeDebugHandle();
startDemo();
refreshResumeButton();
requestAnimationFrame(frame);
setInterval(() => {
  if (!document.hidden) return;
  try {
    step();
  } catch (error) {
    console.error(error);
  }
}, 250);
