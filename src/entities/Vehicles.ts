/**
 * Battlefield Combined-Arms Vehicle Simulation:
 *   1. M1A2 AbramsX Main Battle Tank (Hull + 360° Turret + Elevating 120mm Cannon + CROWS HMG + Enemy AI Tank)
 *   2. AH-6J Little Bird Scout/Attack Helicopter (Cyclic Pitch/Roll, Collective Lift, Spinning Rotors, Miniguns + Hydra Rockets)
 *   3. LATV4 Tactical 4x4 Recon Buggy (Steerable/Spinning Wheels + 360° Roof .50 Cal HMG)
 */

import * as THREE from "three";
import type { AssetLibrary } from "../core/AssetLoader";
import type { SoundFX } from "../audio/SoundFX";
import type { ColliderBox, DamageableActor, Team, WorldPhysics } from "../world/WorldPhysics";

export type VehicleKind = "mbt" | "heli" | "latv";

export interface VehicleInputState {
  forward: number; // -1..+1 (W/S)
  turn: number; // -1..+1 (A = +1 left, D = -1 right)
  up: boolean; // Space (Heli hover/climb or handbrake)
  firePrimary: boolean;
  fireSecondary: boolean;
}

export class CombatVehicle implements DamageableActor {
  public id: string;
  public displayName: string;
  public kind: VehicleKind;
  public team: Team;
  public spawnTeam: Team;

  public root: THREE.Group;
  public hp: number;
  public maxHp: number;
  public driverId: string | null = null;

  public yaw = 0;
  public pitch = 0;
  public roll = 0;
  public aimYaw = 0;
  public aimPitch = 0;
  public velocity = new THREE.Vector3();
  public speedKmh = 0;

  private spawnPos: THREE.Vector3;
  private spawnYaw: number;
  private respawnTimer = 0;
  private primaryCooldown = 0;
  private secondaryCooldown = 0;
  private hydraPodAmmo = 8;
  private hydraReloadTimer = 0;
  private toggleBarrel = false;
  private wheelSpin = 0;
  private aiBurstTimer = 2.0;

  // Articulated sub-parts & sockets
  private hullMesh?: THREE.Object3D;
  private turretObj?: THREE.Object3D;
  private cannonObj?: THREE.Object3D;
  private rwsObj?: THREE.Object3D;
  private rotorMain?: THREE.Object3D;
  private rotorTail?: THREE.Object3D;
  private wheelFL?: THREE.Object3D;
  private wheelFR?: THREE.Object3D;
  private wheelRL?: THREE.Object3D;
  private wheelRR?: THREE.Object3D;

  private sockTankMuzzle?: THREE.Object3D;
  private sockRwsMuzzle?: THREE.Object3D;
  private sockMinigunL?: THREE.Object3D;
  private sockMinigunR?: THREE.Object3D;
  private sockPodL?: THREE.Object3D;
  private sockPodR?: THREE.Object3D;
  private sockHmgMuzzle?: THREE.Object3D;

  private shadowMeshes: THREE.Mesh[] = [];
  private shadowLodActive = true;
  private stickyCol: ColliderBox;

