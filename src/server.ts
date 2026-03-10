import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import dotenv from "dotenv";
import express, { type Request, type Response } from "express";

import { CodexExecutionError, runCodexTurn } from "./codex";
import {
  createMessage,
  createProject,
  createThread,
  deleteProject,
  deleteThread,
  getProjectById,
  getPublicSettings,
  getTelegramAuth,
  getThreadById,
  isSetupComplete,
  listMessagesByThread,
  listProjectsTree,
  saveProjectTelegramConnection,
  saveTelegramAuth,
  updateProject,
  updateThreadCodexSession,
  type ProjectRecord,
  type ThreadRecord,
} from "./db";
import {
  TelegramMtprotoError,
  completePhoneLoginCode,
  completePhoneLoginPassword,
  createForumSupergroup,
  createForumTopic,
  getAuthenticatedClient,
  getPendingLogin,
  sendTopicMessage,
  startPhoneLogin,
  shutdownMtprotoClients,
  type TelegramAuthConfig,
} from "./mtproto";

dotenv.config();

const execAsync = promisify(exec);
const app = express();

const PORT = Number(process.env.PORT || 3000);
const publicDir = path.resolve(process.cwd(), "public");

type FsNode = {
  name: string;
  path: string;
  hasChildren: boolean;
};

class HttpError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

