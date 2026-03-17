import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { UserInputAnswers, UserInputQuestion } from "@remote-codex/contracts";

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
    | "plan-updated"
    | "user-input-request"
    | "user-input-request-resolved";
  text?: string;
  phase?: string | null;
  explanation?: string | null;
  plan?: CodexPlanStep[];
  requestId?: string;
  turnId?: string | null;
  itemId?: string | null;
  questions?: UserInputQuestion[];
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
  permissionMode?: "default" | "danger-full-access";
  developerInstructions: string | null;
  onEvent?: (event: CodexTurnEvent) => void | Promise<void>;
}

export interface CodexTurnResult {
  runtimeThreadId: string;
  output: string;
  createdRuntimeThread: boolean;
  artifacts: CodexArtifact[];
  exploredPaths: string[];
}

type JsonRpcId = number | string;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  id: JsonRpcId;
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

interface JsonRpcServerRequest extends JsonRpcNotification {
  id: JsonRpcId;
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
  localThreadId: number;
  runtimeThreadId: string;
  turnId: string | null;
  cwd: string;
  onEvent?: (event: CodexTurnEvent) => void | Promise<void>;
  createdRuntimeThread: boolean;
  artifacts: CodexArtifact[];
  exploredPaths: Set<string>;
  finalOutput: string;
  lastAgentText: string;
  itemStates: Map<string, { type: string; phase: string | null; text: string }>;
  settle: {
    resolve: (result: CodexTurnResult) => void;
    reject: (error: Error) => void;
  };
}

interface PendingUserInputRequest {
  id: JsonRpcId;
  requestId: string;
  runtimeThreadId: string;
  turnId: string | null;
  itemId: string | null;
  questions: UserInputQuestion[];
  buildResult: (answers: UserInputAnswers) => unknown;
}

export class CodexExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexExecutionError";
  }
}

