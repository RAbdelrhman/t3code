import { Box3, Mesh, MeshBasicMaterial, Texture, Vector3 } from "three";
import { describe, expect, it } from "vite-plus/test";
import {
  clampLidAngle,
  createLaptopScene,
  LAPTOP_LID_MAX,
  LAPTOP_MODEL_IDS,
  LAPTOP_PROFILES,
} from "./laptopScene.ts";

const screenOf = (scene: ReturnType<typeof createLaptopScene>) => {
  let screen: Mesh | undefined;
  scene.root.traverse((object) => {
    if (object instanceof Mesh && object.name === "device-screen") screen = object;
  });
  return screen!;
};

describe("laptop models", () => {
  it.each(LAPTOP_MODEL_IDS)("%s matches its spec-sheet footprint and panel aspect", (id) => {
    const profile = LAPTOP_PROFILES[id];
    const scene = createLaptopScene(new Texture(), profile, { lidAngle: 0 });
    scene.root.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(scene.root);
    const size = bounds.getSize(new Vector3());
    // Closed, the footprint is the spec width x depth at 0.15 units per centimetre.
    expect(size.x).toBeCloseTo(profile.widthCm * 0.15, 1);
    expect(size.z).toBeCloseTo(profile.depthCm * 0.15, 1);
    expect(size.y).toBeCloseTo((profile.baseCm + profile.lidCm) * 0.15, 1);
    expect(scene.screenWidth / scene.screenHeight).toBeCloseTo(
      profile.panel[0] / profile.panel[1],
      5,
    );
    scene.dispose();
  });

  it("puts the live texture on exactly one device-screen mesh", () => {
    const texture = new Texture();
    const scene = createLaptopScene(texture, LAPTOP_PROFILES["macbook-pro-14"]);
    const screens: Mesh[] = [];
    scene.root.traverse((object) => {
      if (object instanceof Mesh && object.name === "device-screen") screens.push(object);
    });
    expect(screens).toHaveLength(1);
    expect((screens[0]!.material as MeshBasicMaterial).map).toBe(texture);
    const next = new Texture();
    scene.setTexture(next);
    expect((screens[0]!.material as MeshBasicMaterial).map).toBe(next);
    scene.dispose();
  });

  it("faces the screen down onto the keyboard when closed and toward the viewer when open", () => {
    const scene = createLaptopScene(new Texture(), LAPTOP_PROFILES["dell-xps-14"]);
    const screen = screenOf(scene);
    const normal = () => {
      scene.root.updateMatrixWorld(true);
      return new Vector3(0, 0, 1).transformDirection(screen.matrixWorld);
    };
    scene.setLidAngle(0);
    expect(normal().y).toBeCloseTo(-1);
    scene.setLidAngle(90);
    expect(normal().z).toBeCloseTo(1);
    scene.setLidAngle(120);
    // Tilted back: still facing the viewer, angled up.
    expect(normal().z).toBeGreaterThan(0.8);
    expect(normal().y).toBeGreaterThan(0.3);
    scene.dispose();
  });

  it("clamps the lid to its hinge range", () => {
    expect(clampLidAngle(-20)).toBe(0);
    expect(clampLidAngle(400)).toBe(LAPTOP_LID_MAX);
    expect(clampLidAngle(Number.NaN)).toBe(0);
  });

  it("gives the MacBook a notch and the XPS a flush lid emblem", () => {
    const names = (id: keyof typeof LAPTOP_PROFILES) => {
      const scene = createLaptopScene(new Texture(), LAPTOP_PROFILES[id]);
      const found = new Set<string>();
      scene.root.traverse((object) => found.add(object.name));
      scene.dispose();
      return found;
    };
    expect(names("macbook-pro-14").has("camera-notch")).toBe(true);
    expect(names("macbook-pro-14").has("touch-row")).toBe(false);
    expect(names("dell-xps-14").has("lid-emblem")).toBe(true);
    expect(names("dell-xps-14").has("touch-row")).toBe(true);
  });
});
