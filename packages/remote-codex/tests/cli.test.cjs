const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

function writeExecutable(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, { mode: 0o755 });
}

test("install-service writes the plist and issues launchctl commands in root mode", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-codex-cli-"));
  const launchctlLog = path.join(tempDir, "launchctl.log");
  const launchctlStub = path.join(tempDir, "bin", "launchctl");
  const plistPath = path.join(tempDir, "com.everyground.remote-codex.plist");
  const homeDir = path.join(tempDir, "home");

  fs.mkdirSync(homeDir, { recursive: true });
  writeExecutable(
    launchctlStub,
    `#!/bin/sh
echo "$@" >> "${launchctlLog}"
exit 0
`,
  );

  const scriptPath = path.resolve(__dirname, "../bin/remote-codex.cjs");
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `process.getuid = () => 0; process.argv = ["node", ${JSON.stringify(scriptPath)}, "install-service"]; require(${JSON.stringify(scriptPath)});`,
    ],
    {
      cwd: path.resolve(__dirname, "../../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: homeDir,
        NPM_CONFIG_PREFIX: path.join(homeDir, ".remote-codex", "npm-global"),
        PATH: `${path.dirname(launchctlStub)}:${process.env.PATH}`,
        REMOTE_CODEX_INSTALL_HOME: homeDir,
        REMOTE_CODEX_INSTALL_USER: process.env.USER || os.userInfo().username,
        REMOTE_CODEX_LAUNCHCTL_BIN: launchctlStub,
        REMOTE_CODEX_LAUNCHD_PLIST_PATH: plistPath,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(plistPath), true);
  const launchctlCalls = fs.readFileSync(launchctlLog, "utf8");
  assert.match(launchctlCalls, /bootout system/);
  assert.match(launchctlCalls, /bootstrap system/);
  assert.match(launchctlCalls, /enable system\/com\.everyground\.remote-codex/);
  assert.match(launchctlCalls, /kickstart -kp system\/com\.everyground\.remote-codex/);
});
