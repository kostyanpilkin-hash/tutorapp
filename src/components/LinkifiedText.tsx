import { openUrl } from "@tauri-apps/plugin-opener";
import { hrefFor, splitLinkText } from "@/lib/linkify";
import { cn } from "@/lib/utils";

interface Props {
  text: string;
  className?: string;
}

export function LinkifiedText({ text, className }: Props) {
  if (!text) return null;
  const parts = splitLinkText(text);
  return (
    <p className={cn("whitespace-pre-wrap break-words", className)}>
      {parts.map((part, i) =>
        part.type === "url" ? (
          <a
            key={`${part.value}-${i}`}
            href={hrefFor(part.value)}
            className="text-primary underline underline-offset-2 hover:opacity-80"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void openUrl(hrefFor(part.value));
            }}
          >
            {part.value}
          </a>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </p>
  );
}
