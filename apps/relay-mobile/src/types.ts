import type {
  ComposerAttachmentRecord,
  ComposerModelOption,
  MessageRecord,
  ProjectTreeRecord,
  ThreadComposerSettings,
  ThreadListItem,
  ThreadLiveStreamSnapshot,
} from "@remote-codex/contracts";

export type WorkspaceProject = ProjectTreeRecord;
export type WorkspaceThread = ThreadListItem;
export type WorkspaceThreadMessage = MessageRecord;

export type WorkspaceThreadSnapshot = {
  thread: WorkspaceThread | null;
  messages: WorkspaceThreadMessage[];
  hasMoreBefore: boolean;
  liveStream: ThreadLiveStreamSnapshot | null;
};

export type WorkspaceAttachmentPreview = {
  kind: string;
  fileName: string | null;
  contentType: string;
  uri: string | null;
};

export type WorkspaceComposerSettings = ThreadComposerSettings;
export type WorkspaceComposerAttachment = ComposerAttachmentRecord;
export type WorkspaceModelOption = ComposerModelOption;
