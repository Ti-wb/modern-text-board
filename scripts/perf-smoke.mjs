/* global Animation, Buffer, CanvasRenderingContext2D, Element, HTMLElement, PerformanceObserver, URL, console, document, getComputedStyle, navigator, performance, process, requestAnimationFrame, window */
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { resolve } from "node:path";
import { analyzeTrace } from "./perf-trace.mjs";

// Examples:
// PERF_DURATION_MS=60000 PERF_REFRESH_HZ=60 PERF_DPR=3 npm run perf:smoke
// PERF_SCENARIO=max PERF_DIRECTION=up PERF_FLASH=1 npm run perf:smoke
// PERF_CONTENT='custom text' PERF_VIEWPORT=390x844 PERF_ENFORCE=1 npm run perf:smoke
// PERF_ENGINE=css PERF_PHASE=steady npm run perf:smoke
// PERF_ENGINE=canvas PERF_PHASE=speed-drag PERF_DURATION_MS=15000 npm run perf:smoke
// PERF_ENGINE=waapi PERF_PHASE=resize PERF_RESIZE_VIEWPORT=768x1024 npm run perf:smoke
const PROFILE = readChoice("PERF_PROFILE", ["stress", "real"], "stress");
const TARGET = readChoice("PERF_TARGET", ["app", "clean", "probe"], "app");
const TRACE_LEVEL = readChoice("PERF_TRACE", ["frames", "diagnostic", "none"], PROFILE === "real" ? "frames" : "diagnostic");
const INSTRUMENT_RUNTIME = TRACE_LEVEL === "diagnostic";
const CHANNEL = readChoice("PERF_CHANNEL", ["bundled", "chromium", "chrome", "msedge"], PROFILE === "real" ? "chrome" : "bundled");
const TARGET_PATHS = { app: "/", clean: "/experiments/marquee-clean/", probe: "/experiments/marquee-motion-probe/" };
const BASE_URL = process.env.PERF_BASE_URL ?? `http://127.0.0.1:4173${TARGET_PATHS[TARGET]}`;
const CPU_RATE = readPositiveNumber("PERF_CPU_RATE", PROFILE === "real" ? 1 : 6);
const DURATION_MS = readPositiveNumber("PERF_DURATION_MS", PROFILE === "real" ? 120_000 : 10_000);
let DPR = PROFILE === "real" && !process.env.PERF_DPR ? undefined : readPositiveNumber("PERF_DPR", 2);
let EXPECTED_REFRESH_RATE_HZ = PROFILE === "real" && !process.env.PERF_REFRESH_HZ ? null : readPositiveNumber("PERF_REFRESH_HZ", 60);
const RAF_SAMPLE_MS = readPositiveNumber(
  "PERF_RAF_SAMPLE_MS",
  Math.min(3_000, DURATION_MS),
);
const SETTLE_MS = readPositiveNumber("PERF_SETTLE_MS", 10_800);
const SPEED = clamp(readPositiveNumber("PERF_SPEED", 40), 1, 40);
const DIRECTION = readChoice(
  "PERF_DIRECTION",
  ["left", "right", "up", "down"],
  "left",
);
const SCENARIO = process.env.PERF_SCENARIO ?? (TARGET === "probe" ? "large" : "short");
const FLASH_ENABLED = /^(1|true|yes)$/i.test(process.env.PERF_FLASH ?? "false");
const ENFORCE_BUDGETS = /^(1|true|yes)$/i.test(
  process.env.PERF_ENFORCE ?? "false",
);
const REQUIRE_EXPECTED_CADENCE = /^(1|true|yes)$/i.test(
  process.env.PERF_REQUIRE_EXPECTED_CADENCE ?? "false",
);
let VIEWPORT = PROFILE === "real" && !process.env.PERF_VIEWPORT ? null : readViewport(process.env.PERF_VIEWPORT ?? "1024x768");
const MAX_DROPPED_PERCENT = readPositiveNumber("PERF_MAX_DROPPED_PERCENT", 0.5);
const MAX_RENDER_SURFACE_WIDTH = 32_768;
const MAX_RENDER_SURFACE_AREA = 8_000_000;
const ENGINE = readChoice(
  "PERF_ENGINE",
  ["waapi", "css", "canvas", "worker"],
  "waapi",
);
const LOOP_MODE = process.env.PERF_LOOP === undefined ? null
  : readChoice("PERF_LOOP", ["linear", "continuous"], "linear");
const PHASE = readChoice(
  "PERF_PHASE",
  ["steady", "speed-drag", "resize"],
  "steady",
);
let RESIZE_VIEWPORT = process.env.PERF_RESIZE_VIEWPORT ? readViewport(process.env.PERF_RESIZE_VIEWPORT, "PERF_RESIZE_VIEWPORT") : null;
const RESIZE_INTERVAL_MS = readPositiveNumber("PERF_RESIZE_INTERVAL_MS", 800);
const MAX_ISOLATED_PAINT_BURSTS = 1;
const MAX_ISOLATED_PAINT_BURST_MS = 50;
const MAX_ISOLATED_PAINT_EVENT_MS = 4;

const FRAME_TRACE_CATEGORIES = [
  "benchmark",
  "blink.user_timing",
  "cc",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "gpu",
  "latencyInfo",
  "toplevel",
];
const TRACE_CATEGORIES = [...FRAME_TRACE_CATEGORIES, ...(INSTRUMENT_RUNTIME ? [
  "blink.animations", "cc.debug", "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.invalidationTracking",
  "disabled-by-default-devtools.timeline.layers", "disabled-by-default-gpu.device",
  "disabled-by-default-gpu.service",
] : [])].join(",");
const runDirectory = resolve(process.env.PERF_OUTPUT_DIR ?? "perf-results/marquee-perf",
  `${new Date().toISOString().replace(/[:.]/g, "-")}-${TARGET}-${randomUUID().slice(0, 8)}`);
const tracePath = resolve(runDirectory, "trace.json");
const summaryPath = resolve(runDirectory, "summary.json");

