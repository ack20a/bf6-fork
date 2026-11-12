"""
Master Builder & Exporter for BF6 Complete Asset Suite in Blender 5.x:
  - 27 Procedural glTF-Ready PBR Materials (packed textures)
  - 18 Modular Destructible Buildings, Fortifications & Conquest Props -> public/models/env/
  - 5 Articulated FPS Weapons & C4 Demolition Gadgets -> public/models/weapons/
  - 3 Articulated Land & Air Combat Vehicles (MBT, Attack Heli, 4x4 LATV) -> public/models/vehicles/
  - 3 Skinned & Animated Character Rigs (NATO Soldier, Pax OpFor Soldier, FPS Viewmodel Arms) -> public/models/characters/
  - Combined-Arms Outpost Alpha Battle Scene (Soldiers + Tank + Attack Heli + 4x4 + Destructible 2-Story Outpost + FPS POV!)
"""

import os
import sys
import math
import importlib
import bpy
import bmesh
from mathutils import Vector

SCRIPT_DIR = r"c:\app\bf6-fork\scripts\blender"
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import pbr_textures
import combat_materials
import mesh_utils
import modular_buildings
import tactical_cover
import combat_weapons
import combat_vehicles
import combat_characters

importlib.reload(pbr_textures)
importlib.reload(combat_materials)
importlib.reload(mesh_utils)
importlib.reload(modular_buildings)
importlib.reload(tactical_cover)
importlib.reload(combat_weapons)
importlib.reload(combat_vehicles)
importlib.reload(combat_characters)

from mesh_utils import (
    ensure_collection,
    clear_collection_recursive,
    clone_hierarchy,
    export_prefab_glb,
    export_skinned_rig_glb,
    add_box_to_bm,
    finalize_bmesh_object,
)
from combat_characters import apply_rifle_ready_pose

BLEND_SAVE_PATH = r"c:\app\bf6-fork\assets\blender\bf6_modular_env_kit.blend"
MODEL_BASE_DIR = r"c:\app\bf6-fork\public\models"


def cleanup_startup_and_previous() -> None:
    """Remove default startup Cube, old actions, and clear generated BF6 collections cleanly."""
    if "Cube" in bpy.data.objects:
        cube = bpy.data.objects["Cube"]
        mesh = cube.data
        bpy.data.objects.remove(cube, do_unlink=True)
        if mesh and mesh.users == 0:
            bpy.data.meshes.remove(mesh)

    managed_cols = (
        "01_BF6_Env_Catalog",
        "01_BF6_Asset_Catalog",
        "02_BF6_Outpost_Alpha_Demo",
        "03_BF6_Lighting_Cam",
        "04_BF6_Weapons_Vehicles_Catalog",
        "05_BF6_Characters_Catalog",
    )
    for col_name in managed_cols:
        if col_name in bpy.data.collections:
            clear_collection_recursive(bpy.data.collections[col_name])
            if col_name == "01_BF6_Asset_Catalog":
                bpy.data.collections.remove(bpy.data.collections[col_name])

    for act in list(bpy.data.actions):
        if act.users == 0 or act.name.startswith(("CHR_", "FPS_")):
            bpy.data.actions.remove(act)


def export_categorized_prefabs(
    env_prefabs: dict[str, bpy.types.Object],
    wpn_prefabs: dict[str, bpy.types.Object],
    veh_prefabs: dict[str, bpy.types.Object],
    chr_prefabs: dict[str, bpy.types.Object],
) -> dict[str, list[str]]:
    """Export static/articulated prefabs and skinned character rigs into public/models/*."""
    manifest: dict[str, list[str]] = {}

    for sub, group in (("env", env_prefabs), ("weapons", wpn_prefabs), ("vehicles", veh_prefabs)):
        out_dir = os.path.join(MODEL_BASE_DIR, sub)
        os.makedirs(out_dir, exist_ok=True)
        paths = []
        for name, root_obj in group.items():
            p = os.path.join(out_dir, f"{name}.glb")
            export_prefab_glb(root_obj, p)
            paths.append(p)
        manifest[sub] = paths

    chr_dir = os.path.join(MODEL_BASE_DIR, "characters")
    os.makedirs(chr_dir, exist_ok=True)
    chr_paths = []
    for name, arm_obj in chr_prefabs.items():
        p = os.path.join(chr_dir, f"{name}.glb")
        export_skinned_rig_glb(arm_obj, p)
        chr_paths.append(p)
    manifest["characters"] = chr_paths

    return manifest


