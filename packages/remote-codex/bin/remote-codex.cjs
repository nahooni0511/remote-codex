#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const { applyRuntimeEnvironment, resolveRuntimeRoot } = require("./runtime-env.cjs");
const {
  DEFAULT_HOST,
  DEFAULT_PORT,
  buildLaunchctlArgs,
  buildLaunchdPlist,
  getStateDir,
  isManagedServiceMode,
  lookupUserIds,
  parseCliArgs,
  parseLaunchctlStatus,
  resolveInstallContext,
  resolveServiceSpec,
} = require("./service-helpers.cjs");

function printUsage() {
  console.log(`Remote Codex

Usage:
  remote-codex [start]
  remote-codex run
  remote-codex stop
  remote-codex restart
  remote-codex status
  remote-codex logs [--follow]
  remote-codex install-service
  remote-codex uninstall-service`);
}

function runForegroundRuntime() {
  const runtimeRoot = resolveRuntimeRoot();
  applyRuntimeEnvironment({ runtimeRoot });
  require(path.join(runtimeRoot, "dist", "agent", "index.js"));
}

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
    env: options.env || process.env,
  });
}

function runLaunchctl(args, options = {}) {
  const launchctlBin = process.env.REMOTE_CODEX_LAUNCHCTL_BIN?.trim() || "launchctl";
  return runCommand(launchctlBin, args, options);
}

function failWithCommandResult(prefix, result) {
  const stderr = String(result.stderr || "").trim();
  const stdout = String(result.stdout || "").trim();
  const details = stderr || stdout;
  throw new Error(details ? `${prefix}: ${details}` : prefix);
}

function ensureRootOrReexec(args) {
  if (typeof process.getuid !== "function" || process.getuid() === 0) {
    return;
  }

  const context = resolveInstallContext();
  const stateDir = getStateDir(context);
  const npmPrefix = process.env.NPM_CONFIG_PREFIX?.trim() || path.join(stateDir, "npm-global");
  const sudoBin = process.env.REMOTE_CODEX_SUDO_BIN?.trim() || "sudo";
  const result = spawnSync(
    sudoBin,
    [
      "-E",
      process.execPath,
      __filename,
      ...args,
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NPM_CONFIG_PREFIX: npmPrefix,
        REMOTE_CODEX_DATA_DIR: stateDir,
        REMOTE_CODEX_INSTALL_HOME: context.homeDir,
        REMOTE_CODEX_INSTALL_USER: context.userName,
      },
    },
  );

  process.exit(result.status ?? 1);
}

function ensureLogDirectoriesOwned(spec) {
  fs.mkdirSync(spec.stateDir, { recursive: true });
  fs.mkdirSync(spec.logs.logsDir, { recursive: true });

  const { uid, gid } = lookupUserIds(spec.context.userName);
  if (uid === null || gid === null) {
    return;
  }

  try {
    fs.chownSync(spec.stateDir, uid, gid);
    fs.chownSync(spec.logs.logsDir, uid, gid);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || (error.code !== "EPERM" && error.code !== "EROFS")) {
      throw error;
    }
  }
}

function writePlist(spec) {
  fs.writeFileSync(spec.plistPath, buildLaunchdPlist(spec), { encoding: "utf8", mode: 0o644 });
  fs.chmodSync(spec.plistPath, 0o644);
}

function bootoutService(spec) {
  const result = runLaunchctl(buildLaunchctlArgs("bootout", spec));
  if (result.status !== 0) {
    const details = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (!/Could not find service|No such process|not loaded/i.test(details)) {
      failWithCommandResult("Failed to unload Remote Codex service", result);
    }
  }
}

function bootstrapService(spec) {
  const result = runLaunchctl(buildLaunchctlArgs("bootstrap", spec));
  if (result.status !== 0) {
    failWithCommandResult("Failed to bootstrap Remote Codex service", result);
  }
}

function enableService(spec) {
  const result = runLaunchctl(buildLaunchctlArgs("enable", spec));
  if (result.status !== 0) {
    failWithCommandResult("Failed to enable Remote Codex service", result);
  }
}

function disableService(spec) {
  const result = runLaunchctl(buildLaunchctlArgs("disable", spec));
  if (result.status !== 0) {
    const details = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (!/Could not find service|No such process/i.test(details)) {
      failWithCommandResult("Failed to disable Remote Codex service", result);
    }
  }
}

function kickstartService(spec) {
  const result = runLaunchctl(buildLaunchctlArgs("kickstart", spec));
  if (result.status !== 0) {
    failWithCommandResult("Failed to start Remote Codex service", result);
  }
}

