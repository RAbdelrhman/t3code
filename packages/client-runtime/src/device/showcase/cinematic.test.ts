import { describe, expect, it } from "vite-plus/test";
import {
  compileTimeline,
  DEFAULT_POSE,
  ease,
  findShowcaseShot,
  poseCamera,
  resolveKeyframes,
  samplePose,
  SHOWCASE_SHOTS,
} from "./cinematic.ts";

describe("showcase easing", () => {
  it.each(["linear", "in", "out", "inOut", "cinematic"] as const)(
    "%s starts at 0, ends at 1, and never leaves that range",
    (kind) => {
      expect(ease(kind, 0)).toBe(0);
      expect(ease(kind, 1)).toBe(1);
      for (let t = -0.5; t <= 1.5; t += 0.05) {
        expect(ease(kind, t)).toBeGreaterThanOrEqual(0);
        expect(ease(kind, t)).toBeLessThanOrEqual(1);
      }
    },
  );
});

describe("showcase keyframes", () => {
  it("carries fields a keyframe omits from the keyframe before it", () => {
    const frames = resolveKeyframes([
      { at: 0, azimuth: -30, lid: 0 },
      { at: 1, azimuth: 30 },
    ]);
    expect(frames[1]?.pose.lid).toBe(0);
    expect(frames[1]?.pose.elevation).toBe(DEFAULT_POSE.elevation);
  });

  it("holds the first and last poses outside the keyframe range", () => {
    const frames = resolveKeyframes([
      { at: 0.25, azimuth: -30 },
      { at: 0.75, azimuth: 30 },
    ]);
    expect(samplePose(frames, 0).azimuth).toBe(-30);
    expect(samplePose(frames, 1).azimuth).toBe(30);
    expect(samplePose(frames, 0.5).azimuth).toBeCloseTo(0);
  });

  it("sorts keyframes authored out of order", () => {
    const frames = resolveKeyframes([
      { at: 1, distance: 1 },
      { at: 0, distance: 3 },
    ]);
    expect(samplePose(frames, 0).distance).toBe(3);
    expect(samplePose(frames, 1).distance).toBe(1);
  });
});

describe("showcase presets", () => {
  it.each(SHOWCASE_SHOTS.map((shot) => [shot.id, shot] as const))(
    "%s keeps the camera outside the device and its values finite",
    (_id, shot) => {
      const frames = resolveKeyframes(shot.keyframes);
      for (let t = 0; t <= 1; t += 0.02) {
        const pose = samplePose(frames, t);
        for (const value of [pose.azimuth, pose.elevation, pose.distance, pose.fov, pose.lid])
          expect(Number.isFinite(value)).toBe(true);
        expect(pose.distance).toBeGreaterThan(1);
        expect(pose.lid).toBeGreaterThanOrEqual(0);
        expect(pose.lid).toBeLessThanOrEqual(135);
      }
    },
  );

  it("opens the laptop lid over the lid-open shot", () => {
    const shot = findShowcaseShot("lid-open")!;
    const frames = resolveKeyframes(shot.keyframes);
    expect(samplePose(frames, 0).lid).toBe(0);
    expect(samplePose(frames, 1).lid).toBe(108);
    let previous = -1;
    for (let t = 0; t <= 1; t += 0.05) {
      const lid = samplePose(frames, t).lid;
      expect(lid).toBeGreaterThanOrEqual(previous);
      previous = lid;
    }
  });
});

describe("showcase timeline", () => {
  it("cuts between clips at their boundaries and honours duration overrides", () => {
    const reveal = findShowcaseShot("hero-reveal")!;
    const orbit = findShowcaseShot("orbit")!;
    const timeline = compileTimeline({
      clips: [{ shot: reveal, durationMs: 1000 }, { shot: orbit }],
    });
    expect(timeline.duration).toBe(1000 + orbit.durationMs);
    expect(timeline.sample(999).clip).toBe(0);
    expect(timeline.sample(1000).clip).toBe(1);
    expect(timeline.sample(1000).pose.azimuth).toBe(-45);
    expect(timeline.sample(Number.POSITIVE_INFINITY).pose.azimuth).toBe(45);
  });

  it("returns the default pose for an empty timeline", () => {
    expect(compileTimeline({ clips: [] }).sample(500)).toEqual({ pose: DEFAULT_POSE, clip: -1 });
  });
});

describe("pose camera", () => {
  it("places azimuth 0 straight in front of the screen at the requested distance", () => {
    const { position, target } = poseCamera({ ...DEFAULT_POSE, elevation: 0, distance: 2 }, 1.5);
    expect(target).toEqual([0, 0, 0]);
    expect(position[0]).toBeCloseTo(0);
    expect(position[1]).toBeCloseTo(0);
    expect(position[2]).toBeCloseTo(3);
  });

  it("orbits to the right for positive azimuth", () => {
    const { position } = poseCamera({ ...DEFAULT_POSE, azimuth: 90, elevation: 0 }, 1);
    expect(position[0]).toBeCloseTo(DEFAULT_POSE.distance);
    expect(position[2]).toBeCloseTo(0);
  });
});
