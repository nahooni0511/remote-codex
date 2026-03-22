import type { RelayAuthSession } from "@remote-codex/contracts";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { CenteredStatus } from "./src/components/CenteredStatus";
import type { StoredAuth } from "./src/lib/auth";
import {
  clearLegacyAuthStorage,
  clearStoredAuth,
  getCurrentServerUrl,
  getSelectedDeviceId,
  getValidStoredAuth,
  setSelectedDeviceId,
} from "./src/lib/auth";
import { clearAllWorkspaceSessions } from "./src/lib/workspace-session";
import { emptyRelaySession, fetchRelayJson, logoutRelaySession, RelayApiError } from "./src/lib/relay-api";
import {
  isPreviewMode,
  previewDevices,
  previewInitialDeviceId,
  previewInitialProjectId,
  previewInitialThreadId,
  previewSession,
  previewStoredAuth,
  previewWorkspaceByDeviceId,
} from "./src/lib/preview";
import type { AppStackParamList, AuthStackParamList } from "./src/navigation/types";
import { DevicesScreen } from "./src/screens/DevicesScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { WorkspaceChatScreen, WorkspaceProjectsScreen, WorkspaceThreadsScreen } from "./src/screens/WorkspaceScreen";
import { styles } from "./src/styles";

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();