def _equip_posed_soldier(
    soldier_proto: bpy.types.Object,
    weapon_proto: bpy.types.Object,
    target_col: bpy.types.Collection,
    loc: tuple[float, float, float],
    rot_z_deg: float,
    crouch: bool,
    prefix: str,
) -> bpy.types.Object:
    """Clone a rigged soldier, pose its skeleton, and snap a cloned weapon cleanly into its hands."""
    s_inst = clone_hierarchy(soldier_proto, target_col, loc, rot_z_deg, prefix)
    apply_rifle_ready_pose(s_inst, crouch=crouch)
    bpy.context.view_layer.update()

    hand_pb = s_inst.pose.bones["Hand_R"]
    hand_world = s_inst.matrix_world @ hand_pb.head
    rad = math.radians(rot_z_deg - 10.0)
    fwd = Vector((-math.sin(rad), math.cos(rad), 0.0))
    wpn_pos = hand_world + fwd * 0.05 + Vector((0.0, 0.0, 0.03))

    w_inst = clone_hierarchy(weapon_proto, target_col, tuple(wpn_pos), rot_z_deg - 10.0, f"{prefix}_Wpn")
    return s_inst


def layout_env_catalog(
    cat_col: bpy.types.Collection,
    env_prefabs: dict[str, bpy.types.Object],
    mats: dict[str, bpy.types.Material],
) -> None:
    bm_pad = bmesh.new()
    add_box_to_bm(bm_pad, (47.0, 0.0, -0.15), (48.0, 24.0, 0.30), mat_index=0)
    finalize_bmesh_object("ENV_Catalog_DisplayPad", bm_pad, [mats["concrete_ext"]], cat_col, uv_scale=0.35)

    for idx, name in enumerate(env_prefabs.keys()):
        row = idx // 6
        col = idx % 6
        env_prefabs[name].location = (29.0 + col * 7.2, -7.0 + row * 7.0, 0.0)


def layout_combat_catalog(
    wv_col: bpy.types.Collection,
    wpn_prefabs: dict[str, bpy.types.Object],
    veh_prefabs: dict[str, bpy.types.Object],
    mats: dict[str, bpy.types.Material],
) -> None:
    cx_pad, cy_pad = 47.0, 28.0
    bm_pad = bmesh.new()
    add_box_to_bm(bm_pad, (cx_pad, cy_pad, -0.15), (32.0, 22.0, 0.30), mat_index=0)
    add_box_to_bm(bm_pad, (cx_pad, cy_pad - 6.5, 0.005), (30.0, 0.18, 0.01), mat_index=2)
    add_box_to_bm(bm_pad, (cx_pad, cy_pad - 7.8, 0.82), (5.8, 1.45, 0.08), mat_index=1)
    for sx in (-2.6, 2.6):
        for sy in (cy_pad - 8.35, cy_pad - 7.25):
            add_box_to_bm(bm_pad, (cx_pad + sx, sy, 0.40), (0.10, 0.10, 0.80), mat_index=1)
    for gx_off in (-2.05, -0.65, 0.85):
        gx = cx_pad + gx_off
        add_box_to_bm(bm_pad, (gx, cy_pad - 7.80, 0.94), (0.28, 0.28, 0.03), mat_index=2)
        add_box_to_bm(bm_pad, (gx - 0.10, cy_pad - 7.86, 1.00), (0.03, 0.04, 0.14), mat_index=1)
        add_box_to_bm(bm_pad, (gx + 0.12, cy_pad - 7.72, 1.00), (0.03, 0.04, 0.14), mat_index=1)
    finalize_bmesh_object(
        "ENV_Armory_MotorPool_Pad",
        bm_pad,
        [mats["concrete_ext"], mats["steel_dark"], mats["hazard"]],
        wv_col,
        uv_scale=0.4,
        bevel_width=0.005,
    )

    veh_layout = [
        ("VEH_MBT_AbramsX", (cx_pad - 8.2, cy_pad + 2.2, 0.0), 148.0),
        ("VEH_Heli_LittleBird_AH6", (cx_pad + 0.8, cy_pad + 2.5, 0.0), 162.0),
        ("VEH_Buggy_LATV4", (cx_pad + 9.2, cy_pad + 1.8, 0.0), 145.0),
    ]
    for v_name, loc, rot_z in veh_layout:
        veh_prefabs[v_name].location = loc
        veh_prefabs[v_name].rotation_euler = (0.0, 0.0, math.radians(rot_z))

    wpn_layout = [
        ("WPN_AssaultRifle_M5A3", (cx_pad - 2.05, cy_pad - 7.80, 1.08), (0.0, 0.0, math.radians(-68.0))),
        ("WPN_Launcher_RPG7V2", (cx_pad - 0.65, cy_pad - 7.80, 1.06), (0.0, 0.0, math.radians(-68.0))),
        ("WPN_Sniper_M2010", (cx_pad + 0.85, cy_pad - 7.80, 1.08), (0.0, 0.0, math.radians(-68.0))),
        ("GAD_C4_BreachPack", (cx_pad + 2.00, cy_pad - 7.82, 0.86), (0.0, 0.0, math.radians(-25.0))),
        ("GAD_C4_Detonator", (cx_pad + 2.42, cy_pad - 7.92, 0.86), (0.0, 0.0, math.radians(18.0))),
    ]
    for w_name, loc, rot_eul in wpn_layout:
        wpn_prefabs[w_name].location = loc
        wpn_prefabs[w_name].rotation_euler = rot_eul


