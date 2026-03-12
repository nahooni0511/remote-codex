import type { ProjectTreeRecord } from "@remote-codex/contracts";

import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { FolderBrowser } from "../../components/ui/FolderBrowser";
import styles from "./ProjectPanel.module.css";

type Notice = { tone: "error" | "success"; message: string } | null;

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
  notice: Notice;
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
              ? "그룹 이름과 폴더 경로를 입력하면 Telegram forum supergroup을 자동으로 만들고 연결합니다."
              : "생성된 Telegram forum supergroup과 연결된 프로젝트 설정입니다."}
          </p>
        </div>
        {!isNew && project?.connection?.telegramChatTitle ? (
          <div className={styles.badge}>{project.connection.telegramChatTitle}</div>
        ) : null}
      </div>

      {notice ? <Banner tone={notice.tone}>{notice.message}</Banner> : null}

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>그룹 이름</span>
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
            <p>프로젝트에 새 Telegram topic과 Codex thread를 연결합니다.</p>
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
