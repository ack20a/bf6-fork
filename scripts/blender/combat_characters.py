"""
Battlefield 6 Tactical Character & FPS Viewmodel Arms Rig Builder (Blender 5.x -> glTF SkinnedMesh).
Builds:
  1. CHR_Soldier_NATO_Assault (1.80m 3rd-person NATO MultiCam + Coyote Plate Carrier + FAST NVG Helmet)
  2. CHR_Soldier_PAX_OpFor    (1.80m 3rd-person OpFor Charcoal-Slate + Olive Armor + Visor Helmet)
  3. CHR_FPS_Arms_Rig         (1st-person Viewmodel Sleeves + Tactical Watch + Articulated Gloves + Weapon_Mount)

All characters export as true glTF SkinnedMesh (`JOINTS_0`/`WEIGHTS_0`) with embedded NLA AnimationClips!
"""

import math
import bpy
import bmesh
from mathutils import Vector, Matrix

from mesh_utils import apply_box_uv


# ==============================================================================
# WEIGHTED MESH ACCUMULATOR (Analytical Watertight Skinning — Zero Bone-Heat Bugs)
# ==============================================================================
class SkinnedMeshBuilder:
    """Accumulates BMesh parts together with exact per-vertex bone weights {(bone_name): weight}."""

    def __init__(self) -> None:
        self.bm = bmesh.new()
        self.vert_weights: list[dict[str, float]] = []

    def _record_new_verts(self, start_idx: int, weight_fn) -> None:
        self.bm.verts.ensure_lookup_table()
        for idx in range(start_idx, len(self.bm.verts)):
            v = self.bm.verts[idx]
            w = weight_fn(v.co)
            # Normalize
            tot = sum(w.values())
            if tot > 1e-6:
                w = {k: val / tot for k, val in w.items() if val > 1e-4}
            self.vert_weights.append(w)

    def add_box(
        self,
        center: tuple[float, float, float],
        size: tuple[float, float, float],
        mat_index: int,
        weights: object,
        rot_euler: tuple[float, float, float] | None = None,
        bevel: float = 0.0,
    ) -> None:
        tmp = bmesh.new()
        sx, sy, sz = size
        mat = Matrix.Translation(Vector(center))
        if rot_euler is not None:
            rx, ry, rz = rot_euler
            mat = mat @ (
                Matrix.Rotation(rz, 4, "Z")
                @ Matrix.Rotation(ry, 4, "Y")
                @ Matrix.Rotation(rx, 4, "X")
            )
        bmesh.ops.create_cube(tmp, size=1.0, matrix=mat @ Matrix.Diagonal((sx, sy, sz, 1.0)))
        if bevel > 0.0:
            bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=bevel, segments=1, affect="EDGES")
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
        for f in tmp.faces:
            f.material_index = mat_index

        self._merge_tmp(tmp, weights)

    def add_limb_tube(
        self,
        p0: tuple[float, float, float],
        p1: tuple[float, float, float],
        r0: float,
        r1: float,
        mat_index: int,
        weights: object,
        segments: int = 10,
        rings: int = 3,
        scale_xy: tuple[float, float] = (1.0, 1.0),
    ) -> None:
        """Create a multi-ring tapered limb cylinder from p0 to p1 so joints deform smoothly."""
        tmp = bmesh.new()
        v0 = Vector(p0)
        v1 = Vector(p1)
        diff = v1 - v0
        length = diff.length
        z_ax = Vector((0.0, 0.0, 1.0))
        quat = z_ax.rotation_difference(diff.normalized())
        rot_m = quat.to_matrix()

        ring_verts = []
        for r_i in range(rings + 1):
            t = r_i / rings
            rad = r0 * (1.0 - t) + r1 * t
            center_pt = v0.lerp(v1, t)
            rv = []
            for s in range(segments):
                ang = (s / segments) * 2.0 * math.pi
                local_p = Vector((math.cos(ang) * rad * scale_xy[0], math.sin(ang) * rad * scale_xy[1], 0.0))
                rv.append(tmp.verts.new(center_pt + (rot_m @ local_p)))
            ring_verts.append(rv)

        for r_i in range(rings):
            ra, rb = ring_verts[r_i], ring_verts[r_i + 1]
            for s in range(segments):
                sn = (s + 1) % segments
                f = tmp.faces.new((ra[s], ra[sn], rb[sn], rb[s]))
                f.material_index = mat_index

        # Cap both ends
        tmp.faces.new(list(reversed(ring_verts[0]))).material_index = mat_index
        tmp.faces.new(ring_verts[-1]).material_index = mat_index
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)

        self._merge_tmp(tmp, weights)

    def add_dome_sphere(
        self,
        center: tuple[float, float, float],
        radii: tuple[float, float, float],
        mat_index: int,
        weights: object,
        z_clip_min: float | None = None,
    ) -> None:
        tmp = bmesh.new()
        bmesh.ops.create_uvsphere(tmp, u_segments=20, v_segments=14, radius=1.0)
        cx, cy, cz = center
        rx, ry, rz = radii
        for v in tmp.verts:
            px = cx + v.co.x * rx
            py = cy + v.co.y * ry
            pz = cz + v.co.z * rz
            if z_clip_min is not None and pz < z_clip_min:
                pz = z_clip_min
            v.co = Vector((px, py, pz))
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
        for f in tmp.faces:
            f.material_index = mat_index
        self._merge_tmp(tmp, weights)

    def _merge_tmp(self, tmp: bmesh.types.BMesh, weights: object) -> None:
        start_idx = len(self.bm.verts)
        m_tmp = bpy.data.meshes.new("_tmp_skin_part")
        tmp.to_mesh(m_tmp)
        tmp.free()
        self.bm.from_mesh(m_tmp)
        bpy.data.meshes.remove(m_tmp)

        w_fn = weights if callable(weights) else (lambda _co: dict(weights))
        self._record_new_verts(start_idx, w_fn)

    def build_skinned_object(
        self,
        name: str,
        arm_obj: bpy.types.Object,
        materials: list[bpy.types.Material],
        collection: bpy.types.Collection,
        uv_scale: float = 1.6,
    ) -> bpy.types.Object:
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        apply_box_uv(self.bm, uv_scale=uv_scale)
        # Angle-weighted smooth shading without splitting vertices (preserves 1:1 vert_weights indexing!)
        self.bm.normal_update()
        limit_rad = math.radians(44.0)
        for f in self.bm.faces:
            f.smooth = True
        for e in self.bm.edges:
            if len(e.link_faces) == 2:
                e.smooth = e.calc_face_angle(0.0) < limit_rad
            else:
                e.smooth = False

        mesh = bpy.data.meshes.new(name)
        self.bm.to_mesh(mesh)
        self.bm.free()

        for m in materials:
            mesh.materials.append(m)

        obj = bpy.data.objects.new(name, mesh)
        obj.parent = arm_obj
        collection.objects.link(obj)

        # Create vertex groups for all bones in armature
        vgroups: dict[str, bpy.types.VertexGroup] = {}
        for bone in arm_obj.data.bones:
            vgroups[bone.name] = obj.vertex_groups.new(name=bone.name)

        for v_idx, w_dict in enumerate(self.vert_weights):
            for b_name, w_val in w_dict.items():
                if b_name in vgroups and w_val > 1e-4:
                    vgroups[b_name].add([v_idx], float(w_val), "REPLACE")

        mod = obj.modifiers.new(name="Armature", type="ARMATURE")
        mod.object = arm_obj
        return obj


