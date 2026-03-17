import type {
  ChangedFileRecord,
  ComposerAttachmentRecord,
  MessageRecord,
  TurnSummaryPayload,
  UserInputAnswers,
  UserInputQuestion,
  UserInputRequestPayload,
} from "@remote-codex/contracts";
import { renderEventForChannel } from "@remote-codex/client-core";
import { useEffect, useState } from "react";

import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { RichText } from "../../components/ui/RichText";
import { fetchAttachmentBlob } from "../../lib/api/client";
import { formatClockTime, formatDurationMs, type LiveStreamState } from "../../lib/chat";
import styles from "./ThreadPanel.module.css";

function MessageAttachment({ message }: { message: MessageRecord }) {
  if (!message.attachmentKind) {
    return null;
  }

  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    void fetchAttachmentBlob(message.id)
      .then(({ blob }) => {
        if (cancelled) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setAttachmentUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setAttachmentUrl(null);
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [message.id]);

  if (!attachmentUrl) {
    return null;
  }

  if (message.attachmentKind === "image") {
    return (
      <img
        className={styles.attachmentImage}
        src={attachmentUrl}
        alt={message.attachmentFilename || "attachment"}
      />
    );
  }

  return (
    <a className={styles.attachmentLink} href={attachmentUrl} target="_blank" rel="noreferrer">
      {message.attachmentFilename || "attachment"}
    </a>
  );
}

export function AttachmentChips({
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
    <div className={styles.attachmentChips}>
      {attachments.map((attachment) => (
        <span key={attachment.id} className={styles.attachmentChip}>
          <Icon name="attachment" />
          <span>{attachment.relativePath || attachment.name}</span>
          {removable && onRemove ? (
            <button type="button" className={styles.attachmentChipRemove} onClick={() => onRemove(attachment.id)}>
              ×
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}

export function formatEffortLabel(effort: string | null | undefined): string {
  if (!effort) {
    return "자동";
  }

  if (effort === "minimal") {
    return "최소";
  }
  if (effort === "low") {
    return "낮음";
  }
  if (effort === "medium") {
    return "보통";
  }
  if (effort === "high") {
    return "높음";
  }
  if (effort === "xhigh") {
    return "매우 높음";
  }

  return effort;
}

function summarizeFileChange(file: ChangedFileRecord): string {
  if (file.isUntracked || file.status === "??") {
    return "추가함";
  }
  if (file.status.includes("D")) {
    return "삭제함";
  }
  if (file.status.includes("R")) {
    return "이동함";
  }
  return "편집함";
}

function formatFileDelta(file: ChangedFileRecord): string {
  if (file.insertions === null && file.deletions === null) {
    return "";
  }

  const parts: string[] = [];
  if (file.insertions !== null) {
    parts.push(`+${file.insertions}`);
  }
  if (file.deletions !== null) {
    parts.push(`-${file.deletions}`);
  }

  return parts.join(" ");
}

function TurnSummaryCard({
  summary,
  enabledUndo,
  undoing,
  onUndo,
}: {
  summary: TurnSummaryPayload;
  enabledUndo: boolean;
  undoing: boolean;
  onUndo: (turnRunId: number) => void;
}) {
  return (
    <article className={styles.summaryCard}>
      <div className={styles.summaryHeader}>
        <strong>
          {summary.changedFileCount > 0 ? `${summary.changedFileCount}개 파일 변경됨` : "Codex 작업 요약"}
        </strong>
        {enabledUndo ? (
          <Button type="button" variant="secondary" onClick={() => onUndo(summary.turnRunId)} disabled={undoing}>
            {undoing ? "실행취소 중..." : "실행취소"}
          </Button>
        ) : null}
      </div>

      <div className={styles.summaryMeta}>
        <span>{formatDurationMs(summary.durationMs)} 동안 작업</span>
        {summary.exploredFilesCount ? <span>{summary.exploredFilesCount}개의 파일 탐색 마침</span> : null}
        {summary.branch ? <span>{summary.branch}</span> : null}
      </div>

      {summary.note ? <div className={styles.summaryNote}>{summary.note}</div> : null}

      {summary.changedFiles.length ? (
        <div className={styles.summaryFiles}>
          {summary.changedFiles.map((file) => {
            const delta = formatFileDelta(file);
            return (
              <div key={`${file.path}:${file.status}`} className={styles.summaryFileRow}>
                <span>
                  {summarizeFileChange(file)} {file.path}
                </span>
                {delta ? <span className={styles.summaryDelta}>{delta}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {!enabledUndo && summary.undoState === "undone" ? (
        <div className={styles.summaryState}>실행취소됨</div>
      ) : null}
      {!enabledUndo && summary.undoState === "blocked" ? (
        <div className={styles.summaryState}>현재 상태에서는 실행취소할 수 없음</div>
      ) : null}
    </article>
  );
}

function buildInitialSelections(request: UserInputRequestPayload): Record<string, string> {
  const entries = request.questions.map((question) => {
    const submittedValue = request.submittedAnswers?.[question.id]?.answers?.[0]?.trim() || "";
    if (!submittedValue) {
      return [question.id, ""];
    }

    const matchesOption = question.options.some((option) => option.label === submittedValue);
    return [question.id, matchesOption ? submittedValue : "__other__"];
  });

  return Object.fromEntries(entries);
}

function buildInitialOtherValues(request: UserInputRequestPayload): Record<string, string> {
  const entries = request.questions.map((question) => {
    const submittedValue = request.submittedAnswers?.[question.id]?.answers?.[0]?.trim() || "";
    const matchesOption = question.options.some((option) => option.label === submittedValue);
    return [question.id, submittedValue && !matchesOption ? submittedValue : ""];
  });

  return Object.fromEntries(entries);
}

function formatSubmittedAnswer(question: UserInputQuestion, request: UserInputRequestPayload): string | null {
  const value = request.submittedAnswers?.[question.id]?.answers?.[0]?.trim() || "";
  return value || null;
}

function UserInputRequestCard({
  request,
  respondingRequestId,
  stopping,
  onSubmit,
  onCancel,
}: {
  request: UserInputRequestPayload;
  respondingRequestId: string | null;
  stopping: boolean;
  onSubmit: (requestId: string, answers: UserInputAnswers) => void;
  onCancel: (requestId: string) => void;
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
    <article className={styles.userInputCard}>
      <div className={styles.userInputHeader}>
        <strong>Codex가 선택을 요청했습니다</strong>
        <span className={styles.userInputState}>
          {request.status === "resolved" ? "처리 완료" : request.status === "submitted" ? "제출됨" : "대기 중"}
        </span>
      </div>

      <div className={styles.userInputQuestions}>
        {request.questions.map((question) => (
          <section key={question.id} className={styles.userInputQuestion}>
            {question.header ? <div className={styles.userInputQuestionHeader}>{question.header}</div> : null}
            <div className={styles.userInputQuestionText}>{question.question}</div>

            <div className={styles.userInputOptions}>
              {question.options.map((option) => {
                const selected = selectedAnswers[question.id] === option.label;
                return (
                  <button
                    key={option.label}
                    type="button"
                    className={[styles.userInputOption, selected ? styles.userInputOptionSelected : ""].join(" ")}
                    onClick={() =>
                      setSelectedAnswers((current) => ({
                        ...current,
                        [question.id]: option.label,
                      }))
                    }
                    disabled={isLocked || isSubmitting}
                  >
                    <span className={styles.userInputOptionLabel}>{option.label}</span>
                    {option.description ? <span className={styles.userInputOptionDescription}>{option.description}</span> : null}
                  </button>
                );
              })}

              {question.isOther ? (
                <div className={styles.userInputOtherWrap}>
                  <button
                    type="button"
                    className={[
                      styles.userInputOption,
                      selectedAnswers[question.id] === "__other__" ? styles.userInputOptionSelected : "",
                    ].join(" ")}
                    onClick={() =>
                      setSelectedAnswers((current) => ({
                        ...current,
                        [question.id]: "__other__",
                      }))
                    }
                    disabled={isLocked || isSubmitting}
                  >
                    <span className={styles.userInputOptionLabel}>직접 입력</span>
                  </button>
                  {selectedAnswers[question.id] === "__other__" ? (
                    <input
                      className={styles.userInputOtherInput}
                      type={question.isSecret ? "password" : "text"}
                      value={otherAnswers[question.id] || ""}
                      onChange={(event) =>
                        setOtherAnswers((current) => ({
                          ...current,
                          [question.id]: event.target.value,
                        }))
                      }
                      disabled={isLocked || isSubmitting}
                      placeholder="직접 입력"
                    />
                  ) : null}
                </div>
              ) : null}
            </div>

            {request.status !== "pending" ? (
              <div className={styles.userInputAnswerSummary}>
                선택: {formatSubmittedAnswer(question, request) || "응답 없음"}
              </div>
            ) : null}
          </section>
        ))}
      </div>

      {request.status === "pending" ? (
        <div className={styles.userInputActions}>
          <Button
            type="button"
            variant="ghost"
            disabled={isSubmitting || stopping}
            onClick={() => onCancel(request.requestId)}
          >
            {stopping ? "취소 중..." : "취소"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!canSubmit || isSubmitting || stopping}
            onClick={() => {
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
          >
            {isSubmitting ? "제출 중..." : "선택 제출"}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

export function MessageRow({
  message,
  authUserName,
  latestUndoableTurnRunId,
  undoingTurnRunId,
  stoppingThread,
  onUndoTurn,
  respondingUserInputRequestId,
  onSubmitUserInputRequest,
  onCancelUserInputRequest,
}: {
  message: MessageRecord;
  authUserName: string;
  latestUndoableTurnRunId: number | null;
  undoingTurnRunId: number | null;
  stoppingThread: boolean;
  onUndoTurn: (turnRunId: number) => void;
  respondingUserInputRequestId: string | null;
  onSubmitUserInputRequest: (requestId: string, answers: UserInputAnswers) => void;
  onCancelUserInputRequest: (requestId: string) => void;
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
      <div className={styles.summaryRow}>
        <TurnSummaryCard
          summary={summary}
          enabledUndo={enabledUndo}
          undoing={undoingTurnRunId === summary.turnRunId}
          onUndo={onUndoTurn}
        />
      </div>
    );
  }

  if (message.payload?.kind === "user_input_request") {
    return (
      <div className={styles.summaryRow}>
        <UserInputRequestCard
          request={message.payload.request}
          respondingRequestId={respondingUserInputRequestId}
          stopping={stoppingThread}
          onSubmit={onSubmitUserInputRequest}
          onCancel={onCancelUserInputRequest}
        />
      </div>
    );
  }

  if (rendered.isSystem) {
    return (
      <article
        className={[
          styles.codexEntry,
          rendered.isProgress ? styles.systemEntryProgress : "",
          rendered.isCron ? styles.systemEntryCron : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <RichText
          text={rendered.content}
          className={[styles.codexBody, rendered.isProgress ? styles.systemEntryBodyProgress : ""].join(" ")}
        />
        <MessageAttachment message={message} />
      </article>
    );
  }

  if (!isUser) {
    return (
      <article className={styles.codexEntry}>
        <div className={styles.codexBody}>
          {rendered.showSender ? <div className={styles.caption}>{rendered.senderLabel}</div> : null}
          {rendered.content ? <RichText text={rendered.content} className={styles.richText} /> : null}
          <AttachmentChips attachments={attachmentPayload} />
          <MessageAttachment message={message} />
        </div>
      </article>
    );
  }

  return (
    <article className={[styles.chatRow, styles.user].join(" ")}>
      <div className={[styles.chatBubble, styles.userBubble].join(" ")}>
        {rendered.showSender ? <div className={styles.caption}>{rendered.senderLabel}</div> : null}
        {rendered.content ? <RichText text={rendered.content} className={styles.richText} /> : null}
        <AttachmentChips attachments={attachmentPayload} />
        <MessageAttachment message={message} />
      </div>
      <div className={styles.timestamp}>{formatClockTime(message.createdAt)}</div>
    </article>
  );
}

export function LiveStream({ stream }: { stream: LiveStreamState | undefined }) {
  if (!stream) {
    return null;
  }

  return (
    <>
      {stream.planText ? (
        <article className={[styles.codexEntry, styles.systemEntryProgress].join(" ")}>
          <div className={styles.streamLabel}>Plan</div>
          <RichText text={stream.planText} className={[styles.codexBody, styles.systemEntryBodyProgress].join(" ")} />
        </article>
      ) : null}
      {stream.reasoningText ? (
        <article className={[styles.codexEntry, styles.systemEntryProgress].join(" ")}>
          <div className={styles.streamLabel}>Thinking</div>
          <RichText
            text={stream.reasoningText}
            className={[styles.codexBody, styles.systemEntryBodyProgress].join(" ")}
          />
        </article>
      ) : null}
      {stream.assistantText ? (
        <article className={styles.codexEntry}>
          <div className={styles.codexBody}>
            <RichText text={stream.assistantText} className={styles.richText} />
          </div>
        </article>
      ) : null}
    </>
  );
}
