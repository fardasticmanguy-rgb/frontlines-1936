import { joinPeerRoom } from "./peer-room.js";

const PEERJS_SOURCES = [
  "https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js",
  "https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js",
];
const CLAUDE_WAIT_MS = 3000;
const DIRECTORY_ID = "frontlines-1936-directory";
const ELECTION_ROUNDS = 4;
const WATCHDOG_MS = 2000;

function loadScript(src) {
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.append(script);
  });
}

async function loadPeerJs() {
  if (window.Peer) return true;
  for (const src of PEERJS_SOURCES) {
    if ((await loadScript(src)) && window.Peer) return true;
  }
  return false;
}

function signalingServer() {
  const params = new URLSearchParams(location.search);
  const host = params.get("peerhost");
  if (!host) return { debug: 0 };
  const [hostname, port] = host.split(":");
  return {
    debug: 0,
    host: hostname,
    port: Number(port) || 9000,
    path: params.get("peerpath") || "/",
    secure: params.get("peersecure") === "1",
  };
}

async function waitForClaude() {
  const deadline = performance.now() + CLAUDE_WAIT_MS;
  while (!window.claude?.use && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return Boolean(window.claude?.use);
}

async function electDirectory(options) {
  for (let round = 0; round < ELECTION_ROUNDS; round++) {
    try {
      return await joinPeerRoom(DIRECTORY_ID, "host", { options });
    } catch (error) {
      if (error.code !== "taken") throw error;
    }
    try {
      return await joinPeerRoom(DIRECTORY_ID, "guest", { options });
    } catch (error) {
      if (error.code !== "not_found") throw error;
    }
  }
  throw { code: "unavailable" };
}

async function openPeerDirectory(options) {
  const listeners = new Set();
  let own = {};
  let room = null;
  let unsubscribe = null;
  let closed = false;
  let offlineChecks = 0;

  const forward = (change) => listeners.forEach((listener) => listener(change));
  const connect = async () => {
    const joined = await electDirectory(options);
    if (closed) {
      joined.leave();
      return;
    }
    room = joined;
    unsubscribe = room.onPeers(forward);
    if (Object.keys(own).length) room.presence(own);
  };

  const watchdog = setInterval(async () => {
    if (closed || !room) return;
    offlineChecks = room.connected() ? 0 : offlineChecks + 1;
    if (offlineChecks < 3) return;
    offlineChecks = 0;
    unsubscribe?.();
    const lost = room;
    room = null;
    lost.leave();
    forward({ peers: [] });
    try {
      await connect();
    } catch {}
  }, WATCHDOG_MS);

  await connect();
  return {
    peers: () => (room ? room.peers() : []),
    onPeers(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async presence(patch) {
      for (const key in patch) {
        if (patch[key] === null) delete own[key];
        else own[key] = patch[key];
      }
      await room?.presence(patch);
    },
    async leave() {
      closed = true;
      clearInterval(watchdog);
      unsubscribe?.();
      await room?.leave();
    },
  };
}

function claudeTransport(room) {
  return {
    kind: "claude",
    join: (code) => room.join(`fl36-${code.toLowerCase()}`),
    openDirectory: async () => ({
      peers: () => room.peers(),
      onPeers: (listener) => room.onPeers(listener),
      presence: (patch) => room.presence(patch),
      leave: () => room.presence({ listing: null }),
    }),
  };
}

function peerTransport() {
  const options = signalingServer();
  return {
    kind: "peer",
    join: (code, role, resume) =>
      joinPeerRoom(`frontlines-1936-${code.toLowerCase()}`, role, { resume, options }),
    openDirectory: () => openPeerDirectory(options),
  };
}

async function detectTransport() {
  if (await waitForClaude()) {
    try {
      const room = await window.claude.use("room");
      if (room) return claudeTransport(room);
    } catch {}
    return null;
  }
  return (await loadPeerJs()) ? peerTransport() : null;
}

export const transportReady = detectTransport();
