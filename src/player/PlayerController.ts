/**
 * First-Person Tactical Infantry & Combined-Arms Player Controller.
 * Features:
 *  - Pointer-Lock Mouse Look, Sprint, Crouch, Jump, Stair-Stepping & Out-of-Combat HP Regen
 *  - Skinned `CHR_FPS_Arms_Rig` Viewmodel + 4 Tactical Loadout Slots:
 *      [1] M5A3 Assault Rifle (780 RPM, True 3D Holographic Sight ADS, Bolt Carrier Recoil)
 *      [2] RPG-7V2 Anti-Tank / Wall-Breaching Launcher (Visible Warhead Toggle, 520 Blast Damage)
 *      [3] M2010 ESR .300 WinMag Sniper (8.0x Ballistic Scope Overlay, One-Shot Infantry / Headshot Multiplier)
 *      [4] C4 Breach Pack + Tactical Clacker Detonator (Sticky Jeep/Tank/Wall C4 + Sequential Detonation)
 *  - Seamless [E] Enter/Exit for M1A2 AbramsX Tank, AH-6J Little Bird Helicopter & LATV4 4x4, [V] 1P/3P Camera
 */

import * as THREE from "three";
import type { AssetLibrary } from "../core/AssetLoader";
import type { SoundFX } from "../audio/SoundFX";
import type { CombatVehicle, VehicleInputState, VehicleManager } from "../entities/Vehicles";
import type { ConquestMap } from "../world/ConquestMap";
import type { DamageableActor, Team, WorldPhysics } from "../world/WorldPhysics";

export interface WeaponSlotState {
  slot: 1 | 2 | 3 | 4;
  id: string;
  displayName: string;
  mag: number;
  maxMag: number;
  reserve: number;
  maxReserve: number;
  rpm: number;
  reloadDuration: number;
  adsPos: THREE.Vector3;
  hipPos: THREE.Vector3;
  adsFov: number;
  root: THREE.Group;
  muzzleSocket?: THREE.Object3D;
  adsSocket?: THREE.Object3D;
  magMesh?: THREE.Object3D;
  boltMesh?: THREE.Object3D;
  warheadMesh?: THREE.Object3D;
  clackerMesh?: THREE.Object3D;
  magRestY: number;
  boltRestZ: number;
}

export class PlayerController implements DamageableActor {
  public readonly id = "PLAYER";
  public readonly team: Team = "NATO";

  public position = new THREE.Vector3(-8, 0.1, 48);
  public velocity = new THREE.Vector3();
  public yaw = 0;
  public pitch = 0;
  public hp = 100;
  public maxHp = 100;
  public damageFlash = 0;

  public activeSlot: 1 | 2 | 3 | 4 = 1;
  public slots: Record<1 | 2 | 3 | 4, WeaponSlotState>;
  public activeVehicle: CombatVehicle | null = null;
  public vehicleThirdPerson = true;
  public nearbyVehicle: CombatVehicle | null = null;
  public isPointerLocked = false;
  public isReloading = false;
  public isScoped8x = false;
  public isSprinting = false;
  public isCrouching = false;
  public deployed = false;

  private grounded = false;
  private adsBlend = 0;
  private fireCooldown = 0;
  private reloadTimer = 0;
  private regenDelay = 0;
  private resupplyCooldown = 0;
  private walkBobTime = 0;
  private recoilKickPos = 0;
  private recoilKickPitch = 0;
  private muzzleFlashTimer = 0;
  private clackerAnimTimer = 0;

  // Input tracking
  private keys = new Set<string>();
  private mouseLeft = false;
  private mouseRight = false;

  // Viewmodel rig & muzzle FX
  private viewmodelRoot = new THREE.Group();
  private armsRig: THREE.Object3D;
  private armsMixer: THREE.AnimationMixer;
  private armsActions = new Map<string, THREE.AnimationAction>();
  private muzzleFlashMesh: THREE.Mesh;
  private muzzleLight: THREE.PointLight;

  public onPlayerDeath?: () => void;

