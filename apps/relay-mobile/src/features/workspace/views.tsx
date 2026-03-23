import { renderEventForChannel } from "@remote-codex/client-core";
import type {
  ComposerAttachmentRecord,
  TurnSummaryPayload,
  UserInputAnswers,
  UserInputRequestPayload,
} from "@remote-codex/contracts";
import {
  buildInitialOtherValues,
  buildInitialSelections,
  formatChangedFileDelta as formatFileDelta,
  formatClockTime,
  formatDurationMs,
  formatEffortLabel,
  formatSubmittedAnswer,
  summarizeChangedFile as summarizeFileChange,
} from "@remote-codex/workspace-core";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import type { AnimatedList } from "react-native-gifted-chat/lib/MessageContainer/types";
import { GiftedChat, type InputToolbarProps, type MessageProps } from "react-native-gifted-chat";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { RichText } from "../../components/RichText";
import type { PreviewWorkspace } from "../../lib/preview";
import type {
  WorkspaceModelOption,
  WorkspaceProject,
  WorkspaceThread,
  WorkspaceThreadMessage,
  WorkspaceThreadSnapshot,
} from "../../types";
import { useWorkspaceAttachmentPreview } from "./hooks";
import { palette, styles } from "./styles";
import type { ComposerSheet, GiftedRelayMessage } from "./types";
import { buildRenderableGiftedMessages, formatPermissionLabel, getProjectIcon, getSelectedModel } from "./utils";

export function WorkspaceHeaderButton({
  icon,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.headerButton}>
      <Ionicons color={palette.deepSoft} name={icon} size={22} />
    </Pressable>
  );
}

export function WorkspaceShell({
  header,
  children,
}: {
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
        <View style={styles.shell}>
          {header}
          {children}
        </View>
      </SafeAreaView>
    </View>
  );
}

export function ConnectingWorkspaceView() {
  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
        <View style={styles.connectingRoot}>
          <ActivityIndicator color={palette.deepSoft} size="large" />
          <Text style={styles.connectingText}>Connecting Workspace..</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

export function ProjectListView({
  deviceName,
  error,
  onBack,
  onOpenProject,
  projects,
}: {
  deviceName: string;
  error: string | null;
  onBack: () => void;
  onOpenProject: (projectId: number) => void;
  projects: WorkspaceProject[];
}) {
  return (
    <WorkspaceShell
      header={
        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            <WorkspaceHeaderButton icon="arrow-back" onPress={onBack} />
            <View style={styles.topBarCopy}>
              <Text style={styles.eyebrow}>Active Device</Text>
              <Text numberOfLines={1} style={styles.topBarTitle}>
                {deviceName}
              </Text>
            </View>
          </View>
        </View>
      }
    >
      <ScrollView contentContainerStyle={styles.projectListContent} showsVerticalScrollIndicator={false}>
        {projects.map((project, index) => (
          <Pressable key={project.id} onPress={() => onOpenProject(project.id)} style={styles.projectCard}>
            <View style={styles.projectLead}>
              <View style={styles.projectIconShell}>
                <MaterialCommunityIcons color={palette.deepSoft} name={getProjectIcon(index)} size={20} />
              </View>
              <View style={styles.projectCopy}>
                <Text numberOfLines={1} style={styles.projectTitle}>
                  {project.name}
                </Text>
                <Text numberOfLines={1} style={styles.projectPath}>
                  {project.folderPath}
                </Text>
              </View>
            </View>
            <Ionicons color={palette.inkSubtle} name="chevron-forward" size={16} />
          </Pressable>
        ))}

        {!projects.length ? (
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyStateTitle}>No projects</Text>
            <Text style={styles.emptyStateText}>This device did not return any workspace projects.</Text>
          </View>
        ) : null}

        {error ? <Text style={styles.inlineError}>{error}</Text> : null}
      </ScrollView>
    </WorkspaceShell>
  );
}

