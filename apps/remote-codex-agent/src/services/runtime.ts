import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import type {
  AppBootstrap,
  ComposerAttachmentRecord,
} from "@remote-codex/contracts";

import {
  sendTopicDocumentAsBot,
  sendTopicMessageAsBot,
  sendTopicPhotoAsBot,
} from "../bot";
import {
  CodexTurnInterruptedError,
  getCodexRuntimeInfo,
  runCodexTurn,
  shutdownCodexRuntime,
  type CodexArtifact,
  type CodexPlanStep,
  type CodexTurnEvent,
} from "../codex";
import {
  clearGlobalPairing,
  clearSetting,
  completeCodexTurnRun,
  clearTelegramAuth,
  createCodexTurnRun,
  createMessageEvent,
  createMessage,
  getDeviceProfile,
  getGlobalPairing,
  getPublicSettings,
  getTelegramAuth,
  getThreadById,
  listProjectsTree,
  nowIso,
  resetCodexSettings,
  updateThreadCodexThreadId,
  type ProjectRecord,
  type ThreadRecord,
} from "../db";
import {
  getAuthenticatedClient,
  sendTopicMessage,
} from "../mtproto";
import { HttpError } from "../lib/http";
import { artifactsDir, resolveFromRepo } from "../lib/paths";
import {
  configureRelayBridgeService,
  refreshRelayBridgeConnection as refreshRelayBridgeSocket,
  startRelayBridgeService,
  stopRelayBridgeService,
} from "./relay-bridge";
import {
  captureProjectGitSnapshot,
  ensureProjectPath,
  getProjectGitState,
  isPathInsideRoot,
  listDirectoryNodes,
  listProjectFileTree,
  normalizeExistingDirectoryPath,
  parseGitNumstat,
  parseGitStatusEntries,
  saveThreadAttachmentUpload,
  switchProjectGitBranch,
} from "./runtime/git-fs";
import {
  attachRealtimeServer,
  broadcastThreadMessagesUpdated,
  broadcastThreadState,
  broadcastThreadStreamEvent,
  broadcastWorkspaceUpdated,
  enqueueThreadTask,
  getStoredThreadCodexConfig,
  getThreadLiveSnapshot,
  getThreadQueueSnapshot,
} from "./runtime/realtime";
import {
  applyCronActionsFromAssistantOutput,
  buildCronActionDeveloperInstruction,
  createCronJobForThread,
  loadCronSchedules,
  stopAllCronSchedules,
  stopScheduledCronJob,
  syncCronJobSchedule,
} from "./runtime/cron";
import {
  applyAppUpdate,
  buildCodexUserMessage,
  buildTurnSummary,
  clearPendingUserInputRequestsForThread,
  getAppUpdateStatus,
  interruptThreadTurn,
  registerPendingUserInputRequest,
  resolveComposerAttachments,
  resolvePendingUserInputRequest,
  submitThreadUserInputRequest,
  undoLatestCodexTurn,
} from "./runtime/codex-runtime";
import {
  ensureBotCallbackPolling,
  ensureTelegramInboundHandler,
  rememberIgnoredTelegramEcho,
  resetTelegramRuntimeServices,
  startBotTypingLoop,
  stopTelegramRuntimeServices,
  syncScopedBotCommandsForAllProjects,
  syncScopedBotCommandsForProject,
} from "./runtime/telegram";
import {
  combineDeveloperInstructions,
  getAuthConfigOrThrow,
  getBotConfigOrThrow,
  hasTelegramRuntime,
  loadVisibleCodexModels,
  normalizeErrorMessage,
  resolveEffectiveThreadCodexConfig,
  toBotApiChatId,
  trimTelegramText,
} from "./runtime/shared";

