import { ActivityIndicator, Text } from "react-native";

import { appPalette, styles } from "../styles";
import { Screen } from "./Screen";
import { Card } from "./ui";

type CenteredStatusProps = {
  title: string;
  description?: string | null;
  tone?: "default" | "error";
  loading?: boolean;
};

export function CenteredStatus({ title, description, tone = "default", loading = false }: CenteredStatusProps) {
  return (
    <Screen centered title={title} subtitle={description}>
      <Card>
        <Text style={styles.statusTitle}>{title}</Text>
        {description ? <Text style={tone === "error" ? styles.errorText : styles.meta}>{description}</Text> : null}
        {loading ? <ActivityIndicator color={appPalette.accent} size="large" /> : null}
      </Card>
    </Screen>
  );
}
