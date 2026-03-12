import type { AppUpdateApplyResult, AppUpdateStatus } from "@remote-codex/contracts";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { useAppContext } from "../app/AppProvider";
import { WorkspaceFrame } from "../components/layout/WorkspaceFrame";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { apiFetch } from "../lib/api/client";
import { formatRelativeTime } from "../lib/chat";
import styles from "./ConfigPage.module.css";

type Notice = { tone: "error" | "success"; message: string } | null;

export function ConfigPage() {
  const { bootstrap, loading, loadError, refreshBootstrap } = useAppContext();
  const [notice, setNotice] = useState<Notice>(null);
  const [draft, setDraft] = useState({
    responseLanguage: "",
    defaultModel: "",
    defaultReasoningEffort: "",
  });
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | AppUpdateApplyResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    setDraft({
      responseLanguage: bootstrap.settings.codexResponseLanguage || "",
      defaultModel: bootstrap.settings.codexDefaultModel || "",
      defaultReasoningEffort: bootstrap.settings.codexDefaultReasoningEffort || "",
    });
  }, [bootstrap]);

  if (loading) {
    return <EmptyState title="Loading configuration" description="Workspace settings are loading." />;
  }

  if (loadError) {
    return <EmptyState title="Configuration unavailable" description={loadError} />;
  }

  if (!bootstrap?.setupComplete) {
    return <Navigate to="/setup" replace />;
  }

  const userName = bootstrap.auth.userName || bootstrap.settings.telegramUserName || "User";
  const currentVersion = bootstrap.runtime.appVersion || "0.0.0";

  return (
    <WorkspaceFrame section="config" userName={userName}>
      <section className={styles.page}>
        <header className={styles.hero}>
          <span className={styles.kicker}>System Settings</span>
          <h1>Configuration</h1>
          <p>Manage runtime preferences, setup credentials, and deployment update state.</p>
        </header>

        {notice ? <Banner tone={notice.tone}>{notice.message}</Banner> : null}

        <section className={styles.grid}>
          <article className={styles.card}>
            <h2>Setup Credentials</h2>
            <div className={styles.readonlyGrid}>
              {[
                ["Telegram API ID", bootstrap.settings.telegramApiId],
                ["Telegram API Hash", bootstrap.settings.telegramApiHash],
                ["Phone Number", bootstrap.settings.telegramPhoneNumber],
                ["Bot Token", bootstrap.settings.telegramBotToken],
                ["Telegram User Name", bootstrap.settings.telegramUserName],
                ["Bot User Name", bootstrap.settings.telegramBotUserName],
              ].map(([label, value]) => (
                <label key={label} className={styles.field}>
                  <span>{label}</span>
                  <input readOnly value={value} />
                </label>
              ))}
            </div>
          </article>

          <article className={styles.card}>
            <h2>Model Preferences</h2>
            <div className={styles.formStack}>
              <label className={styles.field}>
                <span>Response Language</span>
                <select
                  value={draft.responseLanguage}
                  onChange={(event) => setDraft((current) => ({ ...current, responseLanguage: event.target.value }))}
                >
                  {(bootstrap.configOptions.responseLanguages || []).map((option) => (
                    <option key={`${option.value}-${option.label}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Default Model</span>
                <select
                  value={draft.defaultModel}
                  onChange={(event) => setDraft((current) => ({ ...current, defaultModel: event.target.value }))}
                >
                  <option value="">비워두기</option>
                  {(bootstrap.configOptions.defaultModels || []).map((option) => (
                    <option key={`${option.value}-${option.label}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Default Model Reasoning Effort</span>
                <select
                  value={draft.defaultReasoningEffort}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, defaultReasoningEffort: event.target.value }))
                  }
                >
                  <option value="">비워두기</option>
                  <option value="minimal">minimal</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="xhigh">xhigh</option>
                </select>
              </label>
            </div>

            <div className={styles.actions}>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setDraft({
                    responseLanguage: bootstrap.settings.codexResponseLanguage || "",
                    defaultModel: bootstrap.settings.codexDefaultModel || "",
                    defaultReasoningEffort: bootstrap.settings.codexDefaultReasoningEffort || "",
                  })
                }
              >
                Discard
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setNotice(null);
                  void apiFetch("/api/settings/codex", {
                    method: "PUT",
                    body: JSON.stringify(draft),
                  })
                    .then(async () => {
                      await refreshBootstrap();
                      setNotice({ tone: "success", message: "설정을 저장했습니다." });
                    })
                    .catch((error: Error) => {
                      setNotice({ tone: "error", message: error.message });
                    });
                }}
              >
                Apply Configuration
              </Button>
            </div>
          </article>

          <article className={styles.card}>
            <h2>Version &amp; Updates</h2>
            <p className={styles.cardMeta}>Current version v{currentVersion}</p>
            <p className={styles.cardMeta}>
              마지막 확인 {updateStatus?.checkedAt ? formatRelativeTime(updateStatus.checkedAt) : "아직 확인 안 함"}
            </p>
            {updateStatus ? (
              <div className={styles.updateStatus}>
                <strong>{updateStatus.updateAvailable ? "업데이트 가능" : "최신 상태"}</strong>
                <span>{updateStatus.reason || `tracking ${updateStatus.upstreamBranch || "-"}`}</span>
              </div>
            ) : null}
            <div className={styles.actions}>
              <Button
                type="button"
                variant="secondary"
                disabled={checkingUpdate}
                onClick={() => {
                  setCheckingUpdate(true);
                  setNotice(null);
                  void apiFetch<AppUpdateStatus>("/api/system/update/check", { method: "POST" })
                    .then((result) => {
                      setUpdateStatus(result);
                    })
                    .catch((error: Error) => {
                      setNotice({ tone: "error", message: error.message });
                    })
                    .finally(() => {
                      setCheckingUpdate(false);
                    });
                }}
              >
                {checkingUpdate ? "Checking..." : "Check for Updates"}
              </Button>
              <Button
                type="button"
                disabled={applyingUpdate || !updateStatus?.canApply}
                onClick={() => {
                  const confirmed = window.confirm(
                    "원격 브랜치에서 최신 코드를 가져와 fast-forward 업데이트와 빌드를 진행할까요?",
                  );
                  if (!confirmed) {
                    return;
                  }

                  setApplyingUpdate(true);
                  setNotice(null);
                  void apiFetch<AppUpdateApplyResult>("/api/system/update/apply", { method: "POST" })
                    .then(async (result) => {
                      setUpdateStatus(result);
                      await refreshBootstrap();
                    })
                    .catch((error: Error) => {
                      setNotice({ tone: "error", message: error.message });
                    })
                    .finally(() => {
                      setApplyingUpdate(false);
                    });
                }}
              >
                {applyingUpdate ? "Updating..." : "Update Now"}
              </Button>
            </div>
          </article>

          <article className={styles.card}>
            <h2>Danger Zone</h2>
            <p className={styles.cardMeta}>
              응답 언어, 기본 모델, reasoning effort와 setup 때 저장한 Telegram 인증 정보를 모두 지웁니다.
            </p>
            <Button
              type="button"
              variant="ghost"
              disabled={resetting}
              onClick={() => {
                const confirmed = window.confirm(
                  "Codex 기본 설정과 setup에 저장된 Telegram 인증 정보를 초기화할까요?",
                );
                if (!confirmed) {
                  return;
                }

                setResetting(true);
                void apiFetch("/api/settings/codex/reset", { method: "POST" })
                  .then(async () => {
                    await refreshBootstrap();
                    setNotice({
                      tone: "success",
                      message: "setup 정보를 포함한 전체 설정을 초기화했습니다. 다시 Telegram 연결을 진행하세요.",
                    });
                  })
                  .catch((error: Error) => {
                    setNotice({ tone: "error", message: error.message });
                  })
                  .finally(() => {
                    setResetting(false);
                  });
              }}
            >
              {resetting ? "Resetting..." : "Reset All Settings"}
            </Button>
          </article>
        </section>
      </section>
    </WorkspaceFrame>
  );
}
