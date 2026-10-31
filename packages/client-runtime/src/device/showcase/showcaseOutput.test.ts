import { describe, expect, it } from "vite-plus/test";
import { coverCrop, pickRecordingFormat, SHOWCASE_ASPECTS } from "./showcaseOutput.ts";

describe("showcase output", () => {
  it("prefers MP4 so the clip uploads to X without re-encoding", () => {
    expect(pickRecordingFormat(() => true)?.extension).toBe("mp4");
  });

  it("falls back to WebM where the browser cannot encode H.264", () => {
    expect(pickRecordingFormat((type) => type.startsWith("video/webm"))).toEqual({
      mimeType: "video/webm;codecs=vp9",
      extension: "webm",
    });
  });

  it("reports no format when the browser cannot record", () => {
    expect(pickRecordingFormat(() => false)).toBeNull();
  });

  it("uses even dimensions, which H.264 encoders require", () => {
    for (const { width, height } of Object.values(SHOWCASE_ASPECTS)) {
      expect(width % 2).toBe(0);
      expect(height % 2).toBe(0);
    }
  });
});

describe("screen cover crop", () => {
  it("crops the sides of a landscape recording shown on a portrait phone, centred", () => {
    const { repeat, offset } = coverCrop(16 / 9, 1206 / 2622);
    expect(repeat[1]).toBe(1);
    expect(repeat[0]).toBeCloseTo(1206 / 2622 / (16 / 9));
    expect(offset[0]).toBeCloseTo((1 - repeat[0]) / 2);
  });

  it("crops top and bottom of a source taller than the panel", () => {
    const { repeat, offset } = coverCrop(1, 1.6);
    expect(repeat).toEqual([1, 0.625]);
    expect(offset).toEqual([0, 0.1875]);
  });

  it("leaves a source that already matches untouched, and ignores unknown sizes", () => {
    expect(coverCrop(1.6, 1.6)).toEqual({ repeat: [1, 1], offset: [0, 0] });
    expect(coverCrop(Number.NaN, 1.6)).toEqual({ repeat: [1, 1], offset: [0, 0] });
  });
});
