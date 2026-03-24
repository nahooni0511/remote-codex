const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  buildLaunchctlArgs,
  buildLaunchdPlist,
  getNpmPrefix,
  getStateDir,
  parseCliArgs,
  parseLaunchctlStatus,
  resolveServiceSpec,
} = require("../bin/service-helpers.cjs");

test("parseCliArgs defaults to start when no command is provided", () => {
  assert.deepEqual(parseCliArgs([]), { command: "start", args: [] });
  assert.deepEqual(parseCliArgs(["logs", "--follow"]), { command: "logs", args: ["--follow"] });
  assert.deepEqual(parseCliArgs(["--help"]), { command: "help", args: [] });
});

test("resolveServiceSpec derives the managed npm prefix under the state directory", () => {
  const context = { userName: "tester", homeDir: "/Users/tester", logName: "tester" };
  const stateDir = getStateDir(context, {});
  const npmPrefix = getNpmPrefix(stateDir, {});
  const spec = resolveServiceSpec({
    context,
    env: {},
    nodePath: "/opt/homebrew/bin/node",
    runtimeRoot: "/tmp/remote-codex",
  });

  assert.equal(stateDir, "/Users/tester/.remote-codex");
  assert.equal(npmPrefix, "/Users/tester/.remote-codex/npm-global");
  assert.equal(spec.environment.NPM_CONFIG_PREFIX, npmPrefix);
  assert.equal(spec.environment.REMOTE_CODEX_SERVICE_MODE, "launchd");
  assert.equal(spec.logs.stdoutPath, "/Users/tester/.remote-codex/logs/daemon.out.log");
});

test("buildLaunchdPlist includes the expected launchd keys", () => {
  const spec = resolveServiceSpec({
    context: { userName: "tester", homeDir: "/Users/tester", logName: "tester" },
    env: {},
    nodePath: "/opt/homebrew/bin/node",
    runtimeRoot: "/tmp/remote-codex",
  });

  const plist = buildLaunchdPlist(spec);

  assert.match(plist, /<key>UserName<\/key>\s*<string>tester<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(plist, /<string>run<\/string>/);
  assert.match(plist, /<key>NPM_CONFIG_PREFIX<\/key>/);
  assert.match(plist, /<key>REMOTE_CODEX_SERVICE_MODE<\/key>/);
});

test("buildLaunchctlArgs and parseLaunchctlStatus cover the launchctl integration points", () => {
  const spec = resolveServiceSpec({
    context: { userName: "tester", homeDir: "/Users/tester", logName: "tester" },
    env: { REMOTE_CODEX_LAUNCHD_PLIST_PATH: "/tmp/com.everyground.remote-codex.plist" },
    nodePath: "/opt/homebrew/bin/node",
    runtimeRoot: path.resolve("/tmp/remote-codex"),
  });

  assert.deepEqual(buildLaunchctlArgs("bootstrap", spec), ["bootstrap", "system", "/tmp/com.everyground.remote-codex.plist"]);
  assert.deepEqual(buildLaunchctlArgs("kickstart", spec), ["kickstart", "-kp", `system/${spec.label}`]);
  assert.deepEqual(parseLaunchctlStatus("pid = 777\nstate = running\nlast exit code = 0\n"), {
    pid: 777,
    state: "running",
    lastExitCode: "0",
  });
});
