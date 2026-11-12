/**
 * Battlefield Atmospheric Lighting (Physical Sky + PMREM HDR IBL + High-Altitude Clouds),
 * Multi-Scale Anti-Tiling Desert Terrain (1600m Vista + Normal-Mapped Near/Far Detail Shader),
 * Continuous 360° Dual-Layer Sculpted Mountain Ridges (Sandstone Mesas + Jagged Horizon Peaks),
 * Normal-Mapped Urban Concrete Plazas & Curbs, Tire-Worn Asphalt Highways, Vista Landmarks,
 * and GPU-Batched InstancedMesh Scenery (Wind-Animated Date Palms, Scrub, Cobbles & Stratified Boulders).
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

interface BlinkingBeacon {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  phase: number;
}

export class AtmosphereAndScenery {
  private plumePuffs: RisingPlumePuff[] = [];
  private beacons: BlinkingBeacon[] = [];
  private dustPoints?: THREE.Points;
  private cloudGroup?: THREE.Group;
  private windUniform = { value: 0 };
  private maxAnisotropy = 8;

  constructor(
    private scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
    private physics: WorldPhysics
  ) {
    this.maxAnisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8);
  }

  private configureTexture(tex: THREE.Texture, srgb = true): THREE.Texture {
    tex.anisotropy = this.maxAnisotropy;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    if (srgb) {
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Deterministic terrain elevation matching the 1600m x 1600m ground mesh.
   * Remains strictly 0.0 inside the 226m combat pad so buildings, vehicles & soldiers stay flush.
   */
  public sampleTerrainHeight(vx: number, vz: number): number {
    const dist = Math.hypot(vx, vz);
    if (dist <= 226) return 0;
    const t = Math.min(1, (dist - 226) / 280);
    const smoothT = t * t * (3 - 2 * t);
    const macroDune =
      Math.sin(vx * 0.016 + 0.4) * Math.cos(vz * 0.015 - 0.3) * 15.5 +
      Math.sin(vx * 0.038 + vz * 0.031) * 6.2 +
      Math.cos(vx * 0.009 - vz * 0.012) * 8.5;
    const wadiCarve = Math.sin(vx * 0.024 - vz * 0.019) * 3.5;
    return Math.max(0, (macroDune + wadiCarve + 12.5 * smoothT) * smoothT);
  }

  /**
   * 1. Physically-Based Golden-Hour Sky + PMREM Environment IBL!
   * Gives every PBR metallic weapon, optic glass, vehicle hull & concrete wall crisp realistic bounce light.
   */
  public setupSkyAndIBL(sunLight: THREE.DirectionalLight): void {
    const sky = new Sky();
    sky.scale.setScalar(4800);
    const uniforms = sky.material.uniforms;
    uniforms["turbidity"].value = 3.8;
    uniforms["rayleigh"].value = 1.55;
    uniforms["mieCoefficient"].value = 0.0042;
    uniforms["mieDirectionalG"].value = 0.83;

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
    envSky.material.uniforms["turbidity"].value = 3.8;
    envSky.material.uniforms["rayleigh"].value = 1.48;
    envSky.material.uniforms["mieCoefficient"].value = 0.0048;
    envSky.material.uniforms["mieDirectionalG"].value = 0.81;
    envSky.material.uniforms["sunPosition"].value.copy(sunDir);
    envScene.add(envSky);

    // Warm desert ground hemisphere inside env probe so underside of gun barrels/tanks get warm sand bounce instead of black!
    const bounceFloor = new THREE.Mesh(
      new THREE.SphereGeometry(40, 16, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
      new THREE.MeshBasicMaterial({ color: 0xa48b67, side: THREE.BackSide })
    );
    envScene.add(bounceFloor);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const envRT = pmrem.fromScene(envScene, 0.03);
    this.scene.environment = envRT.texture;
    this.scene.environmentIntensity = 1.1;
    pmrem.dispose();

    // Balanced aerial perspective haze: crystal-clear near/mid view + majestic distant mountain silhouettes
    this.scene.fog = new THREE.FogExp2(0xd8ceba, 0.00088);

    // Store sun direction on sunLight userData so main loop keeps shadow direction consistent
    sunLight.userData.sunDir = sunDir.clone().normalize();
  }

  /**
   * 2. Build Multi-Scale 1600m Terrain, Detailed Plazas/Roads, Dual-Ring Mountain Ranges,
   *    High-Altitude Clouds, Vista Towers/Pylons, and Instanced Oasis Vegetation & Micro-Clutter!
   */
  public buildRichBattlefieldScenery(excludeZones: Array<{ x: number; z: number; r: number }>): void {
    this.buildTerrainAndRoads();
    this.buildDistantMountainRing();
    this.buildHighAltitudeClouds();
    this.buildVistaLandmarks();
    this.buildVegetationAndRocks(excludeZones);
    this.buildHighwayPolesAndSilos();
    this.buildHorizonSmokePlumes();
    this.buildAmbientDustMotes();
  }

  /**
   * Generates a seamlessly tileable 1024x1024 Albedo + Tangent-Space Normal Map pair for desert sand/gravel.
   */
  private createSandTextures(): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
    const size = 1024;
    const heightField = new Float32Array(size * size);

    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(size, size);
    const data = img.data;

    // Deterministic fast hash for seamless periodic micro-pebbles & wind ripples
    const hash2 = (ix: number, iy: number): number => {
      const wx = ((ix % size) + size) % size;
      const wy = ((iy % size) + size) % size;
      const n = Math.sin(wx * 127.1 + wy * 311.7) * 43758.5453;
      return n - Math.floor(n);
    };

    const twoPi = Math.PI * 2;
    for (let y = 0; y < size; y++) {
      const ny = y / size;
      for (let x = 0; x < size; x++) {
        const nx = x / size;
        // Seamless wind-blown ripple harmonics
        const warp =
          Math.sin(nx * twoPi * 3 + ny * twoPi * 2) * 0.22 +
          Math.cos(nx * twoPi * 7 - ny * twoPi * 5) * 0.09;
        const ripple1 = Math.sin((ny * 26 + nx * 4 + warp) * twoPi) * 0.5 + 0.5;
        const ripple2 = Math.sin((ny * 52 - nx * 9 + warp * 1.7) * twoPi) * 0.5 + 0.5;
        const patch =
          Math.sin(nx * twoPi * 2 + 0.7) * Math.cos(ny * twoPi * 2 - 0.4) * 0.5 + 0.5;

        const grit = hash2(x, y);
        const coarse = hash2(x >> 2, y >> 2);
        const pebble = coarse > 0.87 ? (coarse - 0.87) * 5.2 : 0.0;

        const h = ripple1 * 0.42 + ripple2 * 0.16 + patch * 0.18 + grit * 0.12 + pebble * 0.55;
        const idx = y * size + x;
        heightField[idx] = h;

        // Warm desert sand + darker gravel depressions + pale wind-crest highlights
        let r = 178 + (ripple1 - 0.5) * 24 + (patch - 0.5) * 18 + (grit - 0.5) * 16;
        let g = 152 + (ripple1 - 0.5) * 21 + (patch - 0.5) * 15 + (grit - 0.5) * 14;
        let b = 115 + (ripple1 - 0.5) * 17 + (patch - 0.5) * 12 + (grit - 0.5) * 12;

        if (pebble > 0.05) {
          // Embedded desert chert / limestone pebbles
          const shade = (hash2((x >> 2) + 19, (y >> 2) + 47) - 0.48) * 52;
          r = 142 + shade;
          g = 124 + shade * 0.9;
          b = 98 + shade * 0.8;
        }

        const p = idx * 4;
        data[p] = Math.max(0, Math.min(255, r));
        data[p + 1] = Math.max(0, Math.min(255, g));
        data[p + 2] = Math.max(0, Math.min(255, b));
        data[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Derive tangent-space normal map via Sobel-like wrapped central differences
    const nc = document.createElement("canvas");
    nc.width = size;
    nc.height = size;
    const nctx = nc.getContext("2d")!;
    const nimg = nctx.createImageData(size, size);
    const ndata = nimg.data;
    const strength = 2.8;

    for (let y = 0; y < size; y++) {
      const ym = (y - 1 + size) % size;
      const yp = (y + 1) % size;
      for (let x = 0; x < size; x++) {
        const xm = (x - 1 + size) % size;
        const xp = (x + 1) % size;
        const dx = (heightField[y * size + xp] - heightField[y * size + xm]) * strength;
        const dy = (heightField[yp * size + x] - heightField[ym * size + x]) * strength;
        const invLen = 1.0 / Math.hypot(dx, dy, 1.0);
        const p = (y * size + x) * 4;
        ndata[p] = Math.round((-dx * invLen * 0.5 + 0.5) * 255);
        ndata[p + 1] = Math.round((-dy * invLen * 0.5 + 0.5) * 255);
        ndata[p + 2] = Math.round((invLen * 0.5 + 0.5) * 255);
        ndata[p + 3] = 255;
      }
    }
    nctx.putImageData(nimg, 0, 0);

    const map = new THREE.CanvasTexture(c);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(125, 125); // ~12.8m tile => ~1.25cm/texel crispness right underfoot!
    this.configureTexture(map, true);

    const normalMap = new THREE.CanvasTexture(nc);
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.repeat.set(125, 125);
    this.configureTexture(normalMap, false);

    return { map, normalMap };
  }

  /**
   * Generates a 512x512 Expansion-Joint Concrete Slab Albedo + Normal Map for urban sector plazas.
   */
  private createConcretePlazaTextures(): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
    const size = 512;
    const hf = new Float32Array(size * size);
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(size, size);
    const d = img.data;

    const slabPeriod = 128; // 4x4 concrete slabs per tile
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const sx = x % slabPeriod;
        const sy = y % slabPeriod;
        const slabId = Math.floor(x / slabPeriod) * 7 + Math.floor(y / slabPeriod) * 13;
        const slabTint = (Math.sin(slabId * 19.7) * 0.5 + 0.5) * 10 - 5;

        const n = Math.sin(x * 91.3 + y * 241.7) * 43758.5453;
        const grain = n - Math.floor(n);

        // Expansion joint groove at slab borders
        const distEdge = Math.min(sx, slabPeriod - 1 - sx, sy, slabPeriod - 1 - sy);
        const isJoint = distEdge < 2;
        const bevel = distEdge < 5 ? (distEdge / 5) : 1.0;

        // Subtle desert sand drift accumulating near joints
        const sandDrift = distEdge < 10 ? (1 - distEdge / 10) * 0.25 : 0;

        const idx = y * size + x;
        hf[idx] = bevel * 0.7 + grain * 0.22;

        let r = 132 + slabTint + (grain - 0.5) * 18;
        let g = 128 + slabTint + (grain - 0.5) * 17;
        let b = 120 + slabTint + (grain - 0.5) * 16;

        if (isJoint) {
          r = 68;
          g = 64;
          b = 58;
        } else if (sandDrift > 0) {
          r = r * (1 - sandDrift) + 184 * sandDrift;
          g = g * (1 - sandDrift) + 158 * sandDrift;
          b = b * (1 - sandDrift) + 118 * sandDrift;
        }

        const p = idx * 4;
        d[p] = Math.max(0, Math.min(255, r));
        d[p + 1] = Math.max(0, Math.min(255, g));
        d[p + 2] = Math.max(0, Math.min(255, b));
        d[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    const nc = document.createElement("canvas");
    nc.width = size;
    nc.height = size;
    const nctx = nc.getContext("2d")!;
    const nimg = nctx.createImageData(size, size);
    const nd = nimg.data;
    for (let y = 0; y < size; y++) {
      const ym = (y - 1 + size) % size;
      const yp = (y + 1) % size;
      for (let x = 0; x < size; x++) {
        const xm = (x - 1 + size) % size;
        const xp = (x + 1) % size;
        const dx = (hf[y * size + xp] - hf[y * size + xm]) * 2.4;
        const dy = (hf[yp * size + x] - hf[ym * size + x]) * 2.4;
        const inv = 1 / Math.hypot(dx, dy, 1);
        const p = (y * size + x) * 4;
        nd[p] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
        nd[p + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
        nd[p + 2] = Math.round((inv * 0.5 + 0.5) * 255);
        nd[p + 3] = 255;
      }
    }
    nctx.putImageData(nimg, 0, 0);

    const map = new THREE.CanvasTexture(c);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    this.configureTexture(map, true);

    const normalMap = new THREE.CanvasTexture(nc);
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
    this.configureTexture(normalMap, false);

    return { map, normalMap };
  }

  private buildTerrainAndRoads(): void {
    const { map: sandTex, normalMap: sandNormalTex } = this.createSandTextures();

    // 1600m x 1600m high-resolution terrain mesh (160x160 segs):
    // Strictly flat Y=0 inside combat radius (<=226m) for exact building/vehicle grounding,
    // rising into sculpted multi-octave desert dunes and wadis beyond 226m!
    const gndGeo = new THREE.PlaneGeometry(1600, 1600, 160, 160);
    gndGeo.rotateX(-Math.PI / 2);
    const posAttr = gndGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i);
      const h = this.sampleTerrainHeight(vx, vz);
      if (h > 0) {
        posAttr.setY(i, h);
      }
    }
    gndGeo.computeVertexNormals();

    const groundMat = new THREE.MeshStandardMaterial({
      map: sandTex,
      normalMap: sandNormalTex,
      normalScale: new THREE.Vector2(0.88, 0.88),
      roughness: 0.9,
      metalness: 0.0,
    });

    // Multi-Scale Anti-Tiling Shader:
    // 1. Mixes a rotated secondary UV scale so periodic 12.8m sand tiles never form visible grid lines from afar/air.
    // 2. Applies world-space multi-octave macro FBM shading (sunlit golden dunes vs darker gravel wadi beds).
    // 3. Injects crisp procedural sub-centimeter sand-grain micro-contrast within 0..26m of the camera!
    groundMat.customProgramCacheKey = () => "bf6_multiscale_desert_ground_v2";
    groundMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec3 vGroundWorldPos;`
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
vGroundWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec3 vGroundWorldPos;
float bfHash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float bfNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = bfHash21(i);
  float b = bfHash21(i + vec2(1.0, 0.0));
  float c = bfHash21(i + vec2(0.0, 1.0));
  float d = bfHash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`
        )
        .replace(
          "#include <map_fragment>",
          `#ifdef USE_MAP
  vec4 nearSample = texture2D( map, vMapUv );
  // Rotated 29-degree macro-uv sample breaks all periodic checkerboard repetition at mid/far range
  mat2 rotM = mat2(0.8746, -0.4848, 0.4848, 0.8746);
  vec4 midSample = texture2D( map, rotM * (vMapUv * 0.21) + vec2(0.37, 0.71) );
  float camDist = distance( cameraPosition, vGroundWorldPos );
  float farBlend = smoothstep( 14.0, 85.0, camDist );
  vec4 sampledDiffuseColor = mix( nearSample, mix(nearSample, midSample, 0.55), farBlend );

  // World-space geological macro variation (erg sand sheets vs darker rocky wadi beds)
  float macro1 = bfNoise( vGroundWorldPos.xz * 0.011 );
  float macro2 = bfNoise( vGroundWorldPos.xz * 0.037 + vec2(11.3, 7.9) );
  float macroPatch = macro1 * 0.68 + macro2 * 0.32;
  vec3 warmDuneTint = vec3(1.10, 1.05, 0.96);
  vec3 rockyWadiTint = vec3(0.84, 0.80, 0.75);
  sampledDiffuseColor.rgb *= mix( rockyWadiTint, warmDuneTint, smoothstep(0.26, 0.76, macroPatch) );

  // Ultra-near boot-level sand sparkle & micro-pebble sharpness within 26m
  float microFade = 1.0 - smoothstep( 4.0, 26.0, camDist );
  if ( microFade > 0.001 ) {
    float fineGrain = bfNoise( vGroundWorldPos.xz * 26.0 ) - 0.5;
    sampledDiffuseColor.rgb *= ( 1.0 + fineGrain * 0.16 * microFade );
  }
  diffuseColor *= sampledDiffuseColor;
#endif`
        )
        .replace(
          "#include <roughnessmap_fragment>",
          `#include <roughnessmap_fragment>
  float rMacro = bfNoise( vGroundWorldPos.xz * 0.018 );
  roughnessFactor = clamp( roughnessFactor + (0.5 - rMacro) * 0.12, 0.78, 0.98 );`
        );
    };

    const ground = new THREE.Mesh(gndGeo, groundMat);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Upgraded High-Detail Asphalt Highway Texture (512x1024) + Normal Grain + Tire Wear + Tar Cracks!
    const rc = document.createElement("canvas");
    rc.width = 512;
    rc.height = 1024;
    const rctx = rc.getContext("2d")!;
    rctx.fillStyle = "#393d42";
    rctx.fillRect(0, 0, 512, 1024);

    // Subtle dark polished dual tire-wear tracks in left & right lanes
    for (const laneX of [145, 367]) {
      const grad = rctx.createLinearGradient(laneX - 48, 0, laneX + 48, 0);
      grad.addColorStop(0, "rgba(22,24,28,0)");
      grad.addColorStop(0.3, "rgba(22,24,28,0.26)");
      grad.addColorStop(0.7, "rgba(22,24,28,0.26)");
      grad.addColorStop(1, "rgba(22,24,28,0)");
      rctx.fillStyle = grad;
      rctx.fillRect(laneX - 48, 0, 96, 1024);
    }

    // Coarse aggregate mineral speckle
    for (let i = 0; i < 16000; i++) {
      rctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.055)" : "rgba(0,0,0,0.14)";
      rctx.fillRect((i * 73) % 512, (i * 197) % 1024, 2, 2);
    }

    // Sealed tar thermal cracks across asphalt
    rctx.strokeStyle = "rgba(18, 20, 22, 0.55)";
    rctx.lineWidth = 2.2;
    for (let cIdx = 0; cIdx < 9; cIdx++) {
      let cy = 70 + cIdx * 108;
      rctx.beginPath();
      rctx.moveTo(45, cy);
      for (let cx = 80; cx <= 465; cx += 45) {
        cy += Math.sin(cx * 0.08 + cIdx) * 6;
        rctx.lineTo(cx, cy);
      }
      rctx.stroke();
    }

    // Graduated wind-blown desert sand shoulder blend
    const leftSand = rctx.createLinearGradient(0, 0, 56, 0);
    leftSand.addColorStop(0, "rgba(182, 156, 118, 0.92)");
    leftSand.addColorStop(0.55, "rgba(182, 156, 118, 0.38)");
    leftSand.addColorStop(1, "rgba(182, 156, 118, 0.0)");
    rctx.fillStyle = leftSand;
    rctx.fillRect(0, 0, 56, 1024);

    const rightSand = rctx.createLinearGradient(456, 0, 512, 0);
    rightSand.addColorStop(0, "rgba(182, 156, 118, 0.0)");
    rightSand.addColorStop(0.45, "rgba(182, 156, 118, 0.38)");
    rightSand.addColorStop(1, "rgba(182, 156, 118, 0.92)");
    rctx.fillStyle = rightSand;
    rctx.fillRect(456, 0, 56, 1024);

    // Weathered white edge lines
    rctx.fillStyle = "rgba(236, 238, 240, 0.78)";
    rctx.fillRect(42, 0, 9, 1024);
    rctx.fillRect(461, 0, 9, 1024);

    // Dashed yellow center highway stripe
    rctx.fillStyle = "rgba(240, 192, 58, 0.88)";
    for (let y = 28; y < 1024; y += 128) {
      rctx.fillRect(250, y, 12, 68);
    }

    const roadTexNS = new THREE.CanvasTexture(rc);
    roadTexNS.wrapS = roadTexNS.wrapT = THREE.RepeatWrapping;
    roadTexNS.repeat.set(1, 24);
    this.configureTexture(roadTexNS, true);

    const roadTexEW = roadTexNS.clone();
    roadTexEW.repeat.set(1, 19);
    this.configureTexture(roadTexEW, true);

    const roadMatNS = new THREE.MeshStandardMaterial({
      map: roadTexNS,
      normalMap: sandNormalTex,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.8,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const roadMatEW = new THREE.MeshStandardMaterial({
      map: roadTexEW,
      normalMap: sandNormalTex,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.8,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });

    // North-South Main Strategic Highway (Z: -220 .. +220 at X = -16)
    const nsRoad = new THREE.Mesh(new THREE.PlaneGeometry(13, 445), roadMatNS);
    nsRoad.rotation.x = -Math.PI / 2;
    nsRoad.position.set(-16, 0.02, 0);
    nsRoad.receiveShadow = true;
    this.scene.add(nsRoad);

    // East-West Cross Highway connecting Charlie (-105) -> Alpha (0) -> Bravo (+105)
    const ewRoad = new THREE.Mesh(new THREE.PlaneGeometry(12, 355), roadMatEW);
    ewRoad.rotation.x = -Math.PI / 2;
    ewRoad.rotation.z = Math.PI / 2;
    ewRoad.position.set(0, 0.025, 14);
    ewRoad.receiveShadow = true;
    this.scene.add(ewRoad);

    // Detailed Expansion-Joint Concrete Foundations + Raised Perimeter Curbs under Urban Sectors & HQs
    const { map: plazaBaseMap, normalMap: plazaBaseNorm } = this.createConcretePlazaTextures();
    const curbMat = new THREE.MeshStandardMaterial({
      color: 0x8e897e,
      roughness: 0.84,
      metalness: 0.05,
    });

    const plazas: Array<[number, number, number, number]> = [
      [0, 0, 42, 36],      // Sector Alpha Twin-Tower Urban Plaza
      [105, 20, 44, 38],   // Sector Bravo Container Logistics Port
      [-105, -15, 40, 36], // Sector Charlie Oasis Town Courtyard
      [-16, -108, 34, 28], // Sector Delta North Checkpoint
      [22, 102, 36, 30],   // Sector Echo Industrial Depot
      [0, 168, 56, 36],    // NATO South Main Operating Base
      [0, -168, 56, 36],   // PAX North Main Operating Base
    ];

    // Collect all 28 perimeter curb segments into 1 InstancedMesh draw call!
    const curbMatrices: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();

    for (const [px, pz, pw, pd] of plazas) {
      const pMap = plazaBaseMap.clone();
      pMap.repeat.set(pw / 12, pd / 12);
      this.configureTexture(pMap, true);

      const pNorm = plazaBaseNorm.clone();
      pNorm.repeat.set(pw / 12, pd / 12);
      this.configureTexture(pNorm, false);

      const pMat = new THREE.MeshStandardMaterial({
        map: pMap,
        normalMap: pNorm,
        normalScale: new THREE.Vector2(0.75, 0.75),
        roughness: 0.84,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });

      const p = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), pMat);
      p.rotation.x = -Math.PI / 2;
      p.position.set(px, 0.015, pz);
      p.receiveShadow = true;
      this.scene.add(p);

      // North & South concrete curb strips (low 7cm bevel so vehicles roll over smoothly without snagging)
      for (const side of [-1, 1]) {
        dummy.position.set(px, 0.035, pz + side * (pd * 0.5));
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(pw + 0.36, 0.07, 0.36);
        dummy.updateMatrix();
        curbMatrices.push(dummy.matrix.clone());

        dummy.position.set(px + side * (pw * 0.5), 0.035, pz);
        dummy.scale.set(0.36, 0.07, pd);
        dummy.updateMatrix();
        curbMatrices.push(dummy.matrix.clone());
      }
    }

    const curbInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), curbMat, curbMatrices.length);
    curbInst.receiveShadow = true;
    curbMatrices.forEach((m, idx) => curbInst.setMatrixAt(idx, m));
    curbInst.computeBoundingSphere();
    curbInst.matrixAutoUpdate = false;
    this.scene.add(curbInst);

    // Helipad [H] Markings at NATO South Airbase (18, 168) & PAX North Airbase (-18, -168)
    this.buildHelipadDecal(18, 168, 0x00e5ff);
    this.buildHelipadDecal(-18, -168, 0xff6633);
  }

  private buildHelipadDecal(x: number, z: number, accentHex: number): void {
    const hc = document.createElement("canvas");
    hc.width = 512;
    hc.height = 512;
    const ctx = hc.getContext("2d")!;
    ctx.fillStyle = "#454950";
    ctx.fillRect(0, 0, 512, 512);

    // Subtle concrete apron grit & rotor scorch ring
    for (let i = 0; i < 5000; i++) {
      ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.08)";
      ctx.fillRect((i * 97) % 512, (i * 181) % 512, 2, 2);
    }

    // Hazard chevron corner ticks + yellow perimeter box + touchdown circle
    ctx.strokeStyle = "#f2c94c";
    ctx.lineWidth = 18;
    ctx.strokeRect(28, 28, 456, 456);
    ctx.beginPath();
    ctx.arc(256, 256, 174, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    ctx.beginPath();
    ctx.arc(256, 256, 196, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = `#${accentHex.toString(16).padStart(6, "0")}`;
    ctx.font = "bold 210px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("H", 256, 266);

    const tex = new THREE.CanvasTexture(hc);
    this.configureTexture(tex, true);

    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.76,
        polygonOffset: true,
        polygonOffsetFactor: -3,
      })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(x, 0.03, z);
    pad.receiveShadow = true;
    this.scene.add(pad);
  }

  /**
   * Replaces sparse low-poly cones with TWO continuous 360° geological mountain rings:
   *  1. Mid-Distance Terraced Sandstone Mesas & Foothill Ridges (385..690m)
   *  2. Far Horizon Jagged Mountain Range (690..1380m) with vertex-colored talus, strata & sunlit peaks!
   */
  private buildDistantMountainRing(): void {
    const innerMesas = this.createGeologicalRingGeometry({
      angSegs: 168,
      radSegs: 14,
      rInner: 385,
      rOuter: 695,
      peakMin: 36,
      peakMax: 102,
      terracedMesa: true,
      seedOffset: 1.7,
    });

    const outerPeaks = this.createGeologicalRingGeometry({
      angSegs: 196,
      radSegs: 14,
      rInner: 680,
      rOuter: 1380,
      peakMin: 95,
      peakMax: 255,
      terracedMesa: false,
      seedOffset: 5.3,
    });

    const mountainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0,
      flatShading: false,
    });

    const innerMesh = new THREE.Mesh(innerMesas, mountainMat);
    const outerMesh = new THREE.Mesh(outerPeaks, mountainMat);
    innerMesh.matrixAutoUpdate = false;
    outerMesh.matrixAutoUpdate = false;
    this.scene.add(innerMesh);
    this.scene.add(outerMesh);
  }

  private createGeologicalRingGeometry(opts: {
    angSegs: number;
    radSegs: number;
    rInner: number;
    rOuter: number;
    peakMin: number;
    peakMax: number;
    terracedMesa: boolean;
    seedOffset: number;
  }): THREE.BufferGeometry {
    const { angSegs, radSegs, rInner, rOuter, peakMin, peakMax, terracedMesa, seedOffset } = opts;
    const cols = angSegs + 1;
    const rows = radSegs + 1;
    const positions = new Float32Array(cols * rows * 3);
    const colors = new Float32Array(cols * rows * 3);
    const indices: number[] = [];

    const talusCol = new THREE.Color(0xb69c77); // Warm sand apron blending seamlessly with ground
    const cliffCol = new THREE.Color(terracedMesa ? 0x9b7958 : 0x846c56); // Stratified sandstone / slate ochre
    const ridgeCol = new THREE.Color(terracedMesa ? 0xc29f78 : 0x9d8a78); // Sun-bleached crest rock
    const gullyCol = new THREE.Color(0x635040); // Deep eroded canyon shadow
    const tmpCol = new THREE.Color();

    for (let rIdx = 0; rIdx < rows; rIdx++) {
      const v = rIdx / radSegs; // 0 = inner skirt, ~0.48 = main ridge crest, 1 = outer backslope
      for (let aIdx = 0; aIdx < cols; aIdx++) {
        // Wrap seam cleanly so aIdx === angSegs matches aIdx === 0
        const wrapA = aIdx % angSegs;
        const theta = (wrapA / angSegs) * Math.PI * 2;

        // Multi-harmonic angular ridge profile (peaks + mountain passes/canyons)
        const ridgeWave =
          Math.sin(theta * 5 + seedOffset) * 0.34 +
          Math.sin(theta * 11 - seedOffset * 1.7) * 0.25 +
          Math.cos(theta * 19 + seedOffset * 0.8) * 0.18 +
          Math.sin(theta * 31 + v * 4.2) * 0.13 +
          Math.cos(theta * 47 - v * 6.5) * 0.08;
        const normWave = THREE.MathUtils.clamp(ridgeWave * 0.55 + 0.52, 0.08, 1.0);

        // Radial cross-section envelope: rises smoothly from ground at v=0, peaks around v=0.46, tapers to v=1.0
        const crestEnv = Math.sin(Math.pow(v, 0.78) * Math.PI);
        // Secondary sub-ridge shoulder for realistic layered massif depth
        const subPeak = Math.exp(-Math.pow((v - 0.24) / 0.12, 2)) * 0.42;
        const radialEnv = Math.min(1.0, crestEnv * 0.92 + subPeak * (0.5 + 0.5 * Math.sin(theta * 9 + seedOffset)));

        const jitterR =
          (Math.sin(theta * 17 + v * 8.0 + seedOffset) * 14 +
            Math.cos(theta * 29 - v * 5.0) * 9) *
          Math.sin(v * Math.PI);
        const radius = THREE.MathUtils.lerp(rInner, rOuter, v) + jitterR;

        const vx = Math.cos(theta) * radius;
        const vz = Math.sin(theta) * radius;
        const baseGround = v < 0.18 ? this.sampleTerrainHeight(vx, vz) * (1 - v / 0.18) : 0;

        let rawH = THREE.MathUtils.lerp(peakMin, peakMax, normWave) * radialEnv;
        // Carve eroded vertical gullies down mountain flanks
        const gully = Math.pow(Math.abs(Math.sin(theta * 27 + v * 3.1 + seedOffset)), 3.0);
        rawH *= 1.0 - gully * 0.22 * (1.0 - Math.abs(v - 0.45));

        if (terracedMesa && rawH > 22) {
          // Sedimentary desert mesa cliff step-terracing!
          const step = 14.0;
          const stepped =
            Math.floor(rawH / step) * step + THREE.MathUtils.smoothstep(rawH % step, 0, step * 0.55) * step;
          rawH = THREE.MathUtils.lerp(rawH, Math.min(rawH + 4, stepped * 0.92), 0.52);
        }

        const finalY = v === 0 ? Math.max(0, baseGround - 1.5) : baseGround + rawH;

        const idx = (rIdx * cols + aIdx) * 3;
        positions[idx] = vx;
        positions[idx + 1] = finalY;
        positions[idx + 2] = vz;

        // Geological vertex color blending: sandy talus base -> stratified cliff -> sun-bleached ridge + dark gullies
        const hRatio = THREE.MathUtils.clamp(rawH / peakMax, 0, 1);
        tmpCol.copy(talusCol).lerp(cliffCol, THREE.MathUtils.smoothstep(hRatio, 0.05, 0.52));
        tmpCol.lerp(ridgeCol, THREE.MathUtils.smoothstep(hRatio, 0.55, 0.92));
        tmpCol.lerp(gullyCol, gully * 0.35 * THREE.MathUtils.smoothstep(hRatio, 0.12, 0.7));

        // Subtle horizontal sedimentary strata bands on mesas
        if (terracedMesa) {
          const band = Math.sin(finalY * 0.38) * 0.045;
          tmpCol.offsetHSL(0, 0, band);
        }

        colors[idx] = tmpCol.r;
        colors[idx + 1] = tmpCol.g;
        colors[idx + 2] = tmpCol.b;
      }
    }

    for (let r = 0; r < radSegs; r++) {
      for (let a = 0; a < angSegs; a++) {
        const i0 = r * cols + a;
        const i1 = i0 + 1;
        const i2 = (r + 1) * cols + a;
        const i3 = i2 + 1;
        indices.push(i0, i2, i1);
        indices.push(i1, i2, i3);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * High-altitude sunlit desert cirrus/cumulus cloud decks slowly drifting at Y = 360..430m.
   */
  private buildHighAltitudeClouds(): void {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, 256, 256);

    // Multi-puff soft procedural cloud alpha sprite
    const puffs: Array<[number, number, number, number]> = [
      [128, 128, 92, 0.52],
      [86, 134, 68, 0.42],
      [172, 132, 72, 0.42],
      [114, 98, 62, 0.36],
      [152, 104, 58, 0.34],
    ];
    for (const [cx, cy, rad, alpha] of puffs) {
      const g = ctx.createRadialGradient(cx, cy, rad * 0.12, cx, cy, rad);
      g.addColorStop(0, `rgba(255, 250, 240, ${alpha})`);
      g.addColorStop(0.55, `rgba(248, 238, 222, ${alpha * 0.55})`);
      g.addColorStop(1, "rgba(248, 238, 222, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    const cloudTex = new THREE.CanvasTexture(c);
    this.configureTexture(cloudTex, true);

    const cloudMat = new THREE.MeshBasicMaterial({
      map: cloudTex,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });

    this.cloudGroup = new THREE.Group();
    const planeGeo = new THREE.PlaneGeometry(1, 1);
    planeGeo.rotateX(-Math.PI / 2);

    let seed = 9012;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    for (let i = 0; i < 26; i++) {
      const ang = (i / 26) * Math.PI * 2 + rand() * 0.3;
      const dist = 220 + rand() * 980;
      const m = new THREE.Mesh(planeGeo, cloudMat);
      m.position.set(Math.cos(ang) * dist, 365 + rand() * 65, Math.sin(ang) * dist);
      m.rotation.y = rand() * Math.PI * 2;
      m.scale.set(240 + rand() * 260, 1, 130 + rand() * 160);
      this.cloudGroup.add(m);
    }
    this.scene.add(this.cloudGroup);
  }

  /**
   * Distant Battlefield Vista Landmarks on Outer Ridges & Desert Flats:
   *  - 3 Lattice Communications / Radar Towers with blinking red aviation warning beacons
   *  - 8 High-Voltage Transmission Pylons marching across the eastern/northern valley rim
   */
  private buildVistaLandmarks(): void {
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x484d54,
      roughness: 0.65,
      metalness: 0.55,
    });
    const dishMat = new THREE.MeshStandardMaterial({
      color: 0xd8d4ca,
      roughness: 0.48,
      metalness: 0.25,
    });

    const towerSites: Array<[number, number, number]> = [
      [-365, -310, 58],
      [410, -245, 64],
      [335, 355, 54],
    ];

    for (let idx = 0; idx < towerSites.length; idx++) {
      const [tx, tz, th] = towerSites[idx];
      const baseY = this.sampleTerrainHeight(tx, tz);
      const grp = new THREE.Group();
      grp.position.set(tx, baseY, tz);

      // Tapered 4-sided lattice mast silhouette + cross-platforms + microwave dishes
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 3.2, th, 4, 1, true), steelMat);
      mast.position.y = th * 0.5;
      mast.rotation.y = Math.PI * 0.25;
      grp.add(mast);

      const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.45, 14, 6), steelMat);
      spire.position.y = th + 7;
      grp.add(spire);

      for (const frac of [0.45, 0.75, 0.96]) {
        const deck = new THREE.Mesh(new THREE.BoxGeometry(4.6 * (1.15 - frac * 0.5), 0.5, 4.6 * (1.15 - frac * 0.5)), steelMat);
        deck.position.y = th * frac;
        grp.add(deck);
      }

      const dish = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 0.5, 1.1, 12), dishMat);
      dish.rotation.z = Math.PI * 0.5;
      dish.position.set(1.6, th * 0.78, 0);
      grp.add(dish);

      // Blinking Red Aviation Obstruction Beacon at mast tip
      const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2211, fog: false });
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.15, 8, 8), beaconMat);
      beacon.position.y = th + 14.2;
      grp.add(beacon);
      this.beacons.push({ mesh: beacon, mat: beaconMat, phase: idx * 2.1 });

      grp.updateMatrixWorld(true);
      this.scene.add(grp);
    }

    // Distant High-Voltage Power Pylons marching along the eastern desert corridor (X ~ 265..310)
    const pylonMatrices: THREE.Matrix4[] = [];
    const armMatrices: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();
    for (let z = -300; z <= 300; z += 85) {
      const px = 278 + Math.sin(z * 0.01) * 14;
      const py = this.sampleTerrainHeight(px, z);
      dummy.position.set(px, py + 14, z);
      dummy.rotation.set(0, Math.PI * 0.25, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      pylonMatrices.push(dummy.matrix.clone());

      dummy.position.set(px, py + 24, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(9.5, 0.45, 0.45);
      dummy.updateMatrix();
      armMatrices.push(dummy.matrix.clone());
    }

    const pylonGeo = new THREE.CylinderGeometry(0.45, 1.85, 28, 4);
    const pylonInst = new THREE.InstancedMesh(pylonGeo, steelMat, pylonMatrices.length);
    pylonMatrices.forEach((m, i) => pylonInst.setMatrixAt(i, m));
    pylonInst.computeBoundingSphere();
    pylonInst.matrixAutoUpdate = false;
    this.scene.add(pylonInst);

    const armInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), steelMat, armMatrices.length);
    armMatrices.forEach((m, i) => armInst.setMatrixAt(i, m));
    armInst.computeBoundingSphere();
    armInst.matrixAutoUpdate = false;
    this.scene.add(armInst);
  }

  /**
   * Batched InstancedMesh Date Palms (with GPU Wind Sway + Bark Rings + Coconut Clusters),
   * Scrub Bushes, Stratified Sandstone Outcrops & Near-Ground Rock Cobbles!
   * Transitions seamlessly from the 440m combat zone out to +-410m desert foothills!
   */
  private buildVegetationAndRocks(excludeZones: Array<{ x: number; z: number; r: number }>): void {
    const isClear = (x: number, z: number, pad = 0): boolean => {
      // Keep off main NS road (X = -16) and EW road (Z = 14) inside highway span
      if (Math.abs(z) < 230 && Math.abs(x - -16) < 8.5 + pad) return false;
      if (Math.abs(x) < 185 && Math.abs(z - 14) < 8.0 + pad) return false;
      for (const ez of excludeZones) {
        if (Math.hypot(x - ez.x, z - ez.z) < ez.r + pad) return false;
      }
      return true;
    };

    // --- A. DATE PALM TREES (210 instances: Ringed Curved Trunk + 12-Frond Wind-Animated Canopy) ---
    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.34, 6.8, 10, 10);
    trunkGeo.translate(0, 3.4, 0);
    const tp = trunkGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i);
      // Ringed date-palm leaf-scar ridges + natural parabolic bend toward +X
      const ringScale = 1.0 + Math.sin(y * 16.0) * 0.065;
      tp.setX(i, tp.getX(i) * ringScale + (y / 6.8) * (y / 6.8) * 0.42);
      tp.setZ(i, tp.getZ(i) * ringScale);
    }
    trunkGeo.computeVertexNormals();

    const crownGeo = this.createPalmCrownGeometry();

    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x6f543c,
      roughness: 0.91,
    });
    const crownMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.74,
      side: THREE.DoubleSide,
    });

    // GPU Vertex-Shader Breeze Sway on all 210 Date Palm Crowns (0 CPU cost!)
    crownMat.customProgramCacheKey = () => "bf6_palm_wind_sway_v1";
    crownMat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = this.windUniform;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
