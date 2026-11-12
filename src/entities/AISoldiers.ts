/**
 * Two-Faction Battlefield AI Squad Simulation (NATO Coalition vs. Pax Armata).
 * Drives SkinnedMesh glTF Soldiers (`Idle_Combat`, `Crouch_Aim`, `Run_Forward`),
 * Conquest Objective Capture Navigation, Line-of-Sight Target Acquisition, Tracer Bursts & Ticket Bleed.
 */

import * as THREE from "three";
import type { AssetLibrary } from "../core/AssetLoader";
import type { SoundFX } from "../audio/SoundFX";
import type { ConquestMap } from "../world/ConquestMap";
import type { DamageableActor, Team, WorldPhysics } from "../world/WorldPhysics";

type AnimName = "Idle_Combat" | "Crouch_Aim" | "Run_Forward";

const CALLSIGNS_NATO = [
  "SGT. MILLER",
  "CPL. REYES",
  "SPC. KOWALSKI",
  "LT. VANCE",
  "PFC. CHEN",
  "SGT. HARPER",
  "CPL. BROOKS",
  "SPC. MERCER",
  "CPL. DIAZ",
  "SGT. FOSTER",
  "SPC. PARK",
  "PFC. ADAMS",
  "CPL. WEST",
  "LT. COLE",
];

const CALLSIGNS_PAX = [
  "PAX-VOLKOV",
  "PAX-DRAGUNOV",
  "PAX-KORSUN",
  "PAX-MALIK",
  "PAX-SOKOL",
  "PAX-TARAS",
  "PAX-ZAHIR",
  "PAX-ORLOV",
  "PAX-VARGAS",
  "PAX-KIRON",
  "PAX-MOROZOV",
  "PAX-KADIR",
  "PAX-BELOV",
  "PAX-RASHID",
  "PAX-GROZNY",
  "PAX-NOVAK",
];

export class AISoldier implements DamageableActor {
  public id: string;
  public team: Team;
  public root: THREE.Object3D;
  public hp = 100;
  public maxHp = 100;
  public position = new THREE.Vector3();
  public velocity = new THREE.Vector3();
  public yaw = 0;

  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private currentAnim: AnimName | "" = "";
  private weaponBone?: THREE.Object3D;
  private rifleMesh: THREE.Group;

  private goalPos = new THREE.Vector3();
  private retargetGoalTimer = 0;
  private scanTimer = 0;
  private currentEnemy: DamageableActor | null = null;
  private burstCooldown = 0;
  private burstRemaining = 0;
  private shotInterval = 0;
  private strafeSeed = Math.random() * 10;
  private stuckTimer = 0;
  private lastCheckPos = new THREE.Vector3();
  private deathTimer = 0;

  constructor(
    callsign: string,
    team: Team,
    spawnPos: THREE.Vector3,
    private scene: THREE.Scene,
    assets: AssetLibrary,
    private physics: WorldPhysics,
    private map: ConquestMap,
    private sfx: SoundFX
  ) {
    this.id = callsign;
    this.team = team;
    this.position.copy(spawnPos);
    this.lastCheckPos.copy(spawnPos);
    this.yaw = team === "NATO" ? 0 : Math.PI;

    const rigKey = team === "NATO" ? "CHR_Soldier_NATO_Assault" : "CHR_Soldier_PAX_OpFor";
    const { root, animations } = assets.cloneSkinned(rigKey);
    this.root = root;
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;
    this.scene.add(this.root);

    // Find right-hand Weapon_R / Hand_R bone so attached rifle tracks skeletal animations cleanly
    this.root.traverse((o) => {
      if (o.name === "Weapon_R" || (o.name === "Hand_R" && !this.weaponBone)) {
        this.weaponBone = o;
      }
    });

    this.rifleMesh = assets.cloneStatic("WPN_AssaultRifle_M5A3");
    this.rifleMesh.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.root.add(this.rifleMesh);
    this.rifleMesh.position.set(0.18, 1.18, -0.24);

    // Setup NLA AnimationClips
    this.mixer = new THREE.AnimationMixer(this.root);
    for (const clip of animations) {
      const act = this.mixer.clipAction(clip);
      this.actions.set(clip.name, act);
    }
    this.playAnim("Idle_Combat");
    this.pickObjectiveGoal();

    this.physics.actors.push(this);
  }

  private playAnim(name: AnimName): void {
    if (this.currentAnim === name) return;
    const next = this.actions.get(name);
    if (!next) return;

    const prev = this.currentAnim ? this.actions.get(this.currentAnim) : undefined;
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (prev) {
      prev.crossFadeTo(next, 0.2, false);
    }
    this.currentAnim = name;
  }

