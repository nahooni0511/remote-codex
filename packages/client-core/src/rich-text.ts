export type RichTextInlineNode =
  | { type: "text"; text: string }
  | { type: "lineBreak" }
  | { type: "code"; text: string }
  | { type: "link"; label: string; url: string }
  | { type: "strong"; children: RichTextInlineNode[] }
  | { type: "emphasis"; children: RichTextInlineNode[] }
  | { type: "strikethrough"; children: RichTextInlineNode[] };

export type RichTextBlockNode =
  | { type: "paragraph"; children: RichTextInlineNode[] }
  | { type: "heading"; level: number; children: RichTextInlineNode[] }
  | { type: "list"; ordered: boolean; items: RichTextInlineNode[][] }
  | { type: "blockquote"; children: RichTextBlockNode[] }
  | { type: "rule" }
  | { type: "codeBlock"; language: string | null; code: string };

type RichTextHtmlOptions = {
  baseUrl?: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function sanitizeRichTextUrl(rawUrl: string, baseUrl = "http://localhost"): string | null {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("/") || trimmed.startsWith("#")) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed, baseUrl);
    if (["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol)) {
      return parsed.href;
    }
  } catch {
    return null;
  }

  return null;
}

function compactInlineNodes(nodes: RichTextInlineNode[]): RichTextInlineNode[] {
  return nodes.reduce<RichTextInlineNode[]>((accumulator, node) => {
    if (
      node.type === "text" &&
      accumulator.length &&
      accumulator[accumulator.length - 1]?.type === "text"
    ) {
      const previous = accumulator[accumulator.length - 1] as { type: "text"; text: string };
      previous.text += node.text;
      return accumulator;
    }

    accumulator.push(node);
    return accumulator;
  }, []);
}

function parseInline(text: string): RichTextInlineNode[] {
  const tokens: RichTextInlineNode[] = [];
  const saveToken = (node: RichTextInlineNode) => {
    const token = `@@RTNODE${tokens.length}@@`;
    tokens.push(node);
    return token;
  };

  let normalized = String(text || "");
  normalized = normalized.replace(/`([^`\n]+)`/g, (_match, code: string) => saveToken({ type: "code", text: code }));
  normalized = normalized.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) =>
    saveToken({ type: "link", label, url }),
  );

  const replaceInlineToken = (
    source: string,
    expression: RegExp,
    createNode: (children: RichTextInlineNode[]) => RichTextInlineNode,
  ) => source.replace(expression, (_match, content: string) => saveToken(createNode(parseInline(content))));

  normalized = replaceInlineToken(normalized, /~~([^~]+)~~/g, (children) => ({ type: "strikethrough", children }));
  normalized = replaceInlineToken(normalized, /\*\*([^*]+)\*\*/g, (children) => ({ type: "strong", children }));
  normalized = replaceInlineToken(normalized, /__([^_]+)__/g, (children) => ({ type: "strong", children }));
  normalized = replaceInlineToken(normalized, /\*([^*\n]+)\*/g, (children) => ({ type: "emphasis", children }));
  normalized = replaceInlineToken(normalized, /_([^_\n]+)_/g, (children) => ({ type: "emphasis", children }));

  const parts = normalized.split(/(@@RTNODE\d+@@)/g).filter(Boolean);
  const nodes = parts.map<RichTextInlineNode>((part) => {
    const match = part.match(/^@@RTNODE(\d+)@@$/);
    if (!match) {
      return { type: "text", text: part };
    }

    return tokens[Number(match[1])] || { type: "text", text: part };
  });

  return compactInlineNodes(nodes);
}

function parseInlineLines(lines: string[]): RichTextInlineNode[] {
  const output: RichTextInlineNode[] = [];
  lines.forEach((line, index) => {
    if (index > 0) {
      output.push({ type: "lineBreak" });
    }
    output.push(...parseInline(line));
  });
  return compactInlineNodes(output);
}

function parseMarkdownBlocks(text: string): RichTextBlockNode[] {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: RichTextBlockNode[] = [];
  let paragraphLines: string[] = [];
  let listOrdered: boolean | null = null;
  let listItems: RichTextInlineNode[][] = [];
  let quoteLines: string[] = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) {
      return;
    }

    blocks.push({
      type: "paragraph",
      children: parseInlineLines(paragraphLines),
    });
    paragraphLines = [];
  };

  const flushList = () => {
    if (listOrdered === null || !listItems.length) {
      listOrdered = null;
      listItems = [];
      return;
    }

    blocks.push({
      type: "list",
      ordered: listOrdered,
      items: listItems,
    });
    listOrdered = null;
    listItems = [];
  };

  const flushQuote = () => {
    if (!quoteLines.length) {
      return;
    }

    blocks.push({
      type: "blockquote",
      children: parseMarkdownBlocks(quoteLines.join("\n")),
    });
    quoteLines = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    const unorderedMatch = line.match(/^[-+*]\s+(.*)$/);
    const quoteMatch = line.match(/^>\s?(.*)$/);
    const isRule = /^([-*_]\s*){3,}$/.test(trimmed);

    if (!trimmed) {
      flushAll();
      return;
    }

    if (quoteMatch) {
      flushParagraph();
      flushList();
      quoteLines.push(quoteMatch[1]);
      return;
    }

    if (headingMatch) {
      flushAll();
      blocks.push({
        type: "heading",
        level: Math.min(headingMatch[1].length, 6),
        children: parseInline(headingMatch[2].trim()),
      });
      return;
    }

    if (isRule) {
      flushAll();
      blocks.push({ type: "rule" });
      return;
    }

    if (orderedMatch) {
      flushParagraph();
      flushQuote();
      if (listOrdered !== true) {
        flushList();
        listOrdered = true;
      }
      listItems.push(parseInline(orderedMatch[1]));
      return;
    }

    if (unorderedMatch) {
      flushParagraph();
      flushQuote();
      if (listOrdered !== false) {
        flushList();
        listOrdered = false;
      }
      listItems.push(parseInline(unorderedMatch[1]));
      return;
    }

    flushList();
    flushQuote();
    paragraphLines.push(line);
  });

  flushAll();
  return blocks;
}

export function parseRichText(text: string): RichTextBlockNode[] {
  const source = String(text || "").replace(/\r\n?/g, "\n");
  const parts = source.split(/```/);
  const blocks: RichTextBlockNode[] = [];

  parts.forEach((part, index) => {
    if (!part && index % 2 === 0) {
      return;
    }

    if (index % 2 === 1) {
      const normalized = part.replace(/^\n/, "");
      const firstBreak = normalized.indexOf("\n");
      const language = firstBreak >= 0 ? normalized.slice(0, firstBreak).trim() : "";
      const code = firstBreak >= 0 ? normalized.slice(firstBreak + 1) : normalized;

      blocks.push({
        type: "codeBlock",
        language: language || null,
        code: code.replace(/\n$/, ""),
      });
      return;
    }

    blocks.push(...parseMarkdownBlocks(part));
  });

  return blocks;
}

