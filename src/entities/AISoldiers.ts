/**
 * Two-Faction Battlefield AI Squad Simulation (NATO Coalition vs. Pax Armata).
 * Features Grounded Biomechanical Skeletal Pose Solver (Standing, Crouching, Sprinting, Strafing,
 * Smooth Yaw Turning, Two-Handed Rifle Aiming & Ragdoll Collapse) + Distance-Based CPU/Shadow LOD!
 */

import * as THREE from "three";
import type { AssetLibrary } from "../core/AssetLoader";
import type { SoundFX } from "../audio/SoundFX";
import type { ConquestMap } from "../world/ConquestMap";
import type { DamageableActor, Team, WorldPhysics } from "../world/WorldPhysics";

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

interface SoldierBones {
  Hips?: THREE.Bone;
  Spine?: THREE.Bone;
  Chest?: THREE.Bone;
  Neck?: THREE.Bone;
  Head?: THREE.Bone;
  UpperArm_L?: THREE.Bone;
  Forearm_L?: THREE.Bone;
  Hand_L?: THREE.Bone;
  UpperArm_R?: THREE.Bone;
  Forearm_R?: THREE.Bone;
  Hand_R?: THREE.Bone;
  UpperLeg_L?: THREE.Bone;
  LowerLeg_L?: THREE.Bone;
  Foot_L?: THREE.Bone;
  UpperLeg_R?: THREE.Bone;
  LowerLeg_R?: THREE.Bone;
  Foot_R?: THREE.Bone;
}

// Module-level shared scratch math objects (0 per-frame GC allocations across all 30 AI soldiers!)
const _tmpEuler = new THREE.Euler();
const _tmpQuat = new THREE.Quaternion();
const _losDir = new THREE.Vector3();
const _losHit = new THREE.Vector3();
const _losRay = new THREE.Ray();
const _eyePos = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _toGoal = new THREE.Vector3();
const _moveDir = new THREE.Vector3();
const _rightVec = new THREE.Vector3();
const _perpVec = new THREE.Vector3();
const _muzPos = new THREE.Vector3();
const _aimVec = new THREE.Vector3();
const _handLocal = new THREE.Vector3();

function lerpAngleShortest(a: number, b: number, t: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * Math.min(1, t);
}

export class AISoldier implements DamageableActor {
  public id: string;
  public team: Team;
  public root: THREE.Object3D;
  public hp = 100;
  public maxHp = 100;
  public position = new THREE.Vector3();
  public velocity = new THREE.Vector3();
  public yaw = 0;

  private skinnedMeshes: THREE.SkinnedMesh[] = [];
  private bones: SoldierBones = {};
  private restQuats = new Map<THREE.Bone, THREE.Quaternion>();
  private rifleMesh: THREE.Group;
  private rifleMuzzleSocket?: THREE.Object3D;

  // Smooth biomechanical animation state
  private crouchBlend = 0;
  private moveBlend = 0;
  private stridePhase = Math.random() * Math.PI * 2;
  private strafeRatio = 0; // -1..+1 lateral movement relative to facing
  private smoothAimPitch = 0;
  private recoilKick = 0;
  private deathFallBlend = 0;
  private deathSideSign = 1;
  private frameCounter = 0;

