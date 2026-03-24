import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("resolveBundledCodexBin resolves the codex entrypoint from an installed package root", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-codex-codex-bin-"));
  const packageRoot = path.join(tempDir, "node_modules", "@openai", "codex");
  const binDir = path.join(packageRoot, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: "@openai/codex",
      version: "0.113.0",
      bin: {
        codex: "bin/codex.js",
      },
    }),
  );
  fs.writeFileSync(path.join(binDir, "codex.js"), "#!/usr/bin/env node\n");

  const codexModule = await import(`../src/codex.ts?resolve-bundled-codex=${Date.now()}`);
  const resolved = codexModule.resolveBundledCodexBin([tempDir]);

  assert.equal(fs.realpathSync(resolved), fs.realpathSync(path.join(binDir, "codex.js")));
});
