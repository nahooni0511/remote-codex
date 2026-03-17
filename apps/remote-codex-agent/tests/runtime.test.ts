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
