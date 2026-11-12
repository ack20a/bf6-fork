"""
Procedural PBR Texture & glTF-Compatible Material Generator for Blender 5.x.
Synthesizes tileable BaseColor, Roughness, and tangent-space Normal maps via NumPy,
packs them into bpy.data.images, and wires standard Principled BSDF nodes so
every material renders cleanly in Blender AND exports losslessly to .glb (Three.js/WebGPU).
"""

import bpy
import numpy as np


def _tileable_noise(res: int, freq: int, rng: np.random.Generator) -> np.ndarray:
    """Generate smooth tileable 2D value noise in [0, 1] at given grid frequency."""
    grid = rng.random((freq, freq), dtype=np.float32)
    # Pad periodically for bilinear/smoothstep interpolation
    y = np.linspace(0, freq, res, endpoint=False, dtype=np.float32)
    x = np.linspace(0, freq, res, endpoint=False, dtype=np.float32)
    yi = np.floor(y).astype(np.int32)
    xi = np.floor(x).astype(np.int32)
    yf = y - yi
    xf = x - xi
    # Smoothstep
    uy = yf * yf * (3.0 - 2.0 * yf)
    ux = xf * xf * (3.0 - 2.0 * xf)

    yi1 = (yi + 1) % freq
    xi1 = (xi + 1) % freq

    g00 = grid[np.ix_(yi, xi)]
    g10 = grid[np.ix_(yi, xi1)]
    g01 = grid[np.ix_(yi1, xi)]
    g11 = grid[np.ix_(yi1, xi1)]

    nx0 = g00 * (1.0 - ux[None, :]) + g10 * ux[None, :]
    nx1 = g01 * (1.0 - ux[None, :]) + g11 * ux[None, :]
    return nx0 * (1.0 - uy[:, None]) + nx1 * uy[:, None]


def fbm_tileable(res: int = 256, base_freq: int = 4, octaves: int = 4, seed: int = 42) -> np.ndarray:
    """Multi-octave tileable fractional Brownian motion normalized to [0, 1]."""
    rng = np.random.default_rng(seed)
    total = np.zeros((res, res), dtype=np.float32)
    amp = 1.0
    amp_sum = 0.0
    freq = base_freq
    for _ in range(octaves):
        if freq > res // 2:
            break
        total += amp * _tileable_noise(res, freq, rng)
        amp_sum += amp
        amp *= 0.5
        freq *= 2
    out = total / max(amp_sum, 1e-6)
    mn, mx = float(out.min()), float(out.max())
    if mx - mn > 1e-6:
        out = (out - mn) / (mx - mn)
    return out


def height_to_normal(height: np.ndarray, strength: float = 2.0) -> np.ndarray:
    """Convert 2D heightfield [0, 1] into tangent-space OpenGL/glTF normal map [0, 1] RGB."""
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5 * strength
    nx = -dx
    ny = -dy
    nz = np.ones_like(height)
    inv_len = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([
        (nx * inv_len) * 0.5 + 0.5,
        (ny * inv_len) * 0.5 + 0.5,
        (nz * inv_len) * 0.5 + 0.5,
    ], axis=-1)
    return np.clip(rgb, 0.0, 1.0)


def create_packed_image(name: str, rgb: np.ndarray, is_data: bool = False) -> bpy.types.Image:
    """Create or replace a packed Blender image from (H, W, 3) or (H, W, 4) float32 array."""
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])

    h, w, c = rgb.shape
    img = bpy.data.images.new(name=name, width=w, height=h, alpha=(c == 4), float_buffer=False)
    if is_data:
        img.colorspace_settings.name = "Non-Color"
    else:
        img.colorspace_settings.name = "sRGB"

    if c == 3:
        rgba = np.concatenate([rgb, np.ones((h, w, 1), dtype=np.float32)], axis=-1)
    else:
        rgba = rgb
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    img.pack()
    return img


