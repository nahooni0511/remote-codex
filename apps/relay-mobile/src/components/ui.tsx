import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { appPalette } from "../styles";

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
  return <TextInput placeholderTextColor={appPalette.subtle} style={styles.field} {...props} />;
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
    backgroundColor: appPalette.surface,
    borderRadius: 22,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: appPalette.border,
  },
  cardMuted: {
    backgroundColor: appPalette.accentSoft,
  },
  label: {
    color: appPalette.muted,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  field: {
    backgroundColor: appPalette.surfaceMuted,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: appPalette.borderStrong,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: appPalette.text,
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
    backgroundColor: appPalette.accentStrong,
  },
  buttonSecondary: {
    backgroundColor: appPalette.accentSoft,
  },
  buttonGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: appPalette.borderStrong,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: "700",
  },
  buttonPrimaryLabel: {
    color: appPalette.text,
  },
  buttonSecondaryLabel: {
    color: appPalette.accent,
  },
  buttonGhostLabel: {
    color: appPalette.text,
  },
  errorText: {
    color: appPalette.danger,
    fontSize: 14,
    lineHeight: 20,
  },
});
