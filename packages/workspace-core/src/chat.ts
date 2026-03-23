import type {
  ChangedFileRecord,
  MessageRecord,
  ThreadStreamRealtimeEvent,
  UserInputQuestion,
  UserInputRequestPayload,
} from "@remote-codex/contracts";

export interface LiveStreamState {
  reasoningText: string;
  assistantText: string;
  planText: string;
}

export type ThreadMessagesMergeMode = "prepend" | "append";

export function mergeThreadMessages(
  existing: MessageRecord[],
  incoming: MessageRecord[],
  mode: ThreadMessagesMergeMode = "append",
): MessageRecord[] {
  const merged = mode === "prepend" ? [...incoming, ...existing] : [...existing, ...incoming];
  const deduped = new Map<number, MessageRecord>();
  merged.forEach((message) => {
    deduped.set(message.id, message);
  });

  return Array.from(deduped.values()).sort((left, right) => left.id - right.id);
}

export function applyThreadStreamEvent(
  current: LiveStreamState | null | undefined,
  event: ThreadStreamRealtimeEvent,
): LiveStreamState | null {
  if (event.type === "clear") {
    return null;
  }

  const next: LiveStreamState = current
    ? { ...current }
    : {
        reasoningText: "",
        assistantText: "",
        planText: "",
      };

  if (event.type === "reasoning-delta") {
    next.reasoningText += event.text || "";
  } else if (event.type === "reasoning-complete") {
    next.reasoningText = event.text || "";
  } else if (event.type === "assistant-delta") {
    next.assistantText += event.text || "";
  } else if (event.type === "assistant-complete" && event.phase !== "final_answer") {
    next.assistantText = event.text || "";
  } else if (event.type === "plan-updated") {
    const lines: string[] = [];
    if (event.explanation) {
      lines.push(event.explanation);
    }
    if (Array.isArray(event.plan) && event.plan.length) {
      if (lines.length) {
        lines.push("");
      }
      event.plan.forEach((step) => {
        lines.push(`- [${step.status}] ${step.step}`);
      });
    }
    next.planText = lines.join("\n").trim();
  }

  return next.reasoningText || next.assistantText || next.planText ? next : null;
}

export function shouldClearLiveStreamForMessages(messages: MessageRecord[], running: boolean): boolean {
  if (!running && messages.length > 0) {
    return true;
  }

  return messages.some(
    (message) =>
      message.role === "assistant" ||
      message.payload?.kind === "turn_summary" ||
      message.payload?.kind === "user_input_request",
  );
}

export function formatClockTime(value: string | null | undefined, locale = "ko-KR"): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatDurationMs(value: number | null | undefined): string {
  if (!value || value < 1000) {
    return "1초 미만";
  }

  const totalSeconds = Math.round(value / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}초`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}분 ${seconds}초` : `${minutes}분`;
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

export function summarizeChangedFile(file: ChangedFileRecord): string {
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

export function formatChangedFileDelta(file: ChangedFileRecord): string {
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

export function buildInitialSelections(request: UserInputRequestPayload): Record<string, string> {
  return Object.fromEntries(
    request.questions.map((question) => {
      const submittedValue = request.submittedAnswers?.[question.id]?.answers?.[0]?.trim() || "";
      if (!submittedValue) {
        return [question.id, ""];
      }

      const matchesOption = question.options.some((option) => option.label === submittedValue);
      return [question.id, matchesOption ? submittedValue : "__other__"];
    }),
  ) as Record<string, string>;
}

export function buildInitialOtherValues(request: UserInputRequestPayload): Record<string, string> {
  return Object.fromEntries(
    request.questions.map((question) => {
      const submittedValue = request.submittedAnswers?.[question.id]?.answers?.[0]?.trim() || "";
      const matchesOption = question.options.some((option) => option.label === submittedValue);
      return [question.id, submittedValue && !matchesOption ? submittedValue : ""];
    }),
  ) as Record<string, string>;
}

export function formatSubmittedAnswer(question: UserInputQuestion, request: UserInputRequestPayload): string | null {
  const value = request.submittedAnswers?.[question.id]?.answers?.[0]?.trim() || "";
  return value || null;
}
