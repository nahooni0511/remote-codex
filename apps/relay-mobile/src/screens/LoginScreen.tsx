import { useState } from "react";
import { Text } from "react-native";
import type { RelayAuthSession } from "@remote-codex/contracts";

import { Screen } from "../components/Screen";
import { Button, Card, ErrorText, Field, Label } from "../components/ui";
import { consumeMagicLink, getRelayBaseUrl, requestMagicLink } from "../lib/relay";
import { styles } from "../styles";

export function LoginScreen({
  onAuthenticated,
}: {
  onAuthenticated: (session: RelayAuthSession, sessionToken: string) => void;
}) {
  const [email, setEmail] = useState("owner@example.com");
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Screen
      title="Remote Codex Mobile"
      subtitle={`Connect to relay devices from the simulator. Relay base: ${getRelayBaseUrl()}`}
      loading={loading}
    >
      <Card>
        <Label>Email</Label>
        <Field autoCapitalize="none" keyboardType="email-address" onChangeText={setEmail} value={email} />
        <Button
          label="Send Magic Link"
          disabled={!email.trim() || loading}
          onPress={() => {
            setLoading(true);
            setError(null);
            void requestMagicLink(email.trim())
              .then((result) => {
                const token = result.previewUrl ? new URL(result.previewUrl).searchParams.get("token") : null;
                setPreviewToken(token);
              })
              .catch((caught: Error) => setError(caught.message))
              .finally(() => setLoading(false));
          }}
        />
        {previewToken ? <Text style={styles.preview}>Preview token: {previewToken}</Text> : null}
        <Button
          label="Consume Preview Link"
          tone="ghost"
          disabled={!previewToken || loading}
          onPress={() => {
            if (!previewToken) {
              return;
            }

            setLoading(true);
            setError(null);
            void consumeMagicLink(previewToken)
              .then((result) => {
                if (!result.sessionToken) {
                  throw new Error("Relay did not return a mobile session token.");
                }
                onAuthenticated(result.session, result.sessionToken);
              })
              .catch((caught: Error) => setError(caught.message))
              .finally(() => setLoading(false));
          }}
        />
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Card>
    </Screen>
  );
}