# ==============================================================================
# 3RD-PERSON HUMANOID SKELETON & TACTICAL SOLDIER BUILDER (1.80m Tall)
# ==============================================================================
def _create_soldier_armature(name: str, collection: bpy.types.Collection, faction: str) -> bpy.types.Object:
    arm_data = bpy.data.armatures.new(f"{name}_Rig")
    arm_obj = bpy.data.objects.new(name, arm_data)
    collection.objects.link(arm_obj)
    arm_obj["asset_category"] = "character_soldier"
    arm_obj["faction"] = faction
    arm_obj["height_m"] = 1.80

    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones

    def make_bone(bname: str, head: tuple, tail: tuple, parent_name: str | None, z_hint: tuple, connect: bool = False):
        b = eb.new(bname)
        b.head = Vector(head)
        b.tail = Vector(tail)
        if parent_name:
            b.parent = eb[parent_name]
            b.use_connect = connect
        b.align_roll(Vector(z_hint))
        return b

    # Spine chain (pointing +Z, local Z = -Y so +rx leans backward / -rx leans forward)
    make_bone("Root", (0.0, 0.0, 0.0), (0.0, 0.0, 0.25), None, (0.0, -1.0, 0.0))
    make_bone("Hips", (0.0, 0.0, 0.94), (0.0, 0.0, 1.08), "Root", (0.0, -1.0, 0.0))
    make_bone("Spine", (0.0, 0.0, 1.08), (0.0, 0.0, 1.25), "Hips", (0.0, -1.0, 0.0), True)
    make_bone("Chest", (0.0, 0.0, 1.25), (0.0, 0.0, 1.47), "Spine", (0.0, -1.0, 0.0), True)
    make_bone("Neck", (0.0, 0.0, 1.47), (0.0, 0.0, 1.56), "Chest", (0.0, -1.0, 0.0), True)
    make_bone("Head", (0.0, 0.0, 1.56), (0.0, 0.0, 1.79), "Neck", (0.0, -1.0, 0.0), True)

    # Arms & Legs (pointing -Z, local Z = +Y so +rx swings limb FORWARD toward +Y!)
    for side, sx in (("L", -1.0), ("R", 1.0)):
        make_bone(
            f"Shoulder_{side}",
            (sx * 0.06, 0.0, 1.43),
            (sx * 0.21, 0.0, 1.42),
            "Chest",
            (0.0, 0.0, 1.0),
        )
        make_bone(
            f"UpperArm_{side}",
            (sx * 0.21, 0.0, 1.42),
            (sx * 0.22, 0.0, 1.15),
            f"Shoulder_{side}",
            (0.0, 1.0, 0.0),
            True,
        )
        make_bone(
            f"Forearm_{side}",
            (sx * 0.22, 0.0, 1.15),
            (sx * 0.22, 0.0, 0.89),
            f"UpperArm_{side}",
            (0.0, 1.0, 0.0),
            True,
        )
        make_bone(
            f"Hand_{side}",
            (sx * 0.22, 0.0, 0.89),
            (sx * 0.22, 0.0, 0.77),
            f"Forearm_{side}",
            (0.0, 1.0, 0.0),
            True,
        )

        # Legs
        make_bone(
            f"UpperLeg_{side}",
            (sx * 0.105, 0.0, 0.94),
            (sx * 0.105, 0.0, 0.50),
            "Hips",
            (0.0, 1.0, 0.0),
        )
        make_bone(
            f"LowerLeg_{side}",
            (sx * 0.105, 0.0, 0.50),
            (sx * 0.105, 0.0, 0.09),
            f"UpperLeg_{side}",
            (0.0, 1.0, 0.0),
            True,
        )
        make_bone(
            f"Foot_{side}",
            (sx * 0.105, 0.0, 0.09),
            (sx * 0.105, 0.16, 0.03),
            f"LowerLeg_{side}",
            (0.0, 0.0, 1.0),
            True,
        )

    # Dedicated Weapon Attachment Bone in Right Palm pointing +Y Forward!
    make_bone("Weapon_R", (0.22, 0.04, 0.83), (0.22, 0.24, 0.83), "Hand_R", (0.0, 0.0, 1.0))

    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "XYZ"
    return arm_obj


