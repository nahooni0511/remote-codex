import type { RelayAuthSession } from "@remote-codex/contracts";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { CenteredStatus } from "../components/CenteredStatus";
import { completeOidcSignIn } from "../lib/auth";

export function LoginCallbackPage({ onSession }: { onSession: (session: RelayAuthSession) => void }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void completeOidcSignIn()
      .then((session) => {
        onSession(session);
        navigate("/devices", { replace: true });
      })
      .catch((caught: Error) => {
        setError(caught.message);
      });
  }, [navigate, onSession]);

  if (error) {
    return <CenteredStatus title="Sign-in failed" description={error} tone="error" />;
  }

  return <CenteredStatus title="Completing sign-in" description="Finalizing your relay session." />;
}
