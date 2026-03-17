import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRelayServerUrl } from "@remote-codex/contracts";
import { fromSqlDateTime, toSqlDateTime } from "../src/relay/helpers";

test("normalizeRelayServerUrl keeps https origins and strips trailing path/query/hash", () => {
  assert.equal(
    normalizeRelayServerUrl("https://relay.remote-codex.com/api/pairing-codes/abc?foo=bar#hash"),
    "https://relay.remote-codex.com",
  );
});

test("normalizeRelayServerUrl allows localhost http for local development", () => {
  assert.equal(normalizeRelayServerUrl("http://localhost:3100/nested/path"), "http://localhost:3100");
  assert.equal(normalizeRelayServerUrl("http://127.0.0.1:3100/ws/bridge"), "http://127.0.0.1:3100");
});

test("normalizeRelayServerUrl rejects non-local http endpoints", () => {
  assert.throws(
    () => normalizeRelayServerUrl("http://relay.remote-codex.com"),
    /HTTPS만 허용됩니다/,
  );
});

test("normalizeRelayServerUrl rejects embedded credentials", () => {
  assert.throws(
    () => normalizeRelayServerUrl("https://user:secret@relay.remote-codex.com"),
    /비밀번호/,
  );
});

test("fromSqlDateTime parses SQL datetime strings as UTC", () => {
  assert.equal(fromSqlDateTime("2026-03-18 11:22:33.444").toISOString(), "2026-03-18T11:22:33.444Z");
  assert.equal(toSqlDateTime("2026-03-18T11:22:33.444Z"), "2026-03-18 11:22:33.444");
});

test("fromSqlDateTime preserves DATETIME wall-clock values from Date objects", () => {
  const driverValue = new Date(2026, 2, 18, 11, 22, 33, 444);
  const expectedUtc = new Date(Date.UTC(2026, 2, 18, 11, 22, 33, 444)).toISOString();

  assert.equal(fromSqlDateTime(driverValue).toISOString(), expectedUtc);
});
