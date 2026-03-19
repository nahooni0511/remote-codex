import type { RelayAuthSession } from "@remote-codex/contracts";
import { useState } from "react";
import { Navigate } from "react-router-dom";

import { startHostedUiSignIn } from "../lib/auth";

export function LoginPage({
  session,
  onSignOut,
}: {
  session: RelayAuthSession;
  onSignOut: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session.user) {
    return <Navigate to="/devices" replace />;
  }

  return (
    <main className="relayPage relayPageCentered">
      <section className="relayHero relayCard relayHeroNarrow">
        <span className="relayKicker">Relay Access</span>
        <h1>Remote Codex Sign In</h1>
        <p>Sign in with Cognito, then continue to your relay-connected devices.</p>
        <div className="relayActions">
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
          <button type="button" className="relayButtonSecondary" onClick={() => void onSignOut()}>
            Clear Session
          </button>
        </div>
        {error ? <div className="relayErrorText">{error}</div> : null}
      </section>
    </main>
  );
}
