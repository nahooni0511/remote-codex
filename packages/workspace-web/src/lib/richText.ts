import { renderRichTextHtml as renderSharedRichTextHtml } from "@remote-codex/client-core";

export function renderRichTextHtml(text: string): string {
  return renderSharedRichTextHtml(text, {
    baseUrl: typeof window !== "undefined" ? window.location.origin : "http://localhost",
  });
}
