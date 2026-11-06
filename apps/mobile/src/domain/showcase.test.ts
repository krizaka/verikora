import { isShowcase, noticeStage } from "./showcase";

describe("showcase mode (verikora#1968)", () => {
  it("is on only for 1", () => {
    expect(isShowcase("1")).toBe(true);
    expect(isShowcase(undefined)).toBe(false);
    expect(isShowcase("true")).toBe(false);
  });
  it("draws no development notice when filmed, and the build's stage otherwise", () => {
    expect(noticeStage("dev", true)).toBe("prod");
    expect(noticeStage("dev", false)).toBe("dev");
  });
});