uniform float uWindTime;`
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
float frondFlex = max(0.0, (transformed.y - 5.2) * 0.28);
float instPhase = 0.0;
#ifdef USE_INSTANCING
  instPhase = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.17;
#endif
float radialReach = length(transformed.xz);
float gust = sin(uWindTime * 1.85 + instPhase + radialReach * 0.55) * 0.085
           + cos(uWindTime * 3.10 + instPhase * 1.7) * 0.032;
transformed.x += gust * frondFlex * (0.4 + radialReach * 0.35);
transformed.y -= abs(gust) * frondFlex * radialReach * 0.14;
transformed.z += gust * 0.65 * frondFlex;`
        );
    };

    const palmCoords: Array<{ x: number; y: number; z: number; s: number; rot: number; tint: number }> = [];

    const curatedPalms: Array<[number, number]> = [
      [-25, 25], [-25, -8], [-25, -28], [-7, 26], [-7, 38], [-7, -26],
      [22, 24], [48, 24], [72, 24], [-42, 24], [-68, 24],
      [-126, -6], [-128, -22], [-92, -36], [-84, 6],
      [82, 36], [128, 6], [126, 34],
      [-28, 152], [28, 152], [-28, -152], [28, -152],
    ];
    for (const [px, pz] of curatedPalms) {
      if (isClear(px, pz, 1.2)) {
        palmCoords.push({
          x: px,
          y: this.sampleTerrainHeight(px, pz),
          z: pz,
          s: 0.9 + Math.random() * 0.32,
          rot: Math.random() * Math.PI * 2,
          tint: Math.random(),
        });
      }
    }

    let seed = 1337;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    // Inner valley palms (within 420m box)
    for (let tries = 0; tries < 750 && palmCoords.length < 168; tries++) {
      const x = (rand() - 0.5) * 415;
      const z = (rand() - 0.5) * 415;
      if (!isClear(x, z, 2.5)) continue;
      palmCoords.push({
        x,
        y: this.sampleTerrainHeight(x, z),
        z,
        s: 0.76 + rand() * 0.54,
        rot: rand() * Math.PI * 2,
        tint: rand(),
      });
    }

    // Outer wadi oasis transition palms (210..330m radius so palms fade naturally into desert!)
    for (let tries = 0; tries < 300 && palmCoords.length < 210; tries++) {
      const ang = rand() * Math.PI * 2;
      const dist = 215 + rand() * 115;
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      if (!isClear(x, z, 2.5)) continue;
      palmCoords.push({
        x,
        y: this.sampleTerrainHeight(x, z) - 0.15,
        z,
        s: 0.72 + rand() * 0.58,
        rot: rand() * Math.PI * 2,
        tint: rand(),
      });
    }

    const palmTrunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmCoords.length);
    const palmCrowns = new THREE.InstancedMesh(crownGeo, crownMat, palmCoords.length);
    palmTrunks.castShadow = true;
    palmTrunks.receiveShadow = false;
    palmCrowns.castShadow = true;
    palmCrowns.receiveShadow = false;

    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    palmCoords.forEach((p, idx) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      palmTrunks.setMatrixAt(idx, dummy.matrix);
      palmCrowns.setMatrixAt(idx, dummy.matrix);

      col.setRGB(0.9 + p.tint * 0.2, 0.92 + p.tint * 0.16, 0.85 + p.tint * 0.15);
      palmCrowns.setColorAt(idx, col);

      if (Math.hypot(p.x, p.z) < 225) {
        this.physics.addManualBox(
          new THREE.Box3(
            new THREE.Vector3(p.x - 0.28, p.y, p.z - 0.28),
            new THREE.Vector3(p.x + 0.28, p.y + 5.5 * p.s, p.z + 0.28)
          )
        );
      }
    });
    if (palmCrowns.instanceColor) palmCrowns.instanceColor.needsUpdate = true;
    palmTrunks.computeBoundingSphere();
    palmCrowns.computeBoundingSphere();
    palmTrunks.matrixAutoUpdate = false;
    palmCrowns.matrixAutoUpdate = false;
    this.scene.add(palmTrunks);
    this.scene.add(palmCrowns);

    // --- B. DESERT SCRUB BUSHES & DRY GRASS TUFTS (520 instances across 0..390m, 1 draw call!) ---
    const bushGeo = this.createScrubTuftGeometry();
    const bushMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      side: THREE.DoubleSide,
    });

    const bushCoords: Array<{ x: number; y: number; z: number; sx: number; sy: number; rot: number; tint: number }> = [];
    for (let tries = 0; tries < 1800 && bushCoords.length < 520; tries++) {
      const isOuter = bushCoords.length >= 370;
      let x: number;
      let z: number;
      if (isOuter) {
        const ang = rand() * Math.PI * 2;
        const dist = 212 + rand() * 175;
        x = Math.cos(ang) * dist;
        z = Math.sin(ang) * dist;
      } else {
        x = (rand() - 0.5) * 430;
        z = (rand() - 0.5) * 430;
      }
      if (!isClear(x, z, 0.7)) continue;
      bushCoords.push({
        x,
        y: this.sampleTerrainHeight(x, z),
        z,
        sx: 0.65 + rand() * 1.15,
        sy: 0.6 + rand() * 0.95,
        rot: rand() * Math.PI * 2,
        tint: rand(),
      });
    }

    const bushes = new THREE.InstancedMesh(bushGeo, bushMat, bushCoords.length);
    bushes.castShadow = false;
    bushes.receiveShadow = false;
    bushCoords.forEach((b, idx) => {
      dummy.position.set(b.x, b.y, b.z);
      dummy.rotation.set(0, b.rot, 0);
      dummy.scale.set(b.sx, b.sy, b.sx);
      dummy.updateMatrix();
      bushes.setMatrixAt(idx, dummy.matrix);
      // Mix olive oasis scrub with sun-bleached golden desert grass tufts
      col.setRGB(0.42 + b.tint * 0.24, 0.46 + b.tint * 0.14, 0.25 + b.tint * 0.12);
      bushes.setColorAt(idx, col);
    });
    if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
    bushes.computeBoundingSphere();
    bushes.matrixAutoUpdate = false;
    this.scene.add(bushes);

    // --- C. STRATIFIED SANDSTONE ROCK OUTCROPS & FOOTHILL BOULDERS (185 instances, 1 draw call!) ---
    const rockGeo = this.createStratifiedBoulderGeometry();
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.93,
      metalness: 0.02,
    });

    const rockCoords: Array<{
      x: number;
      y: number;
      z: number;
      sx: number;
      sy: number;
      sz: number;
      rot: number;
      tint: number;
      hasCollider: boolean;
    }> = [];

    for (let tries = 0; tries < 950 && rockCoords.length < 185; tries++) {
      const isOuter = rockCoords.length >= 115;
      let x: number;
      let z: number;
      if (isOuter) {
        const ang = rand() * Math.PI * 2;
        const dist = 218 + rand() * 210;
        x = Math.cos(ang) * dist;
        z = Math.sin(ang) * dist;
      } else {
        x = (rand() - 0.5) * 420;
        z = (rand() - 0.5) * 420;
      }
      if (!isClear(x, z, 3.0)) continue;
      const scaleBoost = isOuter ? 1.45 + rand() * 1.6 : 1.0;
      rockCoords.push({
        x,
        y: this.sampleTerrainHeight(x, z) - (isOuter ? 0.25 : 0.05),
        z,
        sx: (0.85 + rand() * 1.65) * scaleBoost,
        sy: (0.72 + rand() * 1.35) * scaleBoost,
        sz: (0.85 + rand() * 1.55) * scaleBoost,
        rot: rand() * Math.PI * 2,
        tint: rand(),
        hasCollider: !isOuter,
      });
    }

    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCoords.length);
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    rockCoords.forEach((r, idx) => {
      dummy.position.set(r.x, r.y, r.z);
      dummy.rotation.set(0, r.rot, 0);
      dummy.scale.set(r.sx, r.sy, r.sz);
      dummy.updateMatrix();
      rocks.setMatrixAt(idx, dummy.matrix);

      col.setRGB(0.58 + r.tint * 0.14, 0.48 + r.tint * 0.12, 0.37 + r.tint * 0.1);
      rocks.setColorAt(idx, col);

      if (r.hasCollider) {
        const rx = 1.05 * r.sx;
        const rz = 1.05 * r.sz;
        const ry = 1.25 * r.sy;
        this.physics.addManualBox(
          new THREE.Box3(new THREE.Vector3(r.x - rx, 0, r.z - rz), new THREE.Vector3(r.x + rx, ry, r.z + rz))
        );
      }
    });
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    rocks.computeBoundingSphere();
    rocks.matrixAutoUpdate = false;
    this.scene.add(rocks);

    // --- D. NEAR-GROUND ROCK COBBLES & GRAVEL MICRO-CLUTTER (720 instances, 1 draw call, 0 shadow cost!) ---
    // Gives close-up infantry combat ground rich 3D stony relief along roadsides, plazas & desert flats!
    const cobbleGeo = new THREE.DodecahedronGeometry(0.18, 0);
    cobbleGeo.scale(1.35, 0.52, 1.1);
    cobbleGeo.translate(0, 0.05, 0);
    const cobbleMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.94,
      flatShading: true,
    });

    const cobbles = new THREE.InstancedMesh(cobbleGeo, cobbleMat, 720);
    cobbles.castShadow = false;
    cobbles.receiveShadow = true;
    for (let i = 0; i < 720; i++) {
      // Concentrate 75% inside the 220m infantry combat zone for dense near-ground detail, 25% in outer transition
      const rSpan = i < 540 ? 215 : 350;
      let cx = (rand() - 0.5) * rSpan * 2;
      let cz = (rand() - 0.5) * rSpan * 2;
      // Nudge off asphalt centerlines onto sandy shoulders
      if (Math.abs(cx - -16) < 6.2) cx = -16 + (cx >= -16 ? 7.2 : -7.2) + (rand() - 0.5) * 2.0;
      if (Math.abs(cz - 14) < 5.8) cz = 14 + (cz >= 14 ? 6.8 : -6.8) + (rand() - 0.5) * 2.0;

      const cy = this.sampleTerrainHeight(cx, cz);
      const sc = 0.6 + rand() * 1.75;
      dummy.position.set(cx, cy, cz);
      dummy.rotation.set((rand() - 0.5) * 0.25, rand() * Math.PI * 2, (rand() - 0.5) * 0.25);
      dummy.scale.set(sc * (0.85 + rand() * 0.4), sc * (0.65 + rand() * 0.5), sc * (0.85 + rand() * 0.4));
      dummy.updateMatrix();
      cobbles.setMatrixAt(i, dummy.matrix);

      const t = rand();
      col.setRGB(0.52 + t * 0.2, 0.44 + t * 0.17, 0.34 + t * 0.14);
      cobbles.setColorAt(i, col);
    }
    if (cobbles.instanceColor) cobbles.instanceColor.needsUpdate = true;
    cobbles.computeBoundingSphere();
    cobbles.matrixAutoUpdate = false;
    this.scene.add(cobbles);
  }

  /**
   * Builds a lush multi-tiered 13-frond Date Palm crown with individual serrated pinnate leaflets
   * AND golden-brown date/coconut fruit clusters beneath the crown heart!
   */
  private createPalmCrownGeometry(): THREE.BufferGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const topX = 0.42;
    const topY = 6.72;

    const pushTri = (
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number,
      r: number, g: number, b: number
    ) => {
      positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
      for (let k = 0; k < 3; k++) colors.push(r, g, b);
    };

    // 2 Tiers: 8 lower/mid spreading fronds + 5 upper fountain fronds
    const frondSpecs: Array<{ ang: number; len: number; rise: number; droop: number; shade: number }> = [];
    for (let f = 0; f < 9; f++) {
      frondSpecs.push({
        ang: (f / 9) * Math.PI * 2 + (f % 2) * 0.1,
        len: 3.25 + (f % 3) * 0.26,
        rise: 0.52,
        droop: 1.55,
        shade: 0.92 + (f % 2) * 0.08,
      });
    }
    for (let f = 0; f < 5; f++) {
      frondSpecs.push({
        ang: (f / 5) * Math.PI * 2 + 0.33,
        len: 2.35 + (f % 2) * 0.25,
        rise: 1.05,
        droop: 0.78,
        shade: 1.08,
      });
    }

    for (const sp of frondSpecs) {
      const dx = Math.cos(sp.ang);
      const dz = Math.sin(sp.ang);
      const px = -dz;
      const pz = dx;
      const leaflets = 9;

      for (let s = 0; s < leaflets; s++) {
        const t0 = s / leaflets;
        const t1 = (s + 1) / leaflets;
        const tMid = (t0 + t1) * 0.5;

        const r0 = t0 * sp.len;
        const r1 = t1 * sp.len;
        const rTip = (t0 + 0.82 / leaflets) * sp.len + 0.14;

        const y0 = topY + Math.sin(t0 * Math.PI * 0.72) * sp.rise - t0 * t0 * sp.droop;
        const y1 = topY + Math.sin(t1 * Math.PI * 0.72) * sp.rise - t1 * t1 * sp.droop;
        const yTip = (y0 + y1) * 0.5 - 0.19 - tMid * 0.12;

        const span = Math.sin(Math.max(0.1, Math.min(0.96, tMid)) * Math.PI) * 0.56;

        const c0x = topX + dx * r0;
        const c0z = dz * r0;
        const c1x = topX + dx * r1;
        const c1z = dz * r1;

        // Narrow woody central rachis spine strip
        const rw = 0.032 * (1 - t0 * 0.65);
        pushTri(
          c0x - px * rw, y0 + 0.04, c0z - pz * rw,
          c0x + px * rw, y0 + 0.04, c0z + pz * rw,
          c1x, y1 + 0.03, c1z,
          0.34 * sp.shade, 0.46 * sp.shade, 0.21 * sp.shade
        );

        // Individual V-angled pointed pinnate leaflet blades on left & right of rachis!
        const greenR = (0.26 + tMid * 0.09) * sp.shade;
        const greenG = (0.45 + tMid * 0.07) * sp.shade;
        const greenB = (0.19 + tMid * 0.04) * sp.shade;

        for (const side of [-1, 1]) {
          const tipX = topX + dx * rTip + px * span * side;
          const tipZ = dz * rTip + pz * span * side;
          if (side > 0) {
            pushTri(c0x, y0 + 0.04, c0z, tipX, yTip, tipZ, c1x, y1 + 0.03, c1z, greenR, greenG, greenB);
          } else {
            pushTri(c0x, y0 + 0.04, c0z, c1x, y1 + 0.03, c1z, tipX, yTip, tipZ, greenR, greenG, greenB);
          }
        }
      }
    }

    // 4 Golden-Brown Date / Coconut Clusters tucked beneath crown heart
    const nutGeo = new THREE.DodecahedronGeometry(0.18, 0);
    const np = nutGeo.attributes.position;
    for (let cIdx = 0; cIdx < 4; cIdx++) {
      const ca = (cIdx / 4) * Math.PI * 2 + 0.4;
      const ox = topX + Math.cos(ca) * 0.26;
      const oy = topY - 0.22;
      const oz = Math.sin(ca) * 0.26;
      for (let i = 0; i < np.count; i += 3) {
        pushTri(
          np.getX(i) + ox, np.getY(i) * 1.25 + oy, np.getZ(i) + oz,
          np.getX(i + 1) + ox, np.getY(i + 1) * 1.25 + oy, np.getZ(i + 1) + oz,
          np.getX(i + 2) + ox, np.getY(i + 2) * 1.25 + oy, np.getZ(i + 2) + oz,
          0.56, 0.38, 0.16
        );
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Multi-lobed desert scrub + radiating dry grass blades merged into 1 lightweight mesh.
   */
  private createScrubTuftGeometry(): THREE.BufferGeometry {
    const positions: number[] = [];
    const pushBlade = (ang: number, tilt: number, h: number, w: number, ox: number, oz: number) => {
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      const px = -dz * w;
      const pz = dx * w;
      const tx = ox + dx * tilt;
      const tz = oz + dz * tilt;
      positions.push(ox - px, 0.0, oz - pz, ox + px, 0.0, oz + pz, tx, h, tz);
    };

    // 14 radiating arched desert grass/thorn blades + woody core mound
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2 + (i % 3) * 0.14;
      const ring = i % 2 === 0 ? 0.12 : 0.28;
      pushBlade(
        ang,
        0.42 + (i % 3) * 0.16,
        0.58 + (i % 4) * 0.14,
        0.085,
        Math.cos(ang) * ring,
        Math.sin(ang) * ring
      );
    }

    // Central foliated shrub dome
    const core = new THREE.DodecahedronGeometry(0.55, 1);
    core.scale(1.25, 0.65, 1.15);
    core.translate(0, 0.32, 0);
    const nonIdx = core.toNonIndexed();
    const cp = nonIdx.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      positions.push(cp.getX(i), cp.getY(i), cp.getZ(i));
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Layered desert sandstone outcrop with primary boulder + secondary stepped shelf ledge.
   */
  private createStratifiedBoulderGeometry(): THREE.BufferGeometry {
    const positions: number[] = [];

    const appendLobe = (rx: number, ry: number, rz: number, ox: number, oy: number, oz: number, seed: number) => {
      const d = new THREE.IcosahedronGeometry(1.0, 2).toNonIndexed();
      const p = d.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let vx = p.getX(i);
        let vy = p.getY(i);
        let vz = p.getZ(i);
        // Stratified horizontal desert rock ledges + angular fracture facets
        const strata = Math.sin(vy * 7.5 + seed) * 0.08;
        const crag = Math.sin(vx * 3.7 + vz * 4.1 + seed) * 0.14;
        vx = vx * rx * (1 + strata + crag) + ox;
        vy = Math.max(-0.08, (vy * 0.68 + 0.52) * ry * (1 - Math.abs(strata) * 0.35) + oy);
        vz = vz * rz * (1 + strata - crag * 0.6) + oz;
        positions.push(vx, vy, vz);
      }
    };

    appendLobe(1.22, 1.15, 1.08, 0, 0, 0, 0.4);
    appendLobe(0.78, 0.62, 0.72, 0.62, 0, 0.34, 2.1);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }

  private buildHighwayPolesAndSilos(): void {
    // Upgraded Streetlight Poles: Tapered Steel Mast + Cantilevered Luminaire Arm + Lamp Housing
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x4b5056, roughness: 0.62, metalness: 0.48 });
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xfff0d2,
      emissive: 0xffc978,
      emissiveIntensity: 0.55,
      roughness: 0.3,
    });

    const coords: Array<{ x: number; z: number; rotY: number }> = [];
    for (let z = -160; z <= 160; z += 32) {
      if (Math.abs(z - 14) > 12) coords.push({ x: -23.5, z, rotY: 0 }); // Arm extends +X over NS road (-16)
    }
    for (let x = -140; x <= 140; x += 34) {
      if (Math.abs(x - -16) > 12) coords.push({ x, z: 6.5, rotY: -Math.PI * 0.5 }); // Arm extends +Z over EW road (14)
    }

    const mastGeo = new THREE.CylinderGeometry(0.075, 0.135, 7.6, 10);
    mastGeo.translate(0, 3.8, 0);

    const armGeo = new THREE.BoxGeometry(2.3, 0.09, 0.09);
    armGeo.rotateZ(0.14);
    armGeo.translate(1.08, 7.55, 0);

    const lampGeo = new THREE.BoxGeometry(0.62, 0.1, 0.28);
    lampGeo.translate(2.05, 7.64, 0);

    const poles = new THREE.InstancedMesh(mastGeo, poleMat, coords.length);
    const arms = new THREE.InstancedMesh(armGeo, poleMat, coords.length);
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, coords.length);
    poles.castShadow = true;
    arms.castShadow = true;

    const dummy = new THREE.Object3D();
    coords.forEach((c, i) => {
      dummy.position.set(c.x, 0, c.z);
      dummy.rotation.set(0, c.rotY, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);
      arms.setMatrixAt(i, dummy.matrix);
      lamps.setMatrixAt(i, dummy.matrix);
    });
    poles.computeBoundingSphere();
    arms.computeBoundingSphere();
    lamps.computeBoundingSphere();
    poles.matrixAutoUpdate = false;
    arms.matrixAutoUpdate = false;
    lamps.matrixAutoUpdate = false;
    this.scene.add(poles);
    this.scene.add(arms);
    this.scene.add(lamps);

    // Detailed Industrial Fuel Silos at Sector Echo (+22, +102) & Sector Bravo (+105, +20):
    // Smooth 28-segment cylinder + domed roof cap + hazard stripe + access ladder cage + pipe manifold!
    const siloMat = new THREE.MeshStandardMaterial({ color: 0xcbc7bd, roughness: 0.48, metalness: 0.38 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xd96b27, roughness: 0.56, metalness: 0.15 });
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x454a50, roughness: 0.55, metalness: 0.62 });

    const siloPositions: Array<[number, number, number]> = [
      [35, 108, 4.2],
      [35, 96, 4.2],
      [121, 32, 3.8],
    ];
    for (const [sx, sz, rad] of siloPositions) {
      const h = 7.5;
      const siloGrp = new THREE.Group();
      siloGrp.position.set(sx, 0, sz);

      const silo = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, h, 28), siloMat);
      silo.position.y = h * 0.5;
      silo.castShadow = true;
      silo.receiveShadow = true;
      siloGrp.add(silo);

      // Conical domed tank roof
      const dome = new THREE.Mesh(new THREE.ConeGeometry(rad + 0.08, 0.95, 28), siloMat);
      dome.position.y = h + 0.47;
      dome.castShadow = true;
      siloGrp.add(dome);

      // Hazard band + structural weld rings
      const band = new THREE.Mesh(new THREE.CylinderGeometry(rad + 0.04, rad + 0.04, 0.82, 28), bandMat);
      band.position.y = h * 0.64;
      siloGrp.add(band);

      for (const ry of [2.2, 4.4, 7.35]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(rad + 0.03, 0.045, 8, 28), pipeMat);
        ring.rotation.x = Math.PI * 0.5;
        ring.position.y = ry;
        siloGrp.add(ring);
      }

      // Rooftop perimeter safety handrail posts + top rail
      const railRing = new THREE.Mesh(new THREE.TorusGeometry(rad - 0.18, 0.035, 6, 24), pipeMat);
      railRing.rotation.x = Math.PI * 0.5;
      railRing.position.y = h + 0.95;
      siloGrp.add(railRing);

      // Exterior vertical maintenance ladder + safety cage on -X side
      const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.12, h + 0.8, 0.52), pipeMat);
      ladder.position.set(-(rad + 0.22), (h + 0.8) * 0.5, 0);
      ladder.castShadow = true;
      siloGrp.add(ladder);

      // Ground valve manifold pipe
      const valvePipe = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.8, 12), pipeMat);
      valvePipe.rotation.z = Math.PI * 0.5;
      valvePipe.position.set(-rad - 0.4, 0.75, 1.1);
      siloGrp.add(valvePipe);

      siloGrp.updateMatrixWorld(true);
      siloGrp.matrixAutoUpdate = false;
      this.scene.add(siloGrp);

      this.physics.addManualBox(
        new THREE.Box3(new THREE.Vector3(sx - rad, 0, sz - rad), new THREE.Vector3(sx + rad, h, sz + rad))
      );
    }

    // Overhead pipeline bridge connecting the twin Sector Echo refinery silos (35, 96) <-> (35, 108)
    const bridgePipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 12.0, 14), pipeMat);
    bridgePipe.rotation.x = Math.PI * 0.5;
    bridgePipe.position.set(35, 6.8, 102);
    bridgePipe.castShadow = true;
    this.scene.add(bridgePipe);
  }

  private buildHorizonSmokePlumes(): void {
    // 4 Distant Battlefield Oil-Well / Refinery Wreckage Smoke Plumes grounded to outer terrain!
    const plumeCoords: Array<[number, number]> = [
      [255, -195],
      [-265, -145],
      [280, 170],
      [-240, 215],
    ];
    const puffGeo = new THREE.SphereGeometry(1, 10, 10);
    const derrickMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.75, metalness: 0.5 });

    for (const [ox, oz] of plumeCoords) {
      const oy = this.sampleTerrainHeight(ox, oz);
      const origin = new THREE.Vector3(ox, oy, oz);

      // Charred Oil-Well Derrick / Flare Stack silhouette at fire base
      const derrick = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.4, 15, 4), derrickMat);
      derrick.position.set(ox, oy + 7.2, oz);
      this.scene.add(derrick);

      const glow = new THREE.Mesh(
        puffGeo,
        new THREE.MeshBasicMaterial({ color: 0xff6a18, transparent: true, opacity: 0.78 })
      );
      glow.position.copy(origin).add(new THREE.Vector3(0, 3.2, 0));
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
          speed: 0.042 + Math.random() * 0.014,
        });
      }
    }
  }

  private buildAmbientDustMotes(): void {
    const count = 340;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 180;
      arr[i * 3 + 1] = 0.4 + Math.random() * 14;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 180;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xf2dfc0,
      size: 0.22,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.dustPoints = new THREE.Points(geo, mat);
    this.scene.add(this.dustPoints);
  }

  public update(dt: number, focusPos: THREE.Vector3): void {
    // Advance GPU palm breeze uniform
    this.windUniform.value += dt;

    // Animate rising warzone smoke plumes
    for (let i = 0; i < this.plumePuffs.length; i++) {
      const p = this.plumePuffs[i];
      p.phase = (p.phase + p.speed * dt) % 1.0;
      const h = p.phase * 105;
      const drift = p.phase * 30;
      p.mesh.position.set(p.basePos.x + drift, p.basePos.y + h + 4, p.basePos.z - drift * 0.4);
      p.mesh.scale.setScalar(5 + p.phase * 23);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.sin(p.phase * Math.PI) * 0.36;
    }

    // Pulse distant ridge aviation warning beacons
    const t = this.windUniform.value;
    for (let i = 0; i < this.beacons.length; i++) {
      const b = this.beacons[i];
      const pulse = Math.sin(t * 2.6 + b.phase) > 0.25 ? 1.0 : 0.18;
      b.mesh.scale.setScalar(0.75 + pulse * 0.55);
      b.mat.color.setRGB(pulse, 0.12 * pulse, 0.06 * pulse);
    }

    // Subtle high-altitude cloud drift
    if (this.cloudGroup) {
      this.cloudGroup.rotation.y += dt * 0.0022;
    }

    // Drift sunlit desert dust motes gently around active player zone
    if (this.dustPoints) {
      this.dustPoints.position.x = Math.round(focusPos.x / 90) * 90;
      this.dustPoints.position.z = Math.round(focusPos.z / 90) * 90;
      this.dustPoints.rotation.y += dt * 0.025;
    }
  }
}
