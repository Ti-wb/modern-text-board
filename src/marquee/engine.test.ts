import { describe, expect, it } from "vitest";

import { isMarqueeLabVisible, resolveMarqueeEngine } from "./engine";

describe("marquee engine selection", () => {
  it("keeps WAAPI as the production default", () => {
    expect(resolveMarqueeEngine("")).toBe("waapi");
    expect(resolveMarqueeEngine("?marquee-engine=unknown")).toBe("waapi");
  });

  it("selects the CSS experiment only through an explicit query", () => {
    expect(resolveMarqueeEngine("?marquee-engine=css")).toBe("css");
  });

  it("selects the Canvas experiment only through an explicit query", () => {
    expect(resolveMarqueeEngine("?marquee-engine=canvas")).toBe("canvas");
  });

  it("shows the lab switcher only when explicitly requested", () => {
    expect(isMarqueeLabVisible("?marquee-engine=css")).toBe(false);
    expect(isMarqueeLabVisible("?marquee-lab=1&marquee-engine=css")).toBe(true);
  });
});