app.use(express.json());
app.use(express.static(publicDir));

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${fieldName} is required.`);
  }

  return value.trim();
}

function parseNumericId(input: string): number {
  const numericValue = Number(input);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    throw new HttpError(400, "Invalid numeric identifier.");
  }

  return numericValue;
}

function validateFolderPath(folderPath: string): string {
  const resolved = path.resolve(folderPath);

  if (!path.isAbsolute(resolved)) {
    throw new HttpError(400, "Project folder path must be an absolute path.");
  }

  if (!fs.existsSync(resolved)) {
    throw new HttpError(400, "Project folder path does not exist.");
  }

  if (!fs.statSync(resolved).isDirectory()) {
    throw new HttpError(400, "Project folder path must point to a directory.");
  }

  return resolved;
}

function normalizeExistingDirectoryPath(input?: string): string {
  const target = input?.trim() ? path.resolve(input) : path.parse(process.cwd()).root;

  if (!fs.existsSync(target)) {
    throw new HttpError(400, "Directory path does not exist.");
  }

  if (!fs.statSync(target).isDirectory()) {
    throw new HttpError(400, "Selected path must be a directory.");
  }

  return target;
}

function directoryHasChildren(targetPath: string): boolean {
  try {
    return fs
      .readdirSync(targetPath, { withFileTypes: true })
      .some((entry) => entry.isDirectory());
  } catch {
    return false;
  }
}

function listDirectoryNodes(targetPath: string): FsNode[] {
  const resolvedPath = normalizeExistingDirectoryPath(targetPath);

  try {
    return fs
      .readdirSync(resolvedPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
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

function getAuthConfigOrThrow(): TelegramAuthConfig {
  const auth = getTelegramAuth();
  if (!auth.isAuthenticated || !auth.apiId || !auth.apiHash || !auth.phoneNumber || !auth.sessionString) {
    throw new HttpError(400, "Telegram user login is required.");
  }

  return {
    apiId: auth.apiId,
    apiHash: auth.apiHash,
    phoneNumber: auth.phoneNumber,
    sessionString: auth.sessionString,
  };
}

function getAppState() {
  const auth = getTelegramAuth();

  return {
    setupComplete: isSetupComplete(),
    auth: {
      isAuthenticated: auth.isAuthenticated,
      phoneNumber: auth.phoneNumber,
      userName: auth.userName,
    },
    settings: getPublicSettings(),
    projects: listProjectsTree(),
  };
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof HttpError || error instanceof TelegramMtprotoError || error instanceof CodexExecutionError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error.";
}

function trimTelegramText(text: string): string {
  const normalized = text.trim();
  if (normalized.length <= 3900) {
    return normalized;
  }

  return `${normalized.slice(0, 3880)}\n\n[truncated]`;
}

function buildCodexReplyText(output: string): string {
  return trimTelegramText(`Codex\n\n${output}`);
}

function buildCodexErrorNotice(errorMessage: string): string {
  return trimTelegramText(`Codex 오류\n\n${errorMessage}`);
}

async function maybeOpenBrowser(url: string): Promise<void> {
  if (process.env.AUTO_OPEN_BROWSER === "false" || process.env.CI) {
    return;
  }

  const command =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;

  try {
    await execAsync(command);
  } catch {
    // Ignore browser-open failures.
  }
}

async function runConversationTurn(input: {
  project: ProjectRecord;
  thread: ThreadRecord;
  content: string;
  senderName: string;
}): Promise<{
  thread: ThreadRecord;
}> {
  const authConfig = getAuthConfigOrThrow();
  const client = await getAuthenticatedClient(authConfig);

  if (!input.project.connection?.telegramChatId || !input.project.connection.telegramAccessHash) {
    throw new HttpError(400, "Project is not linked to a Telegram forum supergroup.");
  }

  const telegramConnection = {
    telegramChatId: input.project.connection.telegramChatId,
    telegramAccessHash: input.project.connection.telegramAccessHash,
  };

  const sentUserMessage = await sendTopicMessage(
    client,
    telegramConnection,
    input.thread.telegramTopicId,
    trimTelegramText(input.content),
  );

  createMessage({
    threadId: input.thread.id,
    role: "user",
    content: input.content,
    source: "web",
    senderName: input.senderName,
    telegramMessageId: sentUserMessage.telegramMessageId,
  });

  try {
    const codexResult = await runCodexTurn({
      project: input.project,
      thread: input.thread,
      userMessage: input.content,
      senderName: input.senderName,
      source: "web",
    });

    const updatedThread =
      !input.thread.codexSessionId || input.thread.codexSessionId !== codexResult.sessionId
        ? (updateThreadCodexSession(input.thread.id, codexResult.sessionId) ?? input.thread)
        : input.thread;

    const sentAssistantMessage = await sendTopicMessage(
      client,
      telegramConnection,
      updatedThread.telegramTopicId,
      buildCodexReplyText(codexResult.output),
    );

    createMessage({
      threadId: updatedThread.id,
      role: "assistant",
      content: codexResult.output,
      source: "codex",
      senderName: "Codex",
      telegramMessageId: sentAssistantMessage.telegramMessageId,
    });

    return {
      thread: updatedThread,
    };
  } catch (error) {
    const errorMessage = normalizeErrorMessage(error);

    createMessage({
      threadId: input.thread.id,
      role: "system",
      content: `Codex 실행 실패: ${errorMessage}`,
      source: "system",
      senderName: "System",
      errorText: errorMessage,
    });

    await sendTopicMessage(
      client,
      telegramConnection,
      input.thread.telegramTopicId,
      buildCodexErrorNotice(errorMessage),
    ).catch(() => undefined);

    throw error;
  }
}

app.get("/api/bootstrap", (_request, response) => {
  response.json(getAppState());
});

app.get("/api/fs/list", (request, response, next) => {
  try {
    const targetPath = typeof request.query.path === "string" ? request.query.path : undefined;
    response.json({
      path: normalizeExistingDirectoryPath(targetPath),
      entries: listDirectoryNodes(targetPath || "/"),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/send-code", async (request, response, next) => {
  try {
    const apiId = Number(assertNonEmptyString(request.body.apiId, "Telegram API ID"));
    const apiHash = assertNonEmptyString(request.body.apiHash, "Telegram API hash");
    const phoneNumber = assertNonEmptyString(request.body.phoneNumber, "Telegram phone number");

    if (!Number.isInteger(apiId) || apiId <= 0) {
      throw new HttpError(400, "Telegram API ID must be a positive integer.");
    }

    const pending = await startPhoneLogin({
      apiId,
      apiHash,
      phoneNumber,
    });

    response.status(201).json({
      pendingAuthId: pending.id,
      phoneNumber,
      isCodeViaApp: pending.isCodeViaApp,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/verify-code", async (request, response, next) => {
  try {
    const pendingAuthId = assertNonEmptyString(request.body.pendingAuthId, "Pending auth ID");
    const phoneCode = assertNonEmptyString(request.body.phoneCode, "Telegram login code");
    const pending = getPendingLogin(pendingAuthId);

    if (!pending) {
      throw new HttpError(400, "Pending login session not found.");
    }

    const result = await completePhoneLoginCode({
      pendingId: pendingAuthId,
      phoneCode,
    });

    if (result.status === "password_required") {
      response.json({
        requiresPassword: true,
        pendingAuthId,
        passwordHint: result.passwordHint,
      });
      return;
    }

    saveTelegramAuth({
      apiId: pending.apiId,
      apiHash: pending.apiHash,
      phoneNumber: pending.phoneNumber,
      sessionString: result.sessionString,
      userId: result.user.userId,
      userName: result.user.userName,
    });

    response.json(getAppState());
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/verify-password", async (request, response, next) => {
  try {
    const pendingAuthId = assertNonEmptyString(request.body.pendingAuthId, "Pending auth ID");
    const password = assertNonEmptyString(request.body.password, "Telegram 2FA password");
    const pending = getPendingLogin(pendingAuthId);

    if (!pending) {
      throw new HttpError(400, "Pending login session not found.");
    }

    const result = await completePhoneLoginPassword({
      pendingId: pendingAuthId,
      password,
    });

    saveTelegramAuth({
      apiId: pending.apiId,
      apiHash: pending.apiHash,
      phoneNumber: pending.phoneNumber,
      sessionString: result.sessionString,
      userId: result.user.userId,
      userName: result.user.userName,
    });

    response.json(getAppState());
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects", async (request, response, next) => {
  try {
    const groupName = assertNonEmptyString(request.body.groupName, "Group name");
    const folderPath = validateFolderPath(assertNonEmptyString(request.body.folderPath, "Project folder path"));
    const authConfig = getAuthConfigOrThrow();
    const client = await getAuthenticatedClient(authConfig);

    const createdGroup = await createForumSupergroup(client, {
      title: groupName,
      about: `Codex project: ${groupName}`,
    });

    const project = createProject({
      name: groupName,
      folderPath,
    });

    saveProjectTelegramConnection(project.id, {
      telegramChatId: createdGroup.telegramChannelId,
      telegramAccessHash: createdGroup.telegramAccessHash,
      telegramChatTitle: createdGroup.telegramTitle,
      forumEnabled: createdGroup.forumEnabled,
    });

    response.status(201).json(getProjectById(project.id));
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId", (request, response, next) => {
  try {
    const projectId = parseNumericId(request.params.projectId);
    const project = getProjectById(projectId);

    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    response.json(project);
  } catch (error) {
    next(error);
  }
});

app.put("/api/projects/:projectId", (request, response, next) => {
  try {
    const projectId = parseNumericId(request.params.projectId);
    const project = getProjectById(projectId);

    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    const folderPath = validateFolderPath(assertNonEmptyString(request.body.folderPath, "Project folder path"));

    response.json(
      updateProject(projectId, {
        name: project.name,
        folderPath,
      }),
    );
  } catch (error) {
    next(error);
  }
});

app.delete("/api/projects/:projectId", (request, response, next) => {
  try {
    const projectId = parseNumericId(request.params.projectId);
    if (!deleteProject(projectId)) {
      throw new HttpError(404, "Project not found.");
    }

    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:projectId/threads", async (request, response, next) => {
  try {
    const projectId = parseNumericId(request.params.projectId);
    const title = assertNonEmptyString(request.body.title, "Thread title");
    const project = getProjectById(projectId);

    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    if (!project.connection?.telegramChatId || !project.connection.telegramAccessHash) {
      throw new HttpError(400, "Project Telegram connection is missing.");
    }

    const authConfig = getAuthConfigOrThrow();
    const client = await getAuthenticatedClient(authConfig);
    const topic = await createForumTopic(
      client,
      {
        telegramChatId: project.connection.telegramChatId,
        telegramAccessHash: project.connection.telegramAccessHash,
      },
      title,
    );

    response.status(201).json(
      createThread({
        projectId,
        title: topic.title,
        telegramTopicId: topic.telegramTopicId,
        telegramTopicName: topic.title,
        origin: "app",
      }),
    );
  } catch (error) {
    next(error);
  }
});

app.get("/api/threads/:threadId/messages", (request, response, next) => {
  try {
    const threadId = parseNumericId(request.params.threadId);
    const thread = getThreadById(threadId);

    if (!thread) {
      throw new HttpError(404, "Thread not found.");
    }

    response.json({
      thread,
      messages: listMessagesByThread(threadId),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/threads/:threadId/messages", async (request, response, next) => {
  try {
    const threadId = parseNumericId(request.params.threadId);
    const thread = getThreadById(threadId);
    const content = assertNonEmptyString(request.body.content, "Message content");

    if (!thread) {
      throw new HttpError(404, "Thread not found.");
    }

    const project = getProjectById(thread.projectId);
    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    const auth = getTelegramAuth();
    const senderName = auth.userName || "Telegram User";
    const result = await runConversationTurn({
      project,
      thread,
      content,
      senderName,
    });

    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/threads/:threadId", (request, response, next) => {
  try {
    const threadId = parseNumericId(request.params.threadId);
    if (!deleteThread(threadId)) {
      throw new HttpError(404, "Thread not found.");
    }

    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("*", (_request, response) => {
  response.sendFile(path.join(publicDir, "index.html"));
});

app.use((error: unknown, _request: Request, response: Response, _next: express.NextFunction) => {
  if (error instanceof HttpError) {
    response.status(error.statusCode).json({ error: error.message });
    return;
  }

  if (error instanceof TelegramMtprotoError || error instanceof CodexExecutionError) {
    response.status(400).json({ error: error.message });
    return;
  }

  console.error(error);
  response.status(500).json({ error: "Internal server error." });
});

const httpServer = app.listen(PORT, async () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Server started at ${url}`);
  await maybeOpenBrowser(url);
});

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}, shutting down...`);

  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  }).catch(() => undefined);

  await shutdownMtprotoClients().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
