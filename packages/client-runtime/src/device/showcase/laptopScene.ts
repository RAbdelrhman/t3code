import {
  BoxGeometry,
  CircleGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RingGeometry,
  Shape,
  ShapeGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
} from "three";

/** Scene units per real centimetre. A 14-inch laptop ends up about 4.7 units wide. */
const CM = 0.15;

export type LaptopModelId = "macbook-pro-14" | "dell-xps-14";
export type LaptopFinish = "dark" | "light";

export interface LaptopProfile {
  readonly id: LaptopModelId;
  readonly label: string;
  /** Outer footprint and thickness, in centimetres, from the maker's spec sheet. */
  readonly widthCm: number;
  readonly depthCm: number;
  readonly baseCm: number;
  readonly lidCm: number;
  readonly cornerCm: number;
  /** Native panel resolution; the screen keeps this aspect. */
  readonly panel: readonly [number, number];
  /** Black-glass border between the lid edge and the lit panel. */
  readonly bezelCm: { readonly side: number; readonly top: number; readonly bottom: number };
  readonly screenCornerCm: number;
  readonly notch: boolean;
  readonly keyboard: {
    readonly widthCm: number;
    readonly depthCm: number;
    /** Distance from the hinge edge to the top key row. */
    readonly insetCm: number;
    /** A capacitive strip instead of a physical function row. */
    readonly touchRow: boolean;
  };
  /** Visible trackpad outline; the XPS haptic pad is flush glass and barely shows. */
  readonly trackpad: {
    readonly widthCm: number;
    readonly depthCm: number;
    readonly contrast: number;
  };
  readonly finishes: Record<LaptopFinish, { readonly body: number; readonly keys: number }>;
  readonly emblem: "none" | "ring";
}

export const LAPTOP_PROFILES: Record<LaptopModelId, LaptopProfile> = {
  // MacBook Pro 14-inch (M5): 31.26 x 22.12 x 1.55 cm, 3024 x 1964 Liquid Retina XDR.
  "macbook-pro-14": {
    id: "macbook-pro-14",
    label: "MacBook Pro 14",
    widthCm: 31.26,
    depthCm: 22.12,
    baseCm: 0.95,
    lidCm: 0.6,
    cornerCm: 1.1,
    panel: [3024, 1964],
    bezelCm: { side: 0.42, top: 0.62, bottom: 0.62 },
    screenCornerCm: 0.55,
    notch: true,
    keyboard: { widthCm: 27.6, depthCm: 11.0, insetCm: 1.6, touchRow: false },
    trackpad: { widthCm: 15.3, depthCm: 9.9, contrast: 0.06 },
    finishes: {
      dark: { body: 0x2c2d31, keys: 0x0d0d0f },
      light: { body: 0xc8cacd, keys: 0x101012 },
    },
    emblem: "none",
  },
  // Dell XPS 14 (9440): 30.97 x 20.96 x 1.8 cm, 16:10 3200 x 2000 OLED, edge-to-edge keys.
  "dell-xps-14": {
    id: "dell-xps-14",
    label: "Dell XPS 14",
    widthCm: 30.97,
    depthCm: 20.96,
    baseCm: 1.1,
    lidCm: 0.7,
    cornerCm: 0.75,
    panel: [3200, 2000],
    bezelCm: { side: 0.45, top: 0.75, bottom: 0.55 },
    screenCornerCm: 0.12,
    notch: false,
    keyboard: { widthCm: 30.1, depthCm: 10.4, insetCm: 1.3, touchRow: true },
    trackpad: { widthCm: 13.5, depthCm: 8.8, contrast: 0.015 },
    finishes: {
      dark: { body: 0x3a3c41, keys: 0x16171a },
      light: { body: 0xd7d8da, keys: 0x1a1b1e },
    },
    emblem: "ring",
  },
};

export const LAPTOP_MODEL_IDS = Object.keys(LAPTOP_PROFILES) as ReadonlyArray<LaptopModelId>;

