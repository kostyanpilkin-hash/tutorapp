export type TextPart = { type: "text"; value: string } | { type: "url"; value: string };

const LINK_RE = /(https?:\/\/[^\s<>"'\\]+|www\.[^\s<>"'\\]+)/gi;
const TRAILING_PUNCT_RE = /[.,;:!?)\]]+$/;

export function hrefFor(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.toLowerCase().startsWith("www.")) return `https://${url}`;
  return url;
}

export function splitLinkText(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const raw = match[0];
    const index = match.index ?? 0;
    const trimmed = raw.replace(TRAILING_PUNCT_RE, "");
    if (!trimmed) continue;
    if (index > last) parts.push({ type: "text", value: text.slice(last, index) });
    parts.push({ type: "url", value: trimmed });
    last = index + trimmed.length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

export function textHasLinks(text: string): boolean {
  return splitLinkText(text).some((p) => p.type === "url");
}
