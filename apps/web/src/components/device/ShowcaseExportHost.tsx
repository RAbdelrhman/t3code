import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { useEffect, useRef } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { useStableCallback } from "~/hooks/useStableCallback";
import { attachmentEnvironment } from "~/state/attachments";
import { deviceEnvironment } from "~/state/device";
import { readPreparedConnection } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { SHOWCASE_ASPECTS } from "@t3tools/client-runtime/device/showcase/showcase-output";
import { useShowcaseExportStore, type ShowcaseExportJob } from "./showcaseExportStore";
import {
  loadScreenFromUrl,
  loadShowcaseRenderer,
  placeholderScreen,
  releaseScreen,
} from "./showcaseScreen";
import { showcaseDevice, showcaseFileName, showcaseTimeline } from "./showcaseStudio";

/**
 * Renders agent-requested Showcase exports offscreen, one at a time, whatever the user is
 * looking at. Mounted once for the whole app.
 */
export function ShowcaseExportHost() {
  const job = useShowcaseExportStore((state) => state.jobs[0]);
  return job ? <ShowcaseExportRun key={job.key} job={job} /> : null;
}

function ShowcaseExportRun(props: { readonly job: ShowcaseExportJob }) {
  const { job } = props;
  const screenAsset = useAssetUrlState(
    job.script.screen ? job.environmentId : null,
    job.script.screen
      ? { _tag: "media-file", threadId: job.threadId, path: job.script.screen }
      : null,
  );
  const screenFailed = screenAsset._tag === "Failure";
  const screenUrl = screenAsset._tag === "Success" ? screenAsset.url : null;
  const reportExport = useAtomCommand(deviceEnvironment.reportShowcaseExport, {
    reportFailure: false,
  });
  const createUploadUrl = useAtomCommand(attachmentEnvironment.createUploadUrl, {
    reportFailure: false,
  });
  const startedRef = useRef(false);

  const run = useStableCallback(async () => {
    const report = (input: {
      readonly status: "started" | "done" | "failed";
      readonly attachmentId?: string;
      readonly detail?: string;
    }) =>
      reportExport({
        environmentId: job.environmentId,
        input: { requestId: job.requestId, ...input },
      });
    const { script } = job;
    const device = script.device ?? "macbook-pro-14";
    const aspect = SHOWCASE_ASPECTS[script.aspect ?? "landscape"];
    let source: Awaited<ReturnType<typeof loadScreenFromUrl>> | null = null;
    let renderer: { dispose: () => void } | null = null;
    await report({ status: "started" });
    return (async () => {
      if (script.screen && !screenUrl) throw new Error(`Could not open ${script.screen}.`);
      source =
        script.screen && screenUrl ? await loadScreenFromUrl(screenUrl, script.screen) : null;
      const { createShowcaseRenderer } = await loadShowcaseRenderer();
      const created = createShowcaseRenderer({
        canvas: document.createElement("canvas"),
        source: source ?? placeholderScreen(),
      });
      renderer = created;
      created.setDevice(showcaseDevice(device, script.finish ?? "dark"));
      created.setBackdrop(script.backdrop ?? "graphite");
      created.setTimeline(showcaseTimeline(script.shots ?? ["lid-open", "push-in"], device), false);
      const clip = await created.record({ width: aspect.width, height: aspect.height });
      const name = showcaseFileName(device, clip.extension);
      const mimeType = clip.blob.type || "video/mp4";
      const upload = await createUploadUrl({
        environmentId: job.environmentId,
        input: { type: "file", name, mimeType, sizeBytes: clip.blob.size },
      });
      if (upload._tag === "Failure") throw new Error("Could not start uploading the clip.");
      const connection = readPreparedConnection(job.environmentId);
      const url = connection
        ? resolveAssetUrl(connection.httpBaseUrl, upload.value.relativeUrl)
        : null;
      if (!url) throw new Error("This window lost its connection to the server.");
      const response = await fetch(url, {
        method: "POST",
        body: clip.blob,
        headers: { "Content-Type": mimeType },
      });
      if (!response.ok) throw new Error(`Uploading the clip failed (${response.status}).`);
      await report({ status: "done", attachmentId: upload.value.attachmentId });
    })()
      .catch((cause: unknown) =>
        report({
          status: "failed",
          detail: cause instanceof Error ? cause.message : String(cause),
        }),
      )
      .finally(() => {
        renderer?.dispose();
        releaseScreen(source);
        useShowcaseExportStore.getState().finish(job.key);
      });
  });

  const ready = !job.script.screen || screenUrl !== null || screenFailed;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the offscreen WebGL export once its screen file is reachable
  useEffect(() => {
    if (!ready || startedRef.current) return;
    startedRef.current = true;
    void run();
  }, [ready, run]);
  return null;
}
