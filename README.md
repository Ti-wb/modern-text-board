# Modern Text Board

A responsive, browser-based text board and handheld sign for phones, tablets, and laptops.

Modern Text Board runs entirely in the browser. It needs no account, backend, analytics, or external font service, and it can work offline after the first successful load.

## Features

- Large auto-fitting text with light and dark themes, system fonts, colors, weights, and alignment.
- Four-direction marquee at roughly 24–600+ px/s, plus mirroring, flashing, and animation pause controls.
- Local QR code generation and multi-page boards.
- Touch, keyboard, fullscreen, and optional screen wake lock support.
- Responsive layouts for iPhone, iPad, Split View, and desktop browsers.
- Installable bilingual PWA with Traditional Chinese and English interfaces.

> Board content is not persisted. Reloading or closing the page clears it.

## Usage

Double-click or double-tap the board to edit its text. Use the floating toolbar to change presentation settings, enable the marquee, manage pages, show a QR code, or enter presentation mode.

Useful keyboard shortcuts:

- `E` or `Enter`: edit text
- `B`: toggle bold
- `M`: toggle marquee
- `F`: toggle presentation mode
- `Page Up` / `Page Down`: change page
- `Escape`: close the current panel or mode
- `?`: show shortcut help

## Development

Requires Node.js 22 and npm.

```bash
npm ci
npm run dev
```

Run the standard checks before submitting changes:

```bash
npm run check
```

Create and preview a production build with:

```bash
npm run build
npm run preview
```

## Deployment

This is a static Vite application. For Cloudflare Pages, use:

- Build command: `npm run build`
- Output directory: `dist`
- Node.js: `22`

No environment variables, Pages Functions, or server runtime are required.

## Contributing

Focused pull requests and [bug reports](https://github.com/Ti-wb/modern-text-board/issues) are welcome. Preserve accessibility and offline behavior, include relevant tests, and run `npm run check` before submitting changes.

## License

Licensed under [GNU GPLv3](./LICENSE) (`GPL-3.0-only`).
