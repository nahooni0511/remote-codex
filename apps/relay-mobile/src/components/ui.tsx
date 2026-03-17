import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Field(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor="#94a3b8" style={styles.field} {...props} />;
}

export function Button({
  label,
  onPress,
  disabled,
  tone = "primary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "primary" | "ghost";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, tone === "ghost" ? styles.buttonGhost : styles.buttonPrimary, disabled && styles.buttonDisabled]}
    >
      <Text style={[styles.buttonLabel, tone === "ghost" ? styles.buttonGhostLabel : styles.buttonPrimaryLabel]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={styles.errorText}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 18,
    gap: 12,
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  label: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  field: {
    backgroundColor: "#f8fafc",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#0f172a",
    fontSize: 16,
  },
  button: {
    alignItems: "center",
    borderRadius: 14,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  buttonPrimary: {
    backgroundColor: "#ea580c",
  },
  buttonGhost: {
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "#fdba74",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: "700",
  },
  buttonPrimaryLabel: {
    color: "#fff7ed",
  },
  buttonGhostLabel: {
    color: "#9a3412",
  },
  errorText: {
    color: "#b91c1c",
    fontSize: 14,
    lineHeight: 20,
  },
});
