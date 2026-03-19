import type { RelayAuthSession } from "@remote-codex/contracts";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { CenteredStatus } from "./src/components/CenteredStatus";
import type { StoredAuth } from "./src/lib/auth";
import { clearStoredAuth, getSelectedDeviceId, getValidStoredAuth, setSelectedDeviceId } from "./src/lib/auth";
import { clearAllWorkspaceSessions } from "./src/lib/workspace-session";
import { emptyRelaySession, fetchRelayJson, RelayApiError } from "./src/lib/relay-api";
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (isPreviewMode) {
      setSession(previewSession);
      setStoredAuthState(previewStoredAuth);
      setSelectedDeviceIdState(previewInitialDeviceId);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    void Promise.all([getValidStoredAuth(), getSelectedDeviceId()])
      .then(async ([auth, deviceId]) => {
        if (cancelled) {
          return;
        }

        setSelectedDeviceIdState(deviceId);
        if (!auth?.idToken) {
          setStoredAuthState(null);
          setSession(emptyRelaySession());
          return;
        }

        try {
          const nextSession = await fetchRelayJson<RelayAuthSession>("/api/session", {}, auth.idToken);
          if (cancelled) {
            return;
          }

          if (!nextSession.user) {
            await clearStoredAuth();
            setStoredAuthState(null);
            setSession(emptyRelaySession());
            return;
          }

          setStoredAuthState(auth);
          setSession(nextSession);
        } catch (caught) {
          if (caught instanceof RelayApiError && caught.status === 401) {
            await clearStoredAuth();
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
    setStoredAuthState(nextAuth);
    setSession(nextSession);
  }

  async function handleOpenDevice(deviceId: string) {
    await setSelectedDeviceId(deviceId);
    setSelectedDeviceIdState(deviceId);
  }

  async function handleReturnToDevices() {
    await setSelectedDeviceId(null);
    setSelectedDeviceIdState(null);
  }

  async function handleSignOut() {
    clearAllWorkspaceSessions();

    if (isPreviewMode) {
      setSelectedDeviceIdState(null);
      return;
    }

    await Promise.all([clearStoredAuth(), setSelectedDeviceId(null)]);
    setStoredAuthState(null);
    setSelectedDeviceIdState(null);
    setSession(emptyRelaySession());
  }

  const authenticated = Boolean(session.user && storedAuth?.idToken);
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

    return selectedDeviceId ? "Projects" : "Devices";
  }, [selectedDeviceId]);

  return (
    <SafeAreaProvider>
      <View style={styles.app}>
        <StatusBar style="dark" />
        {loading ? (
          <CenteredStatus title="Loading relay session" description="Restoring your stored relay authentication." loading />
        ) : (
          <NavigationContainer key={authenticated ? "app" : "auth"}>
            {!authenticated || !storedAuth?.idToken ? (
              <AuthStack.Navigator screenOptions={{ headerShown: false }}>
                <AuthStack.Screen name="Login">
                  {() => <LoginScreen onAuthenticated={handleAuthenticated} onClearSession={() => void handleSignOut()} />}
                </AuthStack.Screen>
              </AuthStack.Navigator>
            ) : (
              <AppStack.Navigator initialRouteName={initialAppRouteName} screenOptions={{ animation: "slide_from_right", headerShown: false }}>
                <AppStack.Screen name="Devices">
                  {({ navigation }) => (
                    <DevicesScreen
                      authToken={storedAuth.idToken}
                      onOpenDevice={(deviceId) => {
                        void handleOpenDevice(deviceId).then(() => navigation.navigate("Projects", { deviceId }));
                      }}
                      onSignOut={() => void handleSignOut()}
                      previewDevices={isPreviewMode ? previewDevices : undefined}
                      session={session}
                    />
                  )}
                </AppStack.Screen>
                <AppStack.Screen
                  initialParams={selectedDeviceId ? { deviceId: selectedDeviceId } : undefined}
                  name="Projects"
                >
                  {({ navigation, route }) => (
                    <WorkspaceProjectsScreen
                      authToken={storedAuth.idToken}
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
                      authToken={storedAuth.idToken}
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
                      authToken={storedAuth.idToken}
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
