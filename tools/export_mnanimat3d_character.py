import bpy
import json
import os
import re
import sys


def category_for(name):
    value = name.lower()
    if any(part in value for part in ("spine", "chest", "hips", "pelvis", "neck", "head")):
        return "Tronco"
    if any(part in value for part in ("upperarm", "forearm", "shoulder", "hand", "wrist")):
        return "Braços"
    if any(part in value for part in ("thigh", "shin", "knee", "foot", "toe")):
        return "Pernas"
    return "Rosto"


def friendly_label(name):
    value = re.sub(r"^(DEF|ORG|MCH)-", "", name)
    value = value.replace("_", " ")
    value = re.sub(r"(\D)(\d+)", r"\1 \2", value)
    value = value.replace(".L", " · E").replace(".R", " · D")
    return value


def is_primary_controller(name):
    patterns = (
        r"^DEF-(Pelvis|Hips|Spine[123]?|Chest|Neck|Head|Jaw)$",
        r"^DEF-(Shoulder|Upperarm1|UpperArm_1|Forearm1|Forearm_1|Hand|Wrist|Thigh1|Thigh_1|Shin1|Knee_1|Foot|Toe|Toes)\.[LR]$",
        r"^DEF-Eye\.[LR]$",
    )
    return any(re.match(pattern, name, re.IGNORECASE) for pattern in patterns)


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(args) < 5:
        raise RuntimeError("Expected: output.glb manifest.json slug display_name attribution")
    output, manifest_path, slug, display_name, attribution = args[:5]
    versions = {"rain": "rain/v3", "snow": "snow/v4"}
    source_url = f"https://studio.blender.org/characters/{versions.get(slug, slug)}/"

    rigs = [obj for obj in bpy.data.objects if obj.type == "ARMATURE" and obj.name.startswith("RIG-")]
    if not rigs:
        raise RuntimeError("Main RIG armature was not found")
    rig = max(rigs, key=lambda obj: len(obj.data.bones))

    bpy.context.scene["mnanimat3d_character"] = display_name
    bpy.context.scene["license"] = "CC BY 4.0"
    bpy.context.scene["attribution"] = attribution
    bpy.context.scene["source"] = source_url
    rig["mnanimat3d_character"] = display_name
    rig["license"] = "CC BY 4.0"
    rig["attribution"] = attribution
    rig["source"] = source_url

    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    selected_meshes = []
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and obj.visible_get() and obj.name.startswith("GEO-"):
            obj.select_set(True)
            selected_meshes.append(obj)
            for modifier in obj.modifiers:
                if modifier.type == "SUBSURF":
                    modifier.levels = 0
                    modifier.render_levels = 0
    rig.hide_set(False)
    rig.hide_viewport = False
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig

    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    result = bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(output),
        check_existing=False,
        export_format="GLB",
        export_copyright=attribution + " · Licensed CC BY 4.0",
        export_image_format="AUTO",
        export_jpeg_quality=82,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        use_selection=True,
        use_visible=True,
        export_extras=True,
        export_yup=True,
        export_apply=False,
        export_animations=False,
        export_def_bones=True,
        export_leaf_bone=False,
        export_current_frame=True,
        export_reset_pose_bones=True,
        export_skins=True,
        export_influence_nb=4,
        export_all_influences=False,
        export_morph=True,
        export_morph_normal=False,
        export_morph_tangent=False,
        export_cameras=False,
        export_lights=False,
        export_gpu_instances=False,
        export_hierarchy_full_collections=False,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"glTF export failed: {result}")

    deform_bones = [bone.name for bone in rig.data.bones if bone.use_deform]
    controllers = []
    for bone_name in deform_bones:
        if not is_primary_controller(bone_name):
            continue
        side = "E" if bone_name.endswith(".L") else "D" if bone_name.endswith(".R") else None
        controllers.append({
            "bone": bone_name,
            "label": friendly_label(bone_name),
            "group": category_for(bone_name),
            "side": side,
            "mode": "rotate",
        })
    controllers.sort(key=lambda item: (item["group"], item["bone"]))
    manifest = {
        "id": slug,
        "name": display_name,
        "source": source_url,
        "license": "CC BY 4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "attribution": attribution,
        "original_blend": bpy.data.filepath,
        "armature": rig.name,
        "mesh_count": len(selected_meshes),
        "deform_bone_count": len(deform_bones),
        "controllers": controllers,
        "limitations": "MNAnimat3D exposes direct deform-bone controls. CloudRig IK/FK, constraints, drivers and custom Python UI remain available in the original .blend via Open in Blender.",
    }
    os.makedirs(os.path.dirname(os.path.abspath(manifest_path)), exist_ok=True)
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
    print("MNANIMAT3D_GLTF=" + os.path.abspath(output))
    print("MNANIMAT3D_CONTROLLERS=" + str(len(controllers)))


main()
