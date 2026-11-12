/**
 * Battlefield Tactical Physics, Ballistics, Per-Chunk Wall Destruction,
 * Sticky C4 Charges, Tumbling Debris & Volumetric Blast VFX Engine.
 */

import * as THREE from "three";
import type { AssetLibrary } from "../core/AssetLoader";
import type { SoundFX } from "../audio/SoundFX";

export type Team = "NATO" | "PAX" | "NEUTRAL";

export interface ColliderBox {
  id: number;
  box: THREE.Box3;
  mesh?: THREE.Object3D;
  destructible: boolean;
  hp: number;
  maxHp: number;
  destroyed: boolean;
}

export interface DamageableActor {
  id: string;
  team: Team;
  getPosition(): THREE.Vector3;
  getHitRadius(): number;
  getHeight(): number;
  isAlive(): boolean;
  takeDamage(amount: number, attackerTeam: Team, weaponName: string, isHeadshot: boolean): void;
}

interface FlyingProjectile {
  kind: "bullet" | "rpg" | "tank_shell" | "hydra";
  team: Team;
  ownerId: string;
  weaponName: string;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  damage: number;
  blastRadius: number;
  life: number;
  mesh: THREE.Object3D;
  smokeTimer: number;
}

interface DebrisPiece {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  life: number;
}

interface SmokeParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  scaleRate: number;
  life: number;
  maxLife: number;
}

export interface PlantedC4 {
  mesh: THREE.Object3D;
  stuckTo?: THREE.Object3D;
  localOffset: THREE.Vector3;
  beepTimer: number;
}

export class WorldPhysics {
  public colliders: ColliderBox[] = [];
  public actors: DamageableActor[] = [];
  public plantedC4s: PlantedC4[] = [];

  private nextColliderId = 1;
  private projectiles: FlyingProjectile[] = [];
  private debris: DebrisPiece[] = [];
  private particles: SmokeParticle[] = [];
  private rubblePositions: THREE.Vector2[] = [];
  private cameraShake = 0;

  // Shared lightweight geometries & materials for tracers, debris & blast VFX
  private tracerGeo = new THREE.BoxGeometry(0.035, 0.035, 1.35);
  private matTracerNato = new THREE.MeshBasicMaterial({ color: 0x55f6ff });
  private matTracerPax = new THREE.MeshBasicMaterial({ color: 0xff6633 });
  private matShellGlow = new THREE.MeshBasicMaterial({ color: 0xffbb44 });
  private shellGeo = new THREE.SphereGeometry(0.11, 8, 8);
  private debrisGeo = new THREE.DodecahedronGeometry(0.19, 0);
  private debrisMat = new THREE.MeshStandardMaterial({ color: 0x5a5854, roughness: 0.92 });
  private smokeGeo = new THREE.SphereGeometry(0.45, 8, 8);

  public onPlayerHitConfirm?: (isKill: boolean, victimName: string, weaponName: string, isHeadshot: boolean) => void;
  public onPlayerScoreEvent?: (label: string, points: number) => void;

  constructor(
    private scene: THREE.Scene,
    private assets: AssetLibrary,
    private sfx: SoundFX
  ) {}

  public consumeCameraShake(dt: number): number {
    const s = this.cameraShake;
    this.cameraShake = Math.max(0, this.cameraShake - dt * 2.8);
    return s;
  }

  public addCameraShake(amount: number): void {
    this.cameraShake = Math.min(1.2, this.cameraShake + amount);
  }

