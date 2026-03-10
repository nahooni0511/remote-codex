import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ProjectRecord, ThreadRecord } from "./db";

const DEFAULT_CODEX_BIN = process.env.CODEX_BIN?.trim() || "codex";
const DEFAULT_CODEX_SANDBOX = process.env.CODEX_SANDBOX?.trim() || "workspace-write";
const DEFAULT_CODEX_APPROVAL = process.env.CODEX_APPROVAL?.trim() || "never";
const DEFAULT_CODEX_TIMEOUT_MS = Number(process.env.CODEX_TIMEOUT_MS || 10 * 60 * 1000);
const DEFAULT_CODEX_MODEL = process.env.CODEX_MODEL?.trim() || "";
const ENABLE_CODEX_SEARCH = process.env.CODEX_SEARCH === "true";

export interface CodexTurnInput {
  project: ProjectRecord;
  thread: ThreadRecord;
  userMessage: string;
  senderName: string;
  source: "telegram" | "web";
  onProgress?: (event: CodexProgressEvent) => void | Promise<void>;
}

export interface CodexTurnResult {
  sessionId: string;
  output: string;
  createdSession: boolean;
  artifacts: CodexArtifact[];
}

export interface CodexProgressEvent {
  text: string;
}

export interface CodexArtifact {
  kind: "image" | "document";
  filename: string;
  mimeType: string;
  base64Data: string | null;
  filePath: string | null;
}

interface CodexJsonEvent {
  type?: string;
  thread_id?: string;
  item?: {
    id?: string;
    type?: string;
    text?: string;
    arguments?: {
      filename?: string;
    };
    result?: {
      content?: Array<{
        type?: string;
        text?: string;
        data?: string;
        mime_type?: string;
      }>;
    };
  };
}

export class CodexExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexExecutionError";
  }
}

let codexQueue: Promise<unknown> = Promise.resolve();

function buildCodexPrompt(input: CodexTurnInput): string {
  return input.userMessage.trim();
}

function extractArtifactPathFromText(text: string): string | null {
  const markdownLinkMatch = text.match(/\[[^\]]+\]\(([^)]+)\)/);
  if (!markdownLinkMatch?.[1]) {
    return null;
  }

  return markdownLinkMatch[1].trim() || null;
}

function normalizeArtifactFilename(filePath: string | null, mimeType: string, kind: "image" | "document"): string {
  if (filePath) {
    return path.basename(filePath);
  }

  const extension =
    mimeType === "image/jpeg"
      ? ".jpg"
      : mimeType === "image/png"
        ? ".png"
        : mimeType === "application/pdf"
          ? ".pdf"
          : kind === "image"
            ? ".png"
            : ".bin";

  return `codex-artifact${extension}`;
}

function pushArtifact(
  artifacts: CodexArtifact[],
  artifact: CodexArtifact,
): void {
  const duplicate = artifacts.some(
    (existing) =>
      existing.kind === artifact.kind &&
      existing.filename === artifact.filename &&
      existing.mimeType === artifact.mimeType &&
      existing.filePath === artifact.filePath &&
      existing.base64Data === artifact.base64Data,
  );

  if (!duplicate) {
    artifacts.push(artifact);
  }
}

function collectArtifactsFromItem(
  cwd: string,
  item: NonNullable<CodexJsonEvent["item"]>,
  artifacts: CodexArtifact[],
): void {
  if (item.type !== "mcp_tool_call" || !item.result?.content?.length) {
    return;
  }

  let artifactPath =
    typeof item.arguments?.filename === "string" && item.arguments.filename.trim()
      ? item.arguments.filename.trim()
      : null;

  for (const contentItem of item.result.content) {
    if (!artifactPath && typeof contentItem.text === "string") {
      artifactPath = extractArtifactPathFromText(contentItem.text);
    }
  }

  const resolvedArtifactPath = artifactPath
    ? path.resolve(cwd, artifactPath)
    : null;

  for (const contentItem of item.result.content) {
    if (contentItem.type !== "image" && contentItem.type !== "file") {
      continue;
    }

    const mimeType =
      typeof contentItem.mime_type === "string" && contentItem.mime_type.trim()
        ? contentItem.mime_type.trim()
        : contentItem.type === "image"
          ? "image/png"
          : "application/octet-stream";

    pushArtifact(artifacts, {
      kind: contentItem.type === "image" ? "image" : "document",
      filename: normalizeArtifactFilename(resolvedArtifactPath, mimeType, contentItem.type === "image" ? "image" : "document"),
      mimeType,
      base64Data: typeof contentItem.data === "string" && contentItem.data.trim() ? contentItem.data.trim() : null,
      filePath: resolvedArtifactPath,
    });
  }
}

