// Trace timestamps are microseconds. Never combine frame domains or treat
// missing presentation feedback as zero dropped frames.
const STATES = new Map([
  ["STATE_PRESENTED_ALL", "normal"],
  ["STATE_PRESENTED_PARTIAL", "partial"],
  ["STATE_DROPPED", "dropped"],
]);

export function summarizeCadence(timestamps, refreshRateHz, originTimestamp = 0) {
  if (!Number.isFinite(refreshRateHz) || refreshRateHz <= 0) {
    throw new Error("A positive refresh rate is required for cadence analysis.");
  }
  const sorted = [...new Set(timestamps)].sort((a, b) => a - b);
  const expectedIntervalUs = 1_000_000 / refreshRateHz;
  const intervalsMs = [];
  const stutters = [];
  let droppedSlots = 0;
  let maxConsecutiveDroppedSlots = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const intervalUs = sorted[index] - sorted[index - 1];
    const missedSlots = Math.max(0, Math.round(intervalUs / expectedIntervalUs) - 1);
    intervalsMs.push(intervalUs / 1_000);
    droppedSlots += missedSlots;
    maxConsecutiveDroppedSlots = Math.max(maxConsecutiveDroppedSlots, missedSlots);
    if (intervalUs > expectedIntervalUs * 1.5) {
      stutters.push({
        startOffsetMs: (sorted[index - 1] - originTimestamp) / 1_000,
        endOffsetMs: (sorted[index] - originTimestamp) / 1_000,
        intervalMs: intervalUs / 1_000,
        missedSlots,
      });
    }
  }
  const sortedIntervals = [...intervalsMs].sort((a, b) => a - b);
  const percentile = (fraction) => sortedIntervals.length === 0 ? null
    : sortedIntervals[Math.max(0, Math.ceil(sortedIntervals.length * fraction) - 1)];
  // The first observation has no preceding interval inside the sample.
  const totalSlots = intervalsMs.length + droppedSlots;
  return {
    observedFrames: sorted.length,
    observedIntervals: intervalsMs.length,
    droppedSlots: totalSlots > 0 ? droppedSlots : null,
    droppedPercent: totalSlots > 0 ? droppedSlots / totalSlots * 100 : null,
    maxConsecutiveDroppedSlots: totalSlots > 0 ? maxConsecutiveDroppedSlots : null,
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    p999Ms: percentile(0.999),
    maxMs: sortedIntervals.at(-1) ?? null,
    stutters,
  };
}

function sampleWindow(events) {
  const starts = events.filter((event) => event.name === "marquee-perf-sample-start");
  const ends = events.filter((event) => event.name === "marquee-perf-sample-end");
  if (starts.length !== 1 || ends.length !== 1 ||
      !Number.isFinite(starts[0].ts) || !Number.isFinite(ends[0].ts) ||
      starts[0].pid !== ends[0].pid || starts[0].tid !== ends[0].tid ||
      ends[0].ts <= starts[0].ts) {
    throw new Error("Trace needs one matching start/end marker pair from the target page.");
  }
  return {
    start: starts[0].ts,
    end: ends[0].ts,
    rendererPid: starts[0].pid,
    mainTid: starts[0].tid,
    durationMs: (ends[0].ts - starts[0].ts) / 1_000,
  };
}

function clipEvents(events, window) {
  return events.flatMap((event) => {
    if (!Number.isFinite(event.ts) || event.ph === "M") return [];
    if (Number.isFinite(event.dur) && event.dur > 0) {
      const start = Math.max(event.ts, window.start);
      const end = Math.min(event.ts + event.dur, window.end);
      return end > start ? [{ ...event, ts: start, dur: end - start }] : [];
    }
    return event.ts >= window.start && event.ts < window.end ? [event] : [];
  });
}

