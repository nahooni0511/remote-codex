import type { PairingCodeCreateResponse, RelayAuthSession, RelayDeviceSummary } from "@remote-codex/contracts";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { navigateWithTransition } from "@remote-codex/workspace-web";
import { fetchRelayJson, setSelectedDeviceId } from "../lib/relay-api";

export function DevicesPage({
  session,
  onSignOut,
}: {
  session: RelayAuthSession;
  onSignOut: () => void;
}) {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<RelayDeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<PairingCodeCreateResponse | null>(null);
  const [pairingPending, setPairingPending] = useState(false);

  useEffect(() => {
    setLoading(true);
    void fetchRelayJson<{ devices: RelayDeviceSummary[] }>("/api/devices")
      .then((result) => {
        setDevices(result.devices || []);
        setError(null);
      })
      .catch((caught: Error) => {
        setError(caught.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [session.user?.email]);

  return (
    <main className="page">
      <section className="hero">
        <span className="kicker">Device Routing</span>
        <h1>Connected Devices</h1>
        <p>Select a device or mint a pairing code for a new local agent.</p>
        <div className="actions">
          <button
            type="button"
            disabled={pairingPending}
            onClick={() => {
              setPairingPending(true);
              setError(null);
              void fetchRelayJson<PairingCodeCreateResponse>("/api/pairing-codes", {
                method: "POST",
                body: JSON.stringify({
                  ownerLabel: session.user?.email || "remote-codex-owner",
                }),
              })
                .then((result) => {
                  setPairingCode(result);
                })
                .catch((caught: Error) => {
                  setError(caught.message);
                })
                .finally(() => {
                  setPairingPending(false);
                });
            }}
          >
            {pairingPending ? "Creating..." : "Create Pairing Code"}
          </button>
          <button type="button" className="buttonSecondary" onClick={onSignOut}>
            Sign Out
          </button>
        </div>
      </section>

      {pairingCode ? (
        <section className="card notice">
          <strong>Pairing Code</strong>
          <p>{pairingCode.code}</p>
          <p>Expires at {new Date(pairingCode.expiresAt).toLocaleString()}</p>
        </section>
      ) : null}

      {error ? <section className="card errorText">{error}</section> : null}

      <section className="grid">
        {(loading ? [] : devices).map((device) => (
          <article key={device.deviceId} className="card">
            <h2>{device.displayName}</h2>
            <p>{device.ownerEmail || "Unknown owner"}</p>
            <p className={device.connected ? "status status--online" : "status status--offline"}>
              {device.connected ? "Online" : "Offline"}
            </p>
            <p className="meta">Protocol {device.protocolVersion} · App {device.appVersion}</p>
            {device.blockedReason ? <p className="errorText">{device.blockedReason.message}</p> : null}
            <button
              type="button"
              disabled={!device.connected}
              onClick={() => {
                setSelectedDeviceId(device.deviceId);
                navigateWithTransition(navigate, "/", { replace: true });
              }}
            >
              Open Workspace
            </button>
          </article>
        ))}
        {!loading && !devices.length ? (
          <article className="card">
            <h2>No devices</h2>
            <p>No relay-connected devices are available for {session.user?.email || "this account"}.</p>
          </article>
        ) : null}
      </section>
    </main>
  );
}