export class CodexTurnInterruptedError extends Error {
  constructor(message = "Codex turn이 중지되었습니다.") {
    super(message);
    this.name = "CodexTurnInterruptedError";
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

function normalizeJsonRpcId(id: JsonRpcId): string {
  return String(id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeUserInputQuestions(questions: unknown): UserInputQuestion[] {
  if (!Array.isArray(questions)) {
    return [];
  }

  return questions
    .map((question) => {
      const record = question as {
        id?: unknown;
        header?: unknown;
        question?: unknown;
        isOther?: unknown;
        isSecret?: unknown;
        options?: unknown;
      };
      if (typeof record.id !== "string" || typeof record.question !== "string") {
        return null;
      }

      return {
        id: record.id,
        header: typeof record.header === "string" ? record.header : "",
        question: record.question,
        isOther: Boolean(record.isOther),
        isSecret: Boolean(record.isSecret),
        options: Array.isArray(record.options)
          ? record.options
            .map((option) => {
              const optionRecord = option as { label?: unknown; description?: unknown };
              if (typeof optionRecord.label !== "string") {
                return null;
              }

              return {
                label: optionRecord.label,
                description: typeof optionRecord.description === "string" ? optionRecord.description : "",
              };
            })
            .filter((option): option is UserInputQuestion["options"][number] => Boolean(option))
          : [],
      } satisfies UserInputQuestion;
    })
    .filter((question): question is UserInputQuestion => Boolean(question));
}

type ElicitationFieldType = "string" | "number" | "boolean" | "string_array";

function parseElicitationScalarValue(fieldType: ElicitationFieldType, rawValue: string): string | number | boolean | string[] {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new CodexExecutionError("선택 요청 입력값이 비어 있습니다.");
  }

  if (fieldType === "boolean") {
    const normalized = trimmed.toLowerCase();
    if (normalized === "true" || normalized === "yes" || normalized === "y" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "no" || normalized === "n" || normalized === "0") {
      return false;
    }
    throw new CodexExecutionError("boolean 입력값은 true 또는 false여야 합니다.");
  }

  if (fieldType === "number") {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      throw new CodexExecutionError("숫자 입력값 형식이 올바르지 않습니다.");
    }
    return parsed;
  }

  if (fieldType === "string_array") {
    const values = trimmed.split(",").map((value) => value.trim()).filter(Boolean);
    if (!values.length) {
      throw new CodexExecutionError("하나 이상의 값을 쉼표로 구분해 입력해야 합니다.");
    }
    return values;
  }

  return trimmed;
}

function buildElicitationQuestionText(input: {
  index: number;
  message: string;
  title: string;
  description: string;
  required: boolean;
  fieldType: ElicitationFieldType;
}): string {
  const baseText =
    input.description ||
    (input.index === 0 && input.message ? input.message : `${input.title} 값을 입력하세요.`);
  const suffixes: string[] = [];

  if (!input.required) {
    suffixes.push("선택 입력");
  }
  if (input.fieldType === "string_array") {
    suffixes.push("여러 값은 쉼표로 구분");
  }

  return suffixes.length ? `${baseText} (${suffixes.join(", ")})` : baseText;
}

function buildPendingElicitationRequest(input: {
  requestId: JsonRpcId;
  runtimeThreadId: string;
  turnId: string | null;
  itemId?: string | null;
  serverName: string | null;
  message: string;
  requestedSchema: unknown;
}): PendingUserInputRequest | null {
  if (!isRecord(input.requestedSchema) || !isRecord(input.requestedSchema.properties)) {
    return null;
  }

  const requiredFields = new Set(
    Array.isArray(input.requestedSchema.required)
      ? input.requestedSchema.required.filter((entry): entry is string => typeof entry === "string")
      : [],
  );
  const fieldParsers = new Map<string, ElicitationFieldType>();
  const questions: UserInputQuestion[] = [];

  Object.entries(input.requestedSchema.properties).forEach(([fieldName, propertySchema], index) => {
    if (!isRecord(propertySchema)) {
      return;
    }

    const title =
      typeof propertySchema.title === "string" && propertySchema.title.trim() ? propertySchema.title.trim() : fieldName;
    const description =
      typeof propertySchema.description === "string" && propertySchema.description.trim()
        ? propertySchema.description.trim()
        : "";
    const required = requiredFields.has(fieldName);

    let fieldType: ElicitationFieldType = "string";
    let options: UserInputQuestion["options"] = [];
    let isOther = true;

    if (Array.isArray(propertySchema.enum)) {
      options = propertySchema.enum
        .filter((option): option is string => typeof option === "string")
        .map((option) => ({
          label: option,
          description: "",
        }));
      isOther = false;
    } else if (Array.isArray(propertySchema.oneOf)) {
      options = propertySchema.oneOf
        .map((option) => {
          if (!isRecord(option) || typeof option.const !== "string") {
            return null;
          }

          return {
            label: option.const,
            description: typeof option.title === "string" ? option.title : "",
          };
        })
        .filter((option): option is UserInputQuestion["options"][number] => Boolean(option));
      isOther = false;
    } else if (propertySchema.type === "boolean") {
      fieldType = "boolean";
      options = [
        { label: "true", description: "예" },
        { label: "false", description: "아니오" },
      ];
      isOther = false;
    } else if (propertySchema.type === "number" || propertySchema.type === "integer") {
      fieldType = "number";
    } else if (propertySchema.type === "array" && isRecord(propertySchema.items)) {
      fieldType = "string_array";
      isOther = true;
    }

    fieldParsers.set(fieldName, fieldType);
    questions.push({
      id: fieldName,
      header: title,
      question: buildElicitationQuestionText({
        index,
        message: input.message,
        title,
        description,
        required,
        fieldType,
      }),
      isOther,
      isSecret: false,
      options,
    });
  });

  if (!questions.length) {
    return null;
  }

  return {
    id: input.requestId,
    requestId: normalizeJsonRpcId(input.requestId),
    runtimeThreadId: input.runtimeThreadId,
    turnId: input.turnId,
    itemId: input.itemId || null,
    questions,
    buildResult: (answers) => {
      const content = Object.fromEntries(
        questions.map((question) => {
          const rawValue = answers[question.id]?.answers?.[0] || "";
          const fieldType = fieldParsers.get(question.id) || "string";
          return [question.id, parseElicitationScalarValue(fieldType, rawValue)];
        }),
      );

      return {
        action: "accept",
        content,
        _meta: null,
      };
    },
  };
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

function looksLikeFilesystemPath(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || normalized.length > 400) {
    return false;
  }
  if (normalized.includes("\n")) {
    return false;
  }
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return false;
  }
  if (normalized.startsWith("/") || normalized.startsWith("./") || normalized.startsWith("../")) {
    return true;
  }
  return normalized.includes("/") || normalized.includes("\\");
}

function collectPathsFromUnknown(
  cwd: string,
  value: unknown,
  collector: Set<string>,
  hint = "",
): void {
  if (typeof value === "string") {
    if (!looksLikeFilesystemPath(value) && !/path|file|dir|folder/i.test(hint)) {
      return;
    }
    const resolved = path.isAbsolute(value) ? value : path.resolve(cwd, value);
    collector.add(resolved);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectPathsFromUnknown(cwd, entry, collector, hint));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    collectPathsFromUnknown(cwd, entry, collector, key);
  });
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