def layout_character_catalog(
    chr_col: bpy.types.Collection,
    chr_prefabs: dict[str, bpy.types.Object],
    wpn_prefabs: dict[str, bpy.types.Object],
    mats: dict[str, bpy.types.Material],
) -> None:
    """
    Showcase NATO & Pax Armata Rigged Soldiers (both Rest Pose & Armed Combat Poses)
    plus the 1st-Person Viewmodel Arms Rig on a Squad Briefing Pad at (47m, 52m).
    """
    cx, cy = 47.0, 52.0
    bm_pad = bmesh.new()
    add_box_to_bm(bm_pad, (cx, cy, -0.15), (14.0, 10.0, 0.30), mat_index=0)
    add_box_to_bm(bm_pad, (cx, cy - 2.6, 0.005), (12.5, 0.12, 0.01), mat_index=2)
    # Pedestal for FPS Arms Rig inspection
    add_box_to_bm(bm_pad, (cx + 3.4, cy, 0.55), (1.1, 1.1, 1.10), mat_index=1)
    finalize_bmesh_object(
        "ENV_Squad_Showcase_Pad",
        bm_pad,
        [mats["concrete_ext"], mats["steel_dark"], mats["hazard"]],
        chr_col,
        uv_scale=0.4,
        bevel_width=0.005,
    )

    # 1. Master Rest-Pose Rigs facing toward -Y Camera (mute NLA after export so Rest Pose displays cleanly!)
    for rig_key in ("CHR_Soldier_NATO_Assault", "CHR_Soldier_PAX_OpFor", "CHR_FPS_Arms_Rig"):
        rig_obj = chr_prefabs[rig_key]
        if rig_obj.animation_data:
            for trk in rig_obj.animation_data.nla_tracks:
                trk.mute = True

    chr_prefabs["CHR_Soldier_NATO_Assault"].location = (cx - 3.3, cy + 0.3, 0.0)
    chr_prefabs["CHR_Soldier_NATO_Assault"].rotation_euler = (0.0, 0.0, math.radians(168.0))

    chr_prefabs["CHR_Soldier_PAX_OpFor"].location = (cx + 0.1, cy + 0.3, 0.0)
    chr_prefabs["CHR_Soldier_PAX_OpFor"].rotation_euler = (0.0, 0.0, math.radians(-168.0))

    chr_prefabs["CHR_FPS_Arms_Rig"].location = (cx + 3.2, cy - 0.1, 1.32)
    chr_prefabs["CHR_FPS_Arms_Rig"].rotation_euler = (0.0, 0.0, math.radians(152.0))
    clone_hierarchy(wpn_prefabs["WPN_AssaultRifle_M5A3"], chr_col, (cx + 3.2, cy - 0.1, 1.32), 152.0, "Cat_FPS_Rifle")

    # 2. Posed Armed Action Clones right alongside them!
    _equip_posed_soldier(
        chr_prefabs["CHR_Soldier_NATO_Assault"],
        wpn_prefabs["WPN_AssaultRifle_M5A3"],
        chr_col,
        (cx - 1.85, cy - 0.55, 0.0),
        162.0,
        crouch=False,
        prefix="Showcase_NATO_Aim",
    )
    _equip_posed_soldier(
        chr_prefabs["CHR_Soldier_PAX_OpFor"],
        wpn_prefabs["WPN_Launcher_RPG7V2"],
        chr_col,
        (cx + 1.80, cy - 0.65, 0.0),
        -158.0,
        crouch=True,
        prefix="Showcase_PAX_CrouchRPG",
    )


