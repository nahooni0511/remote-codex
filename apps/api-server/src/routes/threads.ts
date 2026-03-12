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
  parseNumericId,
  parseOptionalPositiveInteger,
} from "../lib/http";
import {
  broadcastWorkspaceUpdated,
  getStoredThreadCodexConfig,
  getThreadQueueSnapshot,
  runConversationTurn,
  stopScheduledCronJob,
} from "../services/runtime";

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
      messages: result.messages,
      hasMoreBefore: result.hasMoreBefore,
    });
  } catch (error) {
    next(error);
  }
});

threadsRouter.post("/api/threads/:threadId/messages", async (request, response, next) => {
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
      source: "web",
    });

    response.status(201).json(result);
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