def build_gltf_material(
    name: str,
    base_rgb: np.ndarray,
    roughness_map: np.ndarray | float = 0.7,
    normal_rgb: np.ndarray | None = None,
    metallic: float = 0.0,
    emission_color: tuple[float, float, float] | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    """Create a clean glTF-exportable Principled BSDF material."""
    if name in bpy.data.materials:
        mat = bpy.data.materials[name]
    else:
        mat = bpy.data.materials.new(name=name)

    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out_node = nt.nodes.new("ShaderNodeOutputMaterial")
    out_node.location = (400, 0)

    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (80, 0)
    nt.links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])

    # Base color texture
    bc_img = create_packed_image(f"TEX_{name}_BC", base_rgb, is_data=False)
    bc_node = nt.nodes.new("ShaderNodeTexImage")
    bc_node.image = bc_img
    bc_node.location = (-320, 220)
    nt.links.new(bc_node.outputs["Color"], bsdf.inputs["Base Color"])

    bsdf.inputs["Metallic"].default_value = float(metallic)

    # Roughness
    if isinstance(roughness_map, np.ndarray):
        r_rgb = np.repeat(np.clip(roughness_map, 0.05, 0.99)[:, :, None], 3, axis=-1)
        r_img = create_packed_image(f"TEX_{name}_Rough", r_rgb, is_data=True)
        r_node = nt.nodes.new("ShaderNodeTexImage")
        r_node.image = r_img
        r_node.location = (-320, -40)
        nt.links.new(r_node.outputs["Color"], bsdf.inputs["Roughness"])
    else:
        bsdf.inputs["Roughness"].default_value = float(roughness_map)

    # Normal map
    if normal_rgb is not None:
        n_img = create_packed_image(f"TEX_{name}_Norm", normal_rgb, is_data=True)
        n_tex = nt.nodes.new("ShaderNodeTexImage")
        n_tex.image = n_img
        n_tex.location = (-560, -300)

        n_map = nt.nodes.new("ShaderNodeNormalMap")
        n_map.location = (-240, -300)
        n_map.inputs["Strength"].default_value = 1.0
        nt.links.new(n_tex.outputs["Color"], n_map.inputs["Color"])
        nt.links.new(n_map.outputs["Normal"], bsdf.inputs["Normal"])

    if emission_color is not None and emission_strength > 0.0:
        bsdf.inputs["Emission Color"].default_value = (*emission_color, 1.0)
        bsdf.inputs["Emission Strength"].default_value = float(emission_strength)

    return mat