export function ThreadListView({
  creatingThread,
  error,
  onBack,
  onCreateThread,
  onOpenThread,
  project,
}: {
  creatingThread: boolean;
  error: string | null;
  onBack: () => void;
  onCreateThread: () => void;
  onOpenThread: (threadId: number) => void;
  project: WorkspaceProject;
}) {
  return (
    <WorkspaceShell
      header={
        <View style={styles.topBarThread}>
          <View style={styles.topBarLeft}>
            <WorkspaceHeaderButton icon="arrow-back" onPress={onBack} />
            <View style={styles.topBarCopy}>
              <Text numberOfLines={1} style={styles.topBarTitle}>
                {project.name}
              </Text>
              <Text style={styles.eyebrow}>Thread List</Text>
            </View>
          </View>
          {creatingThread ? (
            <View style={styles.headerButton}>
              <ActivityIndicator color={palette.deepSoft} size="small" />
            </View>
          ) : (
            <WorkspaceHeaderButton icon="add" onPress={onCreateThread} />
          )}
        </View>
      }
    >
      <ScrollView contentContainerStyle={styles.threadListContent} showsVerticalScrollIndicator={false}>
        {project.threads.map((thread) => (
          <Pressable key={thread.id} onPress={() => onOpenThread(thread.id)} style={styles.threadCard}>
            <View style={styles.threadCardCopy}>
              <Text numberOfLines={2} style={styles.threadCardTitle}>
                {thread.title}
              </Text>
              <Text style={styles.threadCardMeta}>
                {thread.running ? "Codex 작업 중" : "Ready"} · {thread.effectiveModel || "자동"}
              </Text>
            </View>
            <Ionicons color={palette.inkSubtle} name="chevron-forward" size={14} />
          </Pressable>
        ))}

        {!project.threads.length ? (
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyStateTitle}>No threads</Text>
            <Text style={styles.emptyStateText}>This project does not have any threads yet.</Text>
          </View>
        ) : null}

        {error ? <Text style={styles.inlineError}>{error}</Text> : null}
      </ScrollView>
    </WorkspaceShell>
  );
}

