/**
 * Battlefield 6 Cyan/Amber Tactical HUD, Killfeed, Hitmarkers, Score Popups & 2D Radar Minimap.
 */

import type { AIManager } from "../entities/AISoldiers";
import type { VehicleManager } from "../entities/Vehicles";
import type { PlayerController } from "../player/PlayerController";
import type { ConquestFlag, ConquestMap } from "../world/ConquestMap";

export class BattlefieldHUD {
  private hudEl = document.getElementById("hud")!;
  private dmgVignette = document.getElementById("damage-vignette")!;
  private scopeEl = document.getElementById("sniper-scope")!;
  private crosshairEl = document.getElementById("crosshair")!;
  private hitmarkerEl = document.getElementById("hitmarker")!;

  private ticketsNatoEl = document.getElementById("tickets-nato")!;
  private ticketsPaxEl = document.getElementById("tickets-pax")!;
  private flagEls = {
    A: document.getElementById("flag-ui-A")!,
    B: document.getElementById("flag-ui-B")!,
    C: document.getElementById("flag-ui-C")!,
  };

  private captureBannerEl = document.getElementById("capture-banner")!;
  private captureTitleEl = document.getElementById("capture-title")!;
  private captureFillEl = document.getElementById("capture-bar-fill")!;

  private perfBadgeEl = document.getElementById("perf-badge")!;
  private killfeedEl = document.getElementById("killfeed")!;
  private scoreFeedEl = document.getElementById("score-feed")!;
  private interactEl = document.getElementById("interact-prompt")!;

  private compassEl = document.getElementById("compass-heading")!;
  private sectorEl = document.getElementById("sector-label")!;
  private minimapCanvas = document.getElementById("minimap-canvas") as HTMLCanvasElement;
  private mmCtx = this.minimapCanvas.getContext("2d")!;

  private vehHudEl = document.getElementById("vehicle-hud")!;
  private vehNameEl = document.getElementById("veh-hud-name")!;
  private vehSpeedEl = document.getElementById("veh-hud-speed")!;
  private vehHpEl = document.getElementById("veh-hud-hp")!;

  private ammoMagEl = document.getElementById("ammo-mag")!;
  private ammoResEl = document.getElementById("ammo-res")!;
  private weaponNameEl = document.getElementById("weapon-name")!;
  private hpFillEl = document.getElementById("hp-bar-fill")!;
  private hpNumEl = document.getElementById("hp-num")!;
  private slotEls = {
    1: document.getElementById("slot-1")!,
    2: document.getElementById("slot-2")!,
    3: document.getElementById("slot-3")!,
    4: document.getElementById("slot-4")!,
  };

  private hitmarkerTimer = 0;
  private fpsFrames = 0;
  private fpsAccum = 0;

  public setVisible(visible: boolean): void {
    this.hudEl.classList.toggle("hidden", !visible);
  }

  public showHitmarker(isKill: boolean): void {
    this.hitmarkerTimer = isKill ? 0.34 : 0.14;
    this.hitmarkerEl.classList.remove("hidden");
    this.hitmarkerEl.classList.toggle("kill", isKill);
  }

  public pushKillfeed(killer: string, weapon: string, victim: string, isHeadshot = false): void {
    const item = document.createElement("div");
    item.className = "kf-item";
    item.textContent = `${killer} [${weapon}${isHeadshot ? " · 爆头" : ""}] ${victim}`;
    this.killfeedEl.prepend(item);
    while (this.killfeedEl.children.length > 5) {
      this.killfeedEl.lastElementChild?.remove();
    }
    setTimeout(() => item.remove(), 5500);
  }

  public pushScoreEvent(label: string, points: number): void {
    const el = document.createElement("div");
    el.className = "score-item";
    el.innerHTML = `${label} <span>+${points} XP</span>`;
    this.scoreFeedEl.prepend(el);
    while (this.scoreFeedEl.children.length > 4) {
      this.scoreFeedEl.lastElementChild?.remove();
    }
    setTimeout(() => el.remove(), 3400);
  }