export {
  getProjectGitState,
  listDirectoryNodes,
  listProjectFileTree,
  normalizeExistingDirectoryPath,
  saveThreadAttachmentUpload,
  switchProjectGitBranch,
} from "./runtime/git-fs";
export {
  attachRealtimeServer,
  broadcastThreadMessagesUpdated,
  broadcastWorkspaceUpdated,
  getStoredThreadCodexConfig,
  getThreadLiveSnapshot,
  getThreadQueueSnapshot,
} from "./runtime/realtime";
export { createCronJobForThread, stopScheduledCronJob, syncCronJobSchedule } from "./runtime/cron";
export {
  applyAppUpdate,
  getAppUpdateStatus,
  interruptThreadTurn,
  resolveComposerAttachments,
  submitThreadUserInputRequest,
  undoLatestCodexTurn,
} from "./runtime/codex-runtime";
export {
  combineDeveloperInstructions,
  getAuthConfigOrThrow,
  getBotConfigOrThrow,
  hasTelegramRuntime,
  normalizeErrorMessage,
  resolveEffectiveThreadCodexConfig,
  toBotApiChatId,
  trimTelegramText,
} from "./runtime/shared";
export {
  clearTelegramRuntimeState,
  ensureBotCallbackPolling,
  ensureTelegramInboundHandler,
  syncScopedBotCommandsForAllProjects,
  syncScopedBotCommandsForProject,
} from "./runtime/telegram";

dotenv.config({ path: resolveFromRepo(".env") });
export const PORT = Number(process.env.PORT || 3000);
const externalServicesDisabled = process.env.REMOTE_CODEX_DISABLE_EXTERNAL_SERVICES === "true";

type ConfigSelectOption = {
  value: string;
  label: string;
};

const CONFIG_LANGUAGE_OPTIONS: ConfigSelectOption[] = [
  { value: "", label: "비워두기" },
  { value: "Korean", label: "한국어" },
  { value: "English", label: "English" },
  { value: "Japanese", label: "日本語" },
  { value: "Chinese", label: "中文" },
  { value: "Spanish", label: "Español" },
  { value: "French", label: "Français" },
  { value: "German", label: "Deutsch" },
];

let codexRuntimeVersion: string | null = null;

function buildPlanModeDeveloperInstruction(): string {
  return [
    "plan mode 규칙:",
    "- 작업을 바로 실행하지 말고, 먼저 구현 방향이나 필요한 결정을 사용자에게 묻는다.",
    "- 선택지가 2개 이상이면 가능한 경우 request_user_input 또는 elicitation 형태의 선택 요청을 우선 사용한다.",
    "- 구조 변경, 권한 변경, 브랜치 변경, 대규모 수정처럼 사용자의 확인이 필요한 항목은 반드시 먼저 확인을 받고 진행한다.",
    "- 사용자가 답하기 전에는 파일 수정, 명령 실행, 패치 적용을 시작하지 않는다.",
  ].join("\n");
}

async function getConfigSelectOptions(): Promise<{
  responseLanguages: ConfigSelectOption[];
  defaultModels: ConfigSelectOption[];
  codexModels: AppBootstrap["configOptions"]["codexModels"];
}> {
  if (externalServicesDisabled) {
    return {
      responseLanguages: CONFIG_LANGUAGE_OPTIONS,
      defaultModels: [],
      codexModels: [],
    };
  }

  try {
    const models = await loadVisibleCodexModels();

    return {
      responseLanguages: CONFIG_LANGUAGE_OPTIONS,
      defaultModels: models.map((model) => ({
        value: model.id,
        label:
          model.displayName === model.id
            ? `${model.id}${model.isDefault ? " [default]" : ""}`
            : `${model.displayName} (${model.id})${model.isDefault ? " [default]" : ""}`,
      })),
      codexModels: models.map((model) => ({
        value: model.id,
        label: model.displayName === model.id ? model.id : `${model.displayName} (${model.id})`,
        defaultReasoningEffort: model.defaultReasoningEffort,
        supportedReasoningEfforts: model.supportedReasoningEfforts,
      })),
    };
  } catch (error) {
    console.error("Config select options failed to load:", error);
    return {
      responseLanguages: CONFIG_LANGUAGE_OPTIONS,
      defaultModels: [],
      codexModels: [],
    };
  }
}

