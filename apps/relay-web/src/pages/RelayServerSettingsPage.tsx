import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { STUDIO_LOGIN_PATH } from "../lib/routes";
import { DEFAULT_RELAY_SERVER_URL, getRelayServerUrl, setRelayServerUrl } from "../lib/relay-server";

export function RelayServerSettingsPage() {
  const navigate = useNavigate();
  const [serverUrl, setServerUrlState] = useState(() => getRelayServerUrl());
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="relayPage relayStudioPage">
      <header className="relayTopBar relayTopBarNarrow">
        <div>
          <span className="relayKicker">Relay Access</span>
          <h1 className="relayTopBarTitle">Relay Server Settings</h1>
        </div>
        <button
          type="button"
          className="relayButtonSecondary"
          onClick={() => {
            navigate(STUDIO_LOGIN_PATH, { replace: true });
          }}
        >
          Back
        </button>
      </header>

      <section className="relayCard relaySettingsCard">
        <p>Enter the relay server URL used for sign-in and device discovery.</p>
        <label className="relayField">
          <span>Relay Server URL</span>
          <input
            autoFocus
            autoComplete="url"
            onChange={(event) => setServerUrlState(event.target.value)}
            placeholder={DEFAULT_RELAY_SERVER_URL}
            type="url"
            value={serverUrl}
          />
        </label>
        <p className="relayMeta">Default relay: {DEFAULT_RELAY_SERVER_URL}</p>
        <div className="relayActions">
          <button
            type="button"
            onClick={() => {
              try {
                setRelayServerUrl(serverUrl);
                navigate(STUDIO_LOGIN_PATH, { replace: true });
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Unable to save the relay server URL.");
              }
            }}
          >
            Save
          </button>
        </div>
        {error ? <p className="relayErrorText">{error}</p> : null}
      </section>
    </main>
  );
}
