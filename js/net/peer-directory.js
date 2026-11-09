const SLOT_COUNT = 16;
const SLOT_PREFIX = "frontlines-1936-pub-";
const SCAN_INTERVAL = 4000;
const PROBE_TIMEOUT = 5000;
const LISTING_LIFETIME = 13000;
const SERVE_LINGER = 6000;

const slotId = (slot) => `${SLOT_PREFIX}${slot}`;

function safely(action) {
  try {
    return action();
  } catch {
    return undefined;
  }
}

function waitForOpen(peer) {
  return new Promise((resolve, reject) => {
    if (peer.open) {
      resolve(peer);
      return;
    }
    const timer = setTimeout(() => reject({ code: "timeout" }), PROBE_TIMEOUT * 2);
    peer.on("open", () => {
      clearTimeout(timer);
      resolve(peer);
    });
    peer.on("error", (error) => {
      if (peer.open) return;
      clearTimeout(timer);
      reject({ code: error?.type === "unavailable-id" ? "taken" : error?.type || "unavailable" });
    });
  });
}

function createServer(options, getListing) {
  let peer = null;
  let claiming = null;
  const guests = new Set();

  const send = (connection) => {
    if (!connection.open) return;
    safely(() => connection.send({ type: "listing", listing: getListing() }));
  };

  const accept = (connection) => {
    guests.add(connection);
    connection.on("open", () => send(connection));
    const forget = () => guests.delete(connection);
    connection.on("close", forget);
    connection.on("error", forget);
    setTimeout(() => {
      forget();
      safely(() => connection.close());
    }, SERVE_LINGER);
  };

  const claim = async () => {
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const candidate = new window.Peer(slotId(slot), options);
      try {
        await waitForOpen(candidate);
        candidate.on("connection", accept);
        candidate.on("disconnected", () => {
          setTimeout(() => {
            if (peer === candidate && candidate.disconnected && !candidate.destroyed)
              safely(() => candidate.reconnect());
          }, 1500);
        });
        return candidate;
      } catch (error) {
        safely(() => candidate.destroy());
        if (error.code !== "taken") return null;
      }
    }
    return null;
  };

  return {
    async publish() {
      if (peer && !peer.destroyed) {
        guests.forEach(send);
        return;
      }
      claiming ??= claim().finally(() => (claiming = null));
      const claimed = await claiming;
      if (!getListing()) {
        safely(() => claimed?.destroy());
        return;
      }
      peer = claimed;
    },
    withdraw() {
      safely(() => peer?.destroy());
      peer = null;
      guests.clear();
    },
  };
}

function createScanner(options, onChange) {
  let peer = null;
  const listings = new Map();
  const probing = new Set();

  const ensurePeer = () => {
    if (peer && !peer.destroyed) {
      if (peer.disconnected) safely(() => peer.reconnect());
      return peer.open ? peer : null;
    }
    peer = new window.Peer(options);
    peer.on("error", () => {});
    return null;
  };

  const probe = (scanner, slot) => {
    if (probing.has(slot)) return;
    const connection = safely(() => scanner.connect(slotId(slot), { reliable: true }));
    if (!connection) return;
    probing.add(slot);
    const finish = () => {
      if (!probing.delete(slot)) return;
      safely(() => connection.close());
    };
    connection.on("data", (message) => {
      if (message?.type !== "listing") return;
      if (message.listing && typeof message.listing === "object") {
        listings.set(slot, { listing: message.listing, seenAt: performance.now() });
      } else {
        listings.delete(slot);
      }
      onChange();
      finish();
    });
    connection.on("error", finish);
    connection.on("close", finish);
    setTimeout(finish, PROBE_TIMEOUT);
  };

  return {
    scan() {
      const scanner = ensurePeer();
      if (scanner) for (let slot = 0; slot < SLOT_COUNT; slot++) probe(scanner, slot);
      const now = performance.now();
      let expired = false;
      for (const [slot, entry] of listings) {
        if (now - entry.seenAt <= LISTING_LIFETIME) continue;
        listings.delete(slot);
        expired = true;
      }
      if (expired) onChange();
    },
    listings: () => [...listings.values()].map((entry) => entry.listing),
    close() {
      safely(() => peer?.destroy());
      peer = null;
      listings.clear();
    },
  };
}

export async function openPeerDirectory(options, { browsing = () => true } = {}) {
  const listeners = new Set();
  let own = {};
  let closed = false;

  const snapshot = () => {
    const mine = own.listing?.code;
    const peers = scanner.listings().map((listing) => ({
      sameTab: listing.code === mine,
      presence: { listing },
    }));
    if (own.listing) peers.push({ sameTab: true, presence: { ...own } });
    return peers;
  };
  const notify = () => {
    if (closed) return;
    const peers = snapshot();
    listeners.forEach((listener) => safely(() => listener({ peers })));
  };

  const scanner = createScanner(options, notify);
  const server = createServer(options, () => own.listing ?? null);
  const tick = () => {
    if (!closed && browsing() && !document.hidden) scanner.scan();
  };
  const timer = setInterval(tick, SCAN_INTERVAL);
  tick();
  setTimeout(tick, 1200);

  return {
    peers: snapshot,
    onPeers(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async presence(patch) {
      for (const key in patch) {
        if (patch[key] === null) delete own[key];
        else own[key] = patch[key];
      }
      if (own.listing) await server.publish();
      else server.withdraw();
      notify();
    },
    async leave() {
      closed = true;
      clearInterval(timer);
      server.withdraw();
      scanner.close();
    },
  };
}
