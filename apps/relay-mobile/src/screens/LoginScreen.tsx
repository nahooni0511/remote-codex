import type {
  RelayAuthMethod,
  RelayAuthSession,
  RelayClientAuthConfig,
  RelayLocalAdminAuthMethod,
  RelayOidcAuthMethod,
} from "@remote-codex/contracts";
import * as AuthSession from "expo-auth-session";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { StoredAuth } from "../lib/auth";
import {
  createStoredAuthFromExchange,
  getDefaultRelayServerUrl,
  getRedirectUri,
  getSavedServerUrls,
  persistStoredAuth,
  removeSavedServerUrl,
  saveServerUrl,
  setCurrentServerUrl,
} from "../lib/auth";
import {
  exchangeRelayOidcIdToken,
  fetchRelayAuthConfig,
  fetchRelayLocalSetupStatus,
  loginRelayLocalAdmin,
  setupRelayLocalAdmin,
} from "../lib/relay-api";
import { Screen } from "../components/Screen";
import { Button, Card, ErrorText, Field, Label } from "../components/ui";

function isOidcMethod(method: RelayAuthMethod): method is RelayOidcAuthMethod {
  return method.type === "oidc";
}

function isLocalAdminMethod(method: RelayAuthMethod): method is RelayLocalAdminAuthMethod {
  return method.type === "local-admin";
}