export async function getAppState(): Promise<AppBootstrap> {
  const auth = getTelegramAuth();
  const device = getDeviceProfile();
  const globalPairing = getGlobalPairing();
  const runtime = {
    appVersion: getAppVersion(),
    version: codexRuntimeVersion,
  };
  const projects = listProjectsTree().map((project) => ({
    ...project,
    threads: project.threads.map((thread) => {
      const queueState = getThreadQueueSnapshot(thread.id);
      const storedConfig = getStoredThreadCodexConfig(thread);

      return {
        ...thread,
        effectiveModel: storedConfig.effectiveModel,
        effectiveReasoningEffort: storedConfig.effectiveReasoningEffort,
        composerSettings: storedConfig.composerSettings,
        running: queueState.running,
        queueDepth: queueState.queueDepth,
        currentMode: queueState.mode,
      };
    }),
  }));

  return {
    device,
    capabilities: {
      codexReady: Boolean(codexRuntimeVersion),
      telegramAvailable: hasTelegramRuntime(),
      globalRelayAvailable: Boolean(globalPairing?.enabled),
      autoStartSupported: process.platform === "win32" || process.platform === "darwin",
    },
    integrations: {
      telegram: {
        enabled: hasTelegramRuntime(),
        connected: hasTelegramRuntime(),
        phoneNumber: auth.phoneNumber,
        userName: auth.userName,
        botUserName: auth.botUserName,
      },
      global: {
        enabled: Boolean(globalPairing?.enabled),
        paired: Boolean(globalPairing?.deviceId),
        connected: Boolean(globalPairing?.connected),
        deviceId: globalPairing?.deviceId || null,
        ownerLabel: globalPairing?.ownerLabel || null,
        serverUrl: globalPairing?.serverUrl || null,
        lastSyncAt: globalPairing?.lastSyncAt || null,
      },
    },
    setupComplete: true,
    auth: {
      isAuthenticated: auth.isAuthenticated,
      phoneNumber: auth.phoneNumber,
      userName: auth.userName,
    },
    runtime,
    settings: getPublicSettings(),
    configOptions: await getConfigSelectOptions(),
    workspace: {
      projects,
    },
    projects,
  };
}

function buildCodexReplyText(output: string): string {
  return trimTelegramText(`Codex\n\n${output}`);
}

function buildCodexErrorNotice(errorMessage: string): string {
  return trimTelegramText(`Codex 오류\n\n${errorMessage}`);
}

function buildCodexProgressText(text: string): string {
  return trimTelegramText(`Codex 진행\n\n${text}`);
}

function buildCodexArtifactRecordText(artifact: CodexArtifact): string {
  const prefix = artifact.kind === "image" ? "Codex 이미지 첨부" : "Codex 첨부 파일";
  return artifact.filename ? `${prefix}: ${artifact.filename}` : prefix;
}

function sanitizeArtifactFilename(filename: string): string {
  const baseName = path.basename(filename || "artifact");
  const sanitized = baseName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  return sanitized || "artifact";
}

async function loadCodexArtifactBuffer(artifact: CodexArtifact): Promise<Buffer | null> {
  if (artifact.base64Data) {
    try {
      return Buffer.from(artifact.base64Data, "base64");
    } catch {
      return null;
    }
  }

  if (!artifact.filePath || !fs.existsSync(artifact.filePath)) {
    return null;
  }

  return fs.promises.readFile(artifact.filePath);
}

async function persistCodexArtifact(input: {
  threadId: number;
  artifact: CodexArtifact;
  buffer: Buffer;
}): Promise<{
  filename: string;
  mimeType: string;
  path: string;
}> {
  const threadDir = path.join(artifactsDir, String(input.threadId));
  await fs.promises.mkdir(threadDir, { recursive: true });

  const filename = sanitizeArtifactFilename(input.artifact.filename);
  const targetPath = path.join(
    threadDir,
    `${Date.now()}-${Math.random().toString(16).slice(2, 10)}-${filename}`,
  );

  await fs.promises.writeFile(targetPath, input.buffer);

  return {
    filename,
    mimeType: input.artifact.mimeType,
    path: targetPath,
  };
}