const CONTENT_SCENARIOS = {
  short: "高速跑馬燈效能測試 High speed marquee performance test 🚀",
  large: "Aa",
  max: repeatToCodePoints("跑馬燈 Marquee 0123456789 🚀 ", 350),
  whitespace: `${" ".repeat(349)}•`,
  emoji: repeatToCodePoints("🧑‍💻🚀✨📱", 350),
};
const LARGE_FONT_SCENARIOS = new Set(["large"]);

function readPositiveNumber(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number; received ${process.env[name]}`);
  }
  return value;
}

function readChoice(name, choices, fallback) {
  const value = process.env[name] ?? fallback;
  if (!choices.includes(value)) {
    throw new Error(`${name} must be one of ${choices.join(", ")}; received ${value}`);
  }
  return value;
}

function readViewport(value, name = "PERF_VIEWPORT") {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
  if (!match) throw new Error(`${name} must look like 1024x768; received ${value}`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function repeatToCodePoints(seed, length) {
  const seedPoints = Array.from(seed);
  return Array.from({ length }, (_, index) => seedPoints[index % seedPoints.length]).join("");
}

function resolveContent() {
  const content = process.env.PERF_CONTENT ?? CONTENT_SCENARIOS[SCENARIO];
  if (typeof content !== "string") {
    throw new Error(
      `Unknown PERF_SCENARIO '${SCENARIO}'. Use ${Object.keys(CONTENT_SCENARIOS).join(", ")} or set PERF_CONTENT.`,
    );
  }
  const codePoints = Array.from(content).length;
  if (codePoints > 350) {
    throw new Error(`Performance content has ${codePoints} code points; the application limit is 350.`);
  }
  return content;
}

function resolveTargetUrl(baseUrl, engine) {
  const url = new URL(baseUrl);
  if (TARGET === "app") {
    url.searchParams.set("marquee-engine", engine);
    url.searchParams.delete("marquee-lab");
    if (LOOP_MODE !== null) url.searchParams.set("marquee-loop", LOOP_MODE);
    // Compare clarity-preserving Worker rendering unless explicitly requested.
    if (!url.searchParams.has("marquee-blur")) url.searchParams.set("marquee-blur", "0");
  } else {
    for (const [key, value] of Object.entries({
      text: resolveContent(), pps: process.env.PERF_PPS, fontSize: process.env.PERF_FONT_SIZE,
      direction: DIRECTION, speed: SPEED,
    })) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    if (TARGET === "probe") {
      if (!url.searchParams.has("pps")) url.searchParams.set("pps", String(24 + ((SPEED - 1) / 9) * 136));
      url.searchParams.set("raster", "1");
      url.searchParams.set("labels", "0");
    }
  }
  return url.toString();
}

function metricMap(result) {
  return new Map(result.metrics.map(({ name, value }) => [name, value]));
}

function metricDelta(before, after, name, multiplier = 1) {
  return (((after.get(name) ?? 0) - (before.get(name) ?? 0)) * multiplier);
}

async function readTraceStream(cdp, stream) {
  let serialized = "";
  while (true) {
    const chunk = await cdp.send("IO.read", { handle: stream });
    serialized += chunk.base64Encoded ? Buffer.from(chunk.data, "base64").toString("utf8") : chunk.data;
    if (chunk.eof) break;
  }
  await cdp.send("IO.close", { handle: stream }).catch(() => undefined);
  await writeFile(tracePath, serialized);
  const parsed = JSON.parse(serialized);
  return {
    bytes: Buffer.byteLength(serialized),
    events: Array.isArray(parsed) ? parsed : (parsed.traceEvents ?? []),
  };
}

async function stopAndReadTrace(cdp) {
  const completed = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
  await cdp.send("Tracing.end");
  const result = await completed;
  if (!result.stream) throw new Error("Chromium did not return a trace stream.");
  return { ...await readTraceStream(cdp, result.stream), dataLossOccurred: result.dataLossOccurred ?? null };
}

async function captureMotionSnapshot(page) {
  return page.evaluate(() => {
    const clean = window.__cleanMarqueeSnapshot ?? null;
    const probe = window.__motionProbeSnapshot ?? null;
    const moving = document.querySelector(".moving-text.is-marquee");
    const style = moving ? getComputedStyle(moving) : null;
    const copies = [...document.querySelectorAll(".marquee-copy, .clean-marquee__copy, [data-probe-runner]")];
    const animations = copies.map((copy) => {
      const animation = copy.getAnimations()[0];
      const timing = animation?.effect?.getTiming();
      return animation && timing ? {
        currentTimeMs: typeof animation.currentTime === "number" ? animation.currentTime : null,
        durationMs: typeof timing.duration === "number" ? timing.duration : null,
        delayMs: timing.delay, playbackRate: animation.playbackRate,
        direction: timing.direction, iterations: Number.isFinite(timing.iterations) ? timing.iterations : "infinite",
      } : null;
    });
    const property = (name) => Number.parseFloat(style?.getPropertyValue(name) ?? "");
    const distance = clean?.distance ?? probe?.travelDistance ??
      Math.hypot(property("--marquee-end-x") - property("--marquee-start-x"),
        property("--marquee-end-y") - property("--marquee-start-y"));
    const first = animations[0];
    const effectivePixelsPerSecond = first?.durationMs && Number.isFinite(distance)
      ? distance / first.durationMs * first.playbackRate * 1000 : null;
    return {
      observedAtMs: performance.now(),
      effectivePixelsPerSecond,
      distance: Number.isFinite(distance) ? distance : null,
      animations,
      clean, probe,
      font: copies[0] ? {
        family: getComputedStyle(copies[0]).fontFamily,
        size: getComputedStyle(copies[0]).fontSize,
        weight: getComputedStyle(copies[0]).fontWeight,
      } : null,
      workerBackend: document.querySelector(".worker-marquee-host")?.getAttribute("data-worker-renderer") ?? null,
      loopMode: moving?.getAttribute("data-marquee-loop") ?? null,
      inkMode: moving?.getAttribute("data-marquee-ink") ?? "native",
    };
  });
}

async function captureElementSnapshot(page, dpr = DPR) {
  return page.evaluate((dpr) => {
    const copies = [...document.querySelectorAll(".marquee-copy, .clean-marquee__copy, [data-probe-runner]")];
    return copies.map((copy, index) => {
      const rect = copy.getBoundingClientRect();
      const style = getComputedStyle(copy);
      const physicalWidth = Math.ceil(
        Math.max(rect.width, copy.offsetWidth, copy.scrollWidth) * dpr,
      );
      const physicalHeight = Math.ceil(
        Math.max(rect.height, copy.offsetHeight, copy.scrollHeight) * dpr,
      );
      return {
        index,
        layoutCssPx: {
          offsetWidth: copy.offsetWidth,
          offsetHeight: copy.offsetHeight,
          scrollWidth: copy.scrollWidth,
          scrollHeight: copy.scrollHeight,
        },
        transformedRectCssPx: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        physicalPx: {
          width: physicalWidth,
          height: physicalHeight,
          area: physicalWidth * physicalHeight,
        },
        fontSize: style.fontSize,
        animationCount: copy.getAnimations().length,
      };
    });
  }, dpr);
}

async function captureCanvasSnapshot(page) {
  return page.evaluate(() => {
    const canvases = [
      ...document.querySelectorAll(
        ".canvas-marquee-surface, .worker-marquee-surface, .marquee-canvas, canvas[data-testid='canvas-marquee'], canvas[data-testid='worker-marquee'], [data-probe-raster]",
      ),
    ];
    return canvases.map((canvas, index) => {
      const rect = canvas.getBoundingClientRect();
      const style = getComputedStyle(canvas);
      return {
        index,
        className: canvas.className,
        cssPx: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        backingStorePx: {
          width: canvas.width,
          height: canvas.height,
          area: canvas.width * canvas.height,
        },
        effectiveScale: {
          x: rect.width > 0 ? canvas.width / rect.width : null,
          y: rect.height > 0 ? canvas.height / rect.height : null,
        },
        visible: style.display !== "none" && style.visibility !== "hidden",
      };
    });
  });
}

async function resolveRuntimeEngine(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector(".text-viewport[data-marquee-engine]");
    const declared = viewport?.getAttribute("data-marquee-engine");
    if (
      document.querySelector(
        ".worker-marquee-host[data-marquee-engine='worker'], .worker-marquee-surface, canvas[data-testid='worker-marquee']",
      )
    ) {
      return "worker";
    }
    if (
      document.querySelector(
        ".canvas-marquee-host[data-marquee-engine='canvas'], .canvas-marquee-surface, .marquee-canvas, canvas[data-testid='canvas-marquee']",
      )
    ) {
      return "canvas";
    }
    if (document.querySelector(".moving-text.uses-css-marquee")) return "css";
    if (declared === "waapi") return "waapi";
    if (document.querySelectorAll(".marquee-copy").length === 2) return "waapi";
    return "unknown";
  });
}

async function waitForMarqueeRenderer(page, engine) {
  await page.waitForFunction((requestedEngine) => {
    const viewport = document.querySelector(".text-viewport[data-marquee-engine]");
    const declared = viewport?.getAttribute("data-marquee-engine");
    if (declared && declared !== requestedEngine) return false;
    if (requestedEngine === "canvas" || requestedEngine === "worker") {
      return Boolean(
        document.querySelector(
          requestedEngine === "worker"
            ? ".worker-marquee-surface, canvas[data-testid='worker-marquee']"
            : ".canvas-marquee-surface, .marquee-canvas, canvas[data-testid='canvas-marquee']",
        ),
      );
    }
    if (document.querySelectorAll(".marquee-copy").length !== 2) return false;
    return requestedEngine !== "css" || Boolean(
      declared === "css" || document.querySelector(".moving-text.uses-css-marquee"),
    );
  }, engine);
  const actualEngine = await resolveRuntimeEngine(page);
  if (actualEngine !== engine) {
    throw new Error(
      `Requested marquee engine '${engine}', but the page exposed '${actualEngine}'. `
      + "Ensure ?marquee-engine= is handled and .text-viewport[data-marquee-engine] reflects the active renderer.",
    );
  }
  return actualEngine;
}

async function resolveMarqueeBackendNodeIds(cdp) {
  try {
    await cdp.send("DOM.enable");
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector:
        ".marquee-copy, .clean-marquee__copy, [data-probe-runner], .canvas-marquee-surface, .worker-marquee-surface, .marquee-canvas, canvas[data-testid='canvas-marquee'], canvas[data-testid='worker-marquee']",
    });
    const backendNodeIds = [];
    for (const nodeId of nodeIds) {
      const { node } = await cdp.send("DOM.describeNode", { nodeId });
      if (node.backendNodeId) backendNodeIds.push(node.backendNodeId);
    }
    return backendNodeIds;
  } catch {
    return [];
  }
}

function createLayerSampler(cdp) {
  const state = {
    available: false,
    active: false,
    changes: 0,
    paints: 0,
    maxRawWidth: 0,
    maxRawHeight: 0,
    maxRawArea: 0,
    latestLayers: [],
  };
  cdp.on("LayerTree.layerTreeDidChange", ({ layers = [] }) => {
    state.available = true;
    state.latestLayers = layers;
    if (!state.active) return;
    state.changes += 1;
    for (const layer of layers) {
      state.maxRawWidth = Math.max(state.maxRawWidth, layer.width ?? 0);
      state.maxRawHeight = Math.max(state.maxRawHeight, layer.height ?? 0);
      state.maxRawArea = Math.max(
        state.maxRawArea,
        (layer.width ?? 0) * (layer.height ?? 0),
      );
    }
  });
  cdp.on("LayerTree.layerPainted", () => {
    if (state.active) state.paints += 1;
  });
  return state;
}

function summarizeLayerSampler(state, backendNodeIds) {
  const targetIds = new Set(backendNodeIds);
  const targetLayers = state.latestLayers
    .filter((layer) => targetIds.has(layer.backendNodeId))
    .map((layer) => ({
      layerId: layer.layerId,
      backendNodeId: layer.backendNodeId,
      width: layer.width,
      height: layer.height,
      paintCount: layer.paintCount,
      drawsContent: layer.drawsContent,
      memoryEstimate: layer.memoryEstimate,
    }));
  return {
    available: state.available,
    treeChangesDuringSample: state.changes,
    layerPaintEventsDuringSample: state.paints,
    largestLayerSeenRawPx: {
      width: state.maxRawWidth,
      height: state.maxRawHeight,
      area: state.maxRawArea,
    },
    marqueeLayers: targetLayers,
    note: "CDP LayerTree dimensions are reported in Chromium's raw layer coordinate space; DOM physical-pixel snapshots are the layer-budget authority.",
  };
}

function summarizeRafIntervals(intervals) {
  const sorted = [...intervals].sort((left, right) => left - right);
  const percentile = (ratio) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
  return {
    frames: sorted.length,
    meanMs: sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length),
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: sorted.at(-1) ?? 0,
    over20Ms: sorted.filter((value) => value > 20).length,
    over34Ms: sorted.filter((value) => value > 34).length,
  };
}

async function readRuntimeInstrumentation(page) {
  return page.evaluate(() => {
    const state = window.__marqueePerf;
    if (!state) return null;
    return {
      animateCalls: state.animateCalls.length,
      updatePlaybackRateCalls: state.updatePlaybackRateCalls.length,
      longTasks: state.longTasks.length,
      longTaskEntries: state.longTasks,
      raf: { ...state.raf },
      cssAnimationEvents: {
        counts: { ...state.cssAnimationEvents.counts },
        samples: state.cssAnimationEvents.samples,
      },
      canvasCalls: { ...state.canvasCalls },
      sliderEvents: { ...state.sliderEvents },
      resizeEvents: state.resizeEvents,
      now: performance.now(),
    };
  });
}

function countDelta(before, after, name) {
  return (after[name] ?? 0) - (before[name] ?? 0);
}

async function preparePhase(page, phase) {
  if (phase !== "speed-drag") return null;
  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
  const panel = page.locator("#tool-panel-marquee");
  const slider = panel.getByRole("slider", { name: /速度|Speed/ });
  await slider.waitFor({ state: "visible" });
  return slider;
}

async function exerciseSpeedDrag(page, slider, durationMs) {
  const box = await slider.boundingBox();
  if (!box || box.width < 20 || box.height < 1) {
    throw new Error("Could not resolve a usable marquee speed slider box.");
  }
  const minimumX = box.x + Math.min(8, box.width * 0.05);
  const maximumX = box.x + box.width - Math.min(8, box.width * 0.05);
  const y = box.y + box.height / 2;
  const startedAt = Date.now();
  const travelMs = 1_200;
  await page.mouse.move(maximumX, y);
  await page.mouse.down();
  try {
    while (Date.now() - startedAt < durationMs) {
      const elapsed = Date.now() - startedAt;
      const cycleProgress = (elapsed % (travelMs * 2)) / travelMs;
      const progress = cycleProgress <= 1 ? cycleProgress : 2 - cycleProgress;
      await page.mouse.move(
        maximumX + (minimumX - maximumX) * progress,
        y,
      );
      await page.waitForTimeout(16);
    }
  } finally {
    await page.mouse.up();
  }
}

async function exerciseResize(page, durationMs) {
  const startedAt = Date.now();
  let useAlternate = true;
  try {
    while (Date.now() - startedAt < durationMs) {
      await page.setViewportSize(useAlternate ? RESIZE_VIEWPORT : VIEWPORT);
      useAlternate = !useAlternate;
      const remaining = durationMs - (Date.now() - startedAt);
      if (remaining > 0) {
        await page.waitForTimeout(Math.min(RESIZE_INTERVAL_MS, remaining));
      }
    }
  } finally {
    await page.setViewportSize(VIEWPORT);
  }
}

async function exercisePhase(page, phase, durationMs, phaseControl) {
  if (phase === "speed-drag") {
    await exerciseSpeedDrag(page, phaseControl, durationMs);
    return;
  }
  if (phase === "resize") {
    await exerciseResize(page, durationMs);
    return;
  }
  await page.waitForTimeout(durationMs);
}

if (TARGET !== "app" && PHASE !== "steady") throw new Error("Isolated fixtures support PERF_PHASE=steady only.");
if (TRACE_LEVEL === "none" && ENFORCE_BUDGETS) throw new Error("PERF_TRACE=none observes visually and cannot enforce performance gates.");
if (PROFILE === "real" && CPU_RATE !== 1) throw new Error("PERF_PROFILE=real requires PERF_CPU_RATE=1; use stress for throttling.");
if (PROFILE === "real" && DPR !== undefined && VIEWPORT === null) throw new Error("An explicit PERF_DPR in real mode also requires PERF_VIEWPORT; omit both to use the native display.");
await mkdir(runDirectory, { recursive: true });
const browser = await chromium.launch({
  headless: PROFILE !== "real",
  ...(CHANNEL === "bundled" ? {} : { channel: CHANNEL }),
});

try {
  const content = resolveContent();
  const targetUrl = resolveTargetUrl(BASE_URL, ENGINE);
  const context = await browser.newContext({
    ...(DPR === undefined ? {} : { deviceScaleFactor: DPR }),
    viewport: VIEWPORT,
    ...(TARGET === "app" ? {} : { serviceWorkers: "block" }),
  });
  if (INSTRUMENT_RUNTIME) await context.addInitScript(() => {
    const instrumentation = {
      animateCalls: [],
      updatePlaybackRateCalls: [],
      longTasks: [],
      raf: {
        requests: 0,
        callbacks: 0,
        cancels: 0,
      },
      cssAnimationEvents: {
        counts: {
          animationstart: 0,
          animationcancel: 0,
          animationend: 0,
          animationiteration: 0,
        },
        samples: [],
      },
      canvasCalls: {
        clearRect: 0,
        drawImage: 0,
        fillText: 0,
        strokeText: 0,
      },
      sliderEvents: {
        pointerdown: 0,
        pointermove: 0,
        pointerup: 0,
        input: 0,
        change: 0,
      },
      resizeEvents: 0,
    };
    Object.defineProperty(window, "__marqueePerf", {
      configurable: false,
      value: instrumentation,
    });

    const originalAnimate = Element.prototype.animate;
    Element.prototype.animate = function instrumentedAnimate(...args) {
      const animation = Reflect.apply(originalAnimate, this, args);
      instrumentation.animateCalls.push({
        at: performance.now(),
        className: typeof this.className === "string" ? this.className : "",
      });
      return animation;
    };

    if (typeof Animation === "function" && Animation.prototype.updatePlaybackRate) {
      const originalUpdatePlaybackRate = Animation.prototype.updatePlaybackRate;
      Animation.prototype.updatePlaybackRate = function instrumentedPlaybackRate(rate) {
        instrumentation.updatePlaybackRateCalls.push({ at: performance.now(), rate });
        return Reflect.apply(originalUpdatePlaybackRate, this, [rate]);
      };
    }

    const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const originalCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      instrumentation.raf.requests += 1;
      return originalRequestAnimationFrame((timestamp) => {
        instrumentation.raf.callbacks += 1;
        callback(timestamp);
      });
    };
    window.cancelAnimationFrame = (handle) => {
      instrumentation.raf.cancels += 1;
      return originalCancelAnimationFrame(handle);
    };

    if (typeof CanvasRenderingContext2D === "function") {
      for (const method of ["clearRect", "drawImage", "fillText", "strokeText"]) {
        const original = CanvasRenderingContext2D.prototype[method];
        if (typeof original !== "function") continue;
        CanvasRenderingContext2D.prototype[method] = function instrumentedCanvasCall(...args) {
          instrumentation.canvasCalls[method] += 1;
          return Reflect.apply(original, this, args);
        };
      }
    }

    const isMarqueeAnimationTarget = (target) =>
      target instanceof Element && Boolean(
        target.matches(
          ".marquee-copy, .clean-marquee__copy, [data-probe-runner], .moving-text, .canvas-marquee-host, .canvas-marquee-surface, .worker-marquee-host, .worker-marquee-surface, .marquee-canvas",
        ) || target.closest(
          ".moving-text.is-marquee, .canvas-marquee-host[data-marquee-engine='canvas']",
        ),
      );
    for (const eventName of [
      "animationstart",
      "animationcancel",
      "animationend",
      "animationiteration",
    ]) {
      window.addEventListener(eventName, (event) => {
        if (!isMarqueeAnimationTarget(event.target)) return;
        instrumentation.cssAnimationEvents.counts[eventName] += 1;
        if (instrumentation.cssAnimationEvents.samples.length < 24) {
          instrumentation.cssAnimationEvents.samples.push({
            at: performance.now(),
            type: eventName,
            animationName: event.animationName,
            elapsedTime: event.elapsedTime,
            className: typeof event.target.className === "string"
              ? event.target.className
              : "",
          });
        }
      }, true);
    }

    for (const eventName of ["pointerdown", "pointermove", "pointerup", "input", "change"]) {
      window.addEventListener(eventName, (event) => {
        if (!(event.target instanceof Element)) return;
        if (!event.target.matches("#marquee-speed-range, input[type='range'][aria-label*='Speed'], input[type='range'][aria-label*='速度']")) return;
        instrumentation.sliderEvents[eventName] += 1;
      }, true);
    }
    window.addEventListener("resize", () => {
      instrumentation.resizeEvents += 1;
    });

    if (typeof PerformanceObserver === "function") {
      try {
        const observer = new PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => {
            instrumentation.longTasks.push({
              at: entry.startTime,
              duration: entry.duration,
            });
          });
        });
        observer.observe({ type: "longtask", buffered: false });
      } catch {
        // Long Task API is optional; trace RunTask events remain available.
      }
    }
  });

  const page = await context.newPage();
  const browserCdp = await browser.newBrowserCDPSession();
  const systemInfo = await browserCdp.send("SystemInfo.getInfo").catch(() => null);
  const environment = {
    browserVersion: browser.version(),
    channel: CHANNEL,
    headed: PROFILE === "real",
    os: { platform: platform(), release: release(), arch: arch() },
    gpu: systemInfo?.gpu ? {
      devices: systemInfo.gpu.devices,
      featureStatus: systemInfo.gpu.featureStatus,
      displayType: systemInfo.gpu.auxAttributes?.displayType ?? null,
      renderer: systemInfo.gpu.auxAttributes?.glRenderer ?? null,
    } : null,
    deviceNote: process.env.PERF_DEVICE_NOTE ?? null,
    requestedDpr: DPR ?? null,
    requestedViewport: VIEWPORT,
  };
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE });
  const layerSampler = createLayerSampler(cdp);
  if (INSTRUMENT_RUNTIME) await cdp.send("LayerTree.enable").catch(() => undefined);

  let maxTraceBufferUsage = 0;
  cdp.on("Tracing.bufferUsage", ({ percentFull = 0, value = 0 }) => {
    maxTraceBufferUsage = Math.max(maxTraceBufferUsage, percentFull, value);
  });

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  const display = await page.evaluate(() => ({
    width: window.innerWidth, height: window.innerHeight,
    dpr: window.devicePixelRatio, screenWidth: window.screen.width,
    screenHeight: window.screen.height, colorDepth: window.screen.colorDepth,
    userAgent: navigator.userAgent,
  }));
  DPR = display.dpr;
  VIEWPORT = { width: display.width, height: display.height };
  RESIZE_VIEWPORT ??= { width: VIEWPORT.height, height: VIEWPORT.width };
  environment.display = display;

  if (TARGET === "app") {
    const pwaBanner = page.locator(".pwa-status");
    if (await pwaBanner.isVisible().catch(() => false)) {
      const dismiss = pwaBanner.getByRole("button").last();
      if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
    }

    await page.getByRole("main").dblclick();
    await page.getByRole("textbox", { name: /編輯文字|Edit text/ }).fill(content);
    await page.getByRole("button", { name: /套用|Apply/ }).click();
    if (LARGE_FONT_SCENARIOS.has(SCENARIO)) {
      await page.getByRole("button", { name: /字型與字級|Font and size/ }).click();
      const fontPanel = page.locator("#tool-panel-font");
      await fontPanel.getByRole("slider", { name: /畫面填滿程度|Screen fill/ }).fill("100");
      await fontPanel.getByRole("button", { name: /關閉|Close/ }).click();
    }
    await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
    const panel = page.locator("#tool-panel-marquee");
    const enableButton = panel.getByRole("button", { name: /啟用跑馬燈|Enable marquee/ });
    if ((await enableButton.getAttribute("aria-pressed")) !== "true") await enableButton.click();
    const directionNames = {
      left: /向左|^Left$/,
      right: /向右|^Right$/,
      up: /向上|^Up$/,
      down: /向下|^Down$/,
    };
    await panel.getByRole("button", { name: directionNames[DIRECTION] }).click();
    const slider = panel.getByRole("slider", { name: /速度|Speed/ });
    await slider.fill(String(SPEED));
    await panel.getByRole("button", { name: /關閉|Close/ }).click();

    if (FLASH_ENABLED) {
      await page.getByRole("button", { name: /更多工具|More tools/ }).click();
      const morePanel = page.locator("#tool-panel-more");
      const flashButton = morePanel.getByRole("button", { name: /柔和閃爍|Gentle flash/ });
      if ((await flashButton.getAttribute("aria-pressed")) !== "true") await flashButton.click();
      await morePanel.getByRole("button", { name: /關閉|Close/ }).click();
    }

    await waitForMarqueeRenderer(page, ENGINE);

    // Closing a panel deliberately restores focus to its toolbar trigger. That
    // blocks the idle timer, so a fixed sleep can still begin tracing while the
    // toolbar fades. Clear setup focus/hover, wait for the actual idle state and
    // its opacity transition, and keep SETTLE_MS as a minimum raster warm-up.
    await page.evaluate(() => {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) activeElement.blur();
    });
    await page.mouse.move(1, 1);
    await Promise.all([
      page.waitForTimeout(SETTLE_MS),
      page.waitForFunction(
        () => document.querySelector(".toolbar-shell")?.classList.contains("is-idle"),
        undefined,
        { timeout: Math.max(12_000, SETTLE_MS + 2_000) },
      ),
    ]);
    await page.waitForFunction(() => {
      const toolbar = document.querySelector(".toolbar-shell");
      return toolbar !== null && Number.parseFloat(getComputedStyle(toolbar).opacity) <= 0.181;
    });
  } else {
    await page.waitForFunction((target) => target === "clean"
      ? document.documentElement.dataset.cleanMarqueeState === "ready"
      : document.documentElement.dataset.motionProbeState === "ready", TARGET);
    await page.waitForTimeout(SETTLE_MS);
  }
  await page.evaluate(() => document.fonts.ready);
  const actualEngine = TARGET === "app" ? await resolveRuntimeEngine(page) : "css";
  const configuredPlaybackRates = actualEngine === "waapi"
    ? await page.locator(".marquee-copy").evaluateAll(
        (copies) => copies.map((copy) => copy.getAnimations()[0]?.playbackRate ?? null),
      )
    : [];
  if (actualEngine === "waapi" && (
    configuredPlaybackRates.length !== 2 ||
    configuredPlaybackRates.some((rate) => !Number.isFinite(rate) || rate <= 0)
  )) {
    throw new Error("Marquee WAAPI playback rate was not configured before sampling.");
  }

  // Calibrate rAF before tracing. This preserves the old cadence metrics while
  // keeping the production compositor trace free of a per-frame test callback.
  const rafIntervals = await page.evaluate(async (sampleDuration) => {
    const intervals = [];
    await new Promise((resolve) => {
      let previous;
      const startedAt = performance.now();
      const sampleFrame = (now) => {
        if (previous !== undefined) intervals.push(now - previous);
        previous = now;
        if (now - startedAt >= sampleDuration) resolve();
        else requestAnimationFrame(sampleFrame);
      };
      requestAnimationFrame(sampleFrame);
    });
    return intervals;
  }, RAF_SAMPLE_MS);
  const rafCalibration = summarizeRafIntervals(rafIntervals);
  const measuredRefreshRateHz = rafCalibration.medianMs > 0 ? 1000 / rafCalibration.medianMs : null;
  EXPECTED_REFRESH_RATE_HZ ??= measuredRefreshRateHz;
  if (!EXPECTED_REFRESH_RATE_HZ) throw new Error("No usable display cadence; keep the target window visible and repeat.");

  const phaseControl = await preparePhase(page, PHASE);
  await page.waitForTimeout(150);
  const motion = await captureMotionSnapshot(page);
  if (TARGET === "probe" && motion.probe?.mode === "once") {
    throw new Error("A long steady sample needs the alternate probe; use mode=once only for visual endpoint checks.");
  }
  if (TRACE_LEVEL === "none") {
    await exercisePhase(page, PHASE, DURATION_MS, phaseControl);
    const result = {
      schemaVersion: 2,
      configuration: {
        profile: PROFILE, target: TARGET, targetUrl,
        durationMs: DURATION_MS, traceLevel: TRACE_LEVEL, cpuRate: CPU_RATE,
        dpr: DPR, viewport: VIEWPORT, content, direction: DIRECTION,
        requestedSpeed: SPEED, requestedEngine: ENGINE, actualEngine,
        requestedLoopMode: new URL(targetUrl).searchParams.get("marquee-loop") ?? "linear",
        expectedRefreshRateHz: EXPECTED_REFRESH_RATE_HZ,
      },
      environment, motion,
      artifacts: { summary: summaryPath, trace: null },
      acceptance: { passed: null, physicalDeviceValidated: false, status: "visual-observation-only", note: "No trace or steady-state measurement callbacks. Record the physical-device observation separately." },
    };
    await writeFile(summaryPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } else {

    const beforeElementSnapshot = await captureElementSnapshot(page);
    const beforeCanvasSnapshot = await captureCanvasSnapshot(page);
    const backendNodeIds = await resolveMarqueeBackendNodeIds(cdp);
    const before = metricMap(await cdp.send("Performance.getMetrics"));
    const instrumentationBefore = await readRuntimeInstrumentation(page);

    await cdp.send("Tracing.start", {
      categories: TRACE_CATEGORIES,
      options: "record-as-much-as-possible",
      transferMode: "ReturnAsStream",
      bufferUsageReportingInterval: 1000,
    });
    layerSampler.active = true;
    const sampleStartPageMs = await page.evaluate(() => performance.mark("marquee-perf-sample-start").startTime);
    await exercisePhase(page, PHASE, DURATION_MS, phaseControl);
    await page.evaluate(() => performance.mark("marquee-perf-sample-end"));
    layerSampler.active = false;
    const instrumentationAfter = await readRuntimeInstrumentation(page);
    const after = metricMap(await cdp.send("Performance.getMetrics"));
    const trace = await stopAndReadTrace(cdp);

    const afterElementSnapshot = await captureElementSnapshot(page);
    const afterCanvasSnapshot = await captureCanvasSnapshot(page);

    const traceAnalysis = analyzeTrace(trace.events, EXPECTED_REFRESH_RATE_HZ);
    // Relate a gap to animation phase without introducing a per-frame DOM read.
    for (const gap of traceAnalysis.stutters.events) {
      gap.animationPhases = motion.animations.map((animation) => {
        if (!animation?.durationMs || animation.currentTimeMs === null) return null;
        const elapsed = sampleStartPageMs + gap.endOffsetMs - motion.observedAtMs;
        const time = animation.currentTimeMs + elapsed * animation.playbackRate - animation.delayMs;
        const progress = ((time % animation.durationMs) + animation.durationMs) % animation.durationMs;
        const boundaryDistanceMs = Math.min(progress, animation.durationMs - progress) / animation.playbackRate;
        return { phase: progress / animation.durationMs, boundaryDistanceMs };
      });
      gap.nearProbeTurnaround = TARGET === "probe" && gap.animationPhases.some((phase) =>
        phase !== null && phase.boundaryDistanceMs < gap.intervalMs + 1000 / EXPECTED_REFRESH_RATE_HZ * 2);
    }
    let animationInstrumentation = { available: false };
    let cssAnimationEventCounts = {};
    let rafInstrumentation = {};
    let canvasCallInstrumentation = {};
    if (instrumentationBefore && instrumentationAfter) {
      cssAnimationEventCounts = Object.fromEntries(
        Object.keys(instrumentationAfter.cssAnimationEvents.counts).map((name) => [
          name,
          countDelta(
            instrumentationBefore.cssAnimationEvents.counts,
            instrumentationAfter.cssAnimationEvents.counts,
            name,
          ),
        ]),
      );
      rafInstrumentation = Object.fromEntries(
        Object.keys(instrumentationAfter.raf).map((name) => [
          name,
          countDelta(instrumentationBefore.raf, instrumentationAfter.raf, name),
        ]),
      );
      canvasCallInstrumentation = Object.fromEntries(
        Object.keys(instrumentationAfter.canvasCalls).map((name) => [
          name,
          countDelta(
            instrumentationBefore.canvasCalls,
            instrumentationAfter.canvasCalls,
            name,
          ),
        ]),
      );
      const sliderEventInstrumentation = Object.fromEntries(
        Object.keys(instrumentationAfter.sliderEvents).map((name) => [
          name,
          countDelta(
            instrumentationBefore.sliderEvents,
            instrumentationAfter.sliderEvents,
            name,
          ),
        ]),
      );
      animationInstrumentation = {
        available: true,
        animateCallsDuringSample:
          instrumentationAfter.animateCalls - instrumentationBefore.animateCalls,
        updatePlaybackRateCallsDuringSample:
          instrumentationAfter.updatePlaybackRateCalls - instrumentationBefore.updatePlaybackRateCalls,
        longTasksDuringSample:
          instrumentationAfter.longTasks - instrumentationBefore.longTasks,
        recentLongTasks: instrumentationAfter.longTaskEntries
          .filter((entry) => entry.at >= instrumentationBefore.now)
          .slice(-20),
        rafDuringSample: rafInstrumentation,
        cssAnimationEventsDuringSample: cssAnimationEventCounts,
        recentCssAnimationEvents: instrumentationAfter.cssAnimationEvents.samples
          .filter((entry) => entry.at >= instrumentationBefore.now)
          .slice(-20),
        canvasCallsDuringSample: canvasCallInstrumentation,
        sliderEventsDuringSample: sliderEventInstrumentation,
        resizeEventsDuringSample:
          instrumentationAfter.resizeEvents - instrumentationBefore.resizeEvents,
      };
    }
    const maxPhysicalWidth = Math.max(
      0,
      ...afterElementSnapshot.map((copy) => copy.physicalPx.width),
    );
    const maxPhysicalArea = Math.max(
      0,
      ...afterElementSnapshot.map((copy) => copy.physicalPx.area),
    );
    const maxCanvasBackingWidth = Math.max(
      0,
      ...afterCanvasSnapshot.map((canvas) => canvas.backingStorePx.width),
    );
    const maxCanvasBackingArea = Math.max(
      0,
      ...afterCanvasSnapshot.map((canvas) => canvas.backingStorePx.area),
    );
    const maxRenderSurfaceWidth = Math.max(maxPhysicalWidth, maxCanvasBackingWidth);
    const maxRenderSurfaceArea = Math.max(maxPhysicalArea, maxCanvasBackingArea);
    const droppedPercent = traceAnalysis.frameSignals.droppedPercent;
    const steadyPhase = PHASE === "steady";
    const engineUsesAppRaf = TARGET === "app" && actualEngine === "canvas";
    const cadenceMatchesExpectation = measuredRefreshRateHz !== null &&
      Math.abs(measuredRefreshRateHz - EXPECTED_REFRESH_RATE_HZ) /
        EXPECTED_REFRESH_RATE_HZ <= 0.08;
    const acceptance = {
      frameSignalAvailable: traceAnalysis.frameSignals.source !== "unavailable",
      droppedFramesAtMostPercent:
        PHASE === "resize" || (droppedPercent !== null && droppedPercent <= MAX_DROPPED_PERCENT),
      noTwoConsecutiveRefreshSlotsLost:
        traceAnalysis.frameSignals.cadence.maxConsecutiveDroppedSlots !== null &&
        traceAnalysis.frameSignals.cadence.maxConsecutiveDroppedSlots < 2,
      cadenceMatchesExpectation:
        !REQUIRE_EXPECTED_CADENCE || cadenceMatchesExpectation,
      traceBufferComplete: maxTraceBufferUsage < 0.98 && trace.dataLossOccurred !== true,
      renderSurfaceWidthWithinBudget:
        maxRenderSurfaceWidth <= MAX_RENDER_SURFACE_WIDTH,
      renderSurfaceAreaWithinBudget:
        maxRenderSurfaceArea <= MAX_RENDER_SURFACE_AREA,
      ...(steadyPhase
        ? {
            steadyLayoutIsZero: traceAnalysis.rendering.layout.count === 0,
            steadyPaintHasNoContinuousWork:
              engineUsesAppRaf || (
                traceAnalysis.rendering.paintBursts.length <= MAX_ISOLATED_PAINT_BURSTS &&
                (traceAnalysis.rendering.paintBursts[0]?.spanMs ?? 0) <=
                  MAX_ISOLATED_PAINT_BURST_MS &&
                (traceAnalysis.rendering.paintBursts[0]?.maxMs ?? 0) <=
                  MAX_ISOLATED_PAINT_EVENT_MS
              ),
            ...(animationInstrumentation.available ? {
            noLongTasks: animationInstrumentation.longTasksDuringSample === 0,
            noSteadyAnimationRebuild:
              animationInstrumentation.animateCallsDuringSample === 0
              && cssAnimationEventCounts.animationstart === 0
              && cssAnimationEventCounts.animationcancel === 0,
            noSteadyRateController:
              animationInstrumentation.updatePlaybackRateCallsDuringSample === 0,
            steadyRafMatchesEngine: engineUsesAppRaf
              ? rafInstrumentation.callbacks > 0
              : rafInstrumentation.callbacks === 0,
            canvasTextCacheIsStable: !["canvas", "worker"].includes(ENGINE)
              || (
                canvasCallInstrumentation.fillText === 0
                && canvasCallInstrumentation.strokeText === 0
              ),
            } : {}),
            layerWidthWithinBudget: maxPhysicalWidth <= 16_384,
            layerAreaWithinBudget: maxPhysicalArea <= 8_000_000,
          }
        : {}),
    };
    const passed = Object.values(acceptance).every(Boolean);

    const result = {
      schemaVersion: 2,
      configuration: {
        baseUrl: BASE_URL,
        profile: PROFILE,
        target: TARGET,
        traceLevel: TRACE_LEVEL,
        targetUrl,
        cpuRate: CPU_RATE,
        durationMs: DURATION_MS,
        settleMs: SETTLE_MS,
        dpr: DPR,
        expectedRefreshRateHz: EXPECTED_REFRESH_RATE_HZ,
        viewport: VIEWPORT,
        scenario: SCENARIO,
        content,
        contentCodePoints: Array.from(content).length,
        direction: DIRECTION,
        requestedSpeed: SPEED,
        flashEnabled: FLASH_ENABLED,
        requestedEngine: ENGINE,
        actualEngine,
        requestedLoopMode: new URL(targetUrl).searchParams.get("marquee-loop") ?? "linear",
        phase: PHASE,
        resizeViewport: PHASE === "resize" ? RESIZE_VIEWPORT : null,
        resizeIntervalMs: PHASE === "resize" ? RESIZE_INTERVAL_MS : null,
        requireExpectedCadence: REQUIRE_EXPECTED_CADENCE,
        configuredPlaybackRates,
      },
      environment,
      motion,
      artifacts: { trace: tracePath, summary: summaryPath },
      rafCalibration: {
        durationMs: RAF_SAMPLE_MS,
        ...rafCalibration,
        estimatedRefreshRateHz: measuredRefreshRateHz,
        cadenceMatchesExpectation,
      },
      chromeTrace: {
        bytes: trace.bytes,
        maxBufferUsage: maxTraceBufferUsage,
        dataLossOccurred: trace.dataLossOccurred,
        ...traceAnalysis,
      },
      mainThread: {
        taskMs: metricDelta(before, after, "TaskDuration", 1_000),
        scriptMs: metricDelta(before, after, "ScriptDuration", 1_000),
        layoutMs: metricDelta(before, after, "LayoutDuration", 1_000),
        styleMs: metricDelta(before, after, "RecalcStyleDuration", 1_000),
        layoutCount: metricDelta(before, after, "LayoutCount"),
        styleCount: metricDelta(before, after, "RecalcStyleCount"),
      },
      animationInstrumentation,
      layers: {
        before: beforeElementSnapshot,
        after: afterElementSnapshot,
        cdp: summarizeLayerSampler(layerSampler, backendNodeIds),
      },
      canvas: {
        before: beforeCanvasSnapshot,
        after: afterCanvasSnapshot,
      },
      acceptance: {
        status: "automated-measurement-only",
        physicalDeviceValidated: false,
        presentationFeedbackAvailable: traceAnalysis.frameSignals.presentation.available,
        hardwareCompositing: environment.gpu?.featureStatus?.gpu_compositing === "enabled",
        note: "Passing automated gates does not establish the 80% improvement or physical-device acceptance. Compare matching runs and complete the five-minute visual check.",
        thresholds: {
          maxDroppedPercent: MAX_DROPPED_PERCENT,
          maxConsecutiveDroppedSlots: 1,
          maxRenderSurfaceDeviceWidthPx: MAX_RENDER_SURFACE_WIDTH,
          maxRenderSurfaceDeviceAreaPx: MAX_RENDER_SURFACE_AREA,
          droppedFrameBudgetApplies: PHASE !== "resize",
          maxIsolatedPaintBursts: MAX_ISOLATED_PAINT_BURSTS,
          maxIsolatedPaintBurstMs: MAX_ISOLATED_PAINT_BURST_MS,
          maxIsolatedPaintEventMs: MAX_ISOLATED_PAINT_EVENT_MS,
          maxLayerDeviceWidthPx: 16_384,
          maxLayerDeviceAreaPx: 8_000_000,
        },
        paintPolicy:
          "Continuous paint fails. One short browser backing-store refresh is tolerated only while dropped-frame, consecutive-slot, layout, animation-rebuild, and rate-controller gates also pass.",
        observedDroppedPercent: droppedPercent,
        checks: acceptance,
        passed,
        enforced: ENFORCE_BUDGETS,
      },
    };

    await writeFile(summaryPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (ENFORCE_BUDGETS && !passed) process.exitCode = 1;
  }
} finally {
  await browser.close();
}
