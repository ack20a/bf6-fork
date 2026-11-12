/**
 * Battlefield Atmospheric Lighting (Physical Sky + PMREM HDR IBL),
 * Large-Scale Desert-Urban Splat Terrain (1600m Vista + 440m Combat Zone),
 * 360° Distant Mountain Range, Highway Markings, Helipads, Industrial Silos,
 * and Batched InstancedMesh Oasis Vegetation (Date Palms, Scrub Bushes, Sandstone Boulders & Smoke Plumes).
 */

import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import type { WorldPhysics } from "./WorldPhysics";

interface RisingPlumePuff {
  mesh: THREE.Mesh;
  basePos: THREE.Vector3;
  phase: number;
  speed: number;
}

export class AtmosphereAndScenery {
  private plumePuffs: RisingPlumePuff[] = [];
  private dustPoints?: THREE.Points;

  constructor(
    private scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
    private physics: WorldPhysics
  ) {}

  /**
   * 1. Physically-Based Golden-Hour Sky + PMREM Environment IBL!
   * Gives every PBR metallic weapon, optic glass, vehicle hull & concrete wall crisp realistic bounce light.
   */
  public setupSkyAndIBL(sunLight: THREE.DirectionalLight): void {
    const sky = new Sky();
    sky.scale.setScalar(4500);
    const uniforms = sky.material.uniforms;
    uniforms["turbidity"].value = 4.2;
    uniforms["rayleigh"].value = 1.65;
    uniforms["mieCoefficient"].value = 0.0045;
    uniforms["mieDirectionalG"].value = 0.82;

    // Crisp mid-afternoon / golden-hour tactical sun angle (34° elevation)
    const elevationDeg = 34;
    const azimuthDeg = 142;
    const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
    const theta = THREE.MathUtils.degToRad(azimuthDeg);
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    uniforms["sunPosition"].value.copy(sunDir);
    this.scene.add(sky);

    // Generate HDR Environment Map from the physical Sky + warm sand bounce floor for PBR materials!
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(100);
    envSky.material.uniforms["turbidity"].value = 4.0;
    envSky.material.uniforms["rayleigh"].value = 1.5;
    envSky.material.uniforms["mieCoefficient"].value = 0.005;
    envSky.material.uniforms["mieDirectionalG"].value = 0.8;
    envSky.material.uniforms["sunPosition"].value.copy(sunDir);
    envScene.add(envSky);

    // Warm desert ground hemisphere inside env probe so underside of gun barrels/tanks get warm sand bounce instead of black!
    const bounceFloor = new THREE.Mesh(
      new THREE.SphereGeometry(40, 16, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
      new THREE.MeshBasicMaterial({ color: 0x9d8462, side: THREE.BackSide })
    );
    envScene.add(bounceFloor);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const envRT = pmrem.fromScene(envScene, 0.035);
    this.scene.environment = envRT.texture;
    this.scene.environmentIntensity = 1.05;
    pmrem.dispose();

    // Warm atmospheric distance haze blending seamlessly into horizon
    this.scene.fog = new THREE.FogExp2(0xd6ccb8, 0.00145);

    // Store sun direction on sunLight userData so main loop keeps shadow direction consistent
    sunLight.userData.sunDir = sunDir.clone().normalize();
  }

  /**
   * 2. Build 1600m Terrain, Road Network, Helipads, Distant Mountains, Instanced Oasis Palms, Bushes, Rocks & Props!
   */
  public buildRichBattlefieldScenery(excludeZones: Array<{ x: number; z: number; r: number }>): void {
    this.buildTerrainAndRoads();
    this.buildDistantMountainRing();
    this.buildVegetationAndRocks(excludeZones);
    this.buildHighwayPolesAndSilos();
    this.buildHorizonSmokePlumes();
    this.buildAmbientDustMotes();
  }

  private buildTerrainAndRoads(): void {
    // Rich high-frequency tileable desert sand + gravel + rocky patches texture
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#b89f78";
    ctx.fillRect(0, 0, 512, 512);

    // Wind-blown sand dune ripples
    for (let y = 0; y < 512; y += 4) {
      const wave = Math.sin(y * 0.09) * 10;
      ctx.fillStyle = y % 8 === 0 ? "rgba(214, 192, 152, 0.22)" : "rgba(138, 114, 82, 0.18)";
      ctx.fillRect(0, y + wave * 0.15, 512, 2);
    }
    // Rocky grit & pebbles
    for (let i = 0; i < 9000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const sz = 1 + Math.random() * 3.2;
      ctx.fillStyle =
        Math.random() > 0.55
          ? "rgba(96, 78, 56, 0.24)"
          : Math.random() > 0.5
          ? "rgba(232, 214, 178, 0.24)"
          : "rgba(128, 118, 96, 0.2)";
      ctx.fillRect(x, y, sz, sz);
    }

    const sandTex = new THREE.CanvasTexture(c);
    sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
    sandTex.repeat.set(65, 65);
    sandTex.colorSpace = THREE.SRGBColorSpace;

    // 1600m x 1600m terrain: flat Y=0 inside combat radius (<225m) for exact building/vehicle grounding,
    // rising into gentle desert dunes beyond 230m!
    const gndGeo = new THREE.PlaneGeometry(1600, 1600, 96, 96);
    gndGeo.rotateX(-Math.PI / 2);
    const posAttr = gndGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i);
      const dist = Math.hypot(vx, vz);
      if (dist > 228) {
        const t = Math.min(1, (dist - 228) / 260);
        const dune =
          (Math.sin(vx * 0.018) * Math.cos(vz * 0.016) * 14 +
            Math.sin(vx * 0.045 + vz * 0.035) * 5.5 +
            10 * t) *
          t;
        posAttr.setY(i, Math.max(0, dune));
      }
    }
    gndGeo.computeVertexNormals();

