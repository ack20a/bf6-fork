"""
Battlefield 6 Modern Land & Air Combat Vehicles (1:1 Metric Scale, Articulated Hierarchies).
Convention:
  +Y = Vehicle Nose / Forward (maps to -Z Forward in Three.js with export_yup=True!)
  +X = Right side
  +Z = Up (Ground contact at Z = 0.0)
"""

import math
import bpy
import bmesh
from mathutils import Vector, Matrix

from mesh_utils import (
    add_box_to_bm,
    add_cylinder_to_bm,
    create_empty_root,
    finalize_bmesh_object,
)


def _create_socket(name: str, parent: bpy.types.Object, collection: bpy.types.Collection, loc: tuple[float, float, float]) -> bpy.types.Object:
    sock = bpy.data.objects.new(name, None)
    sock.empty_display_type = "ARROWS"
    sock.empty_display_size = 0.20
    sock.location = loc
    sock.parent = parent
    sock["socket_type"] = "muzzle"
    collection.objects.link(sock)
    return sock


def _add_prism_extruded_x(
    bm: bmesh.types.BMesh,
    pts_yz: list[tuple[float, float]],
    x_min: float,
    x_max: float,
    mat_index: int = 0,
) -> None:
    """Extrude a closed 2D polygon in (Y, Z) from x_min to x_max into bm."""
    v_l = [bm.verts.new((x_min, py, pz)) for py, pz in pts_yz]
    v_r = [bm.verts.new((x_max, py, pz)) for py, pz in pts_yz]
    n = len(pts_yz)
    for i in range(n):
        inext = (i + 1) % n
        f = bm.faces.new((v_l[i], v_r[i], v_r[inext], v_l[inext]))
        f.material_index = mat_index
    f1 = bm.faces.new(list(reversed(v_l)))
    f2 = bm.faces.new(v_r)
    f1.material_index = mat_index
    f2.material_index = mat_index


