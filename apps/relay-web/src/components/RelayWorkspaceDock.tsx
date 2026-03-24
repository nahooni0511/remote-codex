import { Icon, navigateWithTransition } from "@remote-codex/workspace-web";
import { useNavigate } from "react-router-dom";

import { STUDIO_DEVICES_PATH } from "../lib/routes";
import { setSelectedDeviceId } from "../lib/relay-api";

export function RelayWorkspaceDock({
  deviceName,
  ownerEmail,
}: {
  deviceName: string;
  ownerEmail?: string | null;
}) {
  const navigate = useNavigate();
  const title = ownerEmail ? `${deviceName} · ${ownerEmail}` : deviceName;

  return (
    <button
      type="button"
      className="relayRailAction"
      title={title}
      aria-label={`${deviceName}에서 다른 device로 전환`}
      onClick={() => {
        setSelectedDeviceId(null);
        navigateWithTransition(navigate, STUDIO_DEVICES_PATH);
      }}
    >
      <Icon name="refresh" />
      <span>Switch</span>
    </button>
  );
}
