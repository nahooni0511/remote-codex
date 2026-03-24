import { RelayBridgeClient } from "@remote-codex/client-core";
import type { DeviceConnectTokenResponse, RelayAuthSession } from "@remote-codex/contracts";
import {
  WorkspaceApp,
  configureWorkspaceBasePath,
  configureWorkspaceTransport,
  createRelayWorkspaceTransport,
  resetWorkspaceTransport,
} from "@remote-codex/workspace-web";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { CenteredStatus } from "../components/CenteredStatus";
import { RelayWorkspaceDock } from "../components/RelayWorkspaceDock";
import {
  PRICING_PATH,
  STUDIO_BASE_PATH,
  STUDIO_DEVICES_PATH,
  STUDIO_LOGIN_PATH,
} from "../lib/routes";
import { fetchRelayJson, getSelectedDeviceId, RelayApiError } from "../lib/relay-api";
import { BlockedWorkspacePage } from "./BlockedWorkspacePage";

configureWorkspaceBasePath(STUDIO_BASE_PATH);

export function WorkspaceShell({ session }: { session: RelayAuthSession }) {
  const navigate = useNavigate();
  const location = useLocation();
  const selectedDeviceId = useMemo(() => getSelectedDeviceId(), [location.key]);
  const [connectToken, setConnectToken] = useState<DeviceConnectTokenResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionRequired, setSubscriptionRequired] = useState(false);

  useEffect(() => {
    if (!session.user) {
      navigate(STUDIO_LOGIN_PATH, { replace: true });
      return;
    }

    if (!selectedDeviceId) {
      navigate(STUDIO_DEVICES_PATH, { replace: true });
      return;
    }

    setLoading(true);
    setError(null);
    setSubscriptionRequired(false);
    setWorkspaceReady(false);
    void fetchRelayJson<DeviceConnectTokenResponse>(`/api/devices/${encodeURIComponent(selectedDeviceId)}/connect-token`, {
      method: "POST",
    })
      .then((result) => {
        setConnectToken(result);
      })
      .catch((caught: Error) => {
        if (caught instanceof RelayApiError && caught.code === "SUBSCRIPTION_REQUIRED") {
          setSubscriptionRequired(true);
          return;
        }

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

  useEffect(() => {
    if (!selectedDeviceId || !connectToken?.device.blockedReason) {
      return;
    }

    let cancelled = false;
    let retryTimer: number | null = null;

    const refreshConnectToken = () => {
      if (cancelled) {
        return;
      }

      void fetchRelayJson<DeviceConnectTokenResponse>(`/api/devices/${encodeURIComponent(selectedDeviceId)}/connect-token`, {
        method: "POST",
      })
        .then((result) => {
          if (cancelled) {
            return;
          }

          setError(null);
          setConnectToken(result);
          if (result.device.blockedReason) {
            retryTimer = window.setTimeout(refreshConnectToken, 2500);
          }
        })
        .catch(() => {
          if (cancelled) {
            return;
          }

          retryTimer = window.setTimeout(refreshConnectToken, 2500);
        });
    };

    retryTimer = window.setTimeout(refreshConnectToken, 2500);

    return () => {
      cancelled = true;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [connectToken?.device.blockedReason, selectedDeviceId]);

  if (loading) {
    return <CenteredStatus title="Connecting workspace" description="Initializing encrypted relay session." />;
  }

  if (error) {
    return <CenteredStatus title="Workspace unavailable" description={error} tone="error" />;
  }

  if (subscriptionRequired) {
    return <Navigate to={PRICING_PATH} replace />;
  }

  if (!connectToken) {
    return <Navigate to={STUDIO_DEVICES_PATH} replace />;
  }

  if (connectToken.device.blockedReason) {
    return <BlockedWorkspacePage device={connectToken.device} />;
  }

  if (!workspaceReady) {
    return <CenteredStatus title="Preparing workspace transport" description="Mounting the encrypted relay adapter." />;
  }

  return (
    <WorkspaceApp
      railSlot={
        <RelayWorkspaceDock
          deviceName={connectToken.device.displayName}
          ownerEmail={connectToken.device.ownerEmail}
        />
      }
    />
  );
}
