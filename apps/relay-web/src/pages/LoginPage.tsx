import type { RelayAuthMethod, RelayAuthSession } from "@remote-codex/contracts";
import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";

import { fetchRelayAuthConfig, isLocalAdminMethod, loginLocalAdmin, setupLocalAdmin, startOidcSignIn } from "../lib/auth";

function isOidcMethod(method: RelayAuthMethod): method is Extract<RelayAuthMethod, { type: "oidc" }> {
  return method.type === "oidc";
}

export function LoginPage({
  session,
  onSession,
  onSignOut,
}: {
  session: RelayAuthSession;
  onSession: (session: RelayAuthSession) => void;
  onSignOut: () => Promise<void>;
}) {
  const [pending, setPending] = useState<"oidc" | "login" | "setup" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authMethods, setAuthMethods] = useState<RelayAuthMethod[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");

  useEffect(() => {
    void fetchRelayAuthConfig()
      .then((config) => setAuthMethods(config.methods))
      .catch((caught: Error) => setError(caught.message));
  }, []);

  const oidcMethods = useMemo(() => authMethods.filter(isOidcMethod), [authMethods]);
  const localAdminMethod = useMemo(() => authMethods.find(isLocalAdminMethod) || null, [authMethods]);

  if (session.user) {
    return <Navigate to="/devices" replace />;
  }

  return (
    <main className="relayPage relayPageCentered">
      <section className="relayHero relayCard relayHeroNarrow">
        <span className="relayKicker">Relay Access</span>
        <h1>Remote Codex Sign In</h1>
        <p>Sign in with the auth method advertised by this relay server.</p>
        <div className="relayActions">
          {oidcMethods.map((method) => (
            <button
              key={method.id}
              type="button"
              disabled={pending !== null}
              onClick={() => {
                setPending("oidc");
                setError(null);
                void startOidcSignIn(method)
                  .catch((caught: Error) => {
                    setPending(null);
                    setError(caught.message);
                  });
              }}
            >
              {pending === "oidc" ? "Redirecting..." : method.label}
            </button>
          ))}
          <button type="button" className="relayButtonSecondary" onClick={() => void onSignOut()}>
            Clear Session
          </button>
        </div>

        {localAdminMethod ? (
          <div className="relayFormStack">
            <label>
              <span>Email</span>
              <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
            </label>
            <label>
              <span>Password</span>
              <input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
            </label>
            <div className="relayActions">
              <button
                type="button"
                disabled={pending !== null || !email.trim() || !password}
                onClick={() => {
                  setPending("login");
                  setError(null);
                  void loginLocalAdmin(localAdminMethod.id, email.trim(), password)
                    .then((nextSession) => onSession(nextSession))
                    .catch((caught: Error) => setError(caught.message))
                    .finally(() => setPending(null));
                }}
              >
                {pending === "login" ? "Signing In..." : localAdminMethod.label}
              </button>
            </div>
            {localAdminMethod.setupRequired && localAdminMethod.bootstrapEnabled ? (
              <>
                <label>
                  <span>Bootstrap Token</span>
                  <input onChange={(event) => setBootstrapToken(event.target.value)} type="password" value={bootstrapToken} />
                </label>
                <div className="relayActions">
                  <button
                    type="button"
                    disabled={pending !== null || !email.trim() || !password || !bootstrapToken}
                    onClick={() => {
                      setPending("setup");
                      setError(null);
                      void setupLocalAdmin(localAdminMethod.id, email.trim(), password, bootstrapToken)
                        .then((nextSession) => onSession(nextSession))
                        .catch((caught: Error) => setError(caught.message))
                        .finally(() => setPending(null));
                    }}
                  >
                    {pending === "setup" ? "Creating Admin..." : "Create First Admin"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {error ? <div className="relayErrorText">{error}</div> : null}
      </section>
    </main>
  );
}
