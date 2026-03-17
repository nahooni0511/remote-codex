function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeMessageUrl(rawUrl: string): string | null {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("/") || trimmed.startsWith("#")) {
    return escapeHtml(trimmed);
  }

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol)) {
      return escapeHtml(parsed.href);
    }
  } catch {
    return null;
  }

  return null;
}

function renderInlineMarkdown(text: string): string {
  const source = String(text || "");
  const tokens: string[] = [];
  const saveToken = (html: string) => {
    const token = `@@MDTOKEN${tokens.length}@@`;
    tokens.push(html);
    return token;
  };

  let normalized = source.replace(/`([^`\n]+)`/g, (_, code: string) => saveToken(`<code>${escapeHtml(code)}</code>`));
  normalized = normalized.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
    const safeUrl = sanitizeMessageUrl(url);
    if (!safeUrl) {
      return `${label} (${url})`;
    }

    return saveToken(`<a href="${safeUrl}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`);
  });

  normalized = escapeHtml(normalized)
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/_([^_\n]+)_/g, "<em>$1</em>");

  return normalized.replace(/@@MDTOKEN(\d+)@@/g, (_match, index: string) => tokens[Number(index)] || "");
}

function renderMarkdownParagraph(lines: string[]): string {
  return `<p>${renderInlineMarkdown(lines.join("\n")).replace(/\n/g, "<br />")}</p>`;
}

function renderMarkdownText(text: string): string {
  const source = String(text || "").replace(/\r\n?/g, "\n");
  const lines = source.split("\n");
  const fragments: string[] = [];
  let paragraphLines: string[] = [];
  let listType: "ol" | "ul" | null = null;
  let listItems: string[] = [];
  let quoteLines: string[] = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) {
      return;
    }
    fragments.push(renderMarkdownParagraph(paragraphLines));
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listType || !listItems.length) {
      listType = null;
      listItems = [];
      return;
    }

    fragments.push(`<${listType}>${listItems.map((item) => `<li>${item}</li>`).join("")}</${listType}>`);
    listType = null;
    listItems = [];
  };

  const flushQuote = () => {
    if (!quoteLines.length) {
      return;
    }

    fragments.push(`<blockquote>${renderMarkdownText(quoteLines.join("\n"))}</blockquote>`);
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
      const level = Math.min(headingMatch[1].length, 6);
      fragments.push(`<h${level}>${renderInlineMarkdown(headingMatch[2].trim())}</h${level}>`);
      return;
    }

    if (isRule) {
      flushAll();
      fragments.push("<hr />");
      return;
    }

    if (orderedMatch) {
      flushParagraph();
      flushQuote();
      if (listType !== "ol") {
        flushList();
        listType = "ol";
      }
      listItems.push(renderInlineMarkdown(orderedMatch[1]));
      return;
    }

    if (unorderedMatch) {
      flushParagraph();
      flushQuote();
      if (listType !== "ul") {
        flushList();
        listType = "ul";
      }
      listItems.push(renderInlineMarkdown(unorderedMatch[1]));
      return;
    }

    flushList();
    flushQuote();
    paragraphLines.push(line);
  });

  flushAll();
  return fragments.join("");
}

export function renderRichTextHtml(text: string): string {
  const source = String(text || "");
  const parts = source.split(/```/);

  return parts
    .map((part, index) => {
      if (index % 2 === 1) {
        const normalized = part.replace(/^\n/, "");
        const firstBreak = normalized.indexOf("\n");
        const language = firstBreak >= 0 ? normalized.slice(0, firstBreak).trim() : "";
        const codeBody = firstBreak >= 0 ? normalized.slice(firstBreak + 1) : normalized;

        return `
          <div class="message-code-shell">
            ${language ? `<div class="message-code-lang">${escapeHtml(language)}</div>` : ""}
            <pre class="message-code-block"><code>${escapeHtml(codeBody.replace(/\n$/, ""))}</code></pre>
          </div>
        `;
      }

      return renderMarkdownText(part);
    })
    .join("");
}
