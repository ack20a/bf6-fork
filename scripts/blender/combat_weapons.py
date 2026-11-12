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
    # Brass shell deflector, forward assist plunger & ejection dust cover (+X right side)
    add_box_to_bm(bm, (0.021, 0.004, 0.043), (0.009, 0.022, 0.024), mat_index=0, rot_euler=(0.0, 0.0, -0.35))
    add_cylinder_to_bm(bm, (0.018, -0.028, 0.038), (0.026, -0.048, 0.038), radius=0.0055, segments=10, mat_index=0)
    add_box_to_bm(bm, (0.0195, 0.045, 0.032), (0.003, 0.068, 0.014), mat_index=0, rot_euler=(0.0, 0.35, 0.0))
    # Ambidextrous fire-selector levers & receiver takedown pins
    for sx in (-1.0, 1.0):
        add_box_to_bm(bm, (sx * 0.0195, -0.022, 0.012), (0.004, 0.024, 0.007), mat_index=2, rot_euler=(-0.45, 0.0, 0.0))
        for py_pin in (-0.058, 0.098):
            add_cylinder_to_bm(bm, (sx * 0.017, py_pin, 0.014), (sx * 0.020, py_pin, 0.014), radius=0.0045, segments=8, mat_index=3)
    # Flared magazine well + mag release button
    add_box_to_bm(bm, (0.0, 0.088, -0.014), (0.039, 0.076, 0.036), mat_index=0, rot_euler=(0.08, 0.0, 0.0))
    add_box_to_bm(bm, (0.0205, 0.065, 0.006), (0.004, 0.018, 0.011), mat_index=2)
    # Trigger guard & curved trigger
    add_box_to_bm(bm, (0.0, 0.018, -0.022), (0.014, 0.052, 0.005), mat_index=0)
    add_box_to_bm(bm, (0.0, 0.022, -0.010), (0.006, 0.008, 0.020), mat_index=3, rot_euler=(0.35, 0.0, 0.0))

    # Ergonomic angled FDE Pistol Grip with backstrap ribs
    add_box_to_bm(bm, (0.0, -0.032, -0.056), (0.031, 0.044, 0.105), mat_index=1, rot_euler=(-0.30, 0.0, 0.0))
    add_box_to_bm(bm, (0.0, -0.048, -0.106), (0.033, 0.048, 0.012), mat_index=2, rot_euler=(-0.30, 0.0, 0.0))
    for gi in range(4):
        gz = -0.035 - gi * 0.017
        gy = -0.026 - gi * 0.005
        add_box_to_bm(bm, (0.0, gy, gz), (0.0325, 0.038, 0.005), mat_index=2, rot_euler=(-0.30, 0.0, 0.0))

    # Buffer tube, Castle Nut & Collapsible FDE Tactical SOPMOD Buttstock (-Y)
    add_cylinder_to_bm(bm, (0.0, -0.088, 0.038), (0.0, -0.106, 0.038), radius=0.019, segments=14, mat_index=0)
    add_cylinder_to_bm(bm, (0.0, -0.09, 0.038), (0.0, -0.32, 0.038), radius=0.015, segments=16, mat_index=0)
    add_box_to_bm(bm, (0.0, -0.255, 0.040), (0.044, 0.155, 0.046), mat_index=1)
    # Sloped SOPMOD cheekweld pads & stock latch lever
    for sx in (-0.018, 0.018):
        add_box_to_bm(bm, (sx, -0.250, 0.046), (0.018, 0.145, 0.026), mat_index=1, rot_euler=(0.0, sx * 12.0, 0.0))
    add_box_to_bm(bm, (0.0, -0.275, -0.005), (0.026, 0.115, 0.058), mat_index=1, rot_euler=(0.24, 0.0, 0.0))
    # Rubberized ribbed black buttpad & QD sling socket
    add_box_to_bm(bm, (0.0, -0.336, 0.016), (0.045, 0.016, 0.118), mat_index=2)
    add_cylinder_to_bm(bm, (-0.023, -0.305, 0.028), (0.023, -0.305, 0.028), radius=0.006, segments=10, mat_index=0)

    # Free-float Ventilated M-LOK Tactical Handguard (Y: 0.12 -> 0.37) + Visible Steel Gas Tube!
    add_cylinder_to_bm(bm, (0.0, 0.12, 0.052), (0.0, 0.375, 0.052), radius=0.0035, segments=8, mat_index=3)
    # Upper & lower handguard spine + 6 vertical M-LOK stanchion ribs creating realistic cooling vents
    add_box_to_bm(bm, (0.0, 0.245, 0.056), (0.036, 0.252, 0.016), mat_index=1)
    add_box_to_bm(bm, (0.0, 0.245, 0.022), (0.034, 0.252, 0.014), mat_index=1)
    for vi in range(6):
        vy = 0.132 + vi * 0.045
        add_box_to_bm(bm, (0.0, vy, 0.040), (0.041, 0.018, 0.046), mat_index=1)
    # Side M-LOK accessory rail sections
    for sx in (-0.021, 0.021):
        add_box_to_bm(bm, (sx, 0.315, 0.040), (0.005, 0.085, 0.014), mat_index=0)

    # Full-length continuous Top Picatinny Rail (Y: -0.08 -> +0.365) + Folded Front/Rear Backup Iron Sights
    _add_picatinny_rail(bm, -0.08, 0.365, 0.063, mat_index=0)
    add_box_to_bm(bm, (0.0, -0.062, 0.074), (0.028, 0.034, 0.010), mat_index=2)  # Folded rear BUIS
    add_box_to_bm(bm, (0.0, 0.352, 0.074), (0.026, 0.028, 0.010), mat_index=2)   # Folded front BUIS

    # Smooth 20-Segment Barrel, Adjustable Gas Block & 3-Prong Open Flash Hider (+Y)
    add_cylinder_to_bm(bm, (0.0, 0.12, 0.040), (0.0, 0.455, 0.040), radius=0.0095, segments=20, mat_index=3)
    add_box_to_bm(bm, (0.0, 0.382, 0.046), (0.020, 0.028, 0.028), mat_index=3)
    add_cylinder_to_bm(bm, (0.0, 0.396, 0.053), (0.0, 0.408, 0.053), radius=0.005, segments=10, mat_index=0)
    add_cylinder_to_bm(bm, (0.0, 0.452, 0.040), (0.0, 0.472, 0.040), radius=0.0125, segments=18, mat_index=0)
    # 3 Flash Hider Prongs around recessed muzzle bore
    for p_ang in (0.52, 2.62, 4.71):
        px = math.cos(p_ang) * 0.0085
        pz = 0.040 + math.sin(p_ang) * 0.0085
        add_box_to_bm(bm, (px, 0.484, pz), (0.0045, 0.026, 0.0045), mat_index=0)
    add_cylinder_to_bm(bm, (0.0, 0.470, 0.040), (0.0, 0.474, 0.040), radius=0.006, segments=12, mat_index=2)

    # Underbarrel Ribbed Stubby Tactical Foregrip
    add_box_to_bm(bm, (0.0, 0.255, 0.008), (0.032, 0.044, 0.014), mat_index=0)
    add_box_to_bm(bm, (0.0, 0.255, -0.022), (0.027, 0.035, 0.064), mat_index=2, rot_euler=(-0.10, 0.0, 0.0))

    # Front Left-Offset / Low-Profile Tactical Laser Box (PEQ-15 style in FDE, kept clear of optic sightline!)
    add_box_to_bm(bm, (0.0, 0.315, 0.078), (0.052, 0.078, 0.018), mat_index=1)
    add_cylinder_to_bm(bm, (0.016, 0.354, 0.079), (0.016, 0.362, 0.079), radius=0.005, segments=10, mat_index=5)
    add_cylinder_to_bm(bm, (-0.015, 0.354, 0.079), (-0.015, 0.360, 0.079), radius=0.006, segments=10, mat_index=4)
    add_cylinder_to_bm(bm, (0.0, 0.312, 0.088), (0.0, 0.312, 0.093), radius=0.008, segments=10, mat_index=2)

    finalize_bmesh_object(
        "WPN_M5A3_Body",
        bm,
        w_mats,
        collection,
        parent=root,
        uv_scale=2.5,
        bevel_width=0.0012,
    )

    # 2. Animatable Curved 30-Round Polymer PMAG (Waffle ribs + floorplate + translucent ammo window)
    bm_mag = bmesh.new()
    n_seg = 6
    for i in range(n_seg):
        t = i / (n_seg - 1)
        mz = -0.018 - i * 0.026
        my = 0.003 + (t * t) * 0.028
        tilt = 0.08 + t * 0.22
        add_box_to_bm(bm_mag, (0.0, my, mz), (0.0245, 0.063, 0.030), mat_index=1, rot_euler=(tilt, 0.0, 0.0))
        add_box_to_bm(bm_mag, (0.0, my, mz), (0.0265, 0.054, 0.006), mat_index=1, rot_euler=(tilt, 0.0, 0.0))
    # Mag floorplate
    add_box_to_bm(bm_mag, (0.0, 0.036, -0.155), (0.028, 0.070, 0.010), mat_index=2, rot_euler=(0.30, 0.0, 0.0))
    # Ammo window strip
    add_box_to_bm(bm_mag, (0.0, 0.014, -0.078), (0.0268, 0.016, 0.065), mat_index=4, rot_euler=(0.18, 0.0, 0.0))

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
    add_box_to_bm(bm_ch, (0.0, -0.012, 0.0), (0.054, 0.016, 0.010), mat_index=0)
    add_box_to_bm(bm_ch, (0.0, 0.035, 0.0), (0.012, 0.095, 0.008), mat_index=0)
    finalize_bmesh_object(
        "WPN_M5A3_ChargingHandle",
        bm_ch,
        w_mats,
        collection,
        parent=root,
        location=(0.0, -0.075, 0.056),
        uv_scale=4.0,
        bevel_width=0.0008,
        extras={"animatable_part": "charging_handle"},
    )

    # 5. Detachable EOTech EXPS3 Holographic Weapon Sight (on Top Rail at Z=0.070)
    bm_opt = bmesh.new()
    # Base QD clamp, throw lever & transverse CR123 battery cap
    add_box_to_bm(bm_opt, (0.0, 0.005, 0.010), (0.046, 0.092, 0.018), mat_index=0)
    add_box_to_bm(bm_opt, (-0.025, -0.005, 0.008), (0.006, 0.042, 0.011), mat_index=2)
    add_cylinder_to_bm(bm_opt, (-0.024, 0.034, 0.014), (0.026, 0.034, 0.014), radius=0.010, segments=14, mat_index=1)
    # Protective sculpted aluminum hood pillars, angled top corners & roof
    add_box_to_bm(bm_opt, (-0.022, -0.005, 0.036), (0.0055, 0.062, 0.038), mat_index=1)
    add_box_to_bm(bm_opt, (0.022, -0.005, 0.036), (0.0055, 0.062, 0.038), mat_index=1)
    add_box_to_bm(bm_opt, (0.0, -0.005, 0.056), (0.049, 0.062, 0.0055), mat_index=1)
    # Side windage/elevation dial bosses
    add_cylinder_to_bm(bm_opt, (0.022, 0.012, 0.022), (0.026, 0.012, 0.022), radius=0.005, segments=10, mat_index=0)
    add_cylinder_to_bm(bm_opt, (0.022, -0.012, 0.022), (0.026, -0.012, 0.022), radius=0.005, segments=10, mat_index=0)
    # Reflective holographic glass window & crisp glowing red center reticle dot + 4 tick marks
    add_box_to_bm(bm_opt, (0.0, -0.005, 0.036), (0.036, 0.0025, 0.030), mat_index=4)
    add_box_to_bm(bm_opt, (0.0, -0.008, 0.036), (0.0022, 0.0018, 0.0022), mat_index=5)
    for dx_r, dz_r, sw, sh in ((-0.007, 0.0, 0.003, 0.001), (0.007, 0.0, 0.003, 0.001), (0.0, 0.007, 0.001, 0.003), (0.0, -0.007, 0.001, 0.003)):
        add_box_to_bm(bm_opt, (dx_r, -0.008, 0.036 + dz_r), (sw, 0.0015, sh), mat_index=5)

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
    # Main steel 40mm launch tube (Y: -0.38 -> +0.44, smooth 24 segments)
    add_cylinder_to_bm(bm, (0.0, -0.38, 0.0), (0.0, 0.44, 0.0), radius=0.024, segments=24, mat_index=0)
    # Expansion chamber bulge + FDE ribbed thermal shroud (Y: -0.26 -> +0.06)
    add_cylinder_to_bm(bm, (0.0, -0.26, 0.0), (0.0, 0.06, 0.0), radius=0.033, segments=24, mat_index=1)
    for ry_rib in (-0.20, -0.15, -0.05, 0.00):
        add_cylinder_to_bm(bm, (0.0, ry_rib - 0.004, 0.0), (0.0, ry_rib + 0.004, 0.0), radius=0.0342, segments=24, mat_index=1)
    # Steel clamping rings + top rail bridge
    for cy in (-0.25, -0.10, 0.05):
        add_cylinder_to_bm(bm, (0.0, cy - 0.008, 0.0), (0.0, cy + 0.008, 0.0), radius=0.0355, segments=24, mat_index=4)
    _add_picatinny_rail(bm, 0.04, 0.24, 0.025, mat_index=4)

    # Flared rear Venturi blast cone (Y: -0.38 -> -0.52, smooth 24 segments) + cooling fins
    ret_cone = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=24,
        radius1=0.050,
        radius2=0.025,
        depth=0.14,
    )
    for v in ret_cone["verts"]:
        y_new = v.co.z - 0.45
        z_new = -v.co.y
        v.co.y, v.co.z = y_new, z_new
    vset = set(ret_cone["verts"])
    for f in bm.faces:
        if all(v in vset for v in f.verts):
            f.material_index = 0
    for cy_fin in (-0.33, -0.355):
        add_cylinder_to_bm(bm, (0.0, cy_fin - 0.004, 0.0), (0.0, cy_fin + 0.004, 0.0), radius=0.031, segments=20, mat_index=4)

    # Front muzzle collar + recessed dark bore
    add_cylinder_to_bm(bm, (0.0, 0.42, 0.0), (0.0, 0.445, 0.0), radius=0.029, segments=24, mat_index=4)
    add_cylinder_to_bm(bm, (0.0, 0.440, 0.0), (0.0, 0.446, 0.0), radius=0.020, segments=20, mat_index=2)

    # Front Trigger Pistol Grip (Y = +0.16) & Rear Support Grip (Y = -0.06)
    add_box_to_bm(bm, (0.0, 0.16, -0.068), (0.028, 0.040, 0.105), mat_index=2, rot_euler=(-0.22, 0.0, 0.0))
    add_box_to_bm(bm, (0.0, 0.20, -0.036), (0.012, 0.045, 0.006), mat_index=4)
    add_box_to_bm(bm, (0.0, 0.185, -0.026), (0.005, 0.009, 0.018), mat_index=0, rot_euler=(0.3, 0.0, 0.0))
    add_box_to_bm(bm, (0.0, -0.06, -0.068), (0.028, 0.038, 0.098), mat_index=2, rot_euler=(-0.15, 0.0, 0.0))

    # Front & Rear Folding Iron Sight Hoop + Side Tactical Reflex Optic Mount (open window!)
    add_box_to_bm(bm, (0.0, 0.39, 0.046), (0.022, 0.014, 0.048), mat_index=4)
    add_box_to_bm(bm, (-0.036, 0.08, 0.032), (0.018, 0.095, 0.045), mat_index=4)
    add_box_to_bm(bm, (-0.056, 0.08, 0.072), (0.005, 0.054, 0.030), mat_index=4)
    add_box_to_bm(bm, (-0.028, 0.08, 0.072), (0.005, 0.054, 0.030), mat_index=4)
    add_box_to_bm(bm, (-0.042, 0.08, 0.088), (0.033, 0.054, 0.005), mat_index=4)
    add_box_to_bm(bm, (-0.042, 0.08, 0.072), (0.024, 0.003, 0.025), mat_index=5)

    finalize_bmesh_object(
        "WPN_RPG7_Tube",
        bm,
        r_mats,
        collection,
        parent=root,
        uv_scale=2.0,
        bevel_width=0.001,
    )

    # Separate Detachable PG-7VL Shaped-Charge Warhead (Child at (0, 0.44, 0)) + 4 Stabilizer Fins
    bm_rkt = bmesh.new()
    profile_yr = [
        (-0.08, 0.019),
        (0.00, 0.021),
        (0.06, 0.046),
        (0.14, 0.046),
        (0.29, 0.014),
        (0.34, 0.011),
        (0.35, 0.0001),
    ]
    n_seg = 24
    rings = []
    for py, pr in profile_yr:
        ring = []
        for s in range(n_seg):
            ang = (s / n_seg) * 2.0 * math.pi
            ring.append(bm_rkt.verts.new((math.cos(ang) * pr, py, math.sin(ang) * pr)))
        rings.append(ring)

    for r_i in range(len(rings) - 1):
        r0, r1 = rings[r_i], rings[r_i + 1]
        m_idx = 0 if r_i >= 4 else 3
        for s in range(n_seg):
            sn = (s + 1) % n_seg
            f = bm_rkt.faces.new((r0[s], r0[sn], r1[sn], r1[s]))
            f.material_index = m_idx
    bm_rkt.faces.new(rings[0]).material_index = 0
    for f_ang in (0.0, 0.5 * math.pi, math.pi, 1.5 * math.pi):
        add_box_to_bm(
            bm_rkt,
            (math.cos(f_ang) * 0.024, 0.015, math.sin(f_ang) * 0.024),
            (0.018, 0.045, 0.003),
            mat_index=4,
            rot_euler=(0.0, -f_ang, 0.0),
        )

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
    # Machined FDE chassis center block & ventilated M-LOK long forend
    add_box_to_bm(bm, (0.0, 0.02, 0.022), (0.040, 0.24, 0.046), mat_index=0)
    add_box_to_bm(bm, (0.0, 0.28, 0.014), (0.040, 0.30, 0.020), mat_index=0)
    add_box_to_bm(bm, (0.0, 0.28, 0.041), (0.038, 0.30, 0.012), mat_index=0)
    for vi in range(5):
        add_box_to_bm(bm, (0.0, 0.16 + vi * 0.06, 0.028), (0.042, 0.022, 0.040), mat_index=0)
    _add_picatinny_rail(bm, -0.06, 0.43, 0.047, mat_index=1)

    # Pistol grip
    add_box_to_bm(bm, (0.0, -0.045, -0.048), (0.030, 0.042, 0.10), mat_index=3, rot_euler=(-0.26, 0.0, 0.0))

    # Skeletonized Tactical Precision Stock (-Y: -0.10 -> -0.38) + Cheek Riser + Adjustment Wheel + Rear Monopod
    add_box_to_bm(bm, (0.0, -0.24, 0.028), (0.028, 0.28, 0.022), mat_index=0)
    add_box_to_bm(bm, (0.0, -0.24, -0.032), (0.022, 0.26, 0.018), mat_index=0, rot_euler=(0.12, 0.0, 0.0))
    add_box_to_bm(bm, (0.0, -0.23, 0.052), (0.034, 0.13, 0.024), mat_index=3)
    add_cylinder_to_bm(bm, (-0.018, -0.23, 0.028), (0.018, -0.23, 0.028), radius=0.014, segments=14, mat_index=1)
    add_cylinder_to_bm(bm, (0.0, -0.34, -0.045), (0.0, -0.34, -0.075), radius=0.010, segments=12, mat_index=1)
    add_box_to_bm(bm, (0.0, -0.385, 0.002), (0.038, 0.020, 0.125), mat_index=3)

    # Long Free-Float Fluted Heavy Match Barrel (Y: 0.14 -> 0.71, 20 segs) + 3-Port Tank Muzzle Brake
    add_cylinder_to_bm(bm, (0.0, 0.14, 0.032), (0.0, 0.71, 0.032), radius=0.0115, segments=20, mat_index=2)
    for f_ang in (0.4, 1.2, 1.95, 2.75, 3.55, 4.35, 5.1, 5.9):
        add_box_to_bm(
            bm,
            (math.cos(f_ang) * 0.011, 0.56, 0.032 + math.sin(f_ang) * 0.011),
            (0.003, 0.24, 0.003),
            mat_index=1,
        )
    # 3-Chamber Muzzle Brake with open side ports
    add_box_to_bm(bm, (0.0, 0.738, 0.032), (0.034, 0.068, 0.006), mat_index=1)
    add_box_to_bm(bm, (0.0, 0.738, 0.042), (0.034, 0.068, 0.005), mat_index=1)
    add_box_to_bm(bm, (0.0, 0.738, 0.022), (0.034, 0.068, 0.005), mat_index=1)
    for by in (0.712, 0.732, 0.752, 0.768):
        add_box_to_bm(bm, (0.0, by, 0.032), (0.034, 0.008, 0.025), mat_index=1)

    # Folded Front Bipod Legs under forend (Y: 0.41 -> 0.59)
    for sx in (-0.026, 0.026):
        add_cylinder_to_bm(bm, (sx, 0.41, -0.002), (sx, 0.58, -0.002), radius=0.008, segments=12, mat_index=1)
        add_cylinder_to_bm(bm, (sx, 0.58, -0.002), (sx, 0.598, -0.002), radius=0.0135, segments=12, mat_index=3)

    finalize_bmesh_object("WPN_M2010_Chassis", bm, s_mats, collection, parent=root, uv_scale=2.2, bevel_width=0.001)

    # Animatable Bolt Handle
    bm_bolt = bmesh.new()
    add_cylinder_to_bm(bm_bolt, (0.0, -0.06, 0.0), (0.0, 0.06, 0.0), radius=0.009, segments=16, mat_index=2)
    add_cylinder_to_bm(bm_bolt, (0.0, -0.04, 0.0), (0.042, -0.048, -0.014), radius=0.005, segments=12, mat_index=1)
    add_cylinder_to_bm(bm_bolt, (0.038, -0.048, -0.014), (0.054, -0.052, -0.020), radius=0.0115, segments=16, mat_index=3)
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
        bevel_width=0.001,
        extras={"animatable_part": "magazine"},
    )

    # High-Power 8x Variable Sniper Scope (Smooth 24-segment optics, Parallax/Windage/Elevation Turrets + Throw Lever)
    bm_scp = bmesh.new()
    for ry in (-0.055, 0.065):
        add_box_to_bm(bm_scp, (0.0, ry, -0.012), (0.036, 0.022, 0.026), mat_index=1)
    add_cylinder_to_bm(bm_scp, (0.0, -0.13, 0.012), (0.0, 0.13, 0.012), radius=0.017, segments=24, mat_index=1)
    add_cylinder_to_bm(bm_scp, (0.0, -0.175, 0.012), (0.0, -0.115, 0.012), radius=0.0225, segments=24, mat_index=1)
    add_cylinder_to_bm(bm_scp, (0.0, -0.122, 0.012), (0.0, -0.105, 0.012), radius=0.024, segments=24, mat_index=3)
    add_box_to_bm(bm_scp, (-0.024, -0.114, 0.028), (0.018, 0.008, 0.008), mat_index=1, rot_euler=(0.0, -0.6, 0.0))
    add_cylinder_to_bm(bm_scp, (0.0, 0.125, 0.012), (0.0, 0.228, 0.012), radius=0.0275, segments=24, mat_index=1)
    # Coated front/rear lenses
    add_cylinder_to_bm(bm_scp, (0.0, 0.225, 0.012), (0.0, 0.228, 0.012), radius=0.0245, segments=24, mat_index=4)
    add_cylinder_to_bm(bm_scp, (0.0, -0.176, 0.012), (0.0, -0.173, 0.012), radius=0.0195, segments=24, mat_index=4)
    # Elevation, Windage & Side Parallax Turret Knobs
    add_cylinder_to_bm(bm_scp, (0.0, 0.005, 0.028), (0.0, 0.005, 0.050), radius=0.0155, segments=18, mat_index=3)
    add_cylinder_to_bm(bm_scp, (0.016, 0.005, 0.012), (0.038, 0.005, 0.012), radius=0.0145, segments=18, mat_index=3)
    add_cylinder_to_bm(bm_scp, (-0.016, 0.005, 0.012), (-0.036, 0.005, 0.012), radius=0.0135, segments=18, mat_index=3)

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
