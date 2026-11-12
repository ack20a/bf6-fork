/**
 * First-Person Tactical Infantry & Combined-Arms Player Controller.
 * Supports both Desktop Keyboard/Mouse (PointerLock) and Mobile Multi-Touch Twin-Stick Controls!
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
  public isTouchMode = false;
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

  // Desktop Input tracking
  private keys = new Set<string>();
  private mouseLeft = false;
  private mouseRight = false;

  // Mobile Multi-Touch Twin-Stick State
  private joyTouchId: number | null = null;
  private joyOriginX = 0;
  private joyOriginY = 0;
  private joyX = 0; // -1 (left) .. +1 (right)
  private joyY = 0; // -1 (up/forward) .. +1 (down/back)
  private lookTouchId: number | null = null;
  private lookLastX = 0;
  private lookLastY = 0;
  private fireTouchId: number | null = null;
  private fireLastX = 0;
  private fireLastY = 0;

  private touchFirePrimary = false;
  private touchFireSecondary = false;
  private touchAdsToggled = false;
  private touchJumpQueued = false;
  private touchVehUp = false;

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
      1: this.buildSlot(
        1,
        "WPN_AssaultRifle_M5A3",
        "M5A3 TACTICAL CARBINE",
        30,
        150,
        780,
        1.85,
        new THREE.Vector3(0, -0.106, -0.22),
        new THREE.Vector3(0.145, -0.155, -0.27),
        54,
        assets
      ),
      2: this.buildSlot(
        2,
        "WPN_Launcher_RPG7V2",
        "RPG-7V2 ANTI-ARMOR",
        1,
        5,
        45,
        2.35,
        new THREE.Vector3(-0.035, -0.075, -0.22),
        new THREE.Vector3(0.16, -0.15, -0.24),
        56,
        assets
      ),
      3: this.buildSlot(
        3,
        "WPN_Sniper_M2010",
        "M2010 ESR .300WM",
        5,
        25,
        52,
        2.2,
        new THREE.Vector3(0, -0.095, -0.2),
        new THREE.Vector3(0.15, -0.16, -0.28),
        13.5,
        assets
      ),
      4: this.buildSlot(
        4,
        "GAD_C4_Detonator",
        "C4 BREACH PACK + CLACKER",
        3,
        3,
        120,
        1.0,
        new THREE.Vector3(0.12, -0.14, -0.26),
        new THREE.Vector3(0.14, -0.16, -0.28),
        70,
        assets
      ),
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
    this.detectInitialTouchMode();
    this.bindInputEvents();
    this.bindMobileTouchControls();
    this.physics.actors.push(this);
  }

  private detectInitialTouchMode(): void {
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const smallViewport = window.innerWidth <= 860 && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
    if (coarse || smallViewport) {
      this.enableTouchMode();
    }
  }

  public enableTouchMode(): void {
    if (this.isTouchMode) return;
    this.isTouchMode = true;
    document.body.classList.add("is-touch");
    document.getElementById("touch-ui")?.classList.remove("hidden");
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

    this.domElement.addEventListener("mousedown", (e) => {
      if (!this.deployed || this.isTouchMode) return;
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
      this.applyLookDelta(-e.movementX * sens, -e.movementY * sens);
    });
  }

  private applyLookDelta(dyaw: number, dpitch: number): void {
    if (this.activeVehicle) {
      this.activeVehicle.applyMouseLook(dyaw, dpitch);
    } else {
      this.yaw += dyaw;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dpitch, -1.46, 1.46);
    }
  }

  private bindMobileTouchControls(): void {
    // Auto-switch to Touch Mode on first touch anywhere
    window.addEventListener(
      "touchstart",
      () => {
        this.sfx.unlock();
        this.enableTouchMode();
      },
      { passive: true }
    );

    // Clickable/Tappable Weapon Slots 1..4 & Interaction Prompt
    for (const s of [1, 2, 3, 4] as const) {
      const slotBtn = document.getElementById(`slot-${s}`);
      slotBtn?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (this.deployed && !this.activeVehicle) {
          this.equipSlot(s);
        }
      });
    }

    const interactBtn = document.getElementById("interact-prompt");
    interactBtn?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!this.deployed) return;
      if (!this.isTouchMode && !this.isPointerLocked) {
        this.requestLock();
      } else if (this.nearbyVehicle || this.activeVehicle) {
        this.toggleVehicleEnterExit();
      }
    });

    // 1. Left Virtual Thumbstick (`#touch-joystick-zone`)
    const joyZone = document.getElementById("touch-joystick-zone");
    const joyBase = document.getElementById("touch-joystick-base");
    const joyStick = document.getElementById("touch-joystick-stick");
    const maxJoyRadius = 42;

    const updateStick = (clientX: number, clientY: number) => {
      const dx = clientX - this.joyOriginX;
      const dy = clientY - this.joyOriginY;
      const dist = Math.hypot(dx, dy);
      const clamped = Math.min(dist, maxJoyRadius);
      const nx = dist > 1e-3 ? dx / dist : 0;
      const ny = dist > 1e-3 ? dy / dist : 0;
      const sx = nx * clamped;
      const sy = ny * clamped;
      this.joyX = sx / maxJoyRadius;
      this.joyY = sy / maxJoyRadius;
      if (joyStick) {
        joyStick.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
      }
    };

    const resetStick = () => {
      this.joyTouchId = null;
      this.joyX = 0;
      this.joyY = 0;
      if (joyStick) {
        joyStick.style.transform = "translate3d(0px, 0px, 0)";
      }
    };

    joyZone?.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        if (this.joyTouchId !== null || !joyBase) return;
        const t = e.changedTouches[0];
        this.joyTouchId = t.identifier;
        const rect = joyBase.getBoundingClientRect();
        this.joyOriginX = rect.left + rect.width * 0.5;
        this.joyOriginY = rect.top + rect.height * 0.5;
        updateStick(t.clientX, t.clientY);
      },
      { passive: false }
    );

    joyZone?.addEventListener(
      "touchmove",
      (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === this.joyTouchId) {
            updateStick(t.clientX, t.clientY);
            break;
          }
        }
      },
      { passive: false }
    );

    const onJoyEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this.joyTouchId) {
          resetStick();
          break;
        }
      }
    };
    joyZone?.addEventListener("touchend", onJoyEnd);
    joyZone?.addEventListener("touchcancel", onJoyEnd);

    // 2. Right-Screen Touch Look Surface (`#touch-look-zone`)
    const lookZone = document.getElementById("touch-look-zone");
    const getTouchLookSens = () => (this.isScoped8x ? 0.0014 : this.adsBlend > 0.5 ? 0.003 : 0.0046);

    lookZone?.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        if (this.lookTouchId !== null) return;
        const t = e.changedTouches[0];
        this.lookTouchId = t.identifier;
        this.lookLastX = t.clientX;
        this.lookLastY = t.clientY;
      },
      { passive: false }
    );

    lookZone?.addEventListener(
      "touchmove",
      (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === this.lookTouchId) {
            const dx = t.clientX - this.lookLastX;
            const dy = t.clientY - this.lookLastY;
            this.lookLastX = t.clientX;
            this.lookLastY = t.clientY;
            const sens = getTouchLookSens();
            this.applyLookDelta(-dx * sens, -dy * sens);
            break;
          }
        }
      },
      { passive: false }
    );

    const onLookEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this.lookTouchId) {
          this.lookTouchId = null;
          break;
        }
      }
    };
    lookZone?.addEventListener("touchend", onLookEnd);
    lookZone?.addEventListener("touchcancel", onLookEnd);

    // 3. Infantry Fire Button (Supports Hold + Drag-to-Aim simultaneously!)
    const btnFire = document.getElementById("btn-touch-fire");
    btnFire?.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        this.fireTouchId = t.identifier;
        this.fireLastX = t.clientX;
        this.fireLastY = t.clientY;
        btnFire.classList.add("active-hold");
        if (this.activeSlot === 4) {
          this.throwC4Charge();
        } else {
          this.touchFirePrimary = true;
        }
      },
      { passive: false }
    );

    btnFire?.addEventListener(
      "touchmove",
      (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === this.fireTouchId) {
            const dx = t.clientX - this.fireLastX;
            const dy = t.clientY - this.fireLastY;
            this.fireLastX = t.clientX;
            this.fireLastY = t.clientY;
            const sens = getTouchLookSens() * 0.85;
            this.applyLookDelta(-dx * sens, -dy * sens);
            break;
          }
        }
      },
      { passive: false }
    );

    const onFireEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this.fireTouchId) {
          this.fireTouchId = null;
          this.touchFirePrimary = false;
          btnFire?.classList.remove("active-hold");
          break;
        }
      }
    };
    btnFire?.addEventListener("touchend", onFireEnd);
    btnFire?.addEventListener("touchcancel", onFireEnd);

    // 4. Infantry ADS / Detonate C4, Reload, Jump, Crouch, Enter Vehicle
    const btnAds = document.getElementById("btn-touch-ads");
    btnAds?.addEventListener("touchstart", (e) => {
      e.preventDefault();
      if (this.activeSlot === 4) {
        this.detonateC4Charges();
      } else {
        this.touchAdsToggled = !this.touchAdsToggled;
        btnAds.classList.toggle("toggled", this.touchAdsToggled);
      }
    });

    document.getElementById("btn-touch-reload")?.addEventListener("touchstart", (e) => {
      e.preventDefault();
      this.tryResupply(true);
      this.startReload();
    });

    document.getElementById("btn-touch-jump")?.addEventListener("touchstart", (e) => {
      e.preventDefault();
      this.touchJumpQueued = true;
    });

    const btnCrouch = document.getElementById("btn-touch-crouch");
    btnCrouch?.addEventListener("touchstart", (e) => {
      e.preventDefault();
      this.isCrouching = !this.isCrouching;
      btnCrouch.classList.toggle("toggled", this.isCrouching);
    });

    document.getElementById("btn-touch-enter")?.addEventListener("touchstart", (e) => {
      e.preventDefault();
      this.toggleVehicleEnterExit();
    });

    // 5. Vehicle Touch Buttons
    const bindHold = (id: string, onChange: (down: boolean) => void) => {
      const el = document.getElementById(id);
      el?.addEventListener(
        "touchstart",
        (e) => {
          e.preventDefault();
          el.classList.add("active-hold");
          onChange(true);
        },
        { passive: false }
      );
      const stop = () => {
        el?.classList.remove("active-hold");
        onChange(false);
      };
      el?.addEventListener("touchend", stop);
      el?.addEventListener("touchcancel", stop);
    };

    bindHold("btn-veh-fire1", (d) => (this.touchFirePrimary = d));
    bindHold("btn-veh-fire2", (d) => (this.touchFireSecondary = d));
    bindHold("btn-veh-up", (d) => (this.touchVehUp = d));

    document.getElementById("btn-veh-cam")?.addEventListener("touchstart", (e) => {
      e.preventDefault();
      this.vehicleThirdPerson = !this.vehicleThirdPerson;
    });

    document.getElementById("btn-veh-exit")?.addEventListener("touchstart", (e) => {
      e.preventDefault();
      this.exitVehicle();
    });
  }

  public requestLock(): void {
    this.sfx.unlock();
    if (this.isTouchMode) return;
    try {
      this.domElement.requestPointerLock?.();
    } catch {
      // Ignore on browsers that restrict pointer lock
    }
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
    this.touchAdsToggled = false;
    document.getElementById("btn-touch-ads")?.classList.remove("toggled");
    document.getElementById("btn-touch-crouch")?.classList.remove("toggled");

    for (const s of [1, 2, 3, 4] as const) {
      const w = this.slots[s];
      w.mag = w.maxMag;
      w.reserve = w.maxReserve;
      if (w.warheadMesh) w.warheadMesh.visible = true;
    }
    this.equipSlot(1);
    this.syncTouchVehicleMode();
    this.requestLock();
  }

  public equipSlot(slot: 1 | 2 | 3 | 4): void {
    if (this.activeSlot === slot && this.slots[slot].root.visible) return;
    this.isReloading = false;
    this.reloadTimer = 0;
    this.adsBlend = 0;
    this.touchAdsToggled = false;
    this.isScoped8x = false;

    const btnAds = document.getElementById("btn-touch-ads");
    const btnFire = document.getElementById("btn-touch-fire");
    if (btnAds) {
      btnAds.classList.remove("toggled");
      btnAds.textContent = slot === 4 ? "引爆" : "瞄准";
    }
    if (btnFire) {
      btnFire.textContent = slot === 4 ? "投C4" : "开火";
    }

    for (const s of [1, 2, 3, 4] as const) {
      const w = this.slots[s];
      w.root.visible = s === slot;
      if (w.magMesh) w.magMesh.position.y = w.magRestY;
    }
    this.activeSlot = slot;
    this.armsRig.visible = slot !== 4;
    this.sfx.playReloadClick();
  }

  private syncTouchVehicleMode(): void {
    const infCluster = document.getElementById("touch-infantry-btns");
    const vehCluster = document.getElementById("touch-vehicle-btns");
    const inVeh = Boolean(this.activeVehicle);
    infCluster?.classList.toggle("hidden", inVeh);
    vehCluster?.classList.toggle("hidden", !inVeh);
    this.touchFirePrimary = false;
    this.touchFireSecondary = false;
    this.touchVehUp = false;
  }

  public toggleVehicleEnterExit(): void {
    if (this.activeVehicle) {
      this.exitVehicle();
      return;
    }
    const v = this.vehicles.findEnterableVehicle(this.position, 5.2);
    if (v) {
      this.activeVehicle = v;
      v.driverId = "PLAYER";
      v.team = "NATO";
      this.viewmodelRoot.visible = false;
      this.isScoped8x = false;
      this.touchAdsToggled = false;
      this.mouseLeft = false;
      this.mouseRight = false;
      this.syncTouchVehicleMode();
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
    this.syncTouchVehicleMode();
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
    this.touchAdsToggled = false;
    document.getElementById("btn-touch-ads")?.classList.remove("toggled");
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

    const fireAct = this.armsActions.get("FPS_Fire_Recoil");
    if (fireAct) {
      fireAct.reset().setLoop(THREE.LoopOnce, 1).play();
    }
    if (w.boltMesh) {
      w.boltMesh.position.z = w.boltRestZ + 0.055;
    }

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
    const kbFwd = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
    const kbTurn = (this.keys.has("KeyA") ? 1 : 0) - (this.keys.has("KeyD") ? 1 : 0);
    const forward = THREE.MathUtils.clamp(kbFwd + -this.joyY, -1, 1);
    const turn = THREE.MathUtils.clamp(kbTurn + -this.joyX, -1, 1);
    return {
      forward,
      turn,
      up: this.keys.has("Space") || this.touchVehUp,
      firePrimary: this.mouseLeft || this.touchFirePrimary,
      fireSecondary: this.mouseRight || this.touchFireSecondary,
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
    document.getElementById("btn-touch-enter")?.classList.toggle("hidden", !this.nearbyVehicle);
    this.tryResupply(false);

    // 1. Infantry Movement (Keyboard WASD + Mobile Analog Joystick)
    const kbFwd = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
    const kbRight = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    const inFwd = THREE.MathUtils.clamp(kbFwd + -this.joyY, -1, 1);
    const inRight = THREE.MathUtils.clamp(kbRight + this.joyX, -1, 1);
    const joyMag = Math.min(1, Math.hypot(inFwd, inRight));

    const wantsAds = (this.mouseRight || this.touchAdsToggled) && !this.isReloading && this.activeSlot !== 4;
    const autoTouchSprint = this.isTouchMode && -this.joyY > 0.82 && joyMag > 0.86 && !this.touchFirePrimary;
    const wantsSprint = (this.keys.has("ShiftLeft") || autoTouchSprint) && inFwd > 0.3 && !wantsAds && !this.isReloading;
    this.isSprinting = wantsSprint;
    if (wantsSprint && this.isCrouching) {
      this.isCrouching = false;
      document.getElementById("btn-touch-crouch")?.classList.remove("toggled");
    }

    const fwdVec = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const rightVec = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const moveDir = new THREE.Vector3().addScaledVector(fwdVec, inFwd).addScaledVector(rightVec, inRight);
    if (moveDir.lengthSq() > 1.0) moveDir.normalize();

    const baseSpeed = this.isSprinting ? 7.3 : this.isCrouching ? 3.1 : this.adsBlend > 0.5 ? 3.5 : 5.1;
    this.velocity.x = moveDir.x * baseSpeed;
    this.velocity.z = moveDir.z * baseSpeed;

    if ((this.keys.has("Space") || this.touchJumpQueued) && this.grounded) {
      this.velocity.y = 7.4;
      this.grounded = false;
      this.isCrouching = false;
      document.getElementById("btn-touch-crouch")?.classList.remove("toggled");
    }
    this.touchJumpQueued = false;
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
    const wantsFire = this.mouseLeft || this.touchFirePrimary;

    if (this.isReloading) {
      this.reloadTimer -= dt;
      if (w.magMesh) {
        const phase = 1.0 - this.reloadTimer / w.reloadDuration;
        const drop = phase < 0.5 ? Math.sin(phase * Math.PI * 2) * 0.16 : 0;
        w.magMesh.position.y = w.magRestY - Math.max(0, drop);
      }
      if (this.reloadTimer <= 0) {
        this.finishReload();
      }
    } else if (wantsFire && this.fireCooldown <= 0 && this.activeSlot !== 4) {
      this.fireCurrentWeapon();
      if (this.activeSlot !== 1) {
        this.mouseLeft = false;
        this.touchFirePrimary = false;
      }
    }

    // 3. ADS Optic Interpolation & 8x Sniper Scope Toggle
    const targetAds = wantsAds ? 1.0 : 0.0;
    this.adsBlend = THREE.MathUtils.lerp(this.adsBlend, targetAds, Math.min(1, dt * 13));
    this.isScoped8x = this.activeSlot === 3 && this.adsBlend > 0.82;
    this.viewmodelRoot.visible = !this.isScoped8x;

    // Slightly wider base FOV in narrow portrait mobile screens so battlefield visibility stays generous
    const portraitBonus = this.camera.aspect < 0.85 ? 8 : 0;
    const baseFov = (this.isSprinting ? 80 : 74) + portraitBonus;
    const targetFov = THREE.MathUtils.lerp(baseFov, w.adsFov, this.adsBlend);
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
    // Slightly pull viewmodel inward on narrow portrait phones so rifle sight isn't clipped on the right edge
    if (this.camera.aspect < 0.85 && this.adsBlend < 0.5) {
      vmPos.x *= 0.62;
    }
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
