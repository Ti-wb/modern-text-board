import { render, screen, waitFor } from "@testing-library/preact";
import QRCode from "qrcode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QrDisplay } from "./QrDisplay";

vi.mock("qrcode", () => ({
  default: {
    create: vi.fn(),
    toCanvas: vi.fn()
  }
}));

describe("QrDisplay", () => {
  beforeEach(() => {
    vi.mocked(QRCode.create).mockReset();
    vi.mocked(QRCode.create).mockReturnValue({
      modules: { size: 29 }
    } as ReturnType<typeof QRCode.create>);
    vi.mocked(QRCode.toCanvas).mockReset();
    vi.mocked(QRCode.toCanvas).mockResolvedValue(undefined);
  });

  it("generates an M-level black-on-white QR code entirely on the canvas", async () => {
    render(<QrDisplay errorLabel="Unable to create QR" payload="哈囉 👋" />);

    const canvas = screen.getByRole("img", { name: "QR Code" });
    await waitFor(() => expect(QRCode.toCanvas).toHaveBeenCalledOnce());

    expect(QRCode.create).toHaveBeenCalledWith("哈囉 👋", {
      errorCorrectionLevel: "M"
    });

    expect(QRCode.toCanvas).toHaveBeenCalledWith(
      canvas,
      "哈囉 👋",
      expect.objectContaining({
        errorCorrectionLevel: "M",
        margin: 4,
        color: { dark: "#000000ff", light: "#ffffffff" }
      })
    );
    const options = vi.mocked(QRCode.toCanvas).mock.calls[0]?.[2];
    const scale = options && "scale" in options ? options.scale : undefined;
    expect(Number.isInteger(scale)).toBe(true);
    expect(scale).toBe(5);
    expect((canvas as HTMLCanvasElement).style.width).toBe("168px");
    expect((canvas as HTMLCanvasElement).style.height).toBe("168px");
    expect(screen.queryByText("Unable to create QR")).toBeNull();
  });

  it("keeps a measured constrained canvas at the 168px display minimum", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(132);
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(132);

    try {
      render(<QrDisplay errorLabel="Unable to create QR" payload="constrained" />);
      const canvas = screen.getByRole("img", { name: "QR Code" }) as HTMLCanvasElement;
      await waitFor(() => expect(QRCode.toCanvas).toHaveBeenCalledOnce());

      const options = vi.mocked(QRCode.toCanvas).mock.calls[0]?.[2];
      const scale = options && "scale" in options ? options.scale : undefined;
      expect(Number.isInteger(scale)).toBe(true);
      expect(canvas.style.width).toBe("168px");
      expect(canvas.style.height).toBe("168px");
    } finally {
      width.mockRestore();
      height.mockRestore();
    }
  });

  it("shows the supplied error label if QR generation fails", async () => {
    vi.mocked(QRCode.toCanvas).mockRejectedValueOnce(new Error("encode failed"));
    render(<QrDisplay errorLabel="Unable to create QR" payload="payload" />);

    expect(await screen.findByText("Unable to create QR")).not.toBeNull();
  });
});