  /**
   * Traverse an instantiated prefab hierarchy and register accurate world-space Box3 colliders
   * for every intact structural mesh and destructible Voronoi wall chunk.
   */
  public registerPrefabHierarchy(root: THREE.Object3D, skipColliderNames: string[] = []): void {
    root.updateMatrixWorld(true);
    root.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      if (!obj.visible) return;
      if (skipColliderNames.some((s) => obj.name.includes(s))) return;

      // Skip soft Conquest flag banner
      if (obj.name.includes("Banner")) return;

      // Special staircase handling: register 14 stepped walk-up boxes instead of one giant AABB!
      if (obj.name.includes("BLD_Stairs_4m")) {
        this.registerStairSteps(root);
        return;
      }

      const box = new THREE.Box3().setFromObject(obj);
      if (box.isEmpty()) return;

      const ud = obj.userData || {};
      const parentUd = obj.parent?.userData || {};
      const isDestructible = Boolean(
        ud.destructible === true ||
          obj.name.includes("Chunk_") ||
          obj.name.includes("Seg_") ||
          obj.name.includes("Cell_") ||
          obj.name.includes("Frame") ||
          parentUd.destructible === true
      );
      const hp = Number(ud.hp || parentUd.hp || (isDestructible ? 130 : 99999));

      this.colliders.push({
        id: this.nextColliderId++,
        box,
        mesh: obj,
        destructible: isDestructible,
        hp,
        maxHp: hp,
        destroyed: false,
      });
    });
  }

  private registerStairSteps(stairsRoot: THREE.Object3D): void {
    stairsRoot.updateMatrixWorld(true);
    const nSteps = 14;
    const runTotal = 3.8;
    const riseTotal = 3.6;
    const dx = runTotal / nSteps;
    const dz = riseTotal / nSteps;

    // In Blender: X in [-1.9..+1.9], Z in [0..3.6], Y in [-0.8..+0.8]
    // After export_yup=True: local X -> X, local Z -> Y (up!), local Y -> -Z
    for (let i = 0; i < nSteps; i++) {
      const lx = -1.9 + (i + 0.5) * dx;
      const ly = (i + 0.5) * dz;
      const half = new THREE.Vector3(dx * 0.55, dz * 0.52, 0.82);
      const corners = [
        new THREE.Vector3(lx - half.x, ly - half.y, -half.z),
        new THREE.Vector3(lx + half.x, ly + half.y, half.z),
        new THREE.Vector3(lx - half.x, ly + half.y, -half.z),
        new THREE.Vector3(lx + half.x, ly - half.y, half.z),
      ];
      const stepBox = new THREE.Box3();
      for (const c of corners) {
        c.applyMatrix4(stairsRoot.matrixWorld);
        stepBox.expandByPoint(c);
      }
      this.colliders.push({
        id: this.nextColliderId++,
        box: stepBox,
        destructible: false,
        hp: 99999,
        maxHp: 99999,
        destroyed: false,
      });
    }
  }

  public addManualBox(box: THREE.Box3): void {
    this.colliders.push({
      id: this.nextColliderId++,
      box,
      destructible: false,
      hp: 99999,
      maxHp: 99999,
      destroyed: false,
    });
  }

  /**
   * Smooth Capsule / Cylinder Character Collision with automatic stair & curb stepping!
   */
  public resolveCharacterMovement(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    dt: number,
    radius = 0.36,
    height = 1.72,
    stepHeight = 0.36
  ): { grounded: boolean } {
    // 1. Horizontal XZ movement & wall sliding
    pos.x += vel.x * dt;
    this.pushOutHorizontal(pos, radius, height, stepHeight);

    pos.z += vel.z * dt;
    this.pushOutHorizontal(pos, radius, height, stepHeight);

    // Keep inside 190m x 190m battlefield boundary
    pos.x = THREE.MathUtils.clamp(pos.x, -92, 92);
    pos.z = THREE.MathUtils.clamp(pos.z, -92, 92);

    // 2. Vertical gravity, floor landing & step-up support
    pos.y += vel.y * dt;
    let supportY = 0.0; // Base ground plane at Y = 0

    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      if (c.destroyed) continue;
      const b = c.box;
      if (pos.x + radius <= b.min.x || pos.x - radius >= b.max.x) continue;
      if (pos.z + radius <= b.min.z || pos.z - radius >= b.max.z) continue;

      // Floor / Stair top support if player feet were above or within stepHeight of b.max.y
      if (b.max.y <= pos.y + stepHeight && b.max.y > supportY) {
        // Ensure headroom above b.max.y isn't blocked
        supportY = b.max.y;
      }
      // Ceiling hit check
      if (vel.y > 0 && pos.y + height > b.min.y && pos.y < b.min.y) {
        pos.y = b.min.y - height;
        vel.y = 0;
      }
    }

    let grounded = false;
    if (pos.y <= supportY + 0.02 && vel.y <= 0.05) {
      // Smoothly step up onto stairs/curbs
      if (supportY > pos.y) {
        pos.y = THREE.MathUtils.lerp(pos.y, supportY, Math.min(1, dt * 22));
        if (Math.abs(supportY - pos.y) < 0.02) pos.y = supportY;
      } else {
        pos.y = supportY;
      }
      vel.y = 0;
      grounded = true;
    }

    return { grounded };
  }

  private pushOutHorizontal(pos: THREE.Vector3, radius: number, height: number, stepHeight: number): void {
    const yMin = pos.y + stepHeight;
    const yMax = pos.y + height;
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      if (c.destroyed) continue;
      const b = c.box;
      if (yMax <= b.min.y || yMin >= b.max.y) continue;

      const cx = THREE.MathUtils.clamp(pos.x, b.min.x, b.max.x);
      const cz = THREE.MathUtils.clamp(pos.z, b.min.z, b.max.z);
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const distSq = dx * dx + dz * dz;

      if (distSq < radius * radius) {
        if (distSq > 1e-6) {
          const dist = Math.sqrt(distSq);
          const overlap = radius - dist;
          pos.x += (dx / dist) * overlap;
          pos.z += (dz / dist) * overlap;
        } else {
          // Inside AABB: push out along shallowest axis
          const ox1 = pos.x - b.min.x + radius;
          const ox2 = b.max.x - pos.x + radius;
          const oz1 = pos.z - b.min.z + radius;
          const oz2 = b.max.z - pos.z + radius;
          const m = Math.min(ox1, ox2, oz1, oz2);
          if (m === ox1) pos.x = b.min.x - radius;
          else if (m === ox2) pos.x = b.max.x + radius;
          else if (m === oz1) pos.z = b.min.z - radius;
          else pos.z = b.max.z + radius;
        }
      }
    }
  }

  /**
   * Spawn a ballistic bullet/tracer or heavy explosive rocket/shell.
   */
  public spawnProjectile(opts: {
    kind: "bullet" | "rpg" | "tank_shell" | "hydra";
    team: Team;
    ownerId: string;
    weaponName: string;
    origin: THREE.Vector3;
    direction: THREE.Vector3;
    speed: number;
    damage: number;
    blastRadius?: number;
    gravity?: number;
  }): void {
    const dir = opts.direction.clone().normalize();
    let mesh: THREE.Object3D;

    if (opts.kind === "bullet") {
      mesh = new THREE.Mesh(this.tracerGeo, opts.team === "NATO" ? this.matTracerNato : this.matTracerPax);
      mesh.position.copy(opts.origin);
      mesh.lookAt(opts.origin.clone().add(dir));
    } else if (opts.kind === "rpg") {
      mesh = this.assets.cloneStatic("WPN_Launcher_RPG7V2");
      // Show only warhead or scale compactly for flying rocket
      mesh.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.name.includes("Tube")) o.visible = false;
      });
      mesh.position.copy(opts.origin);
      mesh.lookAt(opts.origin.clone().sub(dir));
    } else {
      mesh = new THREE.Mesh(this.shellGeo, this.matShellGlow);
      mesh.position.copy(opts.origin);
    }

    this.scene.add(mesh);
    this.projectiles.push({
      kind: opts.kind,
      team: opts.team,
      ownerId: opts.ownerId,
      weaponName: opts.weaponName,
      pos: opts.origin.clone(),
      vel: dir.multiplyScalar(opts.speed),
      gravity: opts.gravity ?? (opts.kind === "bullet" ? 2.5 : 4.8),
      damage: opts.damage,
      blastRadius: opts.blastRadius ?? 0,
      life: opts.kind === "bullet" ? 1.6 : 5.0,
      mesh,
      smokeTimer: 0,
    });
  }

  /**
   * Throw and stick a C4 Breach Pack onto world geometry or vehicles!
   */
  public throwStickyC4(origin: THREE.Vector3, dir: THREE.Vector3): void {
    const ray = new THREE.Ray(origin, dir.clone().normalize());
    let bestDist = 4.2;
    let hitPoint = origin.clone().addScaledVector(dir, 2.8);
    let stuckObj: THREE.Object3D | undefined;

    // Check vehicle / actor hit first ("Jeep / Tank C4!")
    const vTmp = new THREE.Vector3();
    for (const c of this.colliders) {
      if (c.destroyed) continue;
      if (ray.intersectBox(c.box, vTmp)) {
        const d = origin.distanceTo(vTmp);
        if (d < bestDist) {
          bestDist = d;
          hitPoint.copy(vTmp);
          stuckObj = c.mesh;
        }
      }
    }
    if (hitPoint.y < 0.04) hitPoint.y = 0.04;

    const c4Mesh = this.assets.cloneStatic("GAD_C4_BreachPack");
    c4Mesh.position.copy(hitPoint);
    this.scene.add(c4Mesh);
    this.sfx.playC4Beep();

    const localOffset = new THREE.Vector3();
    if (stuckObj) {
      stuckObj.updateMatrixWorld(true);
      localOffset.copy(hitPoint);
      stuckObj.worldToLocal(localOffset);
    }

    this.plantedC4s.push({
      mesh: c4Mesh,
      stuckTo: stuckObj,
      localOffset,
      beepTimer: 0.6,
    });
  }

  public detonateAllC4(ownerTeam: Team, ownerId: string): number {
    const count = this.plantedC4s.length;
    if (count === 0) return 0;

    const charges = [...this.plantedC4s];
    this.plantedC4s.length = 0;

    charges.forEach((c4, idx) => {
      const blastPos = c4.mesh.position.clone();
      this.scene.remove(c4.mesh);
      setTimeout(() => {
        this.triggerExplosion(blastPos, 6.2, 750, ownerTeam, ownerId, "C4 BREACH");
      }, idx * 110);
    });
    return count;
  }

  /**
   * Trigger a Battlefield radial explosion: shatters Voronoi wall chunks,
   * spawns flying concrete debris & rubble piles, damages vehicles & infantry!
   */
  public triggerExplosion(
    center: THREE.Vector3,
    radius: number,
    maxDamage: number,
    attackerTeam: Team,
    ownerId: string,
    weaponName: string
  ): void {
    this.sfx.playExplosion(radius / 4.5);
    this.spawnBlastVFX(center, radius);

    // Camera shake scaled by proximity to active camera
    this.addCameraShake(Math.min(0.85, (radius * 0.14)));

    let chunksBreached = 0;
    const chunkCenter = new THREE.Vector3();

    // 1. Damage destructible building wall chunks & cover
    for (let i = 0; i < this.colliders.length; i++) {
      const col = this.colliders[i];
      if (col.destroyed || !col.destructible) continue;

      col.box.clampPoint(center, chunkCenter);
      const dist = chunkCenter.distanceTo(center);
      if (dist <= radius) {
        const falloff = 1.0 - (dist / radius) * 0.72;
        col.hp -= maxDamage * falloff;
        if (col.hp <= 0) {
          col.destroyed = true;
          if (col.mesh) col.mesh.visible = false;
          col.box.getCenter(chunkCenter);
          this.spawnConcreteDebris(chunkCenter, center, 6);
          this.maybeSpawnGroundRubble(chunkCenter);
          chunksBreached++;
        }
      }
    }

    if (chunksBreached > 0 && ownerId === "PLAYER") {
      this.onPlayerScoreEvent?.(`摧毁战术掩体/墙体 x${chunksBreached}`, chunksBreached * 25);
    }

    // 2. Splash damage to Soldiers & Vehicles
    for (const actor of this.actors) {
      if (!actor.isAlive()) continue;
      const aPos = actor.getPosition().clone();
      aPos.y += actor.getHeight() * 0.5;
      const dist = aPos.distanceTo(center);
      if (dist <= radius + actor.getHitRadius()) {
        const effDist = Math.max(0, dist - actor.getHitRadius());
        const falloff = Math.max(0.15, 1.0 - effDist / (radius + 0.5));
        const dmg = Math.round(maxDamage * falloff);
        const wasAlive = actor.isAlive();
        actor.takeDamage(dmg, attackerTeam, weaponName, false);
        if (ownerId === "PLAYER" && actor.team !== attackerTeam && actor.id !== "PLAYER") {
          const killed = wasAlive && !actor.isAlive();
          this.onPlayerHitConfirm?.(killed, actor.id, weaponName, false);
        }
      }
    }
  }

  private maybeSpawnGroundRubble(breachPos: THREE.Vector3): void {
    if (breachPos.y > 5.8) return;
    const p2 = new THREE.Vector2(breachPos.x, breachPos.z);
    for (const existing of this.rubblePositions) {
      if (existing.distanceTo(p2) < 2.2) return;
    }
    this.rubblePositions.push(p2);
    const rubble = this.assets.cloneStatic("BLD_Rubble_Pile");
    rubble.position.set(breachPos.x, 0.0, breachPos.z);
    rubble.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(rubble);
  }

  private spawnConcreteDebris(origin: THREE.Vector3, blastCenter: THREE.Vector3, count: number): void {
    const outDir = origin.clone().sub(blastCenter);
    if (outDir.lengthSq() < 0.01) outDir.set(0, 1, 0);
    outDir.normalize();

    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.debrisGeo, this.debrisMat);
      m.castShadow = true;
      m.scale.set(0.6 + Math.random() * 0.9, 0.5 + Math.random() * 0.7, 0.6 + Math.random() * 0.9);
      m.position.copy(origin).add(
        new THREE.Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8)
      );
      this.scene.add(m);

      const vel = outDir
        .clone()
        .multiplyScalar(5 + Math.random() * 9)
        .add(new THREE.Vector3((Math.random() - 0.5) * 7, 3 + Math.random() * 6, (Math.random() - 0.5) * 7));

      this.debris.push({
        mesh: m,
        vel,
        angVel: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
        life: 3.2 + Math.random() * 1.5,
      });
    }
  }

  private spawnBlastVFX(center: THREE.Vector3, radius: number): void {
    // Bright fireball flash + rising dark smoke spheres
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.95 });
    const flash = new THREE.Mesh(this.smokeGeo, flashMat);
    flash.position.copy(center);
    flash.scale.setScalar(radius * 0.45);
    this.scene.add(flash);
    this.particles.push({
      mesh: flash,
      vel: new THREE.Vector3(0, 1.5, 0),
      scaleRate: radius * 3.2,
      life: 0.22,
      maxLife: 0.22,
    });

    for (let i = 0; i < 8; i++) {
      const shade = 0.16 + Math.random() * 0.18;
      const smMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(shade, shade, shade),
        transparent: true,
        opacity: 0.75,
      });
      const sm = new THREE.Mesh(this.smokeGeo, smMat);
      sm.position.copy(center).add(
        new THREE.Vector3((Math.random() - 0.5) * radius * 0.5, Math.random() * 0.8, (Math.random() - 0.5) * radius * 0.5)
      );
      sm.scale.setScalar(0.6 + Math.random() * 0.7);
      this.scene.add(sm);
      const maxL = 1.3 + Math.random() * 0.9;
      this.particles.push({
        mesh: sm,
        vel: new THREE.Vector3((Math.random() - 0.5) * 2.5, 2.8 + Math.random() * 3.2, (Math.random() - 0.5) * 2.5),
        scaleRate: 1.8,
        life: maxL,
        maxLife: maxL,
      });
    }
  }

  private spawnImpactSpark(pt: THREE.Vector3): void {
    const spMat = new THREE.MeshBasicMaterial({ color: 0xffdd77, transparent: true, opacity: 0.9 });
    const sp = new THREE.Mesh(this.shellGeo, spMat);
    sp.position.copy(pt);
    sp.scale.setScalar(0.7);
    this.scene.add(sp);
    this.particles.push({
      mesh: sp,
      vel: new THREE.Vector3(0, 0.8, 0),
      scaleRate: 2.2,
      life: 0.12,
      maxLife: 0.12,
    });
  }

  public update(dt: number): void {
    // 1. Update Planted Sticky C4s
    for (const c4 of this.plantedC4s) {
      if (c4.stuckTo) {
        if (!c4.stuckTo.visible) {
          c4.stuckTo = undefined;
        } else {
          c4.mesh.position.copy(c4.localOffset).applyMatrix4(c4.stuckTo.matrixWorld);
        }
      }
      c4.beepTimer -= dt;
      if (c4.beepTimer <= 0) {
        c4.beepTimer = 1.1;
      }
    }

    // 2. Step Projectiles & Ray-Segment Hit Detection
    const nextPos = new THREE.Vector3();
    const segDir = new THREE.Vector3();
    const hitPt = new THREE.Vector3();
    const ray = new THREE.Ray();

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
        continue;
      }

      p.vel.y -= p.gravity * dt;
      nextPos.copy(p.pos).addScaledVector(p.vel, dt);
      segDir.copy(nextPos).sub(p.pos);
      const segLen = segDir.length();

      if (segLen > 1e-5) {
        segDir.divideScalar(segLen);
        ray.set(p.pos, segDir);

        let hitDist = segLen + 1;
        let hitKind: "none" | "ground" | "world" | "actor" = "none";
        let hitCollider: ColliderBox | undefined;
        let hitActor: DamageableActor | undefined;
        let hitPosition = nextPos.clone();

        // Ground plane check (Y = 0)
        if (nextPos.y <= 0.02 && p.pos.y > 0.02) {
          const tGnd = (p.pos.y - 0.02) / Math.max(1e-4, p.pos.y - nextPos.y);
          const dGnd = tGnd * segLen;
          if (dGnd < hitDist) {
            hitDist = dGnd;
            hitKind = "ground";
            hitPosition.copy(p.pos).addScaledVector(segDir, dGnd);
          }
        }

        // World Box3 colliders
        for (let cIdx = 0; cIdx < this.colliders.length; cIdx++) {
          const col = this.colliders[cIdx];
          if (col.destroyed) continue;
          if (ray.intersectBox(col.box, hitPt)) {
            const d = p.pos.distanceTo(hitPt);
            if (d <= segLen && d < hitDist) {
              hitDist = d;
              hitKind = "world";
              hitCollider = col;
              hitPosition.copy(hitPt);
            }
          }
        }

        // Actors (Enemy Soldiers & Vehicles)
        for (const actor of this.actors) {
          if (!actor.isAlive() || actor.id === p.ownerId || actor.team === p.team) continue;
          const aPos = actor.getPosition();
          const aRad = actor.getHitRadius();
          const aH = actor.getHeight();
          const actorBox = new THREE.Box3(
            new THREE.Vector3(aPos.x - aRad, aPos.y, aPos.z - aRad),
            new THREE.Vector3(aPos.x + aRad, aPos.y + aH, aPos.z + aRad)
          );
          if (ray.intersectBox(actorBox, hitPt)) {
            const d = p.pos.distanceTo(hitPt);
            if (d <= segLen && d < hitDist) {
              hitDist = d;
              hitKind = "actor";
              hitActor = actor;
              hitPosition.copy(hitPt);
            }
          }
        }

        if (hitKind !== "none") {
          if (p.blastRadius > 0) {
            this.triggerExplosion(hitPosition, p.blastRadius, p.damage, p.team, p.ownerId, p.weaponName);
          } else {
            this.spawnImpactSpark(hitPosition);
            if (hitKind === "actor" && hitActor) {
              const isHeadshot = hitActor.getHeight() < 2.1 && hitPosition.y > hitActor.getPosition().y + 1.44;
              const finalDmg = isHeadshot ? Math.round(p.damage * 2.2) : p.damage;
              const wasAlive = hitActor.isAlive();
              hitActor.takeDamage(finalDmg, p.team, p.weaponName, isHeadshot);
              if (p.ownerId === "PLAYER") {
                const killed = wasAlive && !hitActor.isAlive();
                this.sfx.playHitmarker(killed);
                this.onPlayerHitConfirm?.(killed, hitActor.id, p.weaponName, isHeadshot);
              }
            } else if (hitKind === "world" && hitCollider && hitCollider.destructible) {
              // Heavy bullets (.50 cal / Sniper) chip away destructible sandbags & window frames!
              hitCollider.hp -= p.damage * 0.22;
              if (hitCollider.hp <= 0) {
                hitCollider.destroyed = true;
                if (hitCollider.mesh) hitCollider.mesh.visible = false;
                const cc = new THREE.Vector3();
                hitCollider.box.getCenter(cc);
                this.spawnConcreteDebris(cc, p.pos, 4);
              }
            }
          }

          this.scene.remove(p.mesh);
          this.projectiles.splice(i, 1);
          continue;
        }
      }

      // Advance rocket/bullet & emit rocket smoke trail
      p.pos.copy(nextPos);
      p.mesh.position.copy(p.pos);
      if (p.kind !== "bullet") {
        p.smokeTimer -= dt;
        if (p.smokeTimer <= 0) {
          p.smokeTimer = 0.025;
          const smMat = new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.45 });
          const sm = new THREE.Mesh(this.smokeGeo, smMat);
          sm.position.copy(p.pos);
          sm.scale.setScalar(0.28);
          this.scene.add(sm);
          this.particles.push({
            mesh: sm,
            vel: new THREE.Vector3(0, 0.6, 0),
            scaleRate: 0.9,
            life: 0.55,
            maxLife: 0.55,
          });
        }
      }
    }

    // 3. Step Tumbling Concrete Debris
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        this.debris.splice(i, 1);
        continue;
      }
      d.vel.y -= 19.5 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.angVel.x * dt;
      d.mesh.rotation.y += d.angVel.y * dt;
      d.mesh.rotation.z += d.angVel.z * dt;
      if (d.mesh.position.y < 0.12) {
        d.mesh.position.y = 0.12;
        d.vel.y *= -0.35;
        d.vel.x *= 0.72;
        d.vel.z *= 0.72;
        d.angVel.multiplyScalar(0.7);
      }
    }

    // 4. Step Explosion & Smoke Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        this.scene.remove(pt.mesh);
        (pt.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      pt.mesh.position.addScaledVector(pt.vel, dt);
      pt.mesh.scale.addScalar(pt.scaleRate * dt);
      const mat = pt.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, (pt.life / pt.maxLife) * 0.8);
    }
  }
}
