import type { ShowcaseShotId } from "@t3tools/client-runtime/device/showcase/cinematic";
import type { LaptopFinish } from "@t3tools/client-runtime/device/showcase/laptop-scene";
import type {
  ShowcaseAspectId,
  ShowcaseBackdropId,
} from "@t3tools/client-runtime/device/showcase/showcase-output";
import { create } from "zustand";
import type { ShowcaseDeviceId } from "./showcaseStudio";

/** Starting choices for a showcase; anything omitted keeps the studio's current value. */
export interface ShowcaseScript {
  readonly device?: ShowcaseDeviceId;
  readonly finish?: LaptopFinish;
  readonly shots?: ReadonlyArray<ShowcaseShotId>;
  readonly backdrop?: ShowcaseBackdropId;
  readonly aspect?: ShowcaseAspectId;
}

interface ShowcaseRequest {
  readonly script: ShowcaseScript;
  /** Changes on every open, so reopening with the same script still reapplies it. */
  readonly nonce: number;
}

interface ShowcaseStoreState {
  readonly byThreadKey: Readonly<Record<string, ShowcaseRequest>>;
  readonly open: (threadKey: string, script?: ShowcaseScript) => void;
  readonly close: (threadKey: string) => void;
}

let nonce = 0;

/** Which threads show the Showcase studio in their Device panel. */
export const useShowcaseStore = create<ShowcaseStoreState>()((set) => ({
  byThreadKey: {},
  open: (threadKey, script = {}) =>
    set((state) => ({
      byThreadKey: { ...state.byThreadKey, [threadKey]: { script, nonce: ++nonce } },
    })),
  close: (threadKey) =>
    set((state) => {
      if (!(threadKey in state.byThreadKey)) return state;
      const { [threadKey]: _closed, ...rest } = state.byThreadKey;
      return { byThreadKey: rest };
    }),
}));
