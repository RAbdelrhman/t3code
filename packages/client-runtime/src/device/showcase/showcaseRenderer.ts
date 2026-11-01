import {
  ACESFilmicToneMapping,
  Box3,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  Sphere,
  SRGBColorSpace,
  Texture,
  Vector3,
  VideoTexture,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { DeviceModelSource } from "../model.ts";
import { createDuoScene } from "../duoScene.ts";
import { createImportedPhoneScene, loadDeviceModel } from "../modelScene.ts";
import { createPhoneScene, phoneDisplayLayout } from "../phoneScene.ts";
import { IOS_PHONE_SHAPE, IOS_TABLET_SHAPE } from "../shapeProfile.ts";
import {
  compileTimeline,
  DEFAULT_POSE,
  poseCamera,
  type ShowcasePose,
  type ShowcaseTimeline,
} from "./cinematic.ts";
import {
  createLaptopScene,
  LAPTOP_LID_DEFAULT,
  LAPTOP_PROFILES,
  type LaptopFinish,
  type LaptopModelId,
} from "./laptopScene.ts";
import {
  coverCrop,
  pickRecordingFormat,
  SHOWCASE_BACKDROPS,
  type ShowcaseBackdropId,
} from "./showcaseOutput.ts";

export type ShowcaseDevice =
  | { readonly kind: "laptop"; readonly id: LaptopModelId; readonly finish?: LaptopFinish }
  | {
      readonly kind: "phone" | "tablet";
      /** A photoreal GLB when one ships for this device; the procedural body is the fallback. */
      readonly model?: DeviceModelSource | null;
    }
  | {
      /** A book-style foldable such as iPhone Duo; its fold follows the shot's lid angle. */
      readonly kind: "foldable";
      readonly model: DeviceModelSource;
    };

/** Anything three.js can upload as a screen: a recorded clip, a live stream canvas, or a still. */
export type ShowcaseScreenSource = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement;

interface Presentation {
  readonly root: Group;
  /** Width over height of the lit panel, which the screen source is cropped to fill. */
  readonly screenAspect: number;
  readonly setLid: (degrees: number) => void;
  readonly setTexture: (texture: Texture) => void;
  readonly dispose: () => void;
}

/** How long a recording holds its first and last pose. */
const RECORDING_HOLD_MS = 600;

const sourceSize = (source: ShowcaseScreenSource) =>
  source instanceof HTMLVideoElement
    ? { width: source.videoWidth || 1920, height: source.videoHeight || 1080 }
    : source instanceof HTMLImageElement
      ? { width: source.naturalWidth || 1920, height: source.naturalHeight || 1080 }
      : { width: source.width || 1920, height: source.height || 1080 };

/** Native panels the handsets show, portrait. A source of any shape is cropped to fill them. */
const HANDSET_PANELS = { phone: [1206, 2622], tablet: [2064, 2752] } as const;

function makeScreenTexture(source: ShowcaseScreenSource): Texture {
  const texture =
    source instanceof HTMLVideoElement
      ? new VideoTexture(source)
      : source instanceof HTMLCanvasElement
        ? new CanvasTexture(source)
        : new Texture(source);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function backdropTexture(id: ShowcaseBackdropId) {
  const backdrop = SHOWCASE_BACKDROPS[id];
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(512, 420, 40, 512, 560, 760);
  backdrop.stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1024, 1024);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Renders one device with a live screen through a cinematic camera timeline, and records it to a
 * video file. The caller owns the screen source element; this owns every GPU resource.
 */
export function createShowcaseRenderer(options: {
  readonly canvas: HTMLCanvasElement;
  readonly source: ShowcaseScreenSource;
  readonly onTime?: (timeMs: number, playing: boolean) => void;
  readonly onError?: (cause: unknown) => void;
}) {
  const renderer = new WebGLRenderer({
    canvas: options.canvas,
    antialias: true,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.85;
  let backdropId: ShowcaseBackdropId = "graphite";
  let backdrop = backdropTexture(backdropId);
  scene.background = backdrop;

  const key = new DirectionalLight(0xffffff, 2.6);
  key.position.set(-3, 6, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 8;
  key.shadow.bias = -0.0004;
  const rim = new DirectionalLight(new Color(0xbcd2ff), 1.8);
  rim.position.set(4, 3, -5);
  const hemi = new HemisphereLight(0xffffff, 0x1a1a22, 0.6);
  scene.add(key, rim, hemi);
  const ground = new Mesh(new PlaneGeometry(40, 40), new ShadowMaterial({ opacity: 0.32 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const camera = new PerspectiveCamera(DEFAULT_POSE.fov, 16 / 9, 0.05, 200);
  /** Spins around the device's own centre, independent of the camera. */
  const pivot = new Group();
  scene.add(pivot);

  let source = options.source;
  let texture = makeScreenTexture(source);
  let presentation: Presentation | null = null;
  let radius = 1.6;
  const size = new Vector3(1, 1, 1);
  let groundY = 0;
  let deviceRequest = 0;
  let timeline = compileTimeline({ clips: [] });
  let time = 0;
  let playing = false;
  let loop = true;
  let frameId: number | undefined;
  let lastFrame = 0;
  let disposed = false;
  let pose: ShowcasePose = DEFAULT_POSE;
  let viewport = { width: 0, height: 0, pixelRatio: 1 };
  let recording: { width: number; height: number } | null = null;

  const fitScreen = () => {
    if (!presentation) return;
    const { width, height } = sourceSize(source);
    const crop = coverCrop(width / height, presentation.screenAspect);
    texture.repeat.set(crop.repeat[0], crop.repeat[1]);
    texture.offset.set(crop.offset[0], crop.offset[1]);
  };

  /** Centres the device on the pivot and measures it once, with the lid at its resting angle. */
  const install = (next: Presentation) => {
    presentation?.dispose();
    pivot.clear();
    presentation = next;
    fitScreen();
    next.root.traverse((object) => {
      if (object instanceof Mesh && object.name !== "device-screen") {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    next.setLid(LAPTOP_LID_DEFAULT);
    next.root.position.set(0, 0, 0);
    next.root.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(next.root);
    const center = bounds.getCenter(new Vector3());
    next.root.position.sub(center);
    radius = Math.max(0.5, bounds.getBoundingSphere(new Sphere()).radius);
    bounds.getSize(size);
    groundY = bounds.min.y - center.y - 0.002;
    ground.position.y = groundY;
    pivot.add(next.root);
    render();
  };

  const handsetLayout = (kind: "phone" | "tablet") =>
    phoneDisplayLayout(null, HANDSET_PANELS[kind][0], HANDSET_PANELS[kind][1]);

  const proceduralHandset = (kind: "phone" | "tablet"): Presentation => {
    const layout = handsetLayout(kind);
    const handset = createPhoneScene(
      texture,
      layout,
      kind === "tablet" ? IOS_TABLET_SHAPE : IOS_PHONE_SHAPE,
    );
    return {
      root: handset.root,
      screenAspect: layout.aspect,
      setLid: () => {},
      setTexture: (next) => handset.setDisplay(next, layout),
      dispose: handset.dispose,
    };
  };

  /** Changes asked for mid-export, applied once it ends so the clip never switches partway. */
  const deferred = new Map<"device" | "timeline" | "backdrop" | "source", () => void>();

  /**
   * A foldable's inner display spans both halves when open; the cover shows the same source.
   * Laptop lid angles map onto the fold, so the resting 108 degrees is fully open.
   */
  const foldable = (model: Awaited<ReturnType<typeof loadDeviceModel>>): Presentation => {
    const duo = createDuoScene(model.asset, { 1: texture, 3: texture });
    const displays = ["cover-display", "inner-display-left", "inner-display-right"].flatMap(
      (name) => {
        const mesh = model.asset.getObjectByName(name);
        return mesh instanceof Mesh ? [mesh] : [];
      },
    );
    duo.setAngle(180);
    duo.root.updateMatrixWorld(true);
    const inner = new Box3();
    for (const mesh of displays.slice(1)) inner.union(new Box3().setFromObject(mesh));
    const panel = inner.getSize(new Vector3());
    return {
      root: duo.root,
      screenAspect: panel.x > 0 && panel.y > 0 ? panel.x / panel.y : 1,
      setLid: (degrees) => duo.setAngle(Math.min(180, (degrees * 180) / LAPTOP_LID_DEFAULT)),
      setTexture: (next) => {
        for (const mesh of displays) (mesh.material as MeshBasicMaterial).map = next;
      },
      dispose: () => {
        duo.dispose();
        model.dispose();
      },
    };
  };

  const setDevice = (device: ShowcaseDevice) => {
    if (recording) {
      deferred.set("device", () => setDevice(device));
      return;
    }
    const request = ++deviceRequest;
    if (device.kind === "laptop") {
      const laptop = createLaptopScene(texture, LAPTOP_PROFILES[device.id], {
        finish: device.finish ?? "dark",
      });
      install({
        root: laptop.root,
        screenAspect: laptop.screenWidth / laptop.screenHeight,
        setLid: laptop.setLidAngle,
        setTexture: laptop.setTexture,
        dispose: laptop.dispose,
      });
      return;
    }
    install(proceduralHandset(device.kind === "foldable" ? "phone" : device.kind));
    if (!device.model) return;
    const controller = new AbortController();
    loadDeviceModel(device.model, controller.signal)
      .then((model) => {
        if (disposed || request !== deviceRequest) return model.dispose();
        if (device.kind === "foldable") return install(foldable(model));
        const layout = handsetLayout(device.kind);
        let screenAspect = layout.aspect;
        model.asset.traverse((object) => {
          if (!(object instanceof Mesh) || object.name !== "device-screen") return;
          const panel = new Box3().setFromObject(object).getSize(new Vector3());
          if (panel.x > 0 && panel.y > 0) screenAspect = panel.x / panel.y;
        });
        const imported = createImportedPhoneScene(model.asset, texture, layout);
        install({
          root: imported.root,
          screenAspect,
          setLid: () => {},
          setTexture: (next) => imported.setDisplay(next, layout),
          dispose: () => {
            imported.dispose();
            model.dispose();
          },
        });
      })
      .catch((cause: unknown) => {
        // The procedural body is already showing; a missing GLB only costs realism.
        if (!disposed && request === deviceRequest) options.onError?.(cause);
      });
  };

  /**
   * Shots are written in multiples of this. The bounding sphere suits a wide laptop, but a tall
   * phone, or any device in a narrow 9:16 frame, needs its height or width to fit too.
   */
  const framingRadius = () =>
    Math.max(radius, 0.95 * size.y, (0.95 * size.x) / Math.max(0.1, camera.aspect));

  const applyPose = () => {
    const { position, target } = poseCamera(pose, framingRadius());
    camera.position.set(position[0], Math.max(groundY + 0.05, position[1]), position[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(target[0], target[1], target[2]);
    camera.rotateZ((pose.roll * Math.PI) / 180);
    camera.fov = pose.fov;
    pivot.rotation.y = (pose.spin * Math.PI) / 180;
    presentation?.setLid(pose.lid);
  };

  function render() {
    if (disposed) return;
    const output = recording ?? viewport;
    if (!output.width || !output.height) return;
    camera.aspect = output.width / output.height;
    pose = timeline.sample(time).pose;
    applyPose();
    camera.updateProjectionMatrix();
    if (texture instanceof CanvasTexture) texture.needsUpdate = true;
    renderer.render(scene, camera);
  }

  const tick = (now: number) => {
    frameId = undefined;
    if (disposed || !playing) return;
    time += now - lastFrame;
    lastFrame = now;
    if (time >= timeline.duration) {
      if (loop && !recording) {
        time = 0;
        if (source instanceof HTMLVideoElement) source.currentTime = 0;
      } else {
        time = timeline.duration;
        playing = false;
      }
    }
    render();
    options.onTime?.(time, playing);
    if (playing) frameId = requestAnimationFrame(tick);
  };

  const play = () => {
    if (playing || disposed) return;
    if (time >= timeline.duration) time = 0;
    playing = true;
    lastFrame = performance.now();
    if (source instanceof HTMLVideoElement) void source.play().catch(() => {});
    frameId = requestAnimationFrame(tick);
  };

  /** Keeps drawing the current pose, since a canvas stream only emits frames that were drawn. */
  const holdFrame = (ms: number) =>
    new Promise<void>((resolve) => {
      const end = performance.now() + ms;
      const step = () => {
        render();
        if (disposed || performance.now() >= end) return resolve();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });

  /** Shows the video screen source at `seconds`, waiting for the decoder to land on it. */
  const seekScreen = async (seconds: number) => {
    if (!(source instanceof HTMLVideoElement)) return;
    const video = source;
    const length = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const target = length > 0 ? seconds % length : 0;
    if (Math.abs(video.currentTime - target) < 1e-3) return;
    await new Promise<void>((resolve) => {
      video.addEventListener("seeked", () => resolve(), { once: true });
      video.currentTime = target;
    });
    texture.needsUpdate = true;
  };

  /** WebCodecs path: exact frame times, no dropped frames. Resolves null when unsupported. */
  const encodeOffline = async (output: {
    readonly width: number;
    readonly height: number;
    readonly fps?: number;
    readonly signal?: AbortSignal;
    readonly onProgress?: (fraction: number) => void;
  }) => {
    if (typeof VideoEncoder === "undefined") return null;
    const media = await import("mediabunny");
    const frameSize = { width: output.width, height: output.height };
    if (!(await media.canEncodeVideo("avc", { ...frameSize, bitrate: media.QUALITY_HIGH })))
      return null;
    const fps = output.fps ?? 60;
    const target = new media.BufferTarget();
    const file = new media.Output({
      format: new media.Mp4OutputFormat({ fastStart: "in-memory" }),
      target,
    });
    const frames = new media.CanvasSource(options.canvas, {
      codec: "avc",
      bitrate: media.QUALITY_HIGH,
    });
    file.addVideoTrack(frames, { frameRate: fps });
    await file.start();
    const count = Math.max(1, Math.ceil((timeline.duration / 1000) * fps));
    try {
      for (let index = 0; index <= count; index++) {
        output.signal?.throwIfAborted();
        if (disposed) throw new Error("The showcase closed during export.");
        time = Math.min(timeline.duration, (index * 1000) / fps);
        await seekScreen(time / 1000);
        render();
        // The canvas is read before this task yields, while the drawing buffer is intact.
        await frames.add(index / fps, 1 / fps);
        if (index % 15 === 0) {
          output.onProgress?.(index / count);
          options.onTime?.(time, false);
        }
      }
      await file.finalize();
    } catch (cause) {
      await file.cancel();
      throw cause;
    }
    output.onProgress?.(1);
    return { blob: new Blob([target.buffer!], { type: "video/mp4" }), extension: "mp4" as const };
  };

  /** MediaRecorder path, for browsers without H.264 WebCodecs. Plays once in real time. */
  const recordRealtime = async (output: {
    readonly fps?: number;
    readonly signal?: AbortSignal;
    readonly onProgress?: (fraction: number) => void;
  }) => {
    const format = pickRecordingFormat((type) => MediaRecorder.isTypeSupported(type));
    if (!format) throw new Error("This browser cannot record video from a canvas.");
    const stream = options.canvas.captureStream(output.fps ?? 60);
    const recorder = new MediaRecorder(stream, {
      mimeType: format.mimeType,
      videoBitsPerSecond: 16_000_000,
    });
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    const stopped = new Promise<void>((resolve) =>
      recorder.addEventListener("stop", () => resolve(), { once: true }),
    );
    try {
      time = 0;
      if (source instanceof HTMLVideoElement) source.currentTime = 0;
      render();
      const started = new Promise<void>((resolve) =>
        recorder.addEventListener("start", () => resolve(), { once: true }),
      );
      recorder.start(250);
      await started;
      // Hardware encoders drop the first frames while they spin up; hold the opening pose
      // through that, and the closing pose after, so the clip keeps the whole timeline.
      await holdFrame(RECORDING_HOLD_MS);
      await new Promise<void>((resolve, reject) => {
        const check = () => {
          if (output.signal?.aborted) return reject(output.signal.reason);
          output.onProgress?.(time / Math.max(1, timeline.duration));
          if (!playing) return resolve();
          requestAnimationFrame(check);
        };
        play();
        requestAnimationFrame(check);
      });
      await holdFrame(RECORDING_HOLD_MS);
      recorder.stop();
      await stopped;
    } catch (cause) {
      pause();
      if (recorder.state !== "inactive") recorder.stop();
      throw cause;
    } finally {
      for (const track of stream.getTracks()) track.stop();
    }
    return { blob: new Blob(chunks, { type: format.mimeType }), extension: format.extension };
  };

  const pause = () => {
    playing = false;
    if (frameId !== undefined) cancelAnimationFrame(frameId);
    frameId = undefined;
    if (source instanceof HTMLVideoElement) source.pause();
    options.onTime?.(time, false);
  };

  return {
    setDevice,
    setSource(next: ShowcaseScreenSource) {
      if (recording) {
        deferred.set("source", () => this.setSource(next));
        return;
      }
      source = next;
      const previous = texture;
      texture = makeScreenTexture(next);
      presentation?.setTexture(texture);
      fitScreen();
      previous.dispose();
      render();
    },
    setBackdrop(id: ShowcaseBackdropId) {
      if (recording) {
        deferred.set("backdrop", () => this.setBackdrop(id));
        return;
      }
      if (id === backdropId) return;
      backdropId = id;
      backdrop.dispose();
      backdrop = backdropTexture(id);
      scene.background = backdrop;
      render();
    },
    setTimeline(next: ShowcaseTimeline, nextLoop = true) {
      if (recording) {
        deferred.set("timeline", () => this.setTimeline(next, nextLoop));
        return;
      }
      timeline = compileTimeline(next);
      loop = nextLoop;
      const clamped = Math.min(time, timeline.duration);
      const moved = clamped !== time;
      time = clamped;
      render();
      // A shorter cut can move the playhead; tell the scrubber only when it did.
      if (moved) options.onTime?.(time, playing);
    },
    get duration() {
      return timeline.duration;
    },
    get playing() {
      return playing;
    },
    // The export drives time itself; playback calls from the page wait until it ends.
    seek(timeMs: number) {
      if (recording) return;
      time = Math.min(timeline.duration, Math.max(0, timeMs));
      if (
        source instanceof HTMLVideoElement &&
        Number.isFinite(source.duration) &&
        source.duration > 0
      )
        source.currentTime = (time / 1000) % source.duration;
      render();
      options.onTime?.(time, playing);
    },
    play: () => {
      if (!recording) play();
    },
    pause: () => {
      if (!recording) pause();
    },
    resize(width: number, height: number, pixelRatio: number) {
      viewport = { width, height, pixelRatio };
      if (recording) return;
      renderer.setPixelRatio(Math.min(pixelRatio, 2));
      renderer.setSize(width, height, false);
      render();
    },
    /**
     * Renders the timeline once at `width` x `height` and resolves with the encoded clip.
     * WebCodecs encodes each frame at its exact time, so slow renders stay smooth and full
     * length; without it, the clip plays in real time into a MediaRecorder.
     */
    async record(output: {
      readonly width: number;
      readonly height: number;
      readonly fps?: number;
      readonly signal?: AbortSignal;
      readonly onProgress?: (fraction: number) => void;
    }): Promise<{ blob: Blob; extension: "mp4" | "webm" }> {
      if (recording) throw new Error("A showcase recording is already running.");
      pause();
      recording = { width: output.width, height: output.height };
      renderer.setPixelRatio(1);
      renderer.setSize(output.width, output.height, false);
      try {
        const offline = await encodeOffline(output);
        if (offline) return offline;
        return await recordRealtime(output);
      } finally {
        recording = null;
        time = 0;
        if (source instanceof HTMLVideoElement) source.currentTime = 0;
        renderer.setPixelRatio(Math.min(viewport.pixelRatio, 2));
        renderer.setSize(viewport.width, viewport.height, false);
        for (const apply of deferred.values()) apply();
        deferred.clear();
        render();
        options.onTime?.(time, false);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pause();
      presentation?.dispose();
      presentation = null;
      texture.dispose();
      backdrop.dispose();
      environment.dispose();
      pmrem.dispose();
      ground.geometry.dispose();
      (ground.material as ShadowMaterial).dispose();
      renderer.dispose();
    },
  };
}

export type ShowcaseRenderer = ReturnType<typeof createShowcaseRenderer>;
