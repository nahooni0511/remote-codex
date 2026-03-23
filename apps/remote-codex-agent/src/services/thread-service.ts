import fs from "node:fs";
import path from "node:path";

import {
  deleteThread,
  getMessageAttachmentById,
  getProjectById,
  getTelegramAuth,
  getThreadById,
  listCronJobsByThread,
  listMessagesByThread,
  updateThreadCodexOverrides,
} from "../db";
import { HttpError } from "../lib/http";
import {
  broadcastWorkspaceUpdated,
  getProjectGitState,
  getStoredThreadCodexConfig,
  getThreadLiveSnapshot,
  getThreadQueueSnapshot,
  interruptThreadTurn,
  resolveComposerAttachments,
  runConversationTurn,
  saveThreadAttachmentUpload,
  stopScheduledCronJob,
  submitThreadUserInputRequest,
  undoLatestCodexTurn,
} from "./runtime";

export function getThreadAttachment(messageId: number) {
  const attachment = getMessageAttachmentById(messageId);
  if (!attachment) {
    throw new HttpError(404, "Attachment not found.");
  }

  const attachmentPath = path.resolve(attachment.path);
  if (!fs.existsSync(attachmentPath)) {
    throw new HttpError(404, "Attachment file not found.");
  }

  return {
    attachmentPath,
    dispositionType: attachment.kind === "image" ? "inline" : "attachment",
    filename: attachment.filename || path.basename(attachmentPath),
    mimeType: attachment.mimeType || "application/octet-stream",
  };
}

export function getWorkspaceThread(threadId: number) {
  const thread = getThreadById(threadId);
  if (!thread) {
    throw new HttpError(404, "Thread not found.");
  }

  return thread;
}

export function getWorkspaceThreadMessages(input: {
  afterMessageId: number | null;
  beforeMessageId: number | null;
  limit: number;
  threadId: number;
}) {
  const thread = getWorkspaceThread(input.threadId);

  if (input.beforeMessageId && input.afterMessageId) {
    throw new HttpError(400, "before and after cannot be combined.");
  }

  const result = listMessagesByThread(input.threadId, {
    limit: input.afterMessageId ? undefined : input.limit,
    beforeMessageId: input.beforeMessageId,
    afterMessageId: input.afterMessageId,
  });

  return {
    thread: {
      ...thread,
      ...getStoredThreadCodexConfig(thread),
      ...getThreadQueueSnapshot(thread.id),
    },
    events: result.messages,
    messages: result.messages,
    hasMoreBefore: result.hasMoreBefore,
    liveStream: getThreadLiveSnapshot(thread.id),
  };
}

export async function createWorkspaceThreadMessage(input: {
  attachments: unknown;
  content: string;
  originChannel: "global-ui" | "local-ui";
  senderName?: string | null;
  threadId: number;
}) {
  const thread = getWorkspaceThread(input.threadId);
  const project = getProjectById(thread.projectId);
  if (!project) {
    throw new HttpError(404, "Project not found.");
  }

  const attachments = resolveComposerAttachments(project, input.attachments);
  if (!input.content && !attachments.length) {
    throw new HttpError(400, "Message content is required.");
  }

  const auth = getTelegramAuth();
  const senderName =
    input.senderName ||
    auth.userName ||
    (input.originChannel === "global-ui" ? "Global User" : "Local User");

  return runConversationTurn({
    project,
    thread,
    content: input.content,
    senderName,
    source: "web",
    originChannel: input.originChannel,
    attachments,
  });
}

export function getWorkspaceThreadComposerSettings(threadId: number) {
  const thread = getWorkspaceThread(threadId);
  return {
    thread: {
      ...thread,
      ...getStoredThreadCodexConfig(thread),
      ...getThreadQueueSnapshot(thread.id),
    },
  };
}

export function updateWorkspaceThreadComposerSettings(input: {
  defaultMode?: "default" | "plan";
  modelOverride?: string | null;
  permissionMode?: "danger-full-access" | "default";
  reasoningEffortOverride?: string | null;
  threadId: number;
}) {
  getWorkspaceThread(input.threadId);

  const updatedThread = updateThreadCodexOverrides(input.threadId, {
    codexModelOverride: input.modelOverride,
    codexReasoningEffortOverride: input.reasoningEffortOverride,
    defaultMode: input.defaultMode,
    codexPermissionMode: input.permissionMode,
  });

  if (!updatedThread) {
    throw new HttpError(404, "Thread not found.");
  }

  broadcastWorkspaceUpdated({
    projectId: updatedThread.projectId,
    threadId: updatedThread.id,
  });

  return {
    thread: {
      ...updatedThread,
      ...getStoredThreadCodexConfig(updatedThread),
      ...getThreadQueueSnapshot(updatedThread.id),
    },
  };
}

export async function uploadWorkspaceThreadAttachment(input: {
  base64Data: string;
  fileName: string;
  mimeType: string | null;
  threadId: number;
}) {
  const thread = getWorkspaceThread(input.threadId);
  const project = getProjectById(thread.projectId);
  if (!project) {
    throw new HttpError(404, "Project not found.");
  }

  const attachment = await saveThreadAttachmentUpload({
    project,
    thread,
    fileName: input.fileName,
    mimeType: input.mimeType,
    base64Data: input.base64Data,
  });

  return { attachment };
}

export async function respondWorkspaceThreadUserInput(input: {
  answers: Record<string, { answers: string[] }>;
  requestId: string;
  threadId: number;
}) {
  const thread = getWorkspaceThread(input.threadId);
  await submitThreadUserInputRequest({
    thread,
    requestId: input.requestId,
    answers: input.answers,
  });
}

export async function interruptWorkspaceThread(threadId: number) {
  const thread = getWorkspaceThread(threadId);
  await interruptThreadTurn({ thread });
}

export async function undoWorkspaceThreadTurn(input: { threadId: number; turnRunId: number }) {
  const thread = getWorkspaceThread(input.threadId);
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
    turnRunId: input.turnRunId,
  });
}

export function deleteWorkspaceThread(threadId: number) {
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
}