    const ground = new THREE.Mesh(
      gndGeo,
      new THREE.MeshStandardMaterial({
        map: sandTex,
        roughness: 0.9,
        metalness: 0.0,
      })
    );
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Procedural Asphalt Highway Texture with dashed yellow center line & white edge lines!
    const rc = document.createElement("canvas");
    rc.width = 256;
    rc.height = 512;
    const rctx = rc.getContext("2d")!;
    rctx.fillStyle = "#3c4045";
    rctx.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 4000; i++) {
      rctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.12)";
      rctx.fillRect(Math.random() * 256, Math.random() * 512, 2, 3);
    }
    // Sandy shoulder blend
    rctx.fillStyle = "rgba(184, 159, 120, 0.55)";
    rctx.fillRect(0, 0, 14, 512);
    rctx.fillRect(242, 0, 14, 512);
    // White edge lines
    rctx.fillStyle = "rgba(235, 238, 240, 0.72)";
    rctx.fillRect(20, 0, 5, 512);
    rctx.fillRect(231, 0, 5, 512);
    // Dashed yellow center highway stripe
    rctx.fillStyle = "rgba(238, 190, 58, 0.85)";
    for (let y = 16; y < 512; y += 64) {
      rctx.fillRect(125, y, 6, 34);
    }

    const roadTexNS = new THREE.CanvasTexture(rc);
    roadTexNS.wrapS = roadTexNS.wrapT = THREE.RepeatWrapping;
    roadTexNS.repeat.set(1, 22);
    roadTexNS.colorSpace = THREE.SRGBColorSpace;

    const roadTexEW = roadTexNS.clone();
    roadTexEW.needsUpdate = true;
    roadTexEW.repeat.set(1, 18);

    const roadMatNS = new THREE.MeshStandardMaterial({ map: roadTexNS, roughness: 0.82, polygonOffset: true, polygonOffsetFactor: -1 });
    const roadMatEW = new THREE.MeshStandardMaterial({ map: roadTexEW, roughness: 0.82, polygonOffset: true, polygonOffsetFactor: -2 });

    // North-South Main Strategic Highway (Z: -220 .. +220 at X = -16)
    const nsRoad = new THREE.Mesh(new THREE.PlaneGeometry(13, 430), roadMatNS);
    nsRoad.rotation.x = -Math.PI / 2;
    nsRoad.position.set(-16, 0.02, 0);
    nsRoad.receiveShadow = true;
    this.scene.add(nsRoad);

    // East-West Cross Highway connecting Charlie (-105) -> Alpha (0) -> Bravo (+105)
    const ewRoad = new THREE.Mesh(new THREE.PlaneGeometry(12, 340), roadMatEW);
    ewRoad.rotation.x = -Math.PI / 2;
    ewRoad.rotation.z = Math.PI / 2;
    ewRoad.position.set(0, 0.025, 14);
    ewRoad.receiveShadow = true;
    this.scene.add(ewRoad);

    // Concrete Foundations / Paved Plazas under key urban sectors & Base Helipads
    const padMat = new THREE.MeshStandardMaterial({ color: 0x7d7a72, roughness: 0.85 });
    const plazas: Array<[number, number, number, number]> = [
      [0, 0, 42, 36],      // Sector Alpha Twin-Tower Urban Plaza
      [105, 20, 44, 38],   // Sector Bravo Container Logistics Port
      [-105, -15, 40, 36], // Sector Charlie Oasis Town Courtyard
      [-16, -108, 34, 28], // Sector Delta North Checkpoint
      [22, 102, 36, 30],   // Sector Echo Industrial Depot
      [0, 168, 56, 36],    // NATO South Main Operating Base
      [0, -168, 56, 36],   // PAX North Main Operating Base
    ];
    for (const [px, pz, pw, pd] of plazas) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), padMat);
      p.rotation.x = -Math.PI / 2;
      p.position.set(px, 0.015, pz);
      p.receiveShadow = true;
      this.scene.add(p);
    }

    // Helipad [H] Markings at NATO South Airbase (18, 168) & PAX North Airbase (-18, -168)
    this.buildHelipadDecal(18, 168, 0x00e5ff);
    this.buildHelipadDecal(-18, -168, 0xff6633);
  }

  private buildHelipadDecal(x: number, z: number, accentHex: number): void {
    const hc = document.createElement("canvas");
    hc.width = 256;
    hc.height = 256;
    const ctx = hc.getContext("2d")!;
    ctx.fillStyle = "#484c52";
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = "#f2c94c";
    ctx.lineWidth = 10;
    ctx.strokeRect(14, 14, 228, 228);
    ctx.beginPath();
    ctx.arc(128, 128, 86, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = `#${accentHex.toString(16).padStart(6, "0")}`;
    ctx.font = "bold 110px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("H", 128, 134);

    const tex = new THREE.CanvasTexture(hc);
    tex.colorSpace = THREE.SRGBColorSpace;
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78, polygonOffset: true, polygonOffsetFactor: -3 })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(x, 0.03, z);
    pad.receiveShadow = true;
    this.scene.add(pad);
  }

  private buildDistantMountainRing(): void {
    // 360° jagged desert mountain peaks surrounding the valley at radius 480..720m
    const mountainMat = new THREE.MeshStandardMaterial({
      color: 0x8e7960,
      roughness: 0.96,
      metalness: 0.0,
      flatShading: true,
    });
    const peakCount = 44;
    for (let i = 0; i < peakCount; i++) {
      const ang = (i / peakCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.08;
      const dist = 480 + (i % 3) * 75 + Math.random() * 55;
      const height = 65 + (i % 4) * 32 + Math.random() * 45;
      const radius = 65 + Math.random() * 55;

      const cone = new THREE.ConeGeometry(radius, height, 6 + (i % 3), 2);
      // Perturb vertices slightly for craggy desert ridge silhouette
      const p = cone.attributes.position;
      for (let k = 0; k < p.count; k++) {
        if (p.getY(k) < height * 0.45) {
          p.setX(k, p.getX(k) * (0.85 + Math.random() * 0.35));
          p.setZ(k, p.getZ(k) * (0.85 + Math.random() * 0.35));
        }
      }
      cone.computeVertexNormals();
      const m = new THREE.Mesh(cone, mountainMat);
      m.position.set(Math.cos(ang) * dist, height * 0.42, Math.sin(ang) * dist);
      m.rotation.y = Math.random() * Math.PI;
      this.scene.add(m);
    }
  }

  /**
   * Batched InstancedMesh Date Palms, Scrub Bushes & Sandstone Boulders!
   * Renders ~650 natural props across the 440m valley in just 4 GPU draw calls!
   */
  private buildVegetationAndRocks(excludeZones: Array<{ x: number; z: number; r: number }>): void {
    const isClear = (x: number, z: number, pad = 0): boolean => {
      // Keep off main NS road (X = -16) and EW road (Z = 14)
      if (Math.abs(x - -16) < 8.5 + pad) return false;
      if (Math.abs(z - 14) < 8.0 + pad) return false;
      for (const ez of excludeZones) {
        if (Math.hypot(x - ez.x, z - ez.z) < ez.r + pad) return false;
      }
      return true;
    };

    // --- A. DATE PALM TREES (165 instances: Curved/Tapered Trunk + Lush 8-Frond Canopy) ---
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.32, 6.8, 7, 4);
    trunkGeo.translate(0, 3.4, 0);
    // Subtle natural palm bend
    const tp = trunkGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i);
      tp.setX(i, tp.getX(i) + (y / 6.8) * (y / 6.8) * 0.42);
    }
    trunkGeo.computeVertexNormals();

    // Build 8-frond drooping palm crown merged into a single geometry!
    const crownGeo = this.createPalmCrownGeometry();

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6e533b, roughness: 0.92, flatShading: true });
    const crownMat = new THREE.MeshStandardMaterial({
      color: 0x4b7435,
      roughness: 0.78,
      side: THREE.DoubleSide,
      flatShading: true,
    });

    const palmCoords: Array<{ x: number; z: number; s: number; rot: number }> = [];

    // Deliberate scenic palm boulevards along Alpha avenue, Charlie Oasis, Bravo & HQs
    const curatedPalms: Array<[number, number]> = [
      [-25, 25], [-25, -8], [-25, -28], [-7, 26], [-7, 38], [-7, -26],
      [22, 24], [48, 24], [72, 24], [-42, 24], [-68, 24],
      [-126, -6], [-128, -22], [-92, -36], [-84, 6], // Charlie Oasis cluster
      [82, 36], [128, 6], [126, 34], // Bravo port palms
      [-28, 152], [28, 152], [-28, -152], [28, -152],
    ];
    for (const [px, pz] of curatedPalms) {
      if (isClear(px, pz, 1.2)) {
        palmCoords.push({ x: px, z: pz, s: 0.88 + Math.random() * 0.35, rot: Math.random() * Math.PI * 2 });
      }
    }

    // Scatter additional oasis palms across the 420m x 420m valley
    let seed = 1337;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    for (let tries = 0; tries < 700 && palmCoords.length < 165; tries++) {
      const x = (rand() - 0.5) * 410;
      const z = (rand() - 0.5) * 410;
      if (!isClear(x, z, 2.5)) continue;
      palmCoords.push({ x, z, s: 0.75 + rand() * 0.55, rot: rand() * Math.PI * 2 });
    }

    const palmTrunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmCoords.length);
    const palmCrowns = new THREE.InstancedMesh(crownGeo, crownMat, palmCoords.length);
    palmTrunks.castShadow = true;
    palmTrunks.receiveShadow = true;
    palmCrowns.castShadow = true;

    const dummy = new THREE.Object3D();
    palmCoords.forEach((p, idx) => {
      dummy.position.set(p.x, 0, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      palmTrunks.setMatrixAt(idx, dummy.matrix);
      palmCrowns.setMatrixAt(idx, dummy.matrix);

      // Thin trunk collider on close-in trees so tanks/soldiers don't walk straight through thick trunks
      this.physics.addManualBox(
        new THREE.Box3(new THREE.Vector3(p.x - 0.28, 0, p.z - 0.28), new THREE.Vector3(p.x + 0.28, 5.5 * p.s, p.z + 0.28))
      );
    });
    this.scene.add(palmTrunks);
    this.scene.add(palmCrowns);

    // --- B. DESERT SCRUB BUSHES & DRY TUFT CLUSTERS (360 instances, 1 draw call!) ---
    const bushGeo = new THREE.DodecahedronGeometry(0.85, 1);
    bushGeo.scale(1.25, 0.68, 1.15);
    bushGeo.translate(0, 0.42, 0);
    const bushMat = new THREE.MeshStandardMaterial({
      color: 0x6b7c47,
      roughness: 0.92,
      flatShading: true,
    });

    const bushCoords: Array<{ x: number; z: number; sx: number; sy: number; rot: number; tint: number }> = [];
    for (let tries = 0; tries < 1200 && bushCoords.length < 360; tries++) {
      const x = (rand() - 0.5) * 430;
      const z = (rand() - 0.5) * 430;
      if (!isClear(x, z, 0.8)) continue;
      bushCoords.push({
        x,
        z,
        sx: 0.55 + rand() * 1.15,
        sy: 0.5 + rand() * 0.85,
        rot: rand() * Math.PI * 2,
        tint: rand(),
      });
    }

    const bushes = new THREE.InstancedMesh(bushGeo, bushMat, bushCoords.length);
    bushes.castShadow = true;
    bushes.receiveShadow = true;
    const col = new THREE.Color();
    bushCoords.forEach((b, idx) => {
      dummy.position.set(b.x, 0, b.z);
      dummy.rotation.set(0, b.rot, 0);
      dummy.scale.set(b.sx, b.sy, b.sx);
      dummy.updateMatrix();
      bushes.setMatrixAt(idx, dummy.matrix);
      col.setRGB(0.36 + b.tint * 0.16, 0.44 + b.tint * 0.12, 0.24 + b.tint * 0.08);
      bushes.setColorAt(idx, col);
    });
    if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
    this.scene.add(bushes);

    // --- C. WEATHERED SANDSTONE ROCK OUTCROPS & TACTICAL BOULDERS (115 instances, 1 draw call!) ---
    const rockGeo = new THREE.DodecahedronGeometry(1.4, 1);
    const rp = rockGeo.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      rp.setXYZ(
        i,
        rp.getX(i) * (0.85 + Math.sin(i * 2.1) * 0.22),
        rp.getY(i) * 0.68,
        rp.getZ(i) * (0.85 + Math.cos(i * 1.7) * 0.22)
      );
    }
    rockGeo.translate(0, 0.55, 0);
    rockGeo.computeVertexNormals();

    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x9b8366,
      roughness: 0.94,
      flatShading: true,
    });

    const rockCoords: Array<{ x: number; z: number; sx: number; sy: number; sz: number; rot: number }> = [];
    for (let tries = 0; tries < 600 && rockCoords.length < 115; tries++) {
      const x = (rand() - 0.5) * 420;
      const z = (rand() - 0.5) * 420;
      if (!isClear(x, z, 3.0)) continue;
      rockCoords.push({
        x,
        z,
        sx: 0.8 + rand() * 1.7,
        sy: 0.7 + rand() * 1.35,
        sz: 0.8 + rand() * 1.6,
        rot: rand() * Math.PI * 2,
      });
    }

    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCoords.length);
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    rockCoords.forEach((r, idx) => {
      dummy.position.set(r.x, 0, r.z);
      dummy.rotation.set(0, r.rot, 0);
      dummy.scale.set(r.sx, r.sy, r.sz);
      dummy.updateMatrix();
      rocks.setMatrixAt(idx, dummy.matrix);

      // Solid cover collider for sniper/infantry firefights!
      const rx = 1.05 * r.sx;
      const rz = 1.05 * r.sz;
      const ry = 1.25 * r.sy;
      this.physics.addManualBox(
        new THREE.Box3(new THREE.Vector3(r.x - rx, 0, r.z - rz), new THREE.Vector3(r.x + rx, ry, r.z + rz))
      );
    });
    this.scene.add(rocks);
  }

  private createPalmCrownGeometry(): THREE.BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const topX = 0.42;
    const topY = 6.72;
    const fronds = 9;

    for (let f = 0; f < fronds; f++) {
      const ang = (f / fronds) * Math.PI * 2 + (f % 2) * 0.12;
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      const px = -dz;
      const pz = dx;
      const segs = 4;
      const len = 3.15 + (f % 2) * 0.35;

      for (let s = 0; s < segs; s++) {
        const t0 = s / segs;
        const t1 = (s + 1) / segs;
        const r0 = t0 * len;
        const r1 = t1 * len;
        const y0 = topY + Math.sin(t0 * Math.PI * 0.75) * 0.55 - t0 * t0 * 1.45;
        const y1 = topY + Math.sin(t1 * Math.PI * 0.75) * 0.55 - t1 * t1 * 1.45;
        const w0 = Math.sin(Math.max(0.12, t0) * Math.PI) * 0.46;
        const w1 = Math.sin(Math.min(0.95, t1) * Math.PI) * 0.46;

        const c0x = topX + dx * r0;
        const c0z = dz * r0;
        const c1x = topX + dx * r1;
        const c1z = dz * r1;

        // Left & right leaflet blades angled into a V-rib
        for (const side of [-1, 1]) {
          const ax = c0x;
          const ay = y0 + 0.06;
          const az = c0z;

          const bx = c0x + px * w0 * side;
          const by = y0 - 0.12;
          const bz = c0z + pz * w0 * side;

          const cx = c1x + px * w1 * side;
          const cy = y1 - 0.12;
          const cz = c1z + pz * w1 * side;

          const ex = c1x;
          const ey = y1 + 0.06;
          const ez = c1z;

          positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
          positions.push(ax, ay, az, cx, cy, cz, ex, ey, ez);
          for (let k = 0; k < 6; k++) normals.push(0, 1, 0);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geo.computeVertexNormals();
    return geo;
  }

  private buildHighwayPolesAndSilos(): void {
    // Utility / Streetlight Poles along the North-South & East-West Highways
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, 7.5, 6);
    poleGeo.translate(0, 3.75, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x4b4f54, roughness: 0.7, metalness: 0.4 });

    const coords: Array<[number, number]> = [];
    for (let z = -160; z <= 160; z += 32) {
      if (Math.abs(z - 14) > 12) coords.push([-23.5, z]);
    }
    for (let x = -140; x <= 140; x += 34) {
      if (Math.abs(x - -16) > 12) coords.push([x, 6.5]);
    }

    const poles = new THREE.InstancedMesh(poleGeo, poleMat, coords.length);
    poles.castShadow = true;
    const dummy = new THREE.Object3D();
    coords.forEach(([x, z], i) => {
      dummy.position.set(x, 0, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);
    });
    this.scene.add(poles);

    // Large White/Olive Industrial Fuel Silos at Sector Echo (+22, +102) & Sector Bravo (+105, +20)
    const siloMat = new THREE.MeshStandardMaterial({ color: 0xc8c4ba, roughness: 0.55, metalness: 0.35 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xd96b27, roughness: 0.6 });
    const siloPositions: Array<[number, number, number]> = [
      [35, 108, 4.2],
      [35, 96, 4.2],
      [121, 32, 3.8],
    ];
    for (const [sx, sz, rad] of siloPositions) {
      const h = 7.4;
      const silo = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, h, 20), siloMat);
      silo.position.set(sx, h * 0.5, sz);
      silo.castShadow = true;
      silo.receiveShadow = true;
      this.scene.add(silo);

      const band = new THREE.Mesh(new THREE.CylinderGeometry(rad + 0.04, rad + 0.04, 0.8, 20), bandMat);
      band.position.set(sx, h * 0.62, sz);
      this.scene.add(band);

      this.physics.addManualBox(
        new THREE.Box3(new THREE.Vector3(sx - rad, 0, sz - rad), new THREE.Vector3(sx + rad, h, sz + rad))
      );
    }
  }

  private buildHorizonSmokePlumes(): void {
    // 4 Distant Battlefield Oil-Fire / Wreckage Smoke Plumes for authentic Battlefield warzone ambiance!
    const plumeOrigins = [
      new THREE.Vector3(245, 0, -190),
      new THREE.Vector3(-255, 0, -140),
      new THREE.Vector3(270, 0, 165),
      new THREE.Vector3(-230, 0, 210),
    ];
    const puffGeo = new THREE.SphereGeometry(1, 8, 8);

    for (const origin of plumeOrigins) {
      // Glowing fire base
      const glow = new THREE.Mesh(
        puffGeo,
        new THREE.MeshBasicMaterial({ color: 0xff6611, transparent: true, opacity: 0.75 })
      );
      glow.position.copy(origin).add(new THREE.Vector3(0, 3, 0));
      glow.scale.setScalar(5.5);
      this.scene.add(glow);

      for (let i = 0; i < 9; i++) {
        const shade = 0.14 + (i / 9) * 0.16;
        const mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(shade, shade, shade),
          transparent: true,
          opacity: 0.42 * (1 - i / 11),
        });
        const puff = new THREE.Mesh(puffGeo, mat);
        this.scene.add(puff);
        this.plumePuffs.push({
          mesh: puff,
          basePos: origin.clone(),
          phase: i / 9,
          speed: 0.045 + Math.random() * 0.015,
        });
      }
    }
  }

  private buildAmbientDustMotes(): void {
    const count = 320;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 180;
      arr[i * 3 + 1] = 0.5 + Math.random() * 14;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 180;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xf2dfc0,
      size: 0.24,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.dustPoints = new THREE.Points(geo, mat);
    this.scene.add(this.dustPoints);
  }

  public update(dt: number, focusPos: THREE.Vector3): void {
    // Animate rising warzone smoke plumes
    for (const p of this.plumePuffs) {
      p.phase = (p.phase + p.speed * dt) % 1.0;
      const h = p.phase * 95;
      const drift = p.phase * 28;
      p.mesh.position.set(p.basePos.x + drift, h + 4, p.basePos.z - drift * 0.4);
      p.mesh.scale.setScalar(5 + p.phase * 22);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.sin(p.phase * Math.PI) * 0.36;
    }

    // Drift sunlit desert dust motes gently around active player zone
    if (this.dustPoints) {
      this.dustPoints.position.x = Math.round(focusPos.x / 90) * 90;
      this.dustPoints.position.z = Math.round(focusPos.z / 90) * 90;
      this.dustPoints.rotation.y += dt * 0.025;
    }
  }
}
