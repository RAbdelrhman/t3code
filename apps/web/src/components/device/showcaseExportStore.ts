import type { DeviceShowcaseScript, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

export interface ShowcaseExportJob {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly requestId: number;
  readonly script: DeviceShowcaseScript;
}

interface ShowcaseExportStoreState {
  readonly jobs: ReadonlyArray<ShowcaseExportJob>;
  readonly add: (job: Omit<ShowcaseExportJob, "key">) => void;
  readonly finish: (key: string) => void;
}

/** Agent-requested Showcase exports waiting to render in this window, oldest first. */
export const useShowcaseExportStore = create<ShowcaseExportStoreState>()((set) => ({
  jobs: [],
  add: (job) =>
    set((state) => {
      const key = `${job.environmentId}:${job.requestId}`;
      return state.jobs.some((entry) => entry.key === key)
        ? state
        : { jobs: [...state.jobs, { ...job, key }] };
    }),
  finish: (key) => set((state) => ({ jobs: state.jobs.filter((job) => job.key !== key) })),
}));