def _blend_z(z: float, z_mid: float, half_band: float, bone_hi: str, bone_lo: str) -> dict[str, float]:
    """Smoothly blend between bone_hi (above z_mid) and bone_lo (below z_mid)."""
    t = max(0.0, min(1.0, (z - (z_mid - half_band)) / (2.0 * half_band)))
    return {bone_hi: t, bone_lo: 1.0 - t}


def _build_soldier_mesh(
    arm_obj: bpy.types.Object,
    collection: bpy.types.Collection,
    mats: dict,
    is_opfor: bool = False,
) -> bpy.types.Object:
    """Construct the tactical soldier mesh with full plate carrier, pouches, helmet/NVG & boots."""
    # Material slots:
    # 0: BDU Uniform (MultiCam or Pax Slate)
    # 1: Tactical Vest / Webbing (Coyote Cordura or Ordnance Olive)
    # 2: Polymer Black (Balaclava, Knee pads, Holster, Rifle mags, NVG tubes)
    # 3: Suede Gloves / Combat Boots
    # 4: Gunmetal (Helmet rails, Buckles, Radio)
    # 5: Optic Armored Glass (Goggles / NVG Lenses)
    # 6: Tactical IFF Strobe LED (Cyan for NATO, Red for Pax OpFor)
    m_list = [
        mats["uniform_pax"] if is_opfor else mats["uniform_multicam"],
        mats["ordnance_olive"] if is_opfor else mats["cordura_coyote"],
        mats["polymer_black"],
        mats["glove_leather"],
        mats["gunmetal"],
        mats["optic_glass"],
        mats["led_red"] if is_opfor else mats["led_cyan"],
    ]

    sb = SkinnedMeshBuilder()

    # 1. Pelvis, Waist & Chest BDU Torso (blended Hips -> Spine -> Chest)
    def torso_w(co: Vector) -> dict[str, float]:
        if co.z < 1.08:
            return _blend_z(co.z, 1.06, 0.05, "Spine", "Hips")
        if co.z < 1.26:
            return _blend_z(co.z, 1.24, 0.05, "Chest", "Spine")
        return {"Chest": 1.0}

    sb.add_limb_tube((0.0, 0.0, 0.90), (0.0, 0.0, 1.12), 0.165, 0.150, 0, torso_w, segments=12, rings=3, scale_xy=(1.08, 0.76))
    sb.add_limb_tube((0.0, 0.0, 1.12), (0.0, 0.0, 1.46), 0.150, 0.185, 0, torso_w, segments=12, rings=4, scale_xy=(1.12, 0.78))

    # Battle Belt & Belt Pouches (Hips = 1.0)
    sb.add_box((0.0, 0.0, 0.96), (0.35, 0.25, 0.065), 1, {"Hips": 1.0}, bevel=0.008)
    sb.add_box((0.0, 0.13, 0.96), (0.06, 0.02, 0.05), 4, {"Hips": 1.0})  # Cobra belt buckle
    sb.add_box((-0.18, -0.02, 0.93), (0.05, 0.11, 0.13), 1, {"Hips": 1.0}, bevel=0.006)  # Dump pouch
    sb.add_box((0.0, -0.14, 0.96), (0.14, 0.06, 0.09), 1, {"Hips": 1.0}, bevel=0.006)    # Rear IFAK pouch

    # 2. JPC Plate Carrier, 3x Front Mag Pouches, Radio & Hydration Pack (Rigid Chest = 1.0!)
    sb.add_box((0.0, 0.01, 1.29), (0.34, 0.26, 0.28), 1, {"Chest": 1.0}, bevel=0.015)
    # Shoulder armor straps
    for sx in (-0.11, 0.11):
        sb.add_box((sx, 0.0, 1.45), (0.065, 0.22, 0.04), 1, {"Chest": 1.0}, bevel=0.006)
    # 3 Front Rifle Mag Pouches + Polymer Mag Pull-Tabs
    for mx in (-0.085, 0.0, 0.085):
        sb.add_box((mx, 0.155, 1.22), (0.072, 0.045, 0.13), 1, {"Chest": 1.0}, bevel=0.005)
        sb.add_box((mx, 0.155, 1.30), (0.058, 0.030, 0.045), 2, {"Chest": 1.0}, bevel=0.003)
    # Upper Chest Admin Panel + Tactical Radio + Whip Antenna (Left Chest)
    sb.add_box((0.02, 0.15, 1.37), (0.14, 0.025, 0.075), 1, {"Chest": 1.0}, bevel=0.004)
    sb.add_box((-0.12, 0.14, 1.36), (0.055, 0.042, 0.10), 4, {"Chest": 1.0}, bevel=0.004)
    sb.add_limb_tube((-0.13, 0.14, 1.41), (-0.15, 0.11, 1.66), 0.005, 0.003, 2, {"Chest": 1.0}, segments=6, rings=1)
    # Rear Tactical Assault Hydration Pack
    sb.add_box((0.0, -0.16, 1.30), (0.25, 0.095, 0.27), 1, {"Chest": 1.0}, bevel=0.012)
    # Faction IFF Strobe Marker on Right Shoulder
    sb.add_box((0.12, -0.02, 1.475), (0.028, 0.042, 0.016), 6, {"Chest": 1.0})

    # 3. Neck, Balaclava Head, Ballistic Goggles & Tactical Helmet (Head = 1.0)
    sb.add_limb_tube((0.0, 0.0, 1.45), (0.0, 0.0, 1.57), 0.068, 0.062, 2, {"Neck": 0.6, "Head": 0.4}, segments=10, rings=2)
    sb.add_dome_sphere((0.0, 0.01, 1.655), (0.096, 0.108, 0.115), 2, {"Head": 1.0})
    # Wrap-around Ballistic Tactical Goggles (Frame + Tinted Armored Lens)
    sb.add_box((0.0, 0.092, 1.665), (0.155, 0.065, 0.052), 2, {"Head": 1.0}, bevel=0.006)
    sb.add_box((0.0, 0.118, 1.665), (0.138, 0.020, 0.038), 5, {"Head": 1.0}, bevel=0.003)

    if not is_opfor:
        # NATO Ops-Core FAST High-Cut Helmet + ComTac Headset + Boom Mic + Stowed Dual-Tube NVGs!
        sb.add_dome_sphere((0.0, -0.005, 1.695), (0.114, 0.126, 0.105), 1, {"Head": 1.0}, z_clip_min=1.655)
        for sx in (-1.0, 1.0):
            sb.add_box((sx * 0.108, 0.01, 1.685), (0.016, 0.11, 0.022), 4, {"Head": 1.0})
            sb.add_box((sx * 0.104, -0.01, 1.645), (0.028, 0.068, 0.078), 2, {"Head": 1.0}, bevel=0.006)
        sb.add_limb_tube((-0.102, 0.02, 1.62), (-0.032, 0.115, 1.595), 0.004, 0.004, 2, {"Head": 1.0}, segments=8, rings=1)
        # Front NVG Wilcox Mount + Folded Dual PVS-31 Night Vision Tubes + Objective Focus Rings
        sb.add_box((0.0, 0.122, 1.725), (0.048, 0.024, 0.046), 4, {"Head": 1.0})
        for sx in (-0.034, 0.034):
            sb.add_limb_tube((sx, 0.13, 1.74), (sx, 0.18, 1.79), 0.020, 0.022, 2, {"Head": 1.0}, segments=14, rings=1)
            sb.add_limb_tube((sx, 0.172, 1.782), (sx, 0.184, 1.793), 0.0235, 0.0235, 4, {"Head": 1.0}, segments=14, rings=1)
            sb.add_limb_tube((sx, 0.18, 1.79), (sx, 0.187, 1.796), 0.019, 0.019, 5, {"Head": 1.0}, segments=14, rings=1)
        sb.add_box((0.0, -0.128, 1.695), (0.072, 0.028, 0.052), 2, {"Head": 1.0}, bevel=0.004)
        # Chest CAT Tourniquet & Chemlight sticks
        sb.add_box((0.125, 0.145, 1.355), (0.032, 0.030, 0.095), 2, {"Chest": 1.0}, bevel=0.004)
    else:
        # Pax Armata Heavy Assault Helmet (Full ear-guard shell + Ballistic brow shield + Visor + Armored Collar + Pauldrons)
        sb.add_dome_sphere((0.0, -0.005, 1.690), (0.118, 0.128, 0.112), 4, {"Head": 1.0}, z_clip_min=1.625)
        sb.add_box((0.0, 0.095, 1.710), (0.178, 0.088, 0.040), 1, {"Head": 1.0}, bevel=0.005)
        sb.add_box((0.0, 0.128, 1.685), (0.162, 0.018, 0.032), 5, {"Head": 1.0}, bevel=0.003)
        # High Ballistic Neck Gorget Collar
        sb.add_limb_tube((0.0, 0.0, 1.44), (0.0, 0.0, 1.525), 0.135, 0.115, 1, {"Chest": 1.0}, segments=14, rings=1, scale_xy=(1.05, 0.92))
        for sx_p in (-1.0, 1.0):
            sb.add_box((sx_p * 0.245, 0.0, 1.375), (0.045, 0.135, 0.125), 1, {f"UpperArm_{'L' if sx_p < 0 else 'R'}": 1.0}, rot_euler=(0.0, sx_p * 0.22, 0.0), bevel=0.008)

    # 4. Left & Right Arms + Hard-Knuckle Tactical Gloves
    for side, sx in (("L", -1.0), ("R", 1.0)):
        u_bone = f"UpperArm_{side}"
        f_bone = f"Forearm_{side}"
        h_bone = f"Hand_{side}"

        def arm_u_w(co: Vector, ub=u_bone, fb=f_bone, sb_n=f"Shoulder_{side}") -> dict[str, float]:
            if co.z > 1.38:
                return _blend_z(co.z, 1.40, 0.04, sb_n, ub)
            if co.z < 1.19:
                return _blend_z(co.z, 1.15, 0.04, ub, fb)
            return {ub: 1.0}

        def arm_f_w(co: Vector, ub=u_bone, fb=f_bone, hb=h_bone) -> dict[str, float]:
            if co.z > 1.11:
                return _blend_z(co.z, 1.15, 0.04, ub, fb)
            if co.z < 0.92:
                return _blend_z(co.z, 0.89, 0.03, fb, hb)
            return {fb: 1.0}

        # Deltoid / Upper sleeve + Velcro patch
        sb.add_limb_tube((sx * 0.21, 0.0, 1.43), (sx * 0.22, 0.0, 1.15), 0.068, 0.056, 0, arm_u_w, segments=10, rings=4)
        sb.add_box((sx * 0.275, 0.0, 1.33), (0.018, 0.072, 0.092), 1, {u_bone: 1.0}, bevel=0.003)
        # Forearm sleeve + Cuff
        sb.add_limb_tube((sx * 0.22, 0.0, 1.15), (sx * 0.22, 0.0, 0.90), 0.055, 0.043, 0, arm_f_w, segments=10, rings=4)
        # Hard-Knuckle Tactical Glove
        sb.add_box((sx * 0.22, 0.005, 0.845), (0.038, 0.082, 0.090), 3, {h_bone: 1.0}, bevel=0.006)
        sb.add_box((sx * 0.238, 0.005, 0.835), (0.012, 0.072, 0.022), 2, {h_bone: 1.0}, bevel=0.003)  # Carbon knuckle
        sb.add_box((sx * 0.205, 0.050, 0.840), (0.024, 0.028, 0.055), 3, {h_bone: 1.0}, rot_euler=(-0.3, 0.0, 0.0), bevel=0.004)
        sb.add_box((sx * 0.22, 0.005, 0.785), (0.034, 0.074, 0.048), 3, {h_bone: 1.0}, bevel=0.005)

    # 5. Left & Right Cargo Legs, Drop-Leg Holster, Knee Pads & Combat Boots
    for side, sx in (("L", -1.0), ("R", 1.0)):
        ul_b = f"UpperLeg_{side}"
        ll_b = f"LowerLeg_{side}"
        ft_b = f"Foot_{side}"

        def leg_u_w(co: Vector, ul=ul_b, ll=ll_b) -> dict[str, float]:
            if co.z > 0.89:
                return _blend_z(co.z, 0.92, 0.04, "Hips", ul)
            if co.z < 0.54:
                return _blend_z(co.z, 0.50, 0.05, ul, ll)
            return {ul: 1.0}

        def leg_l_w(co: Vector, ul=ul_b, ll=ll_b, ft=ft_b) -> dict[str, float]:
            if co.z > 0.46:
                return _blend_z(co.z, 0.50, 0.05, ul, ll)
            if co.z < 0.13:
                return _blend_z(co.z, 0.10, 0.03, ll, ft)
            return {ll: 1.0}

        # Thigh & Shin cargo trousers
        sb.add_limb_tube((sx * 0.105, 0.0, 0.94), (sx * 0.105, 0.0, 0.50), 0.092, 0.072, 0, leg_u_w, segments=10, rings=4)
        sb.add_limb_tube((sx * 0.105, 0.0, 0.50), (sx * 0.105, 0.0, 0.12), 0.070, 0.054, 0, leg_l_w, segments=10, rings=4)

        # Cargo thigh pocket & Right-side Drop-Leg Kydex Pistol Holster
        if side == "R":
            sb.add_box((sx * 0.195, 0.01, 0.72), (0.045, 0.11, 0.16), 2, {ul_b: 1.0}, bevel=0.005)
        else:
            sb.add_box((sx * 0.188, 0.0, 0.71), (0.032, 0.13, 0.15), 0, {ul_b: 1.0}, bevel=0.006)

        # Molded Black Hard-Shell Tactical Knee Pad
        sb.add_box((sx * 0.105, 0.068, 0.49), (0.095, 0.042, 0.105), 2, {ll_b: 1.0}, bevel=0.010)

        # Rugged Tactical Combat Boot (Foot = 1.0, sole cleanly at Z = 0.0!)
        sb.add_box((sx * 0.105, 0.01, 0.105), (0.096, 0.115, 0.11), 3, {ft_b: 1.0}, bevel=0.008)
        sb.add_box((sx * 0.105, 0.055, 0.048), (0.102, 0.235, 0.068), 3, {ft_b: 1.0}, bevel=0.010)
        sb.add_box((sx * 0.105, 0.055, 0.012), (0.108, 0.245, 0.024), 2, {ft_b: 1.0}, bevel=0.004)  # Lug sole

    return sb.build_skinned_object(f"{arm_obj.name}_Mesh", arm_obj, m_list, collection, uv_scale=1.6)


