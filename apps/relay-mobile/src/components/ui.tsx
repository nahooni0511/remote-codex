import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

export function Card({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "muted";
}) {
  return <View style={[styles.card, tone === "muted" && styles.cardMuted]}>{children}</View>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Field(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor="#8b7b69" style={styles.field} {...props} />;
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
  tone?: "primary" | "secondary" | "ghost";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        tone === "ghost" ? styles.buttonGhost : tone === "secondary" ? styles.buttonSecondary : styles.buttonPrimary,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          tone === "ghost" ? styles.buttonGhostLabel : tone === "secondary" ? styles.buttonSecondaryLabel : styles.buttonPrimaryLabel,
        ]}
      >
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
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    borderRadius: 22,
    padding: 18,
    gap: 12,
    shadowColor: "#211b12",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  cardMuted: {
    backgroundColor: "rgba(15, 97, 93, 0.06)",
  },
  label: {
    color: "#655647",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  field: {
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(15, 97, 93, 0.18)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#211b12",
    fontSize: 16,
  },
  button: {
    alignItems: "center",
    borderRadius: 999,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  buttonPrimary: {
    backgroundColor: "#0f615d",
  },
  buttonSecondary: {
    backgroundColor: "rgba(15, 97, 93, 0.12)",
  },
  buttonGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(15, 97, 93, 0.2)",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: "700",
  },
  buttonPrimaryLabel: {
    color: "#f8f5ee",
  },
  buttonSecondaryLabel: {
    color: "#0f615d",
  },
  buttonGhostLabel: {
    color: "#0f615d",
  },
  errorText: {
    color: "#ae402d",
    fontSize: 14,
    lineHeight: 20,
  },
});
