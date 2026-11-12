"""
Procedural PBR Materials for BF6 Weapons, Optics, Explosives, and Land/Air Combat Vehicles.
All textures are synthesized via NumPy, packed into bpy.data.images, and wired to
standard Principled BSDF inputs for 100% lossless glTF (.glb) export to Three.js/WebGPU.
"""

import numpy as np
import bpy
from pbr_textures import fbm_tileable, height_to_normal, build_gltf_material


def create_combat_materials() -> dict[str, bpy.types.Material]:
    res = 512
    mats: dict[str, bpy.types.Material] = {}

    y_c = np.linspace(0, 1, res, endpoint=False, dtype=np.float32)[:, None]
    x_c = np.linspace(0, 1, res, endpoint=False, dtype=np.float32)[None, :]

    # 1. Hard-Coat Anodized Gunmetal (CNC brushed grain + micro-peening + edge highlights)
    gm_n = fbm_tileable(res, 20, 5, seed=2101)
    micro = fbm_tileable(res, 64, 2, seed=2111)
    brush = 0.5 + 0.5 * np.sin(x_c * 2 * np.pi * 96 + gm_n * 1.8)
    gm_h = gm_n * 0.55 + brush * 0.25 + micro * 0.20
    gm_col = np.stack([
        0.105 + 0.048 * gm_n + 0.018 * brush,
        0.115 + 0.048 * gm_n + 0.018 * brush,
        0.128 + 0.052 * gm_n + 0.020 * brush,
    ], axis=-1)
    mats["gunmetal"] = build_gltf_material(
        "MAT_WPN_Gunmetal",
        np.clip(gm_col, 0, 1),
        roughness_map=0.28 + 0.18 * (1.0 - gm_h),
        normal_rgb=height_to_normal(gm_h, 1.35),
        metallic=0.86,
    )

    # 2. Phosphated Barrel / Heavy Ordnance Steel
    ph_n = fbm_tileable(res, 24, 4, seed=2102)
    lathe = 0.5 + 0.5 * np.sin(y_c * 2 * np.pi * 110 + ph_n * 1.2)
    ph_h = ph_n * 0.65 + lathe * 0.35
    ph_col = np.stack([
        0.17 + 0.055 * ph_h,
        0.18 + 0.055 * ph_h,
        0.195 + 0.058 * ph_h,
    ], axis=-1)
    mats["barrel_steel"] = build_gltf_material(
        "MAT_WPN_BarrelSteel",
        np.clip(ph_col, 0, 1),
        roughness_map=0.24 + 0.16 * ph_n,
        normal_rgb=height_to_normal(ph_h, 1.2),
        metallic=0.92,
    )

    # 3. Tactical Flat Dark Earth (FDE / Coyote Tan) Laser-Stippled Polymer
    fde_n = fbm_tileable(res, 48, 4, seed=2103)
    fde_macro = fbm_tileable(res, 8, 4, seed=2104)
    stipple = 0.5 + 0.25 * np.sin(x_c * 2 * np.pi * 84) * np.cos(y_c * 2 * np.pi * 84)
    fde_h = fde_n * 0.62 + stipple * 0.38
    fde_col = np.stack([
        0.46 + 0.065 * fde_macro - 0.035 * fde_h,
        0.39 + 0.055 * fde_macro - 0.032 * fde_h,
        0.28 + 0.042 * fde_macro - 0.025 * fde_h,
    ], axis=-1)
    mats["polymer_fde"] = build_gltf_material(
        "MAT_WPN_Polymer_FDE",
        np.clip(fde_col, 0, 1),
        roughness_map=0.58 + 0.16 * fde_h,
        normal_rgb=height_to_normal(fde_h, 2.3),
        metallic=0.02,
    )

    # 4. Matte Black Tactical Polymer (Grips, Stocks, Handguards with crisp stipple relief)
    blk_n = fbm_tileable(res, 52, 4, seed=2105)
    blk_h = blk_n * 0.60 + stipple * 0.40
    blk_col = np.stack([
        0.075 + 0.035 * blk_h,
        0.080 + 0.035 * blk_h,
        0.086 + 0.038 * blk_h,
    ], axis=-1)
    mats["polymer_black"] = build_gltf_material(
        "MAT_WPN_Polymer_Black",
        np.clip(blk_col, 0, 1),
        roughness_map=0.54 + 0.18 * blk_h,
        normal_rgb=height_to_normal(blk_h, 2.5),
        metallic=0.05,
    )

    # 5. Ordnance Olive / RPG Warhead & C4 Block Compound
    ord_n = fbm_tileable(res, 16, 4, seed=2106)
    ord_col = np.stack([
        0.24 + 0.075 * ord_n,
        0.29 + 0.085 * ord_n,
        0.17 + 0.055 * ord_n,
    ], axis=-1)
    mats["ordnance_olive"] = build_gltf_material(
        "MAT_Ordnance_Olive",
        np.clip(ord_col, 0, 1),
        roughness_map=0.42 + 0.20 * (1.0 - ord_n),
        normal_rgb=height_to_normal(ord_n, 1.4),
        metallic=0.28,
    )

    # 6. 3-Tone Modern NATO Tactical Vehicle Armor Camo + Armor Plate Seams & Desert Dust
    c1 = fbm_tileable(res, 4, 5, seed=2201)
    c2 = fbm_tileable(res, 6, 4, seed=2202)
    grime = fbm_tileable(res, 24, 4, seed=2203)
    plate_seam_x = np.exp(-((np.mod(x_c * 3.0, 1.0) - 0.5) ** 2) / 0.0005) * 0.18
    plate_seam_y = np.exp(-((np.mod(y_c * 3.0, 1.0) - 0.5) ** 2) / 0.0005) * 0.18
    armor_h = np.clip(grime * 0.82 - plate_seam_x - plate_seam_y, 0.0, 1.0)
    col_olive = np.array([0.24, 0.28, 0.19], dtype=np.float32)
    col_tan = np.array([0.46, 0.40, 0.30], dtype=np.float32)
    col_char = np.array([0.13, 0.14, 0.14], dtype=np.float32)

    camo = np.broadcast_to(col_olive, (res, res, 3)).copy()
    mask_tan = (c1 > 0.56)[:, :, None].astype(np.float32)
    mask_char = (c2 > 0.65)[:, :, None].astype(np.float32)
    camo = camo * (1.0 - mask_tan) + col_tan * mask_tan
    camo = camo * (1.0 - mask_char) + col_char * mask_char
    camo *= (0.84 + 0.26 * armor_h[:, :, None])

    mats["armor_camo"] = build_gltf_material(
        "MAT_VEH_Armor_Camo",
        np.clip(camo, 0, 1),
        roughness_map=0.50 + 0.24 * (1.0 - armor_h),
        normal_rgb=height_to_normal(armor_h, 2.0),
        metallic=0.25,
    )

    # 7. Stealth Gunship Dark Slate Aviation Paint (Riveted Aircraft Skin Panels)
    hel_n = fbm_tileable(res, 12, 4, seed=2301)
    panel_x = np.exp(-((np.mod(x_c * 4.0, 1.0) - 0.5) ** 2) / 0.0005) * 0.16
    panel_y = np.exp(-((np.mod(y_c * 4.0, 1.0) - 0.5) ** 2) / 0.0005) * 0.16
    riv_x = (np.mod(x_c * 48.0, 1.0) - 0.5) ** 2
    riv_line = (np.abs(np.mod(y_c * 4.0, 1.0) - 0.46) < 0.015).astype(np.float32) * np.exp(-riv_x / 0.04) * 0.12
    hel_h = np.clip(hel_n * 0.72 - panel_x - panel_y + riv_line, 0.0, 1.0)
    hel_col = np.stack([
        0.14 + 0.055 * hel_h,
        0.16 + 0.055 * hel_h,
        0.185 + 0.065 * hel_h,
    ], axis=-1)
    mats["heli_slate"] = build_gltf_material(
        "MAT_VEH_Heli_Slate",
        np.clip(hel_col, 0, 1),
        roughness_map=0.38 + 0.20 * (1.0 - hel_h),
        normal_rgb=height_to_normal(hel_h, 2.1),
        metallic=0.42,
    )

    # 8. Molded Heavy Rubber Tire & Tank Track Treads
    trd_n = fbm_tileable(res, 24, 4, seed=2401)
    chevron_tread = (np.sin((y_c + np.abs(x_c - 0.5) * 0.45) * 2 * np.pi * 20.0) > 0.10).astype(np.float32) * 0.70
    trd_h = np.clip(chevron_tread + trd_n * 0.30, 0.0, 1.0)
    trd_col = np.stack([
        0.065 + 0.045 * trd_h,
        0.065 + 0.045 * trd_h,
        0.070 + 0.045 * trd_h,
    ], axis=-1)
    mats["rubber_tread"] = build_gltf_material(
        "MAT_VEH_Rubber_Tread",
        np.clip(trd_col, 0, 1),
        roughness_map=0.84,
        normal_rgb=height_to_normal(trd_h, 3.8),
        metallic=0.02,
    )

    # 9. Armored Tinted Canopy / Optic Lens Glass (Reflective Dark Teal-Blue)
    gls_col = np.broadcast_to(np.array([0.06, 0.16, 0.22], dtype=np.float32), (32, 32, 3)).copy()
    mats["optic_glass"] = build_gltf_material(
        "MAT_Optic_ArmoredGlass",
        gls_col,
        roughness_map=0.08,
        metallic=0.85,
        emission_color=(0.04, 0.14, 0.20),
        emission_strength=0.35,
    )

    # 10. Red Holographic Reticle / C4 Armed Blinker LED
    red_col = np.broadcast_to(np.array([1.0, 0.12, 0.08], dtype=np.float32), (32, 32, 3)).copy()
    mats["led_red"] = build_gltf_material(
        "MAT_Tactical_LED_Red",
        red_col,
        roughness_map=0.15,
        metallic=0.0,
        emission_color=(1.0, 0.12, 0.06),
        emission_strength=5.0,
    )

    # 11. NATO MultiCam Ripstop Tactical Uniform Fabric (Crisp 512px micro-ripstop weave)
    mc1 = fbm_tileable(res, 6, 5, seed=2501)
    mc2 = fbm_tileable(res, 12, 4, seed=2502)
    ripstop = 0.5 + 0.25 * np.sin(x_c * 2 * np.pi * 88) + 0.25 * np.sin(y_c * 2 * np.pi * 88)
    u_base = np.array([0.39, 0.36, 0.25], dtype=np.float32)
    u_grn = np.array([0.22, 0.28, 0.17], dtype=np.float32)
    u_brn = np.array([0.25, 0.19, 0.13], dtype=np.float32)
    u_tan = np.array([0.56, 0.51, 0.38], dtype=np.float32)
    mc_col = np.broadcast_to(u_base, (res, res, 3)).copy()
    mc_col = np.where((mc1 > 0.52)[:, :, None], u_grn, mc_col)
    mc_col = np.where((mc2 > 0.63)[:, :, None], u_brn, mc_col)
    mc_col = np.where(((mc1 < 0.29) & (mc2 < 0.46))[:, :, None], u_tan, mc_col)
    mc_col *= (0.90 + 0.15 * ripstop[:, :, None])
    mats["uniform_multicam"] = build_gltf_material(
        "MAT_CHR_Uniform_MultiCam",
        np.clip(mc_col, 0, 1),
        roughness_map=0.83,
        normal_rgb=height_to_normal(ripstop * 0.68 + mc1 * 0.32, 2.3),
        metallic=0.0,
    )

    # 12. OpFor ("Pax Armata") Charcoal-Slate Ripstop Tactical Uniform
    px1 = fbm_tileable(res, 6, 5, seed=2503)
    px2 = fbm_tileable(res, 14, 4, seed=2504)
    p_base = np.array([0.13, 0.14, 0.155], dtype=np.float32)
    p_olv = np.array([0.17, 0.21, 0.16], dtype=np.float32)
    p_dk = np.array([0.075, 0.08, 0.088], dtype=np.float32)
    px_col = np.broadcast_to(p_base, (res, res, 3)).copy()
    px_col = np.where((px1 > 0.55)[:, :, None], p_olv, px_col)
    px_col = np.where((px2 > 0.64)[:, :, None], p_dk, px_col)
    px_col *= (0.90 + 0.15 * ripstop[:, :, None])
    mats["uniform_pax"] = build_gltf_material(
        "MAT_CHR_Uniform_PaxSlate",
        np.clip(px_col, 0, 1),
        roughness_map=0.81,
        normal_rgb=height_to_normal(ripstop * 0.68 + px1 * 0.32, 2.3),
        metallic=0.0,
    )

    # 13. Coyote Tan 1000D Cordura Nylon Webbing (Plate Carriers, Pouches, Helmet Cover + MOLLE bartacks)
    cd_n = fbm_tileable(res, 32, 4, seed=2505)
    molle = (np.mod(y_c * 20.0, 1.0) > 0.14).astype(np.float32) * 0.16
    stitch = (np.mod(x_c * 28.0, 1.0) < 0.06).astype(np.float32) * molle * 0.6
    cd_h = np.clip(cd_n * 0.55 + ripstop * 0.25 + molle + stitch, 0.0, 1.0)
    cd_col = np.stack([
        0.48 + 0.085 * cd_h,
        0.40 + 0.072 * cd_h,
        0.27 + 0.052 * cd_h,
    ], axis=-1)
    mats["cordura_coyote"] = build_gltf_material(
        "MAT_CHR_Cordura_Coyote",
        np.clip(cd_col, 0, 1),
        roughness_map=0.78,
        normal_rgb=height_to_normal(cd_h, 2.6),
        metallic=0.0,
    )

    # 14. Tactical Hard-Knuckle Suede & Carbon-Kevlar Combat Gloves / Boots
    gl_n = fbm_tileable(res, 42, 4, seed=2506)
    kevlar_weave = 0.5 + 0.5 * np.sin((x_c + y_c) * 2 * np.pi * 64) * np.sin((x_c - y_c) * 2 * np.pi * 64)
    gl_h = gl_n * 0.65 + kevlar_weave * 0.35
    gl_col = np.stack([
        0.155 + 0.065 * gl_h,
        0.145 + 0.055 * gl_h,
        0.128 + 0.045 * gl_h,
    ], axis=-1)
    mats["glove_leather"] = build_gltf_material(
        "MAT_CHR_Glove_Suede",
        np.clip(gl_col, 0, 1),
        roughness_map=0.62 + 0.18 * gl_n,
        normal_rgb=height_to_normal(gl_h, 2.5),
        metallic=0.06,
    )

    return mats