  public getPosition(): THREE.Vector3 {
    return this.position;
  }

  public getHitRadius(): number {
    return 0.44;
  }

  public getHeight(): number {
    return this.currentAnim === "Crouch_Aim" ? 1.38 : 1.78;
  }

  public isAlive(): boolean {
    return this.hp > 0;
  }

  public takeDamage(amount: number, attackerTeam: Team, _weaponName: string, _isHeadshot: boolean): void {
    if (!this.isAlive()) return;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.deathTimer = 6.5;
      this.currentEnemy = null;
      // Deduct 1 Conquest ticket on soldier KIA
      if (this.team === "NATO") {
        this.map.ticketsNATO = Math.max(0, this.map.ticketsNATO - 1);
      } else if (this.team === "PAX") {
        this.map.ticketsPAX = Math.max(0, this.map.ticketsPAX - 1);
      }
      // Fall pose
      this.root.rotation.x = -Math.PI * 0.46;
      this.root.position.y = this.position.y + 0.16;
      void attackerTeam;
    }
  }

  private respawn(): void {
    this.hp = this.maxHp;
    this.velocity.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.root.visible = true;

    // Spawn near an owned Conquest Flag or Faction Base HQ
    const owned = this.map.flags.filter((f) => f.owner === this.team);
    if (owned.length > 0 && Math.random() < 0.82) {
      const fl = owned[Math.floor(Math.random() * owned.length)];
      const ang = Math.random() * Math.PI * 2;
      const dist = 6 + Math.random() * 10;
      this.position.set(fl.position.x + Math.cos(ang) * dist, 0.2, fl.position.z + Math.sin(ang) * dist);
    } else {
      const baseZ = this.team === "NATO" ? 148 + Math.random() * 12 : -148 - Math.random() * 12;
      this.position.set((Math.random() - 0.5) * 44, 0.2, baseZ);
    }

    this.yaw = this.team === "NATO" ? 0 : Math.PI;
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;
    this.currentAnim = "";
    this.playAnim("Idle_Combat");
    this.pickObjectiveGoal();
  }

  private pickObjectiveGoal(): void {
    // Prioritize enemy/neutral Conquest Flags, especially central Sector Alpha [A]
    const candidates = this.map.flags.filter((f) => f.owner !== this.team);
    const pool = candidates.length > 0 ? candidates : this.map.flags;
    const chosen =
      Math.random() < 0.48 ? this.map.flags[0] ?? pool[0] : pool[Math.floor(Math.random() * pool.length)];

    if (chosen) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 2.5 + Math.random() * 6.5;
      this.goalPos.set(chosen.position.x + Math.cos(ang) * rad, 0, chosen.position.z + Math.sin(ang) * rad);
    }
    this.retargetGoalTimer = 8.0 + Math.random() * 6.0;
  }

  private hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.5) return true;
    dir.divideScalar(dist);

    const ray = new THREE.Ray(from, dir);
    const hit = new THREE.Vector3();
    const near = this.physics.queryNearbyColliders(
      Math.min(from.x, to.x) - 0.5,
      Math.min(from.z, to.z) - 0.5,
      Math.max(from.x, to.x) + 0.5,
      Math.max(from.z, to.z) + 0.5
    );
    for (let i = 0; i < near.length; i++) {
      const c = near[i];
      if (c.destroyed || c.id >= 90000) continue;
      if (ray.intersectBox(c.box, hit)) {
        if (from.distanceTo(hit) < dist - 0.5) {
          return false;
        }
      }
    }
    return true;
  }

  private scanForEnemy(): void {
    const eye = this.position.clone().add(new THREE.Vector3(0, 1.5, 0));
    let best: DamageableActor | null = null;
    let bestDist = 82.0;

    for (const actor of this.physics.actors) {
      if (!actor.isAlive() || actor.team === this.team || actor.team === "NEUTRAL") continue;
      // Don't shoot small arms endlessly at heavy MBT if infantry is nearby, though light vehicles/soldiers are valid
      const tPos = actor.getPosition().clone().add(new THREE.Vector3(0, actor.getHeight() * 0.65, 0));
      const d = eye.distanceTo(tPos);
      if (d < bestDist && this.hasLineOfSight(eye, tPos)) {
        bestDist = d;
        best = actor;
      }
    }
    this.currentEnemy = best;
  }

  public update(dt: number, listenerPos: THREE.Vector3): void {
    if (!this.isAlive()) {
      this.deathTimer -= dt;
      if (this.deathTimer < 4.2 && this.root.visible) {
        this.root.visible = false;
      }
      if (this.deathTimer <= 0) {
        this.respawn();
      }
      return;
    }

    this.strafeSeed += dt;
    this.retargetGoalTimer -= dt;
    if (this.retargetGoalTimer <= 0) {
      this.pickObjectiveGoal();
    }

    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 0.32 + Math.random() * 0.18;
      this.scanForEnemy();
    }

    if (this.currentEnemy && !this.currentEnemy.isAlive()) {
      this.currentEnemy = null;
    }

    const toGoal = this.goalPos.clone().sub(this.position);
    toGoal.y = 0;
    const distToGoal = toGoal.length();
    if (distToGoal < 2.4) {
      this.retargetGoalTimer = Math.min(this.retargetGoalTimer, 2.5);
    }

    // Movement & Combat State
    let moveSpeed = 0;
    const moveDir = new THREE.Vector3();
    let aimPitch = 0;

    if (this.currentEnemy) {
      const ePos = this.currentEnemy.getPosition();
      const dx = ePos.x - this.position.x;
      const dz = ePos.z - this.position.z;
      const dy = ePos.y + this.currentEnemy.getHeight() * 0.6 - (this.position.y + 1.35);
      const flatDist = Math.max(0.1, Math.hypot(dx, dz));
      this.yaw = Math.atan2(-dx, -dz);
      aimPitch = THREE.MathUtils.clamp(Math.atan2(dy, flatDist), -0.45, 0.45);

      if (flatDist > 26 && distToGoal > 3.5) {
        // Tactical advance while engaging at long range
        moveDir.copy(toGoal).normalize();
        moveSpeed = 3.2;
        this.playAnim("Run_Forward");
      } else {
        // Tactical crouch aim or micro-strafe
        if (Math.sin(this.strafeSeed * 0.9) > 0.15) {
          this.playAnim("Crouch_Aim");
        } else {
          this.playAnim("Idle_Combat");
          const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
          moveDir.copy(right).multiplyScalar(Math.sin(this.strafeSeed * 2.1));
          moveSpeed = 1.6;
        }
      }

      // Burst firing logic
      this.burstCooldown -= dt;
      if (this.burstCooldown <= 0 && this.burstRemaining <= 0) {
        this.burstRemaining = 3 + Math.floor(Math.random() * 3);
        this.burstCooldown = 1.15 + Math.random() * 1.1;
      }
      if (this.burstRemaining > 0) {
        this.shotInterval -= dt;
        if (this.shotInterval <= 0) {
          this.shotInterval = 0.11;
          this.burstRemaining--;
          this.fireBulletAt(this.currentEnemy, listenerPos);
        }
      }
    } else if (distToGoal > 2.2) {
      moveDir.copy(toGoal).normalize();
      moveSpeed = 4.65;
      this.yaw = Math.atan2(-moveDir.x, -moveDir.z);
      this.playAnim("Run_Forward");
    } else {
      this.playAnim("Crouch_Aim");
    }

    // Unstick helper if blocked against intact wall corner
    this.stuckTimer += dt;
    if (this.stuckTimer >= 1.4) {
      if (moveSpeed > 2.5 && this.position.distanceTo(this.lastCheckPos) < 0.35) {
        // Sidestep / pick fresh flank waypoint
        const perp = new THREE.Vector3(-toGoal.z, 0, toGoal.x).normalize();
        this.goalPos.copy(this.position).addScaledVector(perp, (Math.random() > 0.5 ? 1 : -1) * 7.5);
      }
      this.lastCheckPos.copy(this.position);
      this.stuckTimer = 0;
    }

    this.velocity.x = moveDir.x * moveSpeed;
    this.velocity.z = moveDir.z * moveSpeed;
    this.velocity.y -= 22.0 * dt;

    const res = this.physics.resolveCharacterMovement(this.position, this.velocity, dt, 0.36, 1.72, 0.38);
    if (res.grounded && this.velocity.y < 0) {
      this.velocity.y = 0;
    }

    this.root.position.copy(this.position);
    this.root.rotation.set(0, this.yaw, 0);
    this.mixer.update(dt);

    // Sync attached rifle position to animated right hand in soldier-local space
    if (this.weaponBone) {
      this.root.updateMatrixWorld(true);
      const handWorld = new THREE.Vector3();
      this.weaponBone.getWorldPosition(handWorld);
      this.root.worldToLocal(handWorld);
      this.rifleMesh.position.set(
        THREE.MathUtils.clamp(handWorld.x, -0.05, 0.28),
        THREE.MathUtils.clamp(handWorld.y + 0.04, 0.65, 1.45),
        THREE.MathUtils.clamp(handWorld.z - 0.05, -0.45, 0.05)
      );
    }
    this.rifleMesh.rotation.set(aimPitch, 0, 0);
  }

  private fireBulletAt(target: DamageableActor, listenerPos: THREE.Vector3): void {
    const muz = this.position.clone().add(new THREE.Vector3(0, this.currentAnim === "Crouch_Aim" ? 1.05 : 1.38, 0));
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    muz.addScaledVector(fwd, 0.65);

    const aimPt = target.getPosition().clone().add(new THREE.Vector3(0, target.getHeight() * 0.58, 0));
    // Realistic AI combat dispersion so firefights feel cinematic without instant-deleting the player
    const spread = target.id === "PLAYER" ? 0.068 : 0.045;
    const dir = aimPt
      .sub(muz)
      .normalize()
      .add(
        new THREE.Vector3(
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread
        )
      )
      .normalize();

    const distToPlayer = muz.distanceTo(listenerPos);
    if (distToPlayer < 48) {
      const vol = Math.max(0.03, 0.16 * (1 - distToPlayer / 48));
      this.sfx.playRifleShot(this.team === "NATO" ? 1.04 : 0.92, vol);
    }

    this.physics.spawnProjectile({
      kind: "bullet",
      team: this.team,
      ownerId: this.id,
      weaponName: "M5A3",
      origin: muz,
      direction: dir,
      speed: 135,
      damage: target.id === "PLAYER" ? 9 : 22,
    });
  }
}

