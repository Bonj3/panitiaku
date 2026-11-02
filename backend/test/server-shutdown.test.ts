import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { server } from "../src/server.ts";

// Saat boot, gagalkan disconnectDb sehingga jalur catch di shutdown terlalu
// diuji (raw console.error harus diganti safe logger).
vi.mock("../src/config/database.ts", () => ({
  disconnectDb: vi.fn().mockRejectedValue(
    new Error("koneksi DB gagal: rahasia@contoh.com stack trace di sini")
  ),
}));

describe("server shutdown — Prisma gagal terputus (safe logger)", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    // lepaskan handle server agar tidak memblokir keluar proses vitest
    try {
      server.close(() => {});
    } catch {
      // ignore
    }
  });

  it("mencatat via safe logger (tanpa message/stack/PII) dan exit(1), bukan console.error mentah", async () => {
    // server.ts telah terimpor saat module dimuat; handler SIGTERM terdaftar.
    process.emit("SIGTERM");

    // beri waktu callback server.close untuk berjalan (disconnectDb gagal -> catch)
    await new Promise((r) => setTimeout(r, 150));

    expect(exitSpy).toHaveBeenCalledWith(1);

    const logged = errorSpy.mock.calls
      .map((c) => c[0])
      .filter((c): c is string => typeof c === "string")
      .join(" ");

    // Pesan error mentah, PII, dan stack TIDAK boleh dicetak.
    expect(logged).not.toContain("koneksi DB gagal");
    expect(logged).not.toContain("rahasia@contoh.com");
    expect(logged).not.toContain("stack trace di sini");

    // Entri log harus JSON aman dengan field terstruktur.
    const parsed = JSON.parse(
      logged.split("\n").find((line) => line.includes('"level"')) || "{}"
    );
    expect(parsed.level).toBe("error");
    expect(parsed.code).toBe("INTERNAL");
    expect(parsed.name).toBe("Error");
  });
});
