import type { AppBootstrap, AuthPasswordRequiredResponse, AuthSendCodeResponse } from "@remote-codex/contracts";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppContext } from "../app/AppProvider";
import { Banner } from "../components/ui/Banner";
import { Icon } from "../components/ui/Icon";
import { apiFetch } from "../lib/api/client";
import { getFallbackChatPath } from "../lib/routes";
import styles from "./SetupPage.module.css";

type Notice = { tone: "error" | "success"; message: string } | null;

const featureItems = [
  {
    title: "Secure API Connection",
    description: "End-to-end encrypted session management.",
  },
  {
    title: "Real-time Synchronization",
    description: "Instant updates across all your remote terminals.",
  },
  {
    title: "Automated Bot Integration",
    description: "Deploy custom workflows directly from chat.",
  },
] as const;

const guideItems = [
  <>
    Login to{" "}
    <a href="https://my.telegram.org" target="_blank" rel="noreferrer">
      my.telegram.org
    </a>{" "}
    with your phone number.
  </>,
  <>Go to &quot;API development tools&quot; section.</>,
  <>Create a new application. Any app name or title works.</>,
  <>
    Copy your <strong>api_id</strong> and <strong>api_hash</strong>.
  </>,
] as const;

const footerLinks = ["Privacy Policy", "System Status"] as const;

