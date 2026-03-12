import path from "node:path";

export const repoRoot = path.resolve(__dirname, "../../..");
export const dataRoot = path.join(repoRoot, "data");
export const artifactsDir = path.join(dataRoot, "artifacts");

export function resolveFromRepo(...segments: string[]): string {
  return path.resolve(repoRoot, ...segments);
}
