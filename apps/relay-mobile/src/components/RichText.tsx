import {
  parseRichText,
  sanitizeRichTextUrl,
  type RichTextBlockNode,
  type RichTextInlineNode,
} from "@remote-codex/client-core";
import { Fragment, useMemo } from "react";
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

type RichTextTone = "codex" | "muted" | "inverse";

type RichTextTheme = {
  text: string;
  muted: string;
  link: string;
  inlineCodeBackground: string;
  inlineCodeText: string;
  codeShell: string;
  quoteBorder: string;
  quoteBackground: string;
  rule: string;
};

const themes: Record<RichTextTone, RichTextTheme> = {
  codex: {
    text: "#f5f8f7",
    muted: "#aab4b2",
    link: "#8ed0ff",
    inlineCodeBackground: "rgba(255, 255, 255, 0.08)",
    inlineCodeText: "#ffffff",
    codeShell: "#10171a",
    quoteBorder: "rgba(164, 179, 175, 0.35)",
    quoteBackground: "rgba(255, 255, 255, 0.04)",
    rule: "rgba(255, 255, 255, 0.12)",
  },
  muted: {
    text: "#a6b0ad",
    muted: "#8d9794",
    link: "#9bcff4",
    inlineCodeBackground: "rgba(255, 255, 255, 0.05)",
    inlineCodeText: "#d8e3df",
    codeShell: "#10171a",
    quoteBorder: "rgba(150, 161, 158, 0.28)",
    quoteBackground: "rgba(255, 255, 255, 0.03)",
    rule: "rgba(255, 255, 255, 0.08)",
  },
  inverse: {
    text: "#ffffff",
    muted: "rgba(255, 255, 255, 0.75)",
    link: "#d4fffb",
    inlineCodeBackground: "rgba(255, 255, 255, 0.12)",
    inlineCodeText: "#ffffff",
    codeShell: "rgba(0, 0, 0, 0.2)",
    quoteBorder: "rgba(255, 255, 255, 0.3)",
    quoteBackground: "rgba(255, 255, 255, 0.06)",
    rule: "rgba(255, 255, 255, 0.12)",
  },
};

function openLink(url: string) {
  const safeUrl = sanitizeRichTextUrl(url);
  if (!safeUrl) {
    return;
  }

  void Linking.openURL(safeUrl);
}

function renderInlineNode(node: RichTextInlineNode, theme: RichTextTheme, key: string): React.ReactNode {
  if (node.type === "text") {
    return (
      <Text key={key} style={{ color: theme.text }}>
        {node.text}
      </Text>
    );
  }

  if (node.type === "lineBreak") {
    return (
      <Text key={key} style={{ color: theme.text }}>
        {"\n"}
      </Text>
    );
  }

  if (node.type === "code") {
    return (
      <Text
        key={key}
        style={[
          styles.inlineCode,
          {
            backgroundColor: theme.inlineCodeBackground,
            color: theme.inlineCodeText,
          },
        ]}
      >
        {node.text}
      </Text>
    );
  }

  if (node.type === "link") {
    return (
      <Text key={key} onPress={() => openLink(node.url)} style={[styles.link, { color: theme.link }]}>
        {node.label}
      </Text>
    );
  }

  const content = node.children.map((child, index) => renderInlineNode(child, theme, `${key}-${index}`));

  if (node.type === "strong") {
    return (
      <Text key={key} style={{ color: theme.text, fontWeight: "700" }}>
        {content}
      </Text>
    );
  }

  if (node.type === "emphasis") {
    return (
      <Text key={key} style={{ color: theme.text, fontStyle: "italic" }}>
        {content}
      </Text>
    );
  }

  return (
    <Text key={key} style={{ color: theme.text, textDecorationLine: "line-through" }}>
      {content}
    </Text>
  );
}

function renderInlineContent(nodes: RichTextInlineNode[], theme: RichTextTheme, prefix: string) {
  return nodes.map((node, index) => renderInlineNode(node, theme, `${prefix}-${index}`));
}

function headingFontSize(level: number) {
  if (level <= 1) {
    return 28;
  }
  if (level === 2) {
    return 24;
  }
  if (level === 3) {
    return 20;
  }
  return 18;
}

function renderBlockNode(node: RichTextBlockNode, theme: RichTextTheme, key: string): React.ReactNode {
  if (node.type === "paragraph") {
    return (
      <Text key={key} selectable style={[styles.blockText, { color: theme.text }]}>
        {renderInlineContent(node.children, theme, key)}
      </Text>
    );
  }

  if (node.type === "heading") {
    return (
      <Text
        key={key}
        selectable
        style={[
          styles.heading,
          {
            color: theme.text,
            fontSize: headingFontSize(node.level),
          },
        ]}
      >
        {renderInlineContent(node.children, theme, key)}
      </Text>
    );
  }

  if (node.type === "list") {
    return (
      <View key={key} style={styles.list}>
        {node.items.map((item, index) => (
          <View key={`${key}-${index}`} style={styles.listRow}>
            <Text selectable style={[styles.listMarker, { color: theme.muted }]}>
              {node.ordered ? `${index + 1}.` : "•"}
            </Text>
            <Text selectable style={[styles.blockText, styles.listItemText, { color: theme.text }]}>
              {renderInlineContent(item, theme, `${key}-${index}`)}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  if (node.type === "blockquote") {
    return (
      <View
        key={key}
        style={[
          styles.quote,
          {
            borderLeftColor: theme.quoteBorder,
            backgroundColor: theme.quoteBackground,
          },
        ]}
      >
        {node.children.map((child, index) => (
          <Fragment key={`${key}-${index}`}>{renderBlockNode(child, theme, `${key}-${index}`)}</Fragment>
        ))}
      </View>
    );
  }

  if (node.type === "rule") {
    return <View key={key} style={[styles.rule, { backgroundColor: theme.rule }]} />;
  }

  return (
    <View key={key} style={[styles.codeShell, { backgroundColor: theme.codeShell }]}>
      {node.language ? <Text style={[styles.codeLanguage, { color: theme.muted }]}>{node.language}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text selectable style={[styles.codeText, { color: theme.inlineCodeText }]}>
          {node.code}
        </Text>
      </ScrollView>
    </View>
  );
}

export function RichText({
  text,
  tone = "codex",
}: {
  text: string;
  tone?: RichTextTone;
}) {
  const blocks = useMemo(() => parseRichText(text), [text]);
  const theme = themes[tone];

  if (!blocks.length) {
    return null;
  }

  return (
    <View style={styles.root}>
      {blocks.map((block, index) => (
        <Fragment key={`${block.type}-${index}`}>{renderBlockNode(block, theme, `${block.type}-${index}`)}</Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 14,
  },
  blockText: {
    fontSize: 16,
    lineHeight: 25,
  },
  heading: {
    fontWeight: "700",
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  inlineCode: {
    borderRadius: 8,
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
    fontSize: 14,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  link: {
    textDecorationLine: "underline",
  },
  list: {
    gap: 8,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  listMarker: {
    width: 24,
    fontSize: 15,
    lineHeight: 25,
    textAlign: "right",
  },
  listItemText: {
    flex: 1,
  },
  quote: {
    borderLeftWidth: 3,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  rule: {
    height: 1,
    borderRadius: 999,
    marginVertical: 6,
  },
  codeShell: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
  },
  codeLanguage: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  codeText: {
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
    fontSize: 13,
    lineHeight: 20,
  },
});
