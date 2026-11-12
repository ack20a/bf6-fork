/**
 * Battlefield Tactical Physics, Converged Ballistics, Per-Chunk Wall Destruction,
 * Sticky C4 Charges, Tumbling Debris & Zero-Allocation Volumetric Blast VFX Engine.
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
  baseScale: number;
  scaleRate: number;
  life: number;
  maxLife: number;
  shrinkAtEnd: boolean;
}

export interface PlantedC4 {
  mesh: THREE.Object3D;
  stuckTo?: THREE.Object3D;
  localOffset: THREE.Vector3;
  beepTimer: number;
}

export class WorldPhysics {
  public colliders: ColliderBox[] = [];
  public dynamicColliders: ColliderBox[] = [];
  public actors: DamageableActor[] = [];
  public plantedC4s: PlantedC4[] = [];

  private nextColliderId = 1;
  private readonly cellSize = 16;
  private spatialGrid = new Map<number, ColliderBox[]>();
  private queryStamp = 1;
  private seenStamp = new Map<number, number>();
  private queryBuf: ColliderBox[] = [];
  private rayQueryBuf: ColliderBox[] = [];

  private projectiles: FlyingProjectile[] = [];
  private debris: DebrisPiece[] = [];
  private particles: SmokeParticle[] = [];
  private rubblePositions: THREE.Vector2[] = [];
  private cameraShake = 0;

  // Shared lightweight geometries & pooled materials (zero shader/GC churn!)
  private tracerGeo: THREE.BoxGeometry;
  private matTracerNato = new THREE.MeshBasicMaterial({ color: 0x6bf8ff });
  private matTracerPax = new THREE.MeshBasicMaterial({ color: 0xff6833 });
  private matShellGlow = new THREE.MeshBasicMaterial({ color: 0xffbb44 });
  private matBlastFlash = new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.9 });
  private matImpactSpark = new THREE.MeshBasicMaterial({ color: 0xffe082 });
  private matRocketTrail = new THREE.MeshBasicMaterial({ color: 0xa8a49c, transparent: true, opacity: 0.42, depthWrite: false });
  private matBlastSmokes = [
    new THREE.MeshBasicMaterial({ color: 0x282828, transparent: true, opacity: 0.65, depthWrite: false }),
    new THREE.MeshBasicMaterial({ color: 0x383634, transparent: true, opacity: 0.6, depthWrite: false }),
    new THREE.MeshBasicMaterial({ color: 0x4a4640, transparent: true, opacity: 0.55, depthWrite: false }),
  ];
  private shellGeo = new THREE.SphereGeometry(0.1, 6, 6);
  private debrisGeo = new THREE.DodecahedronGeometry(0.19, 0);
  private debrisMat = new THREE.MeshStandardMaterial({ color: 0x5a5854, roughness: 0.92 });
  private smokeGeo = new THREE.SphereGeometry(0.45, 7, 6);

  // Pre-allocated scratch math objects for zero-GC hot loops
  private readonly _nextPos = new THREE.Vector3();
  private readonly _segDir = new THREE.Vector3();
  private readonly _hitPt = new THREE.Vector3();
  private readonly _bestHitPt = new THREE.Vector3();
  private readonly _lookTarget = new THREE.Vector3();
  private readonly _actorBox = new THREE.Box3();
  private readonly _ray = new THREE.Ray();
  private readonly _aimRay = new THREE.Ray();
  private readonly _aimHit = new THREE.Vector3();
  private readonly _aimBox = new THREE.Box3();

  public onPlayerHitConfirm?: (isKill: boolean, victimName: string, weaponName: string, isHeadshot: boolean) => void;
  public onPlayerScoreEvent?: (label: string, points: number) => void;

  constructor(
    private scene: THREE.Scene,
    private assets: AssetLibrary,
    private sfx: SoundFX
  ) {
    // Translate tracer geometry +Z by half its length so tail starts cleanly at gun muzzle (never behind camera!)
    this.tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 0.9);
    this.tracerGeo.translate(0, 0, 0.45);
  }

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
  public registerPrefabHierarchy(
    root: THREE.Object3D,
    skipColliderNames: string[] = [],
    keepMeshRef = true
  ): void {
    root.updateMatrixWorld(true);
    root.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      if (!obj.visible) return;
      if (skipColliderNames.some((s) => obj.name.includes(s))) return;
      if (obj.name.includes("Banner")) return;

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

      const col: ColliderBox = {
        id: this.nextColliderId++,
        box,
        mesh: keepMeshRef ? obj : undefined,
        destructible: isDestructible,
        hp,
        maxHp: hp,
        destroyed: false,
      };
      this.addStaticCollider(col);
    });
  }

  private addStaticCollider(col: ColliderBox): void {
    this.colliders.push(col);
    const cs = this.cellSize;
    const x0 = Math.floor(col.box.min.x / cs);
    const x1 = Math.floor(col.box.max.x / cs);
    const z0 = Math.floor(col.box.min.z / cs);
    const z1 = Math.floor(col.box.max.z / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = ((cx + 512) << 10) | ((cz + 512) & 1023);
        let bucket = this.spatialGrid.get(key);
        if (!bucket) {
          bucket = [];
          this.spatialGrid.set(key, bucket);
        }
        bucket.push(col);
      }
    }
  }

  public addDynamicCollider(col: ColliderBox): void {
    this.colliders.push(col);
    this.dynamicColliders.push(col);
  }

  public queryNearbyColliders(minX: number, minZ: number, maxX: number, maxZ: number, out = this.queryBuf): ColliderBox[] {
    out.length = 0;
    const stamp = ++this.queryStamp;
    const cs = this.cellSize;
    const x0 = Math.floor(minX / cs);
    const x1 = Math.floor(maxX / cs);
    const z0 = Math.floor(minZ / cs);
    const z1 = Math.floor(maxZ / cs);

    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = ((cx + 512) << 10) | ((cz + 512) & 1023);
        const bucket = this.spatialGrid.get(key);
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const c = bucket[i];
          if (!c.destroyed && this.seenStamp.get(c.id) !== stamp) {
            this.seenStamp.set(c.id, stamp);
            out.push(c);
          }
        }
      }
    }
    for (let i = 0; i < this.dynamicColliders.length; i++) {
      const dc = this.dynamicColliders[i];
      if (!dc.destroyed) out.push(dc);
    }
    return out;
  }

  /**
   * Fast center-screen camera raycast so bullets spawned at the 3D weapon muzzle
   * converge accurately onto the exact point under the player's crosshair!
   */
  public raycastAimTarget(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    ignoreId: string,
    ignoreTeam: Team,
    outTarget: THREE.Vector3
  ): THREE.Vector3 {
    this._aimRay.set(origin, dir);
    let bestDist = maxDist;

    // 1. Ground plane intersection (Y = 0)
    if (dir.y < -1e-4 && origin.y > 0.02) {
      const dGnd = -origin.y / dir.y;
      if (dGnd > 0.2 && dGnd < bestDist) {
        bestDist = dGnd;
      }
    }

    // 2. Step along ray in 28m segments through spatial hash grid (stops immediately on first hit segment)
    const stepLen = 28;
    for (let t0 = 0; t0 < bestDist; t0 += stepLen) {
      const t1 = Math.min(bestDist, t0 + stepLen);
      const ax = origin.x + dir.x * t0;
      const az = origin.z + dir.z * t0;
      const bx = origin.x + dir.x * t1;
      const bz = origin.z + dir.z * t1;
      const cols = this.queryNearbyColliders(
        Math.min(ax, bx) - 0.5,
        Math.min(az, bz) - 0.5,
        Math.max(ax, bx) + 0.5,
        Math.max(az, bz) + 0.5,
        this.rayQueryBuf
      );
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (c.destroyed) continue;
        if (this._aimRay.intersectBox(c.box, this._aimHit)) {
          const d = origin.distanceTo(this._aimHit);
          if (d > 0.15 && d < bestDist) {
            bestDist = d;
          }
        }
      }
      if (bestDist <= t1) break;
    }

    // 3. Check live enemy actors so crosshair aim onto soldiers/vehicles converges tightly
    for (let i = 0; i < this.actors.length; i++) {
      const actor = this.actors[i];
      if (!actor.isAlive() || actor.id === ignoreId || actor.team === ignoreTeam) continue;
      const aPos = actor.getPosition();
      const aRad = actor.getHitRadius();
      const aH = actor.getHeight();
      this._aimBox.min.set(aPos.x - aRad, aPos.y, aPos.z - aRad);
      this._aimBox.max.set(aPos.x + aRad, aPos.y + aH, aPos.z + aRad);
      if (this._aimRay.intersectBox(this._aimBox, this._aimHit)) {
        const d = origin.distanceTo(this._aimHit);
        if (d > 0.15 && d < bestDist) {
          bestDist = d;
        }
      }
    }

    return outTarget.copy(origin).addScaledVector(dir, bestDist);
  }

  /**
   * Prevent muzzle clipping through thin walls when player stands pressed right against cover.
   */
  public isSegmentBlocked(from: THREE.Vector3, to: THREE.Vector3): boolean {
    this._segDir.copy(to).sub(from);
    const len = this._segDir.length();
    if (len < 1e-4) return false;
    this._segDir.divideScalar(len);
    this._aimRay.set(from, this._segDir);

    const cols = this.queryNearbyColliders(
      Math.min(from.x, to.x) - 0.2,
      Math.min(from.z, to.z) - 0.2,
      Math.max(from.x, to.x) + 0.2,
      Math.max(from.z, to.z) + 0.2,
      this.rayQueryBuf
    );
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.destroyed || c.id >= 90000) continue;
      if (c.box.containsPoint(to)) return true;
      if (this._aimRay.intersectBox(c.box, this._aimHit)) {
        if (from.distanceTo(this._aimHit) <= len + 0.05) return true;
      }
    }
    return false;
  }

  private registerStairSteps(stairsRoot: THREE.Object3D): void {
    stairsRoot.updateMatrixWorld(true);
    const nSteps = 14;
    const runTotal = 3.8;
    const riseTotal = 3.6;
    const dx = runTotal / nSteps;
    const dz = riseTotal / nSteps;

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
      this.addStaticCollider({
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
    this.addStaticCollider({
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
    pos.x += vel.x * dt;
    this.pushOutHorizontal(pos, radius, height, stepHeight);

    pos.z += vel.z * dt;
    this.pushOutHorizontal(pos, radius, height, stepHeight);

    pos.x = THREE.MathUtils.clamp(pos.x, -215, 215);
    pos.z = THREE.MathUtils.clamp(pos.z, -215, 215);

    pos.y += vel.y * dt;
    let supportY = 0.0;
    const near = this.queryNearbyColliders(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius);

    for (let i = 0; i < near.length; i++) {
      const c = near[i];
      if (c.destroyed) continue;
      const b = c.box;
      if (pos.x + radius <= b.min.x || pos.x - radius >= b.max.x) continue;
      if (pos.z + radius <= b.min.z || pos.z - radius >= b.max.z) continue;

      if (b.max.y <= pos.y + stepHeight && b.max.y > supportY) {
        supportY = b.max.y;
      }
      if (vel.y > 0 && pos.y + height > b.min.y && pos.y < b.min.y) {
        pos.y = b.min.y - height;
        vel.y = 0;
      }
    }

    let grounded = false;
    if (pos.y <= supportY + 0.02 && vel.y <= 0.05) {
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
    const near = this.queryNearbyColliders(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius);
    for (let i = 0; i < near.length; i++) {
      const c = near[i];
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
   * Spawn a ballistic bullet/tracer or heavy explosive rocket/shell from true weapon muzzle.
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
      this._lookTarget.copy(opts.origin).add(dir);
      mesh.lookAt(this._lookTarget);
    } else if (opts.kind === "rpg") {
      mesh = this.assets.cloneStatic("WPN_Launcher_RPG7V2");
      mesh.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.name.includes("Tube")) o.visible = false;
      });
      mesh.position.copy(opts.origin);
      this._lookTarget.copy(opts.origin).sub(dir);
      mesh.lookAt(this._lookTarget);
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
      gravity: opts.gravity ?? (opts.kind === "bullet" ? 2.2 : 4.6),
      damage: opts.damage,
      blastRadius: opts.blastRadius ?? 0,
      life: opts.kind === "bullet" ? 1.5 : 4.8,
      mesh,
      smokeTimer: 0,
    });
  }

  public throwStickyC4(origin: THREE.Vector3, dir: THREE.Vector3): void {
    const normDir = dir.clone().normalize();
    const ray = new THREE.Ray(origin, normDir);
    let bestDist = 4.2;
    const hitPoint = origin.clone().addScaledVector(normDir, 2.8);
    let stuckObj: THREE.Object3D | undefined;

    const near = this.queryNearbyColliders(origin.x - 4.5, origin.z - 4.5, origin.x + 4.5, origin.z + 4.5);
    const vTmp = new THREE.Vector3();
    for (let i = 0; i < near.length; i++) {
      const c = near[i];
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
    this.addCameraShake(Math.min(0.85, radius * 0.14));

    let chunksBreached = 0;
    const chunkCenter = new THREE.Vector3();

    // Spatial-grid broadphase for blast damage instead of scanning all 2,000+ colliders!
    const nearCols = this.queryNearbyColliders(
      center.x - radius - 1,
      center.z - radius - 1,
      center.x + radius + 1,
      center.z + radius + 1,
      this.rayQueryBuf
    );
    for (let i = 0; i < nearCols.length; i++) {
      const col = nearCols[i];
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
          this.spawnConcreteDebris(chunkCenter, center, 5);
          this.maybeSpawnGroundRubble(chunkCenter);
          chunksBreached++;
        }
      }
    }

    if (chunksBreached > 0 && ownerId === "PLAYER") {
      this.onPlayerScoreEvent?.(`摧毁战术掩体/墙体 x${chunksBreached}`, chunksBreached * 25);
    }

    const aPos = new THREE.Vector3();
    for (let i = 0; i < this.actors.length; i++) {
      const actor = this.actors[i];
      if (!actor.isAlive()) continue;
      aPos.copy(actor.getPosition());
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
    if (this.debris.length > 48) return; // Cap active debris for locked high FPS
    const outDir = origin.clone().sub(blastCenter);
    if (outDir.lengthSq() < 0.01) outDir.set(0, 1, 0);
    outDir.normalize();

    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.debrisGeo, this.debrisMat);
      m.castShadow = false;
      m.scale.set(0.6 + Math.random() * 0.9, 0.5 + Math.random() * 0.7, 0.6 + Math.random() * 0.9);
      m.position.set(
        origin.x + (Math.random() - 0.5) * 0.8,
        origin.y + (Math.random() - 0.5) * 0.8,
        origin.z + (Math.random() - 0.5) * 0.8
      );
      this.scene.add(m);

      const spd = 5 + Math.random() * 9;
      const vel = new THREE.Vector3(
        outDir.x * spd + (Math.random() - 0.5) * 7,
        outDir.y * spd + 3 + Math.random() * 6,
        outDir.z * spd + (Math.random() - 0.5) * 7
      );

      this.debris.push({
        mesh: m,
        vel,
        angVel: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
        life: 2.6 + Math.random() * 1.2,
      });
    }
  }

  private spawnBlastVFX(center: THREE.Vector3, radius: number): void {
    const flash = new THREE.Mesh(this.smokeGeo, this.matBlastFlash);
    flash.position.copy(center);
    const fScale = radius * 0.45;
    flash.scale.setScalar(fScale);
    this.scene.add(flash);
    this.particles.push({
      mesh: flash,
      vel: new THREE.Vector3(0, 1.5, 0),
      baseScale: fScale,
      scaleRate: radius * 3.0,
      life: 0.2,
      maxLife: 0.2,
      shrinkAtEnd: true,
    });

    for (let i = 0; i < 6; i++) {
      const smMat = this.matBlastSmokes[i % this.matBlastSmokes.length];
      const sm = new THREE.Mesh(this.smokeGeo, smMat);
      sm.position.set(
        center.x + (Math.random() - 0.5) * radius * 0.5,
        center.y + Math.random() * 0.8,
        center.z + (Math.random() - 0.5) * radius * 0.5
      );
      const s0 = 0.65 + Math.random() * 0.7;
      sm.scale.setScalar(s0);
      this.scene.add(sm);
      const maxL = 1.2 + Math.random() * 0.8;
      this.particles.push({
        mesh: sm,
        vel: new THREE.Vector3((Math.random() - 0.5) * 2.5, 2.8 + Math.random() * 3.0, (Math.random() - 0.5) * 2.5),
        baseScale: s0,
        scaleRate: 1.6,
        life: maxL,
        maxLife: maxL,
        shrinkAtEnd: true,
      });
    }
  }

  private spawnImpactSpark(pt: THREE.Vector3): void {
    if (this.particles.length > 90) return;
    const sp = new THREE.Mesh(this.shellGeo, this.matImpactSpark);
    sp.position.copy(pt);
    sp.scale.setScalar(0.65);
    this.scene.add(sp);
    this.particles.push({
      mesh: sp,
      vel: new THREE.Vector3(0, 0.8, 0),
      baseScale: 0.65,
      scaleRate: 1.8,
      life: 0.1,
      maxLife: 0.1,
      shrinkAtEnd: true,
    });
  }

  public update(dt: number): void {
    // 1. Update Planted Sticky C4s
    for (let i = 0; i < this.plantedC4s.length; i++) {
      const c4 = this.plantedC4s[i];
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

    // 2. Step Projectiles & Zero-Allocation Ray-Segment Hit Detection
    const nextPos = this._nextPos;
    const segDir = this._segDir;
    const hitPt = this._hitPt;
    const hitPosition = this._bestHitPt;
    const ray = this._ray;

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
        hitPosition.copy(nextPos);

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

        // World Box3 colliders (Spatial Grid broadphase)
        const nearCols = this.queryNearbyColliders(
          Math.min(p.pos.x, nextPos.x) - 0.5,
          Math.min(p.pos.z, nextPos.z) - 0.5,
          Math.max(p.pos.x, nextPos.x) + 0.5,
          Math.max(p.pos.z, nextPos.z) + 0.5
        );
        for (let cIdx = 0; cIdx < nearCols.length; cIdx++) {
          const col = nearCols[cIdx];
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

        // Actors (Enemy Soldiers & Vehicles — zero Box3 allocation!)
        for (let aIdx = 0; aIdx < this.actors.length; aIdx++) {
          const actor = this.actors[aIdx];
          if (!actor.isAlive() || actor.id === p.ownerId || actor.team === p.team) continue;
          const aPos = actor.getPosition();
          const aRad = actor.getHitRadius();
          const aH = actor.getHeight();
          this._actorBox.min.set(aPos.x - aRad, aPos.y, aPos.z - aRad);
          this._actorBox.max.set(aPos.x + aRad, aPos.y + aH, aPos.z + aRad);
          if (ray.intersectBox(this._actorBox, hitPt)) {
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
            this.triggerExplosion(hitPosition.clone(), p.blastRadius, p.damage, p.team, p.ownerId, p.weaponName);
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

      // Advance projectile & orient tracer along live velocity curve
      p.pos.copy(nextPos);
      p.mesh.position.copy(p.pos);
      if (p.kind === "bullet") {
        this._lookTarget.copy(p.pos).add(segDir);
        p.mesh.lookAt(this._lookTarget);
      } else {
        p.smokeTimer -= dt;
        if (p.smokeTimer <= 0 && this.particles.length < 95) {
          p.smokeTimer = 0.032;
          const sm = new THREE.Mesh(this.smokeGeo, this.matRocketTrail);
          sm.position.copy(p.pos);
          sm.scale.setScalar(0.26);
          this.scene.add(sm);
          this.particles.push({
            mesh: sm,
            vel: new THREE.Vector3(0, 0.55, 0),
            baseScale: 0.26,
            scaleRate: 0.75,
            life: 0.45,
            maxLife: 0.45,
            shrinkAtEnd: true,
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

    // 4. Step Explosion & Smoke Particles (shared pooled materials — zero .dispose() shader stalls!)
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        this.scene.remove(pt.mesh);
        this.particles.splice(i, 1);
        continue;
      }
      pt.mesh.position.addScaledVector(pt.vel, dt);
      const t = 1 - pt.life / pt.maxLife;
      const env = pt.shrinkAtEnd && t > 0.65 ? (1 - t) / 0.35 : 1.0;
      const curScale = Math.max(0.01, (pt.baseScale + pt.scaleRate * (pt.maxLife - pt.life)) * env);
      pt.mesh.scale.setScalar(curScale);
    }
  }
}
