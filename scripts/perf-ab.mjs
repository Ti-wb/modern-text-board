/* global URL, console, process */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Examples:
// PERF_ENGINES=css,canvas PERF_REPEATS=3 node scripts/perf-ab.mjs
// PERF_ENGINES=waapi,css,canvas PERF_PHASES=steady,speed-drag,resize PERF_DURATION_MS=60000 node scripts/perf-ab.mjs
const VALID_ENGINES = ["waapi", "css", "canvas", "worker"];
const VALID_PHASES = ["steady", "speed-drag", "resize"];
const smokeScript = fileURLToPath(new URL("./perf-smoke.mjs", import.meta.url));
const engines = readChoices(
  "PERF_ENGINES",
  VALID_ENGINES,
  process.env.PERF_ENGINE ? [process.env.PERF_ENGINE] : ["css", "canvas"],
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
  return {
    repeat,
    passed: result.acceptance.passed,
    droppedPercent: result.acceptance.observedDroppedPercent,
    maxConsecutiveDroppedSlots:
      result.chromeTrace.frameSignals.inferred.maxConsecutiveDroppedSlots,
    p95FrameIntervalMs: result.chromeTrace.frameSignals.inferred.p95Ms,
    p99FrameIntervalMs: result.chromeTrace.frameSignals.inferred.p99Ms,
    longTasks: result.animationInstrumentation.longTasksDuringSample,
    layoutCount: result.chromeTrace.rendering.layout.count,
    paintCount: result.chromeTrace.rendering.paint.count,
    gpuRasterMs: result.chromeTrace.gpu.raster.totalMs,
    mainThreadTaskMs: result.mainThread.taskMs,
    mainThreadScriptMs: result.mainThread.scriptMs,
    appRafCallbacks: result.animationInstrumentation.rafDuringSample.callbacks,
    cssAnimationStarts:
      result.animationInstrumentation.cssAnimationEventsDuringSample.animationstart,
    cssAnimationCancels:
      result.animationInstrumentation.cssAnimationEventsDuringSample.animationcancel,
    canvasDrawImageCalls:
      result.animationInstrumentation.canvasCallsDuringSample.drawImage,
  };
}

function aggregateRuns(runs) {
  const numericKeys = Object.keys(runs[0]).filter(
    (key) => key !== "repeat" && key !== "passed" && typeof runs[0][key] === "number",
  );
  return {
    repeats: runs.length,
    passCount: runs.filter((run) => run.passed).length,
    median: Object.fromEntries(
      numericKeys.map((key) => [key, median(runs.map((run) => run[key]))]),
    ),
    runs,
  };
}

const cells = [];
for (const engine of engines) {
  for (const phase of phases) {
    const runs = [];
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      const child = spawnSync(process.execPath, [smokeScript], {
        encoding: "utf8",
        env: {
          ...process.env,
          PERF_ENGINE: engine,
          PERF_PHASE: phase,
          PERF_ENFORCE: "false",
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
      runs.push(summarizeRun(result, repeat));
    }
    cells.push({ engine, phase, ...aggregateRuns(runs) });
  }
}

const allRunsPassed = cells.every((cell) => cell.passCount === cell.repeats);
const output = {
  configuration: {
    engines,
    phases,
    repeats,
    durationMs: Number(process.env.PERF_DURATION_MS ?? 10_000),
    baseUrl: process.env.PERF_BASE_URL ?? "http://127.0.0.1:4173",
  },
  cells,
  allRunsPassed,
  note: "Headless Chromium medians support relative comparison only. A final engine choice still requires the planned 60 Hz, ProMotion, and low-end real-device passes.",
};

console.log(JSON.stringify(output, null, 2));
if (enforce && !allRunsPassed) process.exitCode = 1;
