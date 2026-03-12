import type { MessageRecord, ThreadListItem } from "@remote-codex/contracts";
import { useEffect, useRef } from "react";

import { buildAttachmentUrl } from "../../lib/api/client";
import { formatClockTime } from "../../lib/chat";
import type { LiveStreamState } from "../../lib/chat";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { RichText } from "../../components/ui/RichText";
import styles from "./ThreadPanel.module.css";

type Notice = { tone: "error" | "success"; message: string } | null;

function MessageAttachment({ message }: { message: MessageRecord }) {
  if (!message.attachmentKind) {
    return null;
  }

  const href = buildAttachmentUrl(message.id);
  if (message.attachmentKind === "image") {
    return <img className={styles.attachmentImage} src={href} alt={message.attachmentFilename || "attachment"} />;
  }

  return (
    <a className={styles.attachmentLink} href={href} target="_blank" rel="noreferrer">
      {message.attachmentFilename || "attachment"}
    </a>
  );
}

function MessageRow({ message, authUserName }: { message: MessageRecord; authUserName: string }) {
  const isUser = message.role === "user";
  const isCodexSystem = message.role === "system" && message.source === "codex";
  const isCronSystem = message.role === "system" && message.source === "cron";
  const showSender =
    message.source === "telegram" &&
    message.senderName &&
    message.senderName.trim() &&
    message.senderName !== authUserName;

  if (message.role === "system") {
    return (
      <article
        className={[
          styles.systemEntry,
          isCodexSystem ? styles.systemEntryProgress : "",
          isCronSystem ? styles.systemEntryCron : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <RichText text={message.content} className={styles.systemEntryBody} />
        <MessageAttachment message={message} />
      </article>
    );
  }

  return (
    <article className={[styles.chatRow, isUser ? styles.user : styles.assistant].join(" ")}>
      <div className={[styles.chatBubble, isUser ? styles.userBubble : styles.assistantBubble].join(" ")}>
        {showSender ? <div className={styles.caption}>{message.senderName}</div> : null}
        <RichText text={message.content} className={styles.richText} />
        <MessageAttachment message={message} />
      </div>
      <div className={styles.timestamp}>{formatClockTime(message.createdAt)}</div>
    </article>
  );
}

function LiveStream({ stream }: { stream: LiveStreamState | undefined }) {
  if (!stream) {
    return null;
  }

  return (
    <>
      {stream.planText ? (
        <article className={[styles.systemEntry, styles.systemEntryProgress].join(" ")}>
          <div className={styles.streamLabel}>Plan</div>
          <RichText text={stream.planText} className={styles.systemEntryBody} />
        </article>
      ) : null}
      {stream.reasoningText ? (
        <article className={[styles.systemEntry, styles.systemEntryProgress].join(" ")}>
          <div className={styles.streamLabel}>Thinking</div>
          <RichText text={stream.reasoningText} className={styles.systemEntryBody} />
        </article>
      ) : null}
      {stream.assistantText ? (
        <article className={[styles.chatRow, styles.assistant].join(" ")}>
          <div className={[styles.chatBubble, styles.assistantBubble].join(" ")}>
            <div className={styles.caption}>Codex</div>
            <RichText text={stream.assistantText} className={styles.richText} />
          </div>
          <div className={styles.timestamp}>실시간</div>
        </article>
      ) : null}
    </>
  );
}

export function ThreadPanel({
  thread,
  messages,
  hasMoreBefore,
  draft,
  submitting,
  notice,
  liveStream,
  authUserName,
  onDraftChange,
  onSubmit,
  onLoadMore,
  onBack,
  onReload,
}: {
  thread: ThreadListItem;
  messages: MessageRecord[];
  hasMoreBefore: boolean;
  draft: string;
  submitting: boolean;
  notice: Notice;
  liveStream: LiveStreamState | undefined;
  authUserName: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onLoadMore: () => void;
  onBack: () => void;
  onReload: () => void;
}) {
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = feedRef.current;
    if (!element) {
      return;
    }

    element.scrollTop = element.scrollHeight;
  }, [messages.length, liveStream?.assistantText, liveStream?.planText, liveStream?.reasoningText]);

  return (
    <section className={styles.panel}>
      <div className={styles.threadHeader}>
        <div>
          <span className={styles.kicker}>Thread</span>
          <h1>{thread.title}</h1>
        </div>
        <div className={styles.headerActions}>
          <Button type="button" variant="secondary" onClick={onBack}>
            프로젝트로
          </Button>
          <Button type="button" variant="ghost" onClick={onReload}>
            새로고침
          </Button>
        </div>
      </div>

      {notice ? <Banner tone={notice.tone}>{notice.message}</Banner> : null}

      <div className={styles.feed} ref={feedRef}>
        {hasMoreBefore ? (
          <div className={styles.loadMoreWrap}>
            <Button type="button" variant="secondary" onClick={onLoadMore}>
              이전 메시지 더보기
            </Button>
          </div>
        ) : null}

        {messages.length ? (
          messages.map((message) => <MessageRow key={message.id} message={message} authUserName={authUserName} />)
        ) : (
          <div className={styles.emptyFeed}>
            메시지가 없습니다. Telegram topic이나 아래 입력창에서 첫 메시지를 보내면 Codex 세션이 시작됩니다.
          </div>
        )}
        <LiveStream stream={liveStream} />
      </div>

      <div className={styles.composer}>
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder={`Message ${thread.effectiveModel || "Codex"}...`}
          rows={4}
        />
        <div className={styles.composerFooter}>
          <div className={styles.composerHint}>
            <Icon name="attachment" />
            <span>Artifacts and code blocks stream back through the thread.</span>
          </div>
          <Button type="button" onClick={onSubmit} disabled={!draft.trim() || submitting}>
            <Icon name="send" />
            {submitting ? "전송 중..." : "보내기"}
          </Button>
        </div>
      </div>
    </section>
  );
}
