/* global CSS, URLSearchParams, document, performance, requestAnimationFrame, window */

(function initializeCleanMarquee() {
  "use strict";

  const DIRECTIONS = new Set(["left", "right", "up", "down"]);
  const MAX_TEXT_CODE_POINTS = 350;
  const DEFAULT_TEXT =
    "這是一個沒有 Preact、PWA、工具列的純 CSS 跑馬燈 · Clean CSS marquee";
  const DEFAULT_SPEED_SETTING = 40;
  const root = document.querySelector("#clean-marquee");
  const copies = [...document.querySelectorAll(".clean-marquee__copy")];
  const textNodes = [...document.querySelectorAll(".clean-marquee__text")];
  const semanticText = document.querySelector("#clean-marquee-semantic-text");

  if (!root || copies.length !== 2 || textNodes.length !== 2 || !semanticText) {
    document.documentElement.dataset.cleanMarqueeState = "error";
    return;
  }

  const parameters = new URLSearchParams(window.location.search);

  function finiteNumber(name, fallback, minimum, maximum) {
    if (!parameters.has(name)) return fallback;
    const parsed = Number(parameters.get(name));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsed));
  }

  function supportedColor(name, fallback) {
    const candidate = parameters.get(name);
    return candidate && CSS.supports("color", candidate) ? candidate : fallback;
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

  const requestedDirection = parameters.get("direction") ?? "left";
  const direction = DIRECTIONS.has(requestedDirection)
    ? requestedDirection
    : "left";
  const speed = finiteNumber("speed", DEFAULT_SPEED_SETTING, 1, 40);
  const speedPixelsPerSecond = parameters.has("pps")
    ? finiteNumber("pps", 24, 1, 1200)
    : 24 + ((speed - 1) / 9) * 136;
  const fontSize = finiteNumber("fontSize", 80, 12, 1024);
  const gapRatio = finiteNumber("gap", 0.5, 0, 2);
  const requestedWeight = Number(parameters.get("weight"));
  const fontWeight = [300, 400, 700, 900].includes(requestedWeight)
    ? requestedWeight
    : 900;
  const theme = parameters.get("theme") === "dark" ? "dark" : "light";
  const defaultBackground = theme === "dark" ? "#000000" : "#fafafc";
  const defaultColor = theme === "dark" ? "#ffffff" : "#1a1a1e";
  const background = supportedColor("background", defaultBackground);
  const color = supportedColor("color", defaultColor);
  const text = readText();

  document.documentElement.style.setProperty("--clean-background", background);
  document.documentElement.style.setProperty("--clean-color", color);
  document.documentElement.style.setProperty(
    "--clean-font-size",
    `${fontSize}px`,
  );
  document.documentElement.style.setProperty(
    "--clean-font-weight",
    String(fontWeight),
  );
  document.documentElement.dataset.cleanMarqueeDirection = direction;
  root.classList.toggle(
    "is-vertical",
    direction === "up" || direction === "down",
  );
  textNodes.forEach((node) => {
    node.textContent = text;
  });
  semanticText.textContent = text;
  document.title = `${text.trim() || "Clean Marquee"} — Clean Marquee`;

  let layoutFrame = null;

  function applyGeometry() {
    layoutFrame = null;
    const viewportWidth = Math.max(1, root.clientWidth);
    const viewportHeight = Math.max(1, root.clientHeight);
    const primary = copies[0];
    const contentWidth = Math.max(1, primary.offsetWidth, primary.scrollWidth);
    const contentHeight = Math.max(1, primary.offsetHeight, primary.scrollHeight);
    const horizontal = direction === "left" || direction === "right";
    const viewportExtent = horizontal ? viewportWidth : viewportHeight;
    const contentExtent = horizontal ? contentWidth : contentHeight;
    const copyGap = viewportExtent * gapRatio;
    const cycleDistance = contentExtent + copyGap;
    const distance = cycleDistance * 2;
    const durationMs = Math.max(1, (distance / speedPixelsPerSecond) * 1000);
    const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const snapCrossAxis = (value) =>
      Math.round(value * devicePixelRatio) / devicePixelRatio;
    let startX;
    let startY;
    let endX;
    let endY;

    if (direction === "left") {
      startX = viewportWidth;
      startY = snapCrossAxis((viewportHeight - contentHeight) / 2);
      endX = startX - distance;
      endY = startY;
    } else if (direction === "right") {
      startX = -contentWidth;
      startY = snapCrossAxis((viewportHeight - contentHeight) / 2);
      endX = startX + distance;
      endY = startY;
    } else if (direction === "up") {
      startX = snapCrossAxis((viewportWidth - contentWidth) / 2);
      startY = viewportHeight;
      endX = startX;
      endY = startY - distance;
    } else {
      startX = snapCrossAxis((viewportWidth - contentWidth) / 2);
      startY = -contentHeight;
      endX = startX;
      endY = startY + distance;
    }

    const style = document.documentElement.style;
    style.setProperty("--clean-duration", `${durationMs}ms`);
    style.setProperty("--clean-start-x", `${startX}px`);
    style.setProperty("--clean-start-y", `${startY}px`);
    style.setProperty("--clean-end-x", `${endX}px`);
    style.setProperty("--clean-end-y", `${endY}px`);
    copies[0].style.setProperty("--clean-delay", "0ms");
    copies[1].style.setProperty("--clean-delay", `${-durationMs / 2}ms`);
    root.classList.add("is-ready");
    document.documentElement.dataset.cleanMarqueeState = "ready";

    window.__cleanMarqueeSnapshot = Object.freeze({
      contentExtent,
      copyGap,
      direction,
      distance,
      durationMs,
      fontSize,
      fontWeight,
      gapRatio,
      speed,
      speedPixelsPerSecond,
      text,
      viewportExtent,
    });
    performance.mark("clean-marquee-layout");
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
