"""
Battlefield 6 Infantry Weapons & Demolition Gadgets Kit (1:1 Metric Scale).
Convention:
  +Y = Muzzle Forward (maps to -Z Forward in Three.js with export_yup=True!)
  +X = Right side (Ejection port / Bolt handle)
  +Z = Top Rail / Up
  Origin (0, 0, 0) = Primary grip / receiver balance pivot.
"""

import math
import bpy
import bmesh
from mathutils import Vector

from mesh_utils import (
    add_box_to_bm,
    add_cylinder_to_bm,
    create_empty_root,
    finalize_bmesh_object,
)


def _create_socket(name: str, parent: bpy.types.Object, collection: bpy.types.Collection, loc: tuple[float, float, float]) -> bpy.types.Object:
    sock = bpy.data.objects.new(name, None)
    sock.empty_display_type = "ARROWS"
    sock.empty_display_size = 0.05
    sock.location = loc
    sock.parent = parent
    sock["socket_type"] = name.split("_")[1].lower() if "_" in name else " attachment"
    collection.objects.link(sock)
    return sock


def _add_picatinny_rail(
    bm: bmesh.types.BMesh,
    y_start: float,
    y_end: float,
    z_base: float,
    mat_index: int = 0,
) -> None:
    """Add a 21mm MIL-STD-1913 Picatinny rail spine + cross teeth along Y."""
    length = y_end - y_start
    if length <= 0.01:
        return
    yc = 0.5 * (y_start + y_end)
    add_box_to_bm(bm, (0.0, yc, z_base + 0.003), (0.021, length, 0.006), mat_index=mat_index)
    n_teeth = max(2, int(length / 0.010))
    step = length / n_teeth
    for i in range(n_teeth):
        ty = y_start + (i + 0.5) * step
        add_box_to_bm(bm, (0.0, ty, z_base + 0.0075), (0.0215, step * 0.52, 0.0035), mat_index=mat_index)