  public update(
    dt: number,
    player: PlayerController,
    map: ConquestMap,
    ai: AIManager,
    vehicles: VehicleManager,
    activeFlag: ConquestFlag | null
  ): void {
    if (!player.deployed) return;

    // FPS counter
    this.fpsFrames++;
    this.fpsAccum += dt;
    if (this.fpsAccum >= 0.5) {
      const fps = Math.round(this.fpsFrames / this.fpsAccum);
      this.perfBadgeEl.textContent = `Three.js PBR · ${fps} FPS`;
      this.fpsFrames = 0;
      this.fpsAccum = 0;
    }

    // Hitmarker decay
    if (this.hitmarkerTimer > 0) {
      this.hitmarkerTimer -= dt;
      if (this.hitmarkerTimer <= 0) {
        this.hitmarkerEl.classList.add("hidden");
      }
    }

    // Damage vignette & 8x Sniper Scope
    this.dmgVignette.style.opacity = String(
      Math.max(player.damageFlash, player.hp < 35 ? (35 - player.hp) / 55 : 0).toFixed(2)
    );
    this.scopeEl.classList.toggle("hidden", !player.isScoped8x);
    this.crosshairEl.style.opacity = player.isScoped8x ? "0" : "1";

    // Conquest Tickets & Flags
    this.ticketsNatoEl.textContent = String(map.ticketsNATO);
    this.ticketsPaxEl.textContent = String(map.ticketsPAX);

    for (const fl of map.flags) {
      const el = this.flagEls[fl.id];
      el.className = `flag-diamond ${fl.owner === "NATO" ? "nato" : fl.owner === "PAX" ? "pax" : "neutral"}`;
    }

    if (activeFlag) {
      this.captureBannerEl.classList.remove("hidden");
      const pct = Math.round(((activeFlag.progress + 1) * 0.5) * 100);
      this.captureTitleEl.textContent =
        activeFlag.owner === "NATO" ? `已控制防区 ${activeFlag.name}` : `正在争夺目标 ${activeFlag.name}`;
      this.captureFillEl.style.width = `${pct}%`;
      this.captureFillEl.style.background = activeFlag.progress >= 0 ? "#00f0ff" : "#ff5522";
    } else {
      this.captureBannerEl.classList.add("hidden");
    }

    // Interaction Prompt ([E] Enter Vehicle / Pointer Lock Hint)
    if (!player.isPointerLocked) {
      this.interactEl.textContent = "点击画面锁定准星继续作战 (ESC 释放鼠标)";
      this.interactEl.classList.remove("hidden");
    } else if (!player.activeVehicle && player.nearbyVehicle) {
      this.interactEl.textContent = `[E] 驾驶 ${player.nearbyVehicle.displayName}`;
      this.interactEl.classList.remove("hidden");
    } else {
      this.interactEl.classList.add("hidden");
    }

    // Vehicle Telemetry & Weapon Ammo / HP
    if (player.activeVehicle) {
      const v = player.activeVehicle;
      this.vehHudEl.classList.remove("hidden");
      this.vehNameEl.textContent = v.displayName;
      this.vehSpeedEl.textContent = `SPD ${String(v.speedKmh).padStart(2, "0")} KM/H`;
      const armorPct = Math.round((v.hp / v.maxHp) * 100);
      this.vehHpEl.textContent = `ARMOR ${armorPct}%`;
    } else {
      this.vehHudEl.classList.add("hidden");
    }

    const w = player.getActiveWeapon();
    this.ammoMagEl.textContent = player.isReloading ? "RLD" : String(w.mag);
    this.ammoResEl.textContent = player.activeSlot === 4 ? `${map["physics"]?.plantedC4s?.length ?? 0} 已部署` : String(w.reserve);
    this.weaponNameEl.textContent = w.displayName;

    const hpInt = Math.ceil(player.hp);
    this.hpNumEl.textContent = String(hpInt);
    this.hpFillEl.style.width = `${Math.max(0, Math.min(100, hpInt))}%`;

    for (const s of [1, 2, 3, 4] as const) {
      this.slotEls[s].classList.toggle("active", player.activeSlot === s);
    }

    // Compass Heading & Tactical Radar Minimap
    const lookYaw = player.activeVehicle ? player.activeVehicle.aimYaw : player.yaw;
    const deg = (((-lookYaw * 180) / Math.PI) % 360 + 360) % 360;
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const dirLbl = dirs[Math.round(deg / 45) % 8];
    this.compassEl.textContent = `HDG ${String(Math.round(deg)).padStart(3, "0")}° ${dirLbl}`;

    const pPos = player.getPosition();
    this.sectorEl.textContent = pPos.x > 20 ? "SECTOR BRAVO" : pPos.x < -20 ? "SECTOR CHARLIE" : "SECTOR ALPHA";

    this.drawMinimap(pPos.x, pPos.z, lookYaw, map, ai, vehicles);
  }