# ==============================================================================
# SOLDIER POSE & NLA ANIMATION CLIPS
# ==============================================================================
def apply_rifle_ready_pose(arm_obj: bpy.types.Object, crouch: bool = False) -> None:
    """Set PoseBones to a crisp Battlefield tactical rifle-ready aiming stance."""
    pb = arm_obj.pose.bones
    for b in pb:
        b.location = (0.0, 0.0, 0.0)
        b.rotation_euler = (0.0, 0.0, 0.0)

    r = math.radians
    if crouch:
        pb["Hips"].location = (0.0, 0.0, -0.34)
        pb["Spine"].rotation_euler = (r(-14.0), 0.0, 0.0)
        pb["Chest"].rotation_euler = (r(-8.0), 0.0, r(-18.0))
        pb["Head"].rotation_euler = (r(18.0), 0.0, r(18.0))
        pb["UpperLeg_L"].rotation_euler = (r(58.0), 0.0, r(8.0))
        pb["LowerLeg_L"].rotation_euler = (r(-92.0), 0.0, 0.0)
        pb["Foot_L"].rotation_euler = (r(34.0), 0.0, 0.0)
        pb["UpperLeg_R"].rotation_euler = (r(24.0), 0.0, r(-10.0))
        pb["LowerLeg_R"].rotation_euler = (r(-88.0), 0.0, 0.0)
        pb["Foot_R"].rotation_euler = (r(55.0), 0.0, 0.0)
    else:
        pb["Hips"].location = (0.0, 0.0, -0.04)
        pb["Spine"].rotation_euler = (r(-7.0), 0.0, 0.0)
        pb["Chest"].rotation_euler = (r(-5.0), 0.0, r(-16.0))
        pb["Head"].rotation_euler = (r(10.0), 0.0, r(16.0))
        pb["UpperLeg_L"].rotation_euler = (r(14.0), 0.0, r(5.0))
        pb["LowerLeg_L"].rotation_euler = (r(-22.0), 0.0, 0.0)
        pb["Foot_L"].rotation_euler = (r(8.0), 0.0, 0.0)
        pb["UpperLeg_R"].rotation_euler = (r(-10.0), 0.0, r(-6.0))
        pb["LowerLeg_R"].rotation_euler = (r(-16.0), 0.0, 0.0)
        pb["Foot_R"].rotation_euler = (r(22.0), 0.0, 0.0)

    # Rifle holding arms (Right hand at trigger grip, Left hand reaching forward to handguard!)
    pb["UpperArm_R"].rotation_euler = (r(42.0), r(-12.0), r(-14.0))
    pb["Forearm_R"].rotation_euler = (r(68.0), 0.0, r(18.0))
    pb["Hand_R"].rotation_euler = (r(-12.0), 0.0, 0.0)

    pb["UpperArm_L"].rotation_euler = (r(58.0), r(24.0), r(-22.0))
    pb["Forearm_L"].rotation_euler = (r(52.0), 0.0, r(-24.0))
    pb["Hand_L"].rotation_euler = (r(-8.0), 0.0, 0.0)