/** Degrees. 0 is shut; the hinge stops a little past 130. */
export const LAPTOP_LID_MAX = 135;
export const LAPTOP_LID_DEFAULT = 108;

function roundedPath(width: number, height: number, radius: number, path = new Shape()) {
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.min(radius, width / 2, height / 2);
  path.moveTo(x + r, y);
  path.lineTo(x + width - r, y);
  path.quadraticCurveTo(x + width, y, x + width, y + r);
  path.lineTo(x + width, y + height - r);
  path.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  path.lineTo(x + r, y + height);
  path.quadraticCurveTo(x, y + height, x, y + height - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

/** Planar UVs over a centred width x height rectangle, so rounded corners crop rather than stretch. */
function planarUv(geometry: BufferGeometry, width: number, height: number) {
  const position = geometry.getAttribute("position");
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = (position.getX(i) + width / 2) / width;
    uv[i * 2 + 1] = (position.getY(i) + height / 2) / height;
  }
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
}

/** Number row, tab row, caps row, shift row. */
const ALPHA_ROWS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 12, 2],
  [1.5, 12, 1.5],
  [1.8, 11, 2.2],
  [2.3, 10, 2.7],
];

export function clampLidAngle(degrees: number) {
  return Math.min(LAPTOP_LID_MAX, Math.max(0, Number.isFinite(degrees) ? degrees : 0));
}

/**
 * Builds a laptop at the origin: the base sits on y = 0, the hinge runs along the back edge,
 * and the open screen faces +z. Every resource is owned by the returned scene.
 */
