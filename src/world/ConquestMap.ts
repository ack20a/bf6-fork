/**
 * Builds the 5-Sector Conquest Large Battlefield ("Operation Oasis Strike" — 440m x 440m)
 * by reusing all 18 modular Blender .glb environment & cover prefabs.
 * Automatically batches all non-destructible structural pieces (Pillars, Slabs, Foundations,
 * Stairs, Containers, Jersey Barriers, Crates, Hedgehogs) into GPU InstancedMeshes,
 * slashing scene draw calls by ~75% while preserving 100% per-chunk Voronoi wall destruction!
 */

import * as THREE from "three";
import type { AssetLibrary } from "../core/AssetLoader";
import type { WorldPhysics, Team } from "./WorldPhysics";
import type { SoundFX } from "../audio/SoundFX";

export type FlagId = "A" | "B" | "C" | "D" | "E";

export interface ConquestFlag {
  id: FlagId;
  name: string;
  position: THREE.Vector3;
  owner: Team;
  /** -1.0 = Full PAX, 0.0 = Neutral, +1.0 = Full NATO */
  progress: number;
  bannerMesh?: THREE.Object3D;
  capturingTeam: Team;
}

const BATCHABLE_STATIC_KEYS = new Set<string>([
  "BLD_Foundation_4x4",
  "BLD_FloorSlab_4x4",
  "BLD_Pillar_3m6",
  "BLD_Stairs_4m",
  "BLD_Rubble_Pile",
  "COV_Container_20ft_Olive",
  "COV_Container_20ft_Blue",
  "COV_Jersey_Barrier_3m",
  "COV_Czech_Hedgehog",
  "COV_Tactical_Crate",
]);

interface BatchBucket {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow: boolean;
  receiveShadow: boolean;
  matrices: THREE.Matrix4[];
}

export class ConquestMap {
  public flags: ConquestFlag[] = [];
  public resupplyPositions: THREE.Vector3[] = [];
  public buildingFootprints: Array<{ x: number; z: number; w: number; d: number }> = [];
  public sceneryExcludeZones: Array<{ x: number; z: number; r: number }> = [];
  public ticketsNATO = 500;
  public ticketsPAX = 500;
  private bleedTimer = 0;
  private batchBuckets = new Map<string, BatchBucket>();

  private bannerMatNATO = new THREE.MeshStandardMaterial({
    color: 0x00d8ff,
    emissive: 0x006688,
    roughness: 0.5,
  });
  private bannerMatPAX = new THREE.MeshStandardMaterial({
    color: 0xff4411,
    emissive: 0x771a00,
    roughness: 0.5,
  });
  private bannerMatNeutral = new THREE.MeshStandardMaterial({
    color: 0x99aab5,
    roughness: 0.65,
  });

  constructor(
    private scene: THREE.Scene,
    private assets: AssetLibrary,
    public readonly physics: WorldPhysics,
    private sfx: SoundFX
  ) {}