async function runCodexCommand(input: {
  cwd: string;
  prompt: string;
  sessionId?: string | null;
  onProgress?: (event: CodexProgressEvent) => void | Promise<void>;
}): Promise<CodexTurnResult> {
  const outputFile = path.join(
    os.tmpdir(),
    `codex-telegram-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
  );

  const args = [
    "-c",
    `approval_policy="${DEFAULT_CODEX_APPROVAL}"`,
  ];

  if (DEFAULT_CODEX_SANDBOX) {
    args.push("-c", `sandbox_mode="${DEFAULT_CODEX_SANDBOX}"`);
  }

  if (DEFAULT_CODEX_MODEL) {
    args.push("-m", DEFAULT_CODEX_MODEL);
  }

  if (ENABLE_CODEX_SEARCH) {
    args.push("--search");
  }

  args.push(
    "exec",
    "--json",
    "--skip-git-repo-check",
    "-C",
    input.cwd,
    "-o",
    outputFile,
  );

  if (input.sessionId) {
    args.push("resume", input.sessionId, input.prompt);
  } else {
    args.push(input.prompt);
  }

  return new Promise<CodexTurnResult>((resolve, reject) => {
    const child = spawn(DEFAULT_CODEX_BIN, args, {
      cwd: input.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let detectedSessionId = input.sessionId ?? null;
    let fallbackOutput = "";
    const artifacts: CodexArtifact[] = [];
    let settled = false;
    let progressChain: Promise<void> = Promise.resolve();

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, DEFAULT_CODEX_TIMEOUT_MS);

    function enqueueProgress(event: CodexProgressEvent): void {
      if (!input.onProgress) {
        return;
      }

      progressChain = progressChain.then(async () => {
        try {
          await input.onProgress?.(event);
        } catch {
          // Ignore progress delivery errors; final answer still matters.
        }
      });
    }

    function handleStdoutChunk(chunk: string): void {
      stdoutBuffer += chunk;

      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        newlineIndex = stdoutBuffer.indexOf("\n");

        if (!line) {
          continue;
        }

        try {
          const event = JSON.parse(line) as CodexJsonEvent;
          if (event.type === "thread.started" && event.thread_id) {
            detectedSessionId = event.thread_id;
          }

          if (event.type === "item.completed" && event.item) {
            collectArtifactsFromItem(input.cwd, event.item, artifacts);

            if (event.item.text && event.item.type === "reasoning") {
              enqueueProgress({
                text: event.item.text,
              });
            }

            if (event.item.text && event.item.type === "agent_message") {
              fallbackOutput = event.item.text;
            }
          }
        } catch {
          // Ignore non-JSON lines from the CLI.
        }
      }
    }

    child.stdout.on("data", (chunk) => {
      handleStdoutChunk(String(chunk));
    });

    child.stderr.on("data", (chunk) => {
      stderrBuffer += String(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(new CodexExecutionError(`Codex 실행 실패: ${error.message}`));
      }
    });

    child.on("close", async (code) => {
      clearTimeout(timeout);
      if (settled) {
        return;
      }

      settled = true;

      try {
        await progressChain;
        const fileOutput = await fs.readFile(outputFile, "utf8").catch(() => "");
        await fs.unlink(outputFile).catch(() => undefined);
        const finalOutput = fileOutput.trim() || fallbackOutput.trim();

        if (code !== 0) {
          reject(
            new CodexExecutionError(
              stderrBuffer.trim() || finalOutput || `Codex 실행이 비정상 종료되었습니다. exit=${code ?? "unknown"}`,
            ),
          );
          return;
        }

        if (!detectedSessionId) {
          reject(new CodexExecutionError("Codex 세션 ID를 확인하지 못했습니다."));
          return;
        }

        if (!finalOutput) {
          reject(new CodexExecutionError("Codex가 비어 있는 응답을 반환했습니다."));
          return;
        }

        resolve({
          sessionId: detectedSessionId,
          output: finalOutput,
          createdSession: !input.sessionId,
          artifacts,
        });
      } catch (error) {
        reject(
          new CodexExecutionError(
            error instanceof Error ? error.message : "Codex 응답 후처리에 실패했습니다.",
          ),
        );
      }
    });
  });
}

export function runCodexTurn(input: CodexTurnInput): Promise<CodexTurnResult> {
  const prompt = buildCodexPrompt(input);
  const task = () =>
    runCodexCommand({
      cwd: input.project.folderPath,
      prompt,
      sessionId: input.thread.codexSessionId,
      onProgress: input.onProgress,
    });

  const queued = codexQueue.then(task, task);
  codexQueue = queued.then(
    () => undefined,
    () => undefined,
  );

  return queued;
}
