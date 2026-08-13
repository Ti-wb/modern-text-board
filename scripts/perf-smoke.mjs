/* global Animation, Buffer, Element, PerformanceObserver, console, document, getComputedStyle, performance, process, requestAnimationFrame, window */
import { chromium } from "playwright";

// Examples:
// PERF_DURATION_MS=60000 PERF_REFRESH_HZ=60 PERF_DPR=3 npm run perf:smoke
// PERF_SCENARIO=max PERF_DIRECTION=up PERF_FLASH=1 npm run perf:smoke
// PERF_CONTENT='custom text' PERF_VIEWPORT=390x844 PERF_ENFORCE=1 npm run perf:smoke
const BASE_URL = process.env.PERF_BASE_URL ?? "http://127.0.0.1:4173";
const CPU_RATE = readPositiveNumber("PERF_CPU_RATE", 6);
const DURATION_MS = readPositiveNumber("PERF_DURATION_MS", 10_000);
const DPR = readPositiveNumber("PERF_DPR", 2);
const EXPECTED_REFRESH_RATE_HZ = readPositiveNumber("PERF_REFRESH_HZ", 60);
const RAF_SAMPLE_MS = readPositiveNumber(
  "PERF_RAF_SAMPLE_MS",
  Math.min(3_000, DURATION_MS),
);
const SPEED = clamp(readPositiveNumber("PERF_SPEED", 40), 1, 40);
const DIRECTION = readChoice(
  "PERF_DIRECTION",
  ["left", "right", "up", "down"],
  "left",
);
const SCENARIO = process.env.PERF_SCENARIO ?? "short";
const FLASH_ENABLED = /^(1|true|yes)$/i.test(process.env.PERF_FLASH ?? "false");
const ENFORCE_BUDGETS = /^(1|true|yes)$/i.test(
  process.env.PERF_ENFORCE ?? "false",
);
const VIEWPORT = readViewport(process.env.PERF_VIEWPORT ?? "1024x768");
const MAX_DROPPED_PERCENT = readPositiveNumber("PERF_MAX_DROPPED_PERCENT", 0.5);

const TRACE_CATEGORIES = [
  "benchmark",
  "blink.animations",
  "blink.user_timing",
  "cc",
  "cc.debug",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-devtools.timeline.invalidationTracking",
  "disabled-by-default-devtools.timeline.layers",
  "disabled-by-default-gpu.device",
  "disabled-by-default-gpu.service",
  "gpu",
  "latencyInfo",
  "toplevel",
].join(",");

const CONTENT_SCENARIOS = {
  short: "高速跑馬燈效能測試 High speed marquee performance test 🚀",
  large: "Aa",
  max: repeatToCodePoints("跑馬燈 Marquee 0123456789 🚀 ", 350),
  whitespace: `${" ".repeat(349)}•`,
  emoji: repeatToCodePoints("🧑‍💻🚀✨📱", 350),
};

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

function readViewport(value) {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
  if (!match) throw new Error(`PERF_VIEWPORT must look like 1024x768; received ${value}`);
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

function metricMap(result) {
  return new Map(result.metrics.map(({ name, value }) => [name, value]));
}

function metricDelta(before, after, name, multiplier = 1) {
  return (((after.get(name) ?? 0) - (before.get(name) ?? 0)) * multiplier);
}

function summarizeDurations(events, names) {
  const acceptedNames = new Set(names);
  const matches = events.filter(
    (event) => acceptedNames.has(event.name) && Number.isFinite(event.dur),
  );
  const durationsMs = matches.map((event) => event.dur / 1_000);
  return {
    count: matches.length,
    totalMs: durationsMs.reduce((sum, value) => sum + value, 0),
    maxMs: Math.max(0, ...durationsMs),
  };
}

function collectScalarStrings(value, target = []) {
  if (typeof value === "string") target.push(value.toLowerCase());
  else if (Array.isArray(value)) value.forEach((entry) => collectScalarStrings(entry, target));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => collectScalarStrings(entry, target));
  }
  return target;
}

function uniqueSortedTimestamps(events, eventName) {
  const timestamps = events
    .filter((event) => event.name === eventName && Number.isFinite(event.ts))
    .map((event) => event.ts)
    .sort((left, right) => left - right);
  return timestamps.filter(
    (timestamp, index) => index === 0 || timestamp - timestamps[index - 1] >= 200,
  );
}