function AttachmentChips({
  attachments,
  removable = false,
  onRemove,
}: {
  attachments: ComposerAttachmentRecord[];
  removable?: boolean;
  onRemove?: (attachmentId: string) => void;
}) {
  if (!attachments.length) {
    return null;
  }

  return (
    <View style={styles.attachmentChips}>
      {attachments.map((attachment) => (
        <View key={attachment.id} style={styles.attachmentChip}>
          <Ionicons color={palette.chatMuted} name="attach-outline" size={13} />
          <Text numberOfLines={1} style={styles.attachmentChipText}>
            {attachment.relativePath || attachment.name}
          </Text>
          {removable && onRemove ? (
            <Pressable onPress={() => onRemove(attachment.id)} style={styles.attachmentChipRemove}>
              <Ionicons color={palette.chatMuted} name="close" size={12} />
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function MessageAttachmentPreview({
  authToken,
  deviceId,
  message,
  preview,
}: {
  authToken: string;
  deviceId: string;
  message: WorkspaceThreadMessage;
  preview: PreviewWorkspace | null;
}) {
  const attachment = useWorkspaceAttachmentPreview({
    attachmentKind: message.attachmentKind,
    authToken,
    deviceId,
    messageId: message.id,
    preview,
  });

  if (!message.attachmentKind) {
    return null;
  }

  if (attachment?.uri && attachment.kind === "image") {
    return <Image source={{ uri: attachment.uri }} style={styles.attachmentImage} />;
  }

  if (attachment?.uri) {
    return (
      <Pressable onPress={() => void Linking.openURL(attachment.uri!)} style={styles.attachmentLink}>
        <Ionicons color={palette.chatText} name="open-outline" size={15} />
        <Text style={styles.attachmentLinkText}>{message.attachmentFilename || attachment.fileName || "Open attachment"}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.attachmentFallback}>
      <Ionicons color={palette.chatMuted} name="document-outline" size={15} />
      <Text style={styles.attachmentFallbackText}>{message.attachmentFilename || "Attachment unavailable"}</Text>
    </View>
  );
}

function SummaryActionButton({
  disabled = false,
  label,
  onPress,
  tone = "secondary",
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  tone?: "secondary" | "ghost" | "danger";
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.summaryActionButton,
        tone === "ghost"
          ? styles.summaryActionGhost
          : tone === "danger"
            ? styles.summaryActionDanger
            : styles.summaryActionSecondary,
        disabled && styles.summaryActionDisabled,
      ]}
    >
      <Text style={styles.summaryActionLabel}>{label}</Text>
    </Pressable>
  );
}

function TurnSummaryCard({
  enabledUndo,
  onUndo,
  summary,
  undoing,
}: {
  enabledUndo: boolean;
  onUndo: (turnRunId: number) => void;
  summary: TurnSummaryPayload;
  undoing: boolean;
}) {
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryHeader}>
        <Text style={styles.summaryTitle}>
          {summary.changedFileCount > 0 ? `${summary.changedFileCount}개 파일 변경됨` : "Codex 작업 요약"}
        </Text>
        {enabledUndo ? (
          <SummaryActionButton
            disabled={undoing}
            label={undoing ? "실행취소 중..." : "실행취소"}
            onPress={() => onUndo(summary.turnRunId)}
          />
        ) : null}
      </View>

      <View style={styles.summaryMeta}>
        <Text style={styles.summaryMetaText}>{formatDurationMs(summary.durationMs)} 동안 작업</Text>
        {summary.exploredFilesCount ? <Text style={styles.summaryMetaText}>{summary.exploredFilesCount}개 파일 탐색</Text> : null}
        {summary.branch ? <Text style={styles.summaryMetaText}>{summary.branch}</Text> : null}
      </View>

      {summary.note ? <Text style={styles.summaryNote}>{summary.note}</Text> : null}

      {summary.changedFiles.length ? (
        <View style={styles.summaryFiles}>
          {summary.changedFiles.map((file) => {
            const delta = formatFileDelta(file);
            return (
              <View key={`${file.path}:${file.status}`} style={styles.summaryFileRow}>
                <View style={styles.summaryFileCopy}>
                  <Text numberOfLines={1} style={styles.summaryFileLabel}>
                    {summarizeFileChange(file)} {file.path}
                  </Text>
                </View>
                {delta ? <Text style={styles.summaryDelta}>{delta}</Text> : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {!enabledUndo && summary.undoState === "undone" ? (
        <Text style={styles.summaryState}>실행취소됨</Text>
      ) : null}
      {!enabledUndo && summary.undoState === "blocked" ? (
        <Text style={styles.summaryState}>현재 상태에서는 실행취소할 수 없음</Text>
      ) : null}
    </View>
  );
}

function UserInputRequestCard({
  onCancel,
  onSubmit,
  request,
  respondingRequestId,
  stopping,
}: {
  onCancel: (requestId: string) => void;
  onSubmit: (requestId: string, answers: UserInputAnswers) => void;
  request: UserInputRequestPayload;
  respondingRequestId: string | null;
  stopping: boolean;
}) {
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>(() => buildInitialSelections(request));
  const [otherAnswers, setOtherAnswers] = useState<Record<string, string>>(() => buildInitialOtherValues(request));
  const isLocked = request.status !== "pending";
  const isSubmitting = respondingRequestId === request.requestId;

  useEffect(() => {
    setSelectedAnswers(buildInitialSelections(request));
    setOtherAnswers(buildInitialOtherValues(request));
  }, [request]);

  const canSubmit =
    !isLocked &&
    request.questions.every((question) => {
      const selectedValue = selectedAnswers[question.id] || "";
      if (!selectedValue) {
        return false;
      }
      if (selectedValue === "__other__") {
        return Boolean(otherAnswers[question.id]?.trim());
      }
      return true;
    });

  return (
    <View style={styles.userInputCard}>
      <View style={styles.userInputHeader}>
        <Text style={styles.summaryTitle}>Codex가 선택을 요청했습니다</Text>
        <Text style={styles.userInputState}>
          {request.status === "resolved" ? "처리 완료" : request.status === "submitted" ? "제출됨" : "대기 중"}
        </Text>
      </View>

      <View style={styles.userInputQuestions}>
        {request.questions.map((question) => (
          <View key={question.id} style={styles.userInputQuestion}>
            {question.header ? <Text style={styles.userInputQuestionHeader}>{question.header}</Text> : null}
            <Text style={styles.userInputQuestionText}>{question.question}</Text>

            <View style={styles.userInputOptions}>
              {question.options.map((option) => {
                const selected = selectedAnswers[question.id] === option.label;
                return (
                  <Pressable
                    key={option.label}
                    disabled={isLocked || isSubmitting}
                    onPress={() =>
                      setSelectedAnswers((current) => ({
                        ...current,
                        [question.id]: option.label,
                      }))
                    }
                    style={[styles.userInputOption, selected && styles.userInputOptionSelected]}
                  >
                    <Text style={styles.userInputOptionLabel}>{option.label}</Text>
                    {option.description ? <Text style={styles.userInputOptionDescription}>{option.description}</Text> : null}
                  </Pressable>
                );
              })}

              {question.isOther ? (
                <View style={styles.userInputOtherWrap}>
                  <Pressable
                    disabled={isLocked || isSubmitting}
                    onPress={() =>
                      setSelectedAnswers((current) => ({
                        ...current,
                        [question.id]: "__other__",
                      }))
                    }
                    style={[
                      styles.userInputOption,
                      selectedAnswers[question.id] === "__other__" && styles.userInputOptionSelected,
                    ]}
                  >
                    <Text style={styles.userInputOptionLabel}>직접 입력</Text>
                  </Pressable>
                  {selectedAnswers[question.id] === "__other__" ? (
                    <TextInput
                      editable={!isLocked && !isSubmitting}
                      onChangeText={(value) =>
                        setOtherAnswers((current) => ({
                          ...current,
                          [question.id]: value,
                        }))
                      }
                      placeholder="직접 입력"
                      placeholderTextColor={palette.chatSubtle}
                      secureTextEntry={question.isSecret}
                      style={styles.userInputOtherInput}
                      value={otherAnswers[question.id] || ""}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>

            {request.status !== "pending" ? (
              <Text style={styles.userInputAnswerSummary}>
                선택: {formatSubmittedAnswer(question, request) || "응답 없음"}
              </Text>
            ) : null}
          </View>
        ))}
      </View>

      {request.status === "pending" ? (
        <View style={styles.userInputActions}>
          <SummaryActionButton
            disabled={isSubmitting || stopping}
            label={stopping ? "취소 중..." : "취소"}
            onPress={() => onCancel(request.requestId)}
            tone="ghost"
          />
          <SummaryActionButton
            disabled={!canSubmit || isSubmitting || stopping}
            label={isSubmitting ? "제출 중..." : "선택 제출"}
            onPress={() => {
              const answers = Object.fromEntries(
                request.questions.map((question) => {
                  const selectedValue = selectedAnswers[question.id];
                  const answer =
                    selectedValue === "__other__" ? otherAnswers[question.id]?.trim() || "" : selectedValue;
                  return [
                    question.id,
                    {
                      answers: answer ? [answer] : [],
                    },
                  ];
                }),
              ) as UserInputAnswers;
              onSubmit(request.requestId, answers);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function MessageRow({
  authToken,
  authUserName,
  deviceId,
  latestUndoableTurnRunId,
  message,
  onCancelUserInputRequest,
  onSubmitUserInputRequest,
  onUndoTurn,
  preview,
  respondingUserInputRequestId,
  stoppingThread,
  undoingTurnRunId,
}: {
  authToken: string;
  authUserName: string;
  deviceId: string;
  latestUndoableTurnRunId: number | null;
  message: WorkspaceThreadMessage;
  onCancelUserInputRequest: (requestId: string) => void;
  onSubmitUserInputRequest: (requestId: string, answers: UserInputAnswers) => void;
  onUndoTurn: (turnRunId: number) => void;
  preview: PreviewWorkspace | null;
  respondingUserInputRequestId: string | null;
  stoppingThread: boolean;
  undoingTurnRunId: number | null;
}) {
  const rendered = renderEventForChannel("local-ui", message, authUserName);
  const isUser = message.role === "user";
  const attachmentPayload = message.payload?.kind === "attachments" ? message.payload.attachments : [];

  if (message.payload?.kind === "turn_summary") {
    const summary = message.payload.summary;
    const enabledUndo =
      summary.undoAvailable &&
      summary.undoState === "available" &&
      latestUndoableTurnRunId === summary.turnRunId;

    return (
      <View style={styles.summaryRow}>
        <TurnSummaryCard
          enabledUndo={enabledUndo}
          onUndo={onUndoTurn}
          summary={summary}
          undoing={undoingTurnRunId === summary.turnRunId}
        />
      </View>
    );
  }

  if (message.payload?.kind === "user_input_request") {
    return (
      <View style={styles.summaryRow}>
        <UserInputRequestCard
          onCancel={onCancelUserInputRequest}
          onSubmit={onSubmitUserInputRequest}
          request={message.payload.request}
          respondingRequestId={respondingUserInputRequestId}
          stopping={stoppingThread}
        />
      </View>
    );
  }

  if (rendered.isSystem) {
    return (
      <View style={styles.codexEntry}>
        <View style={styles.codexBody}>
          <Text style={styles.systemAccentLabel}>
            {rendered.isError ? "Error" : rendered.isCron ? "Cron" : rendered.isProgress ? "Progress" : "System"}
          </Text>
          {rendered.content ? <RichText text={rendered.content} tone="muted" /> : null}
          <MessageAttachmentPreview authToken={authToken} deviceId={deviceId} message={message} preview={preview} />
        </View>
      </View>
    );
  }

  if (!isUser) {
    return (
      <View style={styles.codexEntry}>
        <View style={styles.codexBody}>
          {rendered.showSender ? <Text style={styles.caption}>{rendered.senderLabel}</Text> : null}
          {rendered.content ? <RichText text={rendered.content} tone="codex" /> : null}
          <AttachmentChips attachments={attachmentPayload} />
          <MessageAttachmentPreview authToken={authToken} deviceId={deviceId} message={message} preview={preview} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.userEntry}>
      <View style={styles.userBubbleWrap}>
        <View style={styles.userBubble}>
          {rendered.showSender ? <Text style={styles.userCaption}>{rendered.senderLabel}</Text> : null}
          {rendered.content ? <RichText text={rendered.content} tone="inverse" /> : null}
          <AttachmentChips attachments={attachmentPayload} />
          <MessageAttachmentPreview authToken={authToken} deviceId={deviceId} message={message} preview={preview} />
        </View>
        <Text style={styles.timestamp}>{formatClockTime(message.createdAt)}</Text>
      </View>
    </View>
  );
}

function LiveMessageRow({
  kind,
  text,
}: {
  kind: Extract<GiftedRelayMessage["kind"], "live-plan" | "live-reasoning" | "live-assistant">;
  text: string;
}) {
  if (kind === "live-assistant") {
    return (
      <View style={styles.codexEntry}>
        <View style={styles.codexBody}>
          <RichText text={text} tone="codex" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.codexEntry}>
      <View style={styles.codexBody}>
        <Text style={styles.systemAccentLabel}>{kind === "live-plan" ? "Plan" : "Thinking"}</Text>
        <RichText text={text} tone="muted" />
      </View>
    </View>
  );
}

function ComposerChip({
  active = false,
  disabled = false,
  icon,
  label,
  onPress,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.controlChip, active && styles.controlChipActive, disabled && styles.controlChipDisabled]}
    >
      <Ionicons color={active ? palette.chatText : palette.chatMuted} name={icon} size={14} />
      <Text numberOfLines={1} style={[styles.controlChipText, active && styles.controlChipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function GiftedComposerToolbar({
  activeSheet,
  bottomInset,
  draft,
  effortValue,
  keyboardVisible,
  onChangeDraft,
  onChangeSheet,
  onOpenAttachmentPicker,
  onSend,
  onTogglePlanMode,
  permissionLabel,
  selectedModelLabel,
  selectedModelReasoning,
  stoppingThread,
  submittingMessage,
  thread,
  updatingControl,
}: {
  activeSheet: ComposerSheet;
  bottomInset: number;
  draft: string;
  effortValue: string;
  keyboardVisible: boolean;
  onChangeDraft: (value: string) => void;
  onChangeSheet: (value: ComposerSheet) => void;
  onOpenAttachmentPicker: () => void;
  onSend: () => void;
  onTogglePlanMode: () => void;
  permissionLabel: string;
  selectedModelLabel: string;
  selectedModelReasoning: string | null | undefined;
  stoppingThread: boolean;
  submittingMessage: boolean;
  thread: WorkspaceThread;
  updatingControl: string | null;
}) {
  const sendDisabled = stoppingThread || (submittingMessage && !thread.running) || (!thread.running && !draft.trim());
  const composerBottomPadding = keyboardVisible ? 8 : Math.max(bottomInset, 10) + 4;

  return (
    <View
      style={[
        styles.chatComposerRail,
        {
          paddingBottom: composerBottomPadding,
        },
      ]}
    >
      <ScrollView contentContainerStyle={styles.chatControlRow} horizontal showsHorizontalScrollIndicator={false}>
        <ComposerChip
          disabled={submittingMessage || stoppingThread}
          icon="attach-outline"
          label="파일 업로드"
          onPress={onOpenAttachmentPicker}
        />
        <ComposerChip
          active={thread.composerSettings.defaultMode === "plan"}
          disabled={updatingControl === "plan"}
          icon="git-branch-outline"
          label={thread.composerSettings.defaultMode === "plan" ? "플랜 ON" : "플랜 OFF"}
          onPress={onTogglePlanMode}
        />
        <ComposerChip
          active={activeSheet === "model"}
          disabled={updatingControl === "model"}
          icon="sparkles-outline"
          label={selectedModelLabel}
          onPress={() => onChangeSheet("model")}
        />
        <ComposerChip
          active={activeSheet === "effort"}
          disabled={updatingControl === "effort"}
          icon="flash-outline"
          label={
            effortValue === "__default__"
              ? `Effort ${formatEffortLabel(thread.effectiveReasoningEffort || selectedModelReasoning)}`
              : `Effort ${formatEffortLabel(thread.composerSettings.reasoningEffortOverride)}`
          }
          onPress={() => onChangeSheet("effort")}
        />
        <ComposerChip
          active={activeSheet === "access"}
          disabled={updatingControl === "access"}
          icon="shield-outline"
          label={permissionLabel}
          onPress={() => onChangeSheet("access")}
        />
      </ScrollView>

      <View style={styles.chatComposer}>
        <TextInput
          multiline
          onChangeText={onChangeDraft}
          placeholder="후속 변경 사항을 부탁하세요"
          placeholderTextColor={palette.chatSubtle}
          style={styles.chatComposerInput}
          value={draft}
        />
        <Pressable
          disabled={sendDisabled}
          onPress={onSend}
          style={[styles.chatSendButton, sendDisabled && styles.chatSendButtonDisabled]}
        >
          <Ionicons color="#ffffff" name={thread.running ? "stop" : "arrow-forward"} size={16} />
        </Pressable>
      </View>
    </View>
  );
}

function ComposerSheetModal({
  onClose,
  onSelect,
  options,
  selectedValue,
  title,
  visible,
}: {
  onClose: () => void;
  onSelect: (value: string) => void;
  options: Array<{ label: string; value: string; description?: string }>;
  selectedValue: string;
  title: string;
  visible: boolean;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.sheetBackdrop}>
        <Pressable onPress={() => undefined} style={styles.sheetCard}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <View style={styles.sheetOptions}>
            {options.map((option) => {
              const selected = option.value === selectedValue;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    onSelect(option.value);
                    onClose();
                  }}
                  style={[styles.sheetOption, selected && styles.sheetOptionSelected]}
                >
                  <View style={styles.sheetOptionCopy}>
                    <Text style={styles.sheetOptionLabel}>{option.label}</Text>
                    {option.description ? <Text style={styles.sheetOptionDescription}>{option.description}</Text> : null}
                  </View>
                  {selected ? <Ionicons color={palette.chatAccent} name="checkmark" size={18} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ChatEmptyState({ loading }: { loading: boolean }) {
  if (loading) {
    return (
      <View style={styles.chatEmptyState}>
        <ActivityIndicator color={palette.chatAccent} size="small" />
        <Text style={styles.chatEmptyText}>Loading thread messages…</Text>
      </View>
    );
  }

  return (
    <View style={styles.chatEmptyState}>
      <Text style={styles.chatEmptyTitle}>No messages yet</Text>
      <Text style={styles.chatEmptyText}>첫 메시지를 보내면 Codex 세션이 시작됩니다.</Text>
    </View>
  );
}

export function ChatView({
  activeSheet,
  authToken,
  authUserName,
  deviceId,
  deviceName,
  draft,
  error,
  loadingMessages,
  messages,
  modelOptions,
  onBack,
  onCancelUserInputRequest,
  onChangeAccess,
  onChangeDraft,
  onChangeEffort,
  onChangeModel,
  onChangeSheet,
  onOpenAttachmentPicker,
  onSend,
  onSubmitUserInputRequest,
  onTogglePlanMode,
  onUndoTurn,
  preview,
  project,
  respondingUserInputRequestId,
  stoppingThread,
  submittingMessage,
  thread,
  threadSnapshot,
  undoingTurnRunId,
  updatingControl,
}: {
  activeSheet: ComposerSheet;
  authToken: string;
  authUserName: string;
  deviceId: string;
  deviceName: string;
  draft: string;
  error: string | null;
  loadingMessages: boolean;
  messages: WorkspaceThreadMessage[];
  modelOptions: WorkspaceModelOption[];
  onBack: () => void;
  onCancelUserInputRequest: (requestId: string) => void;
  onChangeAccess: (value: WorkspaceThread["composerSettings"]["permissionMode"]) => void;
  onChangeDraft: (value: string) => void;
  onChangeEffort: (value: string | null) => void;
  onChangeModel: (value: string | null) => void;
  onChangeSheet: (value: ComposerSheet) => void;
  onOpenAttachmentPicker: () => void;
  onSend: () => void;
  onSubmitUserInputRequest: (requestId: string, answers: UserInputAnswers) => void;
  onTogglePlanMode: () => void;
  onUndoTurn: (turnRunId: number) => void;
  preview: PreviewWorkspace | null;
  project: WorkspaceProject;
  respondingUserInputRequestId: string | null;
  stoppingThread: boolean;
  submittingMessage: boolean;
  thread: WorkspaceThread;
  threadSnapshot: WorkspaceThreadSnapshot;
  undoingTurnRunId: number | null;
  updatingControl: string | null;
}) {
  const insets = useSafeAreaInsets();
  const messagesContainerRef = useRef<AnimatedList<GiftedRelayMessage>>(null!);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const latestUndoableTurnRunId = useMemo(() => {
    const summaries = messages
      .map((message) => message.payload)
      .filter((payload): payload is { kind: "turn_summary"; summary: TurnSummaryPayload } => payload?.kind === "turn_summary")
      .map((payload) => payload.summary)
      .filter((summary) => summary.undoAvailable && summary.undoState === "available");

    return summaries.length ? summaries[summaries.length - 1].turnRunId : null;
  }, [messages]);

  const selectedModel = getSelectedModel(thread, modelOptions);
  const effortValue = thread.composerSettings.reasoningEffortOverride || "__default__";
  const modelSheetValue = thread.composerSettings.modelOverride || "__default__";
  const permissionValue = thread.composerSettings.permissionMode;
  const giftedMessages = useMemo(
    () => buildRenderableGiftedMessages(messages, threadSnapshot.liveStream, thread.running),
    [messages, thread.running, threadSnapshot.liveStream],
  );

  const scrollToLatestMessage = useCallback((animated = false) => {
    requestAnimationFrame(() => {
      if (typeof messagesContainerRef.current?.scrollToEnd === "function") {
        messagesContainerRef.current.scrollToEnd({ animated });
        return;
      }

      if (typeof messagesContainerRef.current?.scrollToOffset === "function") {
        messagesContainerRef.current.scrollToOffset({ animated, offset: Number.MAX_SAFE_INTEGER });
      }
    });
  }, []);

  useEffect(() => {
    if (loadingMessages) {
      return;
    }

    scrollToLatestMessage(false);
  }, [
    giftedMessages.length,
    loadingMessages,
    scrollToLatestMessage,
    thread.id,
    threadSnapshot.liveStream?.assistantText,
    threadSnapshot.liveStream?.planText,
    threadSnapshot.liveStream?.reasoningText,
  ]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSubscription = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const modelOptionsForSheet = useMemo(
    () => [
      {
        value: "__default__",
        label: `기본값 (${thread.effectiveModel || "자동"})`,
      },
      ...modelOptions.map((model) => ({
        value: model.value,
        label: model.label,
        description: `기본 effort ${formatEffortLabel(model.defaultReasoningEffort)}`,
      })),
    ],
    [modelOptions, thread.effectiveModel],
  );

  const effortOptionsForSheet = useMemo(
    () => [
      {
        value: "__default__",
        label: `기본값 (${thread.effectiveReasoningEffort || selectedModel?.defaultReasoningEffort || "자동"})`,
      },
      ...(selectedModel?.supportedReasoningEfforts || []).map((effort) => ({
        value: effort,
        label: formatEffortLabel(effort),
      })),
    ],
    [selectedModel?.defaultReasoningEffort, selectedModel?.supportedReasoningEfforts, thread.effectiveReasoningEffort],
  );

  const chatListHeader = useMemo(
    () => (
      <View style={styles.chatListHeader}>
        <View style={styles.chatContextCard}>
          <Text style={styles.chatContextLabel}>Live Workspace</Text>
          <Text style={styles.chatContextValue}>{deviceName}</Text>
          <Text numberOfLines={1} style={styles.chatContextSubtext}>
            {project.folderPath}
          </Text>
          <View style={styles.chatContextMeta}>
            <Text style={styles.chatContextMetaText}>{thread.effectiveModel || "자동"}</Text>
            <Text style={styles.chatContextMetaText}>
              {thread.composerSettings.defaultMode === "plan" ? "Plan mode" : "Default mode"}
            </Text>
            <Text style={styles.chatContextMetaText}>
              {formatPermissionLabel(thread.composerSettings.permissionMode)}
            </Text>
          </View>
        </View>

        {thread.running ? (
          <View style={styles.runningState}>
            <View style={styles.runningDot} />
            <Text style={styles.runningText}>
              Codex 작업 중{thread.currentMode === "plan" ? " · plan mode" : ""}
            </Text>
          </View>
        ) : null}

        {threadSnapshot.hasMoreBefore ? (
          <View style={styles.hasMoreBanner}>
            <Text style={styles.hasMoreText}>이전 메시지가 더 있습니다. 모바일에서는 최신 대화 중심으로 표시됩니다.</Text>
          </View>
        ) : null}
      </View>
    ),
    [
      deviceName,
      project.folderPath,
      thread.composerSettings.defaultMode,
      thread.composerSettings.permissionMode,
      thread.currentMode,
      thread.effectiveModel,
      thread.running,
      threadSnapshot.hasMoreBefore,
    ],
  );
  const chatEmptyState = useMemo(() => <ChatEmptyState loading={loadingMessages} />, [loadingMessages]);
  const giftedListViewProps = useMemo(
    () =>
      ({
        ListEmptyComponent: chatEmptyState,
        ListHeaderComponent: chatListHeader,
        contentContainerStyle: styles.chatContent,
        keyboardDismissMode: Platform.OS === "ios" ? "interactive" : "on-drag",
        keyboardShouldPersistTaps: "handled",
        showsVerticalScrollIndicator: false,
      }) as Record<string, unknown>,
    [chatEmptyState, chatListHeader],
  );

  const renderGiftedMessage = useCallback(
    (props: MessageProps<GiftedRelayMessage>) => {
      const currentMessage = props.currentMessage;
      if (!currentMessage) {
        return <View />;
      }

      if (currentMessage.kind !== "history") {
        return <LiveMessageRow kind={currentMessage.kind} text={currentMessage.liveText} />;
      }

      return (
        <View style={styles.messageRowWrap}>
          <MessageRow
            authToken={authToken}
            authUserName={authUserName}
            deviceId={deviceId}
            latestUndoableTurnRunId={latestUndoableTurnRunId}
            message={currentMessage.record}
            onCancelUserInputRequest={onCancelUserInputRequest}
            onSubmitUserInputRequest={onSubmitUserInputRequest}
            onUndoTurn={onUndoTurn}
            preview={preview}
            respondingUserInputRequestId={respondingUserInputRequestId}
            stoppingThread={stoppingThread}
            undoingTurnRunId={undoingTurnRunId}
          />
        </View>
      );
    },
    [
      authToken,
      authUserName,
      deviceId,
      latestUndoableTurnRunId,
      onCancelUserInputRequest,
      onSubmitUserInputRequest,
      onUndoTurn,
      preview,
      respondingUserInputRequestId,
      stoppingThread,
      undoingTurnRunId,
    ],
  );

  return (
    <View style={styles.chatRoot}>
      <SafeAreaView edges={["top"]} style={styles.chatSafeArea}>
        <View style={styles.chatTopBar}>
          <View style={styles.topBarLeft}>
            <Pressable onPress={onBack} style={styles.chatHeaderButton}>
              <Ionicons color={palette.chatText} name="arrow-back" size={20} />
            </Pressable>
            <View style={styles.topBarCopy}>
              <Text numberOfLines={1} style={styles.chatTitle}>
                {thread.title}
              </Text>
              <Text numberOfLines={1} style={styles.chatSubtitle}>
                {project.name} · {deviceName}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.chatBody}>
          <GiftedChat<GiftedRelayMessage>
            bottomOffset={0}
            inverted={false}
            listViewProps={giftedListViewProps}
            messages={giftedMessages}
            messageContainerRef={messagesContainerRef}
            messagesContainerStyle={styles.chatMessagesContainer}
            minInputToolbarHeight={0}
            onSend={() => undefined}
            renderChatFooter={() => (error ? <Text style={styles.chatInlineError}>{error}</Text> : null)}
            renderDay={() => null}
            renderInputToolbar={(_props: InputToolbarProps<GiftedRelayMessage>) => (
              <GiftedComposerToolbar
                activeSheet={activeSheet}
                bottomInset={insets.bottom}
                draft={draft}
                effortValue={effortValue}
                keyboardVisible={keyboardVisible}
                onChangeDraft={onChangeDraft}
                onChangeSheet={onChangeSheet}
                onOpenAttachmentPicker={onOpenAttachmentPicker}
                onSend={onSend}
                onTogglePlanMode={onTogglePlanMode}
                permissionLabel={formatPermissionLabel(thread.composerSettings.permissionMode)}
                selectedModelLabel={selectedModel?.label || thread.effectiveModel || "모델"}
                selectedModelReasoning={thread.effectiveReasoningEffort || selectedModel?.defaultReasoningEffort}
                stoppingThread={stoppingThread}
                submittingMessage={submittingMessage}
                thread={thread}
                updatingControl={updatingControl}
              />
            )}
            renderMessage={renderGiftedMessage}
            text={draft}
            textInputProps={{
              onChangeText: onChangeDraft,
            }}
            user={{
              _id: "user",
              name: authUserName,
            }}
          />
        </View>

        <ComposerSheetModal
          onClose={() => onChangeSheet(null)}
          onSelect={(value) => onChangeModel(value === "__default__" ? null : value)}
          options={modelOptionsForSheet}
          selectedValue={modelSheetValue}
          title="모델 선택"
          visible={activeSheet === "model"}
        />
        <ComposerSheetModal
          onClose={() => onChangeSheet(null)}
          onSelect={(value) => onChangeEffort(value === "__default__" ? null : value)}
          options={effortOptionsForSheet}
          selectedValue={effortValue}
          title="Effort 선택"
          visible={activeSheet === "effort"}
        />
        <ComposerSheetModal
          onClose={() => onChangeSheet(null)}
          onSelect={(value) => onChangeAccess(value as WorkspaceThread["composerSettings"]["permissionMode"])}
          options={[
            { value: "default", label: "기본권한", description: "안전한 기본 접근으로 작업합니다." },
            { value: "danger-full-access", label: "전체 액세스", description: "파일 수정과 넓은 명령 실행을 허용합니다." },
          ]}
          selectedValue={permissionValue}
          title="접근 권한"
          visible={activeSheet === "access"}
        />
      </SafeAreaView>
    </View>
  );
}
