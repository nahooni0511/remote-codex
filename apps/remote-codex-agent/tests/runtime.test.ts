import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("listProjectFileTree hides dot entries and exposes visible files", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-codex-runtime-"));
  fs.mkdirSync(path.join(tempDir, "subdir"));
  fs.mkdirSync(path.join(tempDir, ".hidden-dir"));
  fs.writeFileSync(path.join(tempDir, "visible.txt"), "hello");
  fs.writeFileSync(path.join(tempDir, ".env"), "SECRET=1");
  fs.writeFileSync(path.join(tempDir, "subdir", "child.txt"), "child");

  const runtimeModule = await import(`../src/services/runtime.ts?runtime-tree=${Date.now()}`);
  const project = {
    id: 1,
    name: "Runtime Test",
    folderPath: tempDir,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    connection: null,
    telegramBinding: null,
  };

  const tree = runtimeModule.listProjectFileTree(project);
  assert.deepEqual(
    tree.entries.map((entry: { name: string }) => entry.name),
    ["subdir", "visible.txt"],
  );
  assert.equal(tree.entries[0]?.hasChildren, true);
});

test("resolveComposerAttachments blocks files outside the project root", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-codex-runtime-"));
  const outsideFile = path.join(os.tmpdir(), `outside-${Date.now()}.txt`);
  fs.writeFileSync(path.join(tempDir, "inside.txt"), "inside");
  fs.writeFileSync(outsideFile, "outside");

  const runtimeModule = await import(`../src/services/runtime.ts?runtime-attachments=${Date.now()}`);
  const project = {
    id: 1,
    name: "Attachment Test",
    folderPath: tempDir,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    connection: null,
    telegramBinding: null,
  };

  assert.throws(() =>
    runtimeModule.resolveComposerAttachments(project, [
      {
        id: "outside",
        name: "outside.txt",
        path: outsideFile,
        source: "project-file",
      },
    ]),
  );
});

test("createDirectoryNode creates a visible child directory", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-codex-runtime-"));
  const runtimeModule = await import(`../src/services/runtime.ts?runtime-directories=${Date.now()}`);

  const created = runtimeModule.createDirectoryNode(tempDir, "new-folder");

  assert.equal(created.name, "new-folder");
  assert.equal(created.path, path.join(tempDir, "new-folder"));
  assert.equal(fs.existsSync(created.path), true);
  assert.equal(fs.statSync(created.path).isDirectory(), true);
});

test("createDirectoryNode rejects nested directory names", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-codex-runtime-"));
  const runtimeModule = await import(`../src/services/runtime.ts?runtime-directories-invalid=${Date.now()}`);

  assert.throws(() => runtimeModule.createDirectoryNode(tempDir, "nested/path"));
});

test("resolveRuntimeRestartTarget keeps the current executable and script arguments", async () => {
  const processControlModule = await import(`../src/services/runtime/process-control.ts?restart-target=${Date.now()}`);
  const target = processControlModule.resolveRuntimeRestartTarget({
    execPath: "/usr/local/bin/node",
    argv: ["/usr/local/bin/node", "/usr/local/bin/remote-codex", "--port", "3000"],
    cwd: "/tmp/runtime",
    env: { TEST_ENV: "1" },
  });

  assert.deepEqual(target, {
    command: "/usr/local/bin/node",
    args: ["/usr/local/bin/remote-codex", "--port", "3000"],
    cwd: "/tmp/runtime",
    env: { TEST_ENV: "1" },
  });
});

test("isManagedRuntimeService detects launchd-managed mode", async () => {
  const processControlModule = await import(`../src/services/runtime/process-control.ts?service-mode=${Date.now()}`);

  assert.equal(processControlModule.isManagedRuntimeService({ REMOTE_CODEX_SERVICE_MODE: "launchd" }), true);
  assert.equal(processControlModule.isManagedRuntimeService({ REMOTE_CODEX_SERVICE_MODE: "other" }), false);
  assert.equal(processControlModule.isManagedRuntimeService({}), false);
});
