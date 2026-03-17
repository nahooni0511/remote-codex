import type {
  ComposerAttachmentRecord,
  ComposerModelOption,
  MessageRecord,
  ProjectGitState,
  ThreadListItem,
  UserInputAnswers,
} from "@remote-codex/contracts";

import { ThreadPanel } from "../../features/chat/ThreadPanel";
import type { ChatNotice } from "../../features/chat/notice";
import type { LiveStreamState } from "../../lib/chat";

export function ThreadChatView({
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
  return (
    <ThreadPanel
      thread={thread}
      messages={messages}
      hasMoreBefore={hasMoreBefore}
      draft={draft}
      submitting={submitting}
      notice={notice}
      liveStream={liveStream}
      authUserName={authUserName}
      modelOptions={modelOptions}
      gitState={gitState}
      attachments={attachments}
      undoingTurnRunId={undoingTurnRunId}
      respondingUserInputRequestId={respondingUserInputRequestId}
      stoppingThread={stoppingThread}
      onDraftChange={onDraftChange}
      onSubmit={onSubmit}
      onStop={onStop}
      onLoadMore={onLoadMore}
      onTogglePlanMode={onTogglePlanMode}
      onModelChange={onModelChange}
      onEffortChange={onEffortChange}
      onPermissionChange={onPermissionChange}
      onBranchChange={onBranchChange}
      onCreateBranch={onCreateBranch}
      onOpenAttachmentPicker={onOpenAttachmentPicker}
      onRemoveAttachment={onRemoveAttachment}
      onUndoTurn={onUndoTurn}
      onSubmitUserInputRequest={onSubmitUserInputRequest}
      onCancelUserInputRequest={onCancelUserInputRequest}
    />
  );
}