function inferFrameSlots(timestamps, refreshRateHz) {
  const expectedIntervalUs = 1_000_000 / refreshRateHz;
  let droppedSlots = 0;
  let maxConsecutiveDroppedSlots = 0;
  const intervalsMs = [];
  for (let index = 1; index < timestamps.length; index += 1) {
    const intervalUs = timestamps[index] - timestamps[index - 1];
    intervalsMs.push(intervalUs / 1_000);
    // A tolerance avoids calling ordinary scheduler jitter a missed refresh.
    const occupiedSlots = Math.max(1, Math.round(intervalUs / expectedIntervalUs));
    const missedSlots = Math.max(0, occupiedSlots - 1);
    droppedSlots += missedSlots;
    maxConsecutiveDroppedSlots = Math.max(maxConsecutiveDroppedSlots, missedSlots);
  }
  intervalsMs.sort((left, right) => left - right);
  const percentile = (ratio) =>
    intervalsMs[Math.min(intervalsMs.length - 1, Math.floor(intervalsMs.length * ratio))] ?? 0;
  const observedFrames = timestamps.length;
  const totalSlots = observedFrames + droppedSlots;
  return {
    observedFrames,
    droppedSlots,
    droppedPercent: totalSlots > 0 ? (droppedSlots / totalSlots) * 100 : 0,
    maxConsecutiveDroppedSlots,
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: intervalsMs.at(-1) ?? 0,
  };
}

function analyzeChromeFrameSignals(events, refreshRateHz) {
  const pipelineCounts = { normal: 0, partial: 0, dropped: 0 };
  const pipelineStateSamples = [];
  const seenPipelineReports = new Set();
  for (const event of events) {
    if (!/pipeline.*reporter/i.test(event.name ?? "")) continue;
    const values = collectScalarStrings(event.args).join(" ");
    let state;
    if (/presented[_ -]?partial|partial[_ -]?update|presentedpartial/.test(values)) state = "partial";
    else if (/dropped|missed/.test(values)) state = "dropped";
    else if (/presented[_ -]?all|presentedall|state[_ -]?presented/.test(values)) state = "normal";
    if (!state) continue;
    if (pipelineStateSamples.length < 6) {
      pipelineStateSamples.push({
        name: event.name,
        phase: event.ph,
        state,
        matchingValues: values
          .split(" ")
          .filter((value) => /presented|partial|dropped|missed/.test(value))
          .slice(0, 8),
      });
    }
    // PipelineReporter reuses async ids across frames in some Chromium builds.
    // Timestamp deduplication removes category aliases without collapsing the run.
    const identity = `${event.pid}:${event.tid}:${event.ts}:${state}`;
    if (!seenPipelineReports.has(identity)) {
      seenPipelineReports.add(identity);
      pipelineCounts[state] += 1;
    }
  }

  const explicitDroppedEvents = events.filter((event) =>
    /droppedframe|frame[_ -]?dropped|framemissed/i.test(event.name ?? ""),
  ).length;
  const explicitPartialEvents = events.filter((event) =>
    /partial[_ -]?(frame|update)|presented[_ -]?partial/i.test(event.name ?? ""),
  ).length;
  const drawFrameTimestamps = uniqueSortedTimestamps(events, "DrawFrame");
  const inferred = inferFrameSlots(drawFrameTimestamps, refreshRateHz);
  const hasPipelineStates = Object.values(pipelineCounts).some((count) => count > 0);
  const dropped = Math.max(
    pipelineCounts.dropped,
    explicitDroppedEvents,
    inferred.droppedSlots,
  );

  return {
    source: drawFrameTimestamps.length > 1
      ? "draw-frame-cadence-with-chrome-frame-signals"
      : hasPipelineStates
        ? "chrome-pipeline-reporter"
        : "unavailable",
    normal: inferred.observedFrames || pipelineCounts.normal,
    partial: pipelineCounts.partial || explicitPartialEvents || null,
    dropped,
    pipelineReporter: pipelineCounts,
    pipelineStateSamples,
    explicitDroppedEvents,
    explicitPartialEvents,
    drawFrames: drawFrameTimestamps.length,
    inferred,
    note: "Normal frames use DrawFrame cadence. Chrome PipelineReporter and explicit frame events are folded in when their states are exposed; otherwise dropped slots are inferred and partial remains null.",
  };
}

