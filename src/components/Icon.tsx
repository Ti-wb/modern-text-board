import type { JSX } from "preact";

export type IconName =
  | "grip"
  | "theme"
  | "color"
  | "align"
  | "marquee"
  | "mirror"
  | "more"
  | "check"
  | "flash"
  | "qr"
  | "pages"
  | "fullscreen"
  | "settings"
  | "turtle"
  | "rabbit"
  | "arrow-left"
  | "arrow-right"
  | "arrow-up"
  | "arrow-down"
  | "copy";

interface IconProps extends Omit<JSX.HTMLAttributes<HTMLImageElement>, "src"> {
  name: IconName;
  size?: number;
  alt?: string;
}

export function Icon({ name, size = 18, alt = "", ...props }: IconProps) {
  return (
    <img
      {...props}
      alt={alt}
      aria-hidden={alt === "" ? "true" : undefined}
      class={`icon ${props.class ?? ""}`}
      height={size}
      src={`/icons/ui/${name}.svg`}
      width={size}
    />
  );
}
