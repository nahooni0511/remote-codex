import type { ProjectTreeRecord } from "@remote-codex/contracts";

import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { FolderBrowser } from "../../components/ui/FolderBrowser";
import type { ChatNotice } from "./notice";
import styles from "./ProjectPanel.module.css";

export function ProjectPanel({
  project,
  isNew,
  draft,
  onDraftChange,
  onSave,
  onCancel,
  onDelete,
  onCreateThread,
  notice,
  headerAside,
  folderBrowserOpen,
  onOpenFolderBrowser,
  onCloseFolderBrowser,
}: {
  project: ProjectTreeRecord | null;
  isNew: boolean;
  draft: { name: string; folderPath: string };
  onDraftChange: (next: { name: string; folderPath: string }) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onCreateThread: () => void;
  notice: ChatNotice;
  headerAside?: React.ReactNode;
  folderBrowserOpen: boolean;
  onOpenFolderBrowser: () => void;
  onCloseFolderBrowser: () => void;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <span className={styles.kicker}>{isNew ? "New Project" : "Project"}</span>
          <h1>{isNew ? "새 project 만들기" : project?.name || "Project"}</h1>
          <p>
            {isNew
              ? "프로젝트 이름과 로컬 폴더를 등록합니다. Telegram 연동은 이후 선택적으로 추가할 수 있습니다."
              : "로컬 프로젝트 설정입니다. Telegram 연동은 선택 사항입니다."}
          </p>
        </div>
        {headerAside || (!isNew && project?.connection?.telegramChatTitle) ? (
          <div className={styles.headerAside}>
            {headerAside}
            {!isNew && project?.connection?.telegramChatTitle ? (
              <div className={styles.badge}>{project.connection.telegramChatTitle}</div>
            ) : null}
          </div>
        ) : null}
      </div>

      {notice ? <Banner tone={notice.tone}>{notice.message}</Banner> : null}

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>프로젝트 이름</span>
          <input
            value={draft.name}
            onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
            readOnly={!isNew}
            placeholder="예: Remote Codex"
          />
        </label>

        <label className={styles.field}>
          <div className={styles.fieldRow}>
            <span>로컬 폴더 경로</span>
            <Button type="button" variant="secondary" onClick={onOpenFolderBrowser}>
              폴더 탐색
            </Button>
          </div>
          <input
            value={draft.folderPath}
            onChange={(event) => onDraftChange({ ...draft, folderPath: event.target.value })}
            placeholder="/absolute/path"
          />
        </label>

        {!isNew && project?.connection?.telegramChatTitle ? (
          <div className={styles.note}>
            <strong>Telegram 그룹</strong>
            <span>{project.connection.telegramChatTitle}</span>
          </div>
        ) : null}
      </div>

      <div className={styles.actions}>
        <Button type="button" onClick={onSave}>
          {isNew ? "project 생성" : "저장"}
        </Button>
        {isNew ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            취소
          </Button>
        ) : (
          <Button type="button" variant="ghost" onClick={onDelete}>
            project 삭제
          </Button>
        )}
      </div>

      {!isNew ? (
        <div className={styles.section}>
          <div>
            <span className={styles.kicker}>Thread</span>
            <h2>새 thread 만들기</h2>
            <p>프로젝트에 새 Codex thread를 추가합니다. Telegram topic은 연동된 경우에만 생성됩니다.</p>
          </div>
          <Button type="button" onClick={onCreateThread}>
            새 thread 생성
          </Button>
        </div>
      ) : null}

      <FolderBrowser
        open={folderBrowserOpen}
        selectedPath={draft.folderPath}
        onClose={onCloseFolderBrowser}
        onSelect={(folderPath) => onDraftChange({ ...draft, folderPath })}
      />
    </section>
  );
}
