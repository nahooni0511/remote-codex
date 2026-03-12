import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import test from "node:test";

import {
  assertBoolean,
  assertNonEmptyString,
  parseNumericId,
  parseOptionalPositiveInteger,
  validateFolderPath,
} from "../src/lib/http";

test("assertNonEmptyString trims values", () => {
  assert.equal(assertNonEmptyString("  hello  ", "value"), "hello");
});

test("assertBoolean validates booleans", () => {
  assert.equal(assertBoolean(true, "flag"), true);
  assert.throws(() => assertBoolean("true", "flag"));
});

test("numeric parsers reject invalid values", () => {
  assert.equal(parseNumericId("12"), 12);
  assert.equal(parseOptionalPositiveInteger("8", "limit"), 8);
  assert.equal(parseOptionalPositiveInteger("", "limit"), null);
  assert.throws(() => parseNumericId("0"));
  assert.throws(() => parseOptionalPositiveInteger("-1", "limit"));
});

test("validateFolderPath resolves existing directories", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "remote-codex-"));
  assert.equal(validateFolderPath(tempDir), tempDir);
});
