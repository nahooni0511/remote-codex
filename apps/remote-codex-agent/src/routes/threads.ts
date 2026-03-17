import fs from "node:fs";
import path from "node:path";

import { Router } from "express";

import {
  deleteThread,
  getMessageAttachmentById,
  getProjectById,
  getTelegramAuth,
  getThreadById,
  listCronJobsByThread,
  listMessagesByThread,
} from "../db";
import {
  assertNonEmptyString,
  HttpError,
  normalizeOptionalString,
  parseNumericId,
  parseOptionalPositiveInteger,
} from "../lib/http";
import {
  broadcastWorkspaceUpdated,
  getStoredThreadCodexConfig,
  getThreadQueueSnapshot,
  resolveComposerAttachments,
  runConversationTurn,
  saveThreadAttachmentUpload,
  submitThreadUserInputRequest,
  stopScheduledCronJob,
  undoLatestCodexTurn,
  getProjectGitState,
  getThreadLiveSnapshot,
  interruptThreadTurn,
} from "../services/runtime";
import { updateThreadCodexOverrides } from "../db";

export const threadsRouter = Router();

threadsRouter.get("/api/messages/:messageId/attachment", (request, response, next) => {
  try {
    const messageId = parseNumericId(request.params.messageId);
    const attachment = getMessageAttachmentById(messageId);

    if (!attachment) {
      throw new HttpError(404, "Attachment not found.");
    }

    const attachmentPath = path.resolve(attachment.path);
    if (!fs.existsSync(attachmentPath)) {
      throw new HttpError(404, "Attachment file not found.");
    }

    const dispositionType = attachment.kind === "image" ? "inline" : "attachment";
    const filename = attachment.filename || path.basename(attachmentPath);

    response.setHeader(
      "content-disposition",
      `${dispositionType}; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    response.type(attachment.mimeType || "application/octet-stream");
    response.sendFile(attachmentPath);
  } catch (error) {
    next(error);
  }
});

threadsRouter.get("/api/threads/:threadId/messages", (request, response, next) => {
  try {
    const threadId = parseNumericId(request.params.threadId);
    const thread = getThreadById(threadId);
    const limit = Math.min(parseOptionalPositiveInteger(request.query.limit, "limit") ?? 30, 100);
    const beforeMessageId = parseOptionalPositiveInteger(request.query.before, "before");
    const afterMessageId = parseOptionalPositiveInteger(request.query.after, "after");

    if (!thread) {
      throw new HttpError(404, "Thread not found.");
    }

    if (beforeMessageId && afterMessageId) {
      throw new HttpError(400, "before and after cannot be combined.");
    }

    const result = listMessagesByThread(threadId, {
      limit: afterMessageId ? undefined : limit,
      beforeMessageId,
      afterMessageId,
    });

    response.json({
      thread: {
        ...thread,
        ...getStoredThreadCodexConfig(thread),
        ...getThreadQueueSnapshot(thread.id),
      },
      events: result.messages,
      messages: result.messages,
      hasMoreBefore: result.hasMoreBefore,
      liveStream: getThreadLiveSnapshot(thread.id),
    });
  } catch (error) {
    next(error);
  }
});

threadsRouter.post("/api/threads/:threadId/messages", async (request, response, next) => {
  try {
    const threadId = parseNumericId(request.params.threadId);
    const thread = getThreadById(threadId);
    const content = normalizeOptionalString(request.body.content);
    const originChannel =
      request.body.originChannel === "global-ui" || request.headers["x-remote-codex-origin"] === "global-ui"
        ? "global-ui"
        : "local-ui";

    if (!thread) {
      throw new HttpError(404, "Thread not found.");
    }

    const project = getProjectById(thread.projectId);
    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    const attachments = resolveComposerAttachments(project, request.body.attachments);
    if (!content && !attachments.length) {
      throw new HttpError(400, "Message content is required.");
    }

    const auth = getTelegramAuth();
    const senderName =
      (typeof request.body.senderName === "string" && request.body.senderName.trim()) ||
      auth.userName ||
      (originChannel === "global-ui" ? "Global User" : "Local User");
    const result = await runConversationTurn({
      project,
      thread,
      content,
      senderName,
      source: "web",
      originChannel,
      attachments,
    });

    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

threadsRouter.get("/api/threads/:threadId/composer-settings", (request, response, next) => {
  try {
    const threadId = parseNumericId(request.params.threadId);
    const thread = getThreadById(threadId);

    if (!thread) {
      throw new HttpError(404, "Thread not found.");
    }

    response.json({
      thread: {
        ...thread,
        ...getStoredThreadCodexConfig(thread),
        ...getThreadQueueSnapshot(thread.id),
      },
    });
  } catch (error) {
    next(error);
  }
});

threadsRouter.patch("/api/threads/:threadId/composer-settings", (request, response, next) => {
  try {
    const threadId = parseNumericId(request.params.threadId);
    const thread = getThreadById(threadId);

    if (!thread) {
      throw new HttpError(404, "Thread not found.");
    }

    const defaultMode =
      request.body.defaultMode === undefined
        ? undefined
        : request.body.defaultMode === "plan"
          ? "plan"
          : "default";
    const permissionMode =
      request.body.permissionMode === undefined
        ? undefined
        : request.body.permissionMode === "danger-full-access"
          ? "danger-full-access"
          : "default";
    const modelOverride =
      request.body.modelOverride === undefined
        ? undefined
        : request.body.modelOverride === null
          ? null
          : normalizeOptionalString(request.body.modelOverride) || null;
    const reasoningEffortOverride =
      request.body.reasoningEffortOverride === undefined
        ? undefined
        : request.body.reasoningEffortOverride === null
          ? null
          : normalizeOptionalString(request.body.reasoningEffortOverride) || null;

    const updatedThread = updateThreadCodexOverrides(thread.id, {
      codexModelOverride: modelOverride,
      codexReasoningEffortOverride: reasoningEffortOverride,
      defaultMode,
      codexPermissionMode: permissionMode,
    });

    if (!updatedThread) {
      throw new HttpError(404, "Thread not found.");
    }

    broadcastWorkspaceUpdated({
      projectId: updatedThread.projectId,
      threadId: updatedThread.id,
    });

    response.json({
      thread: {
        ...updatedThread,
        ...getStoredThreadCodexConfig(updatedThread),
        ...getThreadQueueSnapshot(updatedThread.id),
      },
    });
  } catch (error) {
    next(error);
  }
});

threadsRouter.post("/api/threads/:threadId/attachments/upload", async (request, response, next) => {
  try {
    const threadId = parseNumericId(request.params.threadId);
    const thread = getThreadById(threadId);

    if (!thread) {
      throw new HttpError(404, "Thread not found.");
    }

    const project = getProjectById(thread.projectId);
    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    const attachment = await saveThreadAttachmentUpload({
      project,
      thread,
      fileName: assertNonEmptyString(request.body.fileName, "File name"),
      mimeType: typeof request.body.mimeType === "string" ? request.body.mimeType : null,
      base64Data: assertNonEmptyString(request.body.base64Data, "Attachment data"),
    });

    response.status(201).json({ attachment });
  } catch (error) {
    next(error);
  }
});

threadsRouter.post("/api/threads/:threadId/user-input-requests/:requestId/respond", async (request, response, next) => {
  try {
    const threadId = parseNumericId(request.params.threadId);
    const requestId = assertNonEmptyString(request.params.requestId, "Request id");
    const thread = getThreadById(threadId);

    if (!thread) {
      throw new HttpError(404, "Thread not found.");
    }

    const rawAnswers =
      request.body && typeof request.body.answers === "object" && request.body.answers
        ? (request.body.answers as Record<string, { answers?: unknown }>)
        : null;

    if (!rawAnswers) {
      throw new HttpError(400, "answers is required.");
    }

    const answers = Object.fromEntries(
      Object.entries(rawAnswers).map(([questionId, answerRecord]) => [
        questionId,
        {
          answers: Array.isArray(answerRecord?.answers)
            ? answerRecord.answers.filter((value): value is string => typeof value === "string")
            : [],
        },
      ]),
    );

    await submitThreadUserInputRequest({
      thread,
      requestId,
      answers,
    });

    response.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

threadsRouter.post("/api/threads/:threadId/interrupt", async (request, response, next) => {
  try {
    const threadId = parseNumericId(request.params.threadId);
    const thread = getThreadById(threadId);

    if (!thread) {
      throw new HttpError(404, "Thread not found.");
    }

    await interruptThreadTurn({
      thread,
    });

    response.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

threadsRouter.post("/api/threads/:threadId/turns/:turnRunId/undo", async (request, response, next) => {
  try {
    const threadId = parseNumericId(request.params.threadId);
    const turnRunId = parseNumericId(request.params.turnRunId);
    const thread = getThreadById(threadId);

    if (!thread) {
      throw new HttpError(404, "Thread not found.");
    }

    const project = getProjectById(thread.projectId);
    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    const git = await getProjectGitState(project);
    if (!git.isRepo) {
      throw new HttpError(409, "Git project에서만 실행취소를 지원합니다.");
    }

    await undoLatestCodexTurn({
      thread,
      project,
      turnRunId,
    });

    response.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

threadsRouter.delete("/api/threads/:threadId", (request, response, next) => {
  try {
    const threadId = parseNumericId(request.params.threadId);
    const thread = getThreadById(threadId);

    for (const job of listCronJobsByThread(threadId)) {
      stopScheduledCronJob(job.id);
    }

    if (!deleteThread(threadId)) {
      throw new HttpError(404, "Thread not found.");
    }

    broadcastWorkspaceUpdated({
      projectId: thread?.projectId ?? null,
      threadId,
    });

    response.status(204).end();
  } catch (error) {
    next(error);
  }
});
