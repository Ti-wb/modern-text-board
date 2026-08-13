import QRCode from "qrcode";
import { useEffect, useRef, useState } from "preact/hooks";

interface QrDisplayProps {
  payload: string;
  errorLabel: string;
}

const QUIET_ZONE_MODULES = 8;
const MIN_QR_CSS_SIZE = 168;
const MAX_QR_CSS_SIZE = 320;

function cssPixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function QrDisplay({ payload, errorLabel }: QrDisplayProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas || !payload) return;

    let cancelled = false;
    let renderFrame: number | null = null;
    let lastRenderKey = "";
    const render = async () => {
      try {
        const computed = window.getComputedStyle(wrapper);
        const horizontalPadding = cssPixels(computed.paddingLeft) + cssPixels(computed.paddingRight);
        const verticalPadding = cssPixels(computed.paddingTop) + cssPixels(computed.paddingBottom);
        const available = Math.min(
          wrapper.clientWidth - horizontalPadding,
          (wrapper.clientHeight || wrapper.clientWidth) - verticalPadding
        );
        const targetCssSize = Math.min(
          MAX_QR_CSS_SIZE,
          Math.max(MIN_QR_CSS_SIZE, Math.floor(available || MIN_QR_CSS_SIZE))
        );
        const devicePixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
        const renderKey = `${payload}:${targetCssSize}:${devicePixelRatio}`;
        if (renderKey === lastRenderKey) return;
        lastRenderKey = renderKey;

        const moduleCount = QRCode.create(payload, {
          errorCorrectionLevel: "M"
        }).modules.size + QUIET_ZONE_MODULES;
        // The bitmap always uses whole device pixels per QR module. CSS may
        // downsample that square slightly to keep a predictable 168–320px
        // board footprint without ever distorting its aspect ratio.
        const scale = Math.max(
          1,
          Math.ceil((targetCssSize * devicePixelRatio) / moduleCount)
        );

        await QRCode.toCanvas(canvas, payload, {
          errorCorrectionLevel: "M",
          margin: 4,
          scale,
          color: { dark: "#000000ff", light: "#ffffffff" }
        });
        if (cancelled) return;
        canvas.style.setProperty("width", `${targetCssSize}px`);
        canvas.style.setProperty("height", `${targetCssSize}px`);
        setError(false);
      } catch {
        if (!cancelled) {
          lastRenderKey = "";
          setError(true);
        }
      }
    };

    const scheduleRender = () => {
      if (renderFrame !== null) return;
      renderFrame = requestAnimationFrame(() => {
        renderFrame = null;
        void render();
      });
    };

    const observer = new ResizeObserver(scheduleRender);
    observer.observe(wrapper);
    scheduleRender();
    return () => {
      cancelled = true;
      if (renderFrame !== null) cancelAnimationFrame(renderFrame);
      observer.disconnect();
    };
  }, [payload]);

  return (
    <div class="qr-stage" ref={wrapperRef}>
      {error ? <p class="qr-error">{errorLabel}</p> : null}
      <canvas aria-label="QR Code" class="qr-canvas" ref={canvasRef} role="img" />
    </div>
  );
}
