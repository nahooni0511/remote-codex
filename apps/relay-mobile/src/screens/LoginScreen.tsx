import type { RelayAuthMethod, RelayAuthSession, RelayClientAuthConfig, RelayOidcAuthMethod } from "@remote-codex/contracts";
import { Ionicons } from "@expo/vector-icons";
import * as AuthSession from "expo-auth-session";
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { StoredAuth } from "../lib/auth";
import {
  createStoredAuthFromExchange,
  getDefaultRelayServerUrl,
  getRedirectUri,
  persistStoredAuth,
  setCurrentServerUrl,
} from "../lib/auth";
import { exchangeRelayOidcIdToken, fetchRelayAuthConfig } from "../lib/relay-api";
import { appPalette } from "../styles";

function isOidcMethod(method: RelayAuthMethod): method is RelayOidcAuthMethod {
  return method.type === "oidc";
}

export function LoginScreen({
  currentServerUrl,
  onAuthenticated,
  onOpenRelayServerSettings,
  onServerUrlChange,
}: {
  currentServerUrl: string | null;
  onAuthenticated: (auth: StoredAuth, session: RelayAuthSession) => void;
  onOpenRelayServerSettings: () => void;
  onServerUrlChange: (serverUrl: string) => void;
}) {
  const redirectUri = useMemo(() => getRedirectUri(), []);
  const relayServerUrl = currentServerUrl || getDefaultRelayServerUrl();
  const defaultRelayServerUrl = useMemo(() => getDefaultRelayServerUrl(), []);
  const [authConfig, setAuthConfig] = useState<RelayClientAuthConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loading, setLoading] = useState<"oidc" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);

  const oidcMethod = useMemo(() => authConfig?.methods.find(isOidcMethod) || null, [authConfig]);
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
    void loadServerConfig(relayServerUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayServerUrl]);

  async function loadServerConfig(serverUrl: string) {
    setLoadingConfig(true);
    setError(null);
    try {
      const normalized = await setCurrentServerUrl(serverUrl);
      onServerUrlChange(normalized);
      const config = await fetchRelayAuthConfig(normalized);
      setAuthConfig(config);
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

  const showRelayServerUrl = relayServerUrl !== defaultRelayServerUrl;

  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={styles.background}>
        <View style={styles.glowTop} />
        <View style={styles.glowBottom} />
      </View>
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <View style={styles.shell}>
          <View style={styles.topBar}>
            <Text style={styles.kicker}>Relay Access</Text>
            <Pressable
              accessibilityLabel="Open menu"
              accessibilityRole="button"
              onPress={() => setMenuVisible(true)}
              style={({ pressed }) => [styles.menuButton, pressed && styles.menuButtonPressed]}
            >
              <Ionicons color={appPalette.accent} name="ellipsis-vertical" size={18} />
            </Pressable>
          </View>

          <View style={styles.centerBody}>
            <View style={styles.centerStack}>
              <Pressable
                accessibilityLabel="Sign In"
                accessibilityRole="button"
                disabled={loadingConfig || loading !== null || !request || !oidcMethod}
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

                      const payload = await exchangeRelayOidcIdToken(relayServerUrl, oidcMethod.id, tokenResponse.idToken);
                      await finalizeAuthentication(relayServerUrl, oidcMethod.id, payload);
                    })
                    .catch((caught: Error) => setError(caught.message))
                    .finally(() => setLoading(null));
                }}
                style={({ pressed }) => [
                  styles.signInButton,
                  (loadingConfig || loading !== null || !request || !oidcMethod) && styles.signInButtonDisabled,
                  pressed && !(loadingConfig || loading !== null || !request || !oidcMethod) && styles.signInButtonPressed,
                ]}
              >
                <Text style={styles.signInLabel}>{loading === "oidc" ? "Signing In..." : "Sign In"}</Text>
              </Pressable>

              {showRelayServerUrl ? <Text style={styles.relayServerUrl}>{relayServerUrl}</Text> : null}
              {!loadingConfig && !error && !oidcMethod ? (
                <Text style={styles.metaText}>This relay server does not advertise an OIDC sign-in method.</Text>
              ) : null}
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </View>
          </View>
        </View>
      </SafeAreaView>

      <Modal animationType="fade" transparent visible={menuVisible} onRequestClose={() => setMenuVisible(false)}>
        <View style={styles.menuModalRoot}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setMenuVisible(false)} />
          <SafeAreaView edges={["top"]} pointerEvents="box-none" style={styles.menuSafeArea}>
            <View style={styles.menuAnchor}>
              <View style={styles.menuCard}>
                <Pressable
                  accessibilityRole="menuitem"
                  onPress={() => {
                    setMenuVisible(false);
                    onOpenRelayServerSettings();
                  }}
                  style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                >
                  <Text style={styles.menuItemLabel}>Relay Server Settings</Text>
                </Pressable>
              </View>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: appPalette.background,
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  glowTop: {
    position: "absolute",
    top: -120,
    left: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: appPalette.glowTop,
  },
  glowBottom: {
    position: "absolute",
    right: -60,
    bottom: -120,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: appPalette.glowBottom,
  },
  safeArea: {
    flex: 1,
  },
  shell: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 8,
  },
  kicker: {
    color: appPalette.muted,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  menuButton: {
    width: 44,
    height: 44,
    marginRight: __DEV__ ? 56 : 0,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: appPalette.surface,
    borderWidth: 1,
    borderColor: appPalette.border,
  },
  menuButtonPressed: {
    opacity: 0.88,
  },
  centerBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  centerStack: {
    width: "100%",
    maxWidth: 320,
    alignItems: "center",
    gap: 10,
  },
  signInButton: {
    width: "100%",
    minHeight: 56,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: appPalette.accentStrong,
    paddingHorizontal: 22,
    borderWidth: 1,
    borderColor: appPalette.borderStrong,
  },
  signInButtonPressed: {
    opacity: 0.92,
  },
  signInButtonDisabled: {
    opacity: 0.55,
  },
  signInLabel: {
    color: appPalette.text,
    fontSize: 16,
    fontWeight: "700",
  },
  relayServerUrl: {
    color: appPalette.subtle,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  metaText: {
    color: appPalette.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  errorText: {
    color: appPalette.danger,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  menuModalRoot: {
    flex: 1,
  },
  menuSafeArea: {
    flex: 1,
  },
  menuAnchor: {
    alignItems: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  menuCard: {
    minWidth: 220,
    borderRadius: 18,
    backgroundColor: appPalette.surfaceElevated,
    padding: 6,
    borderWidth: 1,
    borderColor: appPalette.border,
  },
  menuItem: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  menuItemPressed: {
    backgroundColor: appPalette.accentSoft,
  },
  menuItemLabel: {
    color: appPalette.text,
    fontSize: 15,
    fontWeight: "600",
  },
});