  // AI Tactical Decision State
  private goalPos = new THREE.Vector3();
  private retargetGoalTimer = 0;
  private scanTimer = Math.random() * 0.35;
  private currentEnemy: DamageableActor | null = null;
  private burstCooldown = Math.random() * 0.8;
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
    lodOffset: number,
    private scene: THREE.Scene,
    assets: AssetLibrary,
    private physics: WorldPhysics,
    private map: ConquestMap,
    private sfx: SoundFX
  ) {
    this.id = callsign;
    this.team = team;
    this.frameCounter = lodOffset;
    this.position.copy(spawnPos);
    this.lastCheckPos.copy(spawnPos);
    this.yaw = team === "NATO" ? 0 : Math.PI;

    const rigKey = team === "NATO" ? "CHR_Soldier_NATO_Assault" : "CHR_Soldier_PAX_OpFor";
    const { root } = assets.cloneSkinned(rigKey);
    this.root = root;
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;
    this.scene.add(this.root);

    // Cache skeleton bones & rest quaternions for ultra-fast direct biomechanical posing
    this.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
        this.skinnedMeshes.push(o as THREE.SkinnedMesh);
      }
      if ((o as THREE.Bone).isBone) {
        const bone = o as THREE.Bone;
        this.restQuats.set(bone, bone.quaternion.clone());
        if (bone.name in this.bones || /^(Hips|Spine|Chest|Neck|Head|UpperArm_[LR]|Forearm_[LR]|Hand_[LR]|UpperLeg_[LR]|LowerLeg_[LR]|Foot_[LR])$/.test(bone.name)) {
          (this.bones as Record<string, THREE.Bone>)[bone.name] = bone;
        }
      }
    });

    this.rifleMesh = assets.cloneStatic("WPN_AssaultRifle_M5A3");
    this.rifleMesh.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
      }
      if (o.name.includes("Socket_Muzzle")) {
        this.rifleMuzzleSocket = o;
      }
    });
    this.root.add(this.rifleMesh);
    this.rifleMesh.position.set(0.13, 1.24, -0.34);

    this.applyBiomechanicalPose(0.016, true);
    this.pickObjectiveGoal();
    this.physics.actors.push(this);
  }

  private setBoneRot(bone: THREE.Bone | undefined, rx: number, ry: number, rz: number): void {
    if (!bone) return;
    const rest = this.restQuats.get(bone);
    if (!rest) return;
    _tmpEuler.set(rx, ry, rz, "XYZ");
    bone.quaternion.copy(rest).multiply(_tmpQuat.setFromEuler(_tmpEuler));
  }

  public getPosition(): THREE.Vector3 {
    return this.position;
  }

  public getHitRadius(): number {
    return 0.44;
  }

  public getHeight(): number {
    return THREE.MathUtils.lerp(1.78, 1.38, this.crouchBlend);
  }

  public isAlive(): boolean {
    return this.hp > 0;
  }

  public takeDamage(amount: number, _attackerTeam: Team, _weaponName: string, _isHeadshot: boolean): void {
    if (!this.isAlive()) return;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.deathTimer = 6.0;
      this.deathFallBlend = 0;
      this.deathSideSign = Math.random() > 0.5 ? 1 : -1;
      this.currentEnemy = null;
      if (this.team === "NATO") {
        this.map.ticketsNATO = Math.max(0, this.map.ticketsNATO - 1);
      } else if (this.team === "PAX") {
        this.map.ticketsPAX = Math.max(0, this.map.ticketsPAX - 1);
      }
    }
  }

  private respawn(): void {
    this.hp = this.maxHp;
    this.velocity.set(0, 0, 0);
    this.crouchBlend = 0;
    this.moveBlend = 0;
    this.deathFallBlend = 0;
    this.root.rotation.set(0, 0, 0);
    this.root.visible = true;

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
    this.applyBiomechanicalPose(0.016, true);
    this.pickObjectiveGoal();
  }

  private pickObjectiveGoal(): void {
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
    _losDir.copy(to).sub(from);
    const dist = _losDir.length();
    if (dist < 0.5) return true;
    _losDir.divideScalar(dist);

    _losRay.set(from, _losDir);
    const near = this.physics.queryNearbyColliders(
      Math.min(from.x, to.x) - 0.5,
      Math.min(from.z, to.z) - 0.5,
      Math.max(from.x, to.x) + 0.5,
      Math.max(from.z, to.z) + 0.5
    );
    for (let i = 0; i < near.length; i++) {
      const c = near[i];
      if (c.destroyed || c.id >= 90000) continue;
      if (_losRay.intersectBox(c.box, _losHit)) {
        if (from.distanceTo(_losHit) < dist - 0.5) {
          return false;
        }
      }
    }
    return true;
  }

  private scanForEnemy(): void {
    _eyePos.set(this.position.x, this.position.y + 1.5, this.position.z);
    let best: DamageableActor | null = null;
    let bestDistSq = 82.0 * 82.0;

    for (let i = 0; i < this.physics.actors.length; i++) {
      const actor = this.physics.actors[i];
      if (!actor.isAlive() || actor.team === this.team || actor.team === "NEUTRAL") continue;
      const ap = actor.getPosition();
      _targetPos.set(ap.x, ap.y + actor.getHeight() * 0.65, ap.z);
      const dSq = _eyePos.distanceToSquared(_targetPos);
      if (dSq < bestDistSq && this.hasLineOfSight(_eyePos, _targetPos)) {
        bestDistSq = dSq;
        best = actor;
      }
    }
    this.currentEnemy = best;
  }

  /**
   * Grounded Biomechanical Pose Solver:
   * Evaluates smooth standing/crouching/running/strafing leg kinematics with boots planted at Y=0,
   * upper-body aim pitch, shouldered rifle grip, and recoil kick!
   */
  private applyBiomechanicalPose(dt: number, syncHandSocket: boolean): void {
    const b = this.bones;
    const cr = this.crouchBlend;
    const mv = this.moveBlend;
    const s = Math.sin(this.stridePhase);
    const c = Math.cos(this.stridePhase);

    // 1. Pelvis Height (0.90m standing, 0.71m crouched, natural 3.5cm double-frequency footfall bounce)
    const standHipY = 0.9 - mv * (0.015 + 0.032 * Math.abs(s));
    const hipY = THREE.MathUtils.lerp(standHipY, 0.71 - mv * 0.015, cr);
    if (b.Hips) {
      b.Hips.position.set(mv * this.strafeRatio * 0.025, hipY, 0);
      this.setBoneRot(b.Hips, 0, mv * 0.08 * s, mv * this.strafeRatio * -0.06);
    }

    // 2. Legs: Blend Standing Ready <-> Crouch Brace <-> Athletic Run/Strafe Stride
    // Idle/Crouch static base angles (verified boots sit flush on Y = 0.00m!)
    const baseUL_L = THREE.MathUtils.lerp(0.22, 0.88, cr);
    const baseLL_L = THREE.MathUtils.lerp(-0.34, -1.24, cr);
    const baseFT_L = THREE.MathUtils.lerp(0.12, 0.36, cr);

    const baseUL_R = THREE.MathUtils.lerp(-0.18, 0.28, cr);
    const baseLL_R = THREE.MathUtils.lerp(-0.18, -1.12, cr);
    const baseFT_R = THREE.MathUtils.lerp(0.34, 0.78, cr);

    // Dynamic stride angles
    const strideAmp = THREE.MathUtils.lerp(0.62, 0.36, cr);
    const runUL_L = strideAmp * s + (cr > 0.3 ? 0.48 : 0.12);
    const runLL_L = -0.16 - 0.72 * Math.max(0, c) - cr * 0.45;
    const runFT_L = -(runUL_L + runLL_L) * 0.65;

    const runUL_R = -strideAmp * s + (cr > 0.3 ? 0.48 : 0.12);
    const runLL_R = -0.16 - 0.72 * Math.max(0, -c) - cr * 0.45;
    const runFT_R = -(runUL_R + runLL_R) * 0.65;

    const sideSway = mv * this.strafeRatio * 0.16 * s;
    this.setBoneRot(b.UpperLeg_L, THREE.MathUtils.lerp(baseUL_L, runUL_L, mv), 0, -0.05 + sideSway);
    this.setBoneRot(b.LowerLeg_L, THREE.MathUtils.lerp(baseLL_L, runLL_L, mv), 0, 0);
    this.setBoneRot(b.Foot_L, THREE.MathUtils.lerp(baseFT_L, runFT_L, mv), 0, 0);

    this.setBoneRot(b.UpperLeg_R, THREE.MathUtils.lerp(baseUL_R, runUL_R, mv), 0, 0.05 + sideSway);
    this.setBoneRot(b.LowerLeg_R, THREE.MathUtils.lerp(baseLL_R, runLL_R, mv), 0, 0);
    this.setBoneRot(b.Foot_R, THREE.MathUtils.lerp(baseFT_R, runFT_R, mv), 0, 0);

    // 3. Spine, Chest & Head (Tactical forward lean + Aim Pitch + Counter-twist during sprint)
    const sprintLean = mv * (this.currentEnemy ? -0.06 : -0.14);
    const pitchShare = this.smoothAimPitch * 0.45;
    this.setBoneRot(b.Spine, -0.08 - cr * 0.06 + sprintLean + pitchShare, -0.2 + mv * 0.08 * s, 0);
    this.setBoneRot(b.Chest, -0.06 - cr * 0.04 + pitchShare - this.recoilKick * 0.4, -0.18 - mv * 0.1 * s, 0);
    this.setBoneRot(b.Neck, 0.04, 0.12, 0);
    this.setBoneRot(b.Head, 0.12 + this.smoothAimPitch * 0.3, 0.26 + mv * 0.04 * s, 0);

    // 4. Two-Handed Tactical Rifle Stance (Right hand on pistol grip, Left hand extended to M-LOK handguard)
    const armBob = mv * 0.07 * c;
    const sprintLowReady = mv * (this.currentEnemy ? 0.0 : -0.18);
    this.setBoneRot(
      b.UpperArm_R,
      0.78 + this.smoothAimPitch * 0.55 + sprintLowReady + armBob - this.recoilKick,
      -0.14,
      0.3
    );
    this.setBoneRot(b.Forearm_R, 1.2 + this.recoilKick * 0.6, 0, 0.26);
    this.setBoneRot(b.Hand_R, -0.15, 0, 0);

    this.setBoneRot(
      b.UpperArm_L,
      1.04 + this.smoothAimPitch * 0.55 + sprintLowReady - armBob - this.recoilKick * 0.8,
      0.16,
      -0.28
    );
    this.setBoneRot(b.Forearm_L, 0.46, 0, -0.14);
    this.setBoneRot(b.Hand_L, -0.08, 0, 0);

    // 5. Lock attached M5A3 Rifle cleanly to right-hand grip & shoulder aim line
    if (syncHandSocket && b.Hand_R) {
      this.root.updateMatrixWorld(true);
      b.Hand_R.getWorldPosition(_handLocal);
      this.root.worldToLocal(_handLocal);
      this.rifleMesh.position.set(_handLocal.x - 0.02, _handLocal.y + 0.035, _handLocal.z + 0.02);
    } else {
      this.rifleMesh.position.set(0.125, hipY + 0.34, -0.33);
    }

    const riflePitch = this.smoothAimPitch + sprintLowReady * 0.9 + this.recoilKick * 0.5;
    const rifleYaw = mv * (this.currentEnemy ? 0.02 : 0.22) + armBob * 0.25;
    this.rifleMesh.rotation.set(riflePitch, rifleYaw, 0);
    void dt;
  }

  public update(dt: number, listenerPos: THREE.Vector3): void {
    // 1. Smooth Ragdoll-Style Death Collapse & Respawn Timer
    if (!this.isAlive()) {
      this.deathTimer -= dt;
      if (this.deathFallBlend < 1.0) {
        this.deathFallBlend = Math.min(1.0, this.deathFallBlend + dt * 3.6);
        const e = 1 - Math.pow(1 - this.deathFallBlend, 2);
        // Knees buckle first, then body pitches onto sand
        if (this.bones.Hips) {
          this.bones.Hips.position.set(0, THREE.MathUtils.lerp(0.85, 0.52, e), 0);
        }
        this.setBoneRot(this.bones.UpperLeg_L, 0.55 * e, 0, -0.12 * e);
        this.setBoneRot(this.bones.LowerLeg_L, -0.95 * e, 0, 0);
        this.setBoneRot(this.bones.UpperLeg_R, 0.35 * e, 0, 0.14 * e);
        this.setBoneRot(this.bones.LowerLeg_R, -0.75 * e, 0, 0);
        this.root.rotation.set(-Math.PI * 0.47 * e, this.yaw, this.deathSideSign * 0.22 * e);
        this.root.position.set(this.position.x, this.position.y + 0.14 * e, this.position.z);
      }
      if (this.deathTimer < 3.8 && this.root.visible) {
        this.root.visible = false;
      }
      if (this.deathTimer <= 0) {
        this.respawn();
      }
      return;
    }

    this.frameCounter++;
    this.strafeSeed += dt;
    this.recoilKick = Math.max(0, this.recoilKick - dt * 6.5);

    this.retargetGoalTimer -= dt;
    if (this.retargetGoalTimer <= 0) {
      this.pickObjectiveGoal();
    }

    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 0.34 + Math.random() * 0.2;
      this.scanForEnemy();
    }

    if (this.currentEnemy && !this.currentEnemy.isAlive()) {
      this.currentEnemy = null;
    }

    _toGoal.set(this.goalPos.x - this.position.x, 0, this.goalPos.z - this.position.z);
    const distToGoal = _toGoal.length();
    if (distToGoal < 2.4) {
      this.retargetGoalTimer = Math.min(this.retargetGoalTimer, 2.5);
    }

    // 2. Tactical Movement, Smooth Yaw Turning & Stance Selection
    let moveSpeed = 0;
    _moveDir.set(0, 0, 0);
    let desiredYaw = this.yaw;
    let targetAimPitch = 0;
    let wantsCrouch = false;

    if (this.currentEnemy) {
      const ePos = this.currentEnemy.getPosition();
      const dx = ePos.x - this.position.x;
      const dz = ePos.z - this.position.z;
      const dy = ePos.y + this.currentEnemy.getHeight() * 0.6 - (this.position.y + 1.35);
      const flatDist = Math.max(0.1, Math.hypot(dx, dz));
      desiredYaw = Math.atan2(-dx, -dz);
      targetAimPitch = THREE.MathUtils.clamp(Math.atan2(dy, flatDist), -0.48, 0.48);

      if (flatDist > 26 && distToGoal > 3.5) {
        _moveDir.copy(_toGoal).divideScalar(distToGoal);
        moveSpeed = 3.4;
        wantsCrouch = false;
      } else if (Math.sin(this.strafeSeed * 0.85) > 0.1) {
        wantsCrouch = true;
      } else {
        wantsCrouch = false;
        _rightVec.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        const strafeDir = Math.sin(this.strafeSeed * 1.9) >= 0 ? 1 : -1;
        _moveDir.copy(_rightVec).multiplyScalar(strafeDir);
        moveSpeed = 1.85;
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
          this.recoilKick = 0.12;
          this.fireBulletAt(this.currentEnemy, listenerPos);
        }
      }
    } else if (distToGoal > 2.2) {
      _moveDir.copy(_toGoal).divideScalar(distToGoal);
      moveSpeed = 4.65;
      desiredYaw = Math.atan2(-_moveDir.x, -_moveDir.z);
      wantsCrouch = false;
    } else {
      wantsCrouch = true;
    }

    // Smooth human turn rate (no 1-frame 180° teleport snapping!)
    this.yaw = lerpAngleShortest(this.yaw, desiredYaw, dt * 8.5);
    this.smoothAimPitch = THREE.MathUtils.lerp(this.smoothAimPitch, targetAimPitch, Math.min(1, dt * 10));

    // Unstick helper if blocked against wall corner
    this.stuckTimer += dt;
    if (this.stuckTimer >= 1.4) {
      if (moveSpeed > 2.5 && this.position.distanceToSquared(this.lastCheckPos) < 0.12) {
        if (distToGoal > 0.1) {
          _perpVec.set(-_toGoal.z / distToGoal, 0, _toGoal.x / distToGoal);
        } else {
          _perpVec.set(1, 0, 0);
        }
        this.goalPos.copy(this.position).addScaledVector(_perpVec, (Math.random() > 0.5 ? 1 : -1) * 7.5);
      }
      this.lastCheckPos.copy(this.position);
      this.stuckTimer = 0;
    }

    this.velocity.x = _moveDir.x * moveSpeed;
    this.velocity.z = _moveDir.z * moveSpeed;
    this.velocity.y -= 22.0 * dt;

    const res = this.physics.resolveCharacterMovement(this.position, this.velocity, dt, 0.36, 1.72, 0.38);
    if (res.grounded && this.velocity.y < 0) {
      this.velocity.y = 0;
    }

    this.root.position.copy(this.position);
    this.root.rotation.set(0, this.yaw, 0);

    // 3. Advance biomechanical blend weights & stride phase proportional to real ground speed!
    const actualSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const targetMoveBlend = THREE.MathUtils.clamp(actualSpeed / 3.8, 0, 1);
    this.moveBlend = THREE.MathUtils.lerp(this.moveBlend, targetMoveBlend, Math.min(1, dt * 9));
    this.crouchBlend = THREE.MathUtils.lerp(this.crouchBlend, wantsCrouch ? 1 : 0, Math.min(1, dt * 8));

    if (actualSpeed > 0.15) {
      // Check forward vs backward/strafe sign so legs never moonwalk!
      const fwdX = -Math.sin(this.yaw);
      const fwdZ = -Math.cos(this.yaw);
      const rightX = Math.cos(this.yaw);
      const rightZ = -Math.sin(this.yaw);
      const fwdDot = (this.velocity.x * fwdX + this.velocity.z * fwdZ) / actualSpeed;
      const rightDot = (this.velocity.x * rightX + this.velocity.z * rightZ) / actualSpeed;
      const dirSign = fwdDot < -0.25 ? -1 : 1;
      this.strafeRatio = rightDot;
      this.stridePhase = (this.stridePhase + dt * actualSpeed * 2.35 * dirSign) % (Math.PI * 2);
    } else {
      this.strafeRatio = THREE.MathUtils.lerp(this.strafeRatio, 0, Math.min(1, dt * 8));
    }

    // 4. Distance-Based Animation & Shadow LOD
    const distSq = this.position.distanceToSquared(listenerPos);
    const castShad = distSq < 58 * 58;
    for (let i = 0; i < this.skinnedMeshes.length; i++) {
      if (this.skinnedMeshes[i].castShadow !== castShad) {
        this.skinnedMeshes[i].castShadow = castShad;
      }
    }

    if (distSq < 50 * 50) {
      this.applyBiomechanicalPose(dt, true);
    } else if (distSq < 105 * 105) {
      if (this.frameCounter % 3 === 0) {
        this.applyBiomechanicalPose(dt * 3, false);
      }
    } else if (this.frameCounter % 6 === 0) {
      this.applyBiomechanicalPose(dt * 6, false);
    }
  }

  private fireBulletAt(target: DamageableActor, listenerPos: THREE.Vector3): void {
    if (this.rifleMuzzleSocket) {
      this.root.updateMatrixWorld(true);
      this.rifleMuzzleSocket.getWorldPosition(_muzPos);
    } else {
      const fwdX = -Math.sin(this.yaw);
      const fwdZ = -Math.cos(this.yaw);
      _muzPos.set(
        this.position.x + fwdX * 0.72,
        this.position.y + THREE.MathUtils.lerp(1.32, 1.04, this.crouchBlend),
        this.position.z + fwdZ * 0.72
      );
    }

    const tp = target.getPosition();
    _aimVec.set(tp.x, tp.y + target.getHeight() * 0.58, tp.z).sub(_muzPos).normalize();

    const spread = target.id === "PLAYER" ? 0.068 : 0.045;
    _aimVec.x += (Math.random() - 0.5) * spread;
    _aimVec.y += (Math.random() - 0.5) * spread;
    _aimVec.z += (Math.random() - 0.5) * spread;
    _aimVec.normalize();

    const distToPlayer = _muzPos.distanceTo(listenerPos);
    if (distToPlayer < 48) {
      const vol = Math.max(0.03, 0.16 * (1 - distToPlayer / 48));
      this.sfx.playRifleShot(this.team === "NATO" ? 1.04 : 0.92, vol);
    }

    this.physics.spawnProjectile({
      kind: "bullet",
      team: this.team,
      ownerId: this.id,
      weaponName: "M5A3",
      origin: _muzPos,
      direction: _aimVec,
      speed: 145,
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
      this.soldiers.push(
        new AISoldier(name, "NATO", spawn, idx, this.scene, this.assets, this.physics, this.map, this.sfx)
      );
    });

    const paxSpawns = [
      new THREE.Vector3(-5, 0.1, 3),
      new THREE.Vector3(6, 0.1, 2),
      new THREE.Vector3(-2, 3.75, -5),
      new THREE.Vector3(14, 3.75, 7),
      new THREE.Vector3(10, 0.1, -8),
      new THREE.Vector3(-10, 0.1, -12),
      new THREE.Vector3(98, 0.1, 16),
      new THREE.Vector3(106, 0.1, 22),
      new THREE.Vector3(114, 0.1, 18),
      new THREE.Vector3(118, 3.75, 12),
      new THREE.Vector3(-14, 0.1, -100),
      new THREE.Vector3(-20, 0.1, -106),
      new THREE.Vector3(-6, 0.1, -102),
      new THREE.Vector3(52, 0.1, 8),
      new THREE.Vector3(-52, 0.1, 8),
      new THREE.Vector3(-16, 0.1, -48),
    ];
    CALLSIGNS_PAX.forEach((name, idx) => {
      const spawn = paxSpawns[idx % paxSpawns.length];
      this.soldiers.push(
        new AISoldier(name, "PAX", spawn, idx + 14, this.scene, this.assets, this.physics, this.map, this.sfx)
      );
    });
  }

  public update(dt: number, listenerPos: THREE.Vector3): void {
    for (let i = 0; i < this.soldiers.length; i++) {
      this.soldiers[i].update(dt, listenerPos);
    }
  }
}
