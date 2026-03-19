import type { RelayAuthSession } from "@remote-codex/contracts";
import * as AuthSession from "expo-auth-session";
import { useMemo, useState } from "react";
import { Text } from "react-native";

import type { StoredAuth } from "../lib/auth";
import {
  createStoredAuth,
  getCognitoClientId,
  getHostedUiDiscovery,
  getRedirectUri,
  persistStoredAuth,
} from "../lib/auth";
import { fetchRelayJson, getApiBaseUrl } from "../lib/relay-api";
import { styles } from "../styles";
import { Screen } from "../components/Screen";
import { Button, Card, ErrorText, Label } from "../components/ui";

export function LoginScreen({
  onAuthenticated,
  onClearSession,
}: {
  onAuthenticated: (auth: StoredAuth, session: RelayAuthSession) => void;
  onClearSession: () => void;
}) {
  const discovery = useMemo(() => getHostedUiDiscovery(), []);
  const redirectUri = useMemo(() => getRedirectUri(), []);
  const clientId = useMemo(() => getCognitoClientId(), []);
  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: ["openid", "email"],
      usePKCE: true,
    },
    discovery,
  );
  const [loading, setLoading] = useState<"signIn" | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Screen title="Remote Codex Sign In" subtitle="Sign in with Cognito, then continue to your relay-connected devices.">
      <Card>
        <Label>Hosted UI Redirect</Label>
        <Text style={styles.redirectValue}>{redirectUri}</Text>
        <Button
          label={loading === "signIn" ? "Redirecting..." : "Sign In with Cognito"}
          disabled={!request || loading !== null}
          onPress={() => {
            if (!request) {
              return;
            }

            setLoading("signIn");
            setError(null);
            void promptAsync()
              .then(async (result) => {
                if (result.type === "cancel" || result.type === "dismiss") {
                  return;
                }

                if (result.type === "error") {
                  throw new Error(result.error?.message || "Cognito sign-in did not complete.");
                }

                if (result.type !== "success") {
                  throw new Error("Cognito sign-in did not complete.");
                }

                const code = result.params.code;
                if (!code || !request.codeVerifier) {
                  throw new Error("Cognito callback was missing the authorization code.");
                }

                const tokenResponse = await AuthSession.exchangeCodeAsync(
                  {
                    clientId,
                    code,
                    redirectUri,
                    extraParams: {
                      code_verifier: request.codeVerifier,
                    },
                  },
                  discovery,
                );
                const storedAuth = createStoredAuth(tokenResponse);
                await persistStoredAuth(storedAuth);

                const session = await fetchRelayJson<RelayAuthSession>("/api/session", {}, storedAuth.idToken);
                if (!session.user) {
                  throw new Error("Authenticated session was not accepted by the relay API.");
                }

                onAuthenticated(storedAuth, session);
              })
              .catch((caught: Error) => setError(caught.message))
              .finally(() => setLoading(null));
          }}
        />
        <Button label="Clear Session" tone="secondary" disabled={loading !== null} onPress={onClearSession} />
        <Text style={styles.meta}>Relay API: {getApiBaseUrl()}</Text>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Card>
    </Screen>
  );
}