function renderInlineHtml(node: RichTextInlineNode, options: Required<RichTextHtmlOptions>): string {
  if (node.type === "text") {
    return escapeHtml(node.text);
  }

  if (node.type === "lineBreak") {
    return "<br />";
  }

  if (node.type === "code") {
    return `<code>${escapeHtml(node.text)}</code>`;
  }

  if (node.type === "link") {
    const safeUrl = sanitizeRichTextUrl(node.url, options.baseUrl);
    if (!safeUrl) {
      return `${escapeHtml(node.label)} (${escapeHtml(node.url)})`;
    }

    return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">${escapeHtml(node.label)}</a>`;
  }

  const content = node.children.map((child) => renderInlineHtml(child, options)).join("");
  if (node.type === "strong") {
    return `<strong>${content}</strong>`;
  }
  if (node.type === "emphasis") {
    return `<em>${content}</em>`;
  }
  return `<s>${content}</s>`;
}

function renderBlockHtml(node: RichTextBlockNode, options: Required<RichTextHtmlOptions>): string {
  if (node.type === "paragraph") {
    return `<p>${node.children.map((child) => renderInlineHtml(child, options)).join("")}</p>`;
  }

  if (node.type === "heading") {
    const level = Math.min(Math.max(node.level, 1), 6);
    return `<h${level}>${node.children.map((child) => renderInlineHtml(child, options)).join("")}</h${level}>`;
  }

  if (node.type === "list") {
    const tag = node.ordered ? "ol" : "ul";
    return `<${tag}>${node.items
      .map((item) => `<li>${item.map((child) => renderInlineHtml(child, options)).join("")}</li>`)
      .join("")}</${tag}>`;
  }

  if (node.type === "blockquote") {
    return `<blockquote>${node.children.map((child) => renderBlockHtml(child, options)).join("")}</blockquote>`;
  }

  if (node.type === "rule") {
    return "<hr />";
  }

  return `
    <div class="message-code-shell">
      ${node.language ? `<div class="message-code-lang">${escapeHtml(node.language)}</div>` : ""}
      <pre class="message-code-block"><code>${escapeHtml(node.code)}</code></pre>
    </div>
  `;
}

export function renderRichTextHtml(text: string, options: RichTextHtmlOptions = {}): string {
  const resolvedOptions: Required<RichTextHtmlOptions> = {
    baseUrl: options.baseUrl || "http://localhost",
  };

  return parseRichText(text)
    .map((node) => renderBlockHtml(node, resolvedOptions))
    .join("");
}