def build_outpost_showcase(
    demo_col: bpy.types.Collection,
    env_prefabs: dict[str, bpy.types.Object],
    wpn_prefabs: dict[str, bpy.types.Object],
    veh_prefabs: dict[str, bpy.types.Object],
    chr_prefabs: dict[str, bpy.types.Object],
    mats: dict[str, bpy.types.Material],
) -> None:
    # 0. Tactical Outpost Ground Pad (34m x 30m)
    bm_gnd = bmesh.new()
    add_box_to_bm(bm_gnd, (0.0, -2.5, -0.18), (34.0, 31.0, 0.32), mat_index=0)
    add_box_to_bm(bm_gnd, (0.0, -10.2, -0.01), (33.8, 6.8, 0.04), mat_index=1)
    finalize_bmesh_object(
        "ENV_Outpost_GroundPad",
        bm_gnd,
        [mats["sand_earth"], mats["concrete_ext"]],
        demo_col,
        uv_scale=0.35,
    )

    # 1. Foundations & Structural Pillars
    for bx in (-2.0, 2.0):
        for by in (-2.0, 2.0):
            clone_hierarchy(env_prefabs["BLD_Foundation_4x4"], demo_col, (bx, by, 0.0), 0.0, "Demo")

    for z_flr in (0.0, 3.60):
        for px in (-4.0, 0.0, 4.0):
            for py in (-4.0, 0.0, 4.0):
                clone_hierarchy(env_prefabs["BLD_Pillar_3m6"], demo_col, (px, py, z_flr), 0.0, "Demo")

    # 2. Ground Floor Walls + Tank-Shell Breach
    clone_hierarchy(env_prefabs["BLD_Wall_Door_4m"], demo_col, (-2.0, -4.0, 0.0), 0.0, "F1_S1")
    clone_hierarchy(
        env_prefabs["BLD_Wall_Solid_4m"],
        demo_col,
        (2.0, -4.0, 0.0),
        0.0,
        "F1_S2_Breached",
        skip_child_substrings=("Chunk_02", "Chunk_03", "Chunk_05"),
    )
    clone_hierarchy(
        env_prefabs["BLD_Wall_Window_4m"],
        demo_col,
        (4.0, -2.0, 0.0),
        90.0,
        "F1_E1_Damaged",
        skip_child_substrings=("Chunk_01", "Chunk_03", "Frame"),
    )
    clone_hierarchy(env_prefabs["BLD_Wall_Window_4m"], demo_col, (4.0, 2.0, 0.0), 90.0, "F1_E2")
    clone_hierarchy(env_prefabs["BLD_Wall_Door_4m"], demo_col, (2.0, 4.0, 0.0), 180.0, "F1_N1")
    clone_hierarchy(env_prefabs["BLD_Wall_Solid_4m"], demo_col, (-2.0, 4.0, 0.0), 180.0, "F1_N2")
    clone_hierarchy(env_prefabs["BLD_Wall_Solid_4m"], demo_col, (-4.0, 2.0, 0.0), -90.0, "F1_W1")
    clone_hierarchy(env_prefabs["BLD_Wall_Window_4m"], demo_col, (-4.0, -2.0, 0.0), -90.0, "F1_W2")
    clone_hierarchy(env_prefabs["BLD_Stairs_4m"], demo_col, (-2.0, 2.75, 0.0), 0.0, "F1_Stairs")

    # 3. Second Floor Slabs & Walls + Upper RPG Breach
    for bx, by in ((-2.0, -2.0), (2.0, -2.0), (2.0, 2.0)):
        clone_hierarchy(env_prefabs["BLD_FloorSlab_4x4"], demo_col, (bx, by, 3.60), 0.0, "F2_Slab")

    clone_hierarchy(
        env_prefabs["BLD_Wall_Window_4m"],
        demo_col,
        (-2.0, -4.0, 3.60),
        0.0,
        "F2_S1_Breached",
        skip_child_substrings=("Chunk_03", "Chunk_04", "Frame"),
    )
    clone_hierarchy(env_prefabs["BLD_Wall_Window_4m"], demo_col, (2.0, -4.0, 3.60), 0.0, "F2_S2")
    clone_hierarchy(
        env_prefabs["BLD_Wall_Solid_4m"],
        demo_col,
        (4.0, -2.0, 3.60),
        90.0,
        "F2_E1_Breached",
        skip_child_substrings=("Chunk_04", "Chunk_05"),
    )
    clone_hierarchy(env_prefabs["BLD_Wall_Window_4m"], demo_col, (4.0, 2.0, 3.60), 90.0, "F2_E2")
    clone_hierarchy(env_prefabs["BLD_Wall_Window_4m"], demo_col, (2.0, 4.0, 3.60), 180.0, "F2_N1")
    clone_hierarchy(env_prefabs["BLD_Wall_Solid_4m"], demo_col, (-2.0, 4.0, 3.60), 180.0, "F2_N2")
    clone_hierarchy(env_prefabs["BLD_Wall_Solid_4m"], demo_col, (-4.0, 2.0, 3.60), -90.0, "F2_W1")
    clone_hierarchy(env_prefabs["BLD_Wall_Window_4m"], demo_col, (-4.0, -2.0, 3.60), -90.0, "F2_W2")

    # 4. Roof & Sniper Parapets
    for bx, by in ((-2.0, -2.0), (2.0, -2.0), (2.0, 2.0), (-2.0, 2.0)):
        clone_hierarchy(env_prefabs["BLD_FloorSlab_4x4"], demo_col, (bx, by, 7.20), 0.0, "Roof_Slab")

    clone_hierarchy(
        env_prefabs["BLD_Roof_Parapet_4m"],
        demo_col,
        (-2.0, -4.0, 7.20),
        0.0,
        "Roof_P1",
        skip_child_substrings=("Seg_02",),
    )
    clone_hierarchy(env_prefabs["BLD_Roof_Parapet_4m"], demo_col, (2.0, -4.0, 7.20), 0.0, "Roof_P2")
    clone_hierarchy(env_prefabs["BLD_Roof_Parapet_4m"], demo_col, (4.0, -2.0, 7.20), 90.0, "Roof_P3")
    clone_hierarchy(env_prefabs["BLD_Roof_Parapet_4m"], demo_col, (4.0, 2.0, 7.20), 90.0, "Roof_P4")
    clone_hierarchy(env_prefabs["BLD_Roof_Parapet_4m"], demo_col, (-4.0, -2.0, 7.20), -90.0, "Roof_P5")

    # 5. Destruction Debris & Fortifications
    clone_hierarchy(env_prefabs["BLD_Rubble_Pile"], demo_col, (2.2, -4.6, 0.0), 12.0, "Debris_S2_Ext")
    clone_hierarchy(env_prefabs["BLD_Rubble_Pile"], demo_col, (2.0, -3.1, 0.0), -145.0, "Debris_S2_Int")
    clone_hierarchy(env_prefabs["BLD_Rubble_Pile"], demo_col, (4.7, -2.1, 0.0), 82.0, "Debris_E1_Ext")
    clone_hierarchy(env_prefabs["BLD_Rubble_Pile"], demo_col, (-2.1, -4.7, 0.0), -8.0, "Debris_S1_Ext")

    clone_hierarchy(env_prefabs["OBJ_Conquest_Flagpole"], demo_col, (-6.2, -5.8, 0.0), 25.0, "Obj_Alpha")
    clone_hierarchy(env_prefabs["COV_Sandbag_Wall_Curved"], demo_col, (-6.2, -8.2, 0.0), 0.0, "Sandbag_Alpha_S")
    clone_hierarchy(env_prefabs["COV_Sandbag_Wall_Curved"], demo_col, (-8.5, -5.8, 0.0), -80.0, "Sandbag_Alpha_W")
    clone_hierarchy(env_prefabs["COV_Tactical_Crate"], demo_col, (-5.1, -6.9, 0.0), 32.0, "Ammo_Alpha_1")
    clone_hierarchy(env_prefabs["COV_Tactical_Crate"], demo_col, (-1.8, -5.2, 0.0), -12.0, "Ammo_Door_2")

    clone_hierarchy(env_prefabs["COV_Hesco_Wall_3x"], demo_col, (6.8, -6.2, 0.0), -25.0, "Hesco_East_1")
    clone_hierarchy(env_prefabs["COV_Hesco_Single"], demo_col, (8.8, -5.3, 0.0), -25.0, "Hesco_East_Cap")
    clone_hierarchy(env_prefabs["COV_Hesco_Wall_3x"], demo_col, (-8.8, -0.5, 0.0), 90.0, "Hesco_West_1")

    clone_hierarchy(env_prefabs["COV_Container_20ft_Olive"], demo_col, (9.8, 1.2, 0.0), 78.0, "Cont_Olive_E")
    clone_hierarchy(env_prefabs["COV_Container_20ft_Blue"], demo_col, (-10.5, 5.2, 0.0), -14.0, "Cont_Blue_NW")

    clone_hierarchy(env_prefabs["COV_Jersey_Barrier_3m"], demo_col, (-3.8, -10.2, 0.0), 14.0, "Roadblock_J1")
    clone_hierarchy(env_prefabs["COV_Jersey_Barrier_3m"], demo_col, (-0.4, -10.8, 0.0), -18.0, "Roadblock_J2")
    clone_hierarchy(env_prefabs["COV_Czech_Hedgehog"], demo_col, (-8.2, -10.8, 0.0), 48.0, "AT_Hedgehog_2")

    # 6. Combined-Arms Vehicles
    mbt_inst = clone_hierarchy(veh_prefabs["VEH_MBT_AbramsX"], demo_col, (6.2, -12.2, 0.0), 18.0, "Demo_MBT")
    for ch in mbt_inst.children:
        if "Turret" in ch.name:
            ch.rotation_euler = (0.0, 0.0, math.radians(16.0))
            for g_ch in ch.children:
                if "Cannon" in g_ch.name:
                    g_ch.rotation_euler = (math.radians(5.5), 0.0, 0.0)

    heli_inst = clone_hierarchy(
        veh_prefabs["VEH_Heli_LittleBird_AH6"], demo_col, (-7.8, -1.8, 8.2), -42.0, "Demo_Heli"
    )
    heli_inst.rotation_euler = (math.radians(-11.0), math.radians(14.0), math.radians(-42.0))

    latv_inst = clone_hierarchy(veh_prefabs["VEH_Buggy_LATV4"], demo_col, (-12.2, -5.2, 0.0), -35.0, "Demo_LATV4")
    for ch in latv_inst.children:
        if "RoofTurret" in ch.name:
            ch.rotation_euler = (0.0, 0.0, math.radians(-22.0))

    c4_inst = clone_hierarchy(wpn_prefabs["GAD_C4_BreachPack"], demo_col, (-3.80, -4.16, 1.35), 0.0, "Planted_C4")
    c4_inst.rotation_euler = (math.radians(90.0), 0.0, 0.0)

    # 7. Deployed NATO & Pax Armata Squad Soldiers in Combat!
    # NATO Squad Leader behind Conquest Flagpole sandbags aiming at building breach
    _equip_posed_soldier(
        chr_prefabs["CHR_Soldier_NATO_Assault"],
        wpn_prefabs["WPN_AssaultRifle_M5A3"],
        demo_col,
        (-6.2, -7.5, 0.0),
        -48.0,
        crouch=True,
        prefix="Squad_NATO_1",
    )
    # NATO Assault advancing behind Jersey Barrier
    _equip_posed_soldier(
        chr_prefabs["CHR_Soldier_NATO_Assault"],
        wpn_prefabs["WPN_AssaultRifle_M5A3"],
        demo_col,
        (-1.2, -9.8, 0.0),
        -18.0,
        crouch=False,
        prefix="Squad_NATO_2",
    )
    # Pax Armata Engineer on 2nd Floor aiming RPG-7V2 out the breached facade toward the AbramsX Tank!
    _equip_posed_soldier(
        chr_prefabs["CHR_Soldier_PAX_OpFor"],
        wpn_prefabs["WPN_Launcher_RPG7V2"],
        demo_col,
        (-2.2, -3.3, 3.60),
        -152.0,
        crouch=False,
        prefix="Squad_PAX_RPG",
    )
    # Pax Armata Recon Sniper on Rooftop Parapet aiming M2010 Sniper Rifle!
    _equip_posed_soldier(
        chr_prefabs["CHR_Soldier_PAX_OpFor"],
        wpn_prefabs["WPN_Sniper_M2010"],
        demo_col,
        (-1.9, -3.2, 7.20),
        -165.0,
        crouch=True,
        prefix="Squad_PAX_Sniper",
    )

    # 8. Live 1st-Person Gameplay Viewmodel Preview Rig (Positioned at SE Infantry Approach!)
    # Placed at (10.5, -15.5, 1.56) aiming toward Outpost Alpha + Tank + Little Bird Heli!
    fps_yaw_deg = 28.0
    clone_hierarchy(chr_prefabs["CHR_FPS_Arms_Rig"], demo_col, (10.5, -15.5, 1.56), fps_yaw_deg, "Live_FPS_Arms")
    clone_hierarchy(wpn_prefabs["WPN_AssaultRifle_M5A3"], demo_col, (10.5, -15.5, 1.56), fps_yaw_deg, "Live_FPS_M5A3")


