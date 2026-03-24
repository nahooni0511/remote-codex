import {
  type AppBootstrap,
  type AppUpdateApplyResult,
  type AppUpdateStatus,
  isLoopbackHost,
  normalizeRelayServerUrl,
} from "@remote-codex/contracts";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useAppContext } from "../app/AppProvider";
import { WorkspaceFrame } from "../components/layout/WorkspaceFrame";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { apiFetch } from "../lib/api/client";
import { formatRelativeTime } from "../lib/chat";
import { getSetupPath } from "../lib/routes";
import { getWorkspaceUserName } from "../lib/workspace";
import styles from "./ConfigPage.module.css";

type Notice = { tone: "error" | "success"; message: string } | null;

const PROD_RELAY_SERVER_URL = "https://relay.remote-codex.com";
const LOCAL_RELAY_SERVER_URL = "http://localhost:3100";

function getDefaultRelayServerUrl(): string {
  if (typeof window !== "undefined" && isLoopbackHost(window.location.hostname)) {
    return LOCAL_RELAY_SERVER_URL;
  }

  return PROD_RELAY_SERVER_URL;
}

function createDraft(bootstrap: AppBootstrap) {
  return {
    responseLanguage: bootstrap.settings.codexResponseLanguage || "",
    defaultModel: bootstrap.settings.codexDefaultModel || "",
    defaultReasoningEffort: bootstrap.settings.codexDefaultReasoningEffort || "",
  };
}

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
  const [pairingCode, setPairingCode] = useState("");
  const [relayServerUrl, setRelayServerUrl] = useState(() => getDefaultRelayServerUrl());
  const [pairing, setPairing] = useState(false);
  const [unpairing, setUnpairing] = useState(false);

  const handleError = (error: unknown) => {
    setNotice({ tone: "error", message: error instanceof Error ? error.message : "Unexpected error" });
  };

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    setDraft(createDraft(bootstrap));
    setRelayServerUrl(bootstrap.integrations.global.serverUrl || getDefaultRelayServerUrl());
  }, [bootstrap]);

  if (loading) {
    return <EmptyState title="Loading configuration" description="Workspace settings are loading." />;
  }

  if (loadError) {
    return <EmptyState title="Configuration unavailable" description={loadError} />;
  }

  if (!bootstrap) {
    return <EmptyState title="Configuration unavailable" description="Bootstrap payload is missing." />;
  }

  const userName = getWorkspaceUserName(bootstrap);
  const currentVersion = bootstrap.runtime.appVersion || "0.0.0";
  const resetDraft = () => {
    setDraft(createDraft(bootstrap));
  };
  const saveConfiguration = async () => {
    setNotice(null);
    try {
      await apiFetch("/api/settings/codex", {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      await refreshBootstrap();
      setNotice({ tone: "success", message: "설정을 저장했습니다." });
    } catch (error) {
      handleError(error);
    }
  };
  const checkForUpdates = async () => {
    setCheckingUpdate(true);
    setNotice(null);
    try {
      const result = await apiFetch<AppUpdateStatus>("/api/system/update/check", { method: "POST" });
      setUpdateStatus(result);
    } catch (error) {
      handleError(error);
    } finally {
      setCheckingUpdate(false);
    }
  };
  const applyUpdate = async () => {
    const confirmed = window.confirm("원격 브랜치에서 최신 코드를 가져와 fast-forward 업데이트와 빌드를 진행할까요?");
    if (!confirmed) {
      return;
    }

    setApplyingUpdate(true);
    setNotice(null);
    try {
      const result = await apiFetch<AppUpdateApplyResult>("/api/system/update/apply", { method: "POST" });
      setUpdateStatus(result);
      await refreshBootstrap();
    } catch (error) {
      handleError(error);
    } finally {
      setApplyingUpdate(false);
    }
  };
  const resetAllSettings = async () => {
    const confirmed = window.confirm("Codex 기본 설정과 setup에 저장된 Telegram 인증 정보를 초기화할까요?");
    if (!confirmed) {
      return;
    }

    setResetting(true);
    setNotice(null);
    try {
      await apiFetch("/api/settings/codex/reset", { method: "POST" });
      await refreshBootstrap();
      setNotice({
        tone: "success",
        message: "setup 정보를 포함한 전체 설정을 초기화했습니다. 다시 Telegram 연결을 진행하세요.",
      });
    } catch (error) {
      handleError(error);
    } finally {
      setResetting(false);
    }
  };
  const pairWithRelay = async () => {
    const normalizedCode = pairingCode.trim().toUpperCase();
    if (!normalizedCode || !relayServerUrl.trim()) {
      setNotice({ tone: "error", message: "Pairing code와 Relay Server URL을 모두 입력하세요." });
      return;
    }

    let normalizedServerUrl: string;
    try {
      normalizedServerUrl = normalizeRelayServerUrl(relayServerUrl);
    } catch (error) {
      handleError(error);
      return;
    }

    setPairing(true);
    setNotice(null);
    try {
      await apiFetch<{ global: unknown }>("/api/integrations/global/claim", {
        method: "POST",
        body: JSON.stringify({
          pairingCode: normalizedCode,
          serverUrl: normalizedServerUrl,
        }),
      });
      setPairingCode("");
      setRelayServerUrl(normalizedServerUrl);
      await refreshBootstrap();
      setNotice({ tone: "success", message: "이 디바이스를 relay에 등록했습니다." });
    } catch (error) {
      handleError(error);
    } finally {
      setPairing(false);
    }
  };
  const unpairRelay = async () => {
    const confirmed = window.confirm("이 디바이스의 relay pairing 정보를 삭제할까요?");
    if (!confirmed) {
      return;
    }

    setUnpairing(true);
    setNotice(null);
    try {
      await apiFetch<null>("/api/integrations/global", { method: "DELETE" });
      setPairingCode("");
      setRelayServerUrl(getDefaultRelayServerUrl());
      await refreshBootstrap();
      setNotice({ tone: "success", message: "Relay pairing을 해제했습니다." });
    } catch (error) {
      handleError(error);
    } finally {
      setUnpairing(false);
    }
  };
  const deviceDetails: Array<[string, string]> = [
    ["Device Name", bootstrap.device.displayName],
    ["Host", bootstrap.device.hostName],
    ["OS", bootstrap.device.os],
    ["Local Device ID", bootstrap.device.localDeviceId],
    [
      "Telegram",
      bootstrap.integrations.telegram.connected
        ? `Connected as ${bootstrap.integrations.telegram.userName || bootstrap.integrations.telegram.phoneNumber || "user"}`
        : "Not connected",
    ],
  ];
  const relayConnectionDetails: Array<[string, string]> = [
    [
      "Status",
      bootstrap.integrations.global.connected
        ? "Connected"
        : bootstrap.integrations.global.paired
          ? "Paired but offline"
          : "Not paired",
    ],
    ["Server", bootstrap.integrations.global.serverUrl || "Not paired"],
    ["Device ID", bootstrap.integrations.global.deviceId || "Not paired"],
    ["Owner", bootstrap.integrations.global.ownerLabel || "Unknown owner"],
    [
      "Last Sync",
      bootstrap.integrations.global.lastSyncAt
        ? `${new Date(bootstrap.integrations.global.lastSyncAt).toLocaleString()} · ${formatRelativeTime(bootstrap.integrations.global.lastSyncAt)}`
        : "No sync yet",
    ],
  ];

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
            <h2>Device & Integrations</h2>
            <div className={styles.readonlyGrid}>
              {deviceDetails.map(([label, value]) => (
                <label key={label} className={styles.field}>
                  <span>{label}</span>
                  <input readOnly value={value} />
                </label>
              ))}
            </div>
            <p className={styles.cardMeta}>
              Telegram 연결은 선택 사항입니다. 관리가 필요하면 <Link to={getSetupPath()}>integration 화면</Link>을 사용하세요.
            </p>
          </article>

          <article className={styles.card}>
            <h2>Relay Connection</h2>
            <div className={styles.readonlyGrid}>
              {relayConnectionDetails.map(([label, value]) => (
                <label key={label} className={styles.field}>
                  <span>{label}</span>
                  <input readOnly value={value} />
                </label>
              ))}
            </div>
            <div className={styles.divider} />
            <div className={styles.formStack}>
              <div className={styles.sectionHeader}>
                <h3>Pair With Relay</h3>
                <p className={styles.cardMeta}>
                  경로는 자동으로 제거됩니다. 원격 서버는 HTTPS만 허용되고, 로컬 테스트만 HTTP localhost를 사용할 수 있습니다.
                </p>
              </div>
              <label className={styles.field}>
                <span>Pairing Code</span>
                <input
                  value={pairingCode}
                  onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
                  placeholder="예: 5EE1C0B8"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
              <label className={styles.field}>
                <span>Relay Server URL</span>
                <input
                  value={relayServerUrl}
                  onChange={(event) => setRelayServerUrl(event.target.value)}
                  placeholder={getDefaultRelayServerUrl()}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
              <div className={styles.actions}>
                <Button type="button" disabled={pairing} onClick={() => void pairWithRelay()}>
                  {pairing ? "Pairing..." : bootstrap.integrations.global.paired ? "Re-pair Device" : "Pair Device"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={unpairing || !bootstrap.integrations.global.paired}
                  onClick={() => void unpairRelay()}
                >
                  {unpairing ? "Unpairing..." : "Unpair"}
                </Button>
              </div>
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
                  <option value="minimal">minimal (최소)</option>
                  <option value="low">low (낮음)</option>
                  <option value="medium">medium (보통)</option>
                  <option value="high">high (높음)</option>
                  <option value="xhigh">xhigh (매우 높음)</option>
                </select>
              </label>
            </div>

            <div className={styles.actions}>
              <Button type="button" variant="ghost" onClick={resetDraft}>
                Discard
              </Button>
              <Button type="button" onClick={() => void saveConfiguration()}>
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
                onClick={() => void checkForUpdates()}
              >
                {checkingUpdate ? "Checking..." : "Check for Updates"}
              </Button>
              <Button
                type="button"
                disabled={applyingUpdate || !updateStatus?.canApply}
                onClick={() => void applyUpdate()}
              >
                {applyingUpdate ? "Updating..." : "Update Now"}
              </Button>
            </div>
          </article>

          <article className={styles.card}>
            <h2>Danger Zone</h2>
            <p className={styles.cardMeta}>
              응답 언어, 기본 모델, reasoning effort와 Telegram 인증 정보를 초기화합니다.
            </p>
            <Button
              type="button"
              variant="ghost"
              disabled={resetting}
              onClick={() => void resetAllSettings()}
            >
              {resetting ? "Resetting..." : "Reset All Settings"}
            </Button>
          </article>
        </section>
      </section>
    </WorkspaceFrame>
  );
}
