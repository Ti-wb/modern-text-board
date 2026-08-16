import type { MarqueeEngineKind } from "../marquee/engine";

interface MarqueeLabSwitcherProps {
  engine: MarqueeEngineKind;
  onChange: (engine: MarqueeEngineKind) => void;
}

const ENGINES: Array<{ value: MarqueeEngineKind; label: string }> = [
  { value: "waapi", label: "WAAPI baseline" },
  { value: "css", label: "CSS Animation" },
  { value: "canvas", label: "Canvas 2D" },
  { value: "worker", label: "Worker WebGL" },
];

export function MarqueeLabSwitcher({
  engine,
  onChange,
}: MarqueeLabSwitcherProps) {
  return (
    <aside class="marquee-lab-switcher" data-no-canvas-gesture>
      <span>Marquee lab</span>
      <div aria-label="Marquee rendering engine" class="marquee-lab-options" role="group">
        {ENGINES.map((option) => (
          <button
            aria-pressed={engine === option.value}
            class={engine === option.value ? "is-active" : ""}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </aside>
  );
}
