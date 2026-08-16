/* global URLSearchParams, document, performance, requestAnimationFrame, window */

(function initializeMotionProbe() {
  "use strict";

  const DEFAULT_TEXT = "Aa";
  const DEFAULT_PIXELS_PER_SECOND = 240;
  const DEFAULT_FONT_SIZE = 112;
  const MAX_TEXT_CODE_POINTS = 350;
  const root = document.querySelector("#motion-probe");
  const stage = document.querySelector(".motion-probe__stage");
  const parameters = new URLSearchParams(window.location.search);
  const rasterEnabled = parameters.get("raster") === "1";

  if (rasterEnabled && stage) {
    const template = document.querySelector("#raster-lane-template");
    const blockLane = stage.querySelector('[data-probe-lane="block"]');
    if (template instanceof HTMLTemplateElement && blockLane) {
      blockLane.before(template.content.cloneNode(true));
    }
  }

  const lanes = [...document.querySelectorAll("[data-probe-lane]")];
  const runners = [...document.querySelectorAll("[data-probe-runner]")];
  const markers = [...document.querySelectorAll(".probe-runner__marker")];
  const textNode = document.querySelector("[data-probe-text]");
  const rasterCanvas = document.querySelector("[data-probe-raster]");
  const expectedLaneCount = rasterEnabled ? 3 : 2;

  if (
    !root ||
    !stage ||
    lanes.length !== expectedLaneCount ||
    runners.length !== expectedLaneCount ||
    markers.length !== expectedLaneCount ||
    !textNode ||
    (rasterEnabled && !(rasterCanvas instanceof HTMLCanvasElement))
  ) {
    document.documentElement.dataset.motionProbeState = "error";
    return;
  }

  function finiteNumber(name, fallback, minimum, maximum) {
    if (!parameters.has(name)) return fallback;
    const raw = parameters.get(name);
    if (raw === null || raw.trim() === "") return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsed));
  }

  function readText() {
    const requested = parameters.has("text")
      ? parameters.get("text") ?? ""
      : DEFAULT_TEXT;
    const points = Array.from(requested);
    return (points.length > 0 ? points : ["\u00a0"])
      .slice(0, MAX_TEXT_CODE_POINTS)
      .join("");
  }

  const pixelsPerSecond = finiteNumber(
    "pps",
    DEFAULT_PIXELS_PER_SECOND,
    1,
    1200,
  );
  const fontSize = finiteNumber("fontSize", DEFAULT_FONT_SIZE, 24, 200);
  const requestedWeight = Number(parameters.get("weight"));
  const fontWeight = [300, 400, 700, 900].includes(requestedWeight)
    ? requestedWeight
    : 900;
  const mode = parameters.get("mode") === "once" ? "once" : "alternate";
  const theme = parameters.get("theme") === "light" ? "light" : "dark";
  const labelsVisible = parameters.get("labels") === "1";
  const text = readText();
  const background = theme === "light" ? "#fafafc" : "#050505";
  const color = theme === "light" ? "#141416" : "#ffffff";
  const grid =
    theme === "light" ? "rgb(0 0 0 / 9%)" : "rgb(255 255 255 / 8%)";
  const divider =
    theme === "light" ? "rgb(0 0 0 / 18%)" : "rgb(255 255 255 / 18%)";
  const muted =
    theme === "light" ? "rgb(0 0 0 / 62%)" : "rgb(255 255 255 / 62%)";
  const style = document.documentElement.style;

  style.setProperty("--probe-background", background);
  style.setProperty("--probe-color", color);
  style.setProperty("--probe-grid", grid);
  style.setProperty("--probe-divider", divider);
  style.setProperty("--probe-muted", muted);
  style.setProperty("--probe-font-size", `${fontSize}px`);
  style.setProperty("--probe-font-weight", String(fontWeight));
  style.setProperty("--probe-lane-count", String(expectedLaneCount));
  document.documentElement.style.colorScheme = theme;
  root.dataset.probeMode = mode;
  root.dataset.rasterEnabled = String(rasterEnabled);
  root.classList.toggle("labels-hidden", !labelsVisible);
  root.classList.toggle("labels-visible", labelsVisible);
  textNode.textContent = text;
  document.title = `${text.trim() || "Motion"} — Motion Probe`;

  const speedMetric = document.querySelector('[data-probe-metric="speed"]');
  const modeMetric = document.querySelector('[data-probe-metric="mode"]');
  const durationMetric = document.querySelector(
    '[data-probe-metric="duration"]',
  );
  let layoutFrame = null;

  function renderRasterText() {
    if (!(rasterCanvas instanceof HTMLCanvasElement)) return null;

    const bounds = rasterCanvas.getBoundingClientRect();
    const cssWidth = Math.max(1, bounds.width);
    const cssHeight = Math.max(1, bounds.height);
    const requestedDpr = Math.max(1, window.devicePixelRatio || 1);
    const pixelBudget = 4_000_000;
    const budgetDpr = Math.sqrt(pixelBudget / (cssWidth * cssHeight));
    const rasterDpr = Math.min(requestedDpr, 3, budgetDpr);
    rasterCanvas.width = Math.max(1, Math.round(cssWidth * rasterDpr));
    rasterCanvas.height = Math.max(1, Math.round(cssHeight * rasterDpr));

    const context = rasterCanvas.getContext("2d", { alpha: true });
    if (!context) return null;

    const textStyle = getComputedStyle(textNode);
    context.setTransform(rasterDpr, 0, 0, rasterDpr, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.fillStyle = color;
    context.font = `${fontWeight} ${fontSize}px ${textStyle.fontFamily}`;
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(text, 0, cssHeight / 2);

    return Object.freeze({
      backingHeight: rasterCanvas.height,
      backingWidth: rasterCanvas.width,
      cssHeight,
      cssWidth,
      rasterDpr,
    });
  }

  function applyGeometry() {
    layoutFrame = null;
    const laneWidth = Math.max(1, ...lanes.map((lane) => lane.clientWidth));
    const objectWidth = Math.max(
      1,
      ...runners.map((runner) => runner.offsetWidth),
    );
    const markerWidth = Math.max(
      1,
      ...markers.map((marker) => marker.offsetWidth),
    );
    const inset = Math.min(24, Math.max(8, (laneWidth - objectWidth) / 4));
    const startX = inset;
    const endX = Math.max(startX + 1, laneWidth - inset - markerWidth);
    const travelDistance = endX - startX;
    const durationMs = Math.max(
      1,
      (travelDistance / pixelsPerSecond) * 1000,
    );

    style.setProperty("--probe-start-x", `${startX}px`);
    style.setProperty("--probe-end-x", `${endX}px`);
    style.setProperty("--probe-duration", `${durationMs}ms`);

    if (speedMetric) speedMetric.textContent = `${pixelsPerSecond} px/s`;
    if (modeMetric) {
      modeMetric.textContent = mode === "once" ? "one shot" : "alternate";
    }
    if (durationMetric) {
      durationMetric.textContent = `${(durationMs / 1000).toFixed(2)} s/leg`;
    }

    root.classList.add("is-ready");
    document.documentElement.dataset.motionProbeState = "ready";
    const raster = renderRasterText();
    window.__motionProbeSnapshot = Object.freeze({
      durationMs,
      endX,
      fontSize,
      fontWeight,
      labelsVisible,
      laneWidth,
      markerWidth,
      mode,
      objectWidth,
      pixelsPerSecond,
      raster,
      rasterEnabled,
      startX,
      text,
      theme,
      travelDistance,
    });
    performance.mark("motion-probe-layout");
  }

  function scheduleLayout() {
    if (layoutFrame !== null) return;
    layoutFrame = requestAnimationFrame(applyGeometry);
  }

  if (document.fonts?.ready) {
    document.fonts.ready.then(scheduleLayout, scheduleLayout);
  } else {
    scheduleLayout();
  }
})();
