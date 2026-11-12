"""
Modular Tactical Destructible Building Kit (4.0m x 3.6m Metric Grid) for BF6 Prototype.
Every wall panel uses watertight interlocking Voronoi-style concrete chunks with
3D jagged fracture seams and embedded rusted steel rebar stubs so hiding/detaching
any chunk immediately reveals realistic Frostbite-style battle damage.
"""

import math
import numpy as np
import bpy
import bmesh
from mathutils import Vector

from mesh_utils import (
    add_box_to_bm,
    add_cylinder_to_bm,
    create_empty_root,
    finalize_bmesh_object,
)


def _build_fractured_wall_panel(
    prefab_name: str,
    collection: bpy.types.Collection,
    mats: dict[str, bpy.types.Material],
    seed: int,
    Seeds_xz: list[tuple[float, float]],
    hole_cells: tuple[int, int, int, int] | None = None,
) -> bpy.types.Object:
    """
    Build a 4.0m wide x 3.6m tall modular wall root Empty containing:
      - Top reinforced structural concrete header beam (Z = 3.32..3.60m, destructible=False)
      - Interlocking watertight Voronoi-fractured concrete chunks (Z = 0.00..3.32m, destructible=True)
        with MAT_Concrete_Exterior (-Y), MAT_Plaster_Interior (+Y), MAT_Concrete_Broken on
        jagged internal fracture seams, and protruding rusted steel rebar stubs.
    hole_cells: optional (ix0, ix1, iz0, iz1) rectangular opening for windows or doors.
    """
    root = create_empty_root(
        prefab_name,
        collection,
        extras={
            "asset_category": "building_wall",
            "grid_width": 4.0,
            "grid_height": 3.6,
            "destructible_container": True,
        },
    )

    # 1. Structural Reinforced Ring Beam (Z: 3.32 -> 3.60)
    bm_beam = bmesh.new()
    add_box_to_bm(bm_beam, (0.0, 0.0, 3.46), (4.0, 0.30, 0.28), mat_index=0)
    # Steel tie plates at ends
    add_box_to_bm(bm_beam, (-1.92, 0.0, 3.46), (0.14, 0.32, 0.20), mat_index=1)
    add_box_to_bm(bm_beam, (1.92, 0.0, 3.46), (0.14, 0.32, 0.20), mat_index=1)
    finalize_bmesh_object(
        f"{prefab_name}_HeaderBeam",
        bm_beam,
        [mats["concrete_ext"], mats["steel_dark"]],
        collection,
        parent=root,
        bevel_width=0.008,
        extras={"destructible": False, "structural": True},
    )

    # 2. Grid setup over X in [-2.0, 2.0], Z in [0.0, 3.32]
    nx, nz = 20, 16
    xs = np.linspace(-2.0, 2.0, nx + 1)
    zs = np.linspace(0.0, 3.32, nz + 1)
    half_thick = 0.14

    rng = np.random.default_rng(seed)

    # Determine pinned vertices (outer boundary + opening perimeter)
    pinned = np.zeros((nx + 1, nz + 1), dtype=bool)
    pinned[0, :] = True
    pinned[nx, :] = True
    pinned[:, 0] = True
    pinned[:, nz] = True

    if hole_cells is not None:
        hx0, hx1, hz0, hz1 = hole_cells
        for ix in range(hx0, hx1 + 1):
            for iz in range(hz0, hz1 + 1):
                if ix in (hx0, hx1) or iz in (hz0, hz1):
                    pinned[ix, iz] = True

    # Perturb interior grid vertices for organic jagged cracks
    vx = np.broadcast_to(xs[:, None], (nx + 1, nz + 1)).copy()
    vz = np.broadcast_to(zs[None, :], (nx + 1, nz + 1)).copy()
    mx = vx.copy()
    mz = vz.copy()

    jx = rng.uniform(-0.052, 0.052, size=(nx + 1, nz + 1))
    jz = rng.uniform(-0.052, 0.052, size=(nx + 1, nz + 1))
    rx = rng.uniform(-0.042, 0.042, size=(nx + 1, nz + 1))
    rz = rng.uniform(-0.042, 0.042, size=(nx + 1, nz + 1))

    mask = ~pinned
    vx[mask] += jx[mask]
    vz[mask] += jz[mask]
    mx[mask] = vx[mask] + rx[mask]
    mz[mask] = vz[mask] + rz[mask]

    # Assign each cell (ix, iz) to nearest Voronoi seed (-1 for hole cells)
    cell_chunk = np.full((nx, nz), -1, dtype=np.int32)
    cell_noise = rng.uniform(-0.18, 0.18, size=(nx, nz))
    for ix in range(nx):
        for iz in range(nz):
            if hole_cells is not None:
                hx0, hx1, hz0, hz1 = hole_cells
                if hx0 <= ix < hx1 and hz0 <= iz < hz1:
                    continue
            cx = 0.5 * (xs[ix] + xs[ix + 1])
            cz = 0.5 * (zs[iz] + zs[iz + 1])
            best_k = 0
            best_d = 1e9
            for k, (sx, sz) in enumerate(Seeds_xz):
                d = math.hypot(cx - sx, cz - sz) + cell_noise[ix, iz] * 0.15
                if d < best_d:
                    best_d = d
                    best_k = k
            cell_chunk[ix, iz] = best_k

    # Material list for wall chunks:
    # 0: concrete_ext (-Y & outer jambs)
    # 1: plaster_int (+Y)
    # 2: concrete_broken (internal jagged fracture seam)
    # 3: rebar_rust (protruding steel rebar stubs)
    chunk_mats = [
        mats["concrete_ext"],
        mats["plaster_int"],
        mats["concrete_broken"],
        mats["rebar_rust"],
    ]

    for k in range(len(Seeds_xz)):
        cells_k = [(ix, iz) for ix in range(nx) for iz in range(nz) if cell_chunk[ix, iz] == k]
        if not cells_k:
            continue
        cell_set = set(cells_k)
        bm = bmesh.new()

        v_front: dict[tuple[int, int], bmesh.types.BMVert] = {}
        v_mid: dict[tuple[int, int], bmesh.types.BMVert] = {}
        v_back: dict[tuple[int, int], bmesh.types.BMVert] = {}

        def get_f(i: int, j: int) -> bmesh.types.BMVert:
            if (i, j) not in v_front:
                v_front[(i, j)] = bm.verts.new((float(vx[i, j]), -half_thick, float(vz[i, j])))
            return v_front[(i, j)]

        def get_m(i: int, j: int) -> bmesh.types.BMVert:
            if (i, j) not in v_mid:
                v_mid[(i, j)] = bm.verts.new((float(mx[i, j]), 0.0, float(mz[i, j])))
            return v_mid[(i, j)]

        def get_b(i: int, j: int) -> bmesh.types.BMVert:
            if (i, j) not in v_back:
                v_back[(i, j)] = bm.verts.new((float(vx[i, j]), half_thick, float(vz[i, j])))
            return v_back[(i, j)]

        rebar_candidates: list[tuple[Vector, Vector]] = []

        for ix, iz in cells_k:
            # Front (-Y exterior) & Back (+Y interior) quads
            f00, f10, f11, f01 = get_f(ix, iz), get_f(ix + 1, iz), get_f(ix + 1, iz + 1), get_f(ix, iz + 1)
            face_ext = bm.faces.new((f00, f10, f11, f01))
            face_ext.material_index = 0

            b00, b10, b11, b01 = get_b(ix, iz), get_b(ix + 1, iz), get_b(ix + 1, iz + 1), get_b(ix, iz + 1)
            face_int = bm.faces.new((b00, b01, b11, b10))
            face_int.material_index = 1

            # Check 4 neighbor directions for boundary side faces
            neighbors = [
                ((ix, iz - 1), (ix, iz), (ix + 1, iz)),          # bottom edge
                ((ix + 1, iz), (ix + 1, iz), (ix + 1, iz + 1)),  # right edge
                ((ix, iz + 1), (ix + 1, iz + 1), (ix, iz + 1)),  # top edge
                ((ix - 1, iz), (ix, iz + 1), (ix, iz)),          # left edge
            ]
            for (nix, niz), pA, pB in neighbors:
                if (nix, niz) in cell_set:
                    continue
                # Is this an internal fracture between two destructible chunks, or an outer/opening frame edge?
                is_outer = (nix < 0 or nix >= nx or niz < 0 or niz >= nz)
                is_hole = False
                if not is_outer and cell_chunk[nix, niz] == -1:
                    is_hole = True
                is_fracture = not (is_outer or is_hole)
                mat_idx = 2 if is_fracture else 0

                fa, fb = get_f(*pA), get_f(*pB)
                ma, mb = get_m(*pA), get_m(*pB)
                ba, bb = get_b(*pA), get_b(*pB)

                sf1 = bm.faces.new((fa, mb, ma) if fa == fb else (fa, fb, mb, ma))
                sf2 = bm.faces.new((ma, bb, ba) if ma == mb else (ma, mb, bb, ba))
                sf1.material_index = mat_idx
                sf2.material_index = mat_idx

                if is_fracture:
                    mid_pt = (ma.co + mb.co) * 0.5
                    # Outward direction in XZ plane from cell center toward neighbor
                    c_center = Vector((0.5 * (xs[ix] + xs[ix + 1]), 0.0, 0.5 * (zs[iz] + zs[iz + 1])))
                    out_dir = (Vector((mid_pt.x, 0.0, mid_pt.z)) - c_center)
                    if out_dir.length > 1e-4:
                        rebar_candidates.append((mid_pt.copy(), out_dir.normalized()))

        # Add 2-3 protruding rusted steel rebar stubs per chunk along internal fracture edges
        # Positioned within y = ±0.045 so they stay completely hidden inside adjacent intact chunks!
        if rebar_candidates:
            step = max(1, len(rebar_candidates) // 3)
            for idx_r, (mpt, odir) in enumerate(rebar_candidates[::step][:3]):
                y_off = -0.042 if (idx_r % 2 == 0) else 0.042
                tilt = Vector((
                    float(rng.uniform(-0.15, 0.15)),
                    float(rng.uniform(-0.08, 0.08)),
                    float(rng.uniform(-0.15, 0.15)),
                ))
                d_vec = (odir + tilt).normalized()
                p_start = Vector((mpt.x, y_off, mpt.z)) - odir * 0.06
                p_end = Vector((mpt.x, y_off, mpt.z)) + d_vec * 0.14
                add_cylinder_to_bm(bm, tuple(p_start), tuple(p_end), radius=0.011, segments=6, mat_index=3)

        finalize_bmesh_object(
            f"{prefab_name}_Chunk_{k + 1:02d}",
            bm,
            chunk_mats,
            collection,
            parent=root,
            uv_scale=0.5,
            bevel_width=0.0,
            extras={
                "destructible": True,
                "hp": 120,
                "chunk_index": k + 1,
                "material_type": "reinforced_concrete",
            },
        )

    return root


def build_foundation_4x4(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """4.0m x 4.0m x 0.30m concrete tactical building foundation with beveled perimeter curb."""
    root = create_empty_root(
        "BLD_Foundation_4x4",
        collection,
        extras={"asset_category": "building_floor", "grid_size": 4.0, "destructible": False},
    )
    bm = bmesh.new()
    # Main slab Z in [-0.25, 0.0] + slight raised 0.04m floor apron or flush Z=0 top
    add_box_to_bm(bm, (0.0, 0.0, -0.15), (4.0, 4.0, 0.30), mat_index=0)
    # Perimeter steel edge trim
    for sign in (-1.0, 1.0):
        add_box_to_bm(bm, (0.0, sign * 1.99, -0.03), (4.02, 0.04, 0.06), mat_index=1)
        add_box_to_bm(bm, (sign * 1.99, 0.0, -0.03), (0.04, 4.02, 0.06), mat_index=1)

    finalize_bmesh_object(
        "BLD_Foundation_4x4_Mesh",
        bm,
        [mats["concrete_ext"], mats["steel_dark"]],
        collection,
        parent=root,
        bevel_width=0.01,
        extras={"destructible": False, "structural": True},
    )
    return root


def build_floorslab_4x4(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """4.0m x 4.0m upper floor / roof slab with underside structural concrete ribs."""
    root = create_empty_root(
        "BLD_FloorSlab_4x4",
        collection,
        extras={"asset_category": "building_floor", "grid_size": 4.0, "destructible": False},
    )
    bm = bmesh.new()
    add_box_to_bm(bm, (0.0, 0.0, -0.11), (4.0, 4.0, 0.22), mat_index=0)
    # Underside steel/concrete support joists
    for y_rib in (-1.2, 0.0, 1.2):
        add_box_to_bm(bm, (0.0, y_rib, -0.26), (3.85, 0.16, 0.10), mat_index=1)

    finalize_bmesh_object(
        "BLD_FloorSlab_4x4_Mesh",
        bm,
        [mats["concrete_ext"], mats["steel_dark"]],
        collection,
        parent=root,
        bevel_width=0.008,
        extras={"destructible": False, "structural": True},
    )
    return root


def build_pillar_3m6(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """Indestructible 0.36m x 0.36m x 3.60m structural corner column with steel base & cap."""
    root = create_empty_root(
        "BLD_Pillar_3m6",
        collection,
        extras={"asset_category": "building_pillar", "height": 3.6, "destructible": False},
    )
    bm = bmesh.new()
    add_box_to_bm(bm, (0.0, 0.0, 1.80), (0.36, 0.36, 3.60), mat_index=0)
    # Base steel boot & top steel collar
    add_box_to_bm(bm, (0.0, 0.0, 0.12), (0.40, 0.40, 0.24), mat_index=1)
    add_box_to_bm(bm, (0.0, 0.0, 3.48), (0.40, 0.40, 0.24), mat_index=1)
    # Corner protective steel angles
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            add_box_to_bm(bm, (sx * 0.18, sy * 0.18, 1.80), (0.04, 0.04, 3.10), mat_index=1)

    finalize_bmesh_object(
        "BLD_Pillar_3m6_Mesh",
        bm,
        [mats["concrete_ext"], mats["steel_dark"]],
        collection,
        parent=root,
        bevel_width=0.008,
        extras={"destructible": False, "structural": True},
    )
    return root


def build_wall_solid_4m(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """Solid 4.0m x 3.6m destructible concrete wall split into 6 interlocking Voronoi chunks."""
    seeds = [
        (-1.32, 0.82),
        (0.02, 0.78),
        (1.34, 0.85),
        (-1.28, 2.45),
        (0.05, 2.50),
        (1.30, 2.42),
    ]
    return _build_fractured_wall_panel(
        "BLD_Wall_Solid_4m",
        collection,
        mats,
        seed=5001,
        Seeds_xz=seeds,
        hole_cells=None,
    )


def build_wall_window_4m(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """4.0m x 3.6m tactical firing-window wall (sill Z=1.04m crouch cover) + destructible frame & chunks."""
    # Hole: ix in [6, 14] -> X in [-0.80, +0.80]; iz in [5, 12] -> Z in [1.04, 2.49]
    seeds = [
        (-1.45, 1.75),  # Left pier
        (1.45, 1.75),   # Right pier
        (-0.55, 0.50),  # Bottom-left sill cover (can be blown out!)
        (0.55, 0.50),   # Bottom-right sill cover
        (0.0, 2.95),    # Upper lintel panel
    ]
    root = _build_fractured_wall_panel(
        "BLD_Wall_Window_4m",
        collection,
        mats,
        seed=5002,
        Seeds_xz=seeds,
        hole_cells=(6, 14, 5, 12),
    )

    # Add tactical steel window frame + concrete sill ledge
    bm_frame = bmesh.new()
    z_bot, z_top = 5 * (3.32 / 16.0), 12 * (3.32 / 16.0)
    x_l, x_r = -0.80, 0.80
    # Concrete exterior sill lip
    add_box_to_bm(bm_frame, (0.0, -0.02, z_bot + 0.02), (1.72, 0.36, 0.05), mat_index=1)
    # Steel window casing & center mullion
    add_box_to_bm(bm_frame, (0.0, 0.0, z_top - 0.025), (1.60, 0.12, 0.05), mat_index=0)
    add_box_to_bm(bm_frame, (x_l + 0.025, 0.0, 0.5 * (z_bot + z_top)), (0.05, 0.12, z_top - z_bot), mat_index=0)
    add_box_to_bm(bm_frame, (x_r - 0.025, 0.0, 0.5 * (z_bot + z_top)), (0.05, 0.12, z_top - z_bot), mat_index=0)
    add_box_to_bm(bm_frame, (0.0, 0.0, 0.5 * (z_bot + z_top)), (0.04, 0.08, z_top - z_bot), mat_index=0)

    finalize_bmesh_object(
        "BLD_Wall_Window_4m_Frame",
        bm_frame,
        [mats["steel_dark"], mats["concrete_ext"]],
        collection,
        parent=root,
        bevel_width=0.005,
        extras={"destructible": True, "hp": 60, "material_type": "steel"},
    )
    return root


def build_wall_door_4m(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """4.0m x 3.6m tactical doorway wall (1.20m x 2.28m opening) with armored steel doorframe."""
    # Hole: ix in [7, 13] -> X in [-0.60, +0.60]; iz in [0, 11] -> Z in [0.0, 2.28]
    seeds = [
        (-1.35, 0.75),
        (-1.35, 2.25),
        (1.35, 0.75),
        (1.35, 2.25),
        (0.0, 2.85),
    ]
    root = _build_fractured_wall_panel(
        "BLD_Wall_Door_4m",
        collection,
        mats,
        seed=5003,
        Seeds_xz=seeds,
        hole_cells=(7, 13, 0, 11),
    )

    z_top = 11 * (3.32 / 16.0)
    bm_df = bmesh.new()
    add_box_to_bm(bm_df, (-0.57, 0.0, z_top * 0.5), (0.06, 0.32, z_top), mat_index=0)
    add_box_to_bm(bm_df, (0.57, 0.0, z_top * 0.5), (0.06, 0.32, z_top), mat_index=0)
    add_box_to_bm(bm_df, (0.0, 0.0, z_top - 0.03), (1.26, 0.32, 0.06), mat_index=0)

    finalize_bmesh_object(
        "BLD_Wall_Door_4m_SteelFrame",
        bm_df,
        [mats["steel_dark"]],
        collection,
        parent=root,
        bevel_width=0.006,
        extras={"destructible": True, "hp": 150, "material_type": "steel"},
    )
    return root


def build_stairs_4m(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """Tactical interior/exterior concrete & steel staircase (1.6m wide, 4.0m run, 3.6m rise)."""
    root = create_empty_root(
        "BLD_Stairs_4m",
        collection,
        extras={"asset_category": "building_stairs", "run": 4.0, "rise": 3.6, "destructible": False},
    )
    bm = bmesh.new()
    n_steps = 14
    width = 1.60
    run_total = 3.80
    rise_total = 3.60
    dx = run_total / n_steps
    dz = rise_total / n_steps

    # Steps along X from -1.90 to +1.90, rising Z from 0 to 3.60
    for i in range(n_steps):
        cx = -1.90 + (i + 0.5) * dx
        cz = (i + 0.5) * dz
        add_box_to_bm(bm, (cx, 0.0, cz), (dx + 0.03, width, dz), mat_index=0)
        # Anti-slip steel nosing strip on each step front
        add_box_to_bm(bm, (cx - dx * 0.48, 0.0, cz + dz * 0.46), (0.035, width - 0.04, 0.025), mat_index=1)

    # Angled side steel stringer beams
    slope_angle = -math.atan2(rise_total, run_total)
    diag_len = math.hypot(run_total, rise_total)
    for sy in (-width * 0.5 - 0.04, width * 0.5 + 0.04):
        add_box_to_bm(
            bm,
            (0.0, sy, rise_total * 0.5 - 0.08),
            (diag_len, 0.07, 0.22),
            mat_index=1,
            rot_euler=(0.0, slope_angle, 0.0),
        )

    # Industrial safety handrail on +Y side (mat_index=2 hazard yellow/black)
    rail_y = width * 0.5 + 0.04
    for post_t in (0.05, 0.35, 0.65, 0.95):
        px = -1.90 + post_t * run_total
        pz = post_t * rise_total
        add_cylinder_to_bm(bm, (px, rail_y, pz), (px, rail_y, pz + 0.95), 0.022, segments=8, mat_index=1)

    p_top0 = (-1.90, rail_y, 0.95)
    p_top1 = (1.90, rail_y, rise_total + 0.95)
    p_mid0 = (-1.90, rail_y, 0.50)
    p_mid1 = (1.90, rail_y, rise_total + 0.50)
    add_cylinder_to_bm(bm, p_top0, p_top1, 0.026, segments=8, mat_index=2)
    add_cylinder_to_bm(bm, p_mid0, p_mid1, 0.018, segments=8, mat_index=1)

    finalize_bmesh_object(
        "BLD_Stairs_4m_Mesh",
        bm,
        [mats["concrete_ext"], mats["steel_dark"], mats["hazard"]],
        collection,
        parent=root,
        bevel_width=0.006,
        extras={"destructible": False, "structural": True},
    )
    return root


def build_roof_parapet_4m(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """4.0m x 1.08m rooftop sniper cover parapet wall (destructible into 3 segments)."""
    root = create_empty_root(
        "BLD_Roof_Parapet_4m",
        collection,
        extras={"asset_category": "building_roof", "cover_height": 1.08, "destructible_container": True},
    )
    seg_w = 4.0 / 3.0
    for i in range(3):
        cx = -2.0 + (i + 0.5) * seg_w
        bm = bmesh.new()
        # Wall body
        add_box_to_bm(bm, (cx, 0.0, 0.50), (seg_w - 0.008, 0.26, 1.00), mat_index=0)
        # Concrete coping top cap
        add_box_to_bm(bm, (cx, 0.0, 1.04), (seg_w - 0.004, 0.32, 0.08), mat_index=0)
        # Interior steel brace bracket
        add_box_to_bm(bm, (cx, 0.16, 0.22), (0.06, 0.12, 0.44), mat_index=1)
        finalize_bmesh_object(
            f"BLD_Roof_Parapet_4m_Seg_{i + 1:02d}",
            bm,
            [mats["concrete_ext"], mats["steel_dark"]],
            collection,
            parent=root,
            bevel_width=0.008,
            extras={"destructible": True, "hp": 90, "cover_type": "crouch"},
        )
    return root


def build_rubble_pile(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """Battlefield destruction rubble mound with jagged concrete slabs & twisted rusted rebar."""
    root = create_empty_root(
        "BLD_Rubble_Pile",
        collection,
        extras={"asset_category": "destruction_debris", "destructible": False},
    )
    bm = bmesh.new()
    rng = np.random.default_rng(777)

    # Low gravel/dust mound base (squashed dome)
    ret = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    for v in ret["verts"]:
        n_val = 0.85 + 0.30 * math.sin(v.co.x * 5.0) * math.cos(v.co.y * 4.0)
        v.co.x *= 1.45 * n_val
        v.co.y *= 1.05 * n_val
        v.co.z = max(0.0, v.co.z * 0.36 * n_val)
    vset = set(ret["verts"])
    for f in bm.faces:
        if all(v in vset for v in f.verts):
            f.material_index = 0

    # Scattered broken concrete chunks
    for _ in range(11):
        cx = float(rng.uniform(-1.05, 1.05))
        cy = float(rng.uniform(-0.70, 0.70))
        cz = float(rng.uniform(0.08, 0.28))
        sx = float(rng.uniform(0.22, 0.55))
        sy = float(rng.uniform(0.18, 0.42))
        sz = float(rng.uniform(0.10, 0.22))
        rot = (
            float(rng.uniform(-0.5, 0.5)),
            float(rng.uniform(-0.5, 0.5)),
            float(rng.uniform(0, math.pi)),
        )
        add_box_to_bm(bm, (cx, cy, cz), (sx, sy, sz), mat_index=1, rot_euler=rot)

    # Twisted rebar rods sticking out of rubble
    for _ in range(5):
        x0, y0 = float(rng.uniform(-0.6, 0.6)), float(rng.uniform(-0.4, 0.4))
        x1 = x0 + float(rng.uniform(-0.45, 0.45))
        y1 = y0 + float(rng.uniform(-0.45, 0.45))
        z1 = float(rng.uniform(0.32, 0.62))
        add_cylinder_to_bm(bm, (x0, y0, 0.05), (x1, y1, z1), 0.012, segments=6, mat_index=2)

    finalize_bmesh_object(
        "BLD_Rubble_Pile_Mesh",
        bm,
        [mats["sand_earth"], mats["concrete_broken"], mats["rebar_rust"]],
        collection,
        parent=root,
        uv_scale=0.6,
        bevel_width=0.0,
    )
    return root


def build_all_modular_buildings(collection: bpy.types.Collection, mats: dict) -> dict[str, bpy.types.Object]:
    """Create all 9 modular destructible building assets in the given collection."""
    prefabs = {
        "BLD_Foundation_4x4": build_foundation_4x4(collection, mats),
        "BLD_FloorSlab_4x4": build_floorslab_4x4(collection, mats),
        "BLD_Pillar_3m6": build_pillar_3m6(collection, mats),
        "BLD_Wall_Solid_4m": build_wall_solid_4m(collection, mats),
        "BLD_Wall_Window_4m": build_wall_window_4m(collection, mats),
        "BLD_Wall_Door_4m": build_wall_door_4m(collection, mats),
        "BLD_Stairs_4m": build_stairs_4m(collection, mats),
        "BLD_Roof_Parapet_4m": build_roof_parapet_4m(collection, mats),
        "BLD_Rubble_Pile": build_rubble_pile(collection, mats),
    }
    return prefabs
