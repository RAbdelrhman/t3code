/**
 * Camera shots for device showcase videos. Everything here is pure: a shot is data, and sampling it
 * at a time returns a pose. Distances and offsets are in multiples of the device's framing radius,
 * so one shot reads the same on a phone and a laptop.
 */

export type ShowcaseEasing = "linear" | "in" | "out" | "inOut" | "cinematic";

export interface ShowcasePose {
  /** Degrees around the device; 0 looks straight at the screen, positive orbits to the right. */
  readonly azimuth: number;
  /** Degrees above the device's horizon. */
  readonly elevation: number;
  /** Camera distance in framing radii. */
  readonly distance: number;
  /** Look-at offset from the device centre, in framing radii. */
  readonly target: readonly [number, number, number];
  /** Vertical field of view in degrees. */
  readonly fov: number;
  /** Camera roll in degrees. */
  readonly roll: number;
  /** Device yaw in degrees, for turntable spins that keep the camera still. */
  readonly spin: number;
  /** Laptop lid angle in degrees; ignored by phones and tablets. */
  readonly lid: number;
}

export interface ShowcaseKeyframe extends Partial<ShowcasePose> {
  /** Position in the shot, 0 to 1. */
  readonly at: number;
  /** Easing for the segment that ends at this keyframe. */
  readonly ease?: ShowcaseEasing;
}

export interface ShowcaseShot {
  readonly id: string;
  readonly label: string;
  readonly durationMs: number;
  readonly keyframes: ReadonlyArray<ShowcaseKeyframe>;
}