def create_all_materials() -> dict[str, bpy.types.Material]:
    """Generate the full Battlefield 6 Tactical Environment PBR Material Library."""
    res = 256
    mats: dict[str, bpy.types.Material] = {}

    y_coord = np.linspace(0, 1, res, endpoint=False, dtype=np.float32)[:, None]
    x_coord = np.linspace(0, 1, res, endpoint=False, dtype=np.float32)[None, :]

    # 1. Exterior Architectural Concrete (formwork seams + subtle aggregate + grime)
    n1 = fbm_tileable(res, 6, 4, seed=101)
    n2 = fbm_tileable(res, 24, 3, seed=102)
    seams_h = np.exp(-((np.mod(y_coord * 4.0, 1.0) - 0.5) ** 2) / 0.0012) * 0.12
    seams_v = np.exp(-((np.mod(x_coord * 2.0, 1.0) - 0.5) ** 2) / 0.0012) * 0.08
    conc_h = np.clip(n1 * 0.55 + n2 * 0.45 - seams_h - seams_v, 0.0, 1.0)
    conc_col = np.stack([
        0.46 + 0.14 * conc_h - 0.03 * n2,
        0.45 + 0.14 * conc_h - 0.03 * n2,
        0.43 + 0.13 * conc_h - 0.02 * n2,
    ], axis=-1)
    mats["concrete_ext"] = build_gltf_material(
        "MAT_Concrete_Exterior",
        np.clip(conc_col, 0, 1),
        roughness_map=0.78 + 0.16 * (1.0 - conc_h),
        normal_rgb=height_to_normal(conc_h, 2.2),
        metallic=0.0,
    )

    # 2. Broken / Fractured Inner Concrete (dark rough aggregate for blast seams & rubble)
    brk_n = fbm_tileable(res, 12, 4, seed=202)
    speck = (fbm_tileable(res, 32, 2, seed=203) > 0.68).astype(np.float32) * 0.12
    brk_h = np.clip(brk_n * 0.8 + speck, 0.0, 1.0)
    brk_col = np.stack([
        0.28 + 0.16 * brk_h,
        0.27 + 0.15 * brk_h,
        0.26 + 0.14 * brk_h,
    ], axis=-1)
    mats["concrete_broken"] = build_gltf_material(
        "MAT_Concrete_Broken",
        np.clip(brk_col, 0, 1),
        roughness_map=0.88 + 0.10 * (1.0 - brk_h),
        normal_rgb=height_to_normal(brk_h, 4.0),
        metallic=0.0,
    )

    # 3. Interior Tactical Plaster (muted olive-grey painted drywall/plaster)
    pls_n = fbm_tileable(res, 8, 4, seed=303)
    pls_col = np.stack([
        0.54 + 0.08 * pls_n,
        0.55 + 0.08 * pls_n,
        0.50 + 0.07 * pls_n,
    ], axis=-1)
    mats["plaster_int"] = build_gltf_material(
        "MAT_Plaster_Interior",
        np.clip(pls_col, 0, 1),
        roughness_map=0.72 + 0.12 * (1.0 - pls_n),
        normal_rgb=height_to_normal(pls_n, 1.0),
        metallic=0.0,
    )

    # 4. Dark Structural / Gunmetal Steel (frames, I-beams, hinges)
    stl_n = fbm_tileable(res, 10, 4, seed=404)
    scratches = fbm_tileable(res, 32, 2, seed=405)
    stl_col = np.stack([
        0.16 + 0.07 * stl_n + 0.04 * scratches,
        0.17 + 0.07 * stl_n + 0.04 * scratches,
        0.18 + 0.08 * stl_n + 0.04 * scratches,
    ], axis=-1)
    mats["steel_dark"] = build_gltf_material(
        "MAT_Steel_Dark",
        np.clip(stl_col, 0, 1),
        roughness_map=0.38 + 0.22 * (1.0 - stl_n),
        normal_rgb=height_to_normal(stl_n * 0.6 + scratches * 0.4, 1.2),
        metallic=0.85,
    )

    # 5. Rusted Rebar Steel
    rst_n = fbm_tileable(res, 14, 4, seed=505)
    ribs = 0.5 + 0.5 * np.sin(y_coord * 2.0 * np.pi * 24.0)
    rst_col = np.stack([
        0.34 + 0.18 * rst_n,
        0.18 + 0.09 * rst_n,
        0.11 + 0.06 * rst_n,
    ], axis=-1)
    mats["rebar_rust"] = build_gltf_material(
        "MAT_Rebar_Rusted",
        np.clip(rst_col, 0, 1),
        roughness_map=0.68 + 0.20 * rst_n,
        normal_rgb=height_to_normal(ribs * 0.7 + rst_n * 0.3, 3.0),
        metallic=0.65,
    )

    # 6. NATO Olive Drab Painted Metal (Container & Military Crates)
    olv_n = fbm_tileable(res, 8, 4, seed=606)
    streaks = fbm_tileable(res, 16, 3, seed=607)
    olv_col = np.stack([
        0.22 + 0.07 * olv_n,
        0.26 + 0.08 * olv_n,
        0.17 + 0.05 * olv_n,
    ], axis=-1) * (0.88 + 0.20 * streaks[:, :, None])
    mats["metal_olive"] = build_gltf_material(
        "MAT_Metal_NATO_Olive",
        np.clip(olv_col, 0, 1),
        roughness_map=0.48 + 0.22 * (1.0 - olv_n),
        normal_rgb=height_to_normal(olv_n, 1.1),
        metallic=0.35,
    )

    # 7. Weathered Cargo Blue Painted Metal (Container variant)
    blu_n = fbm_tileable(res, 8, 4, seed=707)
    rust_patch = np.clip((fbm_tileable(res, 6, 3, seed=708) - 0.68) * 3.2, 0.0, 1.0)
    base_blu = np.stack([
        0.14 + 0.06 * blu_n,
        0.27 + 0.08 * blu_n,
        0.39 + 0.10 * blu_n,
    ], axis=-1)
    rust_rgb = np.array([0.36, 0.19, 0.11], dtype=np.float32)[None, None, :]
    blu_col = base_blu * (1.0 - rust_patch[:, :, None]) + rust_rgb * rust_patch[:, :, None]
    mats["metal_blue"] = build_gltf_material(
        "MAT_Metal_Cargo_Blue",
        np.clip(blu_col, 0, 1),
        roughness_map=0.46 + 0.35 * rust_patch,
        normal_rgb=height_to_normal(blu_n * 0.6 + rust_patch * 0.4, 1.5),
        metallic=0.30,
    )

    # 8. Hesco Geotextile Liner + Wire Grid Composite (for outer Hesco cells)
    fab_n = fbm_tileable(res, 16, 3, seed=808)
    weave = 0.5 + 0.25 * np.sin(x_coord * 2 * np.pi * 32) + 0.25 * np.sin(y_coord * 2 * np.pi * 32)
    # Galvanized wire mesh lines every 16x16 cells
    gx = np.abs(np.mod(x_coord * 12.0, 1.0) - 0.5)
    gy = np.abs(np.mod(y_coord * 12.0, 1.0) - 0.5)
    wire = np.clip(1.0 - np.minimum(gx, gy) * 18.0, 0.0, 1.0)
    tan_col = np.stack([
        0.58 + 0.10 * fab_n - 0.04 * weave,
        0.52 + 0.09 * fab_n - 0.04 * weave,
        0.39 + 0.07 * fab_n - 0.03 * weave,
    ], axis=-1)
    wire_col = np.array([0.62, 0.64, 0.65], dtype=np.float32)[None, None, :]
    hesco_col = tan_col * (1.0 - wire[:, :, None]) + wire_col * wire[:, :, None]
    hesco_h = np.clip(weave * 0.25 + fab_n * 0.25 + wire * 0.65, 0.0, 1.0)
    mats["hesco_wall"] = build_gltf_material(
        "MAT_Hesco_Bastion",
        np.clip(hesco_col, 0, 1),
        roughness_map=0.85 * (1.0 - wire) + 0.35 * wire,
        normal_rgb=height_to_normal(hesco_h, 3.2),
        metallic=0.20,
    )

    # 9. Burlap Sandbag Weave
    brl_n = fbm_tileable(res, 12, 3, seed=909)
    b_weave = 0.5 + 0.25 * np.sin(x_coord * 2 * np.pi * 40) + 0.25 * np.sin(y_coord * 2 * np.pi * 40)
    brl_col = np.stack([
        0.55 + 0.11 * brl_n - 0.05 * b_weave,
        0.47 + 0.10 * brl_n - 0.04 * b_weave,
        0.33 + 0.07 * brl_n - 0.03 * b_weave,
    ], axis=-1)
    mats["burlap"] = build_gltf_material(
        "MAT_Burlap_Sandbag",
        np.clip(brl_col, 0, 1),
        roughness_map=0.88,
        normal_rgb=height_to_normal(b_weave * 0.6 + brl_n * 0.4, 2.5),
        metallic=0.0,
    )

    # 10. Compacted Sand / Gravel Earth Fill
    snd_n = fbm_tileable(res, 20, 4, seed=1010)
    pebbles = fbm_tileable(res, 48, 2, seed=1011)
    snd_h = snd_n * 0.55 + pebbles * 0.45
    snd_col = np.stack([
        0.42 + 0.14 * snd_h,
        0.37 + 0.12 * snd_h,
        0.28 + 0.09 * snd_h,
    ], axis=-1)
    mats["sand_earth"] = build_gltf_material(
        "MAT_Sand_Gravel",
        np.clip(snd_col, 0, 1),
        roughness_map=0.92,
        normal_rgb=height_to_normal(snd_h, 3.5),
        metallic=0.0,
    )

    # 11. Diagonal Hazard Stripes (Yellow / Black Worn Industrial Paint)
    hz_n = fbm_tileable(res, 12, 3, seed=1111)
    stripe = (np.mod((x_coord + y_coord) * 6.0, 1.0) > 0.5).astype(np.float32)
    yel = np.array([0.82, 0.62, 0.08], dtype=np.float32)[None, None, :]
    blk = np.array([0.12, 0.12, 0.13], dtype=np.float32)[None, None, :]
    wear = np.clip((hz_n - 0.72) * 3.0, 0.0, 1.0)
    hz_col = yel * stripe[:, :, None] + blk * (1.0 - stripe[:, :, None])
    hz_col = hz_col * (1.0 - wear[:, :, None] * 0.45) + 0.35 * wear[:, :, None]
    mats["hazard"] = build_gltf_material(
        "MAT_Hazard_Stripes",
        np.clip(hz_col, 0, 1),
        roughness_map=0.52 + 0.30 * wear,
        normal_rgb=height_to_normal(hz_n, 1.2),
        metallic=0.15,
    )

    # 12. Conquest Objective Flag Fabric (Tactical Slate Blue + Cyan Chevron)
    flg_n = fbm_tileable(res, 10, 3, seed=1212)
    chevron = ((np.abs(y_coord - 0.5) * 1.8 + x_coord * 0.55) > 0.52) & (
        (np.abs(y_coord - 0.5) * 1.8 + x_coord * 0.55) < 0.66
    )
    border = (y_coord < 0.08) | (y_coord > 0.92)
    f_base = np.stack([
        0.11 + 0.04 * flg_n,
        0.22 + 0.05 * flg_n,
        0.32 + 0.06 * flg_n,
    ], axis=-1)
    accent = np.array([0.15, 0.78, 0.92], dtype=np.float32)[None, None, :]
    mask = (chevron | border).astype(np.float32)[:, :, None]
    flg_col = f_base * (1.0 - mask) + accent * mask
    mats["flag_nato"] = build_gltf_material(
        "MAT_Conquest_Flag",
        np.clip(flg_col, 0, 1),
        roughness_map=0.78,
        normal_rgb=height_to_normal(flg_n, 1.4),
        metallic=0.0,
    )

    # 13. Tactical Cyan LED Status Screen / Beacon (Emissive)
    led_col = np.broadcast_to(np.array([0.10, 0.85, 0.98], dtype=np.float32), (32, 32, 3)).copy()
    mats["led_cyan"] = build_gltf_material(
        "MAT_Tactical_LED_Cyan",
        led_col,
        roughness_map=0.2,
        metallic=0.0,
        emission_color=(0.10, 0.85, 1.0),
        emission_strength=3.5,
    )

    return mats