def _make_or_update_camera(
    name: str,
    col: bpy.types.Collection,
    loc: tuple[float, float, float],
    look_at: tuple[float, float, float],
    lens: float = 32.0,
    clip_start: float = 0.05,
) -> bpy.types.Object:
    if name in bpy.data.objects and bpy.data.objects[name].type == "CAMERA":
        cam = bpy.data.objects[name]
    else:
        cam_data = bpy.data.cameras.new(name)
        cam = bpy.data.objects.new(name, cam_data)
        col.objects.link(cam)
    cam.data.lens = lens
    cam.data.clip_start = clip_start
    cam.data.clip_end = 500.0
    cam.location = loc
    direction = Vector(look_at) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return cam


def setup_lighting_cameras_and_viewport() -> None:
    env_col = ensure_collection("03_BF6_Lighting_Cam")

    if "Light" in bpy.data.objects:
        sun_obj = bpy.data.objects["Light"]
    else:
        sun_data = bpy.data.lights.new("BF6_Sun", type="SUN")
        sun_obj = bpy.data.objects.new("Light", sun_data)
        env_col.objects.link(sun_obj)

    sun_obj.data.type = "SUN"
    sun_obj.data.energy = 3.9
    sun_obj.data.color = (1.0, 0.96, 0.89)
    sun_obj.location = (12.0, -16.0, 22.0)
    sun_obj.rotation_euler = (math.radians(48.0), math.radians(18.0), math.radians(32.0))

    fill_data = bpy.data.lights.new("BF6_SkyFill", type="SUN")
    fill_data.energy = 1.25
    fill_data.color = (0.74, 0.85, 1.0)
    if hasattr(fill_data, "use_shadow"):
        fill_data.use_shadow = False
    fill_obj = bpy.data.objects.new("BF6_SkyFill", fill_data)
    fill_obj.location = (-14.0, 12.0, 18.0)
    fill_obj.rotation_euler = (math.radians(55.0), 0.0, math.radians(-135.0))
    env_col.objects.link(fill_obj)

    world = bpy.context.scene.world or bpy.data.worlds.new("BF6_World")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = next((n for n in world.node_tree.nodes if n.bl_idname == "ShaderNodeBackground"), None)
    if bg:
        bg.inputs[0].default_value = (0.18, 0.23, 0.29, 1.0)
        bg.inputs[1].default_value = 0.95

    # 1. Main Combined-Arms Outpost Alpha Camera
    main_cam = _make_or_update_camera("Camera", env_col, (16.2, -24.5, 11.2), (-0.8, -3.5, 3.6), lens=28.0)
    # 2. Environment Catalog Camera
    _make_or_update_camera("Camera_Catalog", env_col, (47.0, -26.5, 18.0), (47.0, 0.0, 1.2), lens=24.0)
    # 3. Combat Vehicles Motor Pool Camera
    _make_or_update_camera("Camera_Vehicles", env_col, (46.8, 10.2, 7.2), (46.8, 29.8, 1.4), lens=23.0)
    # 4. Close-Up Weapons & Demolition Armory Table Camera
    _make_or_update_camera("Camera_Weapons", env_col, (47.2, 16.0, 2.25), (47.2, 20.20, 0.98), lens=25.0)
    # 5. Squad Characters & Rigged Soldiers Showcase Camera
    _make_or_update_camera("Camera_Characters", env_col, (47.0, 43.6, 1.85), (47.0, 51.8, 0.98), lens=25.0)

    # 6. First-Person Hipfire / Tactical Ready Gameplay POV Camera!
    rad = math.radians(28.0)
    fwd = Vector((-math.sin(rad), math.cos(rad), 0.0))
    right = Vector((math.cos(rad), math.sin(rad), 0.0))
    eye_pos = Vector((10.5, -15.5, 1.56)) - fwd * 0.30 - right * 0.11 + Vector((0.0, 0.0, 0.125))
    aim_tgt = eye_pos + fwd * 22.0 + Vector((0.0, 0.0, 1.55))
    _make_or_update_camera("Camera_FPS_POV", env_col, tuple(eye_pos), tuple(aim_tgt), lens=20.0, clip_start=0.02)

    bpy.context.scene.camera = main_cam

    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                for space in area.spaces:
                    if space.type == "VIEW_3D":
                        space.shading.type = "MATERIAL"
                        if space.region_3d:
                            space.region_3d.view_perspective = "CAMERA"


