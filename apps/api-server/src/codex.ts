import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { ProjectRecord, ThreadRecord } from "./db";
import { repoRoot } from "./lib/paths";

const MIN_CODEX_VERSION = [0, 113, 0] as const;
const DEFAULT_CODEX_SANDBOX = process.env.CODEX_SANDBOX?.trim() || "workspace-write";
const DEFAULT_CODEX_APPROVAL = process.env.CODEX_APPROVAL?.trim() || "never";
const DEFAULT_REQUEST_TIMEOUT_MS = Number(process.env.CODEX_REQUEST_TIMEOUT_MS || 30_000);

export interface CodexArtifact {
  kind: "image" | "document";
  filename: string;
  mimeType: string;
  base64Data: string | null;
  filePath: string | null;
}

export interface CodexPlanStep {
  step: string;
  status: string;
}

export interface CodexModelRecord {
  id: string;
  model: string;
  displayName: string;
  hidden: boolean;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string;
  isDefault: boolean;
}

export interface CodexThreadRuntimeStatus {
  type: string;
}

export interface CodexRuntimeInfo {
  version: string;
  binPath: string;
}

export interface CodexTurnEvent {
  type:
    | "reasoning-delta"
    | "reasoning-complete"
    | "assistant-delta"
    | "assistant-complete"
    | "plan-updated";
  text?: string;
  phase?: string | null;
  explanation?: string | null;
  plan?: CodexPlanStep[];
}

export interface CodexTurnInput {
  project: ProjectRecord;
  thread: ThreadRecord;
  userMessage: string;
  senderName: string;
  source: "telegram" | "web";
  mode: "default" | "plan";
  model: string;
  reasoningEffort: string | null;
  developerInstructions: string | null;
  onEvent?: (event: CodexTurnEvent) => void | Promise<void>;
}

export interface CodexTurnResult {
  runtimeThreadId: string;
  output: string;
  createdRuntimeThread: boolean;
  artifacts: CodexArtifact[];
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
}

interface JsonRpcNotification {
  method: string;
  params?: Record<string, unknown>;
}

interface ThreadResponse {
  thread?: {
    id?: string;
    status?: {
      type?: string;
    };
  };
  model?: string;
  reasoningEffort?: string | null;
}

interface TurnResponse {
  turn?: {
    id?: string;
    status?: string;
    error?: {
      message?: string;
      additionalDetails?: string | null;
    } | null;
  };
}

interface ActiveTurn {
  runtimeThreadId: string;
  turnId: string | null;
  cwd: string;
  onEvent?: (event: CodexTurnEvent) => void | Promise<void>;
  createdRuntimeThread: boolean;
  artifacts: CodexArtifact[];
  finalOutput: string;
  lastAgentText: string;
  itemStates: Map<string, { type: string; phase: string | null; text: string }>;
  settle: {
    resolve: (result: CodexTurnResult) => void;
    reject: (error: Error) => void;
  };
}

export class CodexExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexExecutionError";
  }
}

function getBundledCodexBin(): string | null {
  const cwd = repoRoot;
  const candidate = process.platform === "win32"
    ? path.join(cwd, "node_modules", ".bin", "codex.cmd")
    : path.join(cwd, "node_modules", ".bin", "codex");

  return fs.existsSync(candidate) ? candidate : null;
}

function getCodexBinPath(): string {
  const configured = process.env.CODEX_BIN?.trim();
  if (configured) {
    return configured;
  }

  return getBundledCodexBin() || "codex";
}

function parseVersionParts(versionText: string): number[] | null {
  const match = versionText.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }

  return match.slice(1).map((part) => Number(part));
}

