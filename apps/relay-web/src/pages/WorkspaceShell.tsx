import { RelayBridgeClient } from "@remote-codex/client-core";
import type { DeviceConnectTokenResponse, RelayAuthSession } from "@remote-codex/contracts";
import {
  WorkspaceApp,
  configureWorkspaceTransport,
  createRelayWorkspaceTransport,
  resetWorkspaceTransport,
} from "@remote-codex/workspace-web";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { CenteredStatus } from "../components/CenteredStatus";
import { fetchRelayJson, getSelectedDeviceId } from "../lib/relay-api";
import { BlockedWorkspacePage } from "./BlockedWorkspacePage";

export function WorkspaceShell({ session }: { session: RelayAuthSession }) {
  const navigate = useNavigate();
  const location = useLocation();
  const selectedDeviceId = useMemo(() => getSelectedDeviceId(), [location.key]);
  const [connectToken, setConnectToken] = useState<DeviceConnectTokenResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session.user) {
      navigate("/login", { replace: true });
      return;
    }

    if (!selectedDeviceId) {
      navigate("/devices", { replace: true });
      return;
    }

    setLoading(true);
    setError(null);
    setWorkspaceReady(false);
    void fetchRelayJson<DeviceConnectTokenResponse>(`/api/devices/${encodeURIComponent(selectedDeviceId)}/connect-token`, {
      method: "POST",
    })
      .then((result) => {
        setConnectToken(result);
      })
      .catch((caught: Error) => {
        setError(caught.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [navigate, selectedDeviceId, session.user]);

  useEffect(() => {
    if (!connectToken || connectToken.device.blockedReason) {
      setWorkspaceReady(false);
      return;
    }

    const relayClient = new RelayBridgeClient({ connectToken });
    let cancelled = false;

    void relayClient
      .connect()
      .then((state) => {
        if (cancelled) {
          relayClient.close();
          return;
        }

        if (state.blockedReason) {
          setConnectToken((current) =>
            current
              ? {
                  ...current,
                  device: {
                    ...current.device,
                    blockedReason: state.blockedReason,
                  },
                }
              : current,
          );
          relayClient.close();
          return;
        }

        configureWorkspaceTransport(createRelayWorkspaceTransport(relayClient));
        setWorkspaceReady(true);
      })
      .catch((caught: Error) => {
        if (!cancelled) {
          setError(caught.message);
        }
      });

    return () => {
      cancelled = true;
      setWorkspaceReady(false);
      relayClient.close();
      resetWorkspaceTransport();
    };
  }, [connectToken]);

  if (loading) {
    return <CenteredStatus title="Connecting workspace" description="Initializing encrypted relay session." />;
  }

  if (error) {
    return <CenteredStatus title="Workspace unavailable" description={error} tone="error" />;
  }

  if (!connectToken) {
    return <Navigate to="/devices" replace />;
  }

  if (connectToken.device.blockedReason) {
    return <BlockedWorkspacePage device={connectToken.device} />;
  }

  if (!workspaceReady) {
    return <CenteredStatus title="Preparing workspace transport" description="Mounting the encrypted relay adapter." />;
  }

  return <WorkspaceApp />;
}