async function forwardCodexArtifactsToTelegram(input: {
  artifacts: CodexArtifact[];
  threadId: number;
  botToken?: string;
  botUserName: string;
  chatId?: string;
  topicId?: number | null;
  replyToMessageId?: number | null;
}): Promise<void> {
  for (const artifact of input.artifacts) {
    const buffer = await loadCodexArtifactBuffer(artifact);
    if (!buffer) {
      continue;
    }

    const storedArtifact = await persistCodexArtifact({
      threadId: input.threadId,
      artifact,
      buffer,
    });

    const sentMessage =
      input.botToken && input.chatId && input.topicId
        ? artifact.kind === "image"
          ? await sendTopicPhotoAsBot({
              botToken: input.botToken,
              chatId: input.chatId,
              topicId: input.topicId,
              photo: buffer,
              filename: storedArtifact.filename,
              mimeType: storedArtifact.mimeType,
              replyToMessageId: input.replyToMessageId ?? undefined,
            })
          : await sendTopicDocumentAsBot({
              botToken: input.botToken,
              chatId: input.chatId,
              topicId: input.topicId,
              document: buffer,
              filename: storedArtifact.filename,
              mimeType: storedArtifact.mimeType,
              replyToMessageId: input.replyToMessageId ?? undefined,
            })
        : null;

    createMessage({
      threadId: input.threadId,
      role: "system",
      content: buildCodexArtifactRecordText(artifact),
      source: "codex",
      senderName: input.botUserName,
      telegramMessageId: sentMessage?.telegramMessageId ?? null,
      attachmentKind: artifact.kind,
      attachmentPath: storedArtifact.path,
      attachmentMimeType: storedArtifact.mimeType,
      attachmentFilename: storedArtifact.filename,
    });

    broadcastThreadState(input.threadId);
  }
}

