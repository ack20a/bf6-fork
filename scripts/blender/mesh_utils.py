"""
Mesh, UV, Collection, Hierarchy, and glTF Export utilities for Blender 5.x.
"""

import math
import bpy
import bmesh
from mathutils import Vector, Matrix


def ensure_collection(name: str, parent: bpy.types.Collection | None = None) -> bpy.types.Collection:
    """Get or create a collection and link it under parent (or scene root collection)."""
    root = parent or bpy.context.scene.collection
    if name in bpy.data.collections:
        col = bpy.data.collections[name]
    else:
        col = bpy.data.collections.new(name)
    if col.name not in [c.name for c in root.children]:
        root.children.link(col)
    return col


def clear_collection_recursive(col: bpy.types.Collection) -> None:
    """Remove all objects and child collections inside col cleanly."""
    for child in list(col.children):
        clear_collection_recursive(child)
        bpy.data.collections.remove(child)
    for obj in list(col.objects):
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data is not None and getattr(data, "users", 1) == 0:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)


def apply_box_uv(bm: bmesh.types.BMesh, uv_scale: float = 0.5) -> None:
    """Project world-scale box UVs onto all loops of a BMesh."""
    uv_layer = bm.loops.layers.uv.verify()
    bm.normal_update()
    for face in bm.faces:
        n = face.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for loop in face.loops:
            co = loop.vert.co
            if ax >= ay and ax >= az:
                u, v = co.y * uv_scale, co.z * uv_scale
            elif ay >= ax and ay >= az:
                u, v = co.x * uv_scale, co.z * uv_scale
            else:
                u, v = co.x * uv_scale, co.y * uv_scale
            loop[uv_layer].uv = (u, v)


def add_box_to_bm(
    bm: bmesh.types.BMesh,
    center: tuple[float, float, float],
    size: tuple[float, float, float],
    mat_index: int = 0,
    rot_euler: tuple[float, float, float] | None = None,
) -> list[bmesh.types.BMFace]:
    """Append an axis-aligned or rotated box to an existing BMesh and set material_index."""
    sx, sy, sz = size
    mat = Matrix.Translation(Vector(center))
    if rot_euler is not None:
        rx, ry, rz = rot_euler
        rot_m = (
            Matrix.Rotation(rz, 4, "Z")
            @ Matrix.Rotation(ry, 4, "Y")
            @ Matrix.Rotation(rx, 4, "X")
        )
        mat = mat @ rot_m
    scale_m = Matrix.Diagonal((sx, sy, sz, 1.0))
    ret = bmesh.ops.create_cube(bm, size=1.0, matrix=mat @ scale_m)
    verts = ret["verts"]
    vert_set = set(verts)
    faces = [f for f in bm.faces if all(v in vert_set for v in f.verts)]
    for f in faces:
        f.material_index = mat_index
    return faces


def add_cylinder_to_bm(
    bm: bmesh.types.BMesh,
    p0: tuple[float, float, float],
    p1: tuple[float, float, float],
    radius: float,
    segments: int = 10,
    mat_index: int = 0,
    cap_ends: bool = True,
) -> None:
    """Append a cylinder spanning from p0 to p1 into an existing BMesh."""
    v0 = Vector(p0)
    v1 = Vector(p1)
    diff = v1 - v0
    length = diff.length
    if length < 1e-5:
        return
    mid = (v0 + v1) * 0.5
    z_axis = Vector((0.0, 0.0, 1.0))
    quat = z_axis.rotation_difference(diff.normalized())
    mat = Matrix.Translation(mid) @ quat.to_matrix().to_4x4()

    ret = bmesh.ops.create_cone(
        bm,
        cap_ends=cap_ends,
        cap_tris=False,
        segments=segments,
        radius1=radius,
        radius2=radius,
        depth=length,
        matrix=mat,
    )
    vert_set = set(ret["verts"])
    for f in bm.faces:
        if all(v in vert_set for v in f.verts):
            f.material_index = mat_index


def create_empty_root(
    name: str,
    collection: bpy.types.Collection,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    extras: dict | None = None,
) -> bpy.types.Object:
    """Create an Empty object acting as prefab root with glTF extras metadata."""
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.15
    obj.location = location
    collection.objects.link(obj)
    if extras:
        for k, v in extras.items():
            obj[k] = v
    return obj


def apply_smooth_by_angle(bm: bmesh.types.BMesh, angle_deg: float = 40.0) -> None:
    """
    Smooth curved surfaces (cylinders, domes, spheres, organic fabric) while marking
    edges >= angle_deg as sharp so mechanical/architectural creases stay razor-crisp in glTF!
    """
    bm.normal_update()
    limit_rad = math.radians(angle_deg)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle(0.0) < limit_rad
        else:
            e.smooth = False