function isVersionLessThan(parts: number[], minimum: readonly number[]): boolean {
  for (let index = 0; index < minimum.length; index += 1) {
    const left = parts[index] ?? 0;
    const right = minimum[index] ?? 0;

    if (left < right) {
      return true;
    }

    if (left > right) {
      return false;
    }
  }

  return false;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof CodexExecutionError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Codex 요청에 실패했습니다.";
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

function pushArtifact(artifacts: CodexArtifact[], artifact: CodexArtifact): void {
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

function collectArtifactsFromMcpItem(
  cwd: string,
  item: Record<string, unknown>,
  artifacts: CodexArtifact[],
): void {
  if (item.type !== "mcpToolCall") {
    return;
  }

  const result = item.result as { content?: unknown[] } | null | undefined;
  if (!result?.content?.length) {
    return;
  }

  const argumentsObject = item.arguments as { filename?: string } | null | undefined;
  let artifactPath =
    typeof argumentsObject?.filename === "string" && argumentsObject.filename.trim()
      ? argumentsObject.filename.trim()
      : null;

  for (const contentItem of result.content) {
    if (
      !artifactPath &&
      typeof contentItem === "object" &&
      contentItem &&
      typeof (contentItem as { text?: unknown }).text === "string"
    ) {
      artifactPath = extractArtifactPathFromText(String((contentItem as { text: string }).text));
    }
  }

  const resolvedArtifactPath = artifactPath ? path.resolve(cwd, artifactPath) : null;

  for (const contentItem of result.content) {
    if (typeof contentItem !== "object" || !contentItem) {
      continue;
    }

    const record = contentItem as {
      type?: unknown;
      data?: unknown;
      mime_type?: unknown;
      mimeType?: unknown;
    };

    if (record.type !== "image" && record.type !== "file") {
      continue;
    }

    const mimeType =
      typeof record.mime_type === "string" && record.mime_type.trim()
        ? record.mime_type.trim()
        : typeof record.mimeType === "string" && record.mimeType.trim()
          ? record.mimeType.trim()
          : record.type === "image"
            ? "image/png"
            : "application/octet-stream";

    pushArtifact(artifacts, {
      kind: record.type === "image" ? "image" : "document",
      filename: normalizeArtifactFilename(
        resolvedArtifactPath,
        mimeType,
        record.type === "image" ? "image" : "document",
      ),
      mimeType,
      base64Data: typeof record.data === "string" && record.data.trim() ? record.data.trim() : null,
      filePath: resolvedArtifactPath,
    });
  }
}

function extractReasoningText(item: Record<string, unknown>): string {
  const content = Array.isArray(item.content) ? item.content.filter((value) => typeof value === "string") : [];
  if (content.length) {
    return content.join("").trim();
  }

  const summary = Array.isArray(item.summary) ? item.summary.filter((value) => typeof value === "string") : [];
  return summary.join("\n").trim();
}

async function execVersion(binPath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(binPath, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(new CodexExecutionError(`Codex 실행 파일을 확인하지 못했습니다: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new CodexExecutionError(
            stderr.trim() || `Codex 버전 확인에 실패했습니다. exit=${code ?? "unknown"}`,
          ),
        );
        return;
      }

      const versionText = stdout.trim();
      if (!versionText) {
        reject(new CodexExecutionError("Codex 버전 문자열을 확인하지 못했습니다."));
        return;
      }

      resolve(versionText);
    });
  });
}

class CodexAppServerClient {
  private readonly binPath = getCodexBinPath();

  private child: ReturnType<typeof spawn> | null = null;

  private stdoutBuffer = "";

  private nextRequestId = 1;

  private readonly pendingRequests = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  private readonly loadedThreads = new Set<string>();

  private readonly activeTurns = new Map<string, ActiveTurn>();

  private runtimeInfoPromise: Promise<CodexRuntimeInfo> | null = null;

  private startupPromise: Promise<void> | null = null;

  async getRuntimeInfo(): Promise<CodexRuntimeInfo> {
    if (!this.runtimeInfoPromise) {
      this.runtimeInfoPromise = (async () => {
        const versionText = await execVersion(this.binPath);
        const parts = parseVersionParts(versionText);

        if (!parts) {
          throw new CodexExecutionError(`Codex 버전 파싱에 실패했습니다: ${versionText}`);
        }

        if (isVersionLessThan(parts, MIN_CODEX_VERSION)) {
          throw new CodexExecutionError(
            `Codex ${MIN_CODEX_VERSION.join(".")} 이상이 필요합니다. 현재 버전: ${versionText}`,
          );
        }

        return {
          version: versionText.replace(/^codex-cli\s+/i, "").trim() || versionText.trim(),
          binPath: this.binPath,
        };
      })();
    }

    return this.runtimeInfoPromise;
  }

  async ensureReady(): Promise<void> {
    await this.getRuntimeInfo();

    if (this.startupPromise) {
      return this.startupPromise;
    }

    this.startupPromise = (async () => {
      await this.startChild();
      await this.requestRaw("initialize", {
        clientInfo: {
          name: "remote-codex",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: [
            "codex/event/mcp_startup_update",
            "codex/event/mcp_startup_complete",
          ],
        },
      });
    })();

    try {
      await this.startupPromise;
    } catch (error) {
      this.startupPromise = null;
      throw error;
    }
  }

  private async startChild(): Promise<void> {
    if (this.child && !this.child.killed) {
      return;
    }

    const child = spawn(this.binPath, ["app-server"], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.stdoutBuffer = "";
    this.loadedThreads.clear();

    child.stdout.on("data", (chunk) => {
      this.handleStdoutChunk(String(chunk));
    });

    child.stderr.on("data", (chunk) => {
      const stderrText = String(chunk).trim();
      if (stderrText) {
        console.warn(stderrText);
      }
    });

    child.on("error", (error) => {
      this.failAllPending(new CodexExecutionError(`Codex app-server 실행 실패: ${error.message}`));
      this.resetChildState();
    });

    child.on("close", (code) => {
      const message =
        code === 0
          ? "Codex app-server 연결이 종료되었습니다."
          : `Codex app-server가 비정상 종료되었습니다. exit=${code ?? "unknown"}`;
      this.failAllPending(new CodexExecutionError(message));
      this.resetChildState();
    });
  }

  private resetChildState(): void {
    this.child = null;
    this.stdoutBuffer = "";
    this.startupPromise = null;
    this.loadedThreads.clear();
  }

  private failAllPending(error: Error): void {
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingRequests.delete(requestId);
    }

    for (const [threadId, activeTurn] of this.activeTurns.entries()) {
      activeTurn.settle.reject(error);
      this.activeTurns.delete(threadId);
    }
  }

  private handleStdoutChunk(chunk: string): void {
    this.stdoutBuffer += chunk;

    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      newlineIndex = this.stdoutBuffer.indexOf("\n");

      if (!line) {
        continue;
      }

      try {
        const message = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;
        if ("id" in message) {
          this.handleResponse(message as JsonRpcResponse);
        } else if ("method" in message) {
          void this.handleNotification(message as JsonRpcNotification);
        }
      } catch {
        // Ignore non-JSON lines from the runtime.
      }
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(
        new CodexExecutionError(response.error.message || "Codex JSON-RPC 요청이 실패했습니다."),
      );
      return;
    }

    pending.resolve(response.result);
  }

  private async handleNotification(notification: JsonRpcNotification): Promise<void> {
    const params = notification.params || {};

    if (notification.method === "thread/started") {
      const runtimeThreadId = typeof (params.thread as { id?: unknown } | undefined)?.id === "string"
        ? String((params.thread as { id: string }).id)
        : "";
      if (runtimeThreadId) {
        this.loadedThreads.add(runtimeThreadId);
      }
      return;
    }

    const threadId = typeof params.threadId === "string" ? params.threadId : null;
    if (!threadId) {
      return;
    }

    const activeTurn = this.activeTurns.get(threadId);
    if (!activeTurn) {
      return;
    }

    if (notification.method === "turn/started") {
      const turnId = typeof (params.turn as { id?: unknown } | undefined)?.id === "string"
        ? String((params.turn as { id: string }).id)
        : null;
      if (turnId) {
        activeTurn.turnId = turnId;
      }
      return;
    }

    if (notification.method === "item/started") {
      const item = params.item as { id?: unknown; type?: unknown; phase?: unknown } | undefined;
      if (typeof item?.id === "string" && typeof item.type === "string") {
        activeTurn.itemStates.set(item.id, {
          type: item.type,
          phase: typeof item.phase === "string" ? item.phase : null,
          text: "",
        });
      }
      return;
    }

    if (notification.method === "item/reasoning/textDelta") {
      const itemId = typeof params.itemId === "string" ? params.itemId : null;
      const delta = typeof params.delta === "string" ? params.delta : "";

      if (itemId && delta) {
        const itemState =
          activeTurn.itemStates.get(itemId) || {
            type: "reasoning",
            phase: null,
            text: "",
          };
        itemState.text += delta;
        activeTurn.itemStates.set(itemId, itemState);
        await activeTurn.onEvent?.({
          type: "reasoning-delta",
          text: delta,
        });
      }
      return;
    }

    if (notification.method === "item/agentMessage/delta") {
      const itemId = typeof params.itemId === "string" ? params.itemId : null;
      const delta = typeof params.delta === "string" ? params.delta : "";

      if (itemId && delta) {
        const itemState =
          activeTurn.itemStates.get(itemId) || {
            type: "agentMessage",
            phase: null,
            text: "",
          };
        itemState.text += delta;
        activeTurn.itemStates.set(itemId, itemState);

        await activeTurn.onEvent?.({
          type: "assistant-delta",
          text: delta,
          phase: itemState.phase,
        });
      }
      return;
    }

    if (notification.method === "item/plan/delta") {
      const itemId = typeof params.itemId === "string" ? params.itemId : null;
      const delta = typeof params.delta === "string" ? params.delta : "";

      if (itemId && delta) {
        const itemState =
          activeTurn.itemStates.get(itemId) || {
            type: "plan",
            phase: null,
            text: "",
          };
        itemState.text += delta;
        activeTurn.itemStates.set(itemId, itemState);
      }
      return;
    }

    if (notification.method === "turn/plan/updated") {
      const explanation =
        typeof params.explanation === "string" && params.explanation.trim()
          ? params.explanation.trim()
          : null;
      const plan = Array.isArray(params.plan)
        ? params.plan.map((step) => {
            const record = step as { step?: unknown; status?: unknown };
            return {
              step: typeof record.step === "string" ? record.step : "",
              status: typeof record.status === "string" ? record.status : "pending",
            };
          }).filter((step) => step.step)
        : [];

      await activeTurn.onEvent?.({
        type: "plan-updated",
        explanation,
        plan,
      });
      return;
    }

    if (notification.method === "item/completed") {
      const item = params.item as Record<string, unknown> | undefined;
      if (!item || typeof item.type !== "string" || typeof item.id !== "string") {
        return;
      }

      const existingState = activeTurn.itemStates.get(item.id) || {
        type: item.type,
        phase: typeof item.phase === "string" ? item.phase : null,
        text: "",
      };

      if (item.type === "reasoning") {
        const reasoningText = extractReasoningText(item) || existingState.text.trim();
        if (reasoningText) {
          await activeTurn.onEvent?.({
            type: "reasoning-complete",
            text: reasoningText,
          });
        }
      }

      if (item.type === "agentMessage") {
        const itemText =
          (typeof item.text === "string" ? item.text : "") ||
          existingState.text.trim();
        const phase =
          typeof item.phase === "string"
            ? item.phase
            : existingState.phase;

        if (itemText) {
          activeTurn.lastAgentText = itemText;
          await activeTurn.onEvent?.({
            type: "assistant-complete",
            text: itemText,
            phase,
          });

          if (phase === "final_answer" || !activeTurn.finalOutput) {
            activeTurn.finalOutput = itemText;
          }
        }
      }

      if (item.type === "mcpToolCall") {
        collectArtifactsFromMcpItem(activeTurnCwd(activeTurn, item), item, activeTurn.artifacts);
      }

      if (item.type === "plan") {
        const planText =
          (typeof item.text === "string" ? item.text : "") ||
          existingState.text.trim();

        if (planText) {
          activeTurn.finalOutput = planText;

          await activeTurn.onEvent?.({
            type: "plan-updated",
            explanation: planText,
            plan: [],
          });
        }
      }

      activeTurn.itemStates.delete(item.id);
      return;
    }

    if (notification.method === "turn/completed") {
      const turn = params.turn as { status?: unknown; error?: { message?: unknown; additionalDetails?: unknown } | null } | undefined;
      const status = typeof turn?.status === "string" ? turn.status : "";

      this.activeTurns.delete(threadId);
      this.loadedThreads.add(threadId);

      if (status === "failed") {
        const errorMessage =
          typeof turn?.error?.message === "string" && turn.error.message.trim()
            ? turn.error.message.trim()
            : "Codex turn 실행이 실패했습니다.";
        const additionalDetails =
          typeof turn?.error?.additionalDetails === "string" && turn.error.additionalDetails.trim()
            ? `\n\n${turn.error.additionalDetails.trim()}`
            : "";

        activeTurn.settle.reject(new CodexExecutionError(`${errorMessage}${additionalDetails}`));
        return;
      }

      const output = activeTurn.finalOutput.trim() || activeTurn.lastAgentText.trim();
      if (!output) {
        activeTurn.settle.reject(new CodexExecutionError("Codex가 비어 있는 응답을 반환했습니다."));
        return;
      }

      activeTurn.settle.resolve({
        runtimeThreadId: threadId,
        output,
        createdRuntimeThread: activeTurn.createdRuntimeThread,
        artifacts: activeTurn.artifacts,
      });
    }
  }

  private async requestRaw<T>(method: string, params?: unknown): Promise<T> {
    const child = this.child;
    const stdin = child?.stdin;
    if (!stdin?.writable) {
      throw new CodexExecutionError("Codex app-server stdin을 사용할 수 없습니다.");
    }

    const requestId = this.nextRequestId++;
    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: requestId,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new CodexExecutionError(`Codex 요청 시간이 초과되었습니다: ${method}`));
      }, DEFAULT_REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) {
          return;
        }

        const pending = this.pendingRequests.get(requestId);
        if (!pending) {
          return;
        }

        clearTimeout(pending.timer);
        this.pendingRequests.delete(requestId);
        reject(new CodexExecutionError(`Codex 요청 전송에 실패했습니다: ${error.message}`));
      });
    });
  }

  private async request<T>(method: string, params?: unknown): Promise<T> {
    await this.ensureReady();
    return this.requestRaw<T>(method, params);
  }

  async listModels(): Promise<CodexModelRecord[]> {
    await this.ensureReady();

    type ModelListResponse = {
      data?: Array<{
        id?: string;
        model?: string;
        displayName?: string;
        hidden?: boolean;
        supportedReasoningEfforts?: Array<{ reasoningEffort?: string }>;
        defaultReasoningEffort?: string;
        isDefault?: boolean;
      }>;
      nextCursor?: string | null;
    };

    const models: CodexModelRecord[] = [];
    let cursor: string | null = null;

    do {
      const response: ModelListResponse = await this.request<ModelListResponse>("model/list", {
        cursor,
        limit: 100,
        includeHidden: false,
      });

      for (const model of response.data || []) {
        if (!model.id || !model.model) {
          continue;
        }

        models.push({
          id: model.id,
          model: model.model,
          displayName: model.displayName || model.id,
          hidden: Boolean(model.hidden),
          supportedReasoningEfforts: (model.supportedReasoningEfforts || [])
            .map((entry: { reasoningEffort?: string }) => entry.reasoningEffort || "")
            .filter(Boolean),
          defaultReasoningEffort: model.defaultReasoningEffort || "",
          isDefault: Boolean(model.isDefault),
        });
      }

      cursor = typeof response.nextCursor === "string" && response.nextCursor ? response.nextCursor : null;
    } while (cursor);

    return models;
  }

  async ensureRuntimeThread(input: {
    runtimeThreadId?: string | null;
    cwd: string;
  }): Promise<{ runtimeThreadId: string; createdRuntimeThread: boolean; status: CodexThreadRuntimeStatus | null }> {
    await this.ensureReady();

    if (input.runtimeThreadId) {
      if (!this.loadedThreads.has(input.runtimeThreadId)) {
        const response = await this.request<ThreadResponse>("thread/resume", {
          threadId: input.runtimeThreadId,
          cwd: input.cwd,
          approvalPolicy: DEFAULT_CODEX_APPROVAL,
          sandbox: DEFAULT_CODEX_SANDBOX,
          persistExtendedHistory: true,
        });

        const resumedThreadId = response.thread?.id || input.runtimeThreadId;
        this.loadedThreads.add(resumedThreadId);
        return {
          runtimeThreadId: resumedThreadId,
          createdRuntimeThread: false,
          status: response.thread?.status?.type
            ? { type: response.thread.status.type }
            : null,
        };
      }

      return {
        runtimeThreadId: input.runtimeThreadId,
        createdRuntimeThread: false,
        status: null,
      };
    }

    const response = await this.request<ThreadResponse>("thread/start", {
      cwd: input.cwd,
      approvalPolicy: DEFAULT_CODEX_APPROVAL,
      sandbox: DEFAULT_CODEX_SANDBOX,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    });

    const runtimeThreadId = response.thread?.id;
    if (!runtimeThreadId) {
      throw new CodexExecutionError("Codex runtime thread를 생성하지 못했습니다.");
    }

    this.loadedThreads.add(runtimeThreadId);
    return {
      runtimeThreadId,
      createdRuntimeThread: true,
      status: response.thread?.status?.type
        ? { type: response.thread.status.type }
        : null,
    };
  }

  async runTurn(input: CodexTurnInput): Promise<CodexTurnResult> {
    await this.ensureReady();

    const runtimeThread = await this.ensureRuntimeThread({
      runtimeThreadId: input.thread.codexThreadId,
      cwd: input.project.folderPath,
    });

    return new Promise<CodexTurnResult>(async (resolve, reject) => {
      const activeTurn: ActiveTurn = {
        runtimeThreadId: runtimeThread.runtimeThreadId,
        turnId: null,
        cwd: input.project.folderPath,
        onEvent: input.onEvent,
        createdRuntimeThread: runtimeThread.createdRuntimeThread,
        artifacts: [],
        finalOutput: "",
        lastAgentText: "",
        itemStates: new Map(),
        settle: {
          resolve,
          reject,
        },
      };

      this.activeTurns.set(runtimeThread.runtimeThreadId, activeTurn);

      try {
        const response = await this.request<TurnResponse>("turn/start", {
          threadId: runtimeThread.runtimeThreadId,
          input: [
            {
              type: "text",
              text: input.userMessage.trim(),
              text_elements: [],
            },
          ],
          collaborationMode: {
            mode: input.mode,
            settings: {
              model: input.model,
              reasoning_effort: input.reasoningEffort,
              developer_instructions: input.developerInstructions,
            },
          },
        });

        const returnedTurnId = response.turn?.id;
        if (returnedTurnId) {
          activeTurn.turnId = returnedTurnId;
        }
      } catch (error) {
        this.activeTurns.delete(runtimeThread.runtimeThreadId);
        reject(new CodexExecutionError(normalizeErrorMessage(error)));
      }
    });
  }

  async shutdown(): Promise<void> {
    if (!this.child) {
      return;
    }

    const currentChild = this.child;
    this.child = null;

    await new Promise<void>((resolve) => {
      currentChild.once("close", () => resolve());
      currentChild.kill("SIGTERM");
      setTimeout(() => {
        currentChild.kill("SIGKILL");
      }, 2_000);
    }).catch(() => undefined);
  }
}

function activeTurnCwd(activeTurn: ActiveTurn, item: Record<string, unknown>): string {
  const fileText =
    typeof (item.arguments as { filename?: unknown } | undefined)?.filename === "string"
      ? String((item.arguments as { filename: string }).filename)
      : "";

  if (fileText) {
    return path.isAbsolute(fileText) ? path.dirname(fileText) : activeTurn.cwd;
  }

  return activeTurn.cwd;
}

const client = new CodexAppServerClient();

export function buildLanguageInstruction(language: string): string {
  const normalized = language.trim();
  if (!normalized) {
    return "";
  }

  return `사용자에게 보이는 모든 응답과 중간 진행 메시지는 기본적으로 ${normalized}로 작성한다. 코드, 파일 경로, 명령어, API 이름은 원문 그대로 유지한다.`;
}

export function getCodexRuntimeInfo(): Promise<CodexRuntimeInfo> {
  return client.getRuntimeInfo();
}

export function listCodexModels(): Promise<CodexModelRecord[]> {
  return client.listModels();
}

export function ensureCodexRuntimeThread(input: {
  runtimeThreadId?: string | null;
  cwd: string;
}): Promise<{ runtimeThreadId: string; createdRuntimeThread: boolean; status: CodexThreadRuntimeStatus | null }> {
  return client.ensureRuntimeThread(input);
}

export function runCodexTurn(input: CodexTurnInput): Promise<CodexTurnResult> {
  return client.runTurn(input);
}

export function shutdownCodexRuntime(): Promise<void> {
  return client.shutdown();
}
