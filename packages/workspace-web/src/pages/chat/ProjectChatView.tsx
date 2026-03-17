import type { ProjectTreeRecord } from "@remote-codex/contracts";

import { ProjectPanel } from "../../features/chat/ProjectPanel";
import type { ChatNotice } from "../../features/chat/notice";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";

export function ProjectChatView({
  project,
  isNew,
  draft,
  notice,
  folderBrowserOpen,
  onDraftChange,
  onOpenFolderBrowser,
  onCloseFolderBrowser,
  onSave,
  onCancel,
  onDelete,
  onCreateThread,
  onToggleSidebar,
}: {
  project: ProjectTreeRecord | null;
  isNew: boolean;
  draft: { name: string; folderPath: string };
  notice: ChatNotice;
  folderBrowserOpen: boolean;
  onDraftChange: (next: { name: string; folderPath: string }) => void;
  onOpenFolderBrowser: () => void;
  onCloseFolderBrowser: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onCreateThread: () => void;
  onToggleSidebar: () => void;
}) {
  return (
    <ProjectPanel
      project={project}
      isNew={isNew}
      draft={draft}
      notice={notice}
      folderBrowserOpen={folderBrowserOpen}
      headerAside={
        <Button type="button" variant="icon" onClick={onToggleSidebar} aria-label="메뉴">
          <Icon name="menu" />
        </Button>
      }
      onDraftChange={onDraftChange}
      onOpenFolderBrowser={onOpenFolderBrowser}
      onCloseFolderBrowser={onCloseFolderBrowser}
      onSave={onSave}
      onCancel={onCancel}
      onDelete={onDelete}
      onCreateThread={onCreateThread}
    />
  );
}
