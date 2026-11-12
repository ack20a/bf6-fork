/**
 * Loads and caches all 29 Blender-exported .glb tactical assets.
 * Configures optical sight glass transparency, smart shadow culling,
 * SkinnedMesh frustum bounding spheres, and clean static/skinned cloning.
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

  // Shared crystal-clear reflex/holo lens & vehicle canopy materials
  private weaponOpticGlassMat = new THREE.MeshStandardMaterial({
    name: "MAT_Weapon_ClearOpticGlass",
    color: 0x9beeff,
    roughness: 0.05,
    metalness: 0.04,
    transparent: true,
    opacity: 0.05,
    depthWrite: false,
  });

  private vehicleCanopyGlassMat = new THREE.MeshStandardMaterial({
    name: "MAT_Vehicle_ClearCanopy",
    color: 0x263842,
    roughness: 0.08,
    metalness: 0.18,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });

  private weaponReticleRedMat = new THREE.MeshBasicMaterial({
    name: "MAT_Weapon_HoloReticleRed",
    color: 0xff2a1a,
  });

  public async loadAll(
    onProgress?: (loaded: number, total: number, key: string) => void,
    maxAnisotropy = 8
  ): Promise<void> {
    const entries = Object.entries(ASSET_MANIFEST);
    let done = 0;
    const total = entries.length;
    const aniso = Math.max(1, maxAnisotropy);

    await Promise.all(
      entries.map(async ([key, url]) => {
        const gltf = await this.loader.loadAsync(url);
        const isWeapon = key.startsWith("WPN_") || key.startsWith("GAD_");
        const isVehicle = key.startsWith("VEH_");
        const isFpsArms = key === "CHR_FPS_Arms_Rig";
        const isSoldier = key.startsWith("CHR_Soldier_");
        const isSmallProp =
          key === "BLD_Rubble_Pile" ||
          key === "COV_Tactical_Crate" ||
          key === "COV_Czech_Hedgehog" ||
          key === "BLD_Foundation_4x4";

        const tuneTexture = (tex: THREE.Texture | null | undefined) => {
          if (!tex) return;
          tex.anisotropy = aniso;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.needsUpdate = true;
        };

        gltf.scene.traverse((obj) => {
          if (!(obj as THREE.Mesh).isMesh) return;
          const mesh = obj as THREE.Mesh;

          // 1. Fix opaque MAT_Optic_ArmoredGlass on holographic sights, magazines & vehicle windshields,
          //    and enable high-anisotropy trilinear mipmapping + crisp normal/IBL response across all PBR maps!
          const remapMat = (m: THREE.Material): THREE.Material => {
            if (m.name.includes("Optic_ArmoredGlass")) {
              if (isWeapon) {
                // Magazine window stays semi-translucent smoked polymer; sight glass becomes crystal-clear!
                if (mesh.name.includes("Magazine")) {
                  const magGlass = this.vehicleCanopyGlassMat.clone();
                  magGlass.opacity = 0.42;
                  return magGlass;
                }
                return this.weaponOpticGlassMat;
              }
              if (isVehicle) {
                return this.vehicleCanopyGlassMat;
              }
            }
            if (isWeapon && m.name.includes("LED_Red") && mesh.name.includes("Optic")) {
              return this.weaponReticleRedMat;
            }

            const std = m as THREE.MeshStandardMaterial;
            if (std.isMeshStandardMaterial) {
              tuneTexture(std.map);
              tuneTexture(std.normalMap);
              tuneTexture(std.roughnessMap);
              tuneTexture(std.metalnessMap);
              tuneTexture(std.emissiveMap);
              tuneTexture(std.aoMap);

              if (isWeapon || isFpsArms) {
                std.envMapIntensity = 1.32;
                if (std.normalMap) std.normalScale.set(1.22, 1.22);
              } else if (isVehicle) {
                std.envMapIntensity = 1.2;
                if (std.normalMap) std.normalScale.set(1.15, 1.15);
              } else if (isSoldier) {
                std.envMapIntensity = 1.12;
                if (std.normalMap) std.normalScale.set(1.15, 1.15);
              } else {
                std.envMapIntensity = 1.08;
                if (std.normalMap) std.normalScale.set(1.18, 1.18);
              }
            }
            return m;
          };

          if (Array.isArray(mesh.material)) {
            mesh.material = mesh.material.map(remapMat);
          } else if (mesh.material) {
            mesh.material = remapMat(mesh.material);
          }

          // Render order on optic hood so transparent lens never occludes glowing reticle dot
          if (isWeapon && mesh.name.includes("Optic")) {
            mesh.renderOrder = 2;
          }

          // 2. Smart Shadow & Frustum Culling per asset class for high FPS
          if (isWeapon || isFpsArms) {
            mesh.castShadow = false;
            mesh.receiveShadow = false;
          } else if (isSmallProp) {
            mesh.castShadow = false;
            mesh.receiveShadow = key === "BLD_Foundation_4x4";
          } else if (isSoldier) {
            mesh.castShadow = true;
            mesh.receiveShadow = false;
          } else {
            mesh.castShadow = true;
            mesh.receiveShadow = key.includes("FloorSlab") || key.includes("Stairs");
          }

          if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
            if (isFpsArms) {
              mesh.frustumCulled = false;
            } else {
              // Generous local bounding sphere so off-screen AI soldiers are GPU frustum-culled!
              mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 2.2);
              mesh.frustumCulled = true;
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
    const isFpsArms = key === "CHR_FPS_Arms_Rig";
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
        const sm = o as THREE.SkinnedMesh;
        if (isFpsArms) {
          sm.frustumCulled = false;
          sm.castShadow = false;
          sm.receiveShadow = false;
        } else {
          if (!sm.geometry.boundingSphere) {
            sm.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 2.2);
          }
          sm.frustumCulled = true;
          sm.castShadow = true;
          sm.receiveShadow = false;
        }
      }
    });
    return { root, animations: gltf.animations };
  }
}
