import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeTrace, summarizeCadence } from "./perf-trace.mjs";

const start = 1_000_000;
const markers = [
  { name: "marquee-perf-sample-start", ph: "I", ts: start, pid: 10, tid: 11 },
  { name: "marquee-perf-sample-end", ph: "I", ts: start + 200_000, pid: 10, tid: 11 },
];
const draw = (offset, overrides = {}) => ({
  name: "DrawFrame", ph: "I", ts: start + offset, pid: 10, tid: 12,
  args: { layerTreeId: 7 }, ...overrides,
});
const report = (sequence, begin, end, state = "STATE_PRESENTED_ALL", extra = {}) => [
  {
    name: "PipelineReporter", ph: "b", pid: 10, tid: 12, ts: start + begin,
    id2: { local: "0x1" }, args: { frame_reporter: {
      layer_tree_host_id: 7, frame_source: 20, frame_sequence: sequence, state, ...extra,
    } },
  },
  { name: "PipelineReporter", ph: "e", pid: 10, tid: 12, ts: start + end, id2: { local: "0x1" }, args: {} },
];

test("scopes frame intervals to one renderer, thread, layer and sample window", () => {
  const events = [
    ...markers, draw(-10_000), draw(210_000), draw(0), draw(20_000), draw(60_000),
    draw(40_000, { pid: 99 }), draw(80_000, { pid: 99 }),
    // Category aliases must not add observations.
    draw(60_000, { cat: "another-category" }),
  ];
  const result = analyzeTrace(events, 50);
  assert.equal(result.frameSignals.source, "draw-frame-cadence-estimate");
  assert.equal(result.frameSignals.inferred.observedIntervals, 2);
  assert.equal(result.frameSignals.inferred.droppedSlots, 1);
  assert.ok(Math.abs(result.frameSignals.inferred.droppedPercent - 100 / 3) < 1e-10);
  assert.equal(result.frameSignals.presentation.available, false);
  assert.equal(result.stutters.count, 1);
  assert.equal(result.stutters.events[0].startOffsetMs, 20);
  assert.equal(result.stutters.events[0].endOffsetMs, 60);
});

test("uses async END presentation timestamps and handles reused ids and aliases", () => {
  const frames = [
    ...report(1, -10_000, 10_000),
    ...report(2, 20_000, 30_000),
    ...report(3, 40_000, 70_000, "STATE_PRESENTED_PARTIAL"),
    ...report(4, 80_000, 90_000, "STATE_DROPPED"),
    ...report(5, 195_000, 205_000),
  ];
  const result = analyzeTrace([
    ...markers, draw(0), draw(20_000), draw(40_000), draw(60_000), draw(80_000),
    ...frames, ...frames.map((event) => ({ ...event, cat: "alias" })),
    ...report(10, 100_000, 120_000).map((event) => ({ ...event, pid: 90 })),
  ], 50);
  assert.equal(result.frameSignals.source, "chrome-presentation-feedback");
  assert.deepEqual(result.frameSignals.presentation.counts, { normal: 2, partial: 1, dropped: 1 });
  assert.equal(result.frameSignals.droppedPercent, 25);
  assert.equal(result.frameSignals.cadence.p999Ms, 40);
  assert.equal(result.frameSignals.inferred.stutters.length, 0);
  assert.equal(result.stutters.count, 1);
  assert.equal(result.stutters.events[0].endOffsetMs, 70);
});

test("incomplete or unknown presentation records cannot be interpreted as zero drops", () => {
  const result = analyzeTrace([
    ...markers, ...report(1, 0, 20_000, "STATE_NO_UPDATE_DESIRED"),
    report(2, 40_000, 60_000)[0],
  ], 50);
  assert.equal(result.frameSignals.source, "unavailable");
  assert.equal(result.frameSignals.droppedPercent, null);
  assert.equal(result.frameSignals.cadence.p99Ms, null);
  assert.equal(result.stutters.count, null);
  assert.equal(result.frameSignals.presentation.incompletePairs, 1);
});

test("refuses to merge competing layer or presentation source domains", () => {
  const result = analyzeTrace([
    ...markers, draw(0), draw(40_000), draw(20_000, { args: { layerTreeId: 8 } }),
    ...report(1, 0, 10_000), ...report(2, 20_000, 30_000),
    ...report(3, 40_000, 50_000, "STATE_PRESENTED_ALL", { frame_source: 99 }),
    ...report(4, 60_000, 70_000, "STATE_PRESENTED_ALL", { frame_source: 99 }),
  ], 50);
  assert.equal(result.frameSignals.drawDomains.length, 2);
  assert.equal(result.frameSignals.presentation.domains.length, 2);
  assert.equal(result.frameSignals.source, "unavailable");
});

test("does not promote reports with unknown domain metadata to presentation feedback", () => {
  for (const missing of [{ frame_source: undefined }, { layer_tree_host_id: undefined }]) {
    const records = [
      ...markers,
      ...report(1, 0, 10_000, "STATE_PRESENTED_ALL", missing),
      ...report(2, 20_000, 30_000, "STATE_PRESENTED_ALL", missing),
    ];
    const result = analyzeTrace(records, 50);
    assert.equal(result.frameSignals.source, "unavailable");
    assert.equal(result.frameSignals.droppedPercent, null);
    assert.equal(result.frameSignals.presentation.available, false);
  }
});

test("clips work crossing markers and excludes unrelated renderer layout", () => {
  const result = analyzeTrace([
    ...markers, draw(0), draw(40_000),
    { name: "Layout", ph: "X", pid: 10, tid: 11, ts: start - 5000, dur: 10_000 },
    { name: "Layout", ph: "X", pid: 90, tid: 91, ts: start + 10_000, dur: 100_000 },
    { name: "Paint", ph: "X", pid: 10, tid: 11, ts: start + 195_000, dur: 10_000 },
    { name: "Paint", ph: "X", pid: 10, tid: 11, ts: start + 210_000, dur: 10_000 },
  ], 50);
  assert.deepEqual(result.rendering.layout, { count: 1, totalMs: 5, maxMs: 5 });
  assert.deepEqual(result.rendering.paint, { count: 1, totalMs: 5, maxMs: 5 });
  assert.equal(result.stutters.events[0].overlappingWork[0].name, "Layout");
  assert.equal(result.stutters.events[0].overlappingWork[0].durationMs, 5);
});

test("requires matching markers instead of silently analyzing startup or another page", () => {
  assert.throws(() => analyzeTrace([], 60), /marker/);
  assert.throws(() => analyzeTrace([markers[0], { ...markers[1], pid: 99 }], 60), /marker/);
  assert.throws(() => analyzeTrace([...markers, markers[0]], 60), /marker/);
});

test("reports rare tail intervals, consecutive lost slots, and no-data explicitly", () => {
  assert.equal(summarizeCadence([], 60).droppedSlots, null);
  assert.equal(summarizeCadence([0], 60).p999Ms, null);
  assert.throws(() => summarizeCadence([0, 1], 0), /positive/);
  const frames = Array.from({ length: 2000 }, (_, i) => i * 20_000);
  frames.push(frames.at(-1) + 60_000);
  const result = summarizeCadence(frames, 50);
  assert.equal(result.p99Ms, 20);
  assert.equal(result.maxMs, 60);
  assert.equal(result.maxConsecutiveDroppedSlots, 2);
  assert.equal(result.stutters.length, 1);
});
