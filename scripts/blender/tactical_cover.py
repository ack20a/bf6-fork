"""
Battlefield 6 Tactical Cover, Military Fortifications, Shipping Containers & Conquest Objective Props.
All pivots placed at ground center (0, 0, 0) with real-world metric dimensions.
"""

import math
import numpy as np
import bpy
import bmesh
from mathutils import Vector, Matrix

from mesh_utils import (
    add_box_to_bm,
    add_cylinder_to_bm,
    create_empty_root,
    finalize_bmesh_object,
)


def _add_hesco_cell_to_bm(
    bm: bmesh.types.BMesh,
    cx: float,
    cy: float,
    width: float = 1.16,
    depth: float = 1.16,
    height: float = 1.35,
    seed: int = 10,
) -> None:
    """
    Append one detailed HESCO gabion cell centered at (cx, cy), Z in [0, height]:
      mat 0: hesco_wall (geotextile + wire mesh)
      mat 1: steel_dark (corner spiral hinges & top rim wire)
      mat 2: sand_earth (compacted gravel mound at top)
    """
    rng = np.random.default_rng(seed)
    nx, ny, nz = 6, 6, 6
    hw, hd = width * 0.5, depth * 0.5

    # Build slightly bulged subdivided box for the geotextile/mesh liner
    ret = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(
        bm,
        edges=ret["verts"][0].link_edges[:] if False else [
            e for e in bm.edges if e.verts[0] in ret["verts"] and e.verts[1] in ret["verts"]
        ],
        cuts=4,
        use_grid_fill=True,
    )
    # Re-collect all verts belonging to this newly subdivided cube (currently centered at origin)
    # Wait: subdivide_edges creates new verts not in ret["verts"], so build in a temp bmesh and merge!
    bm.clear() if False else None


def _make_single_hesco_bmesh(
    cx: float = 0.0,
    cy: float = 0.0,
    width: float = 1.16,
    depth: float = 1.16,
    height: float = 1.35,
    seed: int = 10,
) -> bmesh.types.BMesh:
    """Create a complete BMesh for a single HESCO bastion unit."""
    bm = bmesh.new()
    rng = np.random.default_rng(seed)

    # 1. Bulged liner body (mat 0 = hesco_wall, top recessed slightly for sand fill)
    ret = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=4, use_grid_fill=True)

    liner_h = height - 0.05
    for v in bm.verts:
        # Original cube in [-0.5, 0.5]^3
        ux, uy, uz = v.co.x, v.co.y, v.co.z + 0.5  # uz in [0, 1]
        # Belly bulge peaks around 40% height due to sand pressure
        bulge = math.sin(uz * math.pi) * 0.045
        bx = 1.0 + bulge * (1.0 - 2.0 * uy * uy)
        by = 1.0 + bulge * (1.0 - 2.0 * ux * ux)
        v.co.x = cx + ux * width * bx
        v.co.y = cy + uy * depth * by
        v.co.z = uz * liner_h
        # Slight top rim unevenness
        if uz > 0.98:
            v.co.z -= 0.04

    for f in bm.faces:
        f.material_index = 0

    # 2. Top compacted sand/gravel fill mound (mat 2 = sand_earth)
    bm_sand = bmesh.new()
    bmesh.ops.create_grid(bm_sand, x_segments=6, y_segments=6, size=0.5)
    for v in bm_sand.verts:
        r2 = (v.co.x * 2.0) ** 2 + (v.co.y * 2.0) ** 2
        dome = max(0.0, 1.0 - r2 * 0.85) * 0.13
        jitter = float(rng.uniform(-0.012, 0.012))
        v.co.x = cx + v.co.x * (width * 0.94)
        v.co.y = cy + v.co.y * (depth * 0.94)
        v.co.z = liner_h - 0.05 + dome + jitter
    # Extrude downward slightly so sand sits watertight inside rim
    top_faces = list(bm_sand.faces)
    ext = bmesh.ops.extrude_face_region(bm_sand, geom=top_faces)
    for elem in ext["geom"]:
        if isinstance(elem, bmesh.types.BMVert):
            elem.co.z -= 0.08
    bmesh.ops.recalc_face_normals(bm_sand, faces=bm_sand.faces)
    for f in bm_sand.faces:
        f.material_index = 2

    # Merge sand into bm
    tmp_mesh = bpy.data.meshes.new("_tmp_sand")
    bm_sand.to_mesh(tmp_mesh)
    bm_sand.free()
    bm.from_mesh(tmp_mesh)
    bpy.data.meshes.remove(tmp_mesh)

    # 3. Corner galvanized steel spiral hinge pins & horizontal rim bars (mat 1 = steel_dark)
    hw, hd = width * 0.505, depth * 0.505
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            px, py = cx + sx * hw, cy + sy * hd
            add_cylinder_to_bm(bm, (px, py, 0.0), (px, py, height), radius=0.022, segments=8, mat_index=1)
    # Top steel frame rim
    add_cylinder_to_bm(bm, (cx - hw, cy - hd, height - 0.02), (cx + hw, cy - hd, height - 0.02), 0.014, 6, 1)
    add_cylinder_to_bm(bm, (cx - hw, cy + hd, height - 0.02), (cx + hw, cy + hd, height - 0.02), 0.014, 6, 1)
    add_cylinder_to_bm(bm, (cx - hw, cy - hd, height - 0.02), (cx - hw, cy + hd, height - 0.02), 0.014, 6, 1)
    add_cylinder_to_bm(bm, (cx + hw, cy - hd, height - 0.02), (cx + hw, cy + hd, height - 0.02), 0.014, 6, 1)

    return bm