  private drawMinimap(
    px: number,
    pz: number,
    yaw: number,
    map: ConquestMap,
    ai: AIManager,
    vehicles: VehicleManager
  ): void {
    const ctx = this.mmCtx;
    const W = this.minimapCanvas.width;
    const H = this.minimapCanvas.height;
    const cx = W * 0.5;
    const cz = H * 0.5;
    const scale = 1.45; // pixels per meter (~130m radar window)

    ctx.clearRect(0, 0, W, H);

    // Subtle tactical grid
    ctx.strokeStyle = "rgba(0, 240, 255, 0.08)";
    ctx.lineWidth = 1;
    for (let g = 24; g < W; g += 32) {
      ctx.beginPath();
      ctx.moveTo(g, 0);
      ctx.lineTo(g, H);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, g);
      ctx.lineTo(W, g);
      ctx.stroke();
    }

    const toScreen = (wx: number, wz: number): [number, number] => [
      cx + (wx - px) * scale,
      cz + (wz - pz) * scale,
    ];

    // Building footprints
    ctx.fillStyle = "rgba(160, 185, 200, 0.28)";
    for (const b of map.buildingFootprints) {
      const [sx, sz] = toScreen(b.x - b.w * 0.5, b.z - b.d * 0.5);
      ctx.fillRect(sx, sz, b.w * scale, b.d * scale);
    }

    // Conquest Flags [A], [B], [C]
    ctx.font = "bold 10px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of map.flags) {
      const [sx, sz] = toScreen(f.position.x, f.position.z);
      ctx.fillStyle = f.owner === "NATO" ? "#00f0ff" : f.owner === "PAX" ? "#ff5522" : "#aabbc6";
      ctx.beginPath();
      ctx.arc(sx, sz, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#041016";
      ctx.fillText(f.id, sx, sz + 0.5);
    }

    // Vehicles
    for (const v of vehicles.vehicles) {
      if (!v.isAlive() || v.driverId === "PLAYER") continue;
      const [sx, sz] = toScreen(v.getPosition().x, v.getPosition().z);
      ctx.fillStyle = v.team === "NATO" ? "#44f6ff" : "#ff7733";
      ctx.fillRect(sx - 4, sz - 4, 8, 8);
    }

    // AI Soldiers
    for (const s of ai.soldiers) {
      if (!s.isAlive()) continue;
      const [sx, sz] = toScreen(s.position.x, s.position.z);
      if (sx < 2 || sx > W - 2 || sz < 2 || sz > H - 2) continue;
      ctx.fillStyle = s.team === "NATO" ? "#00e8ff" : "#ff4422";
      ctx.beginPath();
      ctx.arc(sx, sz, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player center FOV cone & marker
    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const ang = Math.atan2(fwdZ, fwdX);

    ctx.fillStyle = "rgba(0, 240, 255, 0.16)";
    ctx.beginPath();
    ctx.moveTo(cx, cz);
    ctx.arc(cx, cz, 34, ang - 0.5, ang + 0.5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(cx, cz, 3.6, 0, Math.PI * 2);
    ctx.fill();
  }
}
