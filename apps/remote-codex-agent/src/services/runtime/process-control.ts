import { spawn } from "node:child_process";

export type RuntimeRestartTarget = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
};

let restartScheduled = false;
let restartHandler: ((reason: string) => Promise<void>) | null = null;

export function resolveRuntimeRestartTarget(input?: {
  execPath?: string;
  argv?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): RuntimeRestartTarget | null {
  const execPath = input?.execPath || process.execPath;
  const argv = input?.argv || process.argv;
  const cwd = input?.cwd || process.cwd();
  const env = input?.env || process.env;

  if (!execPath.trim() || argv.length < 2 || !argv[1]?.trim()) {
    return null;
  }

  return {
    command: execPath,
    args: argv.slice(1),
    cwd,
    env: { ...env },
  };
}

export function spawnRuntimeRestartTarget(target: RuntimeRestartTarget): void {
  const child = spawn(target.command, target.args, {
    cwd: target.cwd,
    detached: true,
    env: target.env,
    stdio: "ignore",
    windowsHide: true,
  });

  child.unref();
}

export function registerRuntimeRestartHandler(handler: (reason: string) => Promise<void>): void {
  restartHandler = handler;
}

export function canScheduleRuntimeRestart(): boolean {
  return Boolean(restartHandler && resolveRuntimeRestartTarget());
}

export function scheduleRuntimeRestart(reason: string, delayMs = 250): boolean {
  if (restartScheduled || !restartHandler) {
    return false;
  }

  restartScheduled = true;
  const activeHandler = restartHandler;
  setTimeout(() => {
    void activeHandler(reason).catch((error) => {
      restartScheduled = false;
      console.error("Runtime restart failed:", error);
    });
  }, delayMs);
  return true;
}
