/**
 * Battlefield: Outpost Alpha — Playable Combined-Arms Conquest Prototype Entry Point.
 * Loads all 29 custom Blender .glb PBR assets, initializes WorldPhysics, ConquestMap,
 * Vehicles, AI Squads, PlayerController, and HUD.
 */

import * as THREE from "three";
import { SoundFX } from "./audio/SoundFX";
import { AssetLibrary } from "./core/AssetLoader";
import { AIManager } from "./entities/AISoldiers";
import { VehicleManager } from "./entities/Vehicles";
import { PlayerController } from "./player/PlayerController";
import { BattlefieldHUD } from "./ui/HUD";
import { ConquestMap } from "./world/ConquestMap";
import { WorldPhysics } from "./world/WorldPhysics";

async function bootstrap(): Promise<void> {
  const container = document.getElementById("app")!;
  const deployScreen = document.getElementById("deploy-screen")!;
  const loadingBar = document.getElementById("loading-bar")!;
  const loadingText = document.getElementById("loading-text")!;
  const btnHq = document.getElementById("btn-deploy-hq") as HTMLButtonElement;
  const btnOutpost = document.getElementById("btn-deploy-outpost") as HTMLButtonElement;

  // 1. Renderer, Atmospheric Desert-Urban Sky & Directional Sun Shadow Rig
  const isCoarseMobile = window.matchMedia?.("(pointer: coarse)").matches || window.innerWidth <= 860;
  const renderer = new THREE.WebGLRenderer({ antialias: !isCoarseMobile, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isCoarseMobile ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  container.appendChild(renderer.domElement);

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
  scene.background = new THREE.Color(0x9dc0d8);
  scene.fog = new THREE.FogExp2(0xb8c8d0, 0.0045);

  const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.045, 320);
  scene.add(camera);

  // Cinematic Hemisphere + Tactical Golden-Hour Directional Light
  const hemiLight = new THREE.HemisphereLight(0xd8eeff, 0x7c6a52, 0.95);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff1d8, 2.35);
  sunLight.position.set(45, 68, 38);
  sunLight.castShadow = true;
  const shadowRes = isCoarseMobile ? 1024 : 2048;
  sunLight.shadow.mapSize.set(shadowRes, shadowRes);
  sunLight.shadow.camera.near = 5;
  sunLight.shadow.camera.far = 185;
  const shadowExtent = 58;
  sunLight.shadow.camera.left = -shadowExtent;
  sunLight.shadow.camera.right = shadowExtent;
  sunLight.shadow.camera.top = shadowExtent;
  sunLight.shadow.camera.bottom = -shadowExtent;
  sunLight.shadow.bias = -0.0005;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // Aerial overview camera pose while on the Tactical Deployment Screen
  let overviewAngle = 0.55;
  camera.position.set(28, 22, 32);
  camera.lookAt(0, 3, 0);

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
      loadingText.textContent = `正在加载战术资产 (${loaded}/${total} · ${pct}%) — ${key}.glb`;
    });
  } catch (err) {
    loadingText.textContent = `资产加载异常: ${String(err)}`;
    console.error(err);
    return;
  }

  // 3. Construct Destructible Battlefield, Vehicles, AI Squads, Player & HUD
  const physics = new WorldPhysics(scene, assets, sfx);
  const map = new ConquestMap(scene, assets, physics, sfx);
  map.buildWorld();

  const vehicles = new VehicleManager(scene, assets, physics, sfx);
  vehicles.spawnInitialVehicles();

  const ai = new AIManager(scene, assets, physics, map, sfx);
  ai.spawnSquads();

  const player = new PlayerController(camera, renderer.domElement, assets, physics, vehicles, map, sfx);
  const hud = new BattlefieldHUD();

  // Connect hitmarkers, killfeed & score popups
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

  // Enable Deployment Buttons!
  loadingBar.style.width = "100%";
  loadingText.textContent = "全部 29 个 Blender 战术 PBR 资产已就绪 — 选择部署点进入战斗！";
  btnHq.disabled = false;
  btnOutpost.disabled = false;

  btnHq.addEventListener("click", () => {
    deployScreen.classList.add("hidden");
    hud.setVisible(true);
    // Spawn right in front of NATO M1A2 AbramsX Tank & AH-6J Little Bird Helicopter!
    player.spawnAt(new THREE.Vector3(-4.5, 0.15, 49.5), 0.12);
    hud.pushScoreEvent("部署至联军重装车库 (按 [E] 可直接驾驶坦克或小鸟直升机)", 50);
  });

  btnOutpost.addEventListener("click", () => {
    deployScreen.classList.add("hidden");
    hud.setVisible(true);
    // Spawn right at Sector Alpha Southern Approach near LATV4 & RPG breach line!
    player.spawnAt(new THREE.Vector3(-3.0, 0.15, 19.5), -0.08);
    hud.pushScoreEvent("前线空降：Alpha 指挥前哨站 (按 [2] 切换 RPG 轰开二层小楼墙体！)", 50);
  });

  // 4. Main Simulation Loop
  let prevTime = performance.now();

  function animate(now: number): void {
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, Math.max(0.001, (now - prevTime) * 0.001));
    prevTime = now;

    // Update Vehicles, AI Soldiers, Ballistics/Destruction & Conquest Capture
    const vehInput = player.buildVehicleInput();
    vehicles.update(dt, player.activeVehicle, vehInput, player.getPosition());
    ai.update(dt, player.getPosition());
    physics.update(dt);

    if (player.deployed) {
      player.update(dt);

      // Follow player with directional shadow frustum for crisp close-up shadows everywhere
      const pPos = player.getPosition();
      sunLight.position.set(pPos.x + 42, 68, pPos.z + 36);
      sunLight.target.position.set(pPos.x, 0, pPos.z);

      // Gather live Conquest capture units
      const units: Array<{ pos: THREE.Vector3; team: "NATO" | "PAX" | "NEUTRAL"; isPlayer?: boolean }> = [
        { pos: pPos, team: "NATO", isPlayer: true },
      ];
      for (const s of ai.soldiers) {
        if (s.isAlive()) {
          units.push({ pos: s.position, team: s.team });
        }
      }
      const activeFlag = map.update(dt, units, (fl) => {
        hud.pushScoreEvent(`成功占领征服据点 [${fl.name}]`, 300);
      });
      hud.update(dt, player, map, ai, vehicles, activeFlag);
    } else {
      // Orbiting aerial recon camera over live AI firefight at Outpost Alpha!
      overviewAngle += dt * 0.14;
      camera.position.set(Math.cos(overviewAngle) * 34, 21, Math.sin(overviewAngle) * 34);
      camera.lookAt(0, 3.2, 0);

      const units = ai.soldiers.filter((s) => s.isAlive()).map((s) => ({ pos: s.position, team: s.team }));
      map.update(dt, units);
    }

    renderer.render(scene, camera);
  }

  requestAnimationFrame(animate);
}

bootstrap();
