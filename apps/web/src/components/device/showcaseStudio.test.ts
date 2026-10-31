import { SHOWCASE_SHOTS } from "@t3tools/client-runtime/device/showcase/cinematic";
import {
  SHOWCASE_ASPECTS,
  SHOWCASE_BACKDROPS,
} from "@t3tools/client-runtime/device/showcase/showcase-output";
import { DeviceShowcaseDevice, DeviceShowcaseScript, DeviceShowcaseShot } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  SHOWCASE_DEVICES,
  showcaseDevice,
  showcaseFileName,
  showcaseTimeline,
  toggleShowcaseShot,
} from "./showcaseStudio";

describe("showcase studio", () => {
  it("cuts shots in the order they were picked", () => {
    const timeline = showcaseTimeline(["push-in", "hero-reveal"], "macbook-pro-14");
    expect(timeline.clips.map((clip) => clip.shot.id)).toEqual(["push-in", "hero-reveal"]);
  });

  it("drops the lid shot for devices without a lid", () => {
    expect(
      showcaseTimeline(["lid-open", "orbit"], "iphone-18-pro").clips.map((clip) => clip.shot.id),
    ).toEqual(["orbit"]);
    expect(
      showcaseTimeline(["lid-open"], "ipad-pro-13-m5").clips.map((clip) => clip.shot.id),
    ).toEqual(["hero-reveal"]);
  });

  it("appends a new shot, removes a picked one, and never empties the cut", () => {
    expect(toggleShowcaseShot(["orbit"], "push-in")).toEqual(["orbit", "push-in"]);
    expect(toggleShowcaseShot(["orbit", "push-in"], "orbit")).toEqual(["push-in"]);
    expect(toggleShowcaseShot(["orbit"], "orbit")).toEqual(["orbit"]);
  });

  it("maps laptops to the procedural model and phones to their simulator GLB", () => {
    expect(showcaseDevice("dell-xps-14", "light")).toEqual({
      kind: "laptop",
      id: "dell-xps-14",
      finish: "light",
    });
    const phone = showcaseDevice("iphone-18-pro", "dark");
    expect(phone.kind).toBe("phone");
    expect(phone.kind !== "laptop" && phone.model?.id).toBe("iphone-18-pro");
  });

  it("names exports so they sort by time and are safe on every filesystem", () => {
    expect(showcaseFileName("macbook-pro-14", "mp4", new Date("2026-10-30T12:34:56Z"))).toBe(
      "showcase-macbook-pro-14-2026-10-30T12-34-56.mp4",
    );
  });
});

describe("showcase contract", () => {
  // Agents name devices and shots through the contract; the studio renders the runtime presets.
  it("names exactly the devices, shots, backdrops and aspects the studio renders", () => {
    expect([...DeviceShowcaseDevice.literals].toSorted()).toEqual(
      SHOWCASE_DEVICES.map((device) => device.id).toSorted(),
    );
    expect([...DeviceShowcaseShot.literals].toSorted()).toEqual(
      SHOWCASE_SHOTS.map((shot) => shot.id).toSorted(),
    );
    const decode = Schema.decodeUnknownSync(DeviceShowcaseScript);
    for (const backdrop of Object.keys(SHOWCASE_BACKDROPS))
      expect(() => decode({ backdrop })).not.toThrow();
    for (const aspect of Object.keys(SHOWCASE_ASPECTS))
      expect(() => decode({ aspect })).not.toThrow();
  });
});
