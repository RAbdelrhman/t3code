/** Output presets for showcase clips. Pure data, shared by the renderer, the panel, and the agent tool. */

export const SHOWCASE_ASPECTS = {
  landscape: { label: "16:9", width: 1920, height: 1080 },
  square: { label: "1:1", width: 1440, height: 1440 },
  portrait: { label: "4:5", width: 1080, height: 1350 },
  story: { label: "9:16", width: 1080, height: 1920 },
} as const;

export type ShowcaseAspectId = keyof typeof SHOWCASE_ASPECTS;

export const SHOWCASE_BACKDROPS = {
  graphite: {
    label: "Graphite",
    stops: [
      [0, "#3a3d44"],
      [0.55, "#16171b"],
      [1, "#050506"],
    ],
  },
  paper: {
    label: "Paper",
    stops: [
      [0, "#ffffff"],
      [0.6, "#e7e8ec"],
      [1, "#c9ccd3"],
    ],
  },
  dusk: {
    label: "Dusk",
    stops: [
      [0, "#5b4bd6"],
      [0.5, "#1d1640"],
      [1, "#07060f"],
    ],
  },
  ember: {
    label: "Ember",
    stops: [
      [0, "#ff8a4c"],
      [0.45, "#5a1c1f"],
      [1, "#0c0607"],
    ],
  },
} as const satisfies Record<
  string,
  { readonly label: string; readonly stops: ReadonlyArray<readonly [number, string]> }
>;

export type ShowcaseBackdropId = keyof typeof SHOWCASE_BACKDROPS;

const RECORDING_FORMATS = [
  { mimeType: "video/mp4;codecs=avc1.640033", extension: "mp4" },
  { mimeType: "video/mp4;codecs=avc1", extension: "mp4" },
  { mimeType: "video/mp4", extension: "mp4" },
  { mimeType: "video/webm;codecs=vp9", extension: "webm" },
  { mimeType: "video/webm", extension: "webm" },
] as const;

/** The first container the browser can encode, preferring MP4 because social sites accept it. */
export function pickRecordingFormat(isSupported: (mimeType: string) => boolean) {
  return RECORDING_FORMATS.find((format) => isSupported(format.mimeType)) ?? null;
}

/** Crops the texture to cover a panel of `screenAspect` without stretching or rotating it. */
export function coverCrop(sourceAspect: number, screenAspect: number) {
  if (!(sourceAspect > 0) || !(screenAspect > 0))
    return { repeat: [1, 1], offset: [0, 0] } as const;
  if (sourceAspect > screenAspect) {
    const x = screenAspect / sourceAspect;
    return { repeat: [x, 1], offset: [(1 - x) / 2, 0] } as const;
  }
  const y = sourceAspect / screenAspect;
  return { repeat: [1, y], offset: [0, (1 - y) / 2] } as const;
}
