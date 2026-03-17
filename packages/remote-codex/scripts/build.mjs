import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const distRoot = path.join(packageRoot, "dist");

function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runNpm(args) {
  execFileSync(getNpmCommand(), args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

function copyDirectory(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, {
    force: true,
    recursive: true,
  });
}

runNpm(["run", "build", "-w", "@remote-codex/remote-codex-agent"]);
runNpm(["run", "build", "-w", "@remote-codex/remote-codex-web"]);

fs.rmSync(distRoot, { force: true, recursive: true });
copyDirectory(path.join(repoRoot, "apps", "remote-codex-agent", "dist"), path.join(distRoot, "agent"));
copyDirectory(path.join(repoRoot, "apps", "remote-codex-web", "dist"), path.join(distRoot, "web"));
