import { DurableObject } from "cloudflare:workers";
import {
  MAX_CURSOR_PUBLISHERS,
  consumeRateLimit,
  createIdentity,
  decodeMessage,
  normalizeCountry,
  publicIdentity,
  publicParticipant,
  validateMove,
} from "./presence-core.js";

const ROOM_TAG = "about-global-v1";

function sendJson(socket, payload) {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // A socket can close between getWebSockets() and send().
  }
}

function readAttachment(socket) {
  try {
    const attachment = socket.deserializeAttachment();
    return attachment && typeof attachment.id === "string" ? attachment : null;
  } catch {
    return null;
  }
}

function getParticipants(ctx, sockets) {
  return sockets
    .map((socket) => readAttachment(socket))
    .filter(Boolean)
    .map(publicParticipant);
}

function isWebSocketUpgrade(request) {
  return request.headers.get("Upgrade")?.toLowerCase() === "websocket";
}

export class AboutPresenceRoom extends DurableObject {
  async fetch(request) {
    if (!isWebSocketUpgrade(request)) {
      return new Response("WebSocket upgrade required", {
        status: 426,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const sockets = this.ctx.getWebSockets(ROOM_TAG);
    const existingParticipants = getParticipants(this.ctx, sockets);
    const publisherCount = sockets.reduce((count, socket) => {
      const attachment = readAttachment(socket);
      return count + (attachment?.publisher ? 1 : 0);
    }, 0);
    const identity = createIdentity(
      crypto.randomUUID(),
      normalizeCountry(request.headers.get("X-About-Country")),
      publisherCount < MAX_CURSOR_PUBLISHERS,
    );
    const [client, server] = Object.values(new WebSocketPair());

    this.ctx.acceptWebSocket(server, [ROOM_TAG]);
    server.serializeAttachment(identity);

    const online = sockets.length + 1;
    sendJson(server, { type: "hello", self: publicIdentity(identity) });
    sendJson(server, {
      type: "snapshot",
      online,
      participants: existingParticipants,
    });
    sendJson(server, { type: "publisher", enabled: identity.publisher });

    for (const socket of sockets) {
      sendJson(socket, {
        type: "join",
        participant: publicParticipant(identity),
        online,
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, message) {
    const identity = readAttachment(socket);
    if (!identity?.publisher) return;

    const move = validateMove(decodeMessage(message));
    if (!move) return;

    const now = Date.now();
    const rate = consumeRateLimit(identity, now);
    if (!rate.allowed) return;

    const nextIdentity = {
      ...identity,
      region: move.region,
      x: move.x,
      y: move.y,
      rateWindowStart: rate.rateWindowStart,
      rateCount: rate.rateCount,
    };
    socket.serializeAttachment(nextIdentity);

    const payload = {
      type: "move",
      id: identity.id,
      region: move.region,
      x: move.x,
      y: move.y,
    };
    for (const participant of this.ctx.getWebSockets(ROOM_TAG)) {
      if (participant !== socket) sendJson(participant, payload);
    }
  }

  async webSocketClose(socket) {
    const closedIdentity = readAttachment(socket);
    const sockets = this.ctx.getWebSockets(ROOM_TAG).filter((candidate) => candidate !== socket);
    const online = sockets.length;

    if (closedIdentity) {
      for (const participant of sockets) {
        sendJson(participant, { type: "leave", id: closedIdentity.id, online });
      }
    }

    const waiting = sockets.find((candidate) => !readAttachment(candidate)?.publisher);
    if (!waiting) return;

    const waitingIdentity = readAttachment(waiting);
    if (!waitingIdentity) return;

    const promotedIdentity = { ...waitingIdentity, publisher: true };
    waiting.serializeAttachment(promotedIdentity);
    sendJson(waiting, { type: "publisher", enabled: true });
  }

  async webSocketError(socket) {
    try {
      socket.close(1011, "Presence socket error");
    } catch {
      // The close lifecycle will remove the ephemeral participant.
    }
  }
}
