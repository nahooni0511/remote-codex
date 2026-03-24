const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_SERVICE_LABEL = "com.everyground.remote-codex";
const DEFAULT_PLIST_PATH = `/Library/LaunchDaemons/${DEFAULT_SERVICE_LABEL}.plist`;
const DEFAULT_SHIM_DIR = "/usr/local/bin";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function parseCliArgs(argv) {
  const [maybeCommand, ...rest] = argv;
  const knownCommands = new Set([
    "start",
    "run",
    "stop",
    "restart",
    "status",
    "logs",
    "install-service",
    "uninstall-service",
    "help",
  ]);

  if (!maybeCommand) {
    return { command: "start", args: [] };
  }

  if (maybeCommand === "-h" || maybeCommand === "--help") {
    return { command: "help", args: rest };
  }

  if (knownCommands.has(maybeCommand)) {
    return { command: maybeCommand, args: rest };
  }

  return { command: "start", args: argv };
}

function resolveRuntimeRoot(currentDir = __dirname) {
  return path.resolve(currentDir, "..");
}

function getCliPath(runtimeRoot = resolveRuntimeRoot()) {
  return path.join(runtimeRoot, "bin", "remote-codex.cjs");
}

function getServiceLabel(env = process.env) {
  return env.REMOTE_CODEX_SERVICE_LABEL?.trim() || DEFAULT_SERVICE_LABEL;
}

function getPlistPath(env = process.env) {
  return env.REMOTE_CODEX_LAUNCHD_PLIST_PATH?.trim() || DEFAULT_PLIST_PATH;
}

function getShimDir(env = process.env) {
  return env.REMOTE_CODEX_INSTALL_SHIM_DIR?.trim() || DEFAULT_SHIM_DIR;
}

function isManagedServiceMode(env = process.env) {
  return env.REMOTE_CODEX_SERVICE_MODE?.trim() === "launchd";
}

function readCommandText(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    return null;
  }

  return String(result.stdout || "").trim();
}

function lookupUserHome(userName) {
  const output = readCommandText("dscl", [".", "-read", `/Users/${userName}`, "NFSHomeDirectory"]);
  if (!output) {
    return path.join("/Users", userName);
  }

  const match = output.match(/NFSHomeDirectory:\s+(.+)$/m);
  return match?.[1]?.trim() || path.join("/Users", userName);
}

function lookupUserIds(userName) {
  const uidText = readCommandText("id", ["-u", userName]);
  const gidText = readCommandText("id", ["-g", userName]);

  return {
    uid: uidText ? Number(uidText) : null,
    gid: gidText ? Number(gidText) : null,
  };
}

function resolveInstallContext(env = process.env) {
  const currentUser = os.userInfo().username;
  const installUser =
    env.REMOTE_CODEX_INSTALL_USER?.trim() || env.SUDO_USER?.trim() || env.USER?.trim() || currentUser;
  const homeDir = env.REMOTE_CODEX_INSTALL_HOME?.trim() || (installUser === currentUser ? os.homedir() : lookupUserHome(installUser));

  return {
    userName: installUser,
    homeDir,
    logName: installUser,
  };
}

function getStateDir(context, env = process.env) {
  return env.REMOTE_CODEX_DATA_DIR?.trim() || path.join(context.homeDir, ".remote-codex");
}

function getNpmPrefix(stateDir, env = process.env) {
  return env.NPM_CONFIG_PREFIX?.trim() || path.join(stateDir, "npm-global");
}

function getLogPaths(stateDir) {
  const logsDir = path.join(stateDir, "logs");
  return {
    logsDir,
    stdoutPath: path.join(logsDir, "daemon.out.log"),
    stderrPath: path.join(logsDir, "daemon.err.log"),
  };
}

function buildPathValue(nodePath, npmPrefix, env = process.env) {
  const entries = [
    path.dirname(nodePath),
    path.join(npmPrefix, "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];

  const existing = String(env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);

  return Array.from(new Set([...entries, ...existing])).join(path.delimiter);
}

function resolveServiceSpec(options = {}) {
  const env = options.env || process.env;
  const runtimeRoot = options.runtimeRoot || resolveRuntimeRoot(options.currentDir);
  const nodePath = options.nodePath || process.execPath;
  const context = options.context || resolveInstallContext(env);
  const stateDir = options.stateDir || getStateDir(context, env);
  const npmPrefix = options.npmPrefix || getNpmPrefix(stateDir, env);
  const label = options.label || getServiceLabel(env);
  const plistPath = options.plistPath || getPlistPath(env);
  const cliPath = options.cliPath || getCliPath(runtimeRoot);
  const logs = getLogPaths(stateDir);

  const environment = {
    HOME: context.homeDir,
    LOGNAME: context.logName,
    NPM_CONFIG_PREFIX: npmPrefix,
    PATH: buildPathValue(nodePath, npmPrefix, env),
    REMOTE_CODEX_DATA_DIR: stateDir,
    REMOTE_CODEX_SERVICE_MODE: "launchd",
    USER: context.userName,
  };

  return {
    cliPath,
    context,
    environment,
    label,
    logs,
    nodePath,
    npmPrefix,
    plistPath,
    runtimeRoot,
    serviceTarget: `system/${label}`,
    stateDir,
  };
}

function buildLaunchdPlist(spec) {
  const envEntries = Object.entries(spec.environment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, value]) =>
        `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`,
    )
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${escapeXml(spec.label)}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    `    <string>${escapeXml(spec.nodePath)}</string>`,
    `    <string>${escapeXml(spec.cliPath)}</string>`,
    "    <string>run</string>",
    "  </array>",
    "  <key>UserName</key>",
    `  <string>${escapeXml(spec.context.userName)}</string>`,
    "  <key>WorkingDirectory</key>",
    `  <string>${escapeXml(spec.context.homeDir)}</string>`,
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    envEntries,
    "  </dict>",
    "  <key>StandardOutPath</key>",
    `  <string>${escapeXml(spec.logs.stdoutPath)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${escapeXml(spec.logs.stderrPath)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function buildLaunchctlArgs(action, spec) {
  switch (action) {
    case "bootstrap":
      return ["bootstrap", "system", spec.plistPath];
    case "bootout":
      return ["bootout", "system", spec.plistPath];
    case "enable":
      return ["enable", spec.serviceTarget];
    case "disable":
      return ["disable", spec.serviceTarget];
    case "kickstart":
      return ["kickstart", "-kp", spec.serviceTarget];
    case "print":
      return ["print", spec.serviceTarget];
    default:
      throw new Error(`Unsupported launchctl action: ${action}`);
  }
}

function parseLaunchctlStatus(output) {
  const pidMatch = output.match(/\bpid = (\d+)/);
  const stateMatch = output.match(/\bstate = ([^\n]+)/);
  const lastExitMatch = output.match(/\blast exit code = ([^\n]+)/);

  return {
    pid: pidMatch ? Number(pidMatch[1]) : null,
    state: stateMatch ? stateMatch[1].trim() : null,
    lastExitCode: lastExitMatch ? lastExitMatch[1].trim() : null,
  };
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PLIST_PATH,
  DEFAULT_PORT,
  DEFAULT_SERVICE_LABEL,
  buildLaunchctlArgs,
  buildLaunchdPlist,
  getCliPath,
  getLogPaths,
  getNpmPrefix,
  getPlistPath,
  getServiceLabel,
  getShimDir,
  getStateDir,
  isManagedServiceMode,
  lookupUserIds,
  parseCliArgs,
  parseLaunchctlStatus,
  resolveInstallContext,
  resolveRuntimeRoot,
  resolveServiceSpec,
};