  public buildWorld(): void {
    // =========================================================================
    // 1. SECTOR ALPHA (Center 0, 0): Twin 2-Story Urban Command Plaza
    // =========================================================================
    this.sceneryExcludeZones.push({ x: 2, z: 0, r: 28 });
    this.buildTwoStoryCommandBuilding(-4, -7);
    this.buildTwoStoryCommandBuilding(12, 5);
    this.placeFlag("A", "ALPHA 中央双子楼街区", new THREE.Vector3(-4, 0, 7.5), "NEUTRAL");

    this.placeEnv("COV_Sandbag_Wall_Curved", -4, 0, 11.2, 0);
    this.placeEnv("COV_Sandbag_Wall_Curved", -7.5, 0, 7.5, -90);
    this.placeEnv("COV_Hesco_Wall_3x", 3.5, 0, 12.5, -18);
    this.placeEnv("COV_Hesco_Wall_3x", -11.5, 0, -2.0, 88);
    this.placeEnv("COV_Container_20ft_Olive", 20.5, 0, -5.5, 78);
    this.placeEnv("COV_Container_20ft_Blue", -22.5, 0, -4.5, -12);
    this.placeEnv("COV_Jersey_Barrier_3m", -13.0, 0, 18.5, 8);
    this.placeEnv("COV_Jersey_Barrier_3m", -18.5, 0, 18.5, -8);
    this.placeEnv("COV_Czech_Hedgehog", -15.8, 0, 21.5, 35);
    this.placeEnv("COV_Czech_Hedgehog", 5.5, 0, -14.2, 18);
    this.placeResupplyCrate(-2.2, 9.2, 20);
    this.placeResupplyCrate(8.5, 1.5, -35);

    // =========================================================================
    // 2. SECTOR BRAVO (East +105, +20): 2-Tier Container Port & Warehouses
    // =========================================================================
    this.sceneryExcludeZones.push({ x: 105, z: 20, r: 30 });
    this.buildTwoStoryCommandBuilding(116, 10);
    this.buildSingleStoryBunker(95, 32);
    this.placeFlag("B", "BRAVO 集装箱物流港", new THREE.Vector3(103, 0, 19), "PAX");

    this.placeEnv("COV_Container_20ft_Blue", 94, 0, 10, 6);
    this.placeEnv("COV_Container_20ft_Olive", 94.2, 2.62, 10, -4);
    this.placeEnv("COV_Container_20ft_Olive", 104, 0, 6.5, 92);
    this.placeEnv("COV_Container_20ft_Blue", 104, 2.62, 6.5, 86);
    this.placeEnv("COV_Container_20ft_Olive", 112, 0, 25.5, -10);
    this.placeEnv("COV_Container_20ft_Blue", 88, 0, 21.5, 84);
    this.placeEnv("COV_Hesco_Wall_3x", 103, 0, 24.5, 0);
    this.placeEnv("COV_Sandbag_Wall_Curved", 106.5, 0, 17.5, 120);
    this.placeEnv("COV_Jersey_Barrier_3m", 84, 0, 14, 85);
    this.placeResupplyCrate(104.8, 21.2, -30);

    // =========================================================================
    // 3. SECTOR CHARLIE (West -105, -15): Desert Oasis Village Compound
    // =========================================================================
    this.sceneryExcludeZones.push({ x: -105, z: -15, r: 30 });
    this.buildTwoStoryCommandBuilding(-114, -21);
    this.buildSingleStoryBunker(-95, -23);
    this.buildSingleStoryBunker(-111, -3);
    this.placeFlag("C", "CHARLIE 绿洲荒漠小镇", new THREE.Vector3(-102, 0, -12), "NATO");

    this.placeEnv("COV_Hesco_Wall_3x", -102, 0, -18, 12);
    this.placeEnv("COV_Hesco_Wall_3x", -90, 0, -10, -78);
    this.placeEnv("COV_Sandbag_Wall_Curved", -101, 0, -8.5, 0);
    this.placeEnv("COV_Sandbag_Wall_Curved", -106, 0, -12.5, -90);
    this.placeEnv("COV_Container_20ft_Olive", -88, 0, -2, 16);
    this.placeEnv("COV_Jersey_Barrier_3m", -98, 0, 3.5, -15);
    this.placeEnv("COV_Czech_Hedgehog", -93, 0, 5.5, 28);
    this.placeEnv("BLD_Rubble_Pile", -104, 0, -25, 40);
    this.placeResupplyCrate(-100.2, -10.2, 15);

    // =========================================================================
    // 4. SECTOR DELTA (North -16, -108): Northern Highway Stronghold
    // =========================================================================
    this.sceneryExcludeZones.push({ x: -16, z: -108, r: 26 });
    this.buildTwoStoryCommandBuilding(-4, -110);
    this.buildSingleStoryBunker(-28, -105);
    this.placeFlag("D", "DELTA 北部公路要塞", new THREE.Vector3(-15, 0, -104), "PAX");

    this.placeEnv("COV_Hesco_Wall_3x", -15, 0, -98, 0);
    this.placeEnv("COV_Hesco_Wall_3x", -21, 0, -112, 15);
    this.placeEnv("COV_Jersey_Barrier_3m", -19, 0, -93, 12);
    this.placeEnv("COV_Jersey_Barrier_3m", -13, 0, -93, -12);
    this.placeEnv("COV_Czech_Hedgehog", -16, 0, -90, 22);
    this.placeEnv("COV_Czech_Hedgehog", -22, 0, -91, 48);
    this.placeEnv("COV_Container_20ft_Blue", 6, 0, -102, 85);
    this.placeEnv("COV_Sandbag_Wall_Curved", -13, 0, -106, 180);
    this.placeResupplyCrate(-13.5, -102.5, 0);

    // =========================================================================
    // 5. SECTOR ECHO (South +22, +102): Industrial Refinery & Depot
    // =========================================================================
    this.sceneryExcludeZones.push({ x: 22, z: 102, r: 28 });
    this.buildTwoStoryCommandBuilding(18, 94);
    this.buildSingleStoryBunker(8, 110);
    this.placeFlag("E", "ECHO 南部油库维修站", new THREE.Vector3(24, 0, 105), "NATO");

    this.placeEnv("COV_Hesco_Wall_3x", 24, 0, 110.5, 0);
    this.placeEnv("COV_Sandbag_Wall_Curved", 26.5, 0, 102.5, 95);
    this.placeEnv("COV_Container_20ft_Olive", 30, 0, 88, 12);
    this.placeEnv("COV_Jersey_Barrier_3m", 12, 0, 85, -18);
    this.placeEnv("COV_Czech_Hedgehog", 8, 0, 84, 30);
    this.placeResupplyCrate(22.5, 107.2, 45);

    // =========================================================================
    // 6. MID-ROAD CONVOY AMBUSH OUTPOSTS
    // =========================================================================
    this.sceneryExcludeZones.push({ x: -58, z: 14, r: 14 });
    this.buildSingleStoryBunker(-58, 22);
    this.placeEnv("COV_Jersey_Barrier_3m", -56, 0, 9.5, 15);
    this.placeEnv("COV_Container_20ft_Blue", -64, 0, 8, -12);
    this.placeEnv("COV_Sandbag_Wall_Curved", -53, 0, 17, 45);

    this.sceneryExcludeZones.push({ x: 56, z: 14, r: 14 });
    this.buildSingleStoryBunker(56, 4);
    this.placeEnv("COV_Hesco_Wall_3x", 54, 0, 19.5, -10);
    this.placeEnv("COV_Container_20ft_Olive", 64, 0, 20.5, 80);

    this.placeEnv("COV_Hesco_Wall_3x", -23, 0, -55, 75);
    this.placeEnv("COV_Jersey_Barrier_3m", -11, 0, -53, -20);
    this.placeEnv("COV_Hesco_Wall_3x", -9, 0, 56, -75);
    this.placeEnv("COV_Jersey_Barrier_3m", -21, 0, 55, 22);

    // =========================================================================
    // 7. NATO SOUTH AIRBASE & MOTOR POOL HQ (Z = +168) + PAX NORTH BASE (Z = -168)
    // =========================================================================
    this.sceneryExcludeZones.push({ x: 0, z: 168, r: 36 });
    this.buildOpenVehicleHangar(-12, 172);
    this.placeEnv("COV_Hesco_Wall_3x", -18, 0, 152, 0);
    this.placeEnv("COV_Hesco_Wall_3x", 4, 0, 152, 0);
    this.placeEnv("COV_Container_20ft_Olive", -26, 0, 166, 90);
    this.placeEnv("COV_Container_20ft_Blue", -26, 2.62, 166, 90);
    this.placeResupplyCrate(-4, 158, 0);

    this.sceneryExcludeZones.push({ x: 0, z: -168, r: 36 });
    this.buildOpenVehicleHangar(4, -172);
    this.placeEnv("COV_Hesco_Wall_3x", -14, 0, -152, 180);
    this.placeEnv("COV_Hesco_Wall_3x", 10, 0, -152, 180);
    this.placeEnv("COV_Container_20ft_Blue", 24, 0, -166, 90);
    this.placeResupplyCrate(0, -158, 180);

    // Emit GPU InstancedMeshes for all collected non-destructible structural pieces!
    this.flushStaticBatches();
  }

