const BROADCAST_DELAY = 50;
const HEARTBEAT_INTERVAL = 2000;
const GUEST_TIMEOUT = 9000;
const HOST_TIMEOUT = 7000;
const RETRY_DELAY = 2500;
const JOIN_TIMEOUT = 20000;
const RESUME_TIMEOUT = 70000;
const RESUME_ATTEMPTS = 20;
const NETWORK_ERRORS = new Set(["network", "server-error", "socket-error", "socket-closed"]);

export function joinPeerRoom(hostId, role, { resume = false, options = {} } = {}) {
  return new Promise((resolve, reject) => {
    const listeners = [];
    const presences = new Map();
    const updatedAt = new Map();
    const connections = new Map();
    const lastSeen = new Map();

    let own = {};
    let selfId = null;
    let snapshot = Object.freeze([]);
    let hostConnection = null;
    let peer = null;
    let closed = false;
    let settled = false;
    let broadcastTimer = null;
    let retryTimer = null;
    let lastHostMessage = 0;
    let attempts = 0;

    const notify = () => {
      const peers = [];
      if (selfId) {
        peers.push(
          Object.freeze({
            peer: selfId,
            sameTab: true,
            presence: Object.freeze({ ...own }),
            updatedAt: performance.now(),
          }),
        );
      }
      for (const [id, presence] of presences) {
        if (id === selfId) continue;
        peers.push(Object.freeze({ peer: id, sameTab: false, presence, updatedAt: updatedAt.get(id) || 0 }));
      }
      snapshot = Object.freeze(peers);
      for (const listener of listeners.slice()) {
        try {
          listener({ peers: snapshot });
        } catch (error) {
          console.error(error);
        }
      }
    };

    const roster = () => {
      const list = [[selfId, own, 0]];
      for (const [id, presence] of presences)
        if (id !== selfId) list.push([id, presence, updatedAt.get(id) || 0]);
      return { type: "roster", list };
    };

    const sendRoster = () => {
      const message = roster();
      for (const connection of connections.values()) {
        if (!connection.open) continue;
        try {
          connection.send(message);
        } catch {}
      }
    };

    const scheduleBroadcast = () => {
      if (broadcastTimer) return;
      broadcastTimer = setTimeout(() => {
        broadcastTimer = null;
        sendRoster();
      }, BROADCAST_DELAY);
    };

    const sendOwnPresence = () => {
      if (!hostConnection?.open) return;
      try {
        hostConnection.send({ type: "presence", presence: own });
      } catch {}
    };

    const scheduleReconnect = () => {
      if (closed || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connectToHost();
      }, RETRY_DELAY);
    };

    const dropHost = () => {
      const connection = hostConnection;
      hostConnection = null;
      try {
        connection?.close();
      } catch {}
      presences.clear();
      updatedAt.clear();
      notify();
      scheduleReconnect();
    };

    const acceptRoster = (list) => {
      lastHostMessage = performance.now();
      presences.clear();
      updatedAt.clear();
      for (const entry of list) {
        if (!Array.isArray(entry)) continue;
        const [id, presence, time] = entry;
        if (typeof id !== "string" || !presence || typeof presence !== "object") continue;
        presences.set(id, Object.freeze({ ...presence }));
        updatedAt.set(id, typeof time === "number" ? time : 0);
      }
      notify();
    };

    function connectToHost() {
      if (closed || !peer || peer.destroyed) return;
      if (peer.disconnected) {
        try {
          peer.reconnect();
        } catch {}
        scheduleReconnect();
        return;
      }
      if (hostConnection) {
        const stale = hostConnection;
        hostConnection = null;
        try {
          stale.close();
        } catch {}
      }

      let connection;
      try {
        connection = peer.connect(hostId, { reliable: true });
      } catch {
        connection = null;
      }
      if (!connection) {
        scheduleReconnect();
        return;
      }
      hostConnection = connection;

      connection.on("open", () => {
        if (connection !== hostConnection) return;
        lastHostMessage = performance.now();
        sendOwnPresence();
        if (!settled) {
          settled = true;
          notify();
          resolve(api);
        }
      });
      connection.on("data", (message) => {
        if (connection !== hostConnection) return;
        if (message?.type === "roster" && Array.isArray(message.list)) acceptRoster(message.list);
      });
      const lost = () => connection === hostConnection && dropHost();
      connection.on("close", lost);
      connection.on("error", lost);
    }

    function acceptGuest(connection) {
      const id = connection.peer;
      connection.on("open", () => {
        const previous = connections.get(id);
        if (previous && previous !== connection) {
          try {
            previous.close();
          } catch {}
        }
        connections.set(id, connection);
        lastSeen.set(id, performance.now());
        scheduleBroadcast();
      });
      connection.on("data", (message) => {
        if (connections.get(id) !== connection) return;
        lastSeen.set(id, performance.now());
        if (message?.type !== "presence" || !message.presence || typeof message.presence !== "object") return;
        presences.set(id, Object.freeze({ ...message.presence }));
        updatedAt.set(id, performance.now());
        notify();
        scheduleBroadcast();
      });
      const drop = () => {
        if (connections.get(id) !== connection) return;
        connections.delete(id);
        presences.delete(id);
        updatedAt.delete(id);
        notify();
        scheduleBroadcast();
      };
      connection.on("close", drop);
      connection.on("error", drop);
    }

    const heartbeat = setInterval(() => {
      if (closed) {
        clearInterval(heartbeat);
        return;
      }
      const now = performance.now();
      if (role === "host") {
        for (const [id, connection] of [...connections]) {
          if (now - (lastSeen.get(id) ?? now) <= GUEST_TIMEOUT) continue;
          connections.delete(id);
          presences.delete(id);
          updatedAt.delete(id);
          try {
            connection.close();
          } catch {}
          notify();
        }
        sendRoster();
      } else if (hostConnection?.open) {
        try {
          hostConnection.send({ type: "ping" });
        } catch {}
        if (now - lastHostMessage > HOST_TIMEOUT) dropHost();
      }
    }, HEARTBEAT_INTERVAL);

    const fail = (code) => {
      settled = true;
      closed = true;
      clearInterval(heartbeat);
      try {
        peer?.destroy();
      } catch {}
      reject({ code });
    };

    const api = {
      hostId,
      peers: () => snapshot,
      onPeers(listener) {
        listeners.push(listener);
        setTimeout(() => listener({ peers: snapshot }), 0);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        };
      },
      async presence(patch) {
        for (const key in patch) {
          if (patch[key] === null) delete own[key];
          else own[key] = patch[key];
        }
        if (role === "host") scheduleBroadcast();
        else sendOwnPresence();
        notify();
      },
      async leave() {
        closed = true;
        clearTimeout(retryTimer);
        clearInterval(heartbeat);
        try {
          peer?.destroy();
        } catch {}
      },
      connected: () =>
        role === "host"
          ? Boolean(peer && !peer.disconnected && !peer.destroyed)
          : Boolean(hostConnection?.open),
    };

    function start() {
      if (closed) return;
      const current = role === "host" ? new window.Peer(hostId, options) : new window.Peer(options);
      peer = current;

      current.on("open", (id) => {
        if (current !== peer) return;
        selfId = id;
        if (role === "guest") {
          if (!hostConnection) connectToHost();
        } else if (!settled) {
          settled = true;
          notify();
          resolve(api);
        }
      });

      if (role === "host") current.on("connection", acceptGuest);

      current.on("disconnected", () => {
        setTimeout(() => {
          if (closed || current !== peer || !current.disconnected || current.destroyed) return;
          try {
            current.reconnect();
          } catch {}
        }, 1500);
      });

      current.on("error", (error) => {
        if (current !== peer) return;
        const type = error?.type;
        if (settled) {
          if (type === "peer-unavailable" && role === "guest") dropHost();
          return;
        }
        const retry = (delay) => {
          attempts++;
          try {
            current.destroy();
          } catch {}
          setTimeout(start, delay);
        };
        if (type === "unavailable-id" && role === "host" && resume && attempts < RESUME_ATTEMPTS) retry(3000);
        else if (type === "peer-unavailable" && role === "guest") fail("not_found");
        else if (NETWORK_ERRORS.has(type) && attempts < 3) retry(1500);
        else fail(type === "unavailable-id" ? "taken" : type || "upstream_error");
      });
    }

    start();
    setTimeout(
      () => {
        if (!settled) fail("timeout");
      },
      role === "host" && resume ? RESUME_TIMEOUT : JOIN_TIMEOUT,
    );
  });
}