function getAppVersion(): string {
  try {
    const packageJsonPath = resolveFromRepo("package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" && packageJson.version.trim() ? packageJson.version.trim() : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function buildPlanUpdateText(explanation: string | null | undefined, plan: CodexPlanStep[]): string {
  const lines: string[] = [];
  if (explanation?.trim()) {
    lines.push(explanation.trim());
  }

  if (plan.length) {
    if (lines.length) {
      lines.push("");
    }

    for (const step of plan) {
      lines.push(`- [${step.status}] ${step.step}`);
    }
  }

  return lines.join("\n").trim();
}

export async function runConversationTurn(input: {
  project: ProjectRecord;
  thread: ThreadRecord;
  content: string;
  senderName: string;
  source: "telegram" | "web";
  originChannel?: "local-ui" | "global-ui";
  mode?: "default" | "plan";
  attachments?: ComposerAttachmentRecord[];
  senderTelegramUserId?: string | null;
  telegramMessageId?: number | null;
}): Promise<{
  thread: ThreadRecord;
}> {
  const telegramTopicId = input.thread.telegramBinding?.telegramTopicId ?? input.thread.telegramTopicId;
  const telegramEnabled = Boolean(
    hasTelegramRuntime() &&
      input.project.connection?.telegramChatId &&
      input.project.connection.telegramAccessHash &&
      telegramTopicId > 0,
  );
  const authConfig = telegramEnabled ? getAuthConfigOrThrow() : null;
  const botConfig = telegramEnabled ? getBotConfigOrThrow() : null;
  const client = telegramEnabled && authConfig ? await getAuthenticatedClient(authConfig) : null;
  const telegramConnection =
    telegramEnabled && input.project.connection?.telegramChatId && input.project.connection.telegramAccessHash
      ? {
          telegramChatId: input.project.connection.telegramChatId,
          telegramAccessHash: input.project.connection.telegramAccessHash,
        }
      : null;
  const attachments = input.attachments || [];
  const displayContent = input.content.trim();
  const codexUserMessage = buildCodexUserMessage(displayContent, attachments);

  if (!codexUserMessage.trim()) {
    throw new HttpError(400, "Message content or attachments are required.");
  }
  let userTelegramMessageId = input.telegramMessageId ?? null;

  if (input.source === "web") {
    if (telegramEnabled && client && telegramConnection) {
      try {
        const sentUserMessage = await sendTopicMessage(
          client,
          telegramConnection,
          telegramTopicId,
          trimTelegramText(codexUserMessage),
        );
        rememberIgnoredTelegramEcho(telegramConnection.telegramChatId, sentUserMessage.telegramMessageId);
        userTelegramMessageId = sentUserMessage.telegramMessageId;
      } catch (error) {
        console.error("Telegram mirror send failed for local message:", error);
      }
    }

    createMessage({
      threadId: input.thread.id,
      role: "user",
      content: displayContent,
      source: input.originChannel ?? "local-ui",
      senderName: input.senderName,
      senderTelegramUserId: getTelegramAuth().userId,
      telegramMessageId: userTelegramMessageId,
      payload: attachments.length
        ? {
            kind: "attachments",
            attachments,
          }
        : null,
    });
    broadcastThreadState(input.thread.id, input.project.id);
  } else {
    createMessage({
      threadId: input.thread.id,
      role: "user",
      content: displayContent,
      source: "telegram",
      senderName: input.senderName,
      senderTelegramUserId: input.senderTelegramUserId ?? null,
      telegramMessageId: input.telegramMessageId ?? null,
      payload: attachments.length
        ? {
            kind: "attachments",
            attachments,
          }
        : null,
    });
    broadcastThreadState(input.thread.id, input.project.id);
  }

  return enqueueThreadTask(input.thread.id, input.mode ?? input.thread.defaultMode ?? "default", async () => {
    const latestThread = getThreadById(input.thread.id) || input.thread;
    const effectiveConfig = await resolveEffectiveThreadCodexConfig(latestThread);
    const selectedMode = input.mode ?? latestThread.defaultMode ?? "default";
    const startedAt = nowIso();
    const startedSnapshot = await captureProjectGitSnapshot(input.project);
    const turnRun = createCodexTurnRun({
      threadId: latestThread.id,
      mode: selectedMode,
      modelId: effectiveConfig.model.id,
      reasoningEffort: effectiveConfig.reasoningEffort,
      permissionMode: effectiveConfig.permissionMode,
      startedAt,
      branchAtStart: startedSnapshot.currentBranch,
      repoCleanAtStart: startedSnapshot.clean,
    });
    let lastProgressText = "";
    let lastPlanText = "";
    const stopTyping =
      telegramEnabled && botConfig && telegramConnection
        ? startBotTypingLoop({
            botToken: botConfig.botToken,
            chatId: toBotApiChatId(telegramConnection.telegramChatId),
            topicId: telegramTopicId,
          })
        : () => undefined;

    try {
      const codexResult = await runCodexTurn({
        project: input.project,
        thread: latestThread,
        userMessage: codexUserMessage,
        senderName: input.senderName,
        source: input.source,
        mode: selectedMode,
        model: effectiveConfig.model.id,
        reasoningEffort: effectiveConfig.reasoningEffort,
        permissionMode: effectiveConfig.permissionMode,
        developerInstructions: combineDeveloperInstructions(
          effectiveConfig.developerInstructions,
          selectedMode === "plan" ? buildPlanModeDeveloperInstruction() : null,
          buildCronActionDeveloperInstruction(latestThread),
        ),
        onEvent: async (event: CodexTurnEvent) => {
          broadcastThreadStreamEvent(latestThread.id, {
            type: event.type,
            text: event.text,
            phase: event.phase ?? null,
            explanation: event.explanation ?? null,
            plan: event.plan,
          });

          if (event.type === "user-input-request" && event.requestId && event.questions?.length) {
            registerPendingUserInputRequest({
              thread: latestThread,
              requestId: event.requestId,
              turnId: event.turnId ?? null,
              itemId: event.itemId ?? null,
              questions: event.questions,
            });
            return;
          }

          if (event.type === "user-input-request-resolved" && event.requestId) {
            resolvePendingUserInputRequest(event.requestId, "resolved");
            return;
          }

          if (event.type === "reasoning-complete" || (event.type === "assistant-complete" && event.phase !== "final_answer")) {
            const progressText = event.text?.trim() || "";
            if (!progressText || progressText === lastProgressText) {
              return;
            }

            lastProgressText = progressText;
            const progressMessage =
              telegramEnabled && botConfig && telegramConnection
                ? await sendTopicMessageAsBot({
                    botToken: botConfig.botToken,
                    chatId: toBotApiChatId(telegramConnection.telegramChatId),
                    topicId: telegramTopicId,
                    text: buildCodexProgressText(progressText),
                    replyToMessageId: userTelegramMessageId ?? undefined,
                  }).catch(() => null)
                : null;

            createMessage({
              threadId: latestThread.id,
              role: "system",
              content: `Codex 진행: ${progressText}`,
              source: "codex",
              senderName: botConfig?.botUserName || "Codex",
              telegramMessageId: progressMessage?.telegramMessageId ?? null,
            });
            broadcastThreadState(latestThread.id, latestThread.projectId);
            return;
          }

          if (event.type === "plan-updated") {
            const planText = buildPlanUpdateText(event.explanation, event.plan || []);
            if (!planText || planText === lastPlanText) {
              return;
            }

            lastPlanText = planText;
            const planMessage =
              telegramEnabled && botConfig && telegramConnection
                ? await sendTopicMessageAsBot({
                    botToken: botConfig.botToken,
                    chatId: toBotApiChatId(telegramConnection.telegramChatId),
                    topicId: telegramTopicId,
                    text: buildCodexProgressText(planText),
                    replyToMessageId: userTelegramMessageId ?? undefined,
                  }).catch(() => null)
                : null;

            createMessage({
              threadId: latestThread.id,
              role: "system",
              content: `Codex plan\n\n${planText}`,
              source: "codex",
              senderName: botConfig?.botUserName || "Codex",
              telegramMessageId: planMessage?.telegramMessageId ?? null,
            });
            broadcastThreadState(latestThread.id, latestThread.projectId);
          }
        },
      });

      const updatedThread =
        !latestThread.codexThreadId || latestThread.codexThreadId !== codexResult.runtimeThreadId
          ? (updateThreadCodexThreadId(latestThread.id, codexResult.runtimeThreadId) ?? latestThread)
          : latestThread;
      const processedOutput = await applyCronActionsFromAssistantOutput({
        thread: updatedThread,
        output: codexResult.output,
      });
      const assistantText = processedOutput.assistantText.trim() || codexResult.output.trim();

      const botAssistantMessage =
        telegramEnabled && botConfig && telegramConnection
          ? await sendTopicMessageAsBot({
              botToken: botConfig.botToken,
              chatId: toBotApiChatId(telegramConnection.telegramChatId),
              topicId: telegramTopicId,
              text: buildCodexReplyText(assistantText),
              replyToMessageId: userTelegramMessageId ?? undefined,
            }).catch(() => null)
          : null;

      createMessage({
        threadId: updatedThread.id,
        role: "assistant",
        content: assistantText,
        source: "codex",
        senderName: botConfig?.botUserName || "Codex",
        telegramMessageId: botAssistantMessage?.telegramMessageId ?? null,
      });
      broadcastThreadState(updatedThread.id, updatedThread.projectId);

      const durationMs = Math.max(0, Date.now() - new Date(startedAt).getTime());
      const exploredFilesCount = new Set(
        codexResult.exploredPaths
          .map((entry) => path.resolve(entry))
          .filter((entry) => isPathInsideRoot(input.project.folderPath, entry)),
      ).size;
      const turnSummaryResult = await buildTurnSummary({
        project: input.project,
        turnRunId: turnRun.id,
        durationMs,
        startedSnapshot,
        exploredFilesCount: exploredFilesCount || null,
      });
      const summaryText =
        turnSummaryResult.summary.changedFileCount > 0
          ? `${turnSummaryResult.summary.changedFileCount}개 파일 변경됨`
          : "Codex 작업 요약";
      const telegramSummaryMessage =
        telegramEnabled && botConfig && telegramConnection
          ? await sendTopicMessageAsBot({
              botToken: botConfig.botToken,
              chatId: toBotApiChatId(telegramConnection.telegramChatId),
              topicId: telegramTopicId,
              text: trimTelegramText(summaryText),
              replyToMessageId: userTelegramMessageId ?? undefined,
            }).catch(() => null)
          : null;
      const summaryEvent = createMessageEvent({
        threadId: updatedThread.id,
        kind: "turn_summary_event",
        role: "system",
        content: summaryText,
        originChannel: "local-ui",
        originActor: botConfig?.botUserName || "Codex",
        displayHints: {
          hideOrigin: true,
          accent: "default",
          localSenderName: botConfig?.botUserName || "Codex",
          telegramSenderName: botConfig?.botUserName || "Codex",
        },
        payload: {
          kind: "turn_summary",
          summary: turnSummaryResult.summary,
        },
        telegramMessageId: telegramSummaryMessage?.telegramMessageId ?? null,
      });
      completeCodexTurnRun(turnRun.id, {
        completedAt: nowIso(),
        durationMs,
        branchAtEnd: turnSummaryResult.branchAtEnd,
        undoState: turnSummaryResult.undoState,
        exploredFilesCount: turnSummaryResult.summary.exploredFilesCount,
        changedFiles: turnSummaryResult.changedFiles,
        repoStatusAfter: turnSummaryResult.repoStatusAfter,
        summaryEventId: summaryEvent.id,
      });
      clearPendingUserInputRequestsForThread(updatedThread.id);
      broadcastThreadState(updatedThread.id, updatedThread.projectId);

      try {
        await forwardCodexArtifactsToTelegram({
          artifacts: codexResult.artifacts,
          threadId: updatedThread.id,
          botToken: botConfig?.botToken,
          botUserName: botConfig?.botUserName || "Codex",
          chatId: telegramConnection ? toBotApiChatId(telegramConnection.telegramChatId) : undefined,
          topicId: telegramEnabled ? telegramTopicId : null,
          replyToMessageId: userTelegramMessageId,
        });
      } catch (error) {
        console.error("Codex artifact forward failed:", error);
      }

      return {
        thread: updatedThread,
      };
    } catch (error) {
      const interrupted = error instanceof CodexTurnInterruptedError;
      const errorMessage = normalizeErrorMessage(error);
      const durationMs = Math.max(0, Date.now() - new Date(startedAt).getTime());
      completeCodexTurnRun(turnRun.id, {
        completedAt: nowIso(),
        durationMs,
        branchAtEnd: startedSnapshot.currentBranch,
        undoState: "not_available",
        exploredFilesCount: null,
        changedFiles: [],
        repoStatusAfter: startedSnapshot.statusPorcelain,
        summaryEventId: null,
      });
      clearPendingUserInputRequestsForThread(latestThread.id);

      createMessage(
        interrupted
          ? {
              threadId: latestThread.id,
              role: "system",
              content: "Codex 작업을 중지했습니다.",
              source: "system",
              senderName: "System",
            }
          : {
              threadId: latestThread.id,
              role: "system",
              content: `Codex 실행 실패: ${errorMessage}`,
              source: "system",
              senderName: "System",
              errorText: errorMessage,
            },
      );
      broadcastThreadState(latestThread.id, latestThread.projectId);

      if (!interrupted && telegramEnabled && botConfig && telegramConnection) {
        await sendTopicMessageAsBot({
          botToken: botConfig.botToken,
          chatId: toBotApiChatId(telegramConnection.telegramChatId),
          topicId: telegramTopicId,
          text: buildCodexErrorNotice(errorMessage),
          replyToMessageId: userTelegramMessageId ?? undefined,
        }).catch(() => undefined);
      }

      throw error;
    } finally {
      stopTyping();
    }
  });
}

export async function resetInstanceState() {
  const settings = resetCodexSettings();
  clearTelegramAuth();
  clearGlobalPairing();
  clearSetting("telegram_bot_callback_offset");
  await resetTelegramRuntimeServices();
  refreshRelayBridgeSocket();
  broadcastWorkspaceUpdated();
  return settings;
}

export async function prepareRuntime(): Promise<void> {
  if (externalServicesDisabled) {
    codexRuntimeVersion = null;
    return;
  }

  const runtimeInfo = await getCodexRuntimeInfo();
  codexRuntimeVersion = runtimeInfo.version;
}

export async function startBackgroundServices(): Promise<void> {
  configureRelayBridgeService({
    port: PORT,
    handleUpdateRpc: (method) =>
      method === "system.update.apply" ? applyAppUpdate() : getAppUpdateStatus({ fetchRemote: true }),
  });
  startRelayBridgeService();

  if (externalServicesDisabled) {
    return;
  }

  try {
    loadCronSchedules();
  } catch (error) {
    console.error("Cron scheduler failed to load:", error);
  }

  await ensureTelegramInboundHandler().catch((error) => {
    console.error("Telegram inbound listener failed to start:", error);
  });
  await ensureBotCallbackPolling().catch((error) => {
    console.error("Telegram bot callback polling failed to start:", error);
  });
  await syncScopedBotCommandsForAllProjects().catch((error) => {
    console.error("Telegram bot command sync failed to start:", error);
  });
}

export async function shutdownBackgroundServices(): Promise<void> {
  stopRelayBridgeService();
  stopAllCronSchedules();
  await stopTelegramRuntimeServices().catch(() => undefined);
  await shutdownCodexRuntime().catch(() => undefined);
}

export function refreshRelayBridgeConnection(): void {
  refreshRelayBridgeSocket();
}