def finalize_bmesh_object(
    name: str,
    bm: bmesh.types.BMesh,
    materials: list[bpy.types.Material],
    collection: bpy.types.Collection,
    parent: bpy.types.Object | None = None,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    uv_scale: float = 0.5,
    bevel_width: float = 0.0,
    shade_smooth: bool = True,
    smooth_angle_deg: float = 40.0,
    extras: dict | None = None,
) -> bpy.types.Object:
    """Convert BMesh into a linked Blender Object with UVs, materials, angle-weighted normals, Bevel, and metadata."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    apply_box_uv(bm, uv_scale=uv_scale)

    if shade_smooth:
        apply_smooth_by_angle(bm, angle_deg=smooth_angle_deg)
    else:
        for f in bm.faces:
            f.smooth = False

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()

    for mat in materials:
        mesh.materials.append(mat)

    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    collection.objects.link(obj)

    if parent is not None:
        obj.parent = parent

    if bevel_width > 0.0:
        bev = obj.modifiers.new(name="TacticalBevel", type="BEVEL")
        bev.width = bevel_width
        bev.segments = 2
        bev.limit_method = "ANGLE"
        bev.angle_limit = math.radians(35.0)

    if extras:
        for k, v in extras.items():
            obj[k] = v

    return obj


def clone_hierarchy(
    root_obj: bpy.types.Object,
    target_collection: bpy.types.Collection,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rot_z_deg: float = 0.0,
    prefix: str = "",
    skip_child_substrings: tuple[str, ...] = (),
) -> bpy.types.Object:
    """
    Instance-clone an entire prefab hierarchy (sharing Mesh datablocks!) into target_collection.
    Allows hiding/omitting specific destructible chunks via skip_child_substrings to stage battle damage!
    """
    new_root = root_obj.copy()
    if prefix:
        new_root.name = f"{prefix}_{root_obj.name}"
    new_root.location = location
    new_root.rotation_euler = (0.0, 0.0, math.radians(rot_z_deg))
    target_collection.objects.link(new_root)

    for child in root_obj.children:
        if any(sub in child.name for sub in skip_child_substrings):
            continue
        _clone_child_recursive(child, new_root, target_collection, prefix, skip_child_substrings)

    return new_root


def _clone_child_recursive(
    obj: bpy.types.Object,
    new_parent: bpy.types.Object,
    target_collection: bpy.types.Collection,
    prefix: str,
    skip_child_substrings: tuple[str, ...],
) -> None:
    c = obj.copy()
    if prefix:
        c.name = f"{prefix}_{obj.name}"
    c.parent = new_parent
    if new_parent.type == "ARMATURE":
        for mod in c.modifiers:
            if mod.type == "ARMATURE":
                mod.object = new_parent
    target_collection.objects.link(c)
    for sub in obj.children:
        if any(s in sub.name for s in skip_child_substrings):
            continue
        _clone_child_recursive(sub, c, target_collection, prefix, skip_child_substrings)


def select_hierarchy_only(root_obj: bpy.types.Object) -> list[bpy.types.Object]:
    """Deselect all objects and select root_obj + all its recursive descendants."""
    for o in bpy.context.view_layer.objects:
        o.select_set(False)

    gathered: list[bpy.types.Object] = []

    def _walk(o: bpy.types.Object) -> None:
        gathered.append(o)
        o.select_set(True)
        for ch in o.children:
            _walk(ch)

    _walk(root_obj)
    bpy.context.view_layer.objects.active = root_obj
    return gathered


def export_prefab_glb(root_obj: bpy.types.Object, filepath: str) -> None:
    """
    Temporarily zero root_obj world location/rotation, export its entire hierarchy to .glb
    with Y-up, applied modifiers, and custom properties (extras) for Three.js, then restore.
    """
    saved_loc = root_obj.location.copy()
    saved_rot = root_obj.rotation_euler.copy()
    try:
        root_obj.location = (0.0, 0.0, 0.0)
        root_obj.rotation_euler = (0.0, 0.0, 0.0)
        bpy.context.view_layer.update()
        select_hierarchy_only(root_obj)

        gltf_keys = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
        kwargs = {
            "filepath": filepath,
            "export_format": "GLB",
            "use_selection": True,
            "export_yup": True,
            "export_apply": True,
        }
        if "export_extras" in gltf_keys:
            kwargs["export_extras"] = True

        bpy.ops.export_scene.gltf(**kwargs)
    finally:
        root_obj.location = saved_loc
        root_obj.rotation_euler = saved_rot
        bpy.context.view_layer.update()


def export_skinned_rig_glb(arm_obj: bpy.types.Object, filepath: str) -> None:
    """
    Export an Armature + SkinnedMesh hierarchy to .glb preserving Skeleton, Vertex Weights,
    and NLA Animation Tracks (export_apply=False, export_skins=True, export_animations=True).
    """
    saved_loc = arm_obj.location.copy()
    saved_rot = arm_obj.rotation_euler.copy()
    try:
        arm_obj.location = (0.0, 0.0, 0.0)
        arm_obj.rotation_euler = (0.0, 0.0, 0.0)
        bpy.context.view_layer.update()
        select_hierarchy_only(arm_obj)

        gltf_keys = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
        kwargs = {
            "filepath": filepath,
            "export_format": "GLB",
            "use_selection": True,
            "export_yup": True,
            "export_apply": False,
            "export_skins": True,
            "export_animations": True,
        }
        if "export_animation_mode" in gltf_keys:
            kwargs["export_animation_mode"] = "NLA_TRACKS"
        if "export_reset_pose_bones" in gltf_keys:
            kwargs["export_reset_pose_bones"] = True
        if "export_extras" in gltf_keys:
            kwargs["export_extras"] = True

        bpy.ops.export_scene.gltf(**kwargs)
    finally:
        arm_obj.location = saved_loc
        arm_obj.rotation_euler = saved_rot
        bpy.context.view_layer.update()