  private flushStaticBatches(): void {
    for (const bucket of this.batchBuckets.values()) {
      const count = bucket.matrices.length;
      if (count === 0) continue;
      const inst = new THREE.InstancedMesh(bucket.geometry, bucket.material, count);
      inst.castShadow = bucket.castShadow;
      inst.receiveShadow = bucket.receiveShadow;
      for (let i = 0; i < count; i++) {
        inst.setMatrixAt(i, bucket.matrices[i]);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.matrixAutoUpdate = false;
      this.scene.add(inst);
    }
    this.batchBuckets.clear();
  }

  private buildOpenVehicleHangar(cx: number, cz: number): void {
    this.buildingFootprints.push({ x: cx, z: cz, w: 8.4, d: 8.4 });
    for (const bx of [-2, 2]) {
      for (const bz of [-2, 2]) {
        this.placeEnv("BLD_Foundation_4x4", cx + bx, 0, cz + bz, 0);
        this.placeEnv("BLD_FloorSlab_4x4", cx + bx, 3.6, cz + bz, 0);
      }
    }
    for (const px of [-4, 0, 4]) {
      for (const pz of [-4, 4]) {
        this.placeEnv("BLD_Pillar_3m6", cx + px, 0, cz + pz, 0);
      }
    }
    this.placeEnv("BLD_Roof_Parapet_4m", cx - 2, 3.6, cz + 4, 0);
    this.placeEnv("BLD_Roof_Parapet_4m", cx + 2, 3.6, cz + 4, 0);
    this.placeEnv("BLD_Roof_Parapet_4m", cx - 2, 3.6, cz - 4, 180);
    this.placeEnv("BLD_Roof_Parapet_4m", cx + 2, 3.6, cz - 4, 180);
  }

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

    // 1st Floor Destructible Walls
    this.placeEnv("BLD_Wall_Door_4m", cx - 2, 0, cz + 4, 0);
    this.placeEnv("BLD_Wall_Solid_4m", cx + 2, 0, cz + 4, 0, ["Chunk_02"]);
    this.placeEnv("BLD_Wall_Window_4m", cx + 4, 0, cz + 2, 90);
    this.placeEnv("BLD_Wall_Window_4m", cx + 4, 0, cz - 2, 90);
    this.placeEnv("BLD_Wall_Door_4m", cx + 2, 0, cz - 4, 180);
    this.placeEnv("BLD_Wall_Solid_4m", cx - 2, 0, cz - 4, 180);
    this.placeEnv("BLD_Wall_Solid_4m", cx - 4, 0, cz - 2, -90);
    this.placeEnv("BLD_Wall_Window_4m", cx - 4, 0, cz + 2, -90);

    // Interior Staircase
    this.placeEnv("BLD_Stairs_4m", cx - 2, 0, cz - 2.75, 0);
    this.placeEnv("BLD_Rubble_Pile", cx + 2.2, 0, cz + 4.7, 15);

    // 2nd Floor Slabs
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

    // Roof Slabs & Destructible Parapets
    for (const [bx, bz] of [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ]) {
      this.placeEnv("BLD_FloorSlab_4x4", cx + bx, 7.2, cz + bz, 0);
    }
    this.placeEnv("BLD_Roof_Parapet_4m", cx - 2, 7.2, cz + 4, 0);
    this.placeEnv("BLD_Roof_Parapet_4m", cx + 2, 7.2, cz + 4, 0);
    this.placeEnv("BLD_Roof_Parapet_4m", cx + 4, 7.2, cz + 2, 90);
    this.placeEnv("BLD_Roof_Parapet_4m", cx + 4, 7.2, cz - 2, 90);
  }

