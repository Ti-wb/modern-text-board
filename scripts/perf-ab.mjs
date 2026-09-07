/* global URL, console, process */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Examples:
// PERF_ENGINES=css,canvas PERF_REPEATS=3 node scripts/perf-ab.mjs
// PERF_ENGINES=waapi,css,canvas PERF_PHASES=steady,speed-drag,resize PERF_DURATION_MS=60000 node scripts/perf-ab.mjs
const VALID_ENGINES = ["waapi", "css", "canvas", "worker"];
const VALID_PHASES = ["steady", "speed-drag", "resize"];
const targets = readChoices("PERF_TARGETS", ["app", "clean", "probe"], [process.env.PERF_TARGET ?? "app"]);
const loops = readChoices("PERF_LOOPS", ["linear", "continuous"], [process.env.PERF_LOOP ?? "linear"]);
const smokeScript = fileURLToPath(new URL("./perf-smoke.mjs", import.meta.url));
const engines = readChoices(
  "PERF_ENGINES",
  VALID_ENGINES,
  process.env.PERF_ENGINE ? [process.env.PERF_ENGINE] : process.env.PERF_PROFILE === "real" ? ["waapi", "css"] : ["css", "canvas"],
);
const phases = readChoices(
  "PERF_PHASES",
  VALID_PHASES,
  process.env.PERF_PHASE ? [process.env.PERF_PHASE] : ["steady"],
);
const repeats = readPositiveInteger("PERF_REPEATS", 3);
const enforce = /^(1|true|yes)$/i.test(process.env.PERF_ENFORCE ?? "false");

function readChoices(name, valid, fallback) {
  const values = process.env[name]
    ? process.env[name].split(",").map((value) => value.trim()).filter(Boolean)
    : fallback;
  const invalid = values.filter((value) => !valid.includes(value));
  if (values.length === 0 || invalid.length > 0) {
    throw new Error(
      `${name} must contain ${valid.join(", ")}; received ${process.env[name]}`,
    );
  }
  return [...new Set(values)];
}

function readPositiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received ${process.env[name]}`);
  }
  return value;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function summarizeRun(result, repeat) {
  const trace = result.chromeTrace;
  const runtime = result.animationInstrumentation;
  const cadence = trace?.frameSignals.cadence;
  return {
    repeat,
    passed: result.acceptance.passed,
    frameSource: trace?.frameSignals.source ?? "unavailable",
    artifacts: result.artifacts,
    environment: result.environment,
    workload: {
      content: result.configuration.content,
      viewport: result.configuration.viewport,
      dpr: result.configuration.dpr,
      font: result.motion.font,
      effectivePixelsPerSecond: result.motion.effectivePixelsPerSecond,
      distance: result.motion.distance,
      loopMode: result.motion.loopMode,
      inkMode: result.motion.inkMode,
      targetUrl: result.configuration.targetUrl,
    },
    droppedPercent: result.acceptance.observedDroppedPercent ?? null,
    stuttersPerMinute: trace?.stutters.perMinute ?? null,
    stutterCount: trace?.stutters.count ?? null,
    maxConsecutiveDroppedSlots: cadence?.maxConsecutiveDroppedSlots ?? null,
    p95FrameIntervalMs: cadence?.p95Ms ?? null,
    p99FrameIntervalMs: cadence?.p99Ms ?? null,
    p999FrameIntervalMs: cadence?.p999Ms ?? null,
    maxFrameIntervalMs: cadence?.maxMs ?? null,
    longTasks: runtime?.available ? runtime.longTasksDuringSample : null,
    layoutCount: trace?.rendering.layout.count ?? null,
    paintCount: trace?.rendering.paint.count ?? null,
    gpuRasterMs: trace?.gpu.raster.totalMs ?? null,
    mainThreadTaskMs: result.mainThread?.taskMs ?? null,
    mainThreadScriptMs: result.mainThread?.scriptMs ?? null,
    appRafCallbacks: runtime?.rafDuringSample?.callbacks ?? null,
    cssAnimationStarts: runtime?.cssAnimationEventsDuringSample?.animationstart ?? null,
    cssAnimationCancels: runtime?.cssAnimationEventsDuringSample?.animationcancel ?? null,
    canvasDrawImageCalls: runtime?.canvasCallsDuringSample?.drawImage ?? null,
  };
}

function aggregateRuns(runs) {
  const numericKeys = Object.keys(runs[0]).filter((key) =>
    key !== "repeat" && runs.some((run) => typeof run[key] === "number"),
  );
  const sources = [...new Set(runs.map((run) => run.frameSource))];
  const homogeneousFrameSource = sources.length === 1 && sources[0] !== "unavailable";
  return {
    repeats: runs.length,
    passCount: runs.filter((run) => run.passed).length,
    frameSources: sources,
    homogeneousFrameSource,
    median: Object.fromEntries(
      numericKeys.map((key) => [key, homogeneousFrameSource && runs.every((run) => Number.isFinite(run[key]))
        ? median(runs.map((run) => run[key])) : null]),
    ),
    runs,
  };
}

const cells = [];
for (const target of targets) {
  if (target !== "app" && phases.some((phase) => phase !== "steady")) {
    throw new Error("Clean/probe targets support steady sampling only.");
  }
  for (const engine of target === "app" ? engines : ["css"]) {
    for (const loop of target === "app" && engine === "waapi" ? loops : ["linear"]) {
      for (const phase of phases) cells.push({ target, engine, loop, phase, runs: [] });
    }
  }
}
const runOrder = [];
for (let repeat = 1; repeat <= repeats; repeat += 1) {
  // Reverse alternate rounds so neither warm caches nor temperature consistently
  // favor the same renderer. Every child still gets a fresh browser profile.
  for (const cell of repeat % 2 === 1 ? cells : [...cells].reverse()) {
    const { target, engine, loop, phase } = cell;
    let baseUrl = process.env.PERF_BASE_URL;
    if (targets.length > 1 && target !== "app" && baseUrl) {
      baseUrl = new URL(target === "clean" ? "/experiments/marquee-clean/" : "/experiments/marquee-motion-probe/", baseUrl).toString();
    }
    process.stderr.write(`[perf:ab] round ${repeat}/${repeats} ${target}/${engine}/${loop}/${phase}\n`);
    const child = spawnSync(process.execPath, [smokeScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        PERF_ENGINE: engine,
        PERF_TARGET: target,
        PERF_LOOP: loop,
        PERF_PHASE: phase,
        PERF_ENFORCE: "false",
        ...(baseUrl ? { PERF_BASE_URL: baseUrl } : {}),
      },
      maxBuffer: 64 * 1024 * 1024,
    });
    if (child.error) throw child.error;
    let result;
    try {
      result = JSON.parse(child.stdout);
    } catch {
      process.stderr.write(child.stderr ?? "");
      throw new Error(
        `Could not parse ${engine}/${phase} repeat ${repeat}; exit ${child.status}.`,
      );
    }
    if (child.status !== 0) {
      process.stderr.write(child.stderr ?? "");
      throw new Error(`${engine}/${phase} repeat ${repeat} exited ${child.status}.`);
    }
    cell.runs.push(summarizeRun(result, repeat));
    runOrder.push({ repeat, target, engine, loop, phase, summary: result.artifacts.summary });
  }
}

const aggregatedCells = cells.map(({ runs, ...cell }) => ({ ...cell, ...aggregateRuns(runs) }));
const allRunsPassed = cells.some((cell) => cell.runs.some((run) => run.passed === null)) ? null
  : aggregatedCells.every((cell) => cell.passCount === cell.repeats);
const output = {
  schemaVersion: 2,
  configuration: {
    targets,
    loops,
    engines,
    phases,
    repeats,
    durationMs: Number(process.env.PERF_DURATION_MS ?? (process.env.PERF_PROFILE === "real" ? 120_000 : 10_000)),
    baseUrl: process.env.PERF_BASE_URL ?? "http://127.0.0.1:4173",
  },
  cells: aggregatedCells,
  runOrder,
  allRunsPassed,
  physicalDeviceValidated: false,
  note: "Compare identical workload, actual speed, browser/GPU and frame source. Medians cannot establish physical-device acceptance; software/headless results only validate the harness. Complete the five-minute visual check on the affected device.",
};

const outputDirectory = resolve(process.env.PERF_OUTPUT_DIR ?? "perf-results/marquee-perf");
await mkdir(outputDirectory, { recursive: true });
output.summaryPath = resolve(outputDirectory, `ab-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.json`);
await writeFile(output.summaryPath, JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
if (enforce && !allRunsPassed) process.exitCode = 1;
