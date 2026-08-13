/* global console, document, performance, PerformanceObserver, process, requestAnimationFrame */
import { chromium } from "playwright";

const baseUrl = process.env.PERF_BASE_URL ?? "http://127.0.0.1:4173";
const cpuRate = Number(process.env.PERF_CPU_RATE ?? 6);
const durationMs = Number(process.env.PERF_DURATION_MS ?? 10_000);
const browser = await chromium.launch();

try {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 1024, height: 768 },
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  const pwaBanner = page.locator(".pwa-status");
  if (await pwaBanner.isVisible().catch(() => false)) {
    const dismiss = pwaBanner.getByRole("button").last();
    if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
  }

  await page.getByRole("main").dblclick();
  await page.getByRole("textbox", { name: /編輯文字|Edit text/ }).fill(
    "高速跑馬燈效能測試 High speed marquee performance test 🚀",
  );
  await page.getByRole("button", { name: /套用|Apply/ }).click();
  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
  const panel = page.locator("#tool-panel-marquee");
  await panel.getByRole("button", { name: /啟用跑馬燈|Enable marquee/ }).click();
  const slider = panel.getByRole("slider", { name: /速度|Speed/ });
  await slider.fill("40");
  await panel.getByRole("button", { name: /關閉|Close/ }).click();
  await page.waitForFunction(() => {
    const copies = [...document.querySelectorAll(".marquee-copy")];
    return copies.length === 2 && copies.every((copy) => copy.getAnimations().length === 1);
  });
  await page.waitForTimeout(250);

  const before = await cdp.send("Performance.getMetrics");
  const sample = await page.evaluate(async (sampleDuration) => {
    const intervals = [];
    const longTasks = [];
    let previous = performance.now();
    let observer;
    if (typeof PerformanceObserver === "function") {
      observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => longTasks.push(entry.duration));
      });
      try {
        observer.observe({ type: "longtask", buffered: false });
      } catch {
        observer = undefined;
      }
    }

    await new Promise((resolve) => {
      const startedAt = performance.now();
      const sampleFrame = (now) => {
        intervals.push(now - previous);
        previous = now;
        if (now - startedAt >= sampleDuration) resolve();
        else requestAnimationFrame(sampleFrame);
      };
      requestAnimationFrame(sampleFrame);
    });
    observer?.disconnect();
    intervals.sort((left, right) => left - right);
    const percentile = (ratio) =>
      intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * ratio))] ?? 0;
    return {
      frames: intervals.length,
      meanMs: intervals.reduce((sum, value) => sum + value, 0) / intervals.length,
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      maxMs: intervals.at(-1) ?? 0,
      over20Ms: intervals.filter((value) => value > 20).length,
      over34Ms: intervals.filter((value) => value > 34).length,
      longTasks: longTasks.length,
      maxLongTaskMs: Math.max(0, ...longTasks),
    };
  }, durationMs);
  const after = await cdp.send("Performance.getMetrics");
  const metricMap = (result) =>
    new Map(result.metrics.map(({ name, value }) => [name, value]));
  const beforeMetrics = metricMap(before);
  const afterMetrics = metricMap(after);
  const deltaMs = (name) =>
    (((afterMetrics.get(name) ?? 0) - (beforeMetrics.get(name) ?? 0)) * 1000);

  console.log(JSON.stringify({
    baseUrl,
    cpuRate,
    durationMs,
    ...sample,
    mainThread: {
      taskMs: deltaMs("TaskDuration"),
      scriptMs: deltaMs("ScriptDuration"),
      layoutMs: deltaMs("LayoutDuration"),
      styleMs: deltaMs("RecalcStyleDuration"),
    },
  }, null, 2));
} finally {
  await browser.close();
}