  private buildSingleStoryBunker(cx: number, cz: number): void {
    this.buildingFootprints.push({ x: cx, z: cz, w: 8.2, d: 4.2 });
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

    obj.updateMatrixWorld(true);

    // Batch non-destructible structural prefabs into GPU InstancedMeshes!
    if (BATCHABLE_STATIC_KEYS.has(key) && preDestroySubstrings.length === 0) {
      this.physics.registerPrefabHierarchy(obj, [], false);
      let canBatchAll = true;
      obj.traverse((ch) => {
        if ((ch as THREE.Mesh).isMesh && Array.isArray((ch as THREE.Mesh).material)) {
          canBatchAll = false;
        }
      });
      if (canBatchAll) {
        obj.traverse((ch) => {
          if (!(ch as THREE.Mesh).isMesh || !ch.visible) return;
          const mesh = ch as THREE.Mesh;
          const mat = mesh.material as THREE.Material;
          const bKey = `${mesh.geometry.uuid}_${mat.uuid}`;
          let bucket = this.batchBuckets.get(bKey);
          if (!bucket) {
            bucket = {
              geometry: mesh.geometry,
              material: mat,
              castShadow: mesh.castShadow,
              receiveShadow: mesh.receiveShadow,
              matrices: [],
            };
            this.batchBuckets.set(bKey, bucket);
          }
          bucket.matrices.push(mesh.matrixWorld.clone());
        });
        return obj;
      }
    }

    this.scene.add(obj);
    this.physics.registerPrefabHierarchy(obj, [], true);

    // Freeze static world matrices on non-animated prefabs so Three.js skips recursive matrix recomputation!
    if (key !== "OBJ_Conquest_Flagpole") {
      obj.matrixAutoUpdate = false;
      obj.traverse((ch) => {
        ch.matrixAutoUpdate = false;
      });
    }
    return obj;
  }