  constructor(
    opts: {
      id: string;
      displayName: string;
      kind: VehicleKind;
      team: Team;
      position: THREE.Vector3;
      yaw: number;
    },
    private scene: THREE.Scene,
    assets: AssetLibrary,
    private physics: WorldPhysics,
    private sfx: SoundFX
  ) {
    this.id = opts.id;
    this.displayName = opts.displayName;
    this.kind = opts.kind;
    this.team = opts.team;
    this.spawnTeam = opts.team;
    this.spawnPos = opts.position.clone();
    this.spawnYaw = opts.yaw;
    this.yaw = opts.yaw;
    this.aimYaw = opts.yaw;

    this.maxHp = opts.kind === "mbt" ? 1500 : opts.kind === "heli" ? 700 : 550;
    this.hp = this.maxHp;

    const assetKey =
      opts.kind === "mbt"
        ? "VEH_MBT_AbramsX"
        : opts.kind === "heli"
        ? "VEH_Heli_LittleBird_AH6"
        : "VEH_Buggy_LATV4";

    this.root = assets.cloneStatic(assetKey);
    this.root.rotation.order = "YXZ";
    this.root.position.copy(this.spawnPos);
    this.root.rotation.y = this.yaw;
    this.scene.add(this.root);

    // Cache articulated parts, shadow-casting meshes & muzzle sockets
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).castShadow) {
        this.shadowMeshes.push(o as THREE.Mesh);
      }
      if (o.name.includes("VEH_MBT_Hull") || o.name.includes("VEH_Heli_Fuselage") || o.name.includes("VEH_LATV4_Chassis")) {
        this.hullMesh = o;
      }
      if (o.name.includes("VEH_MBT_Turret") || o.name.includes("VEH_LATV4_RoofTurret")) this.turretObj = o;
      if (o.name.includes("VEH_MBT_Cannon120mm")) this.cannonObj = o;
      if (o.name.includes("VEH_MBT_CROWS_RWS")) this.rwsObj = o;
      if (o.name.includes("VEH_Heli_RotorMain")) this.rotorMain = o;
      if (o.name.includes("VEH_Heli_RotorTail")) this.rotorTail = o;
      if (o.name.includes("VEH_LATV4_Wheel_FL")) {
        o.rotation.order = "YXZ";
        this.wheelFL = o;
      }
      if (o.name.includes("VEH_LATV4_Wheel_FR")) {
        o.rotation.order = "YXZ";
        this.wheelFR = o;
      }
      if (o.name.includes("VEH_LATV4_Wheel_RL")) this.wheelRL = o;
      if (o.name.includes("VEH_LATV4_Wheel_RR")) this.wheelRR = o;

      if (o.name.includes("Socket_TankMuzzle")) this.sockTankMuzzle = o;
      if (o.name.includes("Socket_RWS_Muzzle")) this.sockRwsMuzzle = o;
      if (o.name.includes("Socket_Minigun_L")) this.sockMinigunL = o;
      if (o.name.includes("Socket_Minigun_R")) this.sockMinigunR = o;
      if (o.name.includes("Socket_RocketPod_L")) this.sockPodL = o;
      if (o.name.includes("Socket_RocketPod_R")) this.sockPodR = o;
      if (o.name.includes("Socket_HMG_Muzzle")) this.sockHmgMuzzle = o;
    });

    // Inner box collider so Sticky C4 attaches cleanly to moving hull while outer Actor hitbox takes projectile hits first
    this.stickyCol = {
      id: 90000 + Math.floor(Math.random() * 9000),
      box: new THREE.Box3(),
      mesh: this.hullMesh ?? this.root,
      destructible: false,
      hp: 999999,
      maxHp: 999999,
      destroyed: false,
    };
    this.updateStickyCollider();
    this.physics.addDynamicCollider(this.stickyCol);
    this.physics.actors.push(this);
  }

  private updateStickyCollider(): void {
    const p = this.root.position;
    const r = this.getHitRadius() * 0.72;
    const h = this.getHeight() * 0.82;
    this.stickyCol.box.min.set(p.x - r, p.y + 0.15, p.z - r);
    this.stickyCol.box.max.set(p.x + r, p.y + h, p.z + r);
  }

  public getPosition(): THREE.Vector3 {
    return this.root.position;
  }

  public getHitRadius(): number {
    return this.kind === "mbt" ? 2.35 : this.kind === "heli" ? 1.75 : 1.65;
  }

  public getHeight(): number {
    return this.kind === "mbt" ? 2.65 : this.kind === "heli" ? 2.45 : 2.25;
  }

  public isAlive(): boolean {
    return this.hp > 0;
  }

  public takeDamage(amount: number, attackerTeam: Team, weaponName: string): void {
    if (!this.isAlive()) return;
    // Small arms do reduced chip damage to heavy MBT armor, full damage to light vehicles
    let scale = 1.0;
    const isHeavyWeapon =
      weaponName.includes("RPG") ||
      weaponName.includes("C4") ||
      weaponName.includes("120MM") ||
      weaponName.includes("HYDRA") ||
      weaponName.includes(".50");
    if (this.kind === "mbt" && !isHeavyWeapon) {
      scale = 0.08;
    } else if (!isHeavyWeapon) {
      scale = 0.45;
    }

    const eff = Math.max(1, Math.round(amount * scale));
    this.hp = Math.max(0, this.hp - eff);

    if (this.hp <= 0) {
      this.destroyVehicle(attackerTeam);
    }
  }

  private destroyVehicle(attackerTeam: Team): void {
    const blastPos = this.root.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    this.root.visible = false;
    this.stickyCol.destroyed = true;
    this.respawnTimer = 20.0;
    this.velocity.set(0, 0, 0);

    // Secondary catastrophic ammo cook-off explosion
    this.sfx.playExplosion(1.45);
    if (attackerTeam === "NATO" && this.team === "PAX") {
      this.physics.onPlayerScoreEvent?.(`摧毁敌方重型载具 [${this.displayName}]`, 250);
    }
    // Note: if player was inside, PlayerController checks !activeVehicle.isAlive() and ejects/damages player
    this.driverId = null;
    void blastPos;
  }

  private respawn(): void {
    this.hp = this.maxHp;
    this.team = this.spawnTeam;
    this.driverId = null;
    this.yaw = this.spawnYaw;
    this.aimYaw = this.spawnYaw;
    this.pitch = 0;
    this.roll = 0;
    this.aimPitch = 0;
    this.velocity.set(0, 0, 0);
    this.root.position.copy(this.spawnPos);
    this.root.rotation.set(0, this.yaw, 0);
    this.root.visible = true;
    this.stickyCol.destroyed = false;
    this.updateStickyCollider();
  }

  public applyMouseLook(dyaw: number, dpitch: number): void {
    if (this.kind === "heli") {
      // Cyclic pitch & roll control on mouse for agile Little Bird flight!
      this.pitch = THREE.MathUtils.clamp(this.pitch + dpitch * 0.85, -0.46, 0.42);
      this.roll = THREE.MathUtils.clamp(this.roll + dyaw * 0.95, -0.56, 0.56);
    } else {
      this.aimYaw += dyaw;
      const maxUp = this.kind === "mbt" ? 0.36 : 0.48;
      const maxDown = this.kind === "mbt" ? -0.16 : -0.25;
      this.aimPitch = THREE.MathUtils.clamp(this.aimPitch + dpitch, maxDown, maxUp);
    }
  }

  public update(dt: number, input: VehicleInputState | null, playerPosForAI?: THREE.Vector3): void {
    if (!this.isAlive()) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.respawn();
      }
      return;
    }

    this.primaryCooldown = Math.max(0, this.primaryCooldown - dt);
    this.secondaryCooldown = Math.max(0, this.secondaryCooldown - dt);
    if (this.hydraReloadTimer > 0) {
      this.hydraReloadTimer -= dt;
      if (this.hydraReloadTimer <= 0) this.hydraPodAmmo = 8;
    }

    // Distance-based Shadow & Matrix LOD (hysteresis at 90m..98m so shadows stay crisp near player & free GPU far away)
    const distSq = playerPosForAI ? this.root.position.distanceToSquared(playerPosForAI) : 0;
    const wantShadows = this.driverId === "PLAYER" || distSq < 90 * 90;
    const dropShadows = this.driverId !== "PLAYER" && distSq > 98 * 98;
    if (wantShadows && !this.shadowLodActive) {
      this.shadowLodActive = true;
      for (let i = 0; i < this.shadowMeshes.length; i++) this.shadowMeshes[i].castShadow = true;
    } else if (dropShadows && this.shadowLodActive) {
      this.shadowLodActive = false;
      for (let i = 0; i < this.shadowMeshes.length; i++) this.shadowMeshes[i].castShadow = false;
    }

    let needsWorldSync = true;
    if (this.driverId === "PLAYER" && input) {
      if (this.kind === "heli") {
        this.updateHeliFlight(dt, input);
      } else {
        this.updateGroundDrive(dt, input);
      }
    } else {
      // Idle / Unmanned damping or Autonomous Enemy PAX Tank / Patrol Turret
      if (this.kind === "heli") {
        if (this.root.position.y > 0.02) {
          this.velocity.y -= 9.8 * dt;
          this.root.position.addScaledVector(this.velocity, dt);
          if (this.root.position.y <= 0) {
            this.root.position.y = 0;
            this.velocity.set(0, 0, 0);
          }
        }
        this.pitch = THREE.MathUtils.lerp(this.pitch, 0, dt * 3);
        this.roll = THREE.MathUtils.lerp(this.roll, 0, dt * 3);
        this.root.rotation.set(this.pitch, this.yaw, this.roll);
        if (distSq < 190 * 190) {
          if (this.rotorMain) this.rotorMain.rotation.y += 4.5 * dt;
          if (this.rotorTail) this.rotorTail.rotation.x += 6.0 * dt;
        } else {
          needsWorldSync = false;
        }
      } else {
        const wasMoving = this.velocity.lengthSq() > 0.0004;
        if (wasMoving) {
          this.velocity.multiplyScalar(Math.max(0, 1 - dt * 4));
        }
        if (this.team === "PAX" && this.kind === "mbt" && playerPosForAI && distSq < 92 * 92) {
          this.updateEnemyTankAI(dt, playerPosForAI);
        } else if (!wasMoving && distSq > 110 * 110) {
          needsWorldSync = false;
        }
      }
    }

    this.speedKmh = Math.round(this.velocity.length() * 3.6);
    if (needsWorldSync) {
      this.root.updateMatrixWorld(true);
      this.updateStickyCollider();
    }
  }

  private updateGroundDrive(dt: number, input: VehicleInputState): void {
    const maxSpd = this.kind === "mbt" ? 14.8 : 26.5;
    const accel = this.kind === "mbt" ? 18.0 : 32.0;
    const turnRate = this.kind === "mbt" ? 1.15 : 1.95;

    // Hull steering (MBT can pivot-steer in place; LATV steers faster with speed)
    const speedSign = this.velocity.dot(new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))) >= -0.5 ? 1 : -1;
    const steerFactor = this.kind === "mbt" ? 1.0 : Math.min(1.0, 0.25 + this.velocity.length() / 7.0);
    this.yaw += input.turn * turnRate * steerFactor * speedSign * dt;

    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    if (Math.abs(input.forward) > 0.01) {
      this.velocity.addScaledVector(fwd, input.forward * accel * dt);
    } else {
      this.velocity.multiplyScalar(Math.max(0, 1 - dt * 4.5));
    }

    // Lateral grip so buggy doesn't ice-skate endlessly
    const fwdSpeed = this.velocity.dot(fwd);
    const clampedFwd = THREE.MathUtils.clamp(fwdSpeed, -maxSpd * 0.55, maxSpd);
    this.velocity.copy(fwd).multiplyScalar(clampedFwd);

    // Move & collide against intact buildings/barriers (MBT crushes destructible walls on ram!)
    const nextPos = this.root.position.clone().addScaledVector(this.velocity, dt);
    nextPos.x = THREE.MathUtils.clamp(nextPos.x, -212, 212);
    nextPos.z = THREE.MathUtils.clamp(nextPos.z, -212, 212);
    nextPos.y = 0;

    const rad = this.getHitRadius() * 0.85;
    const nearCols = this.physics.queryNearbyColliders(nextPos.x - rad, nextPos.z - rad, nextPos.x + rad, nextPos.z + rad);
    for (let i = 0; i < nearCols.length; i++) {
      const c = nearCols[i];
      if (c.destroyed || c.id === this.stickyCol.id) continue;
      if (c.box.max.y < 0.45 || c.box.min.y > 2.4) continue;

      const cx = THREE.MathUtils.clamp(nextPos.x, c.box.min.x, c.box.max.x);
      const cz = THREE.MathUtils.clamp(nextPos.z, c.box.min.z, c.box.max.z);
      const dx = nextPos.x - cx;
      const dz = nextPos.z - cz;
      const dSq = dx * dx + dz * dz;
      if (dSq < rad * rad) {
        // Heavy MBT rams right through destructible concrete chunks & Hesco cells!
        if (this.kind === "mbt" && c.destructible && Math.abs(clampedFwd) > 4.5) {
          this.physics.triggerExplosion(new THREE.Vector3(cx, 1.0, cz), 2.4, 350, this.team, "PLAYER", "ABRAMS RAM");
          continue;
        }
        const d = Math.max(0.001, Math.sqrt(dSq));
        nextPos.x += (dx / d) * (rad - d);
        nextPos.z += (dz / d) * (rad - d);
        this.velocity.multiplyScalar(0.35);
      }
    }

    this.root.position.copy(nextPos);
    this.root.rotation.set(0, this.yaw, 0);

    // Animate wheels on LATV4
    if (this.kind === "latv") {
      this.wheelSpin -= (clampedFwd * dt) / 0.52;
      const steerAng = input.turn * 0.48;
      if (this.wheelFL) {
        this.wheelFL.rotation.y = steerAng;
        this.wheelFL.rotation.x = this.wheelSpin;
      }
      if (this.wheelFR) {
        this.wheelFR.rotation.y = steerAng;
        this.wheelFR.rotation.x = this.wheelSpin;
      }
      if (this.wheelRL) this.wheelRL.rotation.x = this.wheelSpin;
      if (this.wheelRR) this.wheelRR.rotation.x = this.wheelSpin;
    }

    // Animate Turret & Cannon
    if (this.turretObj) {
      const relYaw = this.aimYaw - this.yaw;
      this.turretObj.rotation.y = relYaw;
    }
    if (this.cannonObj) {
      this.cannonObj.rotation.x = this.aimPitch;
    }
    if (this.rwsObj) {
      this.rwsObj.rotation.y = 0;
    }
    this.root.updateMatrixWorld(true);

    // Weapons Firing
    const aimDir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.aimPitch, this.aimYaw, 0, "YXZ")).normalize();

    if (this.kind === "mbt") {
      if (input.firePrimary && this.primaryCooldown <= 0) {
        this.primaryCooldown = 2.35;
        const muz = this.getSocketWorldPos(this.sockTankMuzzle, new THREE.Vector3(0, 2.0, -4.5));
        this.sfx.playExplosion(0.75);
        this.physics.addCameraShake(0.45);
        this.physics.spawnProjectile({
          kind: "tank_shell",
          team: this.team,
          ownerId: "PLAYER",
          weaponName: "120MM M829/HE",
          origin: muz.addScaledVector(aimDir, 0.5),
          direction: aimDir,
          speed: 120,
          damage: 720,
          blastRadius: 6.2,
          gravity: 3.6,
        });
      }
      if (input.fireSecondary && this.secondaryCooldown <= 0) {
        this.secondaryCooldown = 0.095;
        const muz = this.getSocketWorldPos(this.sockRwsMuzzle, new THREE.Vector3(0.4, 2.4, -1.6));
        this.sfx.playRifleShot(0.78, 0.25);
        this.physics.spawnProjectile({
          kind: "bullet",
          team: this.team,
          ownerId: "PLAYER",
          weaponName: "CROWS .50 CAL",
          origin: muz.addScaledVector(aimDir, 0.5),
          direction: aimDir,
          speed: 165,
          damage: 38,
        });
      }
    } else if (this.kind === "latv") {
      if ((input.firePrimary || input.fireSecondary) && this.primaryCooldown <= 0) {
        this.primaryCooldown = 0.11;
        const muz = this.getSocketWorldPos(this.sockHmgMuzzle, new THREE.Vector3(0, 2.45, -1.3));
        this.sfx.playRifleShot(0.8, 0.26);
        this.physics.spawnProjectile({
          kind: "bullet",
          team: this.team,
          ownerId: "PLAYER",
          weaponName: "M2HB .50 CAL",
          origin: muz.addScaledVector(aimDir, 0.45),
          direction: aimDir,
          speed: 165,
          damage: 42,
        });
      }
    }
  }

  private updateHeliFlight(dt: number, input: VehicleInputState): void {
    // High-RPM rotor spin
    if (this.rotorMain) this.rotorMain.rotation.y += 28.0 * dt;
    if (this.rotorTail) this.rotorTail.rotation.x += 38.0 * dt;

    // Tail rotor yaw (A/D)
    this.yaw += input.turn * 1.85 * dt;

    // Spacebar auto-level stabilizer for effortless hover gunnery!
    if (input.up) {
      this.pitch = THREE.MathUtils.lerp(this.pitch, 0, dt * 5.0);
      this.roll = THREE.MathUtils.lerp(this.roll, 0, dt * 5.0);
      this.velocity.y = THREE.MathUtils.lerp(this.velocity.y, 1.5, dt * 4.0);
    } else {
      // Subtle natural cyclic centering
      this.pitch = THREE.MathUtils.lerp(this.pitch, 0, dt * 0.75);
      this.roll = THREE.MathUtils.lerp(this.roll, 0, dt * 0.95);
    }

    // Collective vertical thrust (W = climb, S = descend)
    const verticalAccel = input.forward * 15.5;
    this.velocity.y += verticalAccel * dt;
    this.velocity.y *= Math.max(0, 1 - dt * 1.8);
    this.velocity.y = THREE.MathUtils.clamp(this.velocity.y, -14, 16);

    // Cyclic horizontal acceleration driven by helicopter nose pitch & roll!
    // Pitch < 0 = nose tilted down -> accelerate forward (-Z rotated by yaw)
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    this.velocity.addScaledVector(fwd, -this.pitch * 42.0 * dt);
    this.velocity.addScaledVector(right, -this.roll * 32.0 * dt);
    // Air drag
    this.velocity.x *= Math.max(0, 1 - dt * 1.12);
    this.velocity.z *= Math.max(0, 1 - dt * 1.12);

    this.root.position.addScaledVector(this.velocity, dt);
    this.root.position.x = THREE.MathUtils.clamp(this.root.position.x, -238, 238);
    this.root.position.z = THREE.MathUtils.clamp(this.root.position.z, -238, 238);
    this.root.position.y = THREE.MathUtils.clamp(this.root.position.y, 0.0, 75.0);

    if (this.root.position.y <= 0.01 && this.velocity.y < 0) {
      this.root.position.y = 0;
      this.velocity.y = 0;
      this.velocity.x *= 0.85;
      this.velocity.z *= 0.85;
    }

    this.root.rotation.set(this.pitch, this.yaw, this.roll);
    this.aimYaw = this.yaw;
    this.aimPitch = this.pitch;
    this.root.updateMatrixWorld(true);

    const heliAim = new THREE.Vector3(0, 0, -1).applyQuaternion(this.root.quaternion).normalize();

    // Primary: Dual M134 7.62mm Miniguns (1500 RPM alternating barrels)
    if (input.firePrimary && this.primaryCooldown <= 0) {
      this.primaryCooldown = 0.045;
      this.toggleBarrel = !this.toggleBarrel;
      const sock = this.toggleBarrel ? this.sockMinigunL : this.sockMinigunR;
      const muz = this.getSocketWorldPos(sock, new THREE.Vector3(0, 0.7, -1.2));
      this.sfx.playRifleShot(1.32, 0.18);
      const spread = new THREE.Vector3(
        (Math.random() - 0.5) * 0.018,
        (Math.random() - 0.5) * 0.018,
        (Math.random() - 0.5) * 0.018
      );
      this.physics.spawnProjectile({
        kind: "bullet",
        team: this.team,
        ownerId: "PLAYER",
        weaponName: "M134 MINIGUN",
        origin: muz.addScaledVector(heliAim, 0.6),
        direction: heliAim.clone().add(spread),
        speed: 175,
        damage: 26,
      });
    }

    // Secondary: 70mm Hydra-70 Unguided Rocket Pods (destroys walls & armor!)
    if (input.fireSecondary && this.secondaryCooldown <= 0 && this.hydraPodAmmo > 0) {
      this.secondaryCooldown = 0.24;
      this.hydraPodAmmo--;
      if (this.hydraPodAmmo <= 0) {
        this.hydraReloadTimer = 4.0;
      }
      this.toggleBarrel = !this.toggleBarrel;
      const sock = this.toggleBarrel ? this.sockPodL : this.sockPodR;
      const muz = this.getSocketWorldPos(sock, new THREE.Vector3(0, 0.65, -1.0));
      this.sfx.playRocketLaunch();
      this.physics.spawnProjectile({
        kind: "hydra",
        team: this.team,
        ownerId: "PLAYER",
        weaponName: "70MM HYDRA",
        origin: muz.addScaledVector(heliAim, 0.8),
        direction: heliAim,
        speed: 95,
        damage: 290,
        blastRadius: 4.8,
        gravity: 2.2,
      });
    }
  }

  private updateEnemyTankAI(dt: number, playerPos: THREE.Vector3): void {
    const toTarget = playerPos.clone().sub(this.root.position);
    const dist = toTarget.length();
    if (dist > 78) return;

    const desiredYaw = Math.atan2(-toTarget.x, -toTarget.z);
    let diff = desiredYaw - this.aimYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.aimYaw += THREE.MathUtils.clamp(diff, -0.75 * dt, 0.75 * dt);

    if (this.turretObj) {
      this.turretObj.rotation.y = this.aimYaw - this.yaw;
    }

    this.aiBurstTimer -= dt;
    if (this.aiBurstTimer <= 0 && Math.abs(diff) < 0.25 && dist > 10) {
      this.aiBurstTimer = 4.8 + Math.random() * 2.5;
      this.root.updateMatrixWorld(true);
      const muz = this.getSocketWorldPos(this.sockTankMuzzle, new THREE.Vector3(0, 2.0, -4.2));
      const aimDir = playerPos
        .clone()
        .add(new THREE.Vector3((Math.random() - 0.5) * 3.2, 0.9, (Math.random() - 0.5) * 3.2))
        .sub(muz)
        .normalize();
      this.sfx.playExplosion(0.45);
      this.physics.spawnProjectile({
        kind: "tank_shell",
        team: "PAX",
        ownerId: this.id,
        weaponName: "PAX 120MM",
        origin: muz.addScaledVector(aimDir, 0.6),
        direction: aimDir,
        speed: 92,
        damage: 55,
        blastRadius: 4.5,
        gravity: 3.8,
      });
    }
  }

  private getSocketWorldPos(sock: THREE.Object3D | undefined, fallbackLocal: THREE.Vector3): THREE.Vector3 {
    const out = new THREE.Vector3();
    if (sock) {
      sock.getWorldPosition(out);
      return out;
    }
    return fallbackLocal.clone().applyMatrix4(this.root.matrixWorld);
  }

  public computeCameraPose(thirdPerson: boolean, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
    if (this.kind === "heli") {
      if (thirdPerson) {
        const backOffset = new THREE.Vector3(0, 3.6, 10.5).applyEuler(new THREE.Euler(0, this.yaw, 0, "YXZ"));
        outPos.copy(this.root.position).add(backOffset);
        outQuat.setFromEuler(new THREE.Euler(this.pitch * 0.55 - 0.1, this.yaw, this.roll * 0.35, "YXZ"));
      } else {
        const cockpit = new THREE.Vector3(0, 1.48, -0.55).applyQuaternion(this.root.quaternion);
        outPos.copy(this.root.position).add(cockpit);
        outQuat.copy(this.root.quaternion);
      }
      return;
    }

    const lookEuler = new THREE.Euler(this.aimPitch, this.aimYaw, 0, "YXZ");
    outQuat.setFromEuler(lookEuler);

    if (thirdPerson) {
      const dist = this.kind === "mbt" ? 10.2 : 7.8;
      const height = this.kind === "mbt" ? 3.8 : 3.1;
      const back = new THREE.Vector3(0, 0, dist).applyEuler(lookEuler);
      outPos.copy(this.root.position).add(new THREE.Vector3(0, height, 0)).add(back);
      if (outPos.y < 0.6) outPos.y = 0.6;
    } else {
      // Gunner Thermal / Turret Optics 1st-Person View
      const h = this.kind === "mbt" ? 2.55 : 2.68;
      const fwd = new THREE.Vector3(0, 0, -0.8).applyEuler(new THREE.Euler(0, this.aimYaw, 0, "YXZ"));
      outPos.copy(this.root.position).add(new THREE.Vector3(0, h, 0)).add(fwd);
    }
  }
}