function collectExploredPathsFromMcpItem(cwd: string, item: Record<string, unknown>, collector: Set<string>): void {
  if (item.type !== "mcpToolCall") {
    return;
  }

  collectPathsFromUnknown(cwd, item.arguments, collector, "arguments");
  collectPathsFromUnknown(cwd, item.result, collector, "result");
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

  private readonly pendingUserInputRequests = new Map<string, PendingUserInputRequest>();

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
    this.pendingUserInputRequests.clear();
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

    this.pendingUserInputRequests.clear();
  }

  private findActiveTurnByLocalThreadId(localThreadId: number): ActiveTurn | null {
    for (const activeTurn of this.activeTurns.values()) {
      if (activeTurn.localThreadId === localThreadId) {
        return activeTurn;
      }
    }

    return null;
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
        const message = JSON.parse(line) as Record<string, unknown>;
        if (
          typeof message.method === "string" &&
          ("id" in message) &&
          (typeof message.id === "number" || typeof message.id === "string")
        ) {
          void this.handleServerRequest(message as unknown as JsonRpcServerRequest);
        } else if (
          (typeof message.id === "number" || typeof message.id === "string") &&
          ("result" in message || "error" in message)
        ) {
          this.handleResponse(message as unknown as JsonRpcResponse);
        } else if (typeof message.method === "string") {
          void this.handleNotification(message as unknown as JsonRpcNotification);
        }
      } catch {
        // Ignore non-JSON lines from the runtime.
      }
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    if (typeof response.id !== "number") {
      return;
    }

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

  private async handleServerRequest(request: JsonRpcServerRequest): Promise<void> {
    const params = request.params || {};
    const threadId = typeof params.threadId === "string" ? params.threadId : null;
    if (!threadId) {
      return;
    }

    const activeTurn = this.activeTurns.get(threadId);
    if (!activeTurn) {
      return;
    }

    if (request.method === "item/tool/requestUserInput") {
      const questions = normalizeUserInputQuestions(params.questions);
      if (!questions.length) {
        return;
      }

      const normalizedRequestId = normalizeJsonRpcId(request.id);
      const turnId = typeof params.turnId === "string" ? params.turnId : activeTurn.turnId;
      const itemId = typeof params.itemId === "string" ? params.itemId : null;
      this.pendingUserInputRequests.set(normalizedRequestId, {
        id: request.id,
        requestId: normalizedRequestId,
        runtimeThreadId: threadId,
        turnId,
        itemId,
        questions,
        buildResult: (answers) => ({
          answers,
        }),
      });

      await activeTurn.onEvent?.({
        type: "user-input-request",
        requestId: normalizedRequestId,
        turnId,
        itemId,
        questions,
      });
      return;
    }

    if (request.method === "mcpServer/elicitation/request" && params.mode === "form") {
      const pendingRequest = buildPendingElicitationRequest({
        requestId: request.id,
        runtimeThreadId: threadId,
        turnId: typeof params.turnId === "string" ? params.turnId : activeTurn.turnId,
        serverName: typeof params.serverName === "string" ? params.serverName : null,
        message: typeof params.message === "string" ? params.message : "",
        requestedSchema: params.requestedSchema,
      });
      if (!pendingRequest) {
        return;
      }

      this.pendingUserInputRequests.set(pendingRequest.requestId, pendingRequest);
      await activeTurn.onEvent?.({
        type: "user-input-request",
        requestId: pendingRequest.requestId,
        turnId: pendingRequest.turnId,
        itemId: pendingRequest.itemId,
        questions: pendingRequest.questions,
      });
    }
  }

  private async handleNotification(notification: JsonRpcNotification): Promise<void> {
    const params = notification.params || {};

    if (notification.method.startsWith("codex/event/")) {
      const runtimeThreadId =
        typeof params.conversationId === "string"
          ? params.conversationId
          : typeof params.threadId === "string"
            ? params.threadId
            : null;
      const rawMessage = isRecord(params.msg) ? params.msg : null;
      const activeTurn = runtimeThreadId ? this.activeTurns.get(runtimeThreadId) : null;

      if (activeTurn && runtimeThreadId && rawMessage?.type === "elicitation_request") {
        const pendingRequest = buildPendingElicitationRequest({
          requestId:
            typeof rawMessage.id === "number" || typeof rawMessage.id === "string"
              ? rawMessage.id
              : typeof params.id === "number" || typeof params.id === "string"
                ? params.id
                : "",
          runtimeThreadId,
          turnId: typeof rawMessage.turn_id === "string" ? rawMessage.turn_id : activeTurn.turnId,
          serverName: typeof rawMessage.server_name === "string" ? rawMessage.server_name : null,
          message:
            isRecord(rawMessage.request) && typeof rawMessage.request.message === "string"
              ? rawMessage.request.message
              : "",
          requestedSchema: isRecord(rawMessage.request) ? rawMessage.request.requested_schema : null,
        });

        if (pendingRequest && pendingRequest.requestId) {
          this.pendingUserInputRequests.set(pendingRequest.requestId, pendingRequest);
          await activeTurn.onEvent?.({
            type: "user-input-request",
            requestId: pendingRequest.requestId,
            turnId: pendingRequest.turnId,
            itemId: pendingRequest.itemId,
            questions: pendingRequest.questions,
          });
        }
      }

      if (activeTurn && runtimeThreadId && rawMessage?.type === "turn_aborted") {
        this.activeTurns.delete(runtimeThreadId);
        this.clearPendingUserInputRequestsForThread(runtimeThreadId);
        activeTurn.settle.reject(new CodexTurnInterruptedError("Codex 작업이 중지되었습니다."));
      }

      return;
    }

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

    if (notification.method === "serverRequest/resolved") {
      const requestId =
        typeof params.requestId === "number" || typeof params.requestId === "string"
          ? normalizeJsonRpcId(params.requestId)
          : null;
      if (!requestId) {
        return;
      }

      this.pendingUserInputRequests.delete(requestId);
      await activeTurn.onEvent?.({
        type: "user-input-request-resolved",
        requestId,
      });
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
        const itemCwd = activeTurnCwd(activeTurn, item);
        collectArtifactsFromMcpItem(itemCwd, item, activeTurn.artifacts);
        collectExploredPathsFromMcpItem(itemCwd, item, activeTurn.exploredPaths);
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
      this.clearPendingUserInputRequestsForThread(threadId);
      this.loadedThreads.add(threadId);

      if (status === "interrupted") {
        activeTurn.settle.reject(new CodexTurnInterruptedError("Codex 작업이 중지되었습니다."));
        return;
      }

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
        exploredPaths: Array.from(activeTurn.exploredPaths),
      });
    }
  }

  private clearPendingUserInputRequestsForThread(threadId: string): void {
    for (const [requestId, pendingRequest] of this.pendingUserInputRequests.entries()) {
      if (pendingRequest.runtimeThreadId === threadId) {
        this.pendingUserInputRequests.delete(requestId);
      }
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

      this.writeToStdin(payload, (error) => {
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

  private writeToStdin(payload: unknown, callback?: (error?: Error | null) => void): void {
    const child = this.child;
    const stdin = child?.stdin;
    if (!stdin?.writable) {
      callback?.(new CodexExecutionError("Codex app-server stdin을 사용할 수 없습니다."));
      return;
    }

    stdin.write(`${JSON.stringify(payload)}\n`, callback);
  }

  private async request<T>(method: string, params?: unknown): Promise<T> {
    await this.ensureReady();
    return this.requestRaw<T>(method, params);
  }

  async answerUserInputRequest(input: {
    requestId: string;
    answers: UserInputAnswers;
  }): Promise<void> {
    await this.ensureReady();
    const pendingRequest = this.pendingUserInputRequests.get(input.requestId);
    if (!pendingRequest) {
      throw new CodexExecutionError("선택 요청이 더 이상 활성 상태가 아닙니다.");
    }

    await new Promise<void>((resolve, reject) => {
      this.writeToStdin(
        {
          jsonrpc: "2.0",
          id: pendingRequest.id,
          result: pendingRequest.buildResult(input.answers),
        },
        (error) => {
          if (error) {
            reject(new CodexExecutionError(`선택 응답 전송에 실패했습니다: ${error.message}`));
            return;
          }

          resolve();
        },
      );
    });
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
    approvalPolicy?: string | null;
    sandbox?: string | null;
  }): Promise<{ runtimeThreadId: string; createdRuntimeThread: boolean; status: CodexThreadRuntimeStatus | null }> {
    await this.ensureReady();
    const approvalPolicy = input.approvalPolicy?.trim() || DEFAULT_CODEX_APPROVAL;
    const sandbox = input.sandbox?.trim() || DEFAULT_CODEX_SANDBOX;

    if (input.runtimeThreadId) {
      const response = await this.request<ThreadResponse>("thread/resume", {
        threadId: input.runtimeThreadId,
        cwd: input.cwd,
        approvalPolicy,
        sandbox,
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

    const response = await this.request<ThreadResponse>("thread/start", {
      cwd: input.cwd,
      approvalPolicy,
      sandbox,
      experimentalRawEvents: true,
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
      approvalPolicy: DEFAULT_CODEX_APPROVAL,
      sandbox: input.permissionMode === "danger-full-access" ? "danger-full-access" : DEFAULT_CODEX_SANDBOX,
    });

    return new Promise<CodexTurnResult>(async (resolve, reject) => {
      const activeTurn: ActiveTurn = {
        localThreadId: input.thread.id,
        runtimeThreadId: runtimeThread.runtimeThreadId,
        turnId: null,
        cwd: input.project.folderPath,
        onEvent: input.onEvent,
        createdRuntimeThread: runtimeThread.createdRuntimeThread,
        artifacts: [],
        exploredPaths: new Set(),
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

  async interruptTurn(input: { localThreadId: number }): Promise<void> {
    await this.ensureReady();

    const activeTurn = this.findActiveTurnByLocalThreadId(input.localThreadId);
    if (!activeTurn || !activeTurn.turnId) {
      throw new CodexExecutionError("현재 중지할 Codex 작업이 없습니다.");
    }

    await this.request<void>("turn/interrupt", {
      threadId: activeTurn.runtimeThreadId,
      turnId: activeTurn.turnId,
    });
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
  approvalPolicy?: string | null;
  sandbox?: string | null;
}): Promise<{ runtimeThreadId: string; createdRuntimeThread: boolean; status: CodexThreadRuntimeStatus | null }> {
  return client.ensureRuntimeThread(input);
}

export function runCodexTurn(input: CodexTurnInput): Promise<CodexTurnResult> {
  return client.runTurn(input);
}

export function answerCodexUserInputRequest(input: {
  requestId: string;
  answers: UserInputAnswers;
}): Promise<void> {
  return client.answerUserInputRequest(input);
}

export function interruptCodexTurn(input: { localThreadId: number }): Promise<void> {
  return client.interruptTurn(input);
}

export function shutdownCodexRuntime(): Promise<void> {
  return client.shutdown();
}
