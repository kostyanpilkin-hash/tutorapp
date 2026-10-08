import { describe, expect, it } from "vitest";
import { hrefFor, splitLinkText, textHasLinks } from "./linkify";

describe("splitLinkText", () => {
  it("keeps plain text", () => {
    expect(splitLinkText("просто текст")).toEqual([{ type: "text", value: "просто текст" }]);
  });

  it("extracts http(s) urls", () => {
    expect(splitLinkText("доска https://miro.com/app/board/abc и ещё")).toEqual([
      { type: "text", value: "доска " },
      { type: "url", value: "https://miro.com/app/board/abc" },
      { type: "text", value: " и ещё" },
    ]);
  });

  it("strips trailing punctuation from urls", () => {
    expect(splitLinkText("см. https://example.com.")).toEqual([
      { type: "text", value: "см. " },
      { type: "url", value: "https://example.com" },
      { type: "text", value: "." },
    ]);
  });

  it("recognizes www links", () => {
    expect(splitLinkText("www.example.com/x")).toEqual([
      { type: "url", value: "www.example.com/x" },
    ]);
  });
});

describe("hrefFor", () => {
  it("adds https for www", () => {
    expect(hrefFor("www.example.com")).toBe("https://www.example.com");
  });
});

describe("textHasLinks", () => {
  it("detects urls", () => {
    expect(textHasLinks("нет")).toBe(false);
    expect(textHasLinks("https://a.com")).toBe(true);
  });
});
