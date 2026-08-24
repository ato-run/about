export const PRESENCE_REGION_NAMES = Object.freeze([
  "hero",
  "demo",
  "together",
  "build",
  "try",
  "behind",
  "start",
  "waitlist",
]);

export const PRESENCE_REGIONS = new Set(PRESENCE_REGION_NAMES);
export const MAX_CURSOR_PUBLISHERS = 24;
export const MAX_MESSAGE_BYTES = 2048;
export const MAX_MESSAGES_PER_SECOND = 15;
export const RATE_WINDOW_MS = 1000;

export const ADJECTIVES = Object.freeze([
  "Curious",
  "Quiet",
  "Swift",
  "Tiny",
  "Gentle",
  "Bright",
  "Calm",
  "Happy",
  "Brave",
  "Clever",
  "Sleepy",
  "Lucky",
  "Sunny",
  "Playful",
  "Kind",
  "Bold",
  "Wandering",
  "Cozy",
]);

export const ANIMALS = Object.freeze([
  { name: "Fox", emoji: "🦊" },
  { name: "Otter", emoji: "🦦" },
  { name: "Owl", emoji: "🦉" },
  { name: "Panda", emoji: "🐼" },
  { name: "Penguin", emoji: "🐧" },
  { name: "Rabbit", emoji: "🐇" },
  { name: "Turtle", emoji: "🐢" },
  { name: "Dolphin", emoji: "🐬" },
  { name: "Cat", emoji: "🐈" },
  { name: "Raccoon", emoji: "🦝" },
  { name: "Capybara", emoji: "🦫" },
  { name: "Koala", emoji: "🐨" },
  { name: "Seal", emoji: "🦭" },
  { name: "Bear", emoji: "🐻" },
  { name: "Deer", emoji: "🦌" },
  { name: "Hedgehog", emoji: "🦔" },
  { name: "Squirrel", emoji: "🐿️" },
  { name: "Whale", emoji: "🐋" },
]);

export const CURSOR_COLORS = Object.freeze([
  "#c54868",
  "#c9793e",
  "#4f69bd",
  "#3d9674",
  "#8466a8",
]);

export function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function normalizeCountry(value) {
  if (typeof value !== "string" || !/^[a-z]{2}$/i.test(value)) return null;
  return value.toUpperCase();
}

export function createIdentity(id, country, publisher) {
  const hash = hashString(id);
  const animal = ANIMALS[(hash >>> 5) % ANIMALS.length];

  return {
    id,
    adjective: ADJECTIVES[hash % ADJECTIVES.length],
    animal: animal.name,
    animalEmoji: animal.emoji,
    country: normalizeCountry(country),
    color: CURSOR_COLORS[(hash >>> 10) % CURSOR_COLORS.length],
    publisher: Boolean(publisher),
    region: null,
    x: null,
    y: null,
    rateWindowStart: 0,
    rateCount: 0,
  };
}

export function publicIdentity(identity) {
  return {
    id: identity.id,
    adjective: identity.adjective,
    animal: identity.animal,
    animalEmoji: identity.animalEmoji,
    country: identity.country,
    color: identity.color,
    publisher: Boolean(identity.publisher),
  };
}

export function publicParticipant(identity) {
  return {
    ...publicIdentity(identity),
    region: PRESENCE_REGIONS.has(identity.region) ? identity.region : null,
    x: Number.isFinite(identity.x) ? identity.x : null,
    y: Number.isFinite(identity.y) ? identity.y : null,
  };
}

export function decodeMessage(message) {
  if (typeof message === "string") {
    if (new TextEncoder().encode(message).byteLength > MAX_MESSAGE_BYTES) return null;
    try {
      return JSON.parse(message);
    } catch {
      return null;
    }
  }

  if (message instanceof ArrayBuffer || ArrayBuffer.isView(message)) {
    const bytes = message instanceof ArrayBuffer
      ? new Uint8Array(message)
      : new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
    if (bytes.byteLength > MAX_MESSAGE_BYTES) return null;
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  }

  return null;
}

export function validateMove(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.type !== "move" || !PRESENCE_REGIONS.has(value.region)) return null;
  if (typeof value.x !== "number" || !Number.isFinite(value.x) || value.x < 0 || value.x > 1) return null;
  if (typeof value.y !== "number" || !Number.isFinite(value.y) || value.y < 0 || value.y > 1) return null;

  return { type: "move", region: value.region, x: value.x, y: value.y };
}

export function consumeRateLimit(identity, now) {
  let rateWindowStart = identity.rateWindowStart;
  let rateCount = identity.rateCount;

  if (!Number.isFinite(rateWindowStart) || now < rateWindowStart || now - rateWindowStart >= RATE_WINDOW_MS) {
    rateWindowStart = now;
    rateCount = 0;
  }

  if (rateCount >= MAX_MESSAGES_PER_SECOND) {
    return { allowed: false, rateWindowStart, rateCount };
  }

  return { allowed: true, rateWindowStart, rateCount: rateCount + 1 };
}
