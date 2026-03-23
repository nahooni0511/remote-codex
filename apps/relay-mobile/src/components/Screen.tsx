import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { appPalette } from "../styles";

type ScreenProps = {
  title: string;
  subtitle?: string | null;
  centered?: boolean;
  children?: ReactNode;
};

export function Screen({ title, subtitle, centered = false, children }: ScreenProps) {
  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={styles.background}>
        <View style={styles.glowTop} />
        <View style={styles.glowBottom} />
      </View>
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <ScrollView contentContainerStyle={[styles.content, centered && styles.contentCentered]}>
          <View style={[styles.header, centered && styles.headerCentered]}>
            <Text style={styles.kicker}>Relay Access</Text>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {children}
        </ScrollView>
      </SafeAreaView>
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
  content: {
    padding: 20,
    gap: 18,
    minHeight: "100%",
  },
  contentCentered: {
    justifyContent: "center",
  },
  header: {
    gap: 10,
    padding: 22,
    borderRadius: 26,
    backgroundColor: appPalette.surfaceElevated,
    borderWidth: 1,
    borderColor: appPalette.border,
  },
  headerCentered: {
    maxWidth: 480,
  },
  kicker: {
    color: appPalette.muted,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    color: appPalette.text,
    fontSize: 30,
    fontWeight: "800",
  },
  subtitle: {
    color: appPalette.muted,
    fontSize: 15,
    lineHeight: 22,
  },
});
