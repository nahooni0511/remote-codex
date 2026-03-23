import type { RelayAuthMethod, RelayAuthSession } from "@remote-codex/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { fetchRelayAuthConfig, startOidcSignIn } from "../lib/auth";
import { getRelayServerUrl, isDefaultRelayServerUrl } from "../lib/relay-server";

function isOidcMethod(method: RelayAuthMethod): method is Extract<RelayAuthMethod, { type: "oidc" }> {
  return method.type === "oidc";
}

export function LoginPage({ session }: { session: RelayAuthSession }) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<"oidc" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authMethods, setAuthMethods] = useState<RelayAuthMethod[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const relayServerUrl = useMemo(() => getRelayServerUrl(), []);

  useEffect(() => {
    void fetchRelayAuthConfig()
      .then((config) => setAuthMethods(config.methods))
      .catch((caught: Error) => setError(caught.message));
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && event.target instanceof Node && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  const oidcMethod = useMemo(() => authMethods.find(isOidcMethod) || null, [authMethods]);
  const showRelayServerUrl = useMemo(() => !isDefaultRelayServerUrl(relayServerUrl), [relayServerUrl]);

  if (session.user) {
    return <Navigate to="/devices" replace />;
  }

  return (
    <main className="relayPage relayLoginPage">
      <header className="relayTopBar relayTopBarNarrow">
        <span className="relayKicker">Relay Access</span>
        <div className="relayMenuWrap" ref={menuRef}>
          <button
            type="button"
            className="relayIconButton"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label="Open menu"
            onClick={() => setMenuOpen((current) => !current)}
          >
            <span className="relayMoreIcon" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
          {menuOpen ? (
            <div className="relayContextMenu" role="menu">
              <button
                type="button"
                className="relayContextMenuItem"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  navigate("/login/relay-server");
                }}
              >
                Relay Server Settings
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <section className="relayCard relayLoginCard">
        <h1>Remote Codex</h1>
        <p>Sign in to continue to your connected devices.</p>
        <div className="relayActions relayLoginActions">
          <button
            type="button"
            disabled={pending !== null || !oidcMethod}
            onClick={() => {
              if (!oidcMethod) {
                return;
              }

              setPending("oidc");
              setError(null);
              void startOidcSignIn(oidcMethod).catch((caught: Error) => {
                setPending(null);
                setError(caught.message);
              });
            }}
          >
            {pending === "oidc" ? "Signing In..." : "Sign In"}
          </button>
        </div>

        {showRelayServerUrl ? <p className="relayLoginServerUrl">{relayServerUrl}</p> : null}
        {!oidcMethod && !error ? <p className="relayMeta">This relay server does not advertise an OIDC sign-in method.</p> : null}
        {error ? <p className="relayErrorText">{error}</p> : null}
      </section>
    </main>
  );
}