export class AIManager {
  public soldiers: AISoldier[] = [];

  constructor(
    private scene: THREE.Scene,
    private assets: AssetLibrary,
    private physics: WorldPhysics,
    private map: ConquestMap,
    private sfx: SoundFX
  ) {}

  public spawnSquads(): void {
    // 14 NATO Allied Assault Troopers across Charlie, Echo & Alpha Frontline
    const natoSpawns = [
      new THREE.Vector3(-98, 0.1, -8),
      new THREE.Vector3(-106, 0.1, -14),
      new THREE.Vector3(-92, 0.1, -18),
      new THREE.Vector3(20, 0.1, 104),
      new THREE.Vector3(28, 0.1, 98),
      new THREE.Vector3(14, 0.1, 90),
      new THREE.Vector3(-12, 0.1, 24),
      new THREE.Vector3(-4, 0.1, 22),
      new THREE.Vector3(6, 0.1, 20),
      new THREE.Vector3(14, 0.1, 24),
      new THREE.Vector3(-48, 0.1, 16),
      new THREE.Vector3(44, 0.1, 18),
      new THREE.Vector3(-18, 0.1, 52),
      new THREE.Vector3(4, 0.1, 64),
    ];
    CALLSIGNS_NATO.forEach((name, idx) => {
      const spawn = natoSpawns[idx % natoSpawns.length];
      this.soldiers.push(new AISoldier(name, "NATO", spawn, this.scene, this.assets, this.physics, this.map, this.sfx));
    });

    // 16 PAX Armata OpFor Defenders & Assault Squads across Alpha, Bravo & Delta
    const paxSpawns = [
      new THREE.Vector3(-5, 0.1, 3),
      new THREE.Vector3(6, 0.1, 2),
      new THREE.Vector3(-2, 3.75, -5), // 2nd floor sniper in Alpha West Tower
      new THREE.Vector3(14, 3.75, 7),  // 2nd floor rifleman in Alpha East Tower
      new THREE.Vector3(10, 0.1, -8),
      new THREE.Vector3(-10, 0.1, -12),
      new THREE.Vector3(98, 0.1, 16),
      new THREE.Vector3(106, 0.1, 22),
      new THREE.Vector3(114, 0.1, 18),
      new THREE.Vector3(118, 3.75, 12), // 2nd floor port overwatch in Bravo
      new THREE.Vector3(-14, 0.1, -100),
      new THREE.Vector3(-20, 0.1, -106),
      new THREE.Vector3(-6, 0.1, -102),
      new THREE.Vector3(52, 0.1, 8),
      new THREE.Vector3(-52, 0.1, 8),
      new THREE.Vector3(-16, 0.1, -48),
    ];
    CALLSIGNS_PAX.forEach((name, idx) => {
      const spawn = paxSpawns[idx % paxSpawns.length];
      this.soldiers.push(new AISoldier(name, "PAX", spawn, this.scene, this.assets, this.physics, this.map, this.sfx));
    });
  }

  public update(dt: number, listenerPos: THREE.Vector3): void {
    for (const s of this.soldiers) {
      s.update(dt, listenerPos);
    }
  }
}
