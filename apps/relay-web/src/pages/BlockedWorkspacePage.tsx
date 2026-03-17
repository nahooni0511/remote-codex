import type { AppUpdateApplyResult, AppUpdateStatus, RelayDeviceSummary } from "@remote-codex/contracts";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchRelayJson, setSelectedDeviceId } from "../lib/relay-api";

export function BlockedWorkspacePage({ device }: { device: RelayDeviceSummary }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<AppUpdateStatus | AppUpdateApplyResult | null>(null);
  const [pending, setPending] = useState<"check" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="page page--centered">
      <section className="hero card hero--narrow">
        <span className="kicker">Protocol Blocked</span>
        <h1>{device.displayName}</h1>
        <p>{device.blockedReason?.message || "This device requires a newer local runtime."}</p>
        <div className="actions">
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => {
              setPending("check");
              setError(null);
              void fetchRelayJson<AppUpdateStatus>(`/api/devices/${encodeURIComponent(device.deviceId)}/update/check`, {
                method: "POST",
              })
                .then((result) => setStatus(result))
                .catch((caught: Error) => setError(caught.message))
                .finally(() => setPending(null));
            }}
          >
            {pending === "check" ? "Checking..." : "Check Update"}
          </button>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => {
              setPending("apply");
              setError(null);
              void fetchRelayJson<AppUpdateApplyResult>(`/api/devices/${encodeURIComponent(device.deviceId)}/update/apply`, {
                method: "POST",
              })
                .then((result) => setStatus(result))
                .catch((caught: Error) => setError(caught.message))
                .finally(() => setPending(null));
            }}
          >
            {pending === "apply" ? "Updating..." : "Apply Update"}
          </button>
          <button
            type="button"
            className="buttonGhost"
            onClick={() => {
              setSelectedDeviceId(null);
              navigate("/devices");
            }}
          >
            Back to Devices
          </button>
        </div>
        {status ? (
          <div className="notice">
            <strong>{status.updateAvailable ? "Update available" : "No update available"}</strong>
            <span>{status.reason || ""}</span>
          </div>
        ) : null}
        {error ? <div className="errorText">{error}</div> : null}
      </section>
    </main>
  );
}