# ==============================================================================
# 1. MAIN BATTLE TANK: VEH_MBT_AbramsX
# ==============================================================================
def build_mbt_abramsx(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """
    Modern Main Battle Tank (~7.9m hull length, 3.66m width):
      Hierarchy:
        VEH_MBT_AbramsX (Root Empty at Z=0)
          ├── VEH_MBT_Hull (Sloped composite hull, ERA skirts, 14 roadwheels + sprockets + rubber tracks)
          └── VEH_MBT_Turret (360° yaw around Z at (0, 0.15, 1.54))
                ├── VEH_MBT_Cannon120mm (Pitch elevation around X at (0, 1.35, 0.24))
                │     └── Socket_TankMuzzle
                └── VEH_MBT_CROWS_RWS (360° secondary gunner .50 cal turret)
                      └── Socket_RWS_Muzzle
    """
    root = create_empty_root(
        "VEH_MBT_AbramsX",
        collection,
        extras={
            "asset_category": "vehicle_ground_heavy",
            "vehicle_class": "main_battle_tank",
            "seats": 2,
            "hp": 1500,
        },
    )
    # 0=armor_camo, 1=rubber_tread, 2=steel_dark, 3=barrel_steel, 4=optic_glass, 5=led_cyan
    v_mats = [
        mats["armor_camo"],
        mats["rubber_tread"],
        mats["steel_dark"],
        mats["barrel_steel"],
        mats["optic_glass"],
        mats["led_cyan"],
    ]

    # --- A. HULL & TRACKS ---
    bm_hull = bmesh.new()
    # Central armored hull tub + sloped upper/lower glacis (YZ profile extruded X in [-1.12, +1.12])
    hull_yz = [
        (-3.85, 0.48),  # Rear lower
        (2.85, 0.45),   # Front lower belly
        (3.88, 0.96),   # Front nose tip
        (2.45, 1.46),   # Upper glacis slope top
        (-3.65, 1.50),  # Rear engine deck top
        (-3.98, 1.28),  # Rear upper louver bevel
    ]
    _add_prism_extruded_x(bm_hull, hull_yz, -1.12, 1.12, mat_index=0)

    # Sponson upper fenders over tracks (X: ±1.12..±1.82)
    for sx in (-1.0, 1.0):
        x0, x1 = (sx * 1.12, sx * 1.82) if sx > 0 else (sx * 1.82, sx * 1.12)
        fender_yz = [
            (-3.88, 1.02),
            (3.72, 1.02),
            (3.92, 1.18),
            (3.30, 1.38),
            (-3.75, 1.42),
        ]
        _add_prism_extruded_x(bm_hull, fender_yz, x0, x1, mat_index=0)

        # 7 Modular ERA (Explosive Reactive Armor) Side-Skirt Blocks per side + mounting bolts
        for k in range(7):
            ey = -2.65 + k * 0.92
            sx_out = sx * 1.84
            add_box_to_bm(bm_hull, (sx_out, ey, 0.96), (0.09, 0.86, 0.56), mat_index=0)
            add_box_to_bm(bm_hull, (sx_out + sx * 0.048, ey, 1.16), (0.018, 0.72, 0.04), mat_index=2)

        # Continuous Track Belt (YZ loop extruded across track width 0.62m centered at sx * 1.46)
        tx0 = sx * 1.46 - 0.31
        tx1 = sx * 1.46 + 0.31
        track_outer = [
            (-3.20, 0.00),
            (3.15, 0.00),
            (3.75, 0.58),
            (3.68, 1.02),
            (-3.68, 1.02),
            (-3.78, 0.62),
        ]
        # Build thick rubber track band (thickness 0.12m)
        n_tp = len(track_outer)
        t_center = Vector((0.0, 0.52))
        track_inner = []
        for py, pz in track_outer:
            dv = (Vector((py, pz)) - t_center)
            iv = Vector((py, pz)) - dv.normalized() * 0.12
            track_inner.append((iv.x, max(0.11, iv.y)))

        for k in range(n_tp):
            kn = (k + 1) % n_tp
            segment_poly = [track_outer[k], track_outer[kn], track_inner[kn], track_inner[k]]
            _add_prism_extruded_x(bm_hull, segment_poly, tx0, tx1, mat_index=1)

        # 18 Molded Track Grouser Pads along ground & upper track runs for crisp close-up tread relief!
        for gi in range(18):
            gy = -3.05 + gi * 0.355
            add_box_to_bm(bm_hull, (sx * 1.46, gy, 0.022), (0.58, 0.16, 0.032), mat_index=2)

        # 7 Roadwheels + Front Idler + Rear Drive Sprocket (20 segments smooth!)
        wx_in, wx_out = sx * 1.46 - 0.28, sx * 1.46 + 0.28
        for rw_i in range(7):
            wy = -2.85 + rw_i * 0.94
            add_cylinder_to_bm(bm_hull, (wx_in, wy, 0.40), (wx_out, wy, 0.40), radius=0.33, segments=20, mat_index=2)
            # Hubcap & rim bolts
            add_cylinder_to_bm(
                bm_hull,
                (sx * 1.46, wy, 0.40),
                (sx * 1.46 + sx * 0.31, wy, 0.40),
                radius=0.14,
                segments=14,
                mat_index=0,
            )
        # Front Idler & Rear Sprocket
        add_cylinder_to_bm(bm_hull, (wx_in, 3.42, 0.68), (wx_out, 3.42, 0.68), radius=0.30, segments=20, mat_index=2)
        add_cylinder_to_bm(bm_hull, (wx_in, -3.45, 0.70), (wx_out, -3.45, 0.70), radius=0.32, segments=20, mat_index=2)
        # Front Heavy Armored Tow Shackles
        add_box_to_bm(bm_hull, (sx * 0.82, 3.84, 0.92), (0.12, 0.22, 0.14), mat_index=2)

    # Engine deck cooling louver slats (8 angled vents) & Rear turbine exhaust grille + Front Tactical LED Headlights
    add_box_to_bm(bm_hull, (0.0, -2.55, 1.50), (1.78, 1.68, 0.03), mat_index=2)
    for li in range(8):
        ly = -3.25 + li * 0.20
        add_box_to_bm(bm_hull, (0.0, ly, 1.525), (1.64, 0.11, 0.025), mat_index=2, rot_euler=(0.32, 0.0, 0.0))
    add_box_to_bm(bm_hull, (0.0, -3.90, 0.95), (1.60, 0.12, 0.45), mat_index=2)
    # Driver center periscope + Front LED headlights with brush guards
    add_box_to_bm(bm_hull, (0.0, 2.25, 1.50), (0.42, 0.26, 0.12), mat_index=4)
    for sx in (-1.35, 1.35):
        add_box_to_bm(bm_hull, (sx, 3.68, 1.28), (0.26, 0.18, 0.15), mat_index=2)
        add_box_to_bm(bm_hull, (sx, 3.775, 1.28), (0.19, 0.02, 0.085), mat_index=5)

    finalize_bmesh_object(
        "VEH_MBT_Hull",
        bm_hull,
        v_mats,
        collection,
        parent=root,
        uv_scale=0.35,
        bevel_width=0.008,
    )

    # --- B. TURRET (Rotates 360° around Z at (0.0, 0.10, 1.52)) ---
    bm_tur = bmesh.new()
    # Turret ring collar
    add_cylinder_to_bm(bm_tur, (0.0, 0.0, -0.05), (0.0, 0.0, 0.08), radius=1.08, segments=20, mat_index=2)

    # Faceted angular M1A2/AbramsX turret body + rear bustle rack
    # Build via clean lofted Z-slices (bottom Z=0.04 -> mid Z=0.36 -> roof Z=0.68)
    z_bot_pts = [
        (0.0, 1.72),      # Front mantlet nose
        (1.38, 1.05),     # Right front cheek corner
        (1.42, -0.55),    # Right mid
        (1.22, -2.35),    # Right rear bustle
        (-1.22, -2.35),   # Left rear bustle
        (-1.42, -0.55),   # Left mid
        (-1.38, 1.05),    # Left front cheek corner
    ]
    z_mid_pts = [
        (0.0, 1.88),
        (1.52, 1.18),
        (1.48, -0.55),
        (1.26, -2.45),
        (-1.26, -2.45),
        (-1.48, -0.55),
        (-1.52, 1.18),
    ]
    z_top_pts = [
        (0.0, 1.38),
        (1.18, 0.92),
        (1.25, -0.55),
        (1.16, -2.38),
        (-1.16, -2.38),
        (-1.25, -0.55),
        (-1.18, 0.92),
    ]
    vb = [bm_tur.verts.new((px, py, 0.04)) for px, py in z_bot_pts]
    vm = [bm_tur.verts.new((px, py, 0.34)) for px, py in z_mid_pts]
    vt = [bm_tur.verts.new((px, py, 0.68)) for px, py in z_top_pts]
    np_t = len(vb)
    for i in range(np_t):
        inext = (i + 1) % np_t
        bm_tur.faces.new((vb[i], vb[inext], vm[inext], vm[i])).material_index = 0
        bm_tur.faces.new((vm[i], vm[inext], vt[inext], vt[i])).material_index = 0
    bm_tur.faces.new(list(reversed(vb))).material_index = 2
    bm_tur.faces.new(vt).material_index = 0

    # Bustle blow-out panels, Commander CITV thermal sight, Gunner GPS sight, Smoke launchers & Antennas
    add_box_to_bm(bm_tur, (0.0, -1.55, 0.70), (1.85, 1.35, 0.05), mat_index=2)
    # CITV Thermal Viewer (Left-Front Roof, smooth 18-seg)
    add_cylinder_to_bm(bm_tur, (-0.62, 0.55, 0.68), (-0.62, 0.55, 1.02), radius=0.20, segments=18, mat_index=0)
    add_box_to_bm(bm_tur, (-0.62, 0.72, 0.88), (0.20, 0.08, 0.16), mat_index=4)
    # Commander Cupola Periscope Ring & Hatch
    add_cylinder_to_bm(bm_tur, (0.52, -0.25, 0.68), (0.52, -0.25, 0.76), radius=0.38, segments=16, mat_index=2)
    # Gunner Primary Sight doghouse (Right-Front Roof)
    add_box_to_bm(bm_tur, (0.58, 0.78, 0.80), (0.36, 0.44, 0.26), mat_index=0)
    add_box_to_bm(bm_tur, (0.58, 1.005, 0.80), (0.24, 0.02, 0.16), mat_index=4)
    # Rear Turret Bustle Tubular Cargo Rack + Stowed Ration/Ammo Cases!
    for sx in (-1.28, 1.28):
        add_cylinder_to_bm(bm_tur, (sx, -1.05, 0.55), (sx, -2.55, 0.55), radius=0.022, segments=8, mat_index=2)
        add_cylinder_to_bm(bm_tur, (sx, -2.55, 0.20), (sx, -2.55, 0.60), radius=0.022, segments=8, mat_index=2)
    add_cylinder_to_bm(bm_tur, (-1.28, -2.55, 0.55), (1.28, -2.55, 0.55), radius=0.022, segments=8, mat_index=2)
    add_box_to_bm(bm_tur, (-0.52, -2.18, 0.78), (0.64, 0.44, 0.28), mat_index=0)
    add_box_to_bm(bm_tur, (0.48, -2.18, 0.76), (0.58, 0.42, 0.24), mat_index=2)
    # 6-Barrel Cheek Smoke Grenade Discharger Clusters!
    for sx in (-1.38, 1.38):
        add_box_to_bm(bm_tur, (sx, 0.62, 0.42), (0.14, 0.24, 0.14), mat_index=2)
        for si in range(4):
            s_off = (si - 1.5) * 0.065
            add_cylinder_to_bm(
                bm_tur,
                (sx, 0.65, 0.45 + s_off * 0.35),
                (sx + sx * 0.08, 0.88 + abs(s_off) * 0.2, 0.55 + s_off * 0.5),
                radius=0.032,
                segments=10,
                mat_index=2,
            )
    # Dual Rear Whip Radio Antennas
    for sx in (-1.05, 1.05):
        add_cylinder_to_bm(bm_tur, (sx, -2.30, 0.68), (sx, -2.35, 2.65), radius=0.012, segments=8, mat_index=2)

    turret_obj = finalize_bmesh_object(
        "VEH_MBT_Turret",
        bm_tur,
        v_mats,
        collection,
        parent=root,
        location=(0.0, 0.10, 1.52),
        uv_scale=0.35,
        bevel_width=0.008,
        extras={"animatable_part": "turret_yaw"},
    )

    # --- C. 120MM SMOOTHBORE CANNON (Child of Turret at (0, 1.45, 0.34)) ---
    bm_gun = bmesh.new()
    # Armored gun mantlet block + coaxial 7.62mm barrel
    add_box_to_bm(bm_gun, (0.0, 0.05, 0.0), (0.58, 0.46, 0.38), mat_index=0)
    add_cylinder_to_bm(bm_gun, (-0.19, 0.25, 0.03), (-0.19, 0.72, 0.03), radius=0.018, segments=12, mat_index=3)
    # Main 120mm barrel (24 segments smooth!) + Thermal shroud straps + Eccentric Bore Evacuator + Recessed Bore
    add_cylinder_to_bm(bm_gun, (0.0, 0.25, 0.0), (0.0, 4.35, 0.0), radius=0.082, segments=24, mat_index=0)
    add_cylinder_to_bm(bm_gun, (0.0, 1.55, 0.025), (0.0, 2.35, 0.025), radius=0.135, segments=24, mat_index=0)
    for cy_band in (0.95, 1.52, 2.38, 3.35):
        add_cylinder_to_bm(bm_gun, (0.0, cy_band - 0.02, 0.0), (0.0, cy_band + 0.02, 0.0), radius=0.088, segments=24, mat_index=2)
    add_cylinder_to_bm(bm_gun, (0.0, 4.22, 0.0), (0.0, 4.42, 0.0), radius=0.098, segments=24, mat_index=3)
    add_cylinder_to_bm(bm_gun, (0.0, 4.39, 0.0), (0.0, 4.43, 0.0), radius=0.062, segments=20, mat_index=1)
    # Muzzle reference sensor pin
    add_box_to_bm(bm_gun, (0.0, 4.36, 0.125), (0.03, 0.06, 0.07), mat_index=2)

    gun_obj = finalize_bmesh_object(
        "VEH_MBT_Cannon120mm",
        bm_gun,
        v_mats,
        collection,
        parent=turret_obj,
        location=(0.0, 1.45, 0.34),
        uv_scale=0.5,
        shade_smooth=True,
        extras={"animatable_part": "cannon_pitch", "min_deg": -10, "max_deg": 20},
    )
    _create_socket("Socket_TankMuzzle", gun_obj, collection, (0.0, 4.45, 0.0))

    # --- D. CROWS .50 CAL REMOTE WEAPON STATION (Child of Turret at (0.52, -0.25, 0.68)) ---
    bm_rws = bmesh.new()
    add_cylinder_to_bm(bm_rws, (0.0, 0.0, 0.0), (0.0, 0.0, 0.32), radius=0.10, segments=14, mat_index=2)
    add_box_to_bm(bm_rws, (0.0, 0.0, 0.42), (0.34, 0.42, 0.24), mat_index=2)
    add_box_to_bm(bm_rws, (-0.22, 0.02, 0.40), (0.16, 0.28, 0.22), mat_index=0)
    add_box_to_bm(bm_rws, (0.14, 0.18, 0.36), (0.14, 0.14, 0.14), mat_index=4)
    add_cylinder_to_bm(bm_rws, (0.0, 0.20, 0.46), (0.0, 0.58, 0.46), radius=0.036, segments=14, mat_index=2)
    add_cylinder_to_bm(bm_rws, (0.0, 0.20, 0.46), (0.0, 1.15, 0.46), radius=0.022, segments=14, mat_index=3)

    rws_obj = finalize_bmesh_object(
        "VEH_MBT_CROWS_RWS",
        bm_rws,
        v_mats,
        collection,
        parent=turret_obj,
        location=(0.52, -0.25, 0.68),
        uv_scale=1.2,
        bevel_width=0.004,
        extras={"animatable_part": "secondary_turret"},
    )
    _create_socket("Socket_RWS_Muzzle", rws_obj, collection, (0.0, 1.18, 0.46))

    return root


# ==============================================================================
# 2. SCOUT / ATTACK HELICOPTER: VEH_Heli_LittleBird_AH6
# ==============================================================================
def build_heli_littlebird_ah6(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """
    Agile Scout/Attack Helicopter (AH-6J Little Bird inspired):
      Hierarchy:
        VEH_Heli_LittleBird_AH6 (Root Empty at skid ground contact Z=0)
          ├── VEH_Heli_Fuselage (Smooth teardrop body, canopy ribs, SOAR troop benches, 6-barrel miniguns & 7-tube Hydra pods)
          ├── VEH_Heli_RotorMain (5-blade main rotor + swashplate at (0, -0.05, 2.52) -> spin around Z!)
          └── VEH_Heli_RotorTail (4-blade tail rotor at (-0.18, -4.55, 1.56) -> spin around X!)
    """
    root = create_empty_root(
        "VEH_Heli_LittleBird_AH6",
        collection,
        extras={
            "asset_category": "vehicle_air_heli",
            "vehicle_class": "scout_attack_heli",
            "seats": 4,
            "hp": 650,
        },
    )
    h_mats = [
        mats["heli_slate"],
        mats["optic_glass"],
        mats["steel_dark"],
        mats["barrel_steel"],
        mats["ordnance_olive"],
        mats["hazard"],
    ]

    bm = bmesh.new()

    # 1. High-Subdivision Smooth Aerodynamic Teardrop Fuselage Cabin (32x20 smooth sphere!)
    ret_cab = bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=20, radius=1.0)
    cab_verts = ret_cab["verts"]
    cab_set = set(cab_verts)
    for v in cab_verts:
        ny = v.co.y
        taper = 1.0 - 0.28 * max(0.0, -ny)
        v.co.x *= 0.78 * taper
        v.co.y = 0.20 + ny * 1.65
        v.co.z = 1.28 + v.co.z * 0.82 * (1.0 - 0.15 * max(0.0, ny))

    for f in bm.faces:
        if all(v in cab_set for v in f.verts):
            fc = f.calc_center_median()
            if fc.y > 0.52 and fc.z > 0.90 and abs(fc.x) < 0.69:
                f.material_index = 1
            else:
                f.material_index = 0

    # Canopy structural mullions, Wire-Strike Cutters & Nose FLIR sensor turret ball
    add_box_to_bm(bm, (0.0, 1.48, 1.38), (0.036, 0.82, 0.68), mat_index=0, rot_euler=(-0.55, 0.0, 0.0))
    add_box_to_bm(bm, (0.0, 0.85, 2.18), (0.02, 0.22, 0.26), mat_index=2, rot_euler=(-0.45, 0.0, 0.0))
    add_cylinder_to_bm(bm, (0.0, 1.62, 0.52), (0.0, 1.62, 0.72), radius=0.15, segments=18, mat_index=2)
    add_box_to_bm(bm, (0.0, 1.75, 0.58), (0.14, 0.06, 0.12), mat_index=1)

    # Top Engine Cowling, Intake Louvers & Angled Turbine Exhaust
    add_box_to_bm(bm, (0.0, -0.55, 2.05), (0.68, 1.45, 0.42), mat_index=0)
    add_cylinder_to_bm(bm, (0.0, -1.15, 2.02), (0.0, -1.68, 1.96), radius=0.19, segments=20, mat_index=3)
    add_cylinder_to_bm(bm, (0.0, -1.64, 1.965), (0.0, -1.70, 1.958), radius=0.15, segments=18, mat_index=2)

    # 2. Sleek High-Mounted Tailboom (20-seg smooth!) + Swept Fin & T-Tail
    add_cylinder_to_bm(bm, (0.0, -1.05, 1.56), (0.0, -4.68, 1.56), radius=0.16, segments=20, mat_index=0)
    fin_yz = [
        (-4.15, 1.50),
        (-4.75, 1.48),
        (-4.98, 2.42),
        (-4.62, 2.42),
    ]
    _add_prism_extruded_x(bm, fin_yz, -0.045, 0.045, mat_index=0)
    vfin_yz = [
        (-4.25, 1.52),
        (-4.72, 0.82),
        (-4.88, 0.86),
        (-4.65, 1.52),
    ]
    _add_prism_extruded_x(bm, vfin_yz, -0.04, 0.04, mat_index=0)
    add_box_to_bm(bm, (0.0, -4.78, 2.42), (1.42, 0.34, 0.045), mat_index=0)
    for sx_e in (-0.70, 0.70):
        add_box_to_bm(bm, (sx_e, -4.78, 2.42), (0.03, 0.42, 0.24), mat_index=0)

    # 3. Tubular Landing Skids + Signature SOAR Outboard Operator Bench Planks!
    for sx in (-1.02, 1.02):
        add_cylinder_to_bm(bm, (sx, -1.25, 0.04), (sx, 1.45, 0.04), radius=0.042, segments=14, mat_index=2)
        add_cylinder_to_bm(bm, (sx, 1.45, 0.04), (sx, 1.68, 0.24), radius=0.038, segments=12, mat_index=2)
        for sy_s in (-0.65, 0.85):
            add_cylinder_to_bm(bm, (sx, sy_s, 0.05), (sx * 0.55, sy_s, 0.62), radius=0.034, segments=12, mat_index=2)
        # Outboard operator footrail / bench plank
        add_box_to_bm(bm, (sx * 0.84, 0.12, 0.54), (0.28, 1.32, 0.035), mat_index=2)

    # 4. Stub-Wing Weapon Pylons + 7-Tube Hydra-70 Rocket Pods + True 6-Barrel M134 Gatling Miniguns!
    add_box_to_bm(bm, (0.0, 0.12, 0.78), (2.75, 0.28, 0.07), mat_index=0)
    for sx in (-1.0, 1.0):
        px_pod = sx * 1.24
        add_cylinder_to_bm(bm, (px_pod, -0.45, 0.64), (px_pod, 0.72, 0.64), radius=0.165, segments=20, mat_index=4)
        add_cylinder_to_bm(bm, (px_pod, 0.70, 0.64), (px_pod, 0.745, 0.64), radius=0.155, segments=20, mat_index=2)
        # 7 Recessed Rocket Launch Tubes on Pod Face
        add_cylinder_to_bm(bm, (px_pod, 0.73, 0.64), (px_pod, 0.752, 0.64), radius=0.032, segments=10, mat_index=3)
        for ti in range(6):
            ta = (ti / 6.0) * 2.0 * math.pi
            add_cylinder_to_bm(
                bm,
                (px_pod + math.cos(ta) * 0.09, 0.73, 0.64 + math.sin(ta) * 0.09),
                (px_pod + math.cos(ta) * 0.09, 0.752, 0.64 + math.sin(ta) * 0.09),
                radius=0.030,
                segments=10,
                mat_index=3,
            )
        # Inner Pylon: M134 6-Barrel Gatling Minigun Bundle + Barrel Clamp Discs
        px_gun = sx * 0.92
        add_box_to_bm(bm, (px_gun, 0.05, 0.66), (0.15, 0.38, 0.17), mat_index=2)
        for bi in range(6):
            ba = (bi / 6.0) * 2.0 * math.pi
            add_cylinder_to_bm(
                bm,
                (px_gun + math.cos(ba) * 0.030, 0.22, 0.66 + math.sin(ba) * 0.030),
                (px_gun + math.cos(ba) * 0.030, 0.96, 0.66 + math.sin(ba) * 0.030),
                radius=0.009,
                segments=8,
                mat_index=3,
            )
        for cy_clamp in (0.58, 0.90):
            add_cylinder_to_bm(bm, (px_gun, cy_clamp - 0.012, 0.66), (px_gun, cy_clamp + 0.012, 0.66), radius=0.044, segments=14, mat_index=2)

    fus_obj = finalize_bmesh_object(
        "VEH_Heli_Fuselage",
        bm,
        h_mats,
        collection,
        parent=root,
        uv_scale=0.5,
        shade_smooth=True,
    )
    _create_socket("Socket_RocketPod_L", fus_obj, collection, (-1.24, 0.76, 0.64))
    _create_socket("Socket_RocketPod_R", fus_obj, collection, (1.24, 0.76, 0.64))
    _create_socket("Socket_Minigun_L", fus_obj, collection, (-0.92, 0.98, 0.66))
    _create_socket("Socket_Minigun_R", fus_obj, collection, (0.92, 0.98, 0.66))

    # 5. Animatable 5-Blade Main Rotor + Swashplate & Pitch Links (Child at (0, -0.05, 2.48))
    bm_rm = bmesh.new()
    add_cylinder_to_bm(bm_rm, (0.0, 0.0, -0.26), (0.0, 0.0, 0.10), radius=0.075, segments=16, mat_index=2)
    add_cylinder_to_bm(bm_rm, (0.0, 0.0, -0.14), (0.0, 0.0, -0.10), radius=0.16, segments=16, mat_index=3)
    add_cylinder_to_bm(bm_rm, (0.0, 0.0, -0.02), (0.0, 0.0, 0.06), radius=0.23, segments=18, mat_index=2)
    n_blades = 5
    blade_len = 3.95
    for b_i in range(n_blades):
        ang = (b_i / n_blades) * 2.0 * math.pi
        cx = math.cos(ang) * (0.28 + blade_len * 0.5)
        cy = math.sin(ang) * (0.28 + blade_len * 0.5)
        add_box_to_bm(
            bm_rm,
            (cx, cy, 0.02),
            (blade_len, 0.21, 0.018),
            mat_index=2,
            rot_euler=(0.08, 0.0, ang),
        )
        tx = math.cos(ang) * (0.24 + blade_len)
        ty = math.sin(ang) * (0.24 + blade_len)
        add_box_to_bm(bm_rm, (tx, ty, 0.02), (0.22, 0.215, 0.020), mat_index=5, rot_euler=(0.08, 0.0, ang))

    finalize_bmesh_object(
        "VEH_Heli_RotorMain",
        bm_rm,
        h_mats,
        collection,
        parent=fus_obj,
        location=(0.0, -0.05, 2.48),
        uv_scale=0.6,
        extras={"animatable_part": "rotor_main", "spin_axis": "Z"},
    )

    # 6. Animatable 4-Blade Tail Rotor (Child at (-0.16, -4.58, 1.56) -> spin around X)
    bm_rt = bmesh.new()
    add_cylinder_to_bm(bm_rt, (0.12, 0.0, 0.0), (-0.06, 0.0, 0.0), radius=0.055, segments=14, mat_index=2)
    add_box_to_bm(bm_rt, (-0.04, 0.0, 0.0), (0.02, 1.38, 0.12), mat_index=2)
    add_box_to_bm(bm_rt, (-0.04, 0.0, 0.0), (0.02, 0.12, 1.38), mat_index=5)
    finalize_bmesh_object(
        "VEH_Heli_RotorTail",
        bm_rt,
        h_mats,
        collection,
        parent=fus_obj,
        location=(-0.16, -4.58, 1.56),
        extras={"animatable_part": "rotor_tail", "spin_axis": "X"},
    )

    return root


# ==============================================================================
# 3. LIGHT ARMORED TACTICAL 4X4 RECON VEHICLE: VEH_Buggy_LATV4
# ==============================================================================
def _build_tactical_wheel(
    name: str,
    collection: bpy.types.Collection,
    parent: bpy.types.Object,
    loc: tuple[float, float, float],
    v_mats: list,
) -> bpy.types.Object:
    """Create a 1.04m diameter deep-lugged offroad tire + 8-bolt armored beadlock rim."""
    bm_w = bmesh.new()
    add_cylinder_to_bm(bm_w, (-0.19, 0.0, 0.0), (0.19, 0.0, 0.0), radius=0.505, segments=24, mat_index=1)
    # 16 Molded 3D Offroad Tire Shoulder Lugs around circumference
    for li in range(16):
        la = (li / 16.0) * 2.0 * math.pi
        add_box_to_bm(
            bm_w,
            (0.0, math.cos(la) * 0.508, math.sin(la) * 0.508),
            (0.39, 0.085, 0.032),
            mat_index=1,
            rot_euler=(-la, 0.0, 0.0),
        )
    # Armored beadlock steel rim, lug bolts & hub
    add_cylinder_to_bm(bm_w, (-0.202, 0.0, 0.0), (0.202, 0.0, 0.0), radius=0.31, segments=20, mat_index=0)
    add_cylinder_to_bm(bm_w, (-0.215, 0.0, 0.0), (0.215, 0.0, 0.0), radius=0.14, segments=16, mat_index=2)
    return finalize_bmesh_object(
        name,
        bm_w,
        v_mats,
        collection,
        parent=parent,
        location=loc,
        uv_scale=0.8,
        extras={"animatable_part": "wheel"},
    )


def build_buggy_latv4(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """
    Light Armored Tactical 4x4 Squad Transport (JLTV / LATV4 inspired, 5.1m x 2.24m):
      Hierarchy:
        VEH_Buggy_LATV4 (Root Empty at Z=0)
          ├── VEH_LATV4_Chassis
          ├── VEH_LATV4_Wheel_FL / FR / RL / RR (Steerable + Spinnable!)
          └── VEH_LATV4_RoofTurret (360° Armored .50 cal HMG Shield Turret)
    """
    root = create_empty_root(
        "VEH_Buggy_LATV4",
        collection,
        extras={
            "asset_category": "vehicle_ground_light",
            "vehicle_class": "tactical_recon_4x4",
            "seats": 4,
            "hp": 550,
        },
    )
    v_mats = [
        mats["armor_camo"],
        mats["rubber_tread"],
        mats["steel_dark"],
        mats["barrel_steel"],
        mats["optic_glass"],
        mats["led_cyan"],
    ]

    bm = bmesh.new()
    # Mine-resistant V-hull belly, suspension axles & visible coilover shock struts
    add_box_to_bm(bm, (0.0, 0.0, 0.62), (1.42, 4.35, 0.34), mat_index=2)
    add_cylinder_to_bm(bm, (-0.95, 1.62, 0.52), (0.95, 1.62, 0.52), radius=0.065, segments=14, mat_index=2)
    add_cylinder_to_bm(bm, (-0.95, -1.55, 0.52), (0.95, -1.55, 0.52), radius=0.065, segments=14, mat_index=2)
    for sx_s in (-0.82, 0.82):
        for sy_s in (1.62, -1.55):
            add_cylinder_to_bm(bm, (sx_s, sy_s, 0.55), (sx_s * 0.92, sy_s, 1.05), radius=0.055, segments=10, mat_index=3)

    # Armored Cabin & Sloped Hood Silhouette (YZ profile extruded X in [-0.98, +0.98])
    body_yz = [
        (-2.45, 0.78),
        (2.42, 0.76),
        (2.55, 1.18),
        (1.18, 1.38),
        (0.65, 2.12),
        (-1.15, 2.12),
        (-1.25, 1.38),
        (-2.48, 1.35),
    ]
    _add_prism_extruded_x(bm, body_yz, -0.98, 0.98, mat_index=0)

    # Hood louver intake, armored door hinges & side tactical wing mirrors
    add_box_to_bm(bm, (0.0, 1.78, 1.32), (0.92, 0.62, 0.06), mat_index=2, rot_euler=(-0.14, 0.0, 0.0))
    for sx in (-1.0, 1.0):
        add_box_to_bm(bm, (sx * 1.04, 0.04, 0.76), (0.18, 1.95, 0.10), mat_index=2)
        add_box_to_bm(bm, (sx * 1.04, 1.62, 1.14), (0.22, 1.18, 0.12), mat_index=0)
        add_box_to_bm(bm, (sx * 1.04, -1.55, 1.14), (0.22, 1.18, 0.12), mat_index=0)
        # Wing mirrors & armored door handles
        add_box_to_bm(bm, (sx * 1.10, 0.82, 1.66), (0.16, 0.08, 0.22), mat_index=2)
        add_box_to_bm(bm, (sx * 0.995, 0.02, 1.36), (0.03, 0.14, 0.05), mat_index=2)

    # Ballistic Split Windshield + Side Armored Door Windows
    for sx in (-0.44, 0.44):
        add_box_to_bm(
            bm,
            (sx, 0.93, 1.76),
            (0.76, 0.04, 0.62),
            mat_index=4,
            rot_euler=(-0.62, 0.0, 0.0),
        )
    for sy_win in (0.22, -0.62):
        add_box_to_bm(bm, (0.0, sy_win, 1.75), (1.98, 0.64, 0.42), mat_index=4)

    # Front Bullbar Bumper, Winch Drum, Slatted Grille, LED Lightbars & Rear Roll-Cage + Spare Tire + Jerrycan
    add_box_to_bm(bm, (0.0, 2.58, 0.88), (2.06, 0.16, 0.24), mat_index=2)
    add_cylinder_to_bm(bm, (-0.22, 2.62, 0.88), (0.22, 2.62, 0.88), radius=0.09, segments=12, mat_index=3)
    add_box_to_bm(bm, (0.0, 2.51, 1.05), (1.05, 0.06, 0.26), mat_index=2)
    for sx in (-0.74, 0.74):
        add_box_to_bm(bm, (sx, 2.50, 1.08), (0.26, 0.06, 0.10), mat_index=5)

    for sx in (-0.90, 0.90):
        add_cylinder_to_bm(bm, (sx, -1.18, 2.10), (sx, -2.38, 1.35), radius=0.038, segments=12, mat_index=2)
    add_box_to_bm(bm, (-0.68, -2.54, 1.25), (0.34, 0.18, 0.46), mat_index=0)
    add_cylinder_to_bm(bm, (0.14, -2.50, 1.25), (0.14, -2.84, 1.25), radius=0.48, segments=22, mat_index=1)
    add_cylinder_to_bm(bm, (0.14, -2.50, 1.25), (0.14, -2.86, 1.25), radius=0.26, segments=18, mat_index=0)
    add_cylinder_to_bm(bm, (-0.88, -2.38, 1.38), (-0.92, -2.42, 2.85), radius=0.012, segments=8, mat_index=2)

    finalize_bmesh_object("VEH_LATV4_Chassis", bm, v_mats, collection, parent=root, uv_scale=0.45, bevel_width=0.008)

    # 4 Independent Steerable / Spinnable Wheels
    _build_tactical_wheel("VEH_LATV4_Wheel_FL", collection, root, (-1.04, 1.62, 0.52), v_mats)
    _build_tactical_wheel("VEH_LATV4_Wheel_FR", collection, root, (1.04, 1.62, 0.52), v_mats)
    _build_tactical_wheel("VEH_LATV4_Wheel_RL", collection, root, (-1.04, -1.55, 0.52), v_mats)
    _build_tactical_wheel("VEH_LATV4_Wheel_RR", collection, root, (1.04, -1.55, 0.52), v_mats)

    # Roof 360° Armored Gunner Turret + .50 Cal M2HB HMG (Perforated Barrel Jacket + Spade Grips)
    bm_tur = bmesh.new()
    add_cylinder_to_bm(bm_tur, (0.0, 0.0, -0.02), (0.0, 0.0, 0.08), radius=0.46, segments=20, mat_index=2)
    add_box_to_bm(bm_tur, (-0.22, 0.36, 0.32), (0.44, 0.04, 0.48), mat_index=0, rot_euler=(0.0, 0.0, 0.28))
    add_box_to_bm(bm_tur, (0.22, 0.36, 0.32), (0.44, 0.04, 0.48), mat_index=0, rot_euler=(0.0, 0.0, -0.28))
    add_box_to_bm(bm_tur, (0.0, 0.41, 0.50), (0.26, 0.05, 0.14), mat_index=4)
    add_box_to_bm(bm_tur, (0.0, 0.12, 0.34), (0.14, 0.52, 0.16), mat_index=2)
    for sx_g in (-0.065, 0.065):
        add_cylinder_to_bm(bm_tur, (sx_g, -0.18, 0.28), (sx_g, -0.18, 0.40), radius=0.015, segments=10, mat_index=2)
    add_box_to_bm(bm_tur, (-0.18, 0.16, 0.32), (0.18, 0.26, 0.22), mat_index=0)
    add_cylinder_to_bm(bm_tur, (0.0, 0.38, 0.35), (0.0, 0.68, 0.35), radius=0.036, segments=16, mat_index=2)
    add_cylinder_to_bm(bm_tur, (0.0, 0.38, 0.35), (0.0, 1.18, 0.35), radius=0.022, segments=16, mat_index=3)
    add_cylinder_to_bm(bm_tur, (0.0, 1.15, 0.35), (0.0, 1.21, 0.35), radius=0.030, segments=14, mat_index=2)

    tur_obj = finalize_bmesh_object(
        "VEH_LATV4_RoofTurret",
        bm_tur,
        v_mats,
        collection,
        parent=root,
        location=(0.0, -0.15, 2.12),
        uv_scale=0.8,
        bevel_width=0.005,
        extras={"animatable_part": "roof_turret"},
    )
    _create_socket("Socket_HMG_Muzzle", tur_obj, collection, (0.0, 1.20, 0.35))

    return root


def build_all_combat_vehicles(collection: bpy.types.Collection, mats: dict) -> dict[str, bpy.types.Object]:
    return {
        "VEH_MBT_AbramsX": build_mbt_abramsx(collection, mats),
        "VEH_Heli_LittleBird_AH6": build_heli_littlebird_ah6(collection, mats),
        "VEH_Buggy_LATV4": build_buggy_latv4(collection, mats),
    }
