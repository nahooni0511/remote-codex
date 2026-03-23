import type { Request, Response } from "express";

import {
  assertNonEmptyString,
  HttpError,
  normalizeOptionalString,
  parseNumericId,
  parseOptionalPositiveInteger,
} from "../lib/http";
import {
  createWorkspaceThreadMessage,
  deleteWorkspaceThread,
  getThreadAttachment,
  getWorkspaceThreadComposerSettings,
  getWorkspaceThreadMessages,
  interruptWorkspaceThread,
  respondWorkspaceThreadUserInput,
  undoWorkspaceThreadTurn,
  updateWorkspaceThreadComposerSettings,
  uploadWorkspaceThreadAttachment,
} from "../services/thread-service";

function getParam(value: string | string[]) {
  return Array.isArray(value) ? value[0] || "" : value;
}

export function getMessageAttachment(request: Request, response: Response) {
  const messageId = parseNumericId(getParam(request.params.messageId));
  const attachment = getThreadAttachment(messageId);

  response.setHeader(
    "content-disposition",
    `${attachment.dispositionType}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
  );
  response.type(attachment.mimeType);
  response.sendFile(attachment.attachmentPath);
}

export function getThreadMessages(request: Request, response: Response) {
  const threadId = parseNumericId(getParam(request.params.threadId));
  const limit = Math.min(parseOptionalPositiveInteger(request.query.limit, "limit") ?? 30, 100);
  const beforeMessageId = parseOptionalPositiveInteger(request.query.before, "before");
  const afterMessageId = parseOptionalPositiveInteger(request.query.after, "after");

  response.json(
    getWorkspaceThreadMessages({
      afterMessageId,
      beforeMessageId,
      limit,
      threadId,
    }),
  );
}

export async function createThreadMessage(request: Request, response: Response) {
  const threadId = parseNumericId(getParam(request.params.threadId));
  const content = normalizeOptionalString(request.body.content);
  const originChannel =
    request.body.originChannel === "global-ui" || request.headers["x-remote-codex-origin"] === "global-ui"
      ? "global-ui"
      : "local-ui";
  const senderName =
    typeof request.body.senderName === "string" && request.body.senderName.trim()
      ? request.body.senderName.trim()
      : null;

  response.status(201).json(
    await createWorkspaceThreadMessage({
      attachments: request.body.attachments,
      content,
      originChannel,
      senderName,
      threadId,
    }),
  );
}

export function getThreadComposerSettings(request: Request, response: Response) {
  const threadId = parseNumericId(getParam(request.params.threadId));
  response.json(getWorkspaceThreadComposerSettings(threadId));
}

export function patchThreadComposerSettings(request: Request, response: Response) {
  const threadId = parseNumericId(getParam(request.params.threadId));
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

  response.json(
    updateWorkspaceThreadComposerSettings({
      defaultMode,
      modelOverride,
      permissionMode,
      reasoningEffortOverride,
      threadId,
    }),
  );
}

export async function uploadThreadAttachment(request: Request, response: Response) {
  const threadId = parseNumericId(getParam(request.params.threadId));

  response.status(201).json(
    await uploadWorkspaceThreadAttachment({
      base64Data: assertNonEmptyString(request.body.base64Data, "Attachment data"),
      fileName: assertNonEmptyString(request.body.fileName, "File name"),
      mimeType: typeof request.body.mimeType === "string" ? request.body.mimeType : null,
      threadId,
    }),
  );
}

export async function respondToThreadUserInputRequest(request: Request, response: Response) {
  const threadId = parseNumericId(getParam(request.params.threadId));
  const requestId = assertNonEmptyString(getParam(request.params.requestId), "Request id");
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

  await respondWorkspaceThreadUserInput({
    answers,
    requestId,
    threadId,
  });

  response.status(200).json({ ok: true });
}

export async function interruptThread(request: Request, response: Response) {
  const threadId = parseNumericId(getParam(request.params.threadId));
  await interruptWorkspaceThread(threadId);
  response.status(200).json({ ok: true });
}

export async function undoThreadTurn(request: Request, response: Response) {
  const threadId = parseNumericId(getParam(request.params.threadId));
  const turnRunId = parseNumericId(getParam(request.params.turnRunId));
  await undoWorkspaceThreadTurn({
    threadId,
    turnRunId,
  });
  response.status(200).json({ ok: true });
}

export function deleteThread(request: Request, response: Response) {
  const threadId = parseNumericId(getParam(request.params.threadId));
  deleteWorkspaceThread(threadId);
  response.status(204).end();
}