function serviceExists(spec) {
  return fs.existsSync(spec.plistPath);
}

function installService() {
  ensureRootOrReexec(["install-service"]);

  const spec = resolveServiceSpec();
  ensureLogDirectoriesOwned(spec);
  writePlist(spec);
  bootoutService(spec);
  bootstrapService(spec);
  enableService(spec);
  kickstartService(spec);

  console.log(`Installed Remote Codex launchd service at ${spec.plistPath}`);
  console.log(`Local UI: http://localhost:${process.env.PORT || DEFAULT_PORT}`);
  console.log(`Logs: ${spec.logs.stdoutPath}, ${spec.logs.stderrPath}`);
}

function uninstallService() {
  ensureRootOrReexec(["uninstall-service"]);

  const spec = resolveServiceSpec();
  disableService(spec);
  bootoutService(spec);

  if (fs.existsSync(spec.plistPath)) {
    fs.unlinkSync(spec.plistPath);
  }

  console.log("Removed Remote Codex launchd service.");
}

function startService() {
  const spec = resolveServiceSpec();
  if (!serviceExists(spec)) {
    console.log("Remote Codex service is not installed yet. Installing it now.");
    installService();
    return;
  }

  ensureRootOrReexec(["start"]);
  const printResult = runLaunchctl(buildLaunchctlArgs("print", spec));
  if (printResult.status !== 0) {
    bootstrapService(spec);
  }

  enableService(spec);
  kickstartService(spec);
  console.log(`Remote Codex is starting in the background at http://localhost:${process.env.PORT || DEFAULT_PORT}`);
}

function stopService() {
  ensureRootOrReexec(["stop"]);
  const spec = resolveServiceSpec();
  bootoutService(spec);
  console.log("Stopped Remote Codex service.");
}

function restartService() {
  ensureRootOrReexec(["restart"]);
  const spec = resolveServiceSpec();
  bootoutService(spec);
  bootstrapService(spec);
  enableService(spec);
  kickstartService(spec);
  console.log("Restarted Remote Codex service.");
}

function getHealthStatus() {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const host = process.env.REMOTE_CODEX_HOST?.trim() || DEFAULT_HOST;

  return new Promise((resolve) => {
    const request = http.get(
      {
        host,
        path: "/api/bootstrap",
        port,
        timeout: 1_500,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );

    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function printStatus() {
  const spec = resolveServiceSpec();
  const result = runLaunchctl(buildLaunchctlArgs("print", spec));
  const healthy = await getHealthStatus();

  console.log(`Label: ${spec.label}`);
  console.log(`Plist: ${spec.plistPath}`);
  console.log(`State Directory: ${spec.stateDir}`);
  console.log(`Logs: ${spec.logs.stdoutPath}, ${spec.logs.stderrPath}`);
  console.log(`Health: ${healthy ? "healthy" : "unreachable"}`);

  if (result.status !== 0) {
    console.log("launchd: not loaded");
    return;
  }

  const parsed = parseLaunchctlStatus(String(result.stdout || ""));
  console.log(`launchd: loaded`);
  console.log(`PID: ${parsed.pid ?? "unknown"}`);
  console.log(`State: ${parsed.state || "unknown"}`);
  if (parsed.lastExitCode) {
    console.log(`Last Exit Code: ${parsed.lastExitCode}`);
  }
}

function tailLogs(args) {
  const spec = resolveServiceSpec();
  const follow = args.includes("--follow") || args.includes("-f");
  const tailBin = process.env.REMOTE_CODEX_TAIL_BIN?.trim() || "tail";
  const tailArgs = follow
    ? ["-n", "200", "-F", spec.logs.stdoutPath, spec.logs.stderrPath]
    : ["-n", "200", spec.logs.stdoutPath, spec.logs.stderrPath];

  const child = spawn(tailBin, tailArgs, { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

async function main() {
  const { command, args } = parseCliArgs(process.argv.slice(2));
  if (command === "help") {
    printUsage();
    return;
  }

  if (command === "run") {
    runForegroundRuntime();
    return;
  }

  if (process.platform !== "darwin") {
    throw new Error("Remote Codex daemon install is currently supported only on macOS. Use `remote-codex run`.");
  }

  switch (command) {
    case "start":
      startService();
      return;
    case "stop":
      stopService();
      return;
    case "restart":
      restartService();
      return;
    case "status":
      await printStatus();
      return;
    case "logs":
      tailLogs(args);
      return;
    case "install-service":
      installService();
      return;
    case "uninstall-service":
      uninstallService();
      return;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  if (isManagedServiceMode()) {
    console.error("Remote Codex service startup failed.");
  }
  process.exit(1);
});
