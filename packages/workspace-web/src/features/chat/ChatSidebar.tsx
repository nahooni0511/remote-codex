import type { ProjectTreeRecord } from "@remote-codex/contracts";
import { Link, useNavigate } from "react-router-dom";

import { buildProjectPath, buildThreadPath } from "../../lib/routes";
import { isPlainLeftClick, navigateWithTransition } from "../../lib/navigation";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import styles from "./ChatSidebar.module.css";

export function ChatSidebar({
  projects,
  selectedProjectId,
  selectedThreadId,
  expandedProjectIds,
  onToggleProject,
  onCreateThread,
}: {
  projects: ProjectTreeRecord[];
  selectedProjectId: number | null;
  selectedThreadId: number | null;
  expandedProjectIds: Record<number, boolean>;
  onToggleProject: (projectId: number) => void;
  onCreateThread: (projectId: number) => void;
}) {
  const navigate = useNavigate();

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <div>
          <span className={styles.kicker}>Workspace</span>
          <h2>Projects</h2>
        </div>
        <Link
          to="/chat/projects/new"
          onClick={(event) => {
            if (!isPlainLeftClick(event)) {
              return;
            }
            event.preventDefault();
            navigateWithTransition(navigate, "/chat/projects/new");
          }}
        >
          <Button type="button" variant="icon" aria-label="새 프로젝트">
            <Icon name="plus" />
          </Button>
        </Link>
      </div>

      <div className={styles.projectList}>
        {projects.map((project) => {
          const expanded = expandedProjectIds[project.id] ?? project.id === selectedProjectId;
          return (
            <section key={project.id} className={styles.projectCard}>
              <div className={styles.projectHeader}>
                <button type="button" className={styles.toggle} onClick={() => onToggleProject(project.id)}>
                  {expanded ? "▾" : "▸"}
                </button>
                <Link
                  to={buildProjectPath(project.id)}
                  onClick={(event) => {
                    if (!isPlainLeftClick(event)) {
                      return;
                    }
                    event.preventDefault();
                    navigateWithTransition(navigate, buildProjectPath(project.id));
                  }}
                  className={[
                    styles.projectLink,
                    selectedProjectId === project.id && !selectedThreadId ? styles.projectLinkActive : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <Icon name="folder" />
                  <div className={styles.projectMeta}>
                    <strong>{project.name}</strong>
                    <span>{project.connection?.telegramChatTitle || project.folderPath}</span>
                  </div>
                </Link>
              </div>

              {expanded ? (
                <div className={styles.threadList}>
                  {project.threads.map((thread) => (
                    <Link
                      key={thread.id}
                      to={buildThreadPath(project.id, thread.id)}
                      onClick={(event) => {
                        if (!isPlainLeftClick(event)) {
                          return;
                        }
                        event.preventDefault();
                        navigateWithTransition(navigate, buildThreadPath(project.id, thread.id));
                      }}
                      className={[
                        styles.threadLink,
                        selectedThreadId === thread.id ? styles.threadLinkActive : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <span className={styles.threadDot} />
                      <span className={styles.threadTitle}>{thread.title}</span>
                    </Link>
                  ))}
                  <Button type="button" variant="ghost" className={styles.threadCreate} onClick={() => onCreateThread(project.id)}>
                    <Icon name="plus" />
                    새 thread
                  </Button>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
