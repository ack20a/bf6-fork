/**
 * Battlefield: Operation Oasis Strike — Playable Combined-Arms Conquest Large Prototype.
 * Features Physical Sky + PMREM HDR IBL Lighting, 1600m Desert-Mountain Vista,
 * 440m x 440m 5-Sector Conquest Map (12+ Destructible Buildings, Stacked Container Port,
 * Instanced Date Palms, Scrub Bushes & Sandstone Boulders), 10 Land/Air Vehicles & 30 Skinned AI Soldiers.
 */

import * as THREE from "three";
import { SoundFX } from "./audio/SoundFX";
import { AssetLibrary } from "./core/AssetLoader";
import { AIManager } from "./entities/AISoldiers";
import { VehicleManager } from "./entities/Vehicles";
import { PlayerController } from "./player/PlayerController";
import { BattlefieldHUD } from "./ui/HUD";
import { AtmosphereAndScenery } from "./world/AtmosphereAndScenery";
import { ConquestMap } from "./world/ConquestMap";
import { WorldPhysics } from "./world/WorldPhysics";

async function bootstrap(): Promise<void> {
  const container = document.getElementById("app")!;
  const deployScreen = document.getElementById("deploy-screen")!;
  const loadingBar = document.getElementById("loading-bar")!;
  const loadingText = document.getElementById("loading-text")!;
  const btnHq = document.getElementById("btn-deploy-hq") as HTMLButtonElement;
  const btnOutpost = document.getElementById("btn-deploy-outpost") as HTMLButtonElement;
  const btnOasis = document.getElementById("btn-deploy-oasis") as HTMLButtonElement;

  // 1. Renderer, Physical Sky, HDR PMREM Environment IBL & Golden-Hour Directional Sun
  const isCoarseMobile = window.matchMedia?.("(pointer: coarse)").matches || window.innerWidth <= 860;
  const renderer = new THREE.WebGLRenderer({ antialias: !isCoarseMobile, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isCoarseMobile ? 1.25 : 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = isCoarseMobile ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  container.appendChild(renderer.domElement);

  const maxAnisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), isCoarseMobile ? 4 : 8);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };
  document.getElementById("btn-fullscreen-deploy")?.addEventListener("click", toggleFullscreen);
  document.getElementById("btn-fullscreen-hud")?.addEventListener("click", toggleFullscreen);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 2500);
  scene.add(camera);

  // Rich Sky-to-Warm-Sand Bounce Hemisphere Light + Crisp Golden-Hour Sun
  const hemiLight = new THREE.HemisphereLight(0xdff0ff, 0xc4a478, 1.15);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff1da, 3.15);
  sunLight.castShadow = true;
  const shadowRes = isCoarseMobile ? 1024 : 2048;
  sunLight.shadow.mapSize.set(shadowRes, shadowRes);
  sunLight.shadow.camera.near = 8;
  sunLight.shadow.camera.far = 235;
  const shadowExtent = 56;
  sunLight.shadow.camera.left = -shadowExtent;
  sunLight.shadow.camera.right = shadowExtent;
  sunLight.shadow.camera.top = shadowExtent;
  sunLight.shadow.camera.bottom = -shadowExtent;
  sunLight.shadow.bias = -0.00035;
  sunLight.shadow.normalBias = 0.022;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // Aerial overview camera pose while on the Tactical Deployment Screen
  let overviewAngle = 0.65;
  camera.position.set(48, 26, 48);
  camera.lookAt(2, 4, 0);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // 2. Load All 29 Exported Blender .glb Assets
  const sfx = new SoundFX();
  const assets = new AssetLibrary();

  try {
    await assets.loadAll((loaded, total, key) => {
      const pct = Math.round((loaded / total) * 100);
      loadingBar.style.width = `${pct}%`;
      loadingText.textContent = `正在加载高精度战术资产 (${loaded}/${total} · ${pct}%) — ${key}.glb`;
    }, maxAnisotropy);
  } catch (err) {
    loadingText.textContent = `资产加载异常: ${String(err)}`;
    console.error(err);
    return;
  }

  // 3. Construct Physical Sky/IBL, 5-Sector Conquest Map, Oasis Vegetation, Vehicles, AI & Player
  const physics = new WorldPhysics(scene, assets, sfx);
  const scenery = new AtmosphereAndScenery(scene, renderer, physics);
  scenery.setupSkyAndIBL(sunLight);

  const map = new ConquestMap(scene, assets, physics, sfx);
  map.buildWorld();
  scenery.buildRichBattlefieldScenery(map.sceneryExcludeZones);

  const vehicles = new VehicleManager(scene, assets, physics, sfx);
  vehicles.spawnInitialVehicles();

  const ai = new AIManager(scene, assets, physics, map, sfx);
  ai.spawnSquads();

  const player = new PlayerController(camera, renderer.domElement, assets, physics, vehicles, map, sfx);
  const hud = new BattlefieldHUD();

  physics.onPlayerHitConfirm = (isKill, victimName, weaponName, isHeadshot) => {
    hud.showHitmarker(isKill);
    if (isKill) {
      hud.pushKillfeed("YOU", weaponName, victimName, isHeadshot);
      hud.pushScoreEvent(isHeadshot ? `精准爆头击杀 ${victimName}` : `击杀敌军 ${victimName}`, isHeadshot ? 125 : 100);
    }
  };

  physics.onPlayerScoreEvent = (label, points) => {
    hud.pushScoreEvent(label, points);
  };

  player.onPlayerDeath = () => {
    hud.setVisible(false);
    deployScreen.classList.remove("hidden");
    loadingText.textContent = "阵亡重整 (K.I.A.) — 请选择重生部署点重返战场！";
  };

  // Enable All 3 Deployment Buttons!
  loadingBar.style.width = "100%";
  loadingText.textContent = "5大防区 · 棕榈绿洲大规模战场与 29 项 PBR 资产已就绪 — 选择部署点！";
  btnHq.disabled = false;
  btnOutpost.disabled = false;
  btnOasis.disabled = false;

  btnHq.addEventListener("click", () => {
    deployScreen.classList.add("hidden");
    hud.setVisible(true);
    // Spawn right between the NATO Hangar M1A2 Tank, LATV4 & [H] Helipad Little Bird!
    player.spawnAt(new THREE.Vector3(6.5, 0.15, 165.0), 0.08);
    hud.pushScoreEvent("部署至联军空地主基地（左侧机库 M1A2 坦克 · 右侧停机坪小鸟直升机）", 50);
  });

  btnOutpost.addEventListener("click", () => {
    deployScreen.classList.add("hidden");
    hud.setVisible(true);
    player.spawnAt(new THREE.Vector3(-5.0, 0.15, 25.5), -0.08);
    hud.pushScoreEvent("空降：Alpha 中央双子楼街区（小心二楼窗口敌军与街口装甲车！）", 50);
  });

  btnOasis.addEventListener("click", () => {
    deployScreen.classList.add("hidden");
    hud.setVisible(true);
    player.spawnAt(new THREE.Vector3(-88.0, 0.15, -4.0), 0.55);
    hud.pushScoreEvent("侧翼部署：Charlie 绿洲荒漠小镇（身旁已备好 LATV4 机动突击车）", 50);
  });

  // 4. Main Simulation Loop (Zero-Allocation Unit Roster & Stabilized Shadow Cascade)
  let prevTime = performance.now();
  let frameTick = 0;
  const sunDir: THREE.Vector3 = (sunLight.userData.sunDir as THREE.Vector3) ?? new THREE.Vector3(0.45, 0.65, 0.55);
  const unitsBuf: Array<{ pos: THREE.Vector3; team: "NATO" | "PAX" | "NEUTRAL"; isPlayer?: boolean }> = [];
  const playerUnitEntry = { pos: new THREE.Vector3(), team: "NATO" as const, isPlayer: true };

  function animate(now: number): void {
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, Math.max(0.001, (now - prevTime) * 0.001));
    prevTime = now;
    frameTick++;

    const focusPos = player.deployed ? player.getPosition() : camera.position;
    const vehInput = player.buildVehicleInput();
    vehicles.update(dt, player.activeVehicle, vehInput, focusPos);
    ai.update(dt, focusPos);
    physics.update(dt);
    scenery.update(dt, focusPos);

    unitsBuf.length = 0;
    for (let i = 0; i < ai.soldiers.length; i++) {
      const s = ai.soldiers[i];
      if (s.isAlive()) {
        unitsBuf.push({ pos: s.position, team: s.team });
      }
    }

    if (player.deployed) {
      player.update(dt);

      const pPos = player.getPosition();
      // Snap sun shadow frustum in 4m increments to eliminate shadow-edge shimmer & redundant shadow updates
      const snapX = Math.round(pPos.x / 4) * 4;
      const snapZ = Math.round(pPos.z / 4) * 4;
      sunLight.position.set(snapX + sunDir.x * 95, sunDir.y * 95, snapZ + sunDir.z * 95);
      sunLight.target.position.set(snapX, 0, snapZ);

      playerUnitEntry.pos.copy(pPos);
      unitsBuf.push(playerUnitEntry);

      const activeFlag = map.update(dt, unitsBuf, (fl) => {
        hud.pushScoreEvent(`成功占领征服据点 [${fl.name}]`, 300);
      });
      hud.update(dt, player, map, ai, vehicles, activeFlag);
    } else {
      overviewAngle += dt * 0.11;
      camera.position.set(Math.cos(overviewAngle) * 56, 26, Math.sin(overviewAngle) * 56);
      camera.lookAt(2, 3.5, 0);
      sunLight.position.set(sunDir.x * 95, sunDir.y * 95, sunDir.z * 95);
      sunLight.target.position.set(0, 0, 0);

      map.update(dt, unitsBuf);
    }

    if (frameTick % 2 === 0) {
      renderer.shadowMap.needsUpdate = true;
    }
    renderer.render(scene, camera);
  }

  requestAnimationFrame(animate);
}

bootstrap();