def _bake_soldier_nla_clips(arm_obj: bpy.types.Object) -> None:
    """Create 3 clean looping NLA AnimationClips: Idle_Combat, Run_Forward, Crouch_Aim."""
    arm_obj.animation_data_create()
    pb = arm_obj.pose.bones
    r = math.radians

    def _key_all(frame: int) -> None:
        pb["Hips"].keyframe_insert(data_path="location", frame=frame)
        for b in pb:
            b.keyframe_insert(data_path="rotation_euler", frame=frame)

    def _push_nla(act: bpy.types.Action, name: str) -> None:
        trk = arm_obj.animation_data.nla_tracks.new()
        trk.name = name
        strip = trk.strips.new(name, 1, act)
        strip.name = name
        trk.mute = False
        arm_obj.animation_data.action = None

    # 1. Idle_Combat (frames 1..41)
    act_idle = bpy.data.actions.new(f"{arm_obj.name}_Idle_Combat")
    arm_obj.animation_data.action = act_idle
    apply_rifle_ready_pose(arm_obj, crouch=False)
    _key_all(1)
    pb["Chest"].rotation_euler.x += r(-2.2)
    pb["UpperArm_R"].rotation_euler.x += r(2.0)
    pb["UpperArm_L"].rotation_euler.x += r(2.0)
    _key_all(21)
    apply_rifle_ready_pose(arm_obj, crouch=False)
    _key_all(41)
    _push_nla(act_idle, "Idle_Combat")

    # 2. Crouch_Aim (frames 1..31)
    act_crouch = bpy.data.actions.new(f"{arm_obj.name}_Crouch_Aim")
    arm_obj.animation_data.action = act_crouch
    apply_rifle_ready_pose(arm_obj, crouch=True)
    _key_all(1)
    pb["Chest"].rotation_euler.x += r(-1.8)
    _key_all(16)
    apply_rifle_ready_pose(arm_obj, crouch=True)
    _key_all(31)
    _push_nla(act_crouch, "Crouch_Aim")

    # 3. Run_Forward (frames 1..25, dynamic sprint cycle)
    act_run = bpy.data.actions.new(f"{arm_obj.name}_Run_Forward")
    arm_obj.animation_data.action = act_run
    for f_idx, phase in ((1, 0.0), (7, 0.5 * math.pi), (13, math.pi), (19, 1.5 * math.pi), (25, 2.0 * math.pi)):
        s = math.sin(phase)
        c = math.cos(phase)
        for b in pb:
            b.location = (0.0, 0.0, 0.0)
            b.rotation_euler = (0.0, 0.0, 0.0)
        pb["Hips"].location = (0.0, 0.0, -0.05 + 0.035 * abs(c))
        pb["Spine"].rotation_euler = (r(-14.0), 0.0, r(6.0 * s))
        pb["Chest"].rotation_euler = (r(-8.0), 0.0, r(-10.0 * s))
        pb["Head"].rotation_euler = (r(18.0), 0.0, r(4.0 * s))

        pb["UpperLeg_L"].rotation_euler = (r(38.0 * s + 8.0), 0.0, 0.0)
        pb["LowerLeg_L"].rotation_euler = (r(-45.0 - 35.0 * max(0.0, -c)), 0.0, 0.0)
        pb["Foot_L"].rotation_euler = (r(15.0 * c), 0.0, 0.0)

        pb["UpperLeg_R"].rotation_euler = (r(-38.0 * s + 8.0), 0.0, 0.0)
        pb["LowerLeg_R"].rotation_euler = (r(-45.0 - 35.0 * max(0.0, c)), 0.0, 0.0)
        pb["Foot_R"].rotation_euler = (r(-15.0 * c), 0.0, 0.0)

        pb["UpperArm_R"].rotation_euler = (r(45.0 + 14.0 * s), r(-10.0), r(-15.0))
        pb["Forearm_R"].rotation_euler = (r(72.0), 0.0, r(20.0))
        pb["UpperArm_L"].rotation_euler = (r(52.0 - 14.0 * s), r(20.0), r(-20.0))
        pb["Forearm_L"].rotation_euler = (r(58.0), 0.0, r(-22.0))
        _key_all(f_idx)
    _push_nla(act_run, "Run_Forward")

    # Reset PoseBones to clean Rest Pose for catalog & export
    for b in pb:
        b.location = (0.0, 0.0, 0.0)
        b.rotation_euler = (0.0, 0.0, 0.0)


