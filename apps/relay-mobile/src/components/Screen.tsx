import type { ReactNode } from "react";
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

type ScreenProps = {
  title: string;
  subtitle?: string | null;
  loading?: boolean;
  children?: ReactNode;
};

export function Screen({ title, subtitle, loading, children }: ScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.kicker}>Remote Relay</Text>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {loading ? <ActivityIndicator color="#f97316" size="large" style={styles.loader} /> : null}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  content: {
    padding: 20,
    gap: 18,
  },
  header: {
    gap: 8,
  },
  kicker: {
    color: "#c2410c",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    color: "#0f172a",
    fontSize: 28,
    fontWeight: "800",
  },
  subtitle: {
    color: "#475569",
    fontSize: 15,
    lineHeight: 22,
  },
  loader: {
    marginVertical: 12,
  },
});
