const PREFIX = "frontlines-1936-user-";
const OPEN_TIMEOUT = 10000;
const ANSWER_TIMEOUT = 45000;

function safely(action) {
  try {
    return action();
  } catch {
    return undefined;
  }
}

export function inboxKey(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function openInbox(name, options, onInvite) {
  return new Promise((resolve, reject) => {
    const key = inboxKey(name);
    if (!key) {
      reject({ code: "invalid" });
      return;
    }
    const peer = new window.Peer(PREFIX + key, options);
    let settled = false;
    let closed = false;
    const settle = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        closed = true;
        safely(() => peer.destroy());
        reject(error);
        return;
      }
      resolve({
        close() {
          closed = true;
          safely(() => peer.destroy());
        },
      });
    };
    const timer = setTimeout(() => settle({ code: "timeout" }), OPEN_TIMEOUT);
    peer.on("open", () => settle(null));
    peer.on("connection", (connection) => {
      connection.on("data", (message) => {
        if (closed || message?.type !== "invite" || typeof message.code !== "string") return;
        onInvite({ code: message.code, from: String(message.from ?? "") }, (answer) =>
          safely(() => connection.send({ type: "answer", answer })),
        );
      });
    });
    peer.on("disconnected", () => {
      setTimeout(() => {
        if (!closed && peer.disconnected && !peer.destroyed) safely(() => peer.reconnect());
      }, 1500);
    });
    peer.on("error", (error) => settle({ code: error?.type === "unavailable-id" ? "taken" : "unavailable" }));
  });
}

export function sendInvite(name, options, invite) {
  return new Promise((resolve) => {
    const key = inboxKey(name);
    if (!key) {
      resolve("offline");
      return;
    }
    const peer = new window.Peer(options);
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      setTimeout(() => safely(() => peer.destroy()), 300);
      resolve(result);
    };
    const timer = setTimeout(() => finish("no_answer"), ANSWER_TIMEOUT);
    peer.on("open", () => {
      const connection = safely(() => peer.connect(PREFIX + key, { reliable: true }));
      if (!connection) {
        finish("offline");
        return;
      }
      connection.on("open", () => safely(() => connection.send({ type: "invite", ...invite })));
      connection.on("data", (message) => {
        if (message?.type === "answer") finish(String(message.answer));
      });
    });
    peer.on("error", (error) => finish(error?.type === "peer-unavailable" ? "offline" : "unavailable"));
  });
}
