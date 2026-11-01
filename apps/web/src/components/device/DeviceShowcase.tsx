import {
  SHOWCASE_SHOTS,
  timelineDuration,
  type ShowcaseShotId,
} from "@t3tools/client-runtime/device/showcase/cinematic";
import type { LaptopFinish } from "@t3tools/client-runtime/device/showcase/laptop-scene";
import {
  SHOWCASE_ASPECTS,
  SHOWCASE_BACKDROPS,
  type ShowcaseAspectId,
  type ShowcaseBackdropId,
} from "@t3tools/client-runtime/device/showcase/showcase-output";
import type {
  ShowcaseRenderer,
  ShowcaseScreenSource,
} from "@t3tools/client-runtime/device/showcase/showcase-renderer";
import { Download, ImageUp, Pause, Play, X } from "lucide-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { useStableCallback } from "~/hooks/useStableCallback";

import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import {
  isLaptopShowcase,
  opensInShowcase,
  SHOWCASE_DEVICES,
  showcaseDevice,
  showcaseFileName,
  showcaseShotLabel,
  showcaseTimeline,
  toggleShowcaseShot,
  type ShowcaseDeviceId,
} from "./showcaseStudio";
import type { ShowcaseScript } from "./showcaseStore";
import {
  loadScreenFile,
  loadShowcaseRenderer,
  placeholderScreen,
  releaseScreen,
  screenMimeType,
} from "./showcaseScreen";

const DOWNLOAD_URL_LIFETIME_MS = 60_000;