export function LoginScreen({
  currentServerUrl,
  onAuthenticated,
  onClearSession,
  onServerUrlChange,
}: {
  currentServerUrl: string | null;
  onAuthenticated: (auth: StoredAuth, session: RelayAuthSession) => void;
  onClearSession: () => void;
  onServerUrlChange: (serverUrl: string) => void;
}) {
  const redirectUri = useMemo(() => getRedirectUri(), []);
  const [serverInput, setServerInput] = useState(currentServerUrl || getDefaultRelayServerUrl());
  const [savedServers, setSavedServers] = useState<string[]>([]);
  const [authConfig, setAuthConfig] = useState<RelayClientAuthConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loading, setLoading] = useState<"oidc" | "password" | "setup" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");

  const oidcMethod = useMemo(() => authConfig?.methods.find(isOidcMethod) || null, [authConfig]);
  const localAdminMethod = useMemo(() => authConfig?.methods.find(isLocalAdminMethod) || null, [authConfig]);
  const discovery = useMemo(
    () =>
      oidcMethod
        ? {
            authorizationEndpoint: oidcMethod.authorizationEndpoint,
            tokenEndpoint: oidcMethod.tokenEndpoint,
            revocationEndpoint: oidcMethod.revocationEndpoint || undefined,
            endSessionEndpoint: oidcMethod.endSessionEndpoint || undefined,
          }
        : null,
    [oidcMethod],
  );
  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: oidcMethod?.clientId || "__disabled__",
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: oidcMethod?.scopes || ["openid", "email"],
      usePKCE: true,
    },
    discovery,
  );

  useEffect(() => {
    let cancelled = false;

    async function loadInitialState() {
      const servers = await getSavedServerUrls();
      if (!cancelled) {
        setSavedServers(servers);
      }
    }

    void loadInitialState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!currentServerUrl) {
      return;
    }

    setServerInput(currentServerUrl);
  }, [currentServerUrl]);

  useEffect(() => {
    if (!currentServerUrl) {
      return;
    }

    void loadServerConfig(currentServerUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentServerUrl]);

  async function loadServerConfig(serverUrl: string) {
    setLoadingConfig(true);
    setError(null);
    try {
      const normalized = await setCurrentServerUrl(serverUrl);
      onServerUrlChange(normalized);
      await saveServerUrl(normalized);
      const config = await fetchRelayAuthConfig(normalized);
      const methods = await Promise.all(
        config.methods.map(async (method) => {
          if (!isLocalAdminMethod(method)) {
            return method;
          }

          try {
            return await fetchRelayLocalSetupStatus(normalized, method.id);
          } catch {
            return method;
          }
        }),
      );
      setAuthConfig({
        ...config,
        methods: methods.map((method, index) =>
          isLocalAdminMethod(config.methods[index]) && "methodId" in method
            ? {
                ...(config.methods[index] as RelayLocalAdminAuthMethod),
                setupRequired: method.setupRequired,
                bootstrapEnabled: method.bootstrapEnabled,
              }
            : config.methods[index],
        ),
      });
      setSavedServers(await getSavedServerUrls());
    } catch (caught) {
      setAuthConfig(null);
      setError(caught instanceof Error ? caught.message : "Unable to reach the relay server.");
    } finally {
      setLoadingConfig(false);
    }
  }

  async function finalizeAuthentication(serverUrl: string, methodId: string, payload: Awaited<ReturnType<typeof exchangeRelayOidcIdToken>>) {
    const storedAuth = createStoredAuthFromExchange(serverUrl, methodId, payload);
    await persistStoredAuth(storedAuth);
    onAuthenticated(storedAuth, payload.session);
  }

  return (
    <Screen
      title="Remote Codex Sign In"
      subtitle="Choose a relay server, discover its supported auth methods, and continue to your connected devices."
    >
      <Card>
        <Label>Relay Server</Label>
        <Field
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={setServerInput}
          placeholder="https://relay.remote-codex.com"
          value={serverInput}
        />
        <Button
          disabled={loadingConfig || loading !== null || !serverInput.trim()}
          label={loadingConfig ? "Loading Server..." : "Use This Server"}
          onPress={() => {
            void loadServerConfig(serverInput.trim());
          }}
        />
        <Label>Saved Servers</Label>
        <View style={styles.serverList}>
          {savedServers.map((server) => (
            <Pressable key={server} onPress={() => void loadServerConfig(server)} style={styles.serverChip}>
              <Text numberOfLines={1} style={styles.serverChipText}>
                {server}
              </Text>
            </Pressable>
          ))}
        </View>
        {authConfig ? (
          <Text style={styles.meta}>
            Connected to {authConfig.serverName} ({authConfig.serverUrl})
          </Text>
        ) : null}
        <Button
          disabled={loadingConfig || loading !== null}
          label="Remove Current Server"
          onPress={() => {
            void removeSavedServerUrl(serverInput.trim())
              .then(async () => {
                const next = getDefaultRelayServerUrl();
                setServerInput(next);
                onServerUrlChange(next);
                setSavedServers(await getSavedServerUrls());
                await loadServerConfig(next);
              })
              .catch((caught: Error) => setError(caught.message));
          }}
          tone="ghost"
        />
      </Card>

      {oidcMethod ? (
        <Card>
          <Label>OIDC</Label>
          <Text style={styles.methodDescription}>{oidcMethod.label}</Text>
          <Text style={styles.redirectValue}>{redirectUri}</Text>
          <Button
            label={loading === "oidc" ? "Redirecting..." : oidcMethod.label}
            disabled={!request || loading !== null || loadingConfig}
            onPress={() => {
              if (!request || !oidcMethod) {
                return;
              }

              setLoading("oidc");
              setError(null);
              void promptAsync()
                .then(async (result) => {
                  if (result.type === "cancel" || result.type === "dismiss") {
                    return;
                  }

                  if (result.type === "error") {
                    throw new Error(result.error?.message || "OIDC sign-in did not complete.");
                  }

                  if (result.type !== "success") {
                    throw new Error("OIDC sign-in did not complete.");
                  }

                  const code = result.params.code;
                  if (!code || !request.codeVerifier) {
                    throw new Error("OIDC callback was missing the authorization code.");
                  }

                  const tokenResponse = await AuthSession.exchangeCodeAsync(
                    {
                      clientId: oidcMethod.clientId,
                      code,
                      redirectUri,
                      extraParams: {
                        code_verifier: request.codeVerifier,
                      },
                    },
                    discovery || { tokenEndpoint: oidcMethod.tokenEndpoint },
                  );
                  if (!tokenResponse.idToken) {
                    throw new Error("OIDC provider did not return an id token.");
                  }

                  const payload = await exchangeRelayOidcIdToken(serverInput.trim(), oidcMethod.id, tokenResponse.idToken);
                  await finalizeAuthentication(serverInput.trim(), oidcMethod.id, payload);
                })
                .catch((caught: Error) => setError(caught.message))
                .finally(() => setLoading(null));
            }}
          />
        </Card>
      ) : null}

      {localAdminMethod ? (
        <Card tone="muted">
          <Label>Local Admin</Label>
          <Text style={styles.methodDescription}>{localAdminMethod.label}</Text>
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
            label={loading === "password" ? "Signing In..." : localAdminMethod.label}
            disabled={loading !== null || loadingConfig || !email.trim() || !password}
            onPress={() => {
              setLoading("password");
              setError(null);
              void loginRelayLocalAdmin(serverInput.trim(), localAdminMethod.id, email.trim(), password)
                .then((payload) => finalizeAuthentication(serverInput.trim(), localAdminMethod.id, payload))
                .catch((caught: Error) => setError(caught.message))
                .finally(() => setLoading(null));
            }}
          />
          {localAdminMethod.setupRequired && localAdminMethod.bootstrapEnabled ? (
            <>
              <Label>Bootstrap Token</Label>
              <Field
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setBootstrapToken}
                placeholder="Bootstrap token"
                secureTextEntry
                value={bootstrapToken}
              />
              <Button
                label={loading === "setup" ? "Creating Admin..." : "Create First Admin"}
                disabled={loading !== null || loadingConfig || !email.trim() || !password || !bootstrapToken}
                onPress={() => {
                  setLoading("setup");
                  setError(null);
                  void setupRelayLocalAdmin(serverInput.trim(), localAdminMethod.id, email.trim(), password, bootstrapToken)
                    .then((payload) => finalizeAuthentication(serverInput.trim(), localAdminMethod.id, payload))
                    .catch((caught: Error) => setError(caught.message))
                    .finally(() => setLoading(null));
                }}
              />
            </>
          ) : null}
        </Card>
      ) : null}

      <Card tone="muted">
        <Button label="Clear Session" tone="secondary" disabled={loading !== null || loadingConfig} onPress={onClearSession} />
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: {
    color: "#5d625e",
    fontSize: 13,
    lineHeight: 18,
  },
  methodDescription: {
    color: "#214240",
    fontSize: 15,
    lineHeight: 22,
  },
  redirectValue: {
    color: "#0f615d",
    fontSize: 12,
    lineHeight: 18,
  },
  serverList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  serverChip: {
    backgroundColor: "rgba(15, 97, 93, 0.08)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: "100%",
  },
  serverChipText: {
    color: "#0f615d",
    fontSize: 12,
    fontWeight: "600",
  },
});
