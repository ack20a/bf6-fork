"""
Procedural PBR Materials for BF6 Weapons, Optics, Explosives, and Land/Air Combat Vehicles.
All textures are synthesized via NumPy, packed into bpy.data.images, and wired to
standard Principled BSDF inputs for 100% lossless glTF (.glb) export to Three.js/WebGPU.
"""

import numpy as np
import bpy
from pbr_textures import fbm_tileable, height_to_normal, build_gltf_material


def create_combat_materials() -> dict[str, bpy.types.Material]:
    res = 256
    mats: dict[str, bpy.types.Material] = {}

    y_c = np.linspace(0, 1, res, endpoint=False, dtype=np.float32)[:, None]
    x_c = np.linspace(0, 1, res, endpoint=False, dtype=np.float32)[None, :]

    # 1. Hard-Coat Anodized Gunmetal (Receivers, Rails, Turret Guns)
    gm_n = fbm_tileable(res, 16, 4, seed=2101)
    brush = 0.5 + 0.5 * np.sin(x_c * 2 * np.pi * 64 + gm_n * 2.0)
    gm_col = np.stack([
        0.11 + 0.04 * gm_n + 0.015 * brush,
        0.12 + 0.04 * gm_n + 0.015 * brush,
        0.13 + 0.045 * gm_n + 0.015 * brush,
    ], axis=-1)
    mats["gunmetal"] = build_gltf_material(
        "MAT_WPN_Gunmetal",
        np.clip(gm_col, 0, 1),
        roughness_map=0.34 + 0.16 * (1.0 - gm_n),
        normal_rgb=height_to_normal(gm_n * 0.7 + brush * 0.3, 0.9),
        metallic=0.82,
    )

    # 2. Phosphated Barrel / Heavy Ordnance Steel
    ph_n = fbm_tileable(res, 20, 3, seed=2102)
    ph_col = np.stack([
        0.18 + 0.05 * ph_n,
        0.19 + 0.05 * ph_n,
        0.20 + 0.05 * ph_n,
    ], axis=-1)
    mats["barrel_steel"] = build_gltf_material(
        "MAT_WPN_BarrelSteel",
        np.clip(ph_col, 0, 1),
        roughness_map=0.28 + 0.14 * ph_n,
        normal_rgb=height_to_normal(ph_n, 0.8),
        metallic=0.90,
    )

    # 3. Tactical Flat Dark Earth (FDE / Coyote Tan) Stippled Polymer
    fde_n = fbm_tileable(res, 32, 3, seed=2103)
    fde_macro = fbm_tileable(res, 8, 3, seed=2104)
    fde_col = np.stack([
        0.46 + 0.06 * fde_macro - 0.03 * fde_n,
        0.39 + 0.05 * fde_macro - 0.03 * fde_n,
        0.28 + 0.04 * fde_macro - 0.02 * fde_n,
    ], axis=-1)
    mats["polymer_fde"] = build_gltf_material(
        "MAT_WPN_Polymer_FDE",
        np.clip(fde_col, 0, 1),
        roughness_map=0.62 + 0.14 * fde_n,
        normal_rgb=height_to_normal(fde_n, 1.8),
        metallic=0.0,
    )

    # 4. Matte Black Tactical Polymer (Grips, Stocks, Handguards)
    blk_n = fbm_tileable(res, 36, 3, seed=2105)
    blk_col = np.stack([
        0.08 + 0.03 * blk_n,
        0.085 + 0.03 * blk_n,
        0.09 + 0.03 * blk_n,
    ], axis=-1)
    mats["polymer_black"] = build_gltf_material(
        "MAT_WPN_Polymer_Black",
        np.clip(blk_col, 0, 1),
        roughness_map=0.58 + 0.16 * blk_n,
        normal_rgb=height_to_normal(blk_n, 1.9),
        metallic=0.04,
    )

    # 5. Ordnance Olive / RPG Warhead & C4 Block Compound
    ord_n = fbm_tileable(res, 12, 4, seed=2106)
    ord_col = np.stack([
        0.25 + 0.07 * ord_n,
        0.30 + 0.08 * ord_n,
        0.18 + 0.05 * ord_n,
    ], axis=-1)
    mats["ordnance_olive"] = build_gltf_material(
        "MAT_Ordnance_Olive",
        np.clip(ord_col, 0, 1),
        roughness_map=0.45 + 0.18 * (1.0 - ord_n),
        normal_rgb=height_to_normal(ord_n, 1.0),
        metallic=0.25,
    )

    # 6. 3-Tone Modern NATO Tactical Vehicle Armor Camo (Olive / Desert Tan / Charcoal)
    c1 = fbm_tileable(res, 4, 4, seed=2201)
    c2 = fbm_tileable(res, 6, 3, seed=2202)
    grime = fbm_tileable(res, 18, 3, seed=2203)
    col_olive = np.array([0.24, 0.28, 0.19], dtype=np.float32)
    col_tan = np.array([0.44, 0.39, 0.29], dtype=np.float32)
    col_char = np.array([0.14, 0.15, 0.15], dtype=np.float32)

    camo = np.broadcast_to(col_olive, (res, res, 3)).copy()
    mask_tan = (c1 > 0.58)[:, :, None].astype(np.float32)
    mask_char = (c2 > 0.66)[:, :, None].astype(np.float32)
    camo = camo * (1.0 - mask_tan) + col_tan * mask_tan
    camo = camo * (1.0 - mask_char) + col_char * mask_char
    camo *= (0.86 + 0.24 * grime[:, :, None])

    mats["armor_camo"] = build_gltf_material(
        "MAT_VEH_Armor_Camo",
        np.clip(camo, 0, 1),
        roughness_map=0.54 + 0.20 * (1.0 - grime),
        normal_rgb=height_to_normal(grime, 1.3),
        metallic=0.22,
    )

    # 7. Stealth Gunship Dark Slate Aviation Paint (Attack Helicopter)
    hel_n = fbm_tileable(res, 10, 4, seed=2301)
    panel_x = np.exp(-((np.mod(x_c * 4.0, 1.0) - 0.5) ** 2) / 0.0008) * 0.10
    panel_y = np.exp(-((np.mod(y_c * 4.0, 1.0) - 0.5) ** 2) / 0.0008) * 0.10
    hel_h = np.clip(hel_n * 0.8 - panel_x - panel_y, 0.0, 1.0)
    hel_col = np.stack([
        0.15 + 0.05 * hel_h,
        0.17 + 0.05 * hel_h,
        0.19 + 0.06 * hel_h,
    ], axis=-1)
    mats["heli_slate"] = build_gltf_material(
        "MAT_VEH_Heli_Slate",
        np.clip(hel_col, 0, 1),
        roughness_map=0.42 + 0.18 * (1.0 - hel_h),
        normal_rgb=height_to_normal(hel_h, 1.6),
        metallic=0.38,
    )

    # 8. Molded Heavy Rubber Tire & Tank Track Treads
    trd_n = fbm_tileable(res, 16, 3, seed=2401)
    lugs = (np.sin(y_c * 2 * np.pi * 16.0) > 0.15).astype(np.float32) * 0.65
    trd_h = np.clip(lugs + trd_n * 0.35, 0.0, 1.0)
    trd_col = np.stack([
        0.07 + 0.04 * trd_h,
        0.07 + 0.04 * trd_h,
        0.075 + 0.04 * trd_h,
    ], axis=-1)
    mats["rubber_tread"] = build_gltf_material(
        "MAT_VEH_Rubber_Tread",
        np.clip(trd_col, 0, 1),
        roughness_map=0.86,
        normal_rgb=height_to_normal(trd_h, 3.2),
        metallic=0.0,
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

    # 11. NATO MultiCam Ripstop Tactical Uniform Fabric
    mc1 = fbm_tileable(res, 6, 4, seed=2501)
    mc2 = fbm_tileable(res, 10, 3, seed=2502)
    ripstop = 0.5 + 0.25 * np.sin(x_c * 2 * np.pi * 48) + 0.25 * np.sin(y_c * 2 * np.pi * 48)
    u_base = np.array([0.38, 0.36, 0.25], dtype=np.float32)
    u_grn = np.array([0.22, 0.27, 0.17], dtype=np.float32)
    u_brn = np.array([0.26, 0.20, 0.14], dtype=np.float32)
    u_tan = np.array([0.55, 0.50, 0.37], dtype=np.float32)
    mc_col = np.broadcast_to(u_base, (res, res, 3)).copy()
    mc_col = np.where((mc1 > 0.52)[:, :, None], u_grn, mc_col)
    mc_col = np.where((mc2 > 0.64)[:, :, None], u_brn, mc_col)
    mc_col = np.where(((mc1 < 0.28) & (mc2 < 0.45))[:, :, None], u_tan, mc_col)
    mc_col *= (0.92 + 0.12 * ripstop[:, :, None])
    mats["uniform_multicam"] = build_gltf_material(
        "MAT_CHR_Uniform_MultiCam",
        np.clip(mc_col, 0, 1),
        roughness_map=0.84,
        normal_rgb=height_to_normal(ripstop * 0.65 + mc1 * 0.35, 1.8),
        metallic=0.0,
    )

    # 12. OpFor ("Pax Armata") Charcoal-Slate Ripstop Tactical Uniform
    px1 = fbm_tileable(res, 6, 4, seed=2503)
    px2 = fbm_tileable(res, 12, 3, seed=2504)
    p_base = np.array([0.13, 0.14, 0.15], dtype=np.float32)
    p_olv = np.array([0.17, 0.20, 0.16], dtype=np.float32)
    p_dk = np.array([0.08, 0.085, 0.09], dtype=np.float32)
    px_col = np.broadcast_to(p_base, (res, res, 3)).copy()
    px_col = np.where((px1 > 0.56)[:, :, None], p_olv, px_col)
    px_col = np.where((px2 > 0.65)[:, :, None], p_dk, px_col)
    px_col *= (0.92 + 0.12 * ripstop[:, :, None])
    mats["uniform_pax"] = build_gltf_material(
        "MAT_CHR_Uniform_PaxSlate",
        np.clip(px_col, 0, 1),
        roughness_map=0.82,
        normal_rgb=height_to_normal(ripstop * 0.65 + px1 * 0.35, 1.8),
        metallic=0.0,
    )

    # 13. Coyote Tan 1000D Cordura Nylon Webbing (Plate Carriers, Pouches, Helmet Cover)
    cd_n = fbm_tileable(res, 20, 3, seed=2505)
    molle = (np.mod(y_c * 16.0, 1.0) > 0.14).astype(np.float32) * 0.12
    cd_h = np.clip(cd_n * 0.6 + ripstop * 0.28 + molle, 0.0, 1.0)
    cd_col = np.stack([
        0.48 + 0.08 * cd_h,
        0.40 + 0.07 * cd_h,
        0.27 + 0.05 * cd_h,
    ], axis=-1)
    mats["cordura_coyote"] = build_gltf_material(
        "MAT_CHR_Cordura_Coyote",
        np.clip(cd_col, 0, 1),
        roughness_map=0.79,
        normal_rgb=height_to_normal(cd_h, 2.2),
        metallic=0.0,
    )

    # 14. Tactical Hard-Knuckle Suede & Carbon-Kevlar Combat Gloves / Boots
    gl_n = fbm_tileable(res, 28, 3, seed=2506)
    gl_col = np.stack([
        0.16 + 0.06 * gl_n,
        0.15 + 0.05 * gl_n,
        0.13 + 0.04 * gl_n,
    ], axis=-1)
    mats["glove_leather"] = build_gltf_material(
        "MAT_CHR_Glove_Suede",
        np.clip(gl_col, 0, 1),
        roughness_map=0.66 + 0.15 * gl_n,
        normal_rgb=height_to_normal(gl_n, 2.0),
        metallic=0.05,
    )

    return mats