def build_assault_rifle_m5a3(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """
    Modern Modular Tactical Carbine (MCX Spear / M5A3 inspired, ~0.83m length):
      - Separated Receiver+Handguard+Stock, Detachable curved FDE PMAG, Reciprocating BoltCarrier,
        Pullable ChargingHandle, Detachable Holographic Sight (with glowing reticle), and Muzzle/Eject/ADS sockets.
    """
    root = create_empty_root(
        "WPN_AssaultRifle_M5A3",
        collection,
        extras={
            "asset_category": "weapon_primary",
            "weapon_class": "assault_rifle",
            "rpm": 780,
            "mag_capacity": 30,
        },
    )
    # Material palette: 0=gunmetal, 1=polymer_fde, 2=polymer_black, 3=barrel_steel, 4=optic_glass, 5=led_red
    w_mats = [
        mats["gunmetal"],
        mats["polymer_fde"],
        mats["polymer_black"],
        mats["barrel_steel"],
        mats["optic_glass"],
        mats["led_red"],
    ]

    # 1. Main Receiver, Handguard, Barrel, Grip & Buttstock
    bm = bmesh.new()
    # Upper receiver (FDE anodized/cerakote top) & Lower receiver (Gunmetal/FDE two-tone)
    add_box_to_bm(bm, (0.0, 0.015, 0.042), (0.038, 0.21, 0.042), mat_index=1)
    add_box_to_bm(bm, (0.0, 0.020, 0.008), (0.036, 0.19, 0.034), mat_index=0)
    # Flared magazine well
    add_box_to_bm(bm, (0.0, 0.088, -0.014), (0.039, 0.076, 0.036), mat_index=0, rot_euler=(0.08, 0.0, 0.0))
    # Trigger guard & curved trigger
    add_box_to_bm(bm, (0.0, 0.018, -0.022), (0.014, 0.052, 0.005), mat_index=0)
    add_box_to_bm(bm, (0.0, 0.022, -0.010), (0.006, 0.008, 0.020), mat_index=3, rot_euler=(0.35, 0.0, 0.0))

    # Ergonomic angled FDE Pistol Grip (tilted back ~17 deg)
    add_box_to_bm(bm, (0.0, -0.032, -0.056), (0.031, 0.044, 0.105), mat_index=1, rot_euler=(-0.30, 0.0, 0.0))
    add_box_to_bm(bm, (0.0, -0.048, -0.106), (0.033, 0.048, 0.012), mat_index=2, rot_euler=(-0.30, 0.0, 0.0))

    # Buffer tube & Collapsible FDE Tactical SOPMOD Buttstock (-Y)
    add_cylinder_to_bm(bm, (0.0, -0.09, 0.038), (0.0, -0.32, 0.038), radius=0.015, segments=12, mat_index=0)
    add_box_to_bm(bm, (0.0, -0.255, 0.040), (0.044, 0.155, 0.046), mat_index=1)
    add_box_to_bm(bm, (0.0, -0.275, -0.005), (0.026, 0.115, 0.058), mat_index=1, rot_euler=(0.24, 0.0, 0.0))
    # Rubberized black buttpad
    add_box_to_bm(bm, (0.0, -0.336, 0.016), (0.045, 0.016, 0.118), mat_index=2)

    # Free-float M-LOK Tactical Handguard (Y: 0.12 -> 0.37)
    add_box_to_bm(bm, (0.0, 0.245, 0.040), (0.040, 0.25, 0.048), mat_index=1)
    # Side cooling M-LOK slot recesses (dark gunmetal core contrast)
    add_box_to_bm(bm, (0.0, 0.245, 0.040), (0.0415, 0.21, 0.014), mat_index=2)

    # Full-length continuous Top Picatinny Rail (Y: -0.08 -> +0.365)
    _add_picatinny_rail(bm, -0.08, 0.365, 0.063, mat_index=0)

    # Barrel, Gas Block & 3-Prong Flash Hider (+Y)
    add_cylinder_to_bm(bm, (0.0, 0.12, 0.040), (0.0, 0.455, 0.040), radius=0.0095, segments=12, mat_index=3)
    add_box_to_bm(bm, (0.0, 0.382, 0.046), (0.020, 0.028, 0.028), mat_index=3)  # Gas block
    add_cylinder_to_bm(bm, (0.0, 0.455, 0.040), (0.0, 0.495, 0.040), radius=0.0125, segments=12, mat_index=0)

    # Underbarrel Stubby Tactical Foregrip
    add_box_to_bm(bm, (0.0, 0.255, -0.018), (0.028, 0.036, 0.072), mat_index=2, rot_euler=(-0.10, 0.0, 0.0))

    # Front Rail Tactical Laser Box (PEQ-15 style in FDE)
    add_box_to_bm(bm, (0.0, 0.315, 0.080), (0.052, 0.078, 0.022), mat_index=1)
    add_cylinder_to_bm(bm, (0.016, 0.354, 0.080), (0.016, 0.362, 0.080), radius=0.005, segments=8, mat_index=5)

    finalize_bmesh_object(
        "WPN_M5A3_Body",
        bm,
        w_mats,
        collection,
        parent=root,
        uv_scale=2.5,
        bevel_width=0.0012,
    )

    # 2. Animatable Curved 30-Round Polymer Magazine (Pivot at Magwell catch: 0, 0.088, -0.015)
    bm_mag = bmesh.new()
    n_seg = 5
    for i in range(n_seg):
        t = i / (n_seg - 1)
        mz = -0.020 - i * 0.032
        my = 0.004 + (t * t) * 0.028
        tilt = 0.08 + t * 0.22
        add_box_to_bm(bm_mag, (0.0, my, mz), (0.025, 0.064, 0.036), mat_index=1, rot_euler=(tilt, 0.0, 0.0))
    # Mag floorplate
    add_box_to_bm(bm_mag, (0.0, 0.036, -0.155), (0.028, 0.070, 0.010), mat_index=2, rot_euler=(0.30, 0.0, 0.0))
    # Ammo window strip
    add_box_to_bm(bm_mag, (0.0, 0.014, -0.078), (0.0265, 0.016, 0.065), mat_index=4, rot_euler=(0.18, 0.0, 0.0))

    finalize_bmesh_object(
        "WPN_M5A3_Magazine",
        bm_mag,
        w_mats,
        collection,
        parent=root,
        location=(0.0, 0.088, -0.015),
        uv_scale=3.0,
        bevel_width=0.001,
        extras={"animatable_part": "magazine"},
    )

    # 3. Animatable Bolt Carrier (Ejection Port on +X side)
    bm_bolt = bmesh.new()
    add_box_to_bm(bm_bolt, (0.0, 0.0, 0.0), (0.006, 0.068, 0.016), mat_index=3)
    finalize_bmesh_object(
        "WPN_M5A3_BoltCarrier",
        bm_bolt,
        w_mats,
        collection,
        parent=root,
        location=(0.017, 0.045, 0.042),
        uv_scale=4.0,
        extras={"animatable_part": "bolt_carrier", "recoil_travel_y": -0.062},
    )

    # 4. Animatable Ambidextrous Charging Handle
    bm_ch = bmesh.new()
    add_box_to_bm(bm_ch, (0.0, -0.012, 0.0), (0.052, 0.016, 0.010), mat_index=0)
    add_box_to_bm(bm_ch, (0.0, 0.035, 0.0), (0.012, 0.095, 0.008), mat_index=0)
    finalize_bmesh_object(
        "WPN_M5A3_ChargingHandle",
        bm_ch,
        w_mats,
        collection,
        parent=root,
        location=(0.0, -0.075, 0.056),
        uv_scale=4.0,
        extras={"animatable_part": "charging_handle"},
    )

    # 5. Detachable Holographic Weapon Sight (on Top Rail at Z=0.070)
    bm_opt = bmesh.new()
    # Base clamp & battery housing
    add_box_to_bm(bm_opt, (0.0, 0.005, 0.010), (0.046, 0.092, 0.018), mat_index=0)
    # Protective aluminum hood pillars & roof
    add_box_to_bm(bm_opt, (-0.022, -0.005, 0.036), (0.006, 0.062, 0.038), mat_index=0)
    add_box_to_bm(bm_opt, (0.022, -0.005, 0.036), (0.006, 0.062, 0.038), mat_index=0)
    add_box_to_bm(bm_opt, (0.0, -0.005, 0.056), (0.050, 0.062, 0.006), mat_index=0)
    # Reflective holographic glass window & glowing red center dot reticle
    add_box_to_bm(bm_opt, (0.0, -0.005, 0.036), (0.036, 0.003, 0.030), mat_index=4)
    add_box_to_bm(bm_opt, (0.0, -0.008, 0.036), (0.003, 0.002, 0.003), mat_index=5)

    finalize_bmesh_object(
        "WPN_M5A3_OpticHolo",
        bm_opt,
        w_mats,
        collection,
        parent=root,
        location=(0.0, 0.015, 0.070),
        uv_scale=3.5,
        bevel_width=0.0008,
        extras={"attachment_slot": "top_optic"},
    )

    _create_socket("Socket_Muzzle", root, collection, (0.0, 0.498, 0.040))
    _create_socket("Socket_Eject", root, collection, (0.024, 0.045, 0.042))
    _create_socket("Socket_ADS", root, collection, (0.0, -0.15, 0.106))
    return root


def build_launcher_rpg7v2(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """
    Modernized Anti-Tank / Wall-Breaching Rocket Launcher (RPG-7V2 Tactical):
      - Launcher_Tube with flared Venturi cone, FDE polymer heat shroud, dual pistol grips & side reflex sight
      - Separate Rocket_PG7 shaped-charge warhead child for instant fire/reload toggle in Three.js!
    """
    root = create_empty_root(
        "WPN_Launcher_RPG7V2",
        collection,
        extras={
            "asset_category": "weapon_gadget",
            "weapon_class": "rocket_launcher",
            "blast_damage": 500,
            "destroys_walls": True,
        },
    )
    r_mats = [
        mats["barrel_steel"],
        mats["polymer_fde"],
        mats["polymer_black"],
        mats["ordnance_olive"],
        mats["gunmetal"],
        mats["optic_glass"],
    ]

    bm = bmesh.new()
    # Main steel 40mm launch tube (Y: -0.38 -> +0.44)
    add_cylinder_to_bm(bm, (0.0, -0.38, 0.0), (0.0, 0.44, 0.0), radius=0.024, segments=16, mat_index=0)
    # Expansion chamber bulge + FDE thermal shroud (Y: -0.26 -> +0.06)
    add_cylinder_to_bm(bm, (0.0, -0.26, 0.0), (0.0, 0.06, 0.0), radius=0.033, segments=16, mat_index=1)
    # Steel clamping rings
    for cy in (-0.25, -0.10, 0.05):
        add_cylinder_to_bm(bm, (0.0, cy - 0.008, 0.0), (0.0, cy + 0.008, 0.0), radius=0.035, segments=16, mat_index=4)

    # Flared rear Venturi blast cone (Y: -0.38 -> -0.52)
    ret_cone = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=16,
        radius1=0.048,
        radius2=0.025,
        depth=0.14,
    )
    for v in ret_cone["verts"]:
        # Rotate cone from Z-axis to +Y axis and place at Y = -0.45
        y_new = v.co.z - 0.45
        z_new = -v.co.y
        v.co.y, v.co.z = y_new, z_new
    vset = set(ret_cone["verts"])
    for f in bm.faces:
        if all(v in vset for v in f.verts):
            f.material_index = 0

    # Front muzzle collar
    add_cylinder_to_bm(bm, (0.0, 0.42, 0.0), (0.0, 0.445, 0.0), radius=0.029, segments=16, mat_index=4)

    # Front Trigger Pistol Grip (Y = +0.16) & Rear Support Grip (Y = -0.06)
    add_box_to_bm(bm, (0.0, 0.16, -0.068), (0.028, 0.040, 0.105), mat_index=2, rot_euler=(-0.22, 0.0, 0.0))
    add_box_to_bm(bm, (0.0, 0.20, -0.036), (0.012, 0.045, 0.006), mat_index=4)  # Trigger guard
    add_box_to_bm(bm, (0.0, -0.06, -0.068), (0.028, 0.038, 0.098), mat_index=2, rot_euler=(-0.15, 0.0, 0.0))

    # Front & Rear Folding Iron Sight Posts + Side Tactical Optic Mount
    add_box_to_bm(bm, (0.0, 0.39, 0.048), (0.018, 0.018, 0.052), mat_index=4)
    add_box_to_bm(bm, (-0.036, 0.08, 0.032), (0.018, 0.095, 0.045), mat_index=4)
    add_box_to_bm(bm, (-0.042, 0.08, 0.068), (0.034, 0.056, 0.032), mat_index=4)
    add_box_to_bm(bm, (-0.042, 0.08, 0.072), (0.026, 0.004, 0.022), mat_index=5)

    finalize_bmesh_object(
        "WPN_RPG7_Tube",
        bm,
        r_mats,
        collection,
        parent=root,
        uv_scale=2.0,
        bevel_width=0.001,
    )

    # Separate Detachable PG-7VL Shaped-Charge Warhead (Child at (0, 0.44, 0))
    bm_rkt = bmesh.new()
    # Profile along local Y from -0.06 (inside barrel) to +0.34 (nose fuse tip)
    profile_yr = [
        (-0.08, 0.019),
        (0.00, 0.021),
        (0.06, 0.046),
        (0.14, 0.046),
        (0.29, 0.014),
        (0.34, 0.011),
        (0.35, 0.0001),
    ]
    n_seg = 16
    rings = []
    for py, pr in profile_yr:
        ring = []
        for s in range(n_seg):
            ang = (s / n_seg) * 2.0 * math.pi
            ring.append(bm_rkt.verts.new((math.cos(ang) * pr, py, math.sin(ang) * pr)))
        rings.append(ring)

    for r_i in range(len(rings) - 1):
        r0, r1 = rings[r_i], rings[r_i + 1]
        m_idx = 0 if r_i >= 4 else 3  # Steel fuse tip, ordnance olive warhead body
        for s in range(n_seg):
            sn = (s + 1) % n_seg
            f = bm_rkt.faces.new((r0[s], r0[sn], r1[sn], r1[s]))
            f.material_index = m_idx
    bm_rkt.faces.new(rings[0]).material_index = 0

    finalize_bmesh_object(
        "WPN_RPG7_Warhead",
        bm_rkt,
        r_mats,
        collection,
        parent=root,
        location=(0.0, 0.44, 0.0),
        uv_scale=2.2,
        shade_smooth=True,
        extras={"animatable_part": "warhead_projectile"},
    )

    _create_socket("Socket_Muzzle", root, collection, (0.0, 0.79, 0.0))
    _create_socket("Socket_Backblast", root, collection, (0.0, -0.53, 0.0))
    _create_socket("Socket_ADS", root, collection, (-0.042, -0.08, 0.072))
    return root


def build_sniper_m2010(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """
    Modern Bolt-Action Tactical Chassis Sniper Rifle (~1.16m):
      - FDE Chassis + Folding Skeleton Stock + Folded Bipod + Fluted Barrel + 3-Chamber Brake
      - Separate Bolt_Assembly, Detachable Magazine, and 8x Variable Scope!
    """
    root = create_empty_root(
        "WPN_Sniper_M2010",
        collection,
        extras={
            "asset_category": "weapon_primary",
            "weapon_class": "sniper_rifle",
            "rpm": 48,
            "mag_capacity": 10,
        },
    )
    s_mats = [
        mats["polymer_fde"],
        mats["gunmetal"],
        mats["barrel_steel"],
        mats["polymer_black"],
        mats["optic_glass"],
    ]

    bm = bmesh.new()
    # Machined FDE chassis center block & slotted long forend
    add_box_to_bm(bm, (0.0, 0.02, 0.022), (0.040, 0.24, 0.046), mat_index=0)
    add_box_to_bm(bm, (0.0, 0.28, 0.026), (0.042, 0.30, 0.042), mat_index=0)
    _add_picatinny_rail(bm, -0.06, 0.42, 0.047, mat_index=1)

    # Pistol grip
    add_box_to_bm(bm, (0.0, -0.045, -0.048), (0.030, 0.042, 0.10), mat_index=3, rot_euler=(-0.26, 0.0, 0.0))

    # Skeletonized Tactical Precision Stock (-Y: -0.10 -> -0.38) + Cheek Riser
    add_box_to_bm(bm, (0.0, -0.24, 0.028), (0.028, 0.28, 0.022), mat_index=0)
    add_box_to_bm(bm, (0.0, -0.24, -0.032), (0.022, 0.26, 0.018), mat_index=0, rot_euler=(0.12, 0.0, 0.0))
    add_box_to_bm(bm, (0.0, -0.23, 0.052), (0.034, 0.13, 0.024), mat_index=3)  # Black cheekpiece
    add_box_to_bm(bm, (0.0, -0.385, 0.002), (0.038, 0.020, 0.125), mat_index=3)  # Buttpad

    # Long Free-Float Heavy Barrel (Y: 0.14 -> 0.72) + Tank-Style 3-Port Muzzle Brake
    add_cylinder_to_bm(bm, (0.0, 0.14, 0.032), (0.0, 0.71, 0.032), radius=0.0115, segments=12, mat_index=2)
    add_box_to_bm(bm, (0.0, 0.735, 0.032), (0.032, 0.062, 0.024), mat_index=1)

    # Folded Front Bipod Legs under forend (Y: 0.41 -> 0.59)
    for sx in (-0.026, 0.026):
        add_cylinder_to_bm(bm, (sx, 0.41, -0.002), (sx, 0.58, -0.002), radius=0.008, segments=8, mat_index=1)
        add_cylinder_to_bm(bm, (sx, 0.58, -0.002), (sx, 0.595, -0.002), radius=0.013, segments=8, mat_index=3)

    finalize_bmesh_object("WPN_M2010_Chassis", bm, s_mats, collection, parent=root, uv_scale=2.2, bevel_width=0.001)

    # Animatable Bolt Handle
    bm_bolt = bmesh.new()
    add_cylinder_to_bm(bm_bolt, (0.0, -0.06, 0.0), (0.0, 0.06, 0.0), radius=0.009, segments=10, mat_index=2)
    add_cylinder_to_bm(bm_bolt, (0.0, -0.04, 0.0), (0.042, -0.048, -0.014), radius=0.005, segments=8, mat_index=1)
    add_cylinder_to_bm(bm_bolt, (0.038, -0.048, -0.014), (0.052, -0.052, -0.020), radius=0.011, segments=10, mat_index=3)
    finalize_bmesh_object(
        "WPN_M2010_Bolt",
        bm_bolt,
        s_mats,
        collection,
        parent=root,
        location=(0.0, -0.015, 0.032),
        extras={"animatable_part": "bolt_handle"},
    )

    # Detachable 10-Round .300 Win Mag Box Magazine
    bm_mag = bmesh.new()
    add_box_to_bm(bm_mag, (0.0, 0.0, -0.042), (0.026, 0.086, 0.088), mat_index=1, rot_euler=(0.04, 0.0, 0.0))
    add_box_to_bm(bm_mag, (0.0, 0.0, -0.088), (0.030, 0.092, 0.010), mat_index=3)
    finalize_bmesh_object(
        "WPN_M2010_Magazine",
        bm_mag,
        s_mats,
        collection,
        parent=root,
        location=(0.0, 0.075, -0.005),
        extras={"animatable_part": "magazine"},
    )

    # High-Power 8x Variable Sniper Scope
    bm_scp = bmesh.new()
    # Dual scope rings
    for ry in (-0.055, 0.065):
        add_box_to_bm(bm_scp, (0.0, ry, -0.012), (0.036, 0.022, 0.026), mat_index=1)
    # Main 34mm scope tube + Rear ocular bell + Front 50mm objective sunshade
    add_cylinder_to_bm(bm_scp, (0.0, -0.13, 0.012), (0.0, 0.13, 0.012), radius=0.017, segments=16, mat_index=1)
    add_cylinder_to_bm(bm_scp, (0.0, -0.175, 0.012), (0.0, -0.115, 0.012), radius=0.022, segments=16, mat_index=1)
    add_cylinder_to_bm(bm_scp, (0.0, 0.125, 0.012), (0.0, 0.225, 0.012), radius=0.027, segments=16, mat_index=1)
    # Coated front/rear lenses
    add_cylinder_to_bm(bm_scp, (0.0, 0.223, 0.012), (0.0, 0.226, 0.012), radius=0.024, segments=16, mat_index=4)
    add_cylinder_to_bm(bm_scp, (0.0, -0.176, 0.012), (0.0, -0.173, 0.012), radius=0.019, segments=16, mat_index=4)
    # Elevation & Windage Turret Knobs
    add_cylinder_to_bm(bm_scp, (0.0, 0.005, 0.028), (0.0, 0.005, 0.048), radius=0.015, segments=12, mat_index=1)
    add_cylinder_to_bm(bm_scp, (0.016, 0.005, 0.012), (0.036, 0.005, 0.012), radius=0.014, segments=12, mat_index=1)

    finalize_bmesh_object(
        "WPN_M2010_Scope8x",
        bm_scp,
        s_mats,
        collection,
        parent=root,
        location=(0.0, 0.03, 0.072),
        bevel_width=0.0008,
        extras={"attachment_slot": "top_optic"},
    )

    _create_socket("Socket_Muzzle", root, collection, (0.0, 0.768, 0.032))
    _create_socket("Socket_ADS", root, collection, (0.0, -0.22, 0.084))
    return root


def build_c4_breach_pack(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """Strapped 3-brick M112 C4 Demolition Charge with radio receiver & red blinking armed LED."""
    root = create_empty_root(
        "GAD_C4_BreachPack",
        collection,
        extras={
            "asset_category": "weapon_explosive",
            "throwable": True,
            "stickable": True,
            "blast_radius": 5.5,
            "destroys_walls": True,
        },
    )
    c_mats = [
        mats["polymer_fde"],
        mats["polymer_black"],
        mats["gunmetal"],
        mats["led_red"],
    ]
    bm = bmesh.new()
    # 3 M112 explosive bricks side-by-side (total ~0.26m x 0.17m x 0.08m)
    for ix in (-1, 0, 1):
        add_box_to_bm(bm, (ix * 0.056, 0.0, 0.036), (0.052, 0.24, 0.068), mat_index=0)
    # 2 black nylon securing straps wrapping around bundle
    for sy in (-0.065, 0.065):
        add_box_to_bm(bm, (0.0, sy, 0.036), (0.168, 0.024, 0.072), mat_index=1)
    # Top radio receiver / blasting cap module + antenna + glowing red LED
    add_box_to_bm(bm, (0.0, 0.01, 0.082), (0.068, 0.092, 0.026), mat_index=2)
    add_cylinder_to_bm(bm, (-0.022, 0.04, 0.095), (-0.022, 0.04, 0.165), radius=0.003, segments=6, mat_index=1)
    add_cylinder_to_bm(bm, (0.018, -0.015, 0.095), (0.018, -0.015, 0.102), radius=0.007, segments=8, mat_index=3)

    finalize_bmesh_object(
        "GAD_C4_BreachPack_Mesh",
        bm,
        c_mats,
        collection,
        parent=root,
        uv_scale=3.0,
        bevel_width=0.002,
    )
    return root


def build_c4_detonator(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """Handheld M57 Tactical C4 Remote Clacker with separate hinged Trigger_Bail."""
    root = create_empty_root(
        "GAD_C4_Detonator",
        collection,
        extras={"asset_category": "weapon_explosive_remote"},
    )
    d_mats = [mats["ordnance_olive"], mats["polymer_black"], mats["gunmetal"], mats["led_red"]]
    bm = bmesh.new()
    add_box_to_bm(bm, (0.0, 0.0, 0.065), (0.042, 0.062, 0.125), mat_index=0)
    add_box_to_bm(bm, (0.0, 0.0, 0.132), (0.044, 0.064, 0.016), mat_index=1)
    add_cylinder_to_bm(bm, (-0.012, 0.015, 0.140), (-0.012, 0.015, 0.225), radius=0.0035, segments=6, mat_index=1)
    add_cylinder_to_bm(bm, (0.010, -0.012, 0.140), (0.010, -0.012, 0.146), radius=0.005, segments=8, mat_index=3)
    finalize_bmesh_object("GAD_C4_Detonator_Body", bm, d_mats, collection, parent=root, uv_scale=4.0, bevel_width=0.002)

    bm_lev = bmesh.new()
    add_box_to_bm(bm_lev, (0.0, 0.022, -0.042), (0.026, 0.016, 0.092), mat_index=2, rot_euler=(-0.18, 0.0, 0.0))
    finalize_bmesh_object(
        "GAD_C4_Detonator_Clacker",
        bm_lev,
        d_mats,
        collection,
        parent=root,
        location=(0.0, 0.022, 0.122),
        extras={"animatable_part": "clacker_lever"},
    )
    return root


def build_all_combat_weapons(collection: bpy.types.Collection, mats: dict) -> dict[str, bpy.types.Object]:
    return {
        "WPN_AssaultRifle_M5A3": build_assault_rifle_m5a3(collection, mats),
        "WPN_Launcher_RPG7V2": build_launcher_rpg7v2(collection, mats),
        "WPN_Sniper_M2010": build_sniper_m2010(collection, mats),
        "GAD_C4_BreachPack": build_c4_breach_pack(collection, mats),
        "GAD_C4_Detonator": build_c4_detonator(collection, mats),
    }
