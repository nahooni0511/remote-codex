import type {
  ComposerAttachmentRecord,
  ComposerModelOption,
  MessageRecord,
  ProjectGitState,
  ThreadListItem,
  TurnSummaryPayload,
  UserInputAnswers,
} from "@remote-codex/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveStreamState } from "../../lib/chat";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import type { ChatNotice } from "./notice";
import { AttachmentChips, formatEffortLabel, LiveStream, MessageRow } from "./ThreadPanelParts";
import styles from "./ThreadPanel.module.css";

export function ThreadPanel({
  thread,
  messages,
  hasMoreBefore,
  draft,
  submitting,
  notice,
  liveStream,
  authUserName,
  modelOptions,
  gitState,
  attachments,
  undoingTurnRunId,
  respondingUserInputRequestId,
  stoppingThread,
  onDraftChange,
  onSubmit,
  onStop,
  onLoadMore,
  onTogglePlanMode,
  onModelChange,
  onEffortChange,
  onPermissionChange,
  onBranchChange,
  onCreateBranch,
  onOpenAttachmentPicker,
  onRemoveAttachment,
  onUndoTurn,
  onSubmitUserInputRequest,
  onCancelUserInputRequest,
}: {
  thread: ThreadListItem;
  messages: MessageRecord[];
  hasMoreBefore: boolean;
  draft: string;
  submitting: boolean;
  notice: ChatNotice;
  liveStream: LiveStreamState | undefined;
  authUserName: string;
  modelOptions: ComposerModelOption[];
  gitState: ProjectGitState | null;
  attachments: ComposerAttachmentRecord[];
  undoingTurnRunId: number | null;
  respondingUserInputRequestId: string | null;
  stoppingThread: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onLoadMore: () => void;
  onTogglePlanMode: () => void;
  onModelChange: (value: string | null) => void;
  onEffortChange: (value: string | null) => void;
  onPermissionChange: (value: "default" | "danger-full-access") => void;
  onBranchChange: (branchName: string) => void;
  onCreateBranch: () => void;
  onOpenAttachmentPicker: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onUndoTurn: (turnRunId: number) => void;
  onSubmitUserInputRequest: (requestId: string, answers: UserInputAnswers) => void;
  onCancelUserInputRequest: (requestId: string) => void;
}) {
  const feedRef = useRef<HTMLDivElement | null>(null);
  const menuWrapRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const element = feedRef.current;
    if (!element) {
      return;
    }

    element.scrollTop = element.scrollHeight;
  }, [messages.length, liveStream?.assistantText, liveStream?.planText, liveStream?.reasoningText]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (menuWrapRef.current && target instanceof Node && !menuWrapRef.current.contains(target)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [menuOpen]);

  const latestUndoableTurnRunId = useMemo(() => {
    const summaries = messages
      .map((message) => message.payload)
      .filter((payload): payload is { kind: "turn_summary"; summary: TurnSummaryPayload } => payload?.kind === "turn_summary")
      .map((payload) => payload.summary)
      .filter((summary) => summary.undoAvailable && summary.undoState === "available");

    return summaries.length ? summaries[summaries.length - 1].turnRunId : null;
  }, [messages]);

  const selectedModelId = thread.composerSettings.modelOverride || thread.effectiveModel || modelOptions[0]?.value || "";
  const selectedModel = modelOptions.find((entry) => entry.value === selectedModelId) || modelOptions[0] || null;
  const selectedEffortValue = thread.composerSettings.reasoningEffortOverride || "__default__";

  return (
    <section className={styles.panel}>
      {notice ? <Banner tone={notice.tone}>{notice.message}</Banner> : null}

      {thread.running ? (
        <div className={styles.runningState}>
          <span className={styles.runningDot} />
          <span>Codex 작업 중{thread.currentMode === "plan" ? " · plan mode" : ""}</span>
        </div>
      ) : null}

      <div className={styles.feed} ref={feedRef}>
        {hasMoreBefore ? (
          <div className={styles.loadMoreWrap}>
            <Button type="button" variant="secondary" onClick={onLoadMore}>
              이전 메시지 더보기
            </Button>
          </div>
        ) : null}

        {messages.length ? (
          messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              authUserName={authUserName}
              latestUndoableTurnRunId={latestUndoableTurnRunId}
              undoingTurnRunId={undoingTurnRunId}
              stoppingThread={stoppingThread}
              onUndoTurn={onUndoTurn}
              respondingUserInputRequestId={respondingUserInputRequestId}
              onSubmitUserInputRequest={onSubmitUserInputRequest}
              onCancelUserInputRequest={onCancelUserInputRequest}
            />
          ))
        ) : (
          <div className={styles.emptyFeed}>
            메시지가 없습니다. 아래 입력창이나 연결된 외부 채널에서 첫 메시지를 보내면 Codex 세션이 시작됩니다.
          </div>
        )}
        <LiveStream stream={liveStream} />
      </div>

      <div className={styles.composerShell}>
        <div className={styles.composerTextAreaSection}>
          <AttachmentChips attachments={attachments} removable onRemove={onRemoveAttachment} />

          <textarea
            className={styles.composerInput}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                onSubmit();
              }
            }}
            placeholder="후속 변경 사항을 부탁하세요"
            rows={2}
          />
        </div>

        <div className={styles.composerControlsRow}>
          <div className={styles.primaryControls}>
            <div className={styles.menuWrap} ref={menuWrapRef}>
              <Button
                type="button"
                variant="icon"
                className={styles.menuToggle}
                onClick={() => setMenuOpen((current) => !current)}
                aria-label="추가 설정"
              >
                <Icon name="plus" />
              </Button>
              {menuOpen ? (
                <div className={styles.menu}>
                  <button
                    type="button"
                    className={styles.menuItem}
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenAttachmentPicker();
                    }}
                  >
                    첨부파일 선택
                  </button>
                  <button
                    type="button"
                    className={styles.menuItem}
                    onClick={() => {
                      setMenuOpen(false);
                      onTogglePlanMode();
                    }}
                  >
                    {thread.composerSettings.defaultMode === "plan" ? "플랜 모드 끄기" : "플랜 모드 켜기"}
                  </button>
                </div>
              ) : null}
            </div>

            <span className={styles.controlDivider} />

            <label className={styles.inlineControl}>
              <Icon name="spark" />
              <select
                className={styles.inlineSelect}
                value={thread.composerSettings.modelOverride || "__default__"}
                onChange={(event) => onModelChange(event.target.value === "__default__" ? null : event.target.value)}
              >
                <option value="__default__">기본값 ({thread.effectiveModel || "자동"})</option>
                {modelOptions.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
              <Icon name="chevronDown" />
            </label>

            <label className={styles.inlineControl}>
              <select
                className={styles.inlineSelect}
                value={selectedEffortValue}
                onChange={(event) => onEffortChange(event.target.value === "__default__" ? null : event.target.value)}
              >
                <option value="__default__">
                  기본값 ({thread.effectiveReasoningEffort || selectedModel?.defaultReasoningEffort || "자동"})
                </option>
                {(selectedModel?.supportedReasoningEfforts || []).map((effort) => (
                  <option key={effort} value={effort}>
                    {formatEffortLabel(effort)}
                  </option>
                ))}
              </select>
              <Icon name="chevronDown" />
            </label>

            {thread.composerSettings.defaultMode === "plan" ? (
              <>
                <span className={styles.controlDivider} />
                <button type="button" className={styles.planBadge} onClick={onTogglePlanMode}>
                  <Icon name="check" />
                  <span>플랜</span>
                </button>
              </>
            ) : null}
          </div>

          <div className={styles.composerActions}>
            <button type="button" className={styles.micButton} disabled aria-label="음성 입력 준비 중">
              <Icon name="mic" />
            </button>
            <Button
              type="button"
              className={styles.sendButton}
              onClick={thread.running ? onStop : onSubmit}
              disabled={stoppingThread || (submitting && !thread.running) || (!thread.running && !draft.trim() && !attachments.length)}
              aria-label={thread.running ? "중지" : submitting ? "전송 중" : "보내기"}
            >
              <Icon name={thread.running ? "stop" : "send"} />
            </Button>
          </div>
        </div>
      </div>

      <div className={styles.statusRow}>
        <div className={styles.statusGroup}>
          <button type="button" className={styles.statusControl} disabled>
            <Icon name="terminal" />
            <span>로컬</span>
            <Icon name="chevronDown" />
          </button>

          <label className={[styles.statusControl, styles.permissionControl].join(" ")}>
            <Icon name="shield" />
            <select
              className={styles.statusSelect}
              value={thread.composerSettings.permissionMode}
              onChange={(event) => onPermissionChange(event.target.value as "default" | "danger-full-access")}
            >
              <option value="default">기본권한</option>
              <option value="danger-full-access">전체 액세스</option>
            </select>
            <Icon name="chevronDown" />
          </label>
        </div>

        <div className={styles.statusGroup}>
          {gitState?.isRepo ? (
            <div className={styles.branchControls}>
              <label className={styles.statusControl}>
                <Icon name="branch" />
                <select
                  className={styles.statusSelect}
                  value={gitState.currentBranch || ""}
                  onChange={(event) => event.target.value && onBranchChange(event.target.value)}
                >
                  {(gitState.currentBranch && !gitState.branches.includes(gitState.currentBranch)
                    ? [gitState.currentBranch, ...gitState.branches]
                    : gitState.branches
                  ).map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
                </select>
                <Icon name="chevronDown" />
              </label>
              <button type="button" className={styles.branchCreateButton} onClick={onCreateBranch} aria-label="브랜치 생성">
                <Icon name="plus" />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
