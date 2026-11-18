import { describe, expect, it } from "vitest";
import { parseTimeInput } from "./timeInput";

describe("parseTimeInput", () => {
  it("passes through well-formed HH:mm", () => {
    expect(parseTimeInput("17:35")).toBe("17:35");
    expect(parseTimeInput("00:00")).toBe("00:00");
  });

  it("parses compact 3-4 digit input", () => {
    expect(parseTimeInput("1735")).toBe("17:35");
    expect(parseTimeInput("935")).toBe("09:35");
  });

  it("pads single-digit hours and minutes", () => {
    expect(parseTimeInput("9:5")).toBe("09:05");
    expect(parseTimeInput("9")).toBe("09:00");
    expect(parseTimeInput("07")).toBe("07:00");
  });

  it("treats trailing colon as :00", () => {
    expect(parseTimeInput("17:")).toBe("17:00");
  });

  it("ignores whitespace", () => {
    expect(parseTimeInput(" 12 : 30 ")).toBe("12:30");
  });

  it("rejects out-of-range values", () => {
    expect(parseTimeInput("24:00")).toBeNull();
    expect(parseTimeInput("17:60")).toBeNull();
    expect(parseTimeInput("2360")).toBeNull();
  });

  it("rejects garbage", () => {
    expect(parseTimeInput("ab")).toBeNull();
    expect(parseTimeInput("")).toBeNull();
    expect(parseTimeInput(":")).toBeNull();
    expect(parseTimeInput(":30")).toBeNull();
    expect(parseTimeInput("1:2:3")).toBeNull();
  });
});