# ==============================================================================
# 1ST-PERSON VIEWMODEL ARMS RIG: CHR_FPS_Arms_Rig
# ==============================================================================
def build_fps_arms_rig(collection: bpy.types.Collection, mats: dict) -> bpy.types.Object:
    """
    First-Person Viewmodel Tactical Sleeves, Illuminated GPS Watch & Hard-Knuckle Gloves Rig.
    Origin (0, 0, 0) = Weapon_Mount bone origin so attaching `WPN_AssaultRifle_M5A3` at (0,0,0)
    aligns the right hand onto the pistol grip and left hand onto the foregrip!
    """
    arm_data = bpy.data.armatures.new("CHR_FPS_Arms_Rig_Data")
    arm_obj = bpy.data.objects.new("CHR_FPS_Arms_Rig", arm_data)
    collection.objects.link(arm_obj)
    arm_obj["asset_category"] = "character_fps_viewmodel"
    arm_obj["weapon_socket_bone"] = "Weapon_Mount"

    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones

    def mb(bname: str, h: tuple, t: tuple, p: str | None = None, connect: bool = False):
        b = eb.new(bname)
        b.head = Vector(h)
        b.tail = Vector(t)
        if p:
            b.parent = eb[p]
            b.use_connect = connect
        b.align_roll(Vector((0.0, 0.0, 1.0)))
        return b

    mb("FPS_Root", (0.0, -0.25, -0.10), (0.0, -0.10, -0.10))
    mb("Weapon_Mount", (0.0, 0.0, 0.0), (0.0, 0.16, 0.0), "FPS_Root")

    # Right Arm reaching directly to Pistol Grip around (0.0, -0.035, -0.058)
    mb("UpperArm_R", (0.20, -0.34, -0.12), (0.14, -0.20, -0.11), "FPS_Root")
    mb("Forearm_R", (0.14, -0.20, -0.11), (0.032, -0.065, -0.062), "UpperArm_R", True)
    mb("Hand_R", (0.032, -0.065, -0.062), (0.008, -0.025, -0.055), "Forearm_R", True)
    mb("Index_R", (0.015, -0.005, -0.025), (0.004, 0.024, -0.018), "Hand_R")

    # Left Support Arm reaching forward to Handguard / Foregrip around (0.0, +0.245, -0.018)
    mb("UpperArm_L", (-0.22, -0.32, -0.12), (-0.16, -0.10, -0.10), "FPS_Root")
    mb("Forearm_L", (-0.16, -0.10, -0.10), (-0.035, 0.185, -0.035), "UpperArm_L", True)
    mb("Hand_L", (-0.035, 0.185, -0.035), (-0.005, 0.255, -0.018), "Forearm_L", True)

    bpy.ops.object.mode_set(mode="OBJECT")
    for b in arm_obj.pose.bones:
        b.rotation_mode = "XYZ"

    # Build Detailed Viewmodel Sleeves + Tactical Watch + Carbon-Knuckle Gloves
    # 0=MultiCam Sleeve, 1=Coyote Cuff/Strap, 2=Glove Suede, 3=Polymer Black, 4=Gunmetal, 5=Cyan Watch LED
    fps_mats = [
        mats["uniform_multicam"],
        mats["cordura_coyote"],
        mats["glove_leather"],
        mats["polymer_black"],
        mats["gunmetal"],
        mats["led_cyan"],
    ]
    sb = SkinnedMeshBuilder()

    # Right Sleeve & High-Detail Hard-Knuckle Glove (16-segment smooth viewmodel tubes!)
    sb.add_limb_tube((0.20, -0.34, -0.12), (0.14, -0.20, -0.11), 0.056, 0.050, 0, {"UpperArm_R": 1.0}, segments=16, rings=3)
    sb.add_limb_tube((0.14, -0.20, -0.11), (0.042, -0.078, -0.066), 0.049, 0.038, 0, {"Forearm_R": 1.0}, segments=16, rings=4)
    sb.add_limb_tube((0.046, -0.084, -0.068), (0.032, -0.065, -0.062), 0.041, 0.037, 1, {"Forearm_R": 1.0}, segments=16, rings=1)
    # Right Palm, 4 Individual Molded Carbon Knuckle Domes, Trigger Finger & Wrapped Grip Fingers
    sb.add_box((0.022, -0.038, -0.056), (0.032, 0.065, 0.068), 2, {"Hand_R": 1.0}, rot_euler=(-0.25, 0.0, 0.25), bevel=0.005)
    sb.add_box((0.036, -0.035, -0.048), (0.011, 0.056, 0.022), 3, {"Hand_R": 1.0}, rot_euler=(-0.25, 0.0, 0.25), bevel=0.004)
    for ki in range(4):
        ky = -0.016 - ki * 0.013
        sb.add_box((0.040, ky, -0.046 - ki * 0.002), (0.007, 0.010, 0.012), 4, {"Hand_R": 1.0}, bevel=0.002)
    sb.add_limb_tube((0.018, -0.008, -0.026), (0.004, 0.024, -0.016), 0.009, 0.007, 2, {"Index_R": 1.0}, segments=12, rings=2)
    for fi in range(3):
        fz = -0.045 - fi * 0.018
        sb.add_box((0.002, -0.015, fz), (0.042, 0.022, 0.015), 2, {"Hand_R": 1.0}, bevel=0.003)

    # Left Support Sleeve, Tactical Illuminated GPS Wristwatch & Glove
    sb.add_limb_tube((-0.22, -0.32, -0.12), (-0.16, -0.10, -0.10), 0.056, 0.050, 0, {"UpperArm_L": 1.0}, segments=16, rings=3)
    sb.add_limb_tube((-0.16, -0.10, -0.10), (-0.048, 0.155, -0.042), 0.049, 0.038, 0, {"Forearm_L": 1.0}, segments=16, rings=4)
    # Tactical GPS Watch on Left Wrist (Nylon Strap + Bezel + Side Crown Buttons + Cyan OLED Dial)
    sb.add_limb_tube((-0.052, 0.145, -0.045), (-0.038, 0.175, -0.037), 0.0405, 0.0385, 3, {"Forearm_L": 1.0}, segments=16, rings=1)
    sb.add_box((-0.026, 0.162, -0.012), (0.035, 0.039, 0.014), 4, {"Forearm_L": 1.0}, rot_euler=(0.2, 0.35, -0.4), bevel=0.003)
    sb.add_box((-0.0235, 0.162, -0.0045), (0.025, 0.029, 0.004), 5, {"Forearm_L": 1.0}, rot_euler=(0.2, 0.35, -0.4))
    sb.add_box((-0.010, 0.168, -0.010), (0.006, 0.008, 0.006), 4, {"Forearm_L": 1.0}, rot_euler=(0.2, 0.35, -0.4))
    # Left Foregrip Hand, Carbon Knuckles, Thumb-over-bore / C-clamp & Fingers
    sb.add_box((-0.020, 0.225, -0.026), (0.030, 0.072, 0.062), 2, {"Hand_L": 1.0}, rot_euler=(0.15, 0.0, -0.25), bevel=0.005)
    sb.add_box((-0.034, 0.225, -0.022), (0.011, 0.058, 0.022), 3, {"Hand_L": 1.0}, rot_euler=(0.15, 0.0, -0.25), bevel=0.004)
    for ki in range(4):
        ky = 0.204 + ki * 0.014
        sb.add_box((-0.038, ky, -0.020), (0.007, 0.010, 0.012), 4, {"Hand_L": 1.0}, bevel=0.002)
    for fi in range(4):
        fy = 0.235 + fi * 0.014
        sb.add_box((0.004, fy, -0.036), (0.040, 0.013, 0.016), 2, {"Hand_L": 1.0}, bevel=0.003)
    # C-clamp thumb resting high along left rail
    sb.add_limb_tube((-0.022, 0.215, 0.002), (-0.012, 0.258, 0.026), 0.0105, 0.0085, 2, {"Hand_L": 1.0}, segments=12, rings=2)

    sb.build_skinned_object("CHR_FPS_Arms_Mesh", arm_obj, fps_mats, collection, uv_scale=2.5)

    # Bake 3 FPS Viewmodel NLA Clips: FPS_Idle_Rifle, FPS_Fire_Recoil, FPS_Reload_Tactical
    arm_obj.animation_data_create()
    pb = arm_obj.pose.bones
    r = math.radians

    def _key_fps(fr: int) -> None:
        for b in pb:
            b.keyframe_insert(data_path="location", frame=fr)
            b.keyframe_insert(data_path="rotation_euler", frame=fr)

    def _reset_fps() -> None:
        for b in pb:
            b.location = (0.0, 0.0, 0.0)
            b.rotation_euler = (0.0, 0.0, 0.0)

    def _push(act: bpy.types.Action, cname: str) -> None:
        trk = arm_obj.animation_data.nla_tracks.new()
        trk.name = cname
        strip = trk.strips.new(cname, 1, act)
        strip.name = cname
        arm_obj.animation_data.action = None

    # Clip 1: FPS_Idle_Rifle
    act1 = bpy.data.actions.new("FPS_Idle_Rifle")
    arm_obj.animation_data.action = act1
    _reset_fps()
    _key_fps(1)
    pb["FPS_Root"].location = (0.0, 0.0, -0.004)
    pb["FPS_Root"].rotation_euler = (r(0.8), 0.0, 0.0)
    _key_fps(21)
    _reset_fps()
    _key_fps(41)
    _push(act1, "FPS_Idle_Rifle")

    # Clip 2: FPS_Fire_Recoil
    act2 = bpy.data.actions.new("FPS_Fire_Recoil")
    arm_obj.animation_data.action = act2
    _reset_fps()
    _key_fps(1)
    pb["FPS_Root"].location = (0.0, -0.028, 0.005)
    pb["FPS_Root"].rotation_euler = (r(3.2), r(-0.8), 0.0)
    pb["Index_R"].rotation_euler = (r(-18.0), 0.0, 0.0)
    _key_fps(3)
    _reset_fps()
    _key_fps(11)
    _push(act2, "FPS_Fire_Recoil")

    # Clip 3: FPS_Reload_Tactical
    act3 = bpy.data.actions.new("FPS_Reload_Tactical")
    arm_obj.animation_data.action = act3
    _reset_fps()
    _key_fps(1)
    # Tilt rifle & drop left hand to magazine well
    pb["FPS_Root"].rotation_euler = (r(8.0), r(22.0), r(-6.0))
    pb["Forearm_L"].rotation_euler = (r(-28.0), 0.0, r(16.0))
    _key_fps(14)
    # Slap fresh mag upward
    pb["Forearm_L"].rotation_euler = (r(-18.0), 0.0, r(14.0))
    pb["FPS_Root"].location = (0.0, 0.0, 0.012)
    _key_fps(26)
    # Reach charging handle & return
    pb["Forearm_L"].rotation_euler = (r(12.0), 0.0, r(18.0))
    pb["FPS_Root"].location = (0.0, -0.010, 0.0)
    _key_fps(36)
    _reset_fps()
    _key_fps(49)
    _push(act3, "FPS_Reload_Tactical")

    _reset_fps()
    return arm_obj


def build_all_combat_characters(collection: bpy.types.Collection, mats: dict) -> dict[str, bpy.types.Object]:
    nato_rig = _create_soldier_armature("CHR_Soldier_NATO_Assault", collection, faction="NATO")
    _build_soldier_mesh(nato_rig, collection, mats, is_opfor=False)
    _bake_soldier_nla_clips(nato_rig)

    pax_rig = _create_soldier_armature("CHR_Soldier_PAX_OpFor", collection, faction="PAX_ARMATA")
    _build_soldier_mesh(pax_rig, collection, mats, is_opfor=True)
    _bake_soldier_nla_clips(pax_rig)

    fps_rig = build_fps_arms_rig(collection, mats)

    return {
        "CHR_Soldier_NATO_Assault": nato_rig,
        "CHR_Soldier_PAX_OpFor": pax_rig,
        "CHR_FPS_Arms_Rig": fps_rig,
    }
