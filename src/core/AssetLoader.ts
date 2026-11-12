/**
 * Loads and caches all 29 Blender-exported .glb tactical assets.
 * Supports clean static deep-cloning (preserving userData) and SkinnedMesh cloning via SkeletonUtils.
 */

import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

export const ASSET_MANIFEST: Record<string, string> = {
  // Modular Destructible Buildings (9)
  BLD_Foundation_4x4: "/models/env/BLD_Foundation_4x4.glb",
  BLD_FloorSlab_4x4: "/models/env/BLD_FloorSlab_4x4.glb",
  BLD_Pillar_3m6: "/models/env/BLD_Pillar_3m6.glb",
  BLD_Wall_Solid_4m: "/models/env/BLD_Wall_Solid_4m.glb",
  BLD_Wall_Window_4m: "/models/env/BLD_Wall_Window_4m.glb",
  BLD_Wall_Door_4m: "/models/env/BLD_Wall_Door_4m.glb",
  BLD_Stairs_4m: "/models/env/BLD_Stairs_4m.glb",
  BLD_Roof_Parapet_4m: "/models/env/BLD_Roof_Parapet_4m.glb",
  BLD_Rubble_Pile: "/models/env/BLD_Rubble_Pile.glb",

  // Military Cover & Conquest Objective (9)
  COV_Hesco_Single: "/models/env/COV_Hesco_Single.glb",
  COV_Hesco_Wall_3x: "/models/env/COV_Hesco_Wall_3x.glb",
  COV_Jersey_Barrier_3m: "/models/env/COV_Jersey_Barrier_3m.glb",
  COV_Sandbag_Wall_Curved: "/models/env/COV_Sandbag_Wall_Curved.glb",
  COV_Container_20ft_Olive: "/models/env/COV_Container_20ft_Olive.glb",
  COV_Container_20ft_Blue: "/models/env/COV_Container_20ft_Blue.glb",
  COV_Czech_Hedgehog: "/models/env/COV_Czech_Hedgehog.glb",
  COV_Tactical_Crate: "/models/env/COV_Tactical_Crate.glb",
  OBJ_Conquest_Flagpole: "/models/env/OBJ_Conquest_Flagpole.glb",

  // Weapons & Demolition (5)
  WPN_AssaultRifle_M5A3: "/models/weapons/WPN_AssaultRifle_M5A3.glb",
  WPN_Launcher_RPG7V2: "/models/weapons/WPN_Launcher_RPG7V2.glb",
  WPN_Sniper_M2010: "/models/weapons/WPN_Sniper_M2010.glb",
  GAD_C4_BreachPack: "/models/weapons/GAD_C4_BreachPack.glb",
  GAD_C4_Detonator: "/models/weapons/GAD_C4_Detonator.glb",

  // Land & Air Vehicles (3)
  VEH_MBT_AbramsX: "/models/vehicles/VEH_MBT_AbramsX.glb",
  VEH_Heli_LittleBird_AH6: "/models/vehicles/VEH_Heli_LittleBird_AH6.glb",
  VEH_Buggy_LATV4: "/models/vehicles/VEH_Buggy_LATV4.glb",

  // Skinned Character Rigs & FPS Viewmodel Arms (3)
  CHR_Soldier_NATO_Assault: "/models/characters/CHR_Soldier_NATO_Assault.glb",
  CHR_Soldier_PAX_OpFor: "/models/characters/CHR_Soldier_PAX_OpFor.glb",
  CHR_FPS_Arms_Rig: "/models/characters/CHR_FPS_Arms_Rig.glb",
};

export class AssetLibrary {
  private cache = new Map<string, GLTF>();
  private loader = new GLTFLoader();

  public async loadAll(onProgress?: (loaded: number, total: number, key: string) => void): Promise<void> {
    const entries = Object.entries(ASSET_MANIFEST);
    let done = 0;
    const total = entries.length;

    await Promise.all(
      entries.map(async ([key, url]) => {
        const gltf = await this.loader.loadAsync(url);
        gltf.scene.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const mesh = obj as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            // Prevent aggressive frustum culling on SkinnedMesh limbs
            if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
              mesh.frustumCulled = false;
            }
          }
        });
        this.cache.set(key, gltf);
        done++;
        onProgress?.(done, total, key);
      })
    );
  }

  public getGLTF(key: string): GLTF {
    const g = this.cache.get(key);
    if (!g) throw new Error(`Missing asset: ${key}`);
    return g;
  }

  public cloneStatic(key: string): THREE.Group {
    const src = this.getGLTF(key).scene;
    const cloned = src.clone(true);
    // Deep-copy userData so per-instance HP/state never mutates shared prototype
    const syncUserData = (a: THREE.Object3D, b: THREE.Object3D) => {
      b.userData = { ...a.userData };
      for (let i = 0; i < a.children.length; i++) {
        if (b.children[i]) syncUserData(a.children[i], b.children[i]);
      }
    };
    syncUserData(src, cloned);
    return cloned;
  }

  public cloneSkinned(key: string): { root: THREE.Object3D; animations: THREE.AnimationClip[] } {
    const gltf = this.getGLTF(key);
    const root = SkeletonUtils.clone(gltf.scene);
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
        o.frustumCulled = false;
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return { root, animations: gltf.animations };
  }
}
