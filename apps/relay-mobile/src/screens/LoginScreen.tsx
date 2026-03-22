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
  signInWithPassword,
} from "../lib/auth";
import { fetchRelayJson, getApiBaseUrl } from "../lib/relay-api";
import { styles } from "../styles";
import { Screen } from "../components/Screen";
import { Button, Card, ErrorText, Field, Label } from "../components/ui";

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
  const [loading, setLoading] = useState<"hostedUi" | "password" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function finalizeAuthentication(storedAuth: StoredAuth) {
    await persistStoredAuth(storedAuth);

    const session = await fetchRelayJson<RelayAuthSession>("/api/session", {}, storedAuth.idToken);
    if (!session.user) {
      throw new Error("Authenticated session was not accepted by the relay API.");
    }

    onAuthenticated(storedAuth, session);
  }

  return (
    <Screen title="Remote Codex Sign In" subtitle="Sign in with Cognito, then continue to your relay-connected devices.">
      <Card>
        <Label>Email</Label>
        <Field
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="nahooni0511@gmail.com"
          textContentType="emailAddress"
          value={email}
        />
        <Label>Password</Label>
        <Field
          autoCapitalize="none"
          autoComplete="password"
          autoCorrect={false}
          onChangeText={setPassword}
          placeholder="Password"
          secureTextEntry
          textContentType="password"
          value={password}
        />
        <Button
          label={loading === "password" ? "Signing In..." : "Sign In with Email"}
          disabled={loading !== null || !email.trim() || !password}
          onPress={() => {
            setLoading("password");
            setError(null);
            void signInWithPassword(email.trim(), password)
              .then(finalizeAuthentication)
              .catch((caught: Error) => setError(caught.message))
              .finally(() => setLoading(null));
          }}
        />
        <Label>Hosted UI Redirect</Label>
        <Text style={styles.redirectValue}>{redirectUri}</Text>
        <Button
          label={loading === "hostedUi" ? "Redirecting..." : "Sign In with Cognito"}
          disabled={!request || loading !== null}
          onPress={() => {
            if (!request) {
              return;
            }

            setLoading("hostedUi");
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
                await finalizeAuthentication(createStoredAuth(tokenResponse));
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
