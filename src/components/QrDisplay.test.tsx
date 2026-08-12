import { render, screen, waitFor } from "@testing-library/preact";
import QRCode from "qrcode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QrDisplay } from "./QrDisplay";

vi.mock("qrcode", () => ({
  default: {
    toCanvas: vi.fn()
  }
}));

describe("QrDisplay", () => {
  beforeEach(() => {
    vi.mocked(QRCode.toCanvas).mockReset();
    vi.mocked(QRCode.toCanvas).mockResolvedValue(undefined);
  });

  it("generates an M-level black-on-white QR code entirely on the canvas", async () => {
    render(<QrDisplay errorLabel="Unable to create QR" payload="哈囉 👋" />);

    const canvas = screen.getByRole("img", { name: "QR Code" });
    await waitFor(() => expect(QRCode.toCanvas).toHaveBeenCalledOnce());

    expect(QRCode.toCanvas).toHaveBeenCalledWith(
      canvas,
      "哈囉 👋",
      expect.objectContaining({
        errorCorrectionLevel: "M",
        margin: 4,
        color: { dark: "#000000ff", light: "#ffffffff" }
      })
    );
    expect((canvas as HTMLCanvasElement).style.width).toBe("168px");
    expect(screen.queryByText("Unable to create QR")).toBeNull();
  });

  it("shows the supplied error label if QR generation fails", async () => {
    vi.mocked(QRCode.toCanvas).mockRejectedValueOnce(new Error("encode failed"));
    render(<QrDisplay errorLabel="Unable to create QR" payload="payload" />);

    expect(await screen.findByText("Unable to create QR")).not.toBeNull();
  });
});
