import type { ShowcaseScreenSource } from "@t3tools/client-runtime/device/showcase/showcase-renderer";

/** three.js and the studio scene load only when a showcase is opened or exported. */
export const loadShowcaseRenderer = () =>
  import("@t3tools/client-runtime/device/showcase/showcase-renderer");

/** Shown on the screen until the user picks a recording, so the studio is never empty. */
export function placeholderScreen() {
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

export function loadScreenFile(file: File): Promise<ShowcaseScreenSource> {
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
      video.addEventListener(
        "error",
        () => {
          URL.revokeObjectURL(url);
          reject(new Error("That video could not be read."));
        },
        { once: true },
      );
    });
  }
  const image = new Image();
  image.src = url;
  return image.decode().then(
    () => image,
    () => {
      URL.revokeObjectURL(url);
      throw new Error("That image could not be read.");
    },
  );
}

/** Stops a dropped recording and frees its blob; the placeholder canvas holds none. */
export function releaseScreen(source: ShowcaseScreenSource | null) {
  if (source instanceof HTMLVideoElement) {
    source.pause();
    URL.revokeObjectURL(source.src);
  } else if (source instanceof HTMLImageElement) URL.revokeObjectURL(source.src);
}

const SCREEN_MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export function screenMimeType(name: string) {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return SCREEN_MIME_TYPES[extension] ?? "application/octet-stream";
}

/** Loads a screen file the server serves at `url`, such as an agent's `screen` path. */
export async function loadScreenFromUrl(url: string, path: string): Promise<ShowcaseScreenSource> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not read the screen file (${response.status}).`);
  const blob = await response.blob();
  const name = path.split(/[\\/]/).pop() ?? "screen";
  return loadScreenFile(new File([blob], name, { type: blob.type || screenMimeType(name) }));
}