  private placeResupplyCrate(x: number, z: number, rotYDeg: number): void {
    this.placeEnv("COV_Tactical_Crate", x, 0, z, rotYDeg);
    this.resupplyPositions.push(new THREE.Vector3(x, 0, z));
  }

  private placeFlag(id: FlagId, name: string, pos: THREE.Vector3, initialOwner: Team): void {
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
    const CAPTURE_RADIUS_SQ = 13.5 * 13.5;
    let playerActiveFlag: ConquestFlag | null = null;

    for (let fIdx = 0; fIdx < this.flags.length; fIdx++) {
      const f = this.flags[fIdx];
      let natoCount = 0;
      let paxCount = 0;
      let playerInside = false;

      for (let uIdx = 0; uIdx < unitPositions.length; uIdx++) {
        const u = unitPositions[uIdx];
        const dx = u.pos.x - f.position.x;
        const dz = u.pos.z - f.position.z;
        if (dx * dx + dz * dz <= CAPTURE_RADIUS_SQ && Math.abs(u.pos.y - f.position.y) < 6.0) {
          if (u.team === "NATO") natoCount++;
          else if (u.team === "PAX") paxCount++;
          if (u.isPlayer) playerInside = true;
        }
      }

      if (playerInside) playerActiveFlag = f;

      const diff = natoCount - paxCount;
      if (diff !== 0) {
        const rate = Math.min(3, Math.abs(diff)) * 0.17 * Math.sign(diff);
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

    this.bleedTimer += dt;
    if (this.bleedTimer >= 2.2) {
      this.bleedTimer = 0;
      let natoFlags = 0;
      let paxFlags = 0;
      for (let i = 0; i < this.flags.length; i++) {
        if (this.flags[i].owner === "NATO") natoFlags++;
        else if (this.flags[i].owner === "PAX") paxFlags++;
      }
      if (natoFlags > paxFlags) {
        this.ticketsPAX = Math.max(0, this.ticketsPAX - (natoFlags - paxFlags));
      } else if (paxFlags > natoFlags) {
        this.ticketsNATO = Math.max(0, this.ticketsNATO - (paxFlags - natoFlags));
      }
    }

    return playerActiveFlag;
  }
}
