/**
 * Builds the 3-Sector Battlefield Conquest Map ("Outpost Strike") using the 18 modular
 * Blender .glb environment prefabs, manages Conquest Capture Flags [A], [B], [C],
 * Ticket Bleed, and Resupply Crates.
 */

import * as THREE from "three";
import type { AssetLibrary } from "../core/AssetLoader";
import type { WorldPhysics, Team } from "./WorldPhysics";
import type { SoundFX } from "../audio/SoundFX";

export interface ConquestFlag {
  id: "A" | "B" | "C";
  name: string;
  position: THREE.Vector3;
  owner: Team;
  /** -1.0 = Full PAX, 0.0 = Neutral, +1.0 = Full NATO */
  progress: number;
  bannerMesh?: THREE.Object3D;
  capturingTeam: Team;
}

export class ConquestMap {
  public flags: ConquestFlag[] = [];
  public resupplyPositions: THREE.Vector3[] = [];
  public buildingFootprints: Array<{ x: number; z: number; w: number; d: number }> = [];
  public ticketsNATO = 300;
  public ticketsPAX = 300;
  private bleedTimer = 0;

  private bannerMatNATO = new THREE.MeshStandardMaterial({
    color: 0x00d8ff,
    emissive: 0x005577,
    roughness: 0.6,
  });
  private bannerMatPAX = new THREE.MeshStandardMaterial({
    color: 0xff4411,
    emissive: 0x661500,
    roughness: 0.6,
  });
  private bannerMatNeutral = new THREE.MeshStandardMaterial({
    color: 0x8899a6,
    roughness: 0.7,
  });

  constructor(
    private scene: THREE.Scene,
    private assets: AssetLibrary,
    private physics: WorldPhysics,
    private sfx: SoundFX
  ) {}

