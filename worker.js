import { AboutPresenceRoom } from "./src/presence-room.js";

const PRODUCTION_ORIGIN = "https://about.ato.run";
const LOCAL_ORIGINS = new Set([
  "http://localhost:4173",
  "http://localhost:8787",
  "http://localhost:8788",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:8787",
  "http://127.0.0.1:8788",
]);
const SAFE_UPGRADE_HEADERS = [
  "Origin",
  "Sec-WebSocket-Key",
  "Sec-WebSocket-Protocol",
  "Sec-WebSocket-Version",
  "Sec-WebSocket-Extensions",
  "Upgrade",
];

function isAllowedOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  if (origin === PRODUCTION_ORIGIN) return true;
  if (origin === "http://about.ato.run" && new URL(request.url).protocol === "http:") return true;
  if (LOCAL_ORIGINS.has(origin)) return true;
  try {
    const localOrigin = new URL(origin);
    return localOrigin.protocol === "http:"
      && ["localhost", "127.0.0.1"].includes(localOrigin.hostname)
      && ["4173", "8787", "8788"].includes(localOrigin.port);
  } catch {
    return false;
  }
}

function isWebSocketUpgrade(request) {
  return request.headers.get("Upgrade")?.toLowerCase() === "websocket";
}

function countryFromRequest(request) {
  const country = request.cf?.country;
  return typeof country === "string" && /^[a-z]{2}$/i.test(country) ? country.toUpperCase() : null;
}

function createPresenceRequest(request, country) {
  const headers = new Headers();
  for (const name of SAFE_UPGRADE_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("X-About-Country", country || "");
  return new Request(request, { headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/presence") return env.ASSETS.fetch(request);

    if (!isAllowedOrigin(request)) {
      return new Response("Forbidden", { status: 403 });
    }
    if (!isWebSocketUpgrade(request)) {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const id = env.ABOUT_PRESENCE_ROOM.idFromName("about-global-v1");
    const room = env.ABOUT_PRESENCE_ROOM.get(id);
    return room.fetch(createPresenceRequest(request, countryFromRequest(request)));
  },
};

export { AboutPresenceRoom };