export const DEFAULT_POSE: ShowcasePose = {
  azimuth: 0,
  elevation: 8,
  distance: 2.6,
  target: [0, 0, 0],
  fov: 30,
  roll: 0,
  spin: 0,
  lid: 108,
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function ease(kind: ShowcaseEasing, t: number) {
  const x = clamp01(t);
  switch (kind) {
    case "linear":
      return x;
    case "in":
      return x * x * x;
    case "out":
      return 1 - (1 - x) ** 3;
    case "inOut":
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
    case "cinematic":
      // Quintic in-out: a long, soft start and settle, like a dolly on rails.
      return x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2;
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Fills each keyframe's missing fields from the one before it, starting from `base`. */
export function resolveKeyframes(
  keyframes: ReadonlyArray<ShowcaseKeyframe>,
  base: ShowcasePose = DEFAULT_POSE,
): ReadonlyArray<{ at: number; ease: ShowcaseEasing; pose: ShowcasePose }> {
  const sorted = [...keyframes].sort((a, b) => a.at - b.at);
  let previous = base;
  return sorted.map(({ at, ease: easing, ...fields }) => {
    const pose: ShowcasePose = { ...previous };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) Object.assign(pose, { [key]: value });
    }
    previous = pose;
    return { at: clamp01(at), ease: easing ?? "cinematic", pose };
  });
}

export function samplePose(
  frames: ReturnType<typeof resolveKeyframes>,
  progress: number,
): ShowcasePose {
  const first = frames[0];
  if (!first) return DEFAULT_POSE;
  const t = clamp01(progress);
  if (t <= first.at) return first.pose;
  for (let index = 1; index < frames.length; index++) {
    const to = frames[index]!;
    if (t > to.at) continue;
    const from = frames[index - 1]!;
    const span = to.at - from.at;
    const k = span <= 0 ? 1 : ease(to.ease, (t - from.at) / span);
    const a = from.pose;
    const b = to.pose;
    return {
      azimuth: lerp(a.azimuth, b.azimuth, k),
      elevation: lerp(a.elevation, b.elevation, k),
      distance: lerp(a.distance, b.distance, k),
      target: [
        lerp(a.target[0], b.target[0], k),
        lerp(a.target[1], b.target[1], k),
        lerp(a.target[2], b.target[2], k),
      ],
      fov: lerp(a.fov, b.fov, k),
      roll: lerp(a.roll, b.roll, k),
      spin: lerp(a.spin, b.spin, k),
      lid: lerp(a.lid, b.lid, k),
    };
  }
  return frames[frames.length - 1]!.pose;
}

export const SHOWCASE_SHOTS = [
  {
    id: "hero-reveal",
    label: "Hero reveal",
    durationMs: 5000,
    keyframes: [
      { at: 0, azimuth: -62, elevation: 2, distance: 3.6, fov: 24, roll: -3 },
      { at: 1, azimuth: -18, elevation: 14, distance: 2.3, fov: 30, roll: 0 },
    ],
  },
  {
    id: "lid-open",
    label: "Lid open",
    durationMs: 5500,
    keyframes: [
      { at: 0, azimuth: 28, elevation: 48, distance: 2.7, lid: 0, target: [0, -0.25, 0.1] },
      { at: 0.2, ease: "out", lid: 6 },
      { at: 0.75, ease: "inOut", lid: 108, azimuth: 8, elevation: 16, distance: 2.6 },
      { at: 1, ease: "out", azimuth: 0, elevation: 12, distance: 2.55, target: [0, 0.08, 0] },
    ],
  },
  {
    id: "push-in",
    label: "Push in",
    durationMs: 4000,
    keyframes: [
      { at: 0, azimuth: 0, elevation: 10, distance: 2.9, fov: 30 },
      { at: 1, distance: 1.5, fov: 26, target: [0, 0.12, 0] },
    ],
  },
  {
    id: "orbit",
    label: "Orbit",
    durationMs: 6000,
    keyframes: [
      { at: 0, azimuth: -45, elevation: 12, distance: 2.5 },
      { at: 1, ease: "linear", azimuth: 45 },
    ],
  },
  {
    id: "turntable",
    label: "Turntable",
    durationMs: 6000,
    keyframes: [
      { at: 0, azimuth: 0, elevation: 14, distance: 2.6, spin: -180 },
      { at: 1, ease: "inOut", spin: 180 },
    ],
  },
  {
    id: "low-sweep",
    label: "Low sweep",
    durationMs: 5000,
    keyframes: [
      { at: 0, azimuth: 55, elevation: -2, distance: 2.1, fov: 34, roll: 4, target: [0.2, 0, 0] },
      { at: 1, azimuth: -25, elevation: 6, distance: 2.4, fov: 30, roll: 0, target: [0, 0, 0] },
    ],
  },
  {
    id: "float",
    label: "Float",
    durationMs: 6000,
    keyframes: [
      { at: 0, azimuth: -12, elevation: 10, distance: 2.4, spin: -6 },
      { at: 0.5, ease: "inOut", azimuth: 12, elevation: 16, spin: 6 },
      { at: 1, ease: "inOut", azimuth: -12, elevation: 10, spin: -6 },
    ],
  },
] as const satisfies ReadonlyArray<ShowcaseShot>;

export type ShowcaseShotId = (typeof SHOWCASE_SHOTS)[number]["id"];

export function findShowcaseShot(id: string): ShowcaseShot | undefined {
  return SHOWCASE_SHOTS.find((shot) => shot.id === id);
}

/** A sequence of shots cut back to back. Each clip may override its shot's duration. */
export interface ShowcaseTimeline {
  readonly clips: ReadonlyArray<{ readonly shot: ShowcaseShot; readonly durationMs?: number }>;
}

export function timelineDuration(timeline: ShowcaseTimeline) {
  return timeline.clips.reduce(
    (total, clip) => total + (clip.durationMs ?? clip.shot.durationMs),
    0,
  );
}

/** Resolves every clip once so playback can sample each frame without allocating keyframes. */
export function compileTimeline(timeline: ShowcaseTimeline) {
  let start = 0;
  const clips = timeline.clips.map((clip) => {
    const duration = Math.max(1, clip.durationMs ?? clip.shot.durationMs);
    const compiled = { start, duration, frames: resolveKeyframes(clip.shot.keyframes) };
    start += duration;
    return compiled;
  });
  const duration = start;
  return {
    duration,
    /** Pose at `timeMs`, clamped to the timeline; also returns which clip is on screen. */
    sample(timeMs: number): { pose: ShowcasePose; clip: number } {
      if (clips.length === 0) return { pose: DEFAULT_POSE, clip: -1 };
      const time = Math.min(duration, Math.max(0, timeMs));
      let index = clips.findIndex((clip) => time < clip.start + clip.duration);
      if (index === -1) index = clips.length - 1;
      const clip = clips[index]!;
      return { pose: samplePose(clip.frames, (time - clip.start) / clip.duration), clip: index };
    },
  };
}

/**
 * Camera position for a pose around a device centred at the origin. Returns world-space vectors
 * so the renderer can stay a thin adapter over three.js.
 */
export function poseCamera(pose: ShowcasePose, radius: number) {
  const azimuth = (pose.azimuth * Math.PI) / 180;
  const elevation = (pose.elevation * Math.PI) / 180;
  const target: [number, number, number] = [
    pose.target[0] * radius,
    pose.target[1] * radius,
    pose.target[2] * radius,
  ];
  const distance = pose.distance * radius;
  const position: [number, number, number] = [
    target[0] + distance * Math.cos(elevation) * Math.sin(azimuth),
    target[1] + distance * Math.sin(elevation),
    target[2] + distance * Math.cos(elevation) * Math.cos(azimuth),
  ];
  return { position, target };
}
