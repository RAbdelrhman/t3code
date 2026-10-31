import type { DeviceShowcaseScript } from "@t3tools/contracts";
import { create } from "zustand";

/** Starting choices for a showcase; anything omitted keeps the studio's current value. */
export type ShowcaseScript = DeviceShowcaseScript;

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
