import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type { ComposerAttachmentRecord, ProjectFileNode, ProjectGitState } from "@remote-codex/contracts";

import type { ProjectRecord, ThreadRecord } from "../../db";
import { HttpError, assertNonEmptyString } from "../../lib/http";
import { repoRoot } from "../../lib/paths";

const execFileAsync = promisify(execFile);
const REMOTE_UPLOADS_DIRNAME = ".remote-codex";

export type FsNode = {
  name: string;
  path: string;
  hasChildren: boolean;
};

export type ProjectGitSnapshot = {
  isRepo: boolean;
  head: string | null;
  currentBranch: string | null;
  clean: boolean;
  statusPorcelain: string;
};

export type ProjectFileTreeResult = {
  rootPath: string;
  currentPath: string;
  entries: ProjectFileNode[];
};

async function execFileText(command: string, args: string[], cwd = repoRoot): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    maxBuffer: 8 * 1024 * 1024,
  });
  return String(stdout || "").trim();
}

async function execFileTextOrNull(command: string, args: string[], cwd = repoRoot): Promise<string | null> {
  try {
    return await execFileText(command, args, cwd);
  } catch {
    return null;
  }
}

export function normalizeExistingDirectoryPath(input?: string): string {
  const target = input?.trim() ? path.resolve(input) : path.parse(repoRoot).root;

  if (!fs.existsSync(target)) {
    throw new HttpError(400, "Directory path does not exist.");
  }

  if (!fs.statSync(target).isDirectory()) {
    throw new HttpError(400, "Selected path must be a directory.");
  }

  return target;
}

function isVisibleDirectoryEntry(entry: fs.Dirent): boolean {
  return entry.isDirectory() && !entry.name.startsWith(".");
}

function directoryHasChildren(targetPath: string): boolean {
  try {
    return fs
      .readdirSync(targetPath, { withFileTypes: true })
      .some((entry) => isVisibleDirectoryEntry(entry));
  } catch {
    return false;
  }
}

export function listDirectoryNodes(targetPath: string): FsNode[] {
  const resolvedPath = normalizeExistingDirectoryPath(targetPath);

  try {
    return fs
      .readdirSync(resolvedPath, { withFileTypes: true })
      .filter((entry) => isVisibleDirectoryEntry(entry))
      .sort((left, right) => left.name.localeCompare(right.name, "ko"))
      .slice(0, 300)
      .map((entry) => {
        const entryPath = path.join(resolvedPath, entry.name);

        return {
          name: entry.name,
          path: entryPath,
          hasChildren: directoryHasChildren(entryPath),
        };
      });
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? `Cannot read directory: ${error.message}` : "Cannot read directory.",
    );
  }
}

export function normalizeNewDirectoryName(input: string): string {
  const directoryName = assertNonEmptyString(input, "Directory name");

  if (directoryName === "." || directoryName === "..") {
    throw new HttpError(400, "Directory name is invalid.");
  }

  if (path.basename(directoryName) !== directoryName || directoryName.includes("/") || directoryName.includes("\\")) {
    throw new HttpError(400, "Directory name cannot include path separators.");
  }

  return directoryName;
}

export function createDirectoryNode(parentPath: string, directoryName: string): FsNode {
  const resolvedParentPath = normalizeExistingDirectoryPath(parentPath);
  const normalizedName = normalizeNewDirectoryName(directoryName);
  const nextPath = path.join(resolvedParentPath, normalizedName);

  if (fs.existsSync(nextPath)) {
    throw new HttpError(409, "A file or directory with the same name already exists.");
  }

  try {
    fs.mkdirSync(nextPath);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? `Cannot create directory: ${error.message}` : "Cannot create directory.",
    );
  }

  return {
    name: normalizedName,
    path: nextPath,
    hasChildren: false,
  };
}

export function isPathInsideRoot(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function ensureProjectPath(project: ProjectRecord, targetPath: string, label = "Project path"): string {
  const resolvedPath = path.resolve(targetPath);
  if (!isPathInsideRoot(project.folderPath, resolvedPath)) {
    throw new HttpError(400, `${label} must stay within the project root.`);
  }
  return resolvedPath;
}

function isVisibleProjectEntry(entry: fs.Dirent): boolean {
  return !entry.name.startsWith(".");
}

function directoryHasVisibleProjectChildren(targetPath: string): boolean {
  try {
    return fs
      .readdirSync(targetPath, { withFileTypes: true })
      .some((entry) => isVisibleProjectEntry(entry));
  } catch {
    return false;
  }
}

export async function captureProjectGitSnapshot(project: ProjectRecord): Promise<ProjectGitSnapshot> {
  const insideWorkTree = await execFileTextOrNull("git", ["rev-parse", "--is-inside-work-tree"], project.folderPath);
  if (insideWorkTree !== "true") {
    return {
      isRepo: false,
      head: null,
      currentBranch: null,
      clean: false,
      statusPorcelain: "",
    };
  }

  const statusPorcelain =
    (await execFileTextOrNull("git", ["status", "--porcelain", "--untracked-files=normal"], project.folderPath)) || "";

  return {
    isRepo: true,
    head: (await execFileTextOrNull("git", ["rev-parse", "HEAD"], project.folderPath)) || null,
    currentBranch: (await execFileTextOrNull("git", ["branch", "--show-current"], project.folderPath)) || null,
    clean: !statusPorcelain.trim(),
    statusPorcelain,
  };
}

export function parseGitStatusEntries(statusPorcelain: string): Array<{
  status: string;
  path: string;
  isUntracked: boolean;
}> {
  return statusPorcelain
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const pathText = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() || rawPath : rawPath;
      return {
        status: status.trim() || status,
        path: pathText,
        isUntracked: status === "??",
      };
    });
}

