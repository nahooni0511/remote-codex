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

test("install.sh installs the npm package, writes the shim, and invokes install-service", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-codex-install-"));
  const homeDir = path.join(tempDir, "home");
  const shimDir = path.join(tempDir, "shim");
  const binDir = path.join(tempDir, "bin");
  const logPath = path.join(tempDir, "commands.log");
  const prefixDir = path.join(homeDir, ".remote-codex", "npm-global");
  const packageRoot = path.join(prefixDir, "lib", "node_modules", "@everyground", "remote-codex");
  const installScript = path.resolve(__dirname, "../../../install.sh");

  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });

  writeExecutable(
    path.join(binDir, "npm"),
    `#!/bin/sh
echo "npm $@" >> "${logPath}"
prefix=""
package=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then
    prefix="$2"
    shift 2
    continue
  fi
  package="$1"
  shift
done
package_root="$prefix/lib/node_modules/$package"
mkdir -p "$package_root/bin" "$package_root/node_modules/@openai/codex/bin"
cat > "$package_root/bin/remote-codex.cjs" <<'EOF'
#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.REMOTE_CODEX_TEST_LOG, "cli " + process.argv.slice(2).join(" ") + "\\n");
process.exit(0);
EOF
chmod 755 "$package_root/bin/remote-codex.cjs"
cat > "$package_root/node_modules/@openai/codex/package.json" <<'EOF'
{"name":"@openai/codex","bin":{"codex":"bin/codex.js"}}
EOF
cat > "$package_root/node_modules/@openai/codex/bin/codex.js" <<'EOF'
#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.REMOTE_CODEX_TEST_LOG, "codex " + process.argv.slice(2).join(" ") + "\\n");
process.exit(0);
EOF
chmod 755 "$package_root/node_modules/@openai/codex/bin/codex.js"
`,
  );

  writeExecutable(
    path.join(binDir, "sudo"),
    `#!/bin/sh
echo "sudo $@" >> "${logPath}"
exec "$@"
`,
  );

  const result = spawnSync("bash", [installScript], {
    cwd: path.resolve(__dirname, "../../.."),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: homeDir,
      PATH: `${binDir}:${process.env.PATH}`,
      REMOTE_CODEX_INSTALL_SHIM_DIR: shimDir,
      REMOTE_CODEX_INSTALL_SKIP_HEALTHCHECK: "1",
      REMOTE_CODEX_TEST_LOG: logPath,
      USER: process.env.USER || os.userInfo().username,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(shimDir, "remote-codex")), true);
  const shim = fs.readFileSync(path.join(shimDir, "remote-codex"), "utf8");
  assert.match(shim, /remote-codex\.cjs/);

  const log = fs.readFileSync(logPath, "utf8");
  assert.match(log, /npm install -g --prefix/);
  assert.match(log, /codex login status/);
  assert.match(log, /cli install-service/);
});
