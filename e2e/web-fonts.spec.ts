import { expect, test, type Page, type TestInfo } from "@playwright/test";

const CHROMIUM_PROJECT = "chromium-1024x768";
const FONT_PANEL_PROJECTS = new Set([
  "chromium-390x844",
  CHROMIUM_PROJECT,
  "webkit",
  "iphone",
  "ipad-landscape",
]);

function skipUnlessProject(testInfo: TestInfo, project: string): void {
  test.skip(
    testInfo.project.name !== project,
    `Runs only in the ${project} project`,
  );
}

function skipUnlessFontPanelProject(testInfo: TestInfo): void {
  test.skip(
    !FONT_PANEL_PROJECTS.has(testInfo.project.name),
    "Runs only in representative phone, tablet, and desktop projects",
  );
}

async function dismissPwaBanner(page: Page): Promise<void> {
  const banner = page.locator(".pwa-status");
  if (!await banner.isVisible().catch(() => false)) return;
  const dismiss = banner.getByRole("button").last();
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
}

async function editBoardText(page: Page, text: string): Promise<void> {
  await page.getByRole("main").dblclick();
  await page.getByRole("textbox", { name: /編輯文字|Edit text/ }).fill(text);
  await page.getByRole("button", { name: /套用|Apply/ }).click();
  await expect(page.locator(".display-text")).toHaveText(text);
}

async function openWebFonts(page: Page) {
  await dismissPwaBanner(page);
  await page.getByRole("button", { name: /字型與字級|Font and size/ }).click();
  const panel = page.locator("#tool-panel-font");
  await panel.getByRole("tab", { name: "Web Fonts" }).click();
  return panel;
}

async function selectWebFont(
  panel: ReturnType<Page["locator"]>,
  name: string,
) {
  const option = panel.locator("button.web-font-option").filter({ hasText: name });
  await option.click();
  await expect(option).toHaveAttribute("aria-pressed", "true", {
    timeout: 20_000,
  });
  await expect(option.locator(".font-load-status")).toHaveText(
    /已載入|Loaded/,
  );
  return option;
}

async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!await page.evaluate(() => navigator.serviceWorker.controller !== null)) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("loads representative Chinese and Latin fonts without a third-party request", async ({
  page,
}, testInfo) => {
  skipUnlessProject(testInfo, CHROMIUM_PROJECT);
  const foreignRequests: string[] = [];
  const fontAssets = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== new URL(page.url()).origin) {
      foreignRequests.push(url.href);
    }
  });
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path.endsWith(".woff2")) fontAssets.add(path);
  });

  await editBoardText(page, "台北車站 Handheld sign");
  const panel = await openWebFonts(page);

  await selectWebFont(panel, "Noto Sans TC");
  await expect.poll(() => page.locator(".moving-text").evaluate(
    (element) => getComputedStyle(element).fontFamily,
  )).toContain("Noto Sans TC Variable");

  await selectWebFont(panel, "Iansui");
  await expect.poll(() => page.locator(".moving-text").evaluate(
    (element) => ({
      family: getComputedStyle(element).fontFamily,
      weight: getComputedStyle(element).fontWeight,
    }),
  )).toEqual(expect.objectContaining({ family: expect.stringContaining("Iansui"), weight: "400" }));

  await selectWebFont(panel, "Lato");
  await expect.poll(() => page.locator(".moving-text").evaluate(
    (element) => getComputedStyle(element).fontFamily,
  )).toContain("Lato");

  await selectWebFont(panel, "Merriweather");
  await expect.poll(() => page.locator(".moving-text").evaluate(
    (element) => getComputedStyle(element).fontFamily,
  )).toContain("Merriweather Variable");

  expect([...fontAssets].some((path) => path.includes("noto-sans-tc"))).toBe(true);
  expect([...fontAssets].some((path) => path.includes("iansui"))).toBe(true);
  expect([...fontAssets].some((path) => path.includes("lato"))).toBe(true);
  expect([...fontAssets].some((path) => path.includes("merriweather"))).toBe(true);
  expect(foreignRequests).toEqual([]);
});

test("reuses selected fonts offline and safely rejects an uncached font", async ({
  context,
  page,
}, testInfo) => {
  skipUnlessProject(testInfo, CHROMIUM_PROJECT);
  await waitForServiceWorkerControl(page);
  await editBoardText(page, "Offline Lato");
  let panel = await openWebFonts(page);
  await selectWebFont(panel, "Lato");

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    panel = await openWebFonts(page);
    await selectWebFont(panel, "Lato");

    const merriweather = panel
      .locator("button.web-font-option")
      .filter({ hasText: "Merriweather" });
    await merriweather.click();
    await expect(merriweather.locator(".font-load-status")).toHaveText(
      /重試|Retry/,
      { timeout: 20_000 },
    );
    await expect(
      panel.locator("button.web-font-option").filter({ hasText: "Lato" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("status")).toContainText(
      /離線時不可用|unavailable offline/,
    );
  } finally {
    await context.setOffline(false);
  }
});

test("keeps the optional font catalog operable in responsive panels", async ({
  page,
}, testInfo) => {
  skipUnlessFontPanelProject(testInfo);
  const panel = await openWebFonts(page);
  const merriweather = panel
    .locator("button.web-font-option")
    .filter({ hasText: "Merriweather" });
  await merriweather.scrollIntoViewIfNeeded();
  await expect(merriweather).toBeVisible();

  const metrics = await panel.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const buttons = [...element.querySelectorAll<HTMLElement>("button.web-font-option")];
    return {
      bottom: bounds.bottom,
      minimumTarget: Math.min(...buttons.map((button) => button.getBoundingClientRect().height)),
      right: bounds.right,
    };
  });
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(metrics.bottom).toBeLessThanOrEqual((viewport?.height ?? 0) + 1);
  expect(metrics.right).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
  expect(metrics.minimumTarget).toBeGreaterThanOrEqual(44);
});
