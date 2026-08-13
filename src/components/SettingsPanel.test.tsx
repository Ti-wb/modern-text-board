import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { SettingsPanel } from "./SettingsPanel";

describe("SettingsPanel", () => {
  it("confirms before an update reload can clear the current session", () => {
    const onApplyPwaUpdate = vi.fn();
    render(
      <SettingsPanel
        keepScreenAwake={false}
        locale="en"
        onApplyPwaUpdate={onApplyPwaUpdate}
        onClose={vi.fn()}
        onKeepScreenAwakeChange={vi.fn()}
        onLocaleChange={vi.fn()}
        onPauseAnimationsChange={vi.fn()}
        onReset={vi.fn()}
        onShowShortcuts={vi.fn()}
        pauseAnimations={false}
        pwaStatus={{
          install: "unavailable",
          offline: "ready",
          online: true,
          update: "available",
        }}
        wakeLockStatus={{
          active: false,
          phase: "idle",
          reason: "disabled",
          supported: true,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Update and reload" }));
    expect(onApplyPwaUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Update and reload?" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    expect(onApplyPwaUpdate).toHaveBeenCalledOnce();
  });
});