def run_build() -> dict:
    cleanup_startup_and_previous()

    mats: dict[str, bpy.types.Material] = {}
    mats.update(pbr_textures.create_all_materials())
    mats.update(combat_materials.create_combat_materials())

    env_col = ensure_collection("01_BF6_Env_Catalog")
    demo_col = ensure_collection("02_BF6_Outpost_Alpha_Demo")
    wv_col = ensure_collection("04_BF6_Weapons_Vehicles_Catalog")
    chr_col = ensure_collection("05_BF6_Characters_Catalog")

    env_prefabs: dict[str, bpy.types.Object] = {}
    env_prefabs.update(modular_buildings.build_all_modular_buildings(env_col, mats))
    env_prefabs.update(tactical_cover.build_all_tactical_cover(env_col, mats))

    wpn_prefabs = combat_weapons.build_all_combat_weapons(wv_col, mats)
    veh_prefabs = combat_vehicles.build_all_combat_vehicles(wv_col, mats)
    chr_prefabs = combat_characters.build_all_combat_characters(chr_col, mats)

    # Export all 29 individual prefabs (18 env + 5 weapons + 3 vehicles + 3 skinned character rigs)
    manifest = export_categorized_prefabs(env_prefabs, wpn_prefabs, veh_prefabs, chr_prefabs)

    # Arrange Catalog Display Pads
    layout_env_catalog(env_col, env_prefabs, mats)
    layout_combat_catalog(wv_col, wpn_prefabs, veh_prefabs, mats)
    layout_character_catalog(chr_col, chr_prefabs, wpn_prefabs, mats)

    # Build Combined-Arms Outpost Alpha Battle Scene at World Origin (0,0,0)
    build_outpost_showcase(demo_col, env_prefabs, wpn_prefabs, veh_prefabs, chr_prefabs, mats)

    setup_lighting_cameras_and_viewport()

    os.makedirs(os.path.dirname(BLEND_SAVE_PATH), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_SAVE_PATH)

    return {
        "materials_count": len(mats),
        "glb_counts": {k: len(v) for k, v in manifest.items()},
        "chr_prefabs": list(chr_prefabs.keys()),
        "total_scene_objects": len(bpy.data.objects),
    }