  constructor(
    public camera: THREE.PerspectiveCamera,
    private domElement: HTMLElement,
    assets: AssetLibrary,
    private physics: WorldPhysics,
    private vehicles: VehicleManager,
    private map: ConquestMap,
    private sfx: SoundFX
  ) {
    this.camera.rotation.order = "YXZ";
    this.camera.add(this.viewmodelRoot);

    // 1. First-Person Tactical Arms Rig (`CHR_FPS_Arms_Rig`)
    const { root: arms, animations } = assets.cloneSkinned("CHR_FPS_Arms_Rig");
    this.armsRig = arms;
    this.armsRig.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    this.viewmodelRoot.add(this.armsRig);
    this.armsMixer = new THREE.AnimationMixer(this.armsRig);
    for (const clip of animations) {
      this.armsActions.set(clip.name, this.armsMixer.clipAction(clip));
    }
    this.armsActions.get("FPS_Idle_Rifle")?.play();

    // 2. Build 4 Tactical Weapon Viewmodels
    this.slots = {
      1: this.buildSlot(1, "WPN_AssaultRifle_M5A3", "M5A3 TACTICAL CARBINE", 30, 150, 780, 1.85, new THREE.Vector3(0, -0.106, -0.22), new THREE.Vector3(0.145, -0.155, -0.27), 54, assets),
      2: this.buildSlot(2, "WPN_Launcher_RPG7V2", "RPG-7V2 ANTI-ARMOR", 1, 5, 45, 2.35, new THREE.Vector3(-0.035, -0.075, -0.22), new THREE.Vector3(0.16, -0.15, -0.24), 56, assets),
      3: this.buildSlot(3, "WPN_Sniper_M2010", "M2010 ESR .300WM", 5, 25, 52, 2.2, new THREE.Vector3(0, -0.095, -0.2), new THREE.Vector3(0.15, -0.16, -0.28), 13.5, assets),
      4: this.buildSlot(4, "GAD_C4_Detonator", "C4 BREACH PACK + CLACKER", 3, 3, 120, 1.0, new THREE.Vector3(0.12, -0.14, -0.26), new THREE.Vector3(0.14, -0.16, -0.28), 70, assets),
    };

    // Muzzle flash star & point light attached to viewmodelRoot
    const flashGeo = new THREE.SphereGeometry(0.048, 6, 6);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffcc55, transparent: true, opacity: 0.92 });
    this.muzzleFlashMesh = new THREE.Mesh(flashGeo, flashMat);
    this.muzzleFlashMesh.visible = false;
    this.viewmodelRoot.add(this.muzzleFlashMesh);

    this.muzzleLight = new THREE.PointLight(0xffaa33, 0, 5.5);
    this.viewmodelRoot.add(this.muzzleLight);

    this.equipSlot(1);
    this.bindInputEvents();
    this.physics.actors.push(this);
  }

  private buildSlot(
    slot: 1 | 2 | 3 | 4,
    assetKey: string,
    displayName: string,
    maxMag: number,
    maxReserve: number,
    rpm: number,
    reloadDuration: number,
    adsPos: THREE.Vector3,
    hipPos: THREE.Vector3,
    adsFov: number,
    assets: AssetLibrary
  ): WeaponSlotState {
    const root = assets.cloneStatic(assetKey);
    let muzzleSocket: THREE.Object3D | undefined;
    let adsSocket: THREE.Object3D | undefined;
    let magMesh: THREE.Object3D | undefined;
    let boltMesh: THREE.Object3D | undefined;
    let warheadMesh: THREE.Object3D | undefined;
    let clackerMesh: THREE.Object3D | undefined;

    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = false;
        o.frustumCulled = false;
      }
      if (o.name.includes("Socket_Muzzle")) muzzleSocket = o;
      if (o.name.includes("Socket_ADS")) adsSocket = o;
      if (o.name.includes("Magazine")) magMesh = o;
      if (o.name.includes("BoltCarrier") || o.name.includes("Bolt")) boltMesh = o;
      if (o.name.includes("Warhead") || o.name.includes("Rocket")) warheadMesh = o;
      if (o.name.includes("Clacker")) clackerMesh = o;
    });

    // Align ADS Y/X automatically from Socket_ADS if exported
    if (adsSocket && slot === 1) {
      adsPos.x = -adsSocket.position.x;
      adsPos.y = -adsSocket.position.y;
    }

    root.visible = false;
    this.viewmodelRoot.add(root);

    return {
      slot,
      id: assetKey,
      displayName,
      mag: maxMag,
      maxMag,
      reserve: maxReserve,
      maxReserve,
      rpm,
      reloadDuration,
      adsPos,
      hipPos,
      adsFov,
      root,
      muzzleSocket,
      adsSocket,
      magMesh,
      boltMesh,
      warheadMesh,
      clackerMesh,
      magRestY: magMesh ? magMesh.position.y : 0,
      boltRestZ: boltMesh ? boltMesh.position.z : 0,
    };
  }

  private bindInputEvents(): void {
    window.addEventListener("keydown", (e) => {
      if (!this.deployed) return;
      this.keys.add(e.code);

      if (!this.activeVehicle) {
        if (e.code === "Digit1") this.equipSlot(1);
        if (e.code === "Digit2") this.equipSlot(2);
        if (e.code === "Digit3") this.equipSlot(3);
        if (e.code === "Digit4") this.equipSlot(4);
        if (e.code === "KeyR") this.startReload();
        if (e.code === "KeyF") this.tryResupply(true);
        if (e.code === "KeyC") this.isCrouching = !this.isCrouching;
      }

      if (e.code === "KeyE") {
        this.toggleVehicleEnterExit();
      }
      if (e.code === "KeyV" && this.activeVehicle) {
        this.vehicleThirdPerson = !this.vehicleThirdPerson;
      }
    });

    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener("mousedown", (e) => {
      if (!this.deployed) return;
      if (!this.isPointerLocked) {
        this.requestLock();
        return;
      }
      if (e.button === 0) {
        this.mouseLeft = true;
        if (!this.activeVehicle && this.activeSlot === 4) {
          this.throwC4Charge();
        }
      } else if (e.button === 2) {
        this.mouseRight = true;
        if (!this.activeVehicle && this.activeSlot === 4) {
          this.detonateC4Charges();
        }
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseLeft = false;
      if (e.button === 2) this.mouseRight = false;
    });

    window.addEventListener("contextmenu", (e) => e.preventDefault());

    document.addEventListener("pointerlockchange", () => {
      this.isPointerLocked = document.pointerLockElement === this.domElement;
      if (!this.isPointerLocked) {
        this.mouseLeft = false;
        this.mouseRight = false;
        this.keys.clear();
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.isPointerLocked || !this.deployed) return;
      const sens = this.isScoped8x ? 0.00055 : this.adsBlend > 0.5 ? 0.0013 : 0.0021;
      const dyaw = -e.movementX * sens;
      const dpitch = -e.movementY * sens;

      if (this.activeVehicle) {
        this.activeVehicle.applyMouseLook(dyaw, dpitch);
      } else {
        this.yaw += dyaw;
        this.pitch = THREE.MathUtils.clamp(this.pitch + dpitch, -1.46, 1.46);
      }
    });
  }

  public requestLock(): void {
    this.sfx.unlock();
    this.domElement.requestPointerLock?.();
  }

  public spawnAt(pos: THREE.Vector3, lookYaw = 0): void {
    if (this.activeVehicle) {
      this.exitVehicle();
    }
    this.deployed = true;
    this.hp = this.maxHp;
    this.damageFlash = 0;
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.yaw = lookYaw;
    this.pitch = 0;
    this.isCrouching = false;

    // Refill full tactical ammo on fresh deployment
    for (const s of [1, 2, 3, 4] as const) {
      const w = this.slots[s];
      w.mag = w.maxMag;
      w.reserve = w.maxReserve;
      if (w.warheadMesh) w.warheadMesh.visible = true;
    }
    this.equipSlot(1);
    this.requestLock();
  }

  public equipSlot(slot: 1 | 2 | 3 | 4): void {
    if (this.activeSlot === slot && this.slots[slot].root.visible) return;
    this.isReloading = false;
    this.reloadTimer = 0;
    this.adsBlend = 0;
    this.isScoped8x = false;

    for (const s of [1, 2, 3, 4] as const) {
      const w = this.slots[s];
      w.root.visible = s === slot;
      if (w.magMesh) w.magMesh.position.y = w.magRestY;
    }
    this.activeSlot = slot;
    // Show tactical hands on rifles/launchers/clacker
    this.armsRig.visible = slot !== 4;
    this.sfx.playReloadClick();
  }

  private toggleVehicleEnterExit(): void {
    if (this.activeVehicle) {
      this.exitVehicle();
      return;
    }
    const v = this.vehicles.findEnterableVehicle(this.position, 5.2);
    if (v) {
      this.activeVehicle = v;
      v.driverId = "PLAYER";
      v.team = "NATO"; // Hijacking enemy PAX vehicle flips its IFF while piloted!
      this.viewmodelRoot.visible = false;
      this.isScoped8x = false;
      this.mouseLeft = false;
      this.mouseRight = false;
      this.sfx.playReloadClick();
    }
  }

  public exitVehicle(): void {
    if (!this.activeVehicle) return;
    const v = this.activeVehicle;
    v.driverId = null;
    const rightSide = new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw)).multiplyScalar(v.getHitRadius() + 1.1);
    this.position.copy(v.getPosition()).add(rightSide);
    this.position.y = Math.max(0.1, this.position.y);
    this.yaw = v.aimYaw;
    this.pitch = 0;
    this.velocity.set(0, 0, 0);
    this.activeVehicle = null;
    this.viewmodelRoot.visible = true;
  }

  public getActiveWeapon(): WeaponSlotState {
    return this.slots[this.activeSlot];
  }

  public getPosition(): THREE.Vector3 {
    return this.activeVehicle ? this.activeVehicle.getPosition() : this.position;
  }

  public getHitRadius(): number {
    return 0.4;
  }

  public getHeight(): number {
    return this.isCrouching ? 1.25 : 1.74;
  }

  public isAlive(): boolean {
    return this.hp > 0 && this.deployed;
  }

  public takeDamage(amount: number, _attackerTeam: Team, _weaponName: string): void {
    if (!this.deployed || this.hp <= 0) return;
    // If inside an armored vehicle, hull absorbs incoming fire until vehicle explodes!
    if (this.activeVehicle && this.activeVehicle.isAlive()) {
      return;
    }
    this.hp = Math.max(0, this.hp - amount);
    this.damageFlash = Math.min(1.0, this.damageFlash + 0.55);
    this.regenDelay = 5.0;
    this.physics.addCameraShake(0.16);

    if (this.hp <= 0) {
      this.deployed = false;
      this.map.ticketsNATO = Math.max(0, this.map.ticketsNATO - 1);
      if (document.pointerLockElement) {
        document.exitPointerLock?.();
      }
      this.onPlayerDeath?.();
    }
  }

  private startReload(): void {
    const w = this.getActiveWeapon();
    if (this.activeSlot === 4 || this.isReloading || w.mag >= w.maxMag || w.reserve <= 0) return;
    this.isReloading = true;
    this.reloadTimer = w.reloadDuration;
    this.isScoped8x = false;
    this.sfx.playReloadClick();

    const relAct = this.armsActions.get("FPS_Reload_Tactical");
    if (relAct) {
      relAct.reset().setLoop(THREE.LoopOnce, 1).play();
    }
  }

  private finishReload(): void {
    const w = this.getActiveWeapon();
    const needed = w.maxMag - w.mag;
    const take = Math.min(needed, w.reserve);
    w.mag += take;
    w.reserve -= take;
    this.isReloading = false;
    if (w.magMesh) w.magMesh.position.y = w.magRestY;
    if (w.warheadMesh && w.mag > 0) w.warheadMesh.visible = true;
    this.sfx.playReloadClick();
  }

  private tryResupply(manual: boolean): void {
    if (this.resupplyCooldown > 0) return;
    for (const cratePos of this.map.resupplyPositions) {
      if (cratePos.distanceTo(this.position) < 3.4) {
        let refilled = false;
        for (const s of [1, 2, 3, 4] as const) {
          const w = this.slots[s];
          if (w.reserve < w.maxReserve || (s === 4 && w.mag < w.maxMag)) {
            w.reserve = w.maxReserve;
            if (s === 4) w.mag = w.maxMag;
            refilled = true;
          }
        }
        if (refilled || manual) {
          this.resupplyCooldown = 2.0;
          this.sfx.playReloadClick();
          if (refilled) {
            this.physics.onPlayerScoreEvent?.("战术弹药箱补给完成 (RPG/C4 已满)", 15);
          }
        }
        return;
      }
    }
  }

  private throwC4Charge(): void {
    const w = this.slots[4];
    if (w.mag <= 0 || this.fireCooldown > 0) return;
    w.mag--;
    this.fireCooldown = 0.42;
    const aimDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    const origin = this.camera.position.clone().addScaledVector(aimDir, 0.35);
    this.physics.throwStickyC4(origin, aimDir);
    this.recoilKickPos = 0.04;
  }

  private detonateC4Charges(): void {
    this.clackerAnimTimer = 0.25;
    this.sfx.playC4Beep();
    const count = this.physics.detonateAllC4("NATO", "PLAYER");
    if (count === 0) {
      this.sfx.playReloadClick();
    }
  }

  private fireCurrentWeapon(): void {
    const w = this.getActiveWeapon();
    if (this.activeSlot === 4 || this.isReloading) return;
    if (w.mag <= 0) {
      this.startReload();
      return;
    }

    w.mag--;
    this.fireCooldown = 60.0 / w.rpm;

    // Play viewmodel recoil clip & bolt kick
    const fireAct = this.armsActions.get("FPS_Fire_Recoil");
    if (fireAct) {
      fireAct.reset().setLoop(THREE.LoopOnce, 1).play();
    }
    if (w.boltMesh) {
      w.boltMesh.position.z = w.boltRestZ + 0.055;
    }

    // Muzzle flash
    this.muzzleFlashTimer = 0.042;
    if (w.muzzleSocket) {
      const mPos = new THREE.Vector3();
      w.muzzleSocket.getWorldPosition(mPos);
      this.viewmodelRoot.worldToLocal(mPos);
      this.muzzleFlashMesh.position.copy(mPos);
      this.muzzleLight.position.copy(mPos);
    } else {
      this.muzzleFlashMesh.position.set(0.08, -0.08, -0.72);
    }
    this.muzzleFlashMesh.visible = true;
    this.muzzleFlashMesh.rotation.z = Math.random() * Math.PI;
    this.muzzleLight.intensity = 3.2;

    // True center-screen ballistic aim direction + subtle hipfire spread
    const aimDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    const spreadAmt = this.adsBlend > 0.75 ? 0.0018 : 0.018;
    const dir = aimDir
      .clone()
      .add(
        new THREE.Vector3(
          (Math.random() - 0.5) * spreadAmt,
          (Math.random() - 0.5) * spreadAmt,
          (Math.random() - 0.5) * spreadAmt
        )
      )
      .normalize();

    const origin = this.camera.position.clone().addScaledVector(aimDir, 0.35);

    if (this.activeSlot === 1) {
      // M5A3 Assault Rifle
      this.sfx.playRifleShot(1.0, 0.28);
      this.recoilKickPos = 0.022;
      this.recoilKickPitch = 0.011;
      this.pitch = Math.min(1.46, this.pitch + (0.005 + Math.random() * 0.004) * (this.adsBlend > 0.5 ? 0.65 : 1.0));
      this.yaw += (Math.random() - 0.5) * 0.004;
      this.physics.spawnProjectile({
        kind: "bullet",
        team: "NATO",
        ownerId: "PLAYER",
        weaponName: "M5A3",
        origin,
        direction: dir,
        speed: 175,
        damage: 34,
      });
    } else if (this.activeSlot === 2) {
      // RPG-7V2 Rocket Launcher (Breaches Concrete Wall Chunks & Destroys Tanks!)
      this.sfx.playRocketLaunch();
      if (w.warheadMesh) w.warheadMesh.visible = false;
      this.recoilKickPos = 0.065;
      this.recoilKickPitch = 0.045;
      this.physics.addCameraShake(0.28);
      this.physics.spawnProjectile({
        kind: "rpg",
        team: "NATO",
        ownerId: "PLAYER",
        weaponName: "RPG-7V2",
        origin: origin.addScaledVector(aimDir, 0.3),
        direction: dir,
        speed: 68,
        damage: 540,
        blastRadius: 5.5,
        gravity: 3.5,
      });
      if (w.reserve > 0) {
        setTimeout(() => {
          if (this.activeSlot === 2 && w.mag === 0 && !this.isReloading && this.deployed) {
            this.startReload();
          }
        }, 320);
      }
    } else if (this.activeSlot === 3) {
      // M2010 .300 WinMag Sniper Rifle
      this.sfx.playSniperShot();
      this.recoilKickPos = 0.055;
      this.recoilKickPitch = 0.038;
      this.pitch = Math.min(1.46, this.pitch + 0.022);
      this.physics.spawnProjectile({
        kind: "bullet",
        team: "NATO",
        ownerId: "PLAYER",
        weaponName: "M2010 ESR",
        origin,
        direction: dir,
        speed: 260,
        damage: 105,
        gravity: 1.4,
      });
    }

    if (w.mag === 0 && w.reserve > 0 && this.activeSlot !== 2) {
      setTimeout(() => {
        if (w.mag === 0 && !this.isReloading && this.deployed) this.startReload();
      }, 220);
    }
  }

  public buildVehicleInput(): VehicleInputState | null {
    if (!this.activeVehicle) return null;
    const forward = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
    const turn = (this.keys.has("KeyA") ? 1 : 0) - (this.keys.has("KeyD") ? 1 : 0);
    return {
      forward,
      turn,
      up: this.keys.has("Space"),
      firePrimary: this.mouseLeft,
      fireSecondary: this.mouseRight,
    };
  }

  public update(dt: number): void {
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);
    this.resupplyCooldown = Math.max(0, this.resupplyCooldown - dt);
    if (!this.deployed) return;

    // Out-of-combat Battlefield health regeneration
    if (this.regenDelay > 0) {
      this.regenDelay -= dt;
    } else if (this.hp < this.maxHp && this.hp > 0) {
      this.hp = Math.min(this.maxHp, this.hp + 14 * dt);
    }

    // Handle active vehicle camera & destruction ejection
    if (this.activeVehicle) {
      if (!this.activeVehicle.isAlive()) {
        this.exitVehicle();
        this.takeDamage(65, "PAX", "VEHICLE EXPLOSION");
        return;
      }
      this.nearbyVehicle = null;
      const camPos = new THREE.Vector3();
      const camQuat = new THREE.Quaternion();
      this.activeVehicle.computeCameraPose(this.vehicleThirdPerson, camPos, camQuat);

      const shake = this.physics.consumeCameraShake(dt);
      if (shake > 0.001) {
        camPos.add(
          new THREE.Vector3((Math.random() - 0.5) * shake * 0.4, (Math.random() - 0.5) * shake * 0.4, 0)
        );
      }
      this.camera.position.copy(camPos);
      this.camera.quaternion.copy(camQuat);
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, this.vehicleThirdPerson ? 76 : 62, dt * 10);
      this.camera.updateProjectionMatrix();
      return;
    }

    // Infantry proximity checks (vehicles & auto-resupply crates)
    this.nearbyVehicle = this.vehicles.findEnterableVehicle(this.position, 5.2);
    this.tryResupply(false);

    // 1. Infantry Movement (WASD + Sprint + Jump + Crouch)
    const inFwd = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
    const inRight = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    const wantsSprint = this.keys.has("ShiftLeft") && inFwd > 0 && !this.mouseRight && !this.isReloading;
    this.isSprinting = wantsSprint;
    if (wantsSprint) this.isCrouching = false;

    const fwdVec = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const rightVec = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const moveDir = new THREE.Vector3().addScaledVector(fwdVec, inFwd).addScaledVector(rightVec, inRight);
    if (moveDir.lengthSq() > 1e-4) moveDir.normalize();

    const baseSpeed = this.isSprinting ? 7.3 : this.isCrouching ? 3.1 : this.adsBlend > 0.5 ? 3.5 : 5.1;
    this.velocity.x = moveDir.x * baseSpeed;
    this.velocity.z = moveDir.z * baseSpeed;

    if (this.keys.has("Space") && this.grounded) {
      this.velocity.y = 7.4;
      this.grounded = false;
      this.isCrouching = false;
    }
    this.velocity.y -= 21.0 * dt;

    const colRes = this.physics.resolveCharacterMovement(
      this.position,
      this.velocity,
      dt,
      0.36,
      this.getHeight(),
      0.38
    );
    this.grounded = colRes.grounded;

    // 2. Reload & Weapon Firing
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    const w = this.getActiveWeapon();

    if (this.isReloading) {
      this.reloadTimer -= dt;
      // Animate detachable magazine drop & slap-in!
      if (w.magMesh) {
        const phase = 1.0 - this.reloadTimer / w.reloadDuration;
        const drop = phase < 0.5 ? Math.sin(phase * Math.PI * 2) * 0.16 : 0;
        w.magMesh.position.y = w.magRestY - Math.max(0, drop);
      }
      if (this.reloadTimer <= 0) {
        this.finishReload();
      }
    } else if (this.mouseLeft && this.fireCooldown <= 0 && this.activeSlot !== 4) {
      // Automatic fire on M5A3; single-shot trigger reset on RPG/Sniper still feels responsive with cooldown
      this.fireCurrentWeapon();
      if (this.activeSlot !== 1) {
        this.mouseLeft = false;
      }
    }

    // 3. ADS Optic Interpolation & 8x Sniper Scope Toggle
    const targetAds = this.mouseRight && !this.isReloading && this.activeSlot !== 4 ? 1.0 : 0.0;
    this.adsBlend = THREE.MathUtils.lerp(this.adsBlend, targetAds, Math.min(1, dt * 13));
    this.isScoped8x = this.activeSlot === 3 && this.adsBlend > 0.82;
    this.viewmodelRoot.visible = !this.isScoped8x;

    const targetFov = THREE.MathUtils.lerp(this.isSprinting ? 80 : 74, w.adsFov, this.adsBlend);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 14));
      this.camera.updateProjectionMatrix();
    }

    // 4. Camera Eye Height, Headbob & Blast Shake
    const targetEyeH = this.isCrouching ? 1.12 : 1.62;
    const curEyeH = THREE.MathUtils.lerp(this.camera.position.y - this.position.y, targetEyeH, Math.min(1, dt * 12));
    const horizSpd = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && horizSpd > 0.4) {
      this.walkBobTime += dt * (this.isSprinting ? 13.5 : 9.2);
    } else {
      this.walkBobTime += dt * 1.6;
    }

    const shake = this.physics.consumeCameraShake(dt);
    this.camera.position.set(
      this.position.x + (Math.random() - 0.5) * shake * 0.28,
      this.position.y + curEyeH + Math.sin(this.walkBobTime) * (horizSpd > 0.5 ? 0.024 : 0.004) * (1 - this.adsBlend * 0.8),
      this.position.z + (Math.random() - 0.5) * shake * 0.28
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    // 5. Viewmodel Sway, Sprint Tilt, Recoil Recovery & Bolt Return
    this.recoilKickPos = THREE.MathUtils.lerp(this.recoilKickPos, 0, Math.min(1, dt * 16));
    this.recoilKickPitch = THREE.MathUtils.lerp(this.recoilKickPitch, 0, Math.min(1, dt * 16));
    if (w.boltMesh) {
      w.boltMesh.position.z = THREE.MathUtils.lerp(w.boltMesh.position.z, w.boltRestZ, Math.min(1, dt * 22));
    }
    if (this.clackerAnimTimer > 0) {
      this.clackerAnimTimer -= dt;
      if (w.clackerMesh) w.clackerMesh.rotation.x = this.clackerAnimTimer > 0 ? -0.32 : 0;
    }

    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      if (this.muzzleFlashTimer <= 0) {
        this.muzzleFlashMesh.visible = false;
        this.muzzleLight.intensity = 0;
      }
    }

    const vmPos = new THREE.Vector3().lerpVectors(w.hipPos, w.adsPos, this.adsBlend);
    const bobAmp = horizSpd > 0.5 ? (1 - this.adsBlend * 0.88) * 0.012 : 0.002;
    vmPos.x += Math.cos(this.walkBobTime * 0.5) * bobAmp;
    vmPos.y += Math.abs(Math.sin(this.walkBobTime * 0.5)) * bobAmp - (this.isSprinting ? 0.035 : 0);
    vmPos.z += this.recoilKickPos;

    this.viewmodelRoot.position.copy(vmPos);
    const sprintPitch = this.isSprinting ? -0.22 : 0;
    const sprintYaw = this.isSprinting ? 0.34 : 0;
    this.viewmodelRoot.rotation.set(
      this.recoilKickPitch + sprintPitch,
      sprintYaw,
      this.isSprinting ? -0.14 : 0
    );

    this.armsMixer.update(dt);
  }
}
