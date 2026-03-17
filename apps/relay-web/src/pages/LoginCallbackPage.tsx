import type { RelayAuthSession } from "@remote-codex/contracts";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { CenteredStatus } from "../components/CenteredStatus";
import { completeHostedUiSignIn } from "../lib/auth";
import { fetchRelayJson } from "../lib/relay-api";

export function LoginCallbackPage({ onSession }: { onSession: (session: RelayAuthSession) => void }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    if (!code) {
      setError("Authorization code was not returned by Cognito.");
      return;
    }

    void completeHostedUiSignIn({ code, state })
      .then(() => fetchRelayJson<RelayAuthSession>("/api/session"))
      .then((session) => {
        onSession(session);
        navigate("/devices", { replace: true });
      })
      .catch((caught: Error) => {
        setError(caught.message);
      });
  }, [navigate, onSession, searchParams]);

  if (error) {
    return <CenteredStatus title="Sign-in failed" description={error} tone="error" />;
  }

  return <CenteredStatus title="Completing sign-in" description="Exchanging your Cognito authorization code." />;
}