export default function App() {
  const [session, setSession] = useState<RelayAuthSession>(emptyRelaySession());
  const [storedAuth, setStoredAuthState] = useState<StoredAuth | null>(null);
  const [selectedDeviceId, setSelectedDeviceIdState] = useState<string | null>(null);
  const [serverUrl, setServerUrlState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (isPreviewMode) {
      setSession(previewSession);
      setStoredAuthState(previewStoredAuth);
      setSelectedDeviceIdState(previewInitialDeviceId);
      setServerUrlState(previewStoredAuth.serverUrl);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    void clearLegacyAuthStorage()
      .then(() => getCurrentServerUrl())
      .then(async (resolvedServerUrl) => {
        if (cancelled) {
          return;
        }

        setServerUrlState(resolvedServerUrl);
        const [auth, deviceId] = await Promise.all([
          getValidStoredAuth(resolvedServerUrl),
          getSelectedDeviceId(resolvedServerUrl),
        ]);
        if (cancelled) {
          return;
        }

        setSelectedDeviceIdState(deviceId);
        if (!auth?.accessToken) {
          setStoredAuthState(null);
          setSession(emptyRelaySession());
          return;
        }

        try {
          const nextSession = await fetchRelayJson<RelayAuthSession>("/api/session", {}, {
            serverUrl: resolvedServerUrl,
            accessToken: auth.accessToken,
          });
          if (cancelled) {
            return;
          }

          if (!nextSession.user) {
            await clearStoredAuth(resolvedServerUrl);
            setStoredAuthState(null);
            setSession(emptyRelaySession());
            return;
          }

          setStoredAuthState(auth);
          setSession(nextSession);
        } catch (caught) {
          if (caught instanceof RelayApiError && caught.status === 401) {
            await clearStoredAuth(resolvedServerUrl);
          }
          if (cancelled) {
            return;
          }

          setStoredAuthState(null);
          setSession(emptyRelaySession());
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAuthenticated(nextAuth: StoredAuth, nextSession: RelayAuthSession) {
    setServerUrlState(nextAuth.serverUrl);
    setStoredAuthState(nextAuth);
    setSession(nextSession);
  }

  async function handleOpenDevice(deviceId: string) {
    await setSelectedDeviceId(deviceId, storedAuth?.serverUrl || serverUrl || undefined);
    setSelectedDeviceIdState(deviceId);
  }

  async function handleReturnToDevices() {
    await setSelectedDeviceId(null, storedAuth?.serverUrl || serverUrl || undefined);
    setSelectedDeviceIdState(null);
  }

  async function handleSignOut() {
    clearAllWorkspaceSessions();

    if (isPreviewMode) {
      setSelectedDeviceIdState(null);
      return;
    }

    const nextServerUrl = storedAuth?.serverUrl || serverUrl;
    if (storedAuth?.refreshToken && nextServerUrl) {
      await logoutRelaySession(nextServerUrl, storedAuth.refreshToken);
    }

    if (nextServerUrl) {
      await Promise.all([clearStoredAuth(nextServerUrl), setSelectedDeviceId(null, nextServerUrl)]);
    }

    setStoredAuthState(null);
    setSelectedDeviceIdState(null);
    setSession(emptyRelaySession());
  }

  const authenticated = Boolean(session.user && storedAuth?.accessToken);
  const initialAppRouteName = useMemo<keyof AppStackParamList>(() => {
    if (isPreviewMode) {
      if (previewInitialThreadId && previewInitialProjectId && previewInitialDeviceId) {
        return "Chat";
      }

      if (previewInitialProjectId && previewInitialDeviceId) {
        return "Threads";
      }

      if (previewInitialDeviceId) {
        return "Projects";
      }
    }

    return "Devices";
  }, []);

  return (
    <SafeAreaProvider>
      <View style={styles.app}>
        <StatusBar style="dark" />
        {loading ? (
          <CenteredStatus title="Loading relay session" description="Restoring your stored relay authentication." loading />
        ) : (
          <NavigationContainer key={authenticated ? "app" : "auth"}>
            {!authenticated || !storedAuth?.accessToken ? (
              <AuthStack.Navigator screenOptions={{ headerShown: false }}>
                <AuthStack.Screen name="Login">
                  {() => (
                    <LoginScreen
                      currentServerUrl={serverUrl}
                      onAuthenticated={handleAuthenticated}
                      onClearSession={() => void handleSignOut()}
                      onServerUrlChange={setServerUrlState}
                    />
                  )}
                </AuthStack.Screen>
              </AuthStack.Navigator>
            ) : (
              <AppStack.Navigator initialRouteName={initialAppRouteName} screenOptions={{ animation: "slide_from_right", headerShown: false }}>
                <AppStack.Screen name="Devices">
                  {({ navigation }) => (
                    <DevicesScreen
                      authToken={storedAuth.accessToken}
                      onOpenDevice={(deviceId) => {
                        void handleOpenDevice(deviceId).then(() => navigation.navigate("Projects", { deviceId }));
                      }}
                      onSignOut={() => void handleSignOut()}
                      previewDevices={isPreviewMode ? previewDevices : undefined}
                      session={session}
                    />
                  )}
                </AppStack.Screen>
                <AppStack.Screen name="Projects">
                  {({ navigation, route }) => (
                    <WorkspaceProjectsScreen
                      authToken={storedAuth.accessToken}
                      fallbackDeviceId={selectedDeviceId}
                      navigation={navigation}
                      onExitDevice={handleReturnToDevices}
                      onSignOut={handleSignOut}
                      preview={route.params?.deviceId ? previewWorkspaceByDeviceId[route.params.deviceId] || null : null}
                      route={route}
                    />
                  )}
                </AppStack.Screen>
                <AppStack.Screen
                  initialParams={
                    isPreviewMode && previewInitialDeviceId && previewInitialProjectId
                      ? { deviceId: previewInitialDeviceId, projectId: previewInitialProjectId }
                      : undefined
                  }
                  name="Threads"
                >
                  {({ navigation, route }) => (
                    <WorkspaceThreadsScreen
                      authToken={storedAuth.accessToken}
                      navigation={navigation}
                      onSignOut={handleSignOut}
                      preview={previewWorkspaceByDeviceId[route.params.deviceId] || null}
                      route={route}
                    />
                  )}
                </AppStack.Screen>
                <AppStack.Screen
                  initialParams={
                    isPreviewMode && previewInitialDeviceId && previewInitialProjectId && previewInitialThreadId
                      ? {
                          deviceId: previewInitialDeviceId,
                          projectId: previewInitialProjectId,
                          threadId: previewInitialThreadId,
                        }
                      : undefined
                  }
                  name="Chat"
                >
                  {({ navigation, route }) => (
                    <WorkspaceChatScreen
                      authToken={storedAuth.accessToken}
                      authUserName={session.user?.email || ""}
                      navigation={navigation}
                      onSignOut={handleSignOut}
                      preview={previewWorkspaceByDeviceId[route.params.deviceId] || null}
                      route={route}
                    />
                  )}
                </AppStack.Screen>
              </AppStack.Navigator>
            )}
          </NavigationContainer>
        )}
      </View>
    </SafeAreaProvider>
  );
}
