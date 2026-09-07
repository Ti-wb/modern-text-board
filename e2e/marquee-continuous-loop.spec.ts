import { expect, test } from "@playwright/test";

test("continuous return integrates with all directions, speed changes and resize", async ({ page }) => {
  await page.goto("/?marquee-loop=continuous&marquee-raster=0");
  const content = "高速跑馬燈 High speed marquee\n原生文字保持清晰\n循環歸位測試\n第四行測試文字\n第五行測試文字";
  await page.getByRole("main").dblclick();
  await page.getByRole("textbox", { name: /編輯文字|Edit text/ }).fill(content);
  await page.getByRole("button", { name: /套用|Apply/ }).click();
  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
  const panel = page.locator("#tool-panel-marquee");
  await panel.getByRole("button", { name: /啟用跑馬燈|Enable marquee/ }).click();

  const verify = async () => {
    const moving = page.locator(".moving-text.is-marquee");
    await expect(moving).toHaveAttribute("data-marquee-loop", "continuous");
    const snapshots = await moving.locator(".marquee-copy").evaluateAll(async (copies) => {
      const animations = copies.map((copy) => copy.getAnimations()[0]);
      await Promise.all(animations.map((animation) => animation.ready));
      return animations.map((animation) => ({
        frames: (animation.effect as KeyframeEffect).getKeyframes(),
        rate: animation.playbackRate,
        state: animation.playState,
      }));
    });
    expect(snapshots).toHaveLength(2);
    for (const snapshot of snapshots) {
      expect(snapshot.frames).toHaveLength(6);
      expect(snapshot.frames[0].transform).toBe(snapshot.frames.at(-1)!.transform);
      expect(snapshot.rate).toBeGreaterThan(0);
      expect(snapshot.state).toBe("running");
    }
    expect(snapshots[0].frames).toEqual(snapshots[1].frames);
    // The candidate retains actual DOM text, including line breaks.
    await expect(moving.locator(".display-text").first()).toHaveText(content);
    await expect(moving.locator("canvas, img")).toHaveCount(0);
  };

  for (const direction of [/向左|^Left$/, /向右|^Right$/, /向上|^Up$/, /向下|^Down$/]) {
    await panel.getByRole("button", { name: direction }).click();
    await verify();
  }
  await panel.getByRole("slider", { name: /速度|Speed/ }).fill("40");
  await panel.getByRole("button", { name: /關閉|Close/ }).click();
  await page.setViewportSize({ width: 800, height: 600 });
  await verify();
});

test("short copies safely retain the original loop", async ({ page }) => {
  await page.goto("/?marquee-loop=continuous&marquee-raster=0");
  await page.getByRole("main").dblclick();
  await page.getByRole("textbox", { name: /編輯文字|Edit text/ }).fill("i");
  await page.getByRole("button", { name: /套用|Apply/ }).click();
  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
  await page.locator("#tool-panel-marquee").getByRole("button", { name: /啟用跑馬燈|Enable marquee/ }).click();
  const moving = page.locator(".moving-text.is-marquee");
  await expect(moving).toHaveAttribute("data-marquee-loop", "linear");
  const lengths = await moving.locator(".marquee-copy").evaluateAll((copies) => copies.map((copy) =>
    (copy.getAnimations()[0].effect as KeyframeEffect).getKeyframes().length));
  expect(lengths).toEqual([2, 2]);
});