function groupsBy(events, keyFor) {
  const groups = new Map();
  for (const event of events) {
    const key = keyFor(event);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  return groups;
}

function analyzeFrames(allEvents, events, window, refreshRateHz) {
  const draws = events.filter((event) =>
    event.name === "DrawFrame" && event.pid === window.rendererPid);
  const drawGroups = groupsBy(draws, (event) =>
    `${event.pid}:${event.tid}:${event.args?.layerTreeId ?? "unknown"}`);
  // Ambiguous domains stay unavailable rather than selecting the busiest one.
  const drawEvents = drawGroups.size === 1 ? [...drawGroups.values()][0] : [];
  const drawDomain = drawEvents[0] ? {
    pid: drawEvents[0].pid,
    tid: drawEvents[0].tid,
    layerTreeId: drawEvents[0].args?.layerTreeId ?? null,
  } : null;
  const inferred = summarizeCadence(drawEvents.map((e) => e.ts), refreshRateHz, window.start);

  // Chromium annotates the async BEGIN with the final state, but that timestamp
  // is frame production, not presentation. Pair it with its own END, including
  // pairs crossing the sampling boundary. Async ids can be reused every frame.
  const pipeline = allEvents.filter((event) => event.name === "PipelineReporter" &&
    event.pid === window.rendererPid && Number.isFinite(event.ts))
    .sort((a, b) => a.ts - b.ts);
  const open = new Map();
  const seenEvents = new Set();
  const completed = [];
  let incompletePairs = 0;
  for (const event of pipeline) {
    const id = event.id2?.local ?? event.id2?.global ?? event.id;
    if (id === undefined) continue;
    const key = `${event.pid}:${event.tid}:${event.scope ?? ""}:${id}`;
    const identity = `${key}:${event.ph}:${event.ts}`;
    if (seenEvents.has(identity)) continue;
    seenEvents.add(identity);
    if (event.ph === "b") {
      if (open.has(key)) incompletePairs += 1;
      open.set(key, event);
    } else if (event.ph === "e") {
      const begin = open.get(key);
      open.delete(key);
      const reporter = begin?.args?.frame_reporter ?? begin?.args?.chrome_frame_reporter;
      const state = STATES.get(reporter?.state);
      if (!begin || !state || event.ts < window.start || event.ts >= window.end) continue;
      if (drawDomain && (begin.tid !== drawDomain.tid ||
          (drawDomain.layerTreeId !== null && reporter.layer_tree_host_id !== drawDomain.layerTreeId))) continue;
      completed.push({
        pid: begin.pid, tid: begin.tid,
        layerTreeId: reporter.layer_tree_host_id ?? null,
        frameSource: reporter.frame_source ?? null,
        frameSequence: reporter.frame_sequence ?? null,
        state, ts: event.ts, beginTs: begin.ts,
        needsRaster: reporter.checkerboarded_needs_raster === true,
        needsRecord: reporter.checkerboarded_needs_record === true,
      });
    }
  }
  incompletePairs += open.size;
  const reportGroups = groupsBy(completed, (event) =>
    `${event.pid}:${event.tid}:${event.layerTreeId}:${event.frameSource}`);
  const reports = reportGroups.size === 1 ? [...reportGroups.values()][0] : [];
  const seenReports = new Set();
  const frames = reports.filter((event) => {
    const identity = event.frameSequence === null ? `${event.beginTs}:${event.ts}:${event.state}`
      : `${event.frameSequence}:${event.state}`;
    if (seenReports.has(identity)) return false;
    seenReports.add(identity);
    return true;
  });
  const counts = { normal: 0, partial: 0, dropped: 0 };
  for (const frame of frames) counts[frame.state] += 1;
  const presented = frames.filter((event) => event.state !== "dropped");
  const presentationCadence = summarizeCadence(presented.map((e) => e.ts), refreshRateHz, window.start);
  const hasKnownPresentationDomain = frames.length > 0 && frames.every((frame) =>
    frame.layerTreeId !== null && frame.frameSource !== null);
  const hasPresentation = hasKnownPresentationDomain && presentationCadence.observedIntervals > 0;
  const hasDrawCadence = inferred.observedIntervals > 0;
  const cadence = hasPresentation ? presentationCadence : inferred;
  const totalReported = counts.normal + counts.partial + counts.dropped;
  return {
    source: hasPresentation ? "chrome-presentation-feedback"
      : hasDrawCadence ? "draw-frame-cadence-estimate" : "unavailable",
    domain: hasPresentation ? {
      pid: frames[0].pid, tid: frames[0].tid,
      layerTreeId: frames[0].layerTreeId, frameSource: frames[0].frameSource,
    } : drawDomain,
    normal: hasPresentation ? counts.normal : hasDrawCadence ? inferred.observedIntervals : null,
    partial: hasPresentation ? counts.partial : null,
    dropped: hasPresentation ? counts.dropped : inferred.droppedSlots,
    droppedPercent: hasPresentation ? counts.dropped / totalReported * 100 : inferred.droppedPercent,
    drawFrames: drawEvents.length,
    drawDomains: [...drawGroups.keys()],
    inferred,
    cadence,
    presentation: {
      available: hasPresentation,
      domains: [...reportGroups.keys()],
      counts: frames.length ? counts : null,
      incompletePairs,
      cadence: presentationCadence,
      exceptionalFrames: frames.filter((frame) => frame.state !== "normal" || frame.needsRaster || frame.needsRecord)
        .map(({ ts, beginTs, ...frame }) => ({
          ...frame, offsetMs: (ts - window.start) / 1_000,
          pipelineMs: (ts - beginTs) / 1_000,
        })),
    },
    note: "Presentation feedback and DrawFrame estimates are separate. Browser feedback is not proof of physical display scanout; inspect headed/GPU metadata and validate on the affected device.",
  };
}

function durations(events, names) {
  const accepted = new Set(names);
  let count = 0;
  let totalMs = 0;
  let maxMs = 0;
  for (const event of events) {
    if (!accepted.has(event.name) || !Number.isFinite(event.dur)) continue;
    count += 1;
    totalMs += event.dur / 1_000;
    maxMs = Math.max(maxMs, event.dur / 1_000);
  }
  return { count, totalMs, maxMs };
}

function eventWindow(events, names, origin) {
  const accepted = new Set(names);
  const matches = events.filter((event) => accepted.has(event.name)).sort((a, b) => a.ts - b.ts);
  return {
    firstOffsetMs: matches.length ? (matches[0].ts - origin) / 1_000 : null,
    lastOffsetMs: matches.length ? (matches.at(-1).ts - origin) / 1_000 : null,
    sampleOffsetsMs: matches.slice(0, 6).map((e) => (e.ts - origin) / 1_000),
    threads: [...new Set(matches.map((e) => `${e.pid}:${e.tid}`))],
  };
}

function paintBursts(events, origin) {
  const paints = events.filter((e) => ["Paint", "PaintImage"].includes(e.name) && Number.isFinite(e.dur))
    .sort((a, b) => a.ts - b.ts);
  const bursts = [];
  for (const paint of paints) {
    let burst = bursts.at(-1);
    if (!burst || paint.ts - burst.last > 50_000) {
      burst = { first: paint.ts, last: paint.ts, count: 0, totalMs: 0, maxMs: 0 };
      bursts.push(burst);
    }
    burst.last = paint.ts;
    burst.count += 1;
    burst.totalMs += paint.dur / 1_000;
    burst.maxMs = Math.max(burst.maxMs, paint.dur / 1_000);
  }
  return bursts.map(({ first, last, ...burst }) => ({
    ...burst, firstOffsetMs: (first - origin) / 1_000, spanMs: (last - first) / 1_000,
  }));
}

export function analyzeTrace(allEvents, refreshRateHz) {
  const window = sampleWindow(allEvents);
  const events = clipEvents(allEvents, window);
  const renderer = events.filter((e) => e.pid === window.rendererPid);
  const main = renderer.filter((e) => e.tid === window.mainTid);
  const gpuPids = new Set(allEvents.filter((e) => e.name === "process_name" &&
    /gpu/i.test(e.args?.name ?? "")).map((e) => e.pid));
  const gpuEvents = events.filter((e) => gpuPids.has(e.pid));
  const frameSignals = analyzeFrames(allEvents, events, window, refreshRateHz);
  const workNames = /^(Layout|Paint|PaintImage|RasterTask|RasterBufferImpl::Playback|FireAnimationFrame|TimerFire|RunMicrotasks|GPUTask|GpuTask|SwapBuffers|Display::DrawAndSwap|DirectRenderer::DrawFrame)$|GC|CollectGarbage/;
  const work = [...renderer, ...gpuEvents].filter((e) => workNames.test(e.name) && Number.isFinite(e.dur));
  const stutters = frameSignals.cadence.stutters.map((stutter, index, all) => {
    const start = window.start + stutter.startOffsetMs * 1_000;
    const end = window.start + stutter.endOffsetMs * 1_000;
    const overlapping = work.filter((e) => e.ts < end && e.ts + e.dur > start);
    return {
      ...stutter,
      sincePreviousMs: index ? stutter.endOffsetMs - all[index - 1].endOffsetMs : null,
      // Temporal overlap guides inspection; it does not establish causality.
      overlappingWork: overlapping.sort((a, b) => b.dur - a.dur).slice(0, 12).map((e) => ({
        name: e.name, pid: e.pid, tid: e.tid,
        offsetMs: (e.ts - window.start) / 1_000, durationMs: e.dur / 1_000,
      })),
    };
  });
  return {
    eventCount: events.length,
    sample: window,
    frameSignals,
    stutters: {
      source: frameSignals.source,
      count: frameSignals.source === "unavailable" ? null : stutters.length,
      perMinute: frameSignals.source === "unavailable" ? null : stutters.length / window.durationMs * 60_000,
      events: stutters,
    },
    rendering: {
      layout: durations(main, ["Layout"]),
      style: durations(main, ["UpdateLayoutTree", "RecalculateStyles"]),
      paint: durations(main, ["Paint", "PaintImage"]),
      composite: durations(renderer, ["CompositeLayers", "DrawFrame"]),
      eventWindows: {
        style: eventWindow(main, ["UpdateLayoutTree", "RecalculateStyles"], window.start),
        paint: eventWindow(main, ["Paint", "PaintImage"], window.start),
      },
      paintBursts: paintBursts(main, window.start),
    },
    gpu: {
      raster: durations(renderer, ["RasterTask", "RasterBufferImpl::Playback"]),
      tasks: durations(gpuEvents, ["GPUTask", "GpuTask"]),
      swaps: durations(gpuEvents, ["SwapBuffers", "Display::DrawAndSwap"]),
      note: "Raster is scoped to the target renderer; GPU process activity is shared and only a correlation signal.",
    },
    animationTraceEvents: renderer.filter((e) => /animation/i.test(e.name)).length,
  };
}