def build_hesco_single(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """Single 1.2m x 1.2m x 1.35m HESCO military blast bastion."""
    root = create_empty_root(
        "COV_Hesco_Single",
        collection,
        extras={"asset_category": "cover_fortification", "cover_height": 1.35, "destructible": True, "hp": 250},
    )
    bm = _make_single_hesco_bmesh(0.0, 0.0, 1.18, 1.18, 1.35, seed=11)
    finalize_bmesh_object(
        "COV_Hesco_Single_Mesh",
        bm,
        [mats["hesco_wall"], mats["steel_dark"], mats["sand_earth"]],
        collection,
        parent=root,
        uv_scale=0.85,
        shade_smooth=True,
        extras={"destructible": True, "hp": 250},
    )
    return root


def build_hesco_wall_3x(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """Connected 3-cell (3.6m wide) HESCO perimeter blast wall, destructible per cell."""
    root = create_empty_root(
        "COV_Hesco_Wall_3x",
        collection,
        extras={"asset_category": "cover_fortification", "width": 3.6, "destructible_container": True},
    )
    for i in range(3):
        cx = (i - 1) * 1.19
        bm = _make_single_hesco_bmesh(cx, 0.0, 1.18, 1.18, 1.35, seed=20 + i)
        finalize_bmesh_object(
            f"COV_Hesco_Wall_3x_Cell_{i + 1:02d}",
            bm,
            [mats["hesco_wall"], mats["steel_dark"], mats["sand_earth"]],
            collection,
            parent=root,
            uv_scale=0.85,
            extras={"destructible": True, "hp": 250, "cell_index": i + 1},
        )
    return root


def build_jersey_barrier(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """
    3.0m x 0.64m x 1.06m Concrete K-Rail / Jersey Blast Barrier with sloped profile,
    forklift slots, steel rebar lifting loops, and diagonal hazard end markings.
    """
    root = create_empty_root(
        "COV_Jersey_Barrier_3m",
        collection,
        extras={"asset_category": "cover_barrier", "cover_height": 1.06, "destructible": True, "hp": 300},
    )
    bm = bmesh.new()

    # Cross-section in YZ plane extruded along X from -1.50 to +1.50
    profile_yz = [
        (-0.32, 0.00),
        (0.32, 0.00),
        (0.32, 0.12),
        (0.19, 0.36),
        (0.11, 1.06),
        (-0.11, 1.06),
        (-0.19, 0.36),
        (-0.32, 0.12),
    ]
    x_planes = [-1.50, -0.85, -0.55, 0.55, 0.85, 1.50]
    # Build segments along X; in forklift slot intervals [-0.85, -0.55] and [0.55, 0.85], lift bottom Z to 0.09m!
    for seg_i in range(len(x_planes) - 1):
        x0, x1 = x_planes[seg_i], x_planes[seg_i + 1]
        is_slot = seg_i in (1, 3)
        z_floor = 0.09 if is_slot else 0.00

        pts = []
        for py, pz in profile_yz:
            pts.append((py, max(pz, z_floor) if pz < 0.10 else pz))

        v0 = [bm.verts.new((x0, py, pz)) for py, pz in pts]
        v1 = [bm.verts.new((x1, py, pz)) for py, pz in pts]
        n = len(pts)
        for k in range(n):
            kn = (k + 1) % n
            f = bm.faces.new((v0[k], v1[k], v1[kn], v0[kn]))
            f.material_index = 0
        # Cap ends or forklift slot vertical step walls
        f_l = bm.faces.new(list(reversed(v0)))
        f_r = bm.faces.new(v1)
        f_l.material_index = 0
        f_r.material_index = 0

    # Hazard yellow/black end warning plates on -X and +X upper faces (mat_index=1)
    add_box_to_bm(bm, (-1.502, 0.0, 0.72), (0.012, 0.21, 0.52), mat_index=1)
    add_box_to_bm(bm, (1.502, 0.0, 0.72), (0.012, 0.21, 0.52), mat_index=1)

    # Top steel lifting rebar loops (mat_index=2)
    for lx in (-0.95, 0.95):
        add_cylinder_to_bm(bm, (lx - 0.06, 0.0, 1.04), (lx - 0.06, 0.0, 1.13), 0.012, 6, 2)
        add_cylinder_to_bm(bm, (lx + 0.06, 0.0, 1.04), (lx + 0.06, 0.0, 1.13), 0.012, 6, 2)
        add_cylinder_to_bm(bm, (lx - 0.06, 0.0, 1.13), (lx + 0.06, 0.0, 1.13), 0.012, 6, 2)

    finalize_bmesh_object(
        "COV_Jersey_Barrier_3m_Mesh",
        bm,
        [mats["concrete_ext"], mats["hazard"], mats["steel_dark"]],
        collection,
        parent=root,
        uv_scale=0.6,
        bevel_width=0.006,
        extras={"destructible": True, "hp": 300},
    )
    return root


def _add_sandbag_to_bm(
    bm: bmesh.types.BMesh,
    center: tuple[float, float, float],
    rot_z: float,
    length: float = 0.56,
    width: float = 0.34,
    height: float = 0.19,
    seed: int = 1,
) -> None:
    """Create a plump, organically sagged burlap sandbag with pinched perimeter seam."""
    rng = np.random.default_rng(seed)
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1.0)
    bmesh.ops.subdivide_edges(tmp, edges=list(tmp.edges), cuts=2, use_grid_fill=True)

    hl, hw, hh = length * 0.5, width * 0.5, height * 0.5
    rot_m = Matrix.Rotation(rot_z, 3, "Z")
    c_vec = Vector(center)

    for v in tmp.verts:
        ux, uy, uz = v.co.x * 2.0, v.co.y * 2.0, v.co.z * 2.0  # in [-1, 1]
        # Pillow dome falloff so corners round off and middle seam pinches slightly
        r_xy = min(1.0, (ux * ux * 0.75 + uy * uy * 0.75))
        pillow_z = (1.0 - 0.38 * r_xy)
        # Pinch vertical waist edge like a sewn sack seam
        seam_flare = 1.0 + 0.08 * max(0.0, 1.0 - abs(uz) * 2.5)
        sag = -0.015 * (ux * ux)

        lx = ux * hl * seam_flare + float(rng.uniform(-0.008, 0.008))
        ly = uy * hw * seam_flare + float(rng.uniform(-0.008, 0.008))
        lz = uz * hh * pillow_z + sag

        world_p = c_vec + (rot_m @ Vector((lx, ly, lz)))
        v.co = world_p

    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
    for f in tmp.faces:
        f.material_index = 0

    mesh_tmp = bpy.data.meshes.new("_tmp_sb")
    tmp.to_mesh(mesh_tmp)
    tmp.free()
    bm.from_mesh(mesh_tmp)
    bpy.data.meshes.remove(mesh_tmp)


def build_sandbag_wall_curved(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """Curved 5-course stacked burlap sandbag firing emplacement (~2.5m wide, 0.95m crouch cover)."""
    root = create_empty_root(
        "COV_Sandbag_Wall_Curved",
        collection,
        extras={"asset_category": "cover_sandbag", "cover_height": 0.95, "destructible": True, "hp": 140},
    )
    bm = bmesh.new()
    radius = 2.6
    arc_span = math.radians(52.0)
    n_courses = 5
    layer_h = 0.175

    bag_seed = 300
    for row in range(n_courses):
        n_bags = 5 if (row % 2 == 0) else 4
        z_c = row * layer_h + 0.095
        for i in range(n_bags):
            t = (i + 0.5) / n_bags - 0.5
            ang = t * arc_span
            bx = math.sin(ang) * radius
            by = (math.cos(ang) - 1.0) * radius
            _add_sandbag_to_bm(
                bm,
                center=(bx, by, z_c),
                rot_z=-ang + float(np.sin(bag_seed) * 0.05),
                length=0.58,
                width=0.36,
                height=0.19,
                seed=bag_seed,
            )
            bag_seed += 1

    finalize_bmesh_object(
        "COV_Sandbag_Wall_Curved_Mesh",
        bm,
        [mats["burlap"]],
        collection,
        parent=root,
        uv_scale=1.2,
        shade_smooth=True,
        extras={"destructible": True, "hp": 140},
    )
    return root


def _build_shipping_container_20ft(
    name: str,
    body_mat: bpy.types.Material,
    collection: bpy.types.Collection,
    mats: dict,
) -> bpy.types.Object:
    """
    True ISO 20ft Shipping Container (6.06m x 2.44m x 2.59m) with 3D trapezoidal
    corrugated side/roof steel panels, corner twist-lock castings, and rear cargo doors
    with 4 vertical steel locking bars & hinges.
    """
    root = create_empty_root(
        name,
        collection,
        extras={
            "asset_category": "cover_container",
            "dimensions": [6.06, 2.44, 2.59],
            "destructible": False,
        },
    )
    bm = bmesh.new()
    L, W, H = 6.06, 2.44, 2.59
    hl, hw = L * 0.5, W * 0.5
    beam = 0.11

    # 1. Structural perimeter steel frame rails (mat 0 = body_mat, mat 1 = steel_dark)
    # Bottom & top longitudinal rails
    for sy in (-1.0, 1.0):
        add_box_to_bm(bm, (0.0, sy * (hw - beam * 0.5), beam * 0.5), (L - 0.24, beam, beam), mat_index=0)
        add_box_to_bm(bm, (0.0, sy * (hw - beam * 0.5), H - beam * 0.5), (L - 0.24, beam, beam), mat_index=0)
    # Front & rear cross rails + 4 corner vertical posts
    for sx in (-1.0, 1.0):
        add_box_to_bm(bm, (sx * (hl - beam * 0.5), 0.0, beam * 0.5), (beam, W - 0.24, beam), mat_index=0)
        add_box_to_bm(bm, (sx * (hl - beam * 0.5), 0.0, H - beam * 0.5), (beam, W - 0.24, beam), mat_index=0)
        for sy in (-1.0, 1.0):
            add_box_to_bm(
                bm,
                (sx * (hl - beam * 0.5), sy * (hw - beam * 0.5), H * 0.5),
                (beam, beam, H - 0.24),
                mat_index=0,
            )
            # 8 Heavy ISO Corner Castings (dark steel)
            for sz_c in (0.065, H - 0.065):
                add_box_to_bm(
                    bm,
                    (sx * (hl - 0.06), sy * (hw - 0.06), sz_c),
                    (0.14, 0.14, 0.14),
                    mat_index=1,
                )

    # Solid inner floor/core box so container is completely light-tight
    add_box_to_bm(bm, (0.0, 0.0, H * 0.5), (L - 0.14, W - 0.14, H - 0.12), mat_index=0)

    # 2. Trapezoidal Corrugated Ribs along both side walls (-Y and +Y)
    n_ribs = 22
    rib_span = L - 0.36
    dx = rib_span / n_ribs
    rib_h = H - 2.0 * beam
    for i in range(n_ribs):
        rx = -rib_span * 0.5 + (i + 0.5) * dx
        if i % 2 == 0:
            for sy in (-1.0, 1.0):
                add_box_to_bm(
                    bm,
                    (rx, sy * (hw - 0.035), H * 0.5),
                    (dx * 0.62, 0.045, rib_h),
                    mat_index=0,
                )
            # Roof transverse corrugation ribs
            add_box_to_bm(
                bm,
                (rx, 0.0, H - 0.035),
                (dx * 0.60, W - 0.24, 0.04),
                mat_index=0,
            )

    # 3. Front end wall (-X) vertical corrugations
    for j in range(9):
        ry = -hw + 0.22 + j * ((W - 0.44) / 8.0)
        if j % 2 == 0:
            add_box_to_bm(bm, (-hl + 0.035, ry, H * 0.5), (0.045, 0.13, rib_h), mat_index=0)

    # 4. Rear Cargo Double Doors (+X) with center seam, hinges, and 4 vertical locking bars
    door_w = (W - 2.0 * beam - 0.04) * 0.5
    for side in (-1.0, 1.0):
        dy = side * (door_w * 0.5 + 0.012)
        add_box_to_bm(bm, (hl - 0.04, dy, H * 0.5), (0.05, door_w, rib_h - 0.02), mat_index=0)
        # 4 heavy hinges per door leaf
        for hz in (0.42, 0.98, 1.60, 2.16):
            add_box_to_bm(bm, (hl - 0.01, side * (hw - beam), hz), (0.05, 0.06, 0.11), mat_index=1)
        # 2 vertical galvanized/dark steel locking rods per door leaf
        for bar_off in (-0.22, 0.22):
            by = dy + bar_off
            add_cylinder_to_bm(bm, (hl + 0.012, by, beam + 0.04), (hl + 0.012, by, H - beam - 0.04), 0.016, 8, 1)
            # Locking handle latch at waist height
            add_box_to_bm(bm, (hl + 0.028, by + 0.06, 1.12), (0.025, 0.14, 0.035), mat_index=1)

    finalize_bmesh_object(
        f"{name}_Mesh",
        bm,
        [body_mat, mats["steel_dark"]],
        collection,
        parent=root,
        uv_scale=0.35,
        bevel_width=0.006,
        extras={"destructible": False, "climbable": True},
    )
    return root


def build_czech_hedgehog(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """Anti-vehicle welded steel I-beam Czech Hedgehog obstacle (1.52m tall)."""
    root = create_empty_root(
        "COV_Czech_Hedgehog",
        collection,
        extras={"asset_category": "anti_vehicle", "destructible": True, "hp": 450},
    )
    bm = bmesh.new()
    beam_len = 1.95
    center_z = 0.76

    # Three mutually orthogonal diagonals rotated so all 3 legs rest symmetrically on ground!
    # Standard cube corner-to-corner or orthogonal axes tilted so (1,1,1) points along +Z:
    u_axes = [
        Vector((1.0, 0.0, 0.0)),
        Vector((0.0, 1.0, 0.0)),
        Vector((0.0, 0.0, 1.0)),
    ]
    up_diag = Vector((1.0, 1.0, 1.0)).normalized()
    rot_to_z = up_diag.rotation_difference(Vector((0.0, 0.0, 1.0))).to_matrix().to_4x4()

    for ax in u_axes:
        # Build an I-beam along X in local space, then orient to rot_to_z @ ax
        dir_w = (rot_to_z.to_3x3() @ ax).normalized()
        quat = Vector((1.0, 0.0, 0.0)).rotation_difference(dir_w)
        eul = quat.to_euler()
        # Web + 2 Flanges of steel I-beam
        add_box_to_bm(bm, (0.0, 0.0, center_z), (beam_len, 0.022, 0.13), mat_index=0, rot_euler=tuple(eul))
        # Offset flanges in local Z of beam
        flange_off = quat @ Vector((0.0, 0.0, 0.062))
        for sign in (-1.0, 1.0):
            fc = Vector((0.0, 0.0, center_z)) + flange_off * sign
            add_box_to_bm(bm, tuple(fc), (beam_len, 0.12, 0.022), mat_index=0, rot_euler=tuple(eul))

    # Central bolted steel gusset collar
    add_box_to_bm(bm, (0.0, 0.0, center_z), (0.28, 0.28, 0.28), mat_index=0, rot_euler=(0.3, 0.4, 0.2))

    finalize_bmesh_object(
        "COV_Czech_Hedgehog_Mesh",
        bm,
        [mats["steel_dark"]],
        collection,
        parent=root,
        uv_scale=0.8,
        bevel_width=0.004,
        extras={"destructible": True, "hp": 450},
    )
    return root


def build_tactical_supply_crate(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """Military hard-case ammo / gadget supply crate (1.15m x 0.70m x 0.56m)."""
    root = create_empty_root(
        "COV_Tactical_Crate",
        collection,
        extras={"asset_category": "gameplay_resupply", "interactive": True, "destructible": True, "hp": 80},
    )
    bm = bmesh.new()
    L, W, H = 1.15, 0.70, 0.56
    # Lower tub & upper lid
    add_box_to_bm(bm, (0.0, 0.0, 0.21), (L, W, 0.42), mat_index=0)
    add_box_to_bm(bm, (0.0, 0.0, 0.49), (L + 0.03, W + 0.03, 0.14), mat_index=0)

    # Top reinforcing ribs
    for rx in (-0.36, 0.0, 0.36):
        add_box_to_bm(bm, (rx, 0.0, H + 0.012), (0.09, W - 0.06, 0.025), mat_index=0)

    # 8 Dark steel corner bumpers + 4 latches + 2 side handles
    for sx in (-1.0, 1.0):
        # Side carry handles
        add_box_to_bm(bm, (sx * (L * 0.5 + 0.02), 0.0, 0.30), (0.03, 0.22, 0.06), mat_index=1)
        for sy in (-1.0, 1.0):
            add_box_to_bm(bm, (sx * (L * 0.5), sy * (W * 0.5), H - 0.05), (0.10, 0.10, 0.12), mat_index=1)
            add_box_to_bm(bm, (sx * (L * 0.5), sy * (W * 0.5), 0.06), (0.10, 0.10, 0.12), mat_index=1)

    for lx in (-0.32, 0.32):
        for sy in (-1.0, 1.0):
            add_box_to_bm(bm, (lx, sy * (W * 0.5 + 0.015), 0.41), (0.07, 0.025, 0.11), mat_index=1)

    # Hazard yellow stencil stripe on front/back lid
    add_box_to_bm(bm, (0.0, -W * 0.5 - 0.018, 0.49), (0.38, 0.008, 0.05), mat_index=2)
    add_box_to_bm(bm, (0.0, W * 0.5 + 0.018, 0.49), (0.38, 0.008, 0.05), mat_index=2)

    finalize_bmesh_object(
        "COV_Tactical_Crate_Mesh",
        bm,
        [mats["metal_olive"], mats["steel_dark"], mats["hazard"]],
        collection,
        parent=root,
        uv_scale=1.0,
        bevel_width=0.005,
    )
    return root


def build_conquest_flagpole(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """
    Battlefield 6 Conquest Capture Point Flagpole (6.5m tall):
      - Heavy concrete ballast base with hazard border
      - Tactical uplink terminal box with glowing Cyan LED display
      - Tapered steel mast + halyard
      - Separate Flag mesh object (`OBJ_Conquest_Flagpole_Banner`) so Three.js can animate flag height (capture progress 0..1)!
    """
    root = create_empty_root(
        "OBJ_Conquest_Flagpole",
        collection,
        extras={
            "asset_category": "gameplay_objective",
            "objective_type": "conquest_flag",
            "flag_min_z": 1.6,
            "flag_max_z": 5.5,
        },
    )
    bm = bmesh.new()

    # Concrete octagonal-like stepped ballast base (mat 0 = concrete_ext, mat 1 = steel_dark, mat 2 = hazard, mat 3 = led_cyan)
    add_cylinder_to_bm(bm, (0.0, 0.0, 0.0), (0.0, 0.0, 0.28), radius=0.78, segments=8, mat_index=0)
    add_cylinder_to_bm(bm, (0.0, 0.0, 0.28), (0.0, 0.0, 0.36), radius=0.80, segments=8, mat_index=2)
    add_cylinder_to_bm(bm, (0.0, 0.0, 0.36), (0.0, 0.0, 0.62), radius=0.52, segments=8, mat_index=1)

    # Steel mast (6.5m tall) + diagonal guy struts
    add_cylinder_to_bm(bm, (0.0, 0.0, 0.60), (0.0, 0.0, 3.80), radius=0.055, segments=12, mat_index=1)
    add_cylinder_to_bm(bm, (0.0, 0.0, 3.80), (0.0, 0.0, 6.50), radius=0.038, segments=10, mat_index=1)
    add_cylinder_to_bm(bm, (0.0, 0.0, 6.50), (0.0, 0.0, 6.62), radius=0.075, segments=10, mat_index=3)  # Top beacon LED!

    for ang_deg in (0, 90, 180, 270):
        rad = math.radians(ang_deg)
        bx, by = math.cos(rad) * 0.46, math.sin(rad) * 0.46
        add_cylinder_to_bm(bm, (bx, by, 0.58), (0.0, 0.0, 1.35), radius=0.022, segments=6, mat_index=1)

    # Tactical Radio Uplink Box mounted at Z=1.25m on -Y side with glowing LED screen
    add_box_to_bm(bm, (0.0, -0.22, 1.25), (0.42, 0.26, 0.52), mat_index=1)
    add_box_to_bm(bm, (0.0, -0.355, 1.32), (0.28, 0.02, 0.18), mat_index=3)  # Glowing Cyan Terminal Screen
    add_cylinder_to_bm(bm, (0.16, -0.22, 1.51), (0.16, -0.22, 2.05), radius=0.008, segments=6, mat_index=1)

    finalize_bmesh_object(
        "OBJ_Conquest_Flagpole_Mast",
        bm,
        [mats["concrete_ext"], mats["steel_dark"], mats["hazard"], mats["led_cyan"]],
        collection,
        parent=root,
        uv_scale=0.7,
        bevel_width=0.005,
    )

    # Separate Wind-Rippled Banner Mesh at Z=5.55m so game code can raise/lower it along Z during capture!
    bm_flag = bmesh.new()
    nx_f, nz_f = 12, 6
    fw, fh = 1.65, 0.95
    verts_grid = []
    for ix in range(nx_f + 1):
        u = ix / nx_f
        col_v = []
        for iz in range(nz_f + 1):
            v = iz / nz_f
            fx = 0.05 + u * fw
            # Progressive wind wave along +X
            fy = math.sin(u * math.pi * 2.5) * (0.12 * u) + math.cos(v * math.pi) * (0.03 * u)
            fz = (v - 0.5) * fh - 0.06 * (u * u)
            col_v.append(bm_flag.verts.new((fx, fy, fz)))
        verts_grid.append(col_v)

    uv_layer = bm_flag.loops.layers.uv.verify()
    for ix in range(nx_f):
        for iz in range(nz_f):
            v00 = verts_grid[ix][iz]
            v10 = verts_grid[ix + 1][iz]
            v11 = verts_grid[ix + 1][iz + 1]
            v01 = verts_grid[ix][iz + 1]
            f = bm_flag.faces.new((v00, v10, v11, v01))
            f.material_index = 0
            for loop, (uu, vv) in zip(
                f.loops,
                [
                    (ix / nx_f, iz / nz_f),
                    ((ix + 1) / nx_f, iz / nz_f),
                    ((ix + 1) / nx_f, (iz + 1) / nz_f),
                    (ix / nx_f, (iz + 1) / nz_f),
                ],
            ):
                loop[uv_layer].uv = (uu, vv)

    # Give slight thickness via solidify or back faces so flag is visible from both sides in Three.js!
    bmesh.ops.solidify(bm_flag, geom=list(bm_flag.faces), thickness=0.008)
    bmesh.ops.recalc_face_normals(bm_flag, faces=bm_flag.faces)

    flag_mesh = bpy.data.meshes.new("OBJ_Conquest_Flagpole_Banner")
    bm_flag.to_mesh(flag_mesh)
    bm_flag.free()
    flag_mesh.materials.append(mats["flag_nato"])
    for poly in flag_mesh.polygons:
        poly.use_smooth = True

    flag_obj = bpy.data.objects.new("OBJ_Conquest_Flagpole_Banner", flag_mesh)
    flag_obj.location = (0.0, 0.0, 5.55)
    flag_obj.parent = root
    flag_obj["animatable_part"] = "capture_banner"
    collection.objects.link(flag_obj)

    return root


def build_all_tactical_cover(collection: bpy.types.Collection, mats: dict) -> dict[str, bpy.types.Object]:
    """Create all 8 military cover, container & objective assets."""
    return {
        "COV_Hesco_Single": build_hesco_single(collection, mats),
        "COV_Hesco_Wall_3x": build_hesco_wall_3x(collection, mats),
        "COV_Jersey_Barrier_3m": build_jersey_barrier(collection, mats),
        "COV_Sandbag_Wall_Curved": build_sandbag_wall_curved(collection, mats),
        "COV_Container_20ft_Olive": _build_shipping_container_20ft(
            "COV_Container_20ft_Olive", mats["metal_olive"], collection, mats
        ),
        "COV_Container_20ft_Blue": _build_shipping_container_20ft(
            "COV_Container_20ft_Blue", mats["metal_blue"], collection, mats
        ),
        "COV_Czech_Hedgehog": build_czech_hedgehog(collection, mats),
        "COV_Tactical_Crate": build_tactical_supply_crate(collection, mats),
        "OBJ_Conquest_Flagpole": build_conquest_flagpole(collection, mats),
    }
