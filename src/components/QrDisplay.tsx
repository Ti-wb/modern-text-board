import QRCode from "qrcode";
import { useEffect, useRef, useState } from "preact/hooks";

interface QrDisplayProps {
  payload: string;
  errorLabel: string;
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
    const render = async () => {
      const computed = window.getComputedStyle(wrapper);
      const horizontalPadding = Number.parseFloat(computed.paddingLeft) + Number.parseFloat(computed.paddingRight);
      const verticalPadding = Number.parseFloat(computed.paddingTop) + Number.parseFloat(computed.paddingBottom);
      const available = Math.min(
        wrapper.clientWidth - horizontalPadding,
        (wrapper.clientHeight || wrapper.clientWidth) - verticalPadding
      );
      const hasMeasuredSpace = available > 0;
      const targetCssSize = hasMeasuredSpace
        ? Math.max(1, Math.min(320, Math.floor(available)))
        : 168;
      let moduleCount = 37;
      try {
        moduleCount = QRCode.create(payload, { errorCorrectionLevel: "M" }).modules.size + 8;
      } catch {
        // Test doubles and older compatible builds may expose only toCanvas.
      }
      const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 3);
      const scale = Math.max(1, Math.floor((targetCssSize * devicePixelRatio) / moduleCount));
      const deviceSize = moduleCount * scale;
      const cssSize = hasMeasuredSpace
        ? Math.min(targetCssSize, Math.floor(deviceSize / devicePixelRatio))
        : targetCssSize;
      try {
        await QRCode.toCanvas(canvas, payload, {
          errorCorrectionLevel: "M",
          margin: 4,
          scale,
          color: { dark: "#000000ff", light: "#ffffffff" }
        });
        if (cancelled) return;
        canvas.style.setProperty("width", `${cssSize}px`);
        canvas.style.setProperty("height", `${cssSize}px`);
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      }
    };

    const observer = new ResizeObserver(render);
    observer.observe(wrapper);
    void render();
    return () => {
      cancelled = true;
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
