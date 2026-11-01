import {
  findShowcaseShot,
  type ShowcaseShotId,
  type ShowcaseTimeline,
} from "@t3tools/client-runtime/device/showcase/cinematic";
import {
  LAPTOP_PROFILES,
  type LaptopFinish,
} from "@t3tools/client-runtime/device/showcase/laptop-scene";
import type { ShowcaseDevice } from "@t3tools/client-runtime/device/showcase/showcase-renderer";
import { deviceModel } from "./deviceModels";

export const SHOWCASE_DEVICES = [
  { id: "macbook-pro-14", label: LAPTOP_PROFILES["macbook-pro-14"].label, kind: "laptop" },
  { id: "dell-xps-14", label: LAPTOP_PROFILES["dell-xps-14"].label, kind: "laptop" },
  { id: "iphone-18-pro", label: "iPhone 18 Pro", kind: "phone", simulatorName: "iPhone 18 Pro" },
  { id: "iphone-duo", label: "iPhone Duo", kind: "foldable", simulatorName: "iPhone Duo" },
  {
    id: "ipad-pro-13-m5",
    label: "iPad Pro 13",
    kind: "tablet",
    simulatorName: "iPad Pro 13-inch (M5)",
  },
] as const;

export type ShowcaseDeviceId = (typeof SHOWCASE_DEVICES)[number]["id"];

export function showcaseDevice(id: ShowcaseDeviceId, finish: LaptopFinish): ShowcaseDevice {
  const entry = SHOWCASE_DEVICES.find((device) => device.id === id) ?? SHOWCASE_DEVICES[0];
  if (entry.kind === "laptop") return { kind: "laptop", id: entry.id, finish };
  const model = deviceModel("ios", entry.simulatorName);
  if (entry.kind === "foldable" && model) return { kind: "foldable", model };
  return { kind: entry.kind === "foldable" ? "phone" : entry.kind, model };
}

const kindOf = (id: ShowcaseDeviceId) => SHOWCASE_DEVICES.find((device) => device.id === id)?.kind;

export const isLaptopShowcase = (id: ShowcaseDeviceId) => kindOf(id) === "laptop";

/** Laptops open their lid and foldables unfold; phones and tablets have nothing to open. */
export const opensInShowcase = (id: ShowcaseDeviceId) =>
  kindOf(id) === "laptop" || kindOf(id) === "foldable";

/** The open shot is an unfold on a foldable. */
export const showcaseShotLabel = (shot: { id: string; label: string }, id: ShowcaseDeviceId) =>
  shot.id === "lid-open" && kindOf(id) === "foldable" ? "Unfold" : shot.label;

/** Shots play in the order they were picked. The open shot needs a lid or a fold. */
export function showcaseTimeline(
  shots: ReadonlyArray<ShowcaseShotId>,
  device: ShowcaseDeviceId,
): ShowcaseTimeline {
  const usable = shots.filter((id) => id !== "lid-open" || opensInShowcase(device));
  const picked = usable.length > 0 ? usable : (["hero-reveal"] as const);
  return {
    clips: picked.flatMap((id) => {
      const shot = findShowcaseShot(id);
      return shot ? [{ shot }] : [];
    }),
  };
}

/** Toggling a shot appends it to the end of the cut, or removes it, keeping at least one. */
export function toggleShowcaseShot(
  shots: ReadonlyArray<ShowcaseShotId>,
  id: ShowcaseShotId,
): ReadonlyArray<ShowcaseShotId> {
  if (!shots.includes(id)) return [...shots, id];
  return shots.length === 1 ? shots : shots.filter((shot) => shot !== id);
}

export function showcaseFileName(device: ShowcaseDeviceId, extension: string, now = new Date()) {
  const stamp = now.toISOString().slice(0, 19).replaceAll(":", "-");
  return `showcase-${device}-${stamp}.${extension}`;
}
