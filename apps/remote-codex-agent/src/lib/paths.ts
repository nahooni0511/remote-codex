import fs from "node:fs";
import path from "node:path";

function resolveConfiguredPath(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }

  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
}

function looksLikeRepoRoot(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "package.json")) &&
    fs.existsSync(path.join(candidate, "apps", "remote-codex-agent")) &&
    fs.existsSync(path.join(candidate, "apps", "remote-codex-web")) &&
    fs.existsSync(path.join(candidate, "packages", "contracts"))
  );
}

function findRepoRoot(start: string): string {
  const seeds = [process.cwd(), start];
  for (const seed of seeds) {
    let current = path.resolve(seed);
    while (true) {
      if (looksLikeRepoRoot(current)) {
        return current;
      }

      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  return path.resolve(start, "../../../..");
}

export const repoRoot = resolveConfiguredPath(process.env.REMOTE_CODEX_HOME, findRepoRoot(__dirname));
export const dataRoot = resolveConfiguredPath(process.env.REMOTE_CODEX_DATA_DIR, path.join(repoRoot, "data"));
export const artifactsDir = path.join(dataRoot, "artifacts");

export function resolveFromRepo(...segments: string[]): string {
  return path.resolve(repoRoot, ...segments);
}