export function createLaptopScene(
  texture: Texture,
  profile: LaptopProfile,
  options: { readonly finish?: LaptopFinish; readonly lidAngle?: number } = {},
) {
  const finish = profile.finishes[options.finish ?? "dark"];
  const width = profile.widthCm * CM;
  const depth = profile.depthCm * CM;
  const baseHeight = profile.baseCm * CM;
  const lidThickness = profile.lidCm * CM;
  const corner = profile.cornerCm * CM;

  const metal = new MeshPhysicalMaterial({
    color: finish.body,
    metalness: 0.82,
    roughness: 0.36,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
  });
  const keyMaterial = new MeshStandardMaterial({
    color: finish.keys,
    metalness: 0.1,
    roughness: 0.62,
  });
  const wellMaterial = new MeshStandardMaterial({
    color: 0x050506,
    metalness: 0.2,
    roughness: 0.8,
  });
  const glass = new MeshPhysicalMaterial({
    color: 0x050507,
    metalness: 0.1,
    roughness: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
  const padMaterial = new MeshStandardMaterial({
    color: finish.body,
    metalness: 0.7,
    roughness: 0.36 + profile.trackpad.contrast * 3,
  });
  const screenMaterial = new MeshBasicMaterial({ map: texture, toneMapped: false });
  const notchMaterial = new MeshBasicMaterial({ color: 0x000000 });
  const lensMaterial = new MeshBasicMaterial({ color: 0x0b1424 });
  const emblemMaterial = new MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness: 0.12,
  });
  const materials: Material[] = [
    metal,
    keyMaterial,
    wellMaterial,
    glass,
    padMaterial,
    screenMaterial,
    notchMaterial,
    lensMaterial,
    emblemMaterial,
  ];

  const root = new Group();
  root.name = `laptop-${profile.id}`;

  // Base: a rounded slab extruded upward, lying in the xz plane.
  const baseShape = roundedPath(width, depth, corner);
  const base = new Mesh(
    new ExtrudeGeometry(baseShape, {
      depth: baseHeight - 0.02,
      bevelEnabled: true,
      bevelSize: 0.01,
      bevelThickness: 0.01,
      bevelSegments: 3,
      curveSegments: 10,
    }),
    metal,
  );
  base.name = "laptop-base";
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.01;
  root.add(base);
  const deckY = baseHeight;

  // Keyboard well and keys.
  const kb = profile.keyboard;
  const kbWidth = kb.widthCm * CM;
  const kbDepth = kb.depthCm * CM;
  const kbCenterZ = -depth / 2 + kb.insetCm * CM + kbDepth / 2;
  const well = new Mesh(new ShapeGeometry(roundedPath(kbWidth, kbDepth, 0.03), 4), wellMaterial);
  well.name = "keyboard-well";
  well.rotation.x = -Math.PI / 2;
  well.position.set(0, deckY + 0.0015, kbCenterZ);
  root.add(well);

  const rows = 6;
  const pitch = kbDepth / rows;
  const keySize = pitch * 0.82;
  const keyHeight = 0.012;
  const keyGeometry = new BoxGeometry(1, keyHeight, 1);
  const transforms: Matrix4[] = [];
  const matrix = (x: number, z: number, w: number, d: number) =>
    new Matrix4()
      .makeTranslation(x, deckY + keyHeight / 2 + 0.002, z)
      .multiply(new Matrix4().makeScale(w, 1, d));
  for (let row = 0; row < rows; row++) {
    const z = kbCenterZ - kbDepth / 2 + pitch * (row + 0.5);
    if (row === 0) {
      if (kb.touchRow) continue;
      // Half-height function row.
      const count = 14;
      const step = kbWidth / count;
      for (let i = 0; i < count; i++)
        transforms.push(
          matrix(-kbWidth / 2 + step * (i + 0.5), z + pitch * 0.2, step * 0.86, keySize * 0.55),
        );
      continue;
    }
    if (row === rows - 1) {
      // Bottom row: modifiers, a wide space bar, and arrow keys.
      const step = kbWidth / 14;
      const spaceWidth = step * 5.6;
      let x = -kbWidth / 2;
      for (let i = 0; i < 4; i++, x += step)
        transforms.push(matrix(x + step / 2, z, step * 0.86, keySize));
      transforms.push(matrix(x + spaceWidth / 2, z, spaceWidth - step * 0.14, keySize));
      x += spaceWidth;
      for (let i = 0; i < 2; i++, x += step)
        transforms.push(matrix(x + step / 2, z, step * 0.86, keySize));
      const arrows = kbWidth / 2 - x;
      for (let i = 0; i < 3; i++)
        transforms.push(
          matrix(
            x + (arrows / 3) * (i + 0.5),
            z + keySize * 0.24,
            (arrows / 3) * 0.84,
            keySize * 0.48,
          ),
        );
      transforms.push(
        matrix(x + arrows / 2, z - keySize * 0.26, (arrows / 3) * 0.84, keySize * 0.44),
      );
      continue;
    }
    // Alphanumeric rows in key units, 15u wide: [left key, 1u keys, right key].
    const [left, count, right] = ALPHA_ROWS[row - 1] ?? [1.5, 12, 1.5];
    const unit = kbWidth / 15;
    let x = -kbWidth / 2;
    for (const width of [left, ...Array.from({ length: count }, () => 1), right]) {
      transforms.push(matrix(x + (width * unit) / 2, z, width * unit - unit * 0.14, keySize));
      x += width * unit;
    }
  }
  const keys = new InstancedMesh(keyGeometry, keyMaterial, transforms.length);
  keys.name = "keyboard-keys";
  transforms.forEach((transform, index) => keys.setMatrixAt(index, transform));
  keys.instanceMatrix.needsUpdate = true;
  root.add(keys);
  if (kb.touchRow) {
    const strip = new Mesh(new ShapeGeometry(roundedPath(kbWidth, pitch * 0.62, 0.02), 4), glass);
    strip.name = "touch-row";
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(0, deckY + 0.003, kbCenterZ - kbDepth / 2 + pitch * 0.5);
    root.add(strip);
  }

  // Trackpad, centred in the palm rest.
  const padWidth = profile.trackpad.widthCm * CM;
  const padDepth = profile.trackpad.depthCm * CM;
  const palmStart = kbCenterZ + kbDepth / 2;
  const pad = new Mesh(new ShapeGeometry(roundedPath(padWidth, padDepth, 0.05), 8), padMaterial);
  pad.name = "trackpad";
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, deckY + 0.0012, palmStart + (depth / 2 - palmStart) / 2);
  root.add(pad);

  // Lid: built upright with the panel facing +z, then swung about the hinge.
  const hinge = new Group();
  hinge.name = "laptop-hinge";
  hinge.position.set(0, deckY, -depth / 2 + lidThickness / 2);
  root.add(hinge);
  const lidHeight = depth - lidThickness * 0.5;
  const lid = new Mesh(
    new ExtrudeGeometry(roundedPath(width, lidHeight, corner), {
      depth: lidThickness - 0.016,
      bevelEnabled: true,
      bevelSize: 0.008,
      bevelThickness: 0.008,
      bevelSegments: 3,
      curveSegments: 10,
    }),
    metal,
  );
  lid.name = "laptop-lid";
  lid.position.set(0, lidHeight / 2, -lidThickness + 0.008);
  hinge.add(lid);

  const front = new Mesh(
    new ShapeGeometry(roundedPath(width - 0.012, lidHeight - 0.012, corner * 0.9), 10),
    glass,
  );
  front.name = "lid-glass";
  front.position.set(0, lidHeight / 2, 0.0005);
  hinge.add(front);

  const bezel = profile.bezelCm;
  const screenWidth = width - bezel.side * 2 * CM;
  const screenHeight = screenWidth * (profile.panel[1] / profile.panel[0]);
  const screenBottom = bezel.bottom * CM;
  const screenGeometry = new ShapeGeometry(
    roundedPath(screenWidth, screenHeight, profile.screenCornerCm * CM),
    12,
  );
  planarUv(screenGeometry, screenWidth, screenHeight);
  const display = new Mesh(screenGeometry, screenMaterial);
  display.name = "device-screen";
  display.position.set(0, screenBottom + screenHeight / 2, 0.0012);
  hinge.add(display);

  if (profile.notch) {
    const notch = new Mesh(
      new ShapeGeometry(roundedPath(1.95 * CM, 0.62 * CM, 0.1 * CM), 6),
      notchMaterial,
    );
    notch.name = "camera-notch";
    notch.position.set(0, screenBottom + screenHeight - 0.31 * CM + 0.06 * CM, 0.0018);
    hinge.add(notch);
  }
  const lens = new Mesh(new CircleGeometry(0.11 * CM, 18), lensMaterial);
  lens.name = "webcam";
  lens.position.set(
    0,
    profile.notch ? screenBottom + screenHeight - 0.28 * CM : lidHeight - (bezel.top * CM) / 2,
    0.0022,
  );
  hinge.add(lens);

  if (profile.emblem === "ring") {
    const emblem = new Mesh(new RingGeometry(0.62 * CM, 0.74 * CM, 40), emblemMaterial);
    emblem.name = "lid-emblem";
    emblem.rotation.y = Math.PI;
    emblem.position.set(0, lidHeight / 2, -lidThickness - 0.0008);
    hinge.add(emblem);
  }

  let lidAngle = clampLidAngle(options.lidAngle ?? LAPTOP_LID_DEFAULT);
  const applyLid = () => {
    hinge.rotation.x = ((90 - lidAngle) * Math.PI) / 180;
  };
  applyLid();

  return {
    root,
    profile,
    width,
    depth,
    /** Height with the lid fully upright, for framing. */
    height: deckY + lidHeight,
    screenWidth,
    screenHeight,
    /** Screen centre in hinge space; the camera can aim here for push-ins. */
    screenCenter: () => display.getWorldPosition(new Vector3()),
    get lidAngle() {
      return lidAngle;
    },
    setLidAngle(degrees: number) {
      lidAngle = clampLidAngle(degrees);
      applyLid();
    },
    setTexture(next: Texture) {
      screenMaterial.map = next;
      screenMaterial.needsUpdate = true;
    },
    dispose() {
      root.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose();
      });
      keys.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

export type LaptopScene = ReturnType<typeof createLaptopScene>;
