import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

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
    backgroundColor: "#fbfaf5",
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
    backgroundColor: "rgba(255, 219, 170, 0.5)",
  },
  glowBottom: {
    position: "absolute",
    right: -60,
    bottom: -120,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "rgba(15, 97, 93, 0.08)",
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
    backgroundColor: "#133938",
    shadowColor: "#133938",
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  headerCentered: {
    maxWidth: 480,
  },
  kicker: {
    color: "rgba(247, 243, 235, 0.8)",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    color: "#f7f3eb",
    fontSize: 30,
    fontWeight: "800",
  },
  subtitle: {
    color: "rgba(247, 243, 235, 0.82)",
    fontSize: 15,
    lineHeight: 22,
  },
});
