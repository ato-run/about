import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_MESSAGE_BYTES,
  MAX_MESSAGES_PER_SECOND,
  MAX_CURSOR_PUBLISHERS,
  consumeRateLimit,
  createIdentity,
  decodeMessage,
  normalizeCountry,
  publicParticipant,
  validateMove,
} from "../src/presence-core.js";

test("identity is deterministic and only accepts a country code", () => {
  const first = createIdentity("visitor-1", "jp", true);
  const second = createIdentity("visitor-1", "JP", true);

  assert.deepEqual(first, second);
  assert.equal(first.country, "JP");
  assert.equal(first.publisher, true);
  assert.notEqual(first.id, "");
  assert.equal(typeof first.color, "string");
  assert.equal(normalizeCountry("Tokyo"), null);
  assert.equal(normalizeCountry(null), null);
});

test("public participant projection excludes rate-limit metadata", () => {
  const participant = publicParticipant(createIdentity("visitor-2", null, false));

  assert.deepEqual(Object.keys(participant).sort(), [
    "adjective",
    "animal",
    "animalEmoji",
    "color",
    "country",
    "id",
    "publisher",
    "region",
    "x",
    "y",
  ]);
  assert.equal(participant.country, null);
  assert.equal(participant.region, null);
  assert.equal(participant.x, null);
});

test("move protocol accepts only known regions and normalized coordinates", () => {
  assert.deepEqual(validateMove({ type: "move", region: "hero", x: 0.42, y: 1 }), {
    type: "move",
    region: "hero",
    x: 0.42,
    y: 1,
  });
  assert.equal(validateMove({ type: "move", region: "unknown", x: 0.2, y: 0.3 }), null);
  assert.equal(validateMove({ type: "move", region: "hero", x: -0.1, y: 0.3 }), null);
  assert.equal(validateMove({ type: "move", region: "hero", x: 0.2, y: 1.1 }), null);
  assert.equal(validateMove({ type: "move", region: "hero", x: NaN, y: 0.3 }), null);
  assert.equal(validateMove({ type: "move", region: "hero", x: "0.2", y: 0.3 }), null);
});

test("malformed and oversized messages are dropped without throwing", () => {
  assert.equal(decodeMessage("not json"), null);
  assert.equal(decodeMessage("x".repeat(MAX_MESSAGE_BYTES + 1)), null);
  assert.deepEqual(decodeMessage(JSON.stringify({ type: "move", region: "hero", x: 0.1, y: 0.2 })), {
    type: "move",
    region: "hero",
    x: 0.1,
    y: 0.2,
  });
});

test("rate limit allows 15 moves per second and drops the next one", () => {
  const identity = createIdentity("visitor-3", "US", true);
  let now = 10_000;

  for (let index = 0; index < MAX_MESSAGES_PER_SECOND; index += 1) {
    const result = consumeRateLimit(identity, now);
    assert.equal(result.allowed, true);
    identity.rateWindowStart = result.rateWindowStart;
    identity.rateCount = result.rateCount;
  }
  assert.equal(consumeRateLimit(identity, now).allowed, false);
  assert.equal(consumeRateLimit(identity, now + 1_000).allowed, true);
  assert.equal(MAX_CURSOR_PUBLISHERS, 24);
});