  public buildWorld(): void {
    // 1. Tactical Desert-Urban Ground Terrain & Asphalt Road Network
    const texCanvas = document.createElement("canvas");
    texCanvas.width = 256;
    texCanvas.height = 256;
    const ctx = texCanvas.getContext("2d")!;
    ctx.fillStyle = "#8a7b61";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3200; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? "rgba(65,55,40,0.22)" : "rgba(175,160,130,0.18)";
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
    }
    const gndTex = new THREE.CanvasTexture(texCanvas);
    gndTex.wrapS = gndTex.wrapT = THREE.RepeatWrapping;
    gndTex.repeat.set(45, 45);
    gndTex.colorSpace = THREE.SRGBColorSpace;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 220),
      new THREE.MeshStandardMaterial({ map: gndTex, roughness: 0.94, metalness: 0.0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Asphalt highway strips connecting HQ -> Alpha -> Bravo / Charlie
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x3b3f42, roughness: 0.86 });
    const mainRoad = new THREE.Mesh(new THREE.PlaneGeometry(11, 195), roadMat);
    mainRoad.rotation.x = -Math.PI / 2;
    mainRoad.position.set(-12, 0.015, 0);
    mainRoad.receiveShadow = true;
    this.scene.add(mainRoad);

    const crossRoad = new THREE.Mesh(new THREE.PlaneGeometry(165, 9.5), roadMat);
    crossRoad.rotation.x = -Math.PI / 2;
    crossRoad.position.set(0, 0.02, 12);
    crossRoad.receiveShadow = true;
    this.scene.add(crossRoad);

    // 2. SECTOR ALPHA (Center 0, 0): 2-Story Destructible Command Building + Fortifications
    this.buildTwoStoryCommandBuilding(0, 0);
    this.placeFlag("A", "ALPHA 指挥前哨站", new THREE.Vector3(-8.5, 0, 7.5), "NEUTRAL");
    this.placeEnv("COV_Sandbag_Wall_Curved", -8.5, 0, 10.2, 0);
    this.placeEnv("COV_Sandbag_Wall_Curved", -11.0, 0, 7.5, -90);
    this.placeResupplyCrate(-7.2, 8.8, 25);
    this.placeResupplyCrate(-2.2, 5.2, -10);

    this.placeEnv("COV_Hesco_Wall_3x", 7.2, 0, 6.8, -25);
    this.placeEnv("COV_Hesco_Single", 9.4, 0, 5.8, -25);
    this.placeEnv("COV_Hesco_Wall_3x", -9.2, 0, -2.0, 90);
    this.placeEnv("COV_Container_20ft_Olive", 11.2, 0, -2.5, 78);
    this.placeEnv("COV_Container_20ft_Blue", -15.8, 0, -5.5, -14);
    this.placeEnv("COV_Jersey_Barrier_3m", -3.5, 0, 11.2, 12);
    this.placeEnv("COV_Jersey_Barrier_3m", 1.2, 0, 11.6, -15);
    this.placeEnv("COV_Czech_Hedgehog", -12.0, 0, 15.2, 35);
    this.placeEnv("COV_Czech_Hedgehog", 5.5, 0, 12.2, 18);

    // 3. SECTOR BRAVO (East +42, +6): Container CQB Depot & Destructible Bunker
    this.buildSingleStoryBunker(44, -4);
    this.placeFlag("B", "BRAVO 集装箱货场", new THREE.Vector3(36, 0, 8), "PAX");
    this.placeEnv("COV_Container_20ft_Blue", 31.5, 0, 2.5, 12);
    this.placeEnv("COV_Container_20ft_Olive", 32.0, 0, 14.8, -8);
    this.placeEnv("COV_Container_20ft_Olive", 43.5, 0, 15.2, 85);
    this.placeEnv("COV_Hesco_Wall_3x", 36.0, 0, 11.5, 0);
    this.placeEnv("COV_Sandbag_Wall_Curved", 38.8, 0, 6.2, 110);
    this.placeEnv("COV_Jersey_Barrier_3m", 27.5, 0, 9.2, 75);
    this.placeResupplyCrate(37.2, 9.5, -40);
    this.buildingFootprints.push({ x: 44, z: -4, w: 8, d: 4 });

    // 4. SECTOR CHARLIE (West -42, -8): Forward Tactical Watchpost & Anti-Armor Roadblock
    this.buildSingleStoryBunker(-42, -12);
    this.placeFlag("C", "CHARLIE 公路检查站", new THREE.Vector3(-36, 0, -2), "NATO");
    this.placeEnv("COV_Hesco_Wall_3x", -36, 0, -6.5, 15);
    this.placeEnv("COV_Hesco_Wall_3x", -31.5, 0, 2.5, -75);
    this.placeEnv("COV_Jersey_Barrier_3m", -40.5, 0, 3.8, -22);
    this.placeEnv("COV_Jersey_Barrier_3m", -36.5, 0, 4.5, 18);
    this.placeEnv("COV_Czech_Hedgehog", -43.5, 0, 5.2, 40);
    this.placeEnv("COV_Czech_Hedgehog", -32.8, 0, 6.2, 12);
    this.placeEnv("COV_Container_20ft_Blue", -48.5, 0, -2.5, 92);
    this.placeEnv("COV_Sandbag_Wall_Curved", -35.8, 0, 1.2, 0);
    this.placeResupplyCrate(-34.5, -0.8, 15);
    this.buildingFootprints.push({ x: -42, z: -12, w: 8, d: 4 });

    // 5. NATO South Motor Pool HQ (Z = +56) & PAX North Base (Z = -56) Cover
    this.placeEnv("COV_Hesco_Wall_3x", -8, 0, 48, 0);
    this.placeEnv("COV_Hesco_Wall_3x", 8, 0, 48, 0);
    this.placeEnv("COV_Container_20ft_Olive", 15, 0, 55, 90);
    this.placeResupplyCrate(-3.5, 51, 0);

    this.placeEnv("COV_Hesco_Wall_3x", -8, 0, -48, 180);
    this.placeEnv("COV_Hesco_Wall_3x", 8, 0, -48, 180);
    this.placeEnv("COV_Container_20ft_Blue", -15, 0, -54, 90);
  }

  /**
   * Assemble a complete 2-story 8m x 8m destructible concrete command building at (cx, cz).
   * Note: Blender (X, Y, Z) -> glTF Three.js (X, Z, -Y), so South (-Y_blend) is +Z_three!
   */
  private buildTwoStoryCommandBuilding(cx: number, cz: number): void {
    this.buildingFootprints.push({ x: cx, z: cz, w: 8.4, d: 8.4 });

    for (const bx of [-2, 2]) {
      for (const bz of [-2, 2]) {
        this.placeEnv("BLD_Foundation_4x4", cx + bx, 0, cz + bz, 0);
      }
    }

    for (const yFlr of [0, 3.6]) {
      for (const px of [-4, 0, 4]) {
        for (const pz of [-4, 0, 4]) {
          this.placeEnv("BLD_Pillar_3m6", cx + px, yFlr, cz + pz, 0);
        }
      }
    }

    // 1st Floor Walls (Y = 0)
    // Front (+Z = +4): Left Doorway, Right Solid Wall (ready to be blasted open by RPG/Tank/C4!)
    this.placeEnv("BLD_Wall_Door_4m", cx - 2, 0, cz + 4, 0);
    this.placeEnv("BLD_Wall_Solid_4m", cx + 2, 0, cz + 4, 0, ["Chunk_02"]); // 1 pre-cracked peek hole!
    // Right (+X = +4)
    this.placeEnv("BLD_Wall_Window_4m", cx + 4, 0, cz + 2, 90);
    this.placeEnv("BLD_Wall_Window_4m", cx + 4, 0, cz - 2, 90);
    // Rear (-Z = -4)
    this.placeEnv("BLD_Wall_Door_4m", cx + 2, 0, cz - 4, 180);
    this.placeEnv("BLD_Wall_Solid_4m", cx - 2, 0, cz - 4, 180);
    // Left (-X = -4)
    this.placeEnv("BLD_Wall_Solid_4m", cx - 4, 0, cz - 2, -90);
    this.placeEnv("BLD_Wall_Window_4m", cx - 4, 0, cz + 2, -90);

    // Interior Staircase in NW bay (cx - 2, cz - 2.75) rising along +X onto (cx + 2, cz - 2) 2nd floor!
    this.placeEnv("BLD_Stairs_4m", cx - 2, 0, cz - 2.75, 0);
    this.placeEnv("BLD_Rubble_Pile", cx + 2.2, 0, cz + 4.7, 15);

    // 2nd Floor Slabs (Y = 3.60) — leave (cx - 2, cz - 2) open for stairwell headroom!
    this.placeEnv("BLD_FloorSlab_4x4", cx - 2, 3.6, cz + 2, 0);
    this.placeEnv("BLD_FloorSlab_4x4", cx + 2, 3.6, cz + 2, 0);
    this.placeEnv("BLD_FloorSlab_4x4", cx + 2, 3.6, cz - 2, 0);

    // 2nd Floor Perimeter Walls
    this.placeEnv("BLD_Wall_Window_4m", cx - 2, 3.6, cz + 4, 0);
    this.placeEnv("BLD_Wall_Window_4m", cx + 2, 3.6, cz + 4, 0);
    this.placeEnv("BLD_Wall_Solid_4m", cx + 4, 3.6, cz + 2, 90);
    this.placeEnv("BLD_Wall_Window_4m", cx + 4, 3.6, cz - 2, 90);
    this.placeEnv("BLD_Wall_Window_4m", cx + 2, 3.6, cz - 4, 180);
    this.placeEnv("BLD_Wall_Solid_4m", cx - 2, 3.6, cz - 4, 180);
    this.placeEnv("BLD_Wall_Solid_4m", cx - 4, 3.6, cz - 2, -90);
    this.placeEnv("BLD_Wall_Window_4m", cx - 4, 3.6, cz + 2, -90);

    // Roof Slabs & Destructible Parapets (Y = 7.20)
    for (const [bx, bz] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) {
      this.placeEnv("BLD_FloorSlab_4x4", cx + bx, 7.2, cz + bz, 0);
    }
    this.placeEnv("BLD_Roof_Parapet_4m", cx - 2, 7.2, cz + 4, 0);
    this.placeEnv("BLD_Roof_Parapet_4m", cx + 2, 7.2, cz + 4, 0);
    this.placeEnv("BLD_Roof_Parapet_4m", cx + 4, 7.2, cz + 2, 90);
    this.placeEnv("BLD_Roof_Parapet_4m", cx + 4, 7.2, cz - 2, 90);
  }

  private buildSingleStoryBunker(cx: number, cz: number): void {
    for (const bx of [-2, 2]) {
      this.placeEnv("BLD_Foundation_4x4", cx + bx, 0, cz, 0);
      this.placeEnv("BLD_FloorSlab_4x4", cx + bx, 3.6, cz, 0);
    }
    for (const px of [-4, 0, 4]) {
      for (const pz of [-2, 2]) {
        this.placeEnv("BLD_Pillar_3m6", cx + px, 0, cz + pz, 0);
      }
    }
    this.placeEnv("BLD_Wall_Door_4m", cx - 2, 0, cz + 2, 0);
    this.placeEnv("BLD_Wall_Window_4m", cx + 2, 0, cz + 2, 0);
    this.placeEnv("BLD_Wall_Window_4m", cx - 2, 0, cz - 2, 180);
    this.placeEnv("BLD_Wall_Solid_4m", cx + 2, 0, cz - 2, 180);
    this.placeEnv("BLD_Wall_Window_4m", cx + 4, 0, cz, 90);
    this.placeEnv("BLD_Wall_Solid_4m", cx - 4, 0, cz, -90);
    this.placeEnv("BLD_Roof_Parapet_4m", cx - 2, 3.6, cz + 2, 0);
    this.placeEnv("BLD_Roof_Parapet_4m", cx + 2, 3.6, cz + 2, 0);
  }

  private placeEnv(
    key: string,
    x: number,
    y: number,
    z: number,
    rotYDeg: number,
    preDestroySubstrings: string[] = []
  ): THREE.Group {
    const obj = this.assets.cloneStatic(key);
    obj.position.set(x, y, z);
    obj.rotation.y = THREE.MathUtils.degToRad(rotYDeg);
    if (preDestroySubstrings.length > 0) {
      obj.traverse((ch) => {
        if (preDestroySubstrings.some((s) => ch.name.includes(s))) {
          ch.visible = false;
        }
      });
    }
    this.scene.add(obj);
    this.physics.registerPrefabHierarchy(obj);
    return obj;
  }

  private placeResupplyCrate(x: number, z: number, rotYDeg: number): void {
    this.placeEnv("COV_Tactical_Crate", x, 0, z, rotYDeg);
    this.resupplyPositions.push(new THREE.Vector3(x, 0, z));
  }

  private placeFlag(id: "A" | "B" | "C", name: string, pos: THREE.Vector3, initialOwner: Team): void {
    const pole = this.placeEnv("OBJ_Conquest_Flagpole", pos.x, pos.y, pos.z, 0);
    let banner: THREE.Object3D | undefined;
    pole.traverse((o) => {
      if (o.name.includes("Banner")) {
        banner = o;
      }
    });

    const prog = initialOwner === "NATO" ? 1.0 : initialOwner === "PAX" ? -1.0 : 0.0;
    const flag: ConquestFlag = {
      id,
      name,
      position: pos.clone(),
      owner: initialOwner,
      progress: prog,
      bannerMesh: banner,
      capturingTeam: "NEUTRAL",
    };
    this.updateFlagVisuals(flag);
    this.flags.push(flag);
  }

  private updateFlagVisuals(f: ConquestFlag): void {
    if (!f.bannerMesh) return;
    const absProg = Math.abs(f.progress);
    f.bannerMesh.position.y = 1.65 + absProg * 3.9;
    const targetMat =
      f.progress > 0.15 ? this.bannerMatNATO : f.progress < -0.15 ? this.bannerMatPAX : this.bannerMatNeutral;
    f.bannerMesh.traverse((ch) => {
      if ((ch as THREE.Mesh).isMesh) {
        (ch as THREE.Mesh).material = targetMat;
      }
    });
  }

  public update(
    dt: number,
    unitPositions: Array<{ pos: THREE.Vector3; team: Team; isPlayer?: boolean }>,
    onPlayerCaptured?: (flag: ConquestFlag) => void
  ): ConquestFlag | null {
    const CAPTURE_RADIUS = 10.5;
    let playerActiveFlag: ConquestFlag | null = null;

    for (const f of this.flags) {
      let natoCount = 0;
      let paxCount = 0;
      let playerInside = false;

      for (const u of unitPositions) {
        const dx = u.pos.x - f.position.x;
        const dz = u.pos.z - f.position.z;
        if (dx * dx + dz * dz <= CAPTURE_RADIUS * CAPTURE_RADIUS && Math.abs(u.pos.y - f.position.y) < 5.0) {
          if (u.team === "NATO") natoCount++;
          else if (u.team === "PAX") paxCount++;
          if (u.isPlayer) playerInside = true;
        }
      }

      if (playerInside) playerActiveFlag = f;

      const diff = natoCount - paxCount;
      if (diff !== 0) {
        const rate = Math.min(3, Math.abs(diff)) * 0.16 * Math.sign(diff);
        const prevOwner = f.owner;
        f.progress = THREE.MathUtils.clamp(f.progress + rate * dt, -1.0, 1.0);
        f.capturingTeam = diff > 0 ? "NATO" : "PAX";

        if (f.progress >= 0.99 && prevOwner !== "NATO") {
          f.owner = "NATO";
          if (playerInside) {
            this.sfx.playFlagCaptured();
            onPlayerCaptured?.(f);
          }
        } else if (f.progress <= -0.99 && prevOwner !== "PAX") {
          f.owner = "PAX";
        } else if (Math.abs(f.progress) < 0.08) {
          f.owner = "NEUTRAL";
        }
        this.updateFlagVisuals(f);
      } else {
        f.capturingTeam = "NEUTRAL";
      }
    }

    // Conquest Ticket Bleed every 2.5 seconds when one faction holds majority flags
    this.bleedTimer += dt;
    if (this.bleedTimer >= 2.5) {
      this.bleedTimer = 0;
      const natoFlags = this.flags.filter((fl) => fl.owner === "NATO").length;
      const paxFlags = this.flags.filter((fl) => fl.owner === "PAX").length;
      if (natoFlags > paxFlags) {
        this.ticketsPAX = Math.max(0, this.ticketsPAX - (natoFlags - paxFlags));
      } else if (paxFlags > natoFlags) {
        this.ticketsNATO = Math.max(0, this.ticketsNATO - (paxFlags - natoFlags));
      }
    }

    return playerActiveFlag;
  }
}