export class VehicleManager {
  public vehicles: CombatVehicle[] = [];

  constructor(
    private scene: THREE.Scene,
    private assets: AssetLibrary,
    private physics: WorldPhysics,
    private sfx: SoundFX
  ) {}

  public spawnInitialVehicles(): void {
    // 1. NATO South Main Operating Base (Z = +168) + Forward Sector Motor Pools
    const roster: Array<{
      id: string;
      displayName: string;
      kind: VehicleKind;
      team: Team;
      position: THREE.Vector3;
      yaw: number;
    }> = [
      {
        id: "VEH_NATO_MBT_HQ",
        displayName: "M1A2 ABRAMSX 主战坦克",
        kind: "mbt",
        team: "NATO",
        position: new THREE.Vector3(-12, 0, 162),
        yaw: 0,
      },
      {
        id: "VEH_NATO_HELI_HQ",
        displayName: "AH-6J LITTLE BIRD 武装小鸟",
        kind: "heli",
        team: "NATO",
        position: new THREE.Vector3(18, 0, 168),
        yaw: 0,
      },
      {
        id: "VEH_NATO_LATV_HQ",
        displayName: "LATV4 基地突击车",
        kind: "latv",
        team: "NATO",
        position: new THREE.Vector3(3, 0, 160),
        yaw: 0.1,
      },
      {
        id: "VEH_NATO_MBT_ECHO",
        displayName: "M1A2 ABRAMSX 前线重坦",
        kind: "mbt",
        team: "NATO",
        position: new THREE.Vector3(-15, 0, 74),
        yaw: 0,
      },
      {
        id: "VEH_NATO_LATV_ALPHA",
        displayName: "LATV4 装甲突击侦察车",
        kind: "latv",
        team: "NATO",
        position: new THREE.Vector3(-8, 0, 29),
        yaw: -0.15,
      },
      {
        id: "VEH_NATO_LATV_CHARLIE",
        displayName: "LATV4 绿洲机动装甲车",
        kind: "latv",
        team: "NATO",
        position: new THREE.Vector3(-82, 0, 12),
        yaw: -Math.PI * 0.45,
      },
      // 2. Enemy PAX Vehicles (Northern Stronghold, Bravo Port & North Base)
      {
        id: "VEH_PAX_MBT_DELTA",
        displayName: "PAX 敌军主战坦克",
        kind: "mbt",
        team: "PAX",
        position: new THREE.Vector3(-16, 0, -76),
        yaw: Math.PI,
      },
      {
        id: "VEH_PAX_MBT_NORTH",
        displayName: "PAX 重装卫队坦克",
        kind: "mbt",
        team: "PAX",
        position: new THREE.Vector3(-12, 0, -158),
        yaw: Math.PI,
      },
      {
        id: "VEH_PAX_LATV_BRAVO",
        displayName: "PAX 港口侦察装甲车",
        kind: "latv",
        team: "PAX",
        position: new THREE.Vector3(78, 0, 16),
        yaw: Math.PI * 0.55,
      },
      {
        id: "VEH_PAX_LATV_PATROL",
        displayName: "PAX 公路巡逻装甲车",
        kind: "latv",
        team: "PAX",
        position: new THREE.Vector3(-14, 0, -38),
        yaw: Math.PI * 0.92,
      },
    ];

    for (const cfg of roster) {
      this.vehicles.push(new CombatVehicle(cfg, this.scene, this.assets, this.physics, this.sfx));
    }
  }

  public findEnterableVehicle(pos: THREE.Vector3, maxDist = 4.8): CombatVehicle | null {
    let best: CombatVehicle | null = null;
    let bestD = maxDist;
    for (const v of this.vehicles) {
      if (!v.isAlive() || v.driverId !== null) continue;
      const d = v.getPosition().distanceTo(pos);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  public update(dt: number, activeVehicle: CombatVehicle | null, input: VehicleInputState | null, playerPos: THREE.Vector3): void {
    for (const v of this.vehicles) {
      v.update(dt, v === activeVehicle ? input : null, playerPos);
    }
  }
}
