import { renderRichTextHtml } from "../../lib/richText";

export function RichText({ text, className = "" }: { text: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: renderRichTextHtml(text) }} />;
}