function analyzeTrace(traceEvents, refreshRateHz) {
  const frameSignals = analyzeChromeFrameSignals(traceEvents, refreshRateHz);
  return {
    eventCount: traceEvents.length,
    frameSignals,
    rendering: {
      layout: summarizeDurations(traceEvents, ["Layout"]),
      style: summarizeDurations(traceEvents, ["UpdateLayoutTree", "RecalculateStyles"]),
      paint: summarizeDurations(traceEvents, ["Paint", "PaintImage"]),
      composite: summarizeDurations(traceEvents, ["CompositeLayers", "DrawFrame"]),
    },
    gpu: {
      raster: summarizeDurations(traceEvents, ["RasterTask", "RasterBufferImpl::Playback"]),
      tasks: summarizeDurations(traceEvents, ["GPUTask", "GpuTask"]),
      swaps: summarizeDurations(traceEvents, ["SwapBuffers", "Display::DrawAndSwap"]),
    },
    animationTraceEvents: traceEvents.filter((event) =>
      /animation/i.test(event.name ?? ""),
    ).length,
  };
}

async function readTraceStream(cdp, stream) {
  let serialized = "";
  while (true) {
    const chunk = await cdp.send("IO.read", { handle: stream });
    serialized += chunk.data;
    if (chunk.eof) break;
  }
  await cdp.send("IO.close", { handle: stream }).catch(() => undefined);
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
  if (!result.stream) return { bytes: 0, events: [] };
  return readTraceStream(cdp, result.stream);
}

