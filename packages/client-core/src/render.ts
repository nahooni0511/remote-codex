import type { ChannelKind, MessageEventRecord } from "@remote-codex/contracts";

export interface RenderedMessageEvent {
  senderLabel: string | null;
  showSender: boolean;
  isSystem: boolean;
  isProgress: boolean;
  isCron: boolean;
  isError: boolean;
  content: string;
}

function normalizeRenderedContent(event: MessageEventRecord): string {
  if (event.displayHints.accent !== "progress") {
    return event.content;
  }

  return event.content.replace(/^Codex 진행:\s*/u, "").replace(/^Codex 진행\s*\n\s*\n/u, "");
}

export function renderEventForChannel(
  channel: ChannelKind,
  event: MessageEventRecord,
  authUserName?: string | null,
): RenderedMessageEvent {
  const hintSender =
    channel === "telegram" ? event.displayHints.telegramSenderName : event.displayHints.localSenderName;
  const senderLabel = hintSender || event.originActor || null;
  const showSender = Boolean(
    senderLabel &&
      event.role !== "system" &&
      event.role !== "assistant" &&
      senderLabel.trim() &&
      (!authUserName || senderLabel !== authUserName),
  );

  return {
    senderLabel,
    showSender,
    isSystem: event.role === "system",
    isProgress: event.displayHints.accent === "progress",
    isCron: event.displayHints.accent === "cron",
    isError: event.displayHints.accent === "error",
    content: normalizeRenderedContent(event),
  };
}
