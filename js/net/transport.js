import { openPeerDirectory } from "./peer-directory.js";
import { joinPeerRoom } from "./peer-room.js";

const PEERJS_SOURCES = [
  "https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js",
  "https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js",
];
const CLAUDE_WAIT_MS = 3000;

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
    openDirectory: (hooks) => openPeerDirectory(options, hooks),
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
