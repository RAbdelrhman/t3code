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
import { useEffect, useRef, useState } from "react";

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
  SHOWCASE_DEVICES,
  showcaseDevice,
  showcaseFileName,
  showcaseTimeline,
  toggleShowcaseShot,
  type ShowcaseDeviceId,
} from "./showcaseStudio";
import type { ShowcaseScript } from "./showcaseStore";

const DOWNLOAD_URL_LIFETIME_MS = 60_000;

/** three.js and the studio scene load only when someone opens the studio. */
const loadShowcaseRenderer = () =>
  import("@t3tools/client-runtime/device/showcase/showcase-renderer");

/** Shown on the screen until the user picks a recording, so the studio is never empty. */
function placeholderScreen() {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 1000;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, 1600, 1000);
  gradient.addColorStop(0, "#1f2a44");
  gradient.addColorStop(1, "#0b0d14");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1600, 1000);
  context.fillStyle = "rgba(255,255,255,0.9)";
  context.font = "600 64px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText("Your app here", 800, 480);
  context.fillStyle = "rgba(255,255,255,0.55)";
  context.font = "400 34px system-ui, sans-serif";
  context.fillText("Drop a screen recording or screenshot", 800, 550);
  return canvas;
}

function loadScreenFile(file: File): Promise<ShowcaseScreenSource> {
  const url = URL.createObjectURL(file);
  if (file.type.startsWith("video/")) {
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.src = url;
    return new Promise((resolve, reject) => {
      video.addEventListener("loadeddata", () => resolve(video), { once: true });
      video.addEventListener("error", () => reject(new Error("That video could not be read.")), {
        once: true,
      });
    });
  }
  const image = new Image();
  image.src = url;
  return image.decode().then(
    () => image,
    () => {
      throw new Error("That image could not be read.");
    },
  );
}

const formatSeconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function DeviceShowcase(props: {
  readonly script: ShowcaseScript;
  /** Changes when someone, often an agent, asks for this script again. */
  readonly scriptNonce: number;
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
  const timeline = showcaseTimeline(shots, deviceId);
  const duration = timelineDuration(timeline);

  // One renderer per canvas; the effects below keep it in step with the chosen options.
  const mountCanvas = (canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    let disposed = false;
    let created: ShowcaseRenderer | null = null;
    let stopObserving: (() => void) | undefined;
    if (!sourceRef.current) sourceRef.current = placeholderScreen();
    void loadShowcaseRenderer().then(({ createShowcaseRenderer }) => {
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
      // The timeline loops, so playing before the first cut arrives is harmless.
      created.play();
      setRenderer(created);
    });
    return () => {
      disposed = true;
      stopObserving?.();
      created?.dispose();
      setRenderer(null);
    };
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the WebGL renderer showing the chosen device
  useEffect(() => {
    renderer?.setDevice(showcaseDevice(deviceId, finish));
  }, [renderer, deviceId, finish]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the WebGL renderer playing the chosen cut
  useEffect(() => {
    renderer?.setTimeline(timeline);
  }, [renderer, timeline]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the WebGL renderer on the chosen backdrop
  useEffect(() => {
    renderer?.setBackdrop(backdrop);
  }, [renderer, backdrop]);

  const pickScreen = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("video/") && !file.type.startsWith("image/")) {
      setError("Use a video or image file.");
      return;
    }
    setError(null);
    loadScreenFile(file).then(
      (source) => {
        const previous = sourceRef.current;
        sourceRef.current = source;
        renderer?.setSource(source);
        renderer?.seek(0);
        if (previous instanceof HTMLVideoElement) {
          previous.pause();
          URL.revokeObjectURL(previous.src);
        } else if (previous instanceof HTMLImageElement) URL.revokeObjectURL(previous.src);
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  };

  const exportClip = () => {
    if (!renderer || exporting !== null) return;
    setExporting(0);
    setError(null);
    const { width, height } = SHOWCASE_ASPECTS[aspect];
    renderer
      .record({ width, height, onProgress: setExporting })
      .then(({ blob, extension }) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = showcaseFileName(deviceId, extension);
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Export failed. Try again."),
      )
      .finally(() => setExporting(null));
  };

  const output = SHOWCASE_ASPECTS[aspect];
  const laptop = isLaptopShowcase(deviceId);

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
          disabled={exporting !== null}
        >
          <ImageUp />
          Screen
        </Button>
        <Button size="xs" onClick={exportClip} disabled={exporting !== null || !renderer}>
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
          disabled={exporting !== null}
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
          disabled={exporting !== null}
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
            onChange={setDeviceId}
          />
          {laptop ? (
            <ToggleGroup
              aria-label="Finish"
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
            onChange={setBackdrop}
          />
          <OptionSelect
            ariaLabel="Aspect ratio"
            value={aspect}
            options={Object.entries(SHOWCASE_ASPECTS).map(([value, entry]) => ({
              value: value as ShowcaseAspectId,
              label: entry.label,
            }))}
            onChange={setAspect}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Shots">
          <span className="mr-1 text-muted-foreground">Shots</span>
          {SHOWCASE_SHOTS.filter((shot) => shot.id !== "lid-open" || laptop).map((shot) => {
            const order = shots.indexOf(shot.id);
            return (
              <Button
                key={shot.id}
                size="xs"
                variant={order === -1 ? "outline" : "secondary"}
                aria-pressed={order !== -1}
                onClick={() => setShots((current) => toggleShowcaseShot(current, shot.id))}
              >
                {order === -1 ? null : (
                  <span className="grid size-4 place-items-center rounded-full bg-foreground text-3xs text-background">
                    {order + 1}
                  </span>
                )}
                {shot.label}
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
  readonly onChange: (value: V) => void;
}) {
  const current = props.options.find((option) => option.value === props.value);
  return (
    <Select
      value={props.value}
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
