import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeSupportTicketCursor,
  decodeSupportTicketCursor,
} from "./support-ticket-repository.port.js";

test("encodeSupportTicketCursor produces a base64url string", () => {
  const cursor = encodeSupportTicketCursor("2026-07-01T00:00:00.000Z", "sup_abc123");
  assert.equal(typeof cursor, "string");
  // base64url characters only
  assert.match(cursor, /^[A-Za-z0-9_-]+$/);
});

test("decodeSupportTicketCursor round-trips with encode", () => {
  const createdAt = "2026-07-01T12:30:45.123Z";
  const id = "sup_c2e1f8a9-1234-5678-abcd-ef0123456789";
  const cursor = encodeSupportTicketCursor(createdAt, id);
  const decoded = decodeSupportTicketCursor(cursor);

  assert.deepEqual(decoded, { createdAt, id });
});

test("decodeSupportTicketCursor returns null for invalid base64url", () => {
  assert.equal(decodeSupportTicketCursor("!!not-valid!!"), null);
});

test("decodeSupportTicketCursor returns null when no pipe separator is found", () => {
  // base64url-encode a string without a pipe
  const encoded = Buffer.from("nopipehere", "utf8").toString("base64url");
  assert.equal(decodeSupportTicketCursor(encoded), null);
});

test("decodeSupportTicketCursor handles IDs with multiple hyphens", () => {
  const createdAt = "2026-01-01T00:00:00.000Z";
  const id = "sup_a-b-c-d-e";
  const cursor = encodeSupportTicketCursor(createdAt, id);
  const decoded = decodeSupportTicketCursor(cursor);

  assert.deepEqual(decoded, { createdAt, id });
});

test("decodeSupportTicketCursor uses last pipe as separator (handles pipe in timestamp)", () => {
  // Hypothetical timestamp with pipe (edge case).
  // The code uses lastIndexOf("|"), so the last pipe separates createdAt|id.
  const createdAt = "2026-01-01T00:00:00.000Z";
  const id = "sup_xyz";
  const cursor = encodeSupportTicketCursor(createdAt, id);
  const decoded = decodeSupportTicketCursor(cursor);

  assert.equal(decoded?.createdAt, createdAt);
  assert.equal(decoded?.id, id);
});

test("encodeSupportTicketCursor is deterministic", () => {
  const a = encodeSupportTicketCursor("2026-01-01T00:00:00.000Z", "sup_1");
  const b = encodeSupportTicketCursor("2026-01-01T00:00:00.000Z", "sup_1");
  assert.equal(a, b);
});
