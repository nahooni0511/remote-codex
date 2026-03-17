import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppContext } from "../app/AppProvider";
import { WorkspaceFrame } from "../components/layout/WorkspaceFrame";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { apiFetch } from "../lib/api/client";
import { formatRelativeTimeCompact, groupCronJobsByProjectAndThread, truncateText } from "../lib/chat";
import { navigateWithTransition } from "../lib/navigation";
import { buildThreadPath } from "../lib/routes";
import { getWorkspaceUserName } from "../lib/workspace";
import styles from "./CronPage.module.css";

type Notice = { tone: "error" | "success"; message: string } | null;

export function CronPage() {
  const navigate = useNavigate();
  const { bootstrap, loading, loadError, cronJobs, cronLoading, loadCronJobs } = useAppContext();
  const [notice, setNotice] = useState<Notice>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const loadCronJobsRef = useRef(loadCronJobs);

  useEffect(() => {
    loadCronJobsRef.current = loadCronJobs;
  }, [loadCronJobs]);

  const handleError = (error: unknown) => {
    setNotice({ tone: "error", message: error instanceof Error ? error.message : "Unexpected error" });
  };

  const refreshCronJobs = async () => {
    setNotice(null);
    try {
      await loadCronJobs();
    } catch (error) {
      handleError(error);
    }
  };

  const toggleJobEnabled = async (jobId: number, enabled: boolean) => {
    setNotice(null);
    try {
      await apiFetch(`/api/cron-jobs/${jobId}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !enabled }),
      });
      await loadCronJobs();
    } catch (error) {
      handleError(error);
    }
  };

  const deleteJob = async (jobId: number) => {
    const confirmed = window.confirm("이 cron job을 삭제할까요?");
    if (!confirmed) {
      return;
    }

    setNotice(null);
    try {
      await apiFetch(`/api/cron-jobs/${jobId}`, { method: "DELETE" });
      await loadCronJobs();
    } catch (error) {
      handleError(error);
    }
  };

  useEffect(() => {
    void loadCronJobsRef.current().catch((error: unknown) => {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Unexpected error" });
    });
  }, []);

  if (loading) {
    return <EmptyState title="Loading cron jobs" description="Workspace state is loading." />;
  }

  if (loadError) {
    return <EmptyState title="Cron jobs unavailable" description={loadError} />;
  }

  if (!bootstrap) {
    return <EmptyState title="Cron jobs unavailable" description="Bootstrap payload is missing." />;
  }

  const userName = getWorkspaceUserName(bootstrap);
  const groups = groupCronJobsByProjectAndThread(cronJobs, bootstrap.projects, deferredSearch);
  const activeJobs = cronJobs.filter((job) => job.enabled).length;
  const runningJobs = cronJobs.filter((job) => job.running).length;
  const showInitialLoading = cronLoading && cronJobs.length === 0;

  return (
    <WorkspaceFrame section="cron" userName={userName}>
      <section className={styles.page}>
        <header className={styles.hero}>
          <div>
            <span className={styles.kicker}>System Monitoring</span>
            <h1>Cron Jobs</h1>
            <p>Active tasks grouped by project and thread. Scan schedules and intervene without leaving the workspace.</p>
          </div>
          <div className={styles.heroActions}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search cron jobs..."
            />
            <Button type="button" variant="secondary" onClick={() => void refreshCronJobs()}>
              새로고침
            </Button>
          </div>
        </header>
        {notice ? <Banner tone={notice.tone}>{notice.message}</Banner> : null}
        {cronLoading && !showInitialLoading ? (
          <Banner tone="success">최신 cron 상태를 다시 불러오는 중입니다.</Banner>
        ) : null}

        <section className={styles.summaryGrid}>
          <article className={styles.summaryCard}>
            <span>Total Jobs</span>
            <strong>{cronJobs.length}</strong>
          </article>
          <article className={styles.summaryCard}>
            <span>Active</span>
            <strong>{activeJobs}</strong>
          </article>
          <article className={styles.summaryCard}>
            <span>Running</span>
            <strong>{runningJobs}</strong>
          </article>
        </section>

        {showInitialLoading ? (
          <EmptyState title="Loading cron jobs" description="The API server is returning current schedules." />
        ) : groups.length ? (
          <section className={styles.groupList}>
            {groups.map((project) => (
              <article key={project.projectId} className={styles.projectGroup}>
                <header className={styles.projectHeader}>
                  <h2>{project.projectName}</h2>
                </header>
                {project.threads.length ? (
                  project.threads.map((thread) => (
                    <section key={thread.threadId} className={styles.threadGroup}>
                      <div className={styles.threadHeader}>
                        <div>
                          <h3>{thread.threadTitle}</h3>
                          <p>{thread.jobs.length} jobs</p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => navigateWithTransition(navigate, buildThreadPath(project.projectId, thread.threadId))}
                        >
                          Open thread
                        </Button>
                      </div>
                      <div className={styles.jobList}>
                        {thread.jobs.map((job) => (
                          <article key={job.id} className={styles.jobCard}>
                            <div className={styles.jobMain}>
                              <div>
                                <strong>{job.name}</strong>
                                <p>
                                  {job.cronExpr} • {job.timezone || "Asia/Seoul"}
                                </p>
                              </div>
                              <span className={job.enabled ? styles.statusActive : styles.statusDisabled}>
                                {job.running ? "Running" : job.enabled ? "Active" : "Disabled"}
                              </span>
                            </div>
                            <p className={styles.promptPreview}>{truncateText(job.prompt, 120)}</p>
                            <div className={styles.jobFooter}>
                              <span>Next run {job.nextRunAt ? formatRelativeTimeCompact(job.nextRunAt) : "-"}</span>
                              <div className={styles.jobActions}>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => void toggleJobEnabled(job.id, job.enabled)}
                                >
                                  {job.enabled ? "Disable" : "Enable"}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => void deleteJob(job.id)}
                                >
                                  Delete
                                </Button>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  ))
                ) : (
                  <EmptyState title="No threads" description="No cron-enabled threads are active in this project." />
                )}
              </article>
            ))}
          </section>
        ) : (
          <EmptyState
            title="No cron jobs"
            description={search.trim() ? "No cron jobs match this search." : "No cron jobs are currently registered."}
          />
        )}
      </section>
    </WorkspaceFrame>
  );
}