/** three.js and the studio scene load only when someone opens the studio. */
const formatSeconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function DeviceShowcase(props: {
  readonly threadRef: ScopedThreadRef;
  readonly script: ShowcaseScript;
  /** Changes when someone, often an agent, asks for this script again. */
  readonly scriptNonce: number;
  /** Hidden studios stop drawing; the panel stays mounted behind other tabs. */
  readonly visible: boolean;
  readonly onClose: () => void;
}) {
  const { script } = props;
  const [deviceId, setDeviceId] = useState<ShowcaseDeviceId>(script.device ?? "macbook-pro-14");
  const [finish, setFinish] = useState<LaptopFinish>(script.finish ?? "dark");
  const [shots, setShots] = useState<ReadonlyArray<ShowcaseShotId>>(
    script.shots ?? ["lid-open", "push-in"],
  );
  const [backdrop, setBackdrop] = useState<ShowcaseBackdropId>(script.backdrop ?? "graphite");
  const [aspect, setAspect] = useState<ShowcaseAspectId>(script.aspect ?? "landscape");
  const [appliedNonce, setAppliedNonce] = useState(props.scriptNonce);
  if (appliedNonce !== props.scriptNonce) {
    // A new request replaces only the choices it names.
    setAppliedNonce(props.scriptNonce);
    if (script.device) setDeviceId(script.device);
    if (script.finish) setFinish(script.finish);
    if (script.shots && script.shots.length > 0) setShots(script.shots);
    if (script.backdrop) setBackdrop(script.backdrop);
    if (script.aspect) setAspect(script.aspect);
  }
  const [time, setTime] = useState({ at: 0, playing: false });
  const [exporting, setExporting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [renderer, setRenderer] = useState<ShowcaseRenderer | null>(null);
  const sourceRef = useRef<ShowcaseScreenSource | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  /** The latest screen pick; an older file that finishes loading later is dropped. */
  const screenPickRef = useRef(0);
  const busy = exporting !== null;
  const laptop = isLaptopShowcase(deviceId);
  const opens = opensInShowcase(deviceId);
  // Lid open stays in the cut when switching to a phone, but only devices that open show or play it.
  const visibleShots = opens ? shots : shots.filter((shot) => shot !== "lid-open");
  const duration = timelineDuration(showcaseTimeline(shots, deviceId));
  // A primitive key, so the cut effect runs when the shots change and not on every render.
  const shotsKey = shots.join(",");

  // One renderer per canvas; the effects below keep it in step with the chosen options.
  const mountCanvas = (canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    let disposed = false;
    let created: ShowcaseRenderer | null = null;
    let stopObserving: (() => void) | undefined;
    if (!sourceRef.current) sourceRef.current = placeholderScreen();
    void loadShowcaseRenderer()
      .then(({ createShowcaseRenderer }) => {
        if (disposed) return;
        created = createShowcaseRenderer({
          canvas,
          source: sourceRef.current!,
          onTime: (at, playing) => setTime({ at, playing }),
          onError: () => setError("The photoreal model failed to load; showing a simple body."),
        });
        const host = canvas.parentElement!;
        const resized = created;
        stopObserving = observeResize(host, () => {
          const { width, height } = host.getBoundingClientRect();
          resized.resize(width, height, window.devicePixelRatio);
        });
        setRenderer(created);
      })
      .catch(() => {
        if (!disposed) setError("Showcase could not start. It needs WebGL in this browser.");
      });
    return () => {
      disposed = true;
      exportAbortRef.current?.abort();
      stopObserving?.();
      created?.dispose();
      releaseScreen(sourceRef.current);
      sourceRef.current = null;
      setRenderer(null);
    };
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the WebGL renderer showing the chosen device
  useEffect(() => {
    renderer?.setDevice(showcaseDevice(deviceId, finish));
  }, [renderer, deviceId, finish]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the WebGL renderer on the chosen cut and plays it through once
  useEffect(() => {
    if (!renderer) return;
    const picked = shotsKey.split(",") as ReadonlyArray<ShowcaseShotId>;
    renderer.setTimeline(showcaseTimeline(picked, deviceId), false);
    renderer.seek(0);
    if (props.visible) renderer.play();
  }, [renderer, deviceId, shotsKey, props.visible]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- stops the WebGL render loop while the panel is hidden
  useEffect(() => {
    if (!props.visible) renderer?.pause();
  }, [renderer, props.visible]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the WebGL renderer on the chosen backdrop
  useEffect(() => {
    renderer?.setBackdrop(backdrop);
  }, [renderer, backdrop]);

  const pickScreen = (file: File | undefined): Promise<boolean> => {
    // Dropping a file mid-export would swap the screen partway through the clip.
    if (!file || busy) return Promise.resolve(false);
    if (!file.type.startsWith("video/") && !file.type.startsWith("image/")) {
      setError("Use a video or image file.");
      return Promise.resolve(false);
    }
    setError(null);
    const pick = ++screenPickRef.current;
    return loadScreenFile(file).then(
      (source) => {
        if (pick !== screenPickRef.current) {
          releaseScreen(source);
          return false;
        }
        const previous = sourceRef.current;
        sourceRef.current = source;
        renderer?.setSource(source);
        renderer?.seek(0);
        releaseScreen(previous);
        return true;
      },
      (cause: unknown) => {
        if (pick === screenPickRef.current)
          setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      },
    );
  };

  const installScreen = useStableCallback(pickScreen);

  // An agent's `screen` is a path on the server; a signed asset URL serves it to this window.
  const environmentId = props.threadRef.environmentId;
  const screenAsset = useAssetUrlState(
    script.screen ? environmentId : null,
    script.screen
      ? { _tag: "media-file", threadId: props.threadRef.threadId, path: script.screen }
      : null,
  );
  const [loadedScreen, setLoadedScreen] = useState<string | null>(null);
  const screenUrl = screenAsset._tag === "Success" ? screenAsset.url : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the agent-named screen file into the WebGL renderer
  useEffect(() => {
    const path = script.screen;
    if (!renderer || !path || !screenUrl || loadedScreen === path) return;
    let cancelled = false;
    void fetch(screenUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not read the screen file (${response.status}).`);
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return false;
        const name = path.split(/[\\/]/).pop() ?? "screen";
        return installScreen(new File([blob], name, { type: blob.type || screenMimeType(name) }));
      })
      .then((installed) => {
        if (!cancelled && installed) setLoadedScreen(path);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [renderer, script.screen, screenUrl, loadedScreen, installScreen]);

  /** Renders the current cut; resolves null when closed mid-export, and rejects on failure. */
  const renderClip = () => {
    if (!renderer || exportAbortRef.current)
      return Promise.reject(new Error("Showcase is not ready to export."));
    const abort = new AbortController();
    exportAbortRef.current = abort;
    setExporting(0);
    setError(null);
    const { width, height } = SHOWCASE_ASPECTS[aspect];
    return renderer
      .record({ width, height, signal: abort.signal, onProgress: setExporting })
      .then((clip) => (abort.signal.aborted ? null : clip))
      .finally(() => {
        if (exportAbortRef.current === abort) exportAbortRef.current = null;
        setExporting(null);
      });
  };

  const exportClip = () => {
    if (!renderer || busy) return;
    renderClip()
      .then((clip) => {
        // Closing the studio mid-export cancels the download too.
        if (!clip) return;
        const { blob, extension } = clip;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = showcaseFileName(deviceId, extension);
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Export failed. Try again.");
      });
  };

  const output = SHOWCASE_ASPECTS[aspect];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-medium">Showcase</h2>
        <span className="text-xs text-muted-foreground">
          {output.width}×{output.height} · {formatSeconds(duration)}
        </span>
        <div className="flex-1" />
        <Button
          size="xs"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
        >
          <ImageUp />
          Screen
        </Button>
        <Button size="xs" onClick={exportClip} disabled={busy || !renderer}>
          {exporting !== null ? <Spinner size="xs" /> : <Download />}
          {exporting !== null ? `Exporting ${Math.round(exporting * 100)}%` : "Export video"}
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Close showcase" onClick={props.onClose}>
          <X />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,image/*"
          hidden
          aria-label="Screen recording or screenshot"
          onChange={(event) => {
            pickScreen(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="border-b px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div
        className={cn(
          "relative grid min-h-0 flex-1 place-items-center bg-muted/30 p-4",
          dragging && "ring-2 ring-inset ring-ring",
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          pickScreen(event.dataTransfer.files[0]);
        }}
      >
        <div
          className="relative max-h-full max-w-full overflow-hidden rounded-lg shadow-lg"
          style={{
            aspectRatio: `${output.width} / ${output.height}`,
            width: output.width >= output.height ? "100%" : "auto",
            height: output.width >= output.height ? "auto" : "100%",
          }}
        >
          <canvas ref={mountCanvas} className="block size-full" aria-label="Showcase preview" />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={time.playing ? "Pause" : "Play"}
          disabled={busy}
          onClick={() => (time.playing ? renderer?.pause() : renderer?.play())}
        >
          {time.playing ? <Pause /> : <Play />}
        </Button>
        <input
          type="range"
          aria-label="Timeline"
          className="min-w-0 flex-1 accent-primary"
          min={0}
          max={Math.max(1, duration)}
          step={10}
          value={Math.min(time.at, duration)}
          disabled={busy}
          onChange={(event) => {
            renderer?.pause();
            renderer?.seek(Number(event.target.value));
          }}
        />
        <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
          {formatSeconds(time.at)}
        </span>
      </div>
      <div className="flex shrink-0 flex-col gap-3 border-t px-3 py-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <OptionSelect
            ariaLabel="Device"
            value={deviceId}
            options={SHOWCASE_DEVICES.map((device) => ({ value: device.id, label: device.label }))}
            disabled={busy}
            onChange={setDeviceId}
          />
          {laptop ? (
            <ToggleGroup
              aria-label="Finish"
              disabled={busy}
              value={[finish]}
              onValueChange={(value) => {
                const next = value[0] as LaptopFinish | undefined;
                if (next) setFinish(next);
              }}
            >
              <Toggle value="dark">Dark</Toggle>
              <Toggle value="light">Light</Toggle>
            </ToggleGroup>
          ) : null}
          <OptionSelect
            ariaLabel="Backdrop"
            value={backdrop}
            options={Object.entries(SHOWCASE_BACKDROPS).map(([value, entry]) => ({
              value: value as ShowcaseBackdropId,
              label: entry.label,
            }))}
            disabled={busy}
            onChange={setBackdrop}
          />
          <OptionSelect
            ariaLabel="Aspect ratio"
            value={aspect}
            options={Object.entries(SHOWCASE_ASPECTS).map(([value, entry]) => ({
              value: value as ShowcaseAspectId,
              label: entry.label,
            }))}
            disabled={busy}
            onChange={setAspect}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Shots">
          <span className="mr-1 text-muted-foreground">Shots</span>
          {SHOWCASE_SHOTS.filter((shot) => shot.id !== "lid-open" || opens).map((shot) => {
            const order = visibleShots.indexOf(shot.id);
            return (
              <Button
                key={shot.id}
                size="xs"
                variant={order === -1 ? "outline" : "secondary"}
                aria-pressed={order !== -1}
                disabled={busy}
                onClick={() => setShots(toggleShowcaseShot(visibleShots, shot.id))}
              >
                {order === -1 ? null : (
                  <span className="grid size-4 place-items-center rounded-full bg-foreground text-3xs text-background">
                    {order + 1}
                  </span>
                )}
                {showcaseShotLabel(shot, deviceId)}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function OptionSelect<V extends string>(props: {
  readonly ariaLabel: string;
  readonly value: V;
  readonly options: ReadonlyArray<{ readonly value: V; readonly label: string }>;
  readonly disabled: boolean;
  readonly onChange: (value: V) => void;
}) {
  const current = props.options.find((option) => option.value === props.value);
  return (
    <Select
      value={props.value}
      disabled={props.disabled}
      onValueChange={(value) => {
        if (value !== null) props.onChange(value as V);
      }}
    >
      <SelectTrigger size="xs" className="w-36" aria-label={props.ariaLabel}>
        <SelectValue>{current?.label}</SelectValue>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        {props.options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