async function captureElementSnapshot(page, dpr = DPR) {
  return page.evaluate((dpr) => {
    const copies = [...document.querySelectorAll(".marquee-copy")];
    return copies.map((copy, index) => {
      const rect = copy.getBoundingClientRect();
      const style = getComputedStyle(copy);
      const physicalWidth = copy.scrollWidth * dpr;
      const physicalHeight = copy.scrollHeight * dpr;
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

async function resolveMarqueeBackendNodeIds(cdp) {
  try {
    await cdp.send("DOM.enable");
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: ".marquee-copy",
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

const browser = await chromium.launch();

try {
  const content = resolveContent();
  const context = await browser.newContext({
    deviceScaleFactor: DPR,
    viewport: VIEWPORT,
  });
  await context.addInitScript(() => {
    const instrumentation = {
      animateCalls: [],
      updatePlaybackRateCalls: [],
      longTasks: [],
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
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE });
  const layerSampler = createLayerSampler(cdp);
  await cdp.send("LayerTree.enable").catch(() => undefined);

  let maxTraceBufferUsage = 0;
  cdp.on("Tracing.bufferUsage", ({ percentFull = 0, value = 0 }) => {
    maxTraceBufferUsage = Math.max(maxTraceBufferUsage, percentFull, value);
  });

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

  const pwaBanner = page.locator(".pwa-status");
  if (await pwaBanner.isVisible().catch(() => false)) {
    const dismiss = pwaBanner.getByRole("button").last();
    if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
  }

  await page.getByRole("main").dblclick();
  await page.getByRole("textbox", { name: /編輯文字|Edit text/ }).fill(content);
  await page.getByRole("button", { name: /套用|Apply/ }).click();
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

  await page.waitForFunction(() => document.querySelectorAll(".marquee-copy").length === 2);
  await page.waitForTimeout(250);

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

  const beforeElementSnapshot = await captureElementSnapshot(page);
  const backendNodeIds = await resolveMarqueeBackendNodeIds(cdp);
  const before = metricMap(await cdp.send("Performance.getMetrics"));
  const instrumentationBefore = await page.evaluate(() => ({
    animateCalls: window.__marqueePerf.animateCalls.length,
    updatePlaybackRateCalls: window.__marqueePerf.updatePlaybackRateCalls.length,
    longTasks: window.__marqueePerf.longTasks.length,
    now: performance.now(),
  }));

  await cdp.send("Tracing.start", {
    categories: TRACE_CATEGORIES,
    options: "record-as-much-as-possible",
    transferMode: "ReturnAsStream",
  });
  layerSampler.active = true;
  await page.evaluate(() => performance.mark("marquee-perf-sample-start"));
  await page.waitForTimeout(DURATION_MS);
  await page.evaluate(() => performance.mark("marquee-perf-sample-end"));
  layerSampler.active = false;
  const trace = await stopAndReadTrace(cdp);

  const after = metricMap(await cdp.send("Performance.getMetrics"));
  const afterElementSnapshot = await captureElementSnapshot(page);
  const instrumentationAfter = await page.evaluate(() => ({
    animateCalls: window.__marqueePerf.animateCalls.length,
    updatePlaybackRateCalls: window.__marqueePerf.updatePlaybackRateCalls.length,
    longTasks: window.__marqueePerf.longTasks.length,
    longTaskEntries: window.__marqueePerf.longTasks,
  }));

  const traceAnalysis = analyzeTrace(trace.events, EXPECTED_REFRESH_RATE_HZ);
  const animationInstrumentation = {
    animateCallsDuringSample:
      instrumentationAfter.animateCalls - instrumentationBefore.animateCalls,
    updatePlaybackRateCallsDuringSample:
      instrumentationAfter.updatePlaybackRateCalls - instrumentationBefore.updatePlaybackRateCalls,
    longTasksDuringSample:
      instrumentationAfter.longTasks - instrumentationBefore.longTasks,
    recentLongTasks: instrumentationAfter.longTaskEntries
      .filter((entry) => entry.at >= instrumentationBefore.now)
      .slice(-20),
  };
  const maxPhysicalWidth = Math.max(
    0,
    ...afterElementSnapshot.map((copy) => copy.physicalPx.width),
  );
  const maxPhysicalArea = Math.max(
    0,
    ...afterElementSnapshot.map((copy) => copy.physicalPx.area),
  );
  const reportedFrameSlots =
    traceAnalysis.frameSignals.normal
    + (traceAnalysis.frameSignals.partial ?? 0)
    + traceAnalysis.frameSignals.dropped;
  const droppedPercent = reportedFrameSlots > 0
    ? (traceAnalysis.frameSignals.dropped / reportedFrameSlots) * 100
    : traceAnalysis.frameSignals.inferred.droppedPercent;
  const acceptance = {
    droppedFramesAtMostPercent: droppedPercent <= MAX_DROPPED_PERCENT,
    noTwoConsecutiveRefreshSlotsLost:
      traceAnalysis.frameSignals.inferred.maxConsecutiveDroppedSlots < 2,
    steadyLayoutIsZero: traceAnalysis.rendering.layout.count === 0,
    steadyPaintIsZero: traceAnalysis.rendering.paint.count === 0,
    noSteadyAnimationRebuild: animationInstrumentation.animateCallsDuringSample === 0,
    noSteadyRateController: animationInstrumentation.updatePlaybackRateCallsDuringSample === 0,
    layerWidthWithinBudget: maxPhysicalWidth <= 16_384,
    layerAreaWithinBudget: maxPhysicalArea <= 8_000_000,
  };
  const passed = Object.values(acceptance).every(Boolean);

  const result = {
    configuration: {
      baseUrl: BASE_URL,
      cpuRate: CPU_RATE,
      durationMs: DURATION_MS,
      dpr: DPR,
      expectedRefreshRateHz: EXPECTED_REFRESH_RATE_HZ,
      viewport: VIEWPORT,
      scenario: SCENARIO,
      contentCodePoints: Array.from(content).length,
      direction: DIRECTION,
      requestedSpeed: SPEED,
      flashEnabled: FLASH_ENABLED,
    },
    rafCalibration: {
      durationMs: RAF_SAMPLE_MS,
      ...rafCalibration,
      estimatedRefreshRateHz:
        rafCalibration.medianMs > 0 ? 1_000 / rafCalibration.medianMs : null,
    },
    chromeTrace: {
      bytes: trace.bytes,
      maxBufferUsage: maxTraceBufferUsage,
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
    acceptance: {
      thresholds: {
        maxDroppedPercent: MAX_DROPPED_PERCENT,
        maxConsecutiveDroppedSlots: 1,
        maxLayerDeviceWidthPx: 16_384,
        maxLayerDeviceAreaPx: 8_000_000,
      },
      observedDroppedPercent: droppedPercent,
      checks: acceptance,
      passed,
      enforced: ENFORCE_BUDGETS,
    },
  };

  console.log(JSON.stringify(result, null, 2));
  if (ENFORCE_BUDGETS && !passed) process.exitCode = 1;
} finally {
  await browser.close();
}