export function SetupPage() {
  const navigate = useNavigate();
  const { refreshBootstrap } = useAppContext();
  const [notice, setNotice] = useState<Notice>(null);
  const [phoneCode, setPhoneCode] = useState("");
  const [password, setPassword] = useState("");
  const [authFlow, setAuthFlow] = useState({
    pendingAuthId: "",
    apiId: "",
    apiHash: "",
    phoneNumber: "",
    botToken: "",
    botUserName: "",
    requiresPassword: false,
    passwordHint: "",
  });

  const handleBootstrapSuccess = async (bootstrap?: AppBootstrap | null) => {
    const nextState = bootstrap || (await refreshBootstrap());
    navigate(getFallbackChatPath(nextState), { replace: true });
  };

  const handleSendCode = () => {
    setNotice(null);
    void apiFetch<AuthSendCodeResponse>("/api/auth/send-code", {
      method: "POST",
      body: JSON.stringify({
        apiId: authFlow.apiId,
        apiHash: authFlow.apiHash,
        phoneNumber: authFlow.phoneNumber,
        botToken: authFlow.botToken,
      }),
    })
      .then((result) => {
        setAuthFlow((current) => ({
          ...current,
          pendingAuthId: result.pendingAuthId,
          botUserName: result.botUserName,
          requiresPassword: false,
          passwordHint: "",
        }));
        setPhoneCode("");
        setPassword("");
        setNotice({ tone: "success", message: "Telegram 로그인 코드를 보냈습니다." });
      })
      .catch((error: Error) => {
        setNotice({ tone: "error", message: error.message });
      });
  };

  const handleVerifyCode = () => {
    setNotice(null);
    void apiFetch<AppBootstrap | AuthPasswordRequiredResponse>("/api/auth/verify-code", {
      method: "POST",
      body: JSON.stringify({
        pendingAuthId: authFlow.pendingAuthId,
        phoneCode,
        botToken: authFlow.botToken,
      }),
    })
      .then(async (result) => {
        if ("requiresPassword" in result) {
          setAuthFlow((current) => ({
            ...current,
            requiresPassword: true,
            passwordHint: result.passwordHint || "",
          }));
          setNotice({ tone: "success", message: "2단계 인증 비밀번호가 필요합니다." });
          return;
        }

        await handleBootstrapSuccess(result);
      })
      .catch((error: Error) => {
        setNotice({ tone: "error", message: error.message });
      });
  };

  const handleVerifyPassword = () => {
    setNotice(null);
    void apiFetch<AppBootstrap>("/api/auth/verify-password", {
      method: "POST",
      body: JSON.stringify({
        pendingAuthId: authFlow.pendingAuthId,
        password,
        botToken: authFlow.botToken,
      }),
    })
      .then(async (result) => {
        await handleBootstrapSuccess(result);
      })
      .catch((error: Error) => {
        setNotice({ tone: "error", message: error.message });
      });
  };

  return (
    <main className={styles.page}>
      <div className={styles.frame}>
        <header className={styles.topbar}>
          <div className={styles.brand}>
            <span className={styles.brandMark}>
              <Icon name="terminal" />
            </span>
            <strong>Remote Codex</strong>
          </div>

          <div className={styles.topbarActions}>
            <nav className={styles.topnav} aria-label="Setup navigation">
              <span className={[styles.topnavItem, styles.topnavActive].join(" ")}>Setup</span>
              <a
                className={styles.topnavItem}
                href="https://my.telegram.org"
                target="_blank"
                rel="noreferrer"
              >
                Documentation
              </a>
            </nav>
            <a
              className={styles.helpLink}
              href="https://core.telegram.org/api/obtaining_api_id"
              target="_blank"
              rel="noreferrer"
              aria-label="Telegram API guide"
            >
              <Icon name="help" />
            </a>
          </div>
        </header>

        <section className={styles.main}>
          <section className={styles.leftColumn}>
            <span className={styles.kicker}>Codex x Telegram</span>
            <div className={styles.heroBlock}>
              <h1>Welcome</h1>
              <p>
                Connect your Telegram account to Remote Codex to start managing your workspace remotely with
                high-speed automated synchronization.
              </p>
            </div>

            <div className={styles.featureList}>
              {featureItems.map((item) => (
                <article key={item.title} className={styles.feature}>
                  <span className={styles.featureIcon}>
                    <Icon name="check" />
                  </span>
                  <div>
                    <h2>{item.title}</h2>
                    <p>{item.description}</p>
                  </div>
                </article>
              ))}
            </div>

            <section className={styles.guideCard}>
              <div className={styles.guideTitle}>
                <Icon name="help" />
                <strong>How to get your API credentials</strong>
              </div>
              <ol className={styles.guideList}>
                {guideItems.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ol>
            </section>
          </section>

          <section className={styles.formCard}>
            <div className={styles.cardHeader}>
              <h2>Instance Configuration</h2>
              <p>Provide your Telegram application credentials</p>
            </div>

            {notice ? <Banner tone={notice.tone}>{notice.message}</Banner> : null}

            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Telegram API ID</span>
                <input
                  className={styles.fieldInput}
                  value={authFlow.apiId}
                  onChange={(event) => setAuthFlow((current) => ({ ...current, apiId: event.target.value }))}
                  placeholder="1234567"
                  inputMode="numeric"
                />
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>API Hash</span>
                <input
                  className={styles.fieldInput}
                  value={authFlow.apiHash}
                  onChange={(event) => setAuthFlow((current) => ({ ...current, apiHash: event.target.value }))}
                  placeholder="••••••••••••"
                />
              </label>

              <label className={[styles.field, styles.fieldFull].join(" ")}>
                <span className={styles.fieldLabel}>Phone Number (with Country Code)</span>
                <span className={[styles.fieldInputShell, styles.fieldInputInset].join(" ")}>
                  <span className={styles.fieldIcon}>
                    <Icon name="phone" />
                  </span>
                  <input
                    className={styles.fieldInput}
                    value={authFlow.phoneNumber}
                    onChange={(event) => setAuthFlow((current) => ({ ...current, phoneNumber: event.target.value }))}
                    placeholder="+1 234 567 890"
                    type="tel"
                    autoComplete="tel"
                  />
                </span>
              </label>

              <label className={[styles.field, styles.fieldFull, styles.optionalGroup].join(" ")}>
                <span className={styles.optionalDivider} />
                <span className={styles.fieldLabel}>Bot Token (Optional)</span>
                <span className={[styles.fieldInputShell, styles.fieldInputInset].join(" ")}>
                  <span className={styles.fieldIcon}>
                    <Icon name="bot" />
                  </span>
                  <input
                    className={styles.fieldInput}
                    value={authFlow.botToken}
                    onChange={(event) => setAuthFlow((current) => ({ ...current, botToken: event.target.value }))}
                    placeholder="590213456:AAFlK..."
                    autoComplete="off"
                  />
                </span>
              </label>
            </div>

            <button
              type="button"
              className={styles.primaryAction}
              disabled={!authFlow.apiId.trim() || !authFlow.apiHash.trim() || !authFlow.phoneNumber.trim()}
              onClick={handleSendCode}
            >
              <Icon name="send" />
              <span>{authFlow.pendingAuthId ? "Send Verification Code Again" : "Send Verification Code"}</span>
            </button>

            <p className={styles.disclaimer}>
              By clicking send, a verification code will be sent to your official Telegram app. We never store your
              credentials.
            </p>

            {authFlow.pendingAuthId ? (
              <section className={styles.followupPanel}>
                <div className={styles.followupHeader}>
                  <h3>Enter Verification Code</h3>
                  <p>
                    Enter the Telegram code sent to {authFlow.phoneNumber}. The connected bot will continue as @
                    {authFlow.botUserName || "bot"}.
                  </p>
                </div>
                <div className={styles.followupRow}>
                  <input
                    className={styles.followupInput}
                    value={phoneCode}
                    onChange={(event) => setPhoneCode(event.target.value)}
                    placeholder="12345"
                    inputMode="numeric"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && phoneCode.trim()) {
                        handleVerifyCode();
                      }
                    }}
                  />
                  <button type="button" className={styles.inlineAction} disabled={!phoneCode.trim()} onClick={handleVerifyCode}>
                    Verify Code
                  </button>
                </div>
              </section>
            ) : null}

            {authFlow.pendingAuthId && authFlow.requiresPassword ? (
              <section className={styles.followupPanel}>
                <div className={styles.followupHeader}>
                  <h3>Two-Factor Authentication</h3>
                  <p>Password hint: {authFlow.passwordHint || "-"}</p>
                </div>
                <div className={styles.followupRow}>
                  <input
                    className={styles.followupInput}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    placeholder="Telegram 2FA password"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && password.trim()) {
                        handleVerifyPassword();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className={styles.inlineAction}
                    disabled={!password.trim()}
                    onClick={handleVerifyPassword}
                  >
                    Complete Login
                  </button>
                </div>
              </section>
            ) : null}
          </section>
        </section>

        <footer className={styles.footer}>
          <div className={styles.footerMeta}>
            <span>© 2024 Remote Codex Inc.</span>
            {footerLinks.map((item) => (
              <span key={item} className={styles.footerLink}>
                {item}
              </span>
            ))}
          </div>

          <div className={styles.footerStatus}>
            <div className={styles.avatars} aria-hidden="true">
              <span className={styles.avatar}>RC</span>
              <span className={styles.avatar}>TG</span>
              <span className={[styles.avatar, styles.avatarAccent].join(" ")}>+12</span>
            </div>
            <span>Developers online</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
