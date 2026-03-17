import type { RelayAuthSession } from "@remote-codex/contracts";
import { useState } from "react";
import { Navigate } from "react-router-dom";

import { startHostedUiSignIn } from "../lib/auth";

export function LoginPage({
  session,
  onSignOut,
}: {
  session: RelayAuthSession;
  onSignOut: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session.user) {
    return <Navigate to="/devices" replace />;
  }

  return (
    <main className="page page--centered">
      <section className="hero card hero--narrow">
        <span className="kicker">Relay Access</span>
        <h1>Remote Codex Sign In</h1>
        <p>Sign in with Cognito, then continue to your relay-connected devices.</p>
        <div className="actions">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setPending(true);
              setError(null);
              void startHostedUiSignIn().catch((caught: Error) => {
                setPending(false);
                setError(caught.message);
              });
            }}
          >
            {pending ? "Redirecting..." : "Sign In with Cognito"}
          </button>
          <button type="button" className="buttonSecondary" onClick={onSignOut}>
            Clear Session
          </button>
        </div>
        {error ? <div className="errorText">{error}</div> : null}
      </section>
    </main>
  );
}
