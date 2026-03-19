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
  onSignOut: () => Promise<void>;
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
    <main className="relayPage">
      <section className="relayHero">
        <span className="relayKicker">Device Routing</span>
        <h1>Connected Devices</h1>
        <p>Select a device or mint a pairing code for a new local agent.</p>
        <div className="relayActions">
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
          <button type="button" className="relayButtonSecondary" onClick={() => void onSignOut()}>
            Sign Out
          </button>
        </div>
      </section>

      {pairingCode ? (
        <section className="relayCard relayPairingCard">
          <div className="relayPairingHeader">
            <strong>Pairing Code</strong>
            <span className="relayPairingExpiry">Expires at {new Date(pairingCode.expiresAt).toLocaleString()}</span>
          </div>
          <div className="relayPairingBody">
            <code className="relayPairingCode">{pairingCode.code}</code>
            <p className="relayPairingHint">Paste this code into the local workspace config page to pair the device.</p>
          </div>
        </section>
      ) : null}

      {error ? <section className="relayCard relayErrorText">{error}</section> : null}

      <section className="relayGrid">
        {(loading ? [] : devices).map((device) => (
          <article key={device.deviceId} className="relayCard">
            <h2>{device.displayName}</h2>
            <p>{device.ownerEmail || "Unknown owner"}</p>
            <p className={device.connected ? "relayStatus relayStatusOnline" : "relayStatus relayStatusOffline"}>
              {device.connected ? "Online" : "Offline"}
            </p>
            <p className="relayMeta">Protocol {device.protocolVersion} · App {device.appVersion}</p>
            {device.blockedReason ? <p className="relayErrorText">{device.blockedReason.message}</p> : null}
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
          <article className="relayCard">
            <h2>No devices</h2>
            <p>No relay-connected devices are available for {session.user?.email || "this account"}.</p>
          </article>
        ) : null}
      </section>
    </main>
  );
}
