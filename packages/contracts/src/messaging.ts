import type { ChannelKind } from "./core";

export type MessageEventKind =
  | "user_message"
  | "assistant_message"
  | "system_message"
  | "progress_event"
  | "plan_event"
  | "artifact_event"
  | "cron_event"
  | "error_event"
  | "turn_summary_event";

export type DeliveryStatus = "pending" | "delivered" | "failed" | "skipped";

export type TurnUndoState = "available" | "blocked" | "undone" | "not_available";

export interface MessageDisplayHints {
  hideOrigin: boolean;
  accent: "default" | "progress" | "cron" | "error";
  localSenderName: string | null;
  telegramSenderName: string | null;
}

export interface ComposerAttachmentRecord {
  id: string;
  name: string;
  path: string;
  relativePath: string | null;
  source: "project-file" | "uploaded-file";
  mimeType: string | null;
}

export interface ChangedFileRecord {
  path: string;
  status: string;
  insertions: number | null;
  deletions: number | null;
  isUntracked: boolean;
  statsExact: boolean;
}

export interface UserInputRequestOption {
  label: string;
  description: string;
}

export interface UserInputQuestion {
  id: string;
  header: string;
  question: string;
  options: UserInputRequestOption[];
  isOther: boolean;
  isSecret: boolean;
}

export interface UserInputAnswer {
  answers: string[];
}

export type UserInputAnswers = Record<string, UserInputAnswer>;

export type UserInputRequestStatus = "pending" | "submitted" | "resolved";

export interface UserInputRequestPayload {
  requestId: string;
  turnId: string | null;
  itemId: string | null;
  status: UserInputRequestStatus;
  questions: UserInputQuestion[];
  submittedAnswers: UserInputAnswers | null;
}

export interface TurnSummaryPayload {
  turnRunId: number;
  durationMs: number;
  changedFileCount: number;
  changedFiles: ChangedFileRecord[];
  exploredFilesCount: number | null;
  undoAvailable: boolean;
  undoState: TurnUndoState;
  branch: string | null;
  repoCleanAtStart: boolean;
  note: string | null;
}

export type MessageEventPayload =
  | {
      kind: "turn_summary";
      summary: TurnSummaryPayload;
    }
  | {
      kind: "user_input_request";
      request: UserInputRequestPayload;
    }
  | {
      kind: "attachments";
      attachments: ComposerAttachmentRecord[];
    }
  | null;

export interface MessageEventRecord {
  id: number;
  threadId: number;
  kind: MessageEventKind;
  role: string;
  content: string;
  originChannel: ChannelKind;
  originActor: string | null;
  displayHints: MessageDisplayHints;
  errorText: string | null;
  attachmentKind: string | null;
  attachmentMimeType: string | null;
  attachmentFilename: string | null;
  payload: MessageEventPayload;
  createdAt: string;
}

export interface MessageEventDeliveryRecord {
  id: number;
  eventId: number;
  channel: ChannelKind;
  status: DeliveryStatus;
  detail: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MessageRecord = MessageEventRecord;