export function parseGitNumstat(output: string): Map<string, { insertions: number | null; deletions: number | null; statsExact: boolean }> {
  const result = new Map<string, { insertions: number | null; deletions: number | null; statsExact: boolean }>();
  output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const [insertionsText = "", deletionsText = "", ...pathParts] = line.split("\t");
      const filePath = pathParts.join("\t").trim();
      if (!filePath) {
        return;
      }

      const insertions = insertionsText === "-" ? null : Number(insertionsText);
      const deletions = deletionsText === "-" ? null : Number(deletionsText);
      result.set(filePath, {
        insertions: Number.isFinite(insertions) ? insertions : null,
        deletions: Number.isFinite(deletions) ? deletions : null,
        statsExact: insertionsText !== "-" && deletionsText !== "-",
      });
    });
  return result;
}

export async function getProjectGitState(project: ProjectRecord): Promise<ProjectGitState> {
  const snapshot = await captureProjectGitSnapshot(project);
  if (!snapshot.isRepo) {
    return {
      isRepo: false,
      currentBranch: null,
      branches: [],
      canCreateBranch: false,
      undoSupported: false,
    };
  }

  const branches = ((await execFileTextOrNull(
    "git",
    ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    project.folderPath,
  )) || "")
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "ko"));

  return {
    isRepo: true,
    currentBranch: snapshot.currentBranch,
    branches,
    canCreateBranch: true,
    undoSupported: true,
  };
}

export async function switchProjectGitBranch(input: {
  project: ProjectRecord;
  branchName: string;
  createNew?: boolean;
}): Promise<ProjectGitState> {
  const snapshot = await captureProjectGitSnapshot(input.project);
  if (!snapshot.isRepo) {
    throw new HttpError(400, "Git이 연결된 project에서만 branch를 설정할 수 있습니다.");
  }

  const normalizedBranch = assertNonEmptyString(input.branchName, "Branch name");
  const targetBranch =
    input.createNew && !normalizedBranch.startsWith("codex/") ? `codex/${normalizedBranch}` : normalizedBranch;

  if (input.createNew) {
    await execFileText("git", ["check-ref-format", "--branch", targetBranch], input.project.folderPath);
    await execFileText("git", ["switch", "-c", targetBranch], input.project.folderPath);
  } else {
    await execFileText("git", ["switch", targetBranch], input.project.folderPath);
  }

  return getProjectGitState(input.project);
}

export function listProjectFileTree(project: ProjectRecord, currentPath?: string): ProjectFileTreeResult {
  const rootPath = project.folderPath;
  const desiredPath = currentPath?.trim() ? currentPath.trim() : rootPath;
  const resolvedCurrentPath = ensureProjectPath(project, desiredPath);

  if (!fs.existsSync(resolvedCurrentPath)) {
    throw new HttpError(404, "Selected path does not exist.");
  }
  if (!fs.statSync(resolvedCurrentPath).isDirectory()) {
    throw new HttpError(400, "Selected path must be a directory.");
  }

  const entries = fs
    .readdirSync(resolvedCurrentPath, { withFileTypes: true })
    .filter((entry) => isVisibleProjectEntry(entry))
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name, "ko");
    })
    .slice(0, 500)
    .map((entry) => {
      const entryPath = path.join(resolvedCurrentPath, entry.name);
      return {
        name: entry.name,
        path: entryPath,
        relativePath: path.relative(rootPath, entryPath),
        kind: entry.isDirectory() ? "directory" : "file",
        hasChildren: entry.isDirectory() ? directoryHasVisibleProjectChildren(entryPath) : false,
      } satisfies ProjectFileNode;
    });

  return {
    rootPath,
    currentPath: resolvedCurrentPath,
    entries,
  };
}

export async function saveThreadAttachmentUpload(input: {
  project: ProjectRecord;
  thread: ThreadRecord;
  fileName: string;
  mimeType?: string | null;
  base64Data: string;
}): Promise<ComposerAttachmentRecord> {
  const rawName = path.basename(assertNonEmptyString(input.fileName, "File name"));
  const safeName = rawName.replace(/[^a-zA-Z0-9._ -]/g, "_") || "attachment.bin";
  const uploadsDir = path.join(input.project.folderPath, REMOTE_UPLOADS_DIRNAME, "uploads", `thread-${input.thread.id}`);
  fs.mkdirSync(uploadsDir, { recursive: true });

  const filePath = path.join(uploadsDir, `${Date.now()}-${safeName}`);
  const buffer = Buffer.from(assertNonEmptyString(input.base64Data, "Attachment data"), "base64");
  fs.writeFileSync(filePath, buffer);

  return {
    id: randomUUID(),
    name: safeName,
    path: filePath,
    relativePath: path.relative(input.project.folderPath, filePath),
    source: "uploaded-file",
    mimeType: input.mimeType?.trim() || null,
  };
}
