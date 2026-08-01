import bpy
import json
import os
import sys


def clean(value):
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if hasattr(value, "to_list"):
        return value.to_list()
    return str(value)


def custom_properties(item):
    return {
        key: clean(item[key])
        for key in item.keys()
        if key != "_RNA_UI"
    }


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    output = args[0] if args else os.path.splitext(bpy.data.filepath)[0] + "-rig.json"
    result = {
        "source": bpy.data.filepath,
        "blender": bpy.app.version_string,
        "scene": bpy.context.scene.name,
        "collections": [collection.name for collection in bpy.data.collections],
        "objects": {},
        "armatures": [],
        "meshes": [],
        "actions": [],
        "texts": [text.name for text in bpy.data.texts],
    }

    for obj in bpy.data.objects:
        result["objects"][obj.type] = result["objects"].get(obj.type, 0) + 1

    for obj in bpy.data.objects:
        if obj.type != "ARMATURE":
            continue
        pose_bones = []
        for bone in obj.pose.bones:
            is_control = bool(bone.custom_shape) or not bone.bone.use_deform or bool(bone.constraints)
            pose_bones.append({
                "name": bone.name,
                "parent": bone.parent.name if bone.parent else None,
                "deform": bool(bone.bone.use_deform),
                "control": is_control,
                "custom_shape": bone.custom_shape.name if bone.custom_shape else None,
                "constraints": [constraint.type for constraint in bone.constraints],
                "properties": custom_properties(bone),
                "head": list(bone.head),
                "tail": list(bone.tail),
            })
        result["armatures"].append({
            "object": obj.name,
            "data": obj.data.name,
            "visible": not obj.hide_viewport,
            "bones": len(obj.data.bones),
            "deform_bones": sum(1 for bone in obj.data.bones if bone.use_deform),
            "control_bones": sum(1 for bone in pose_bones if bone["control"]),
            "properties": custom_properties(obj),
            "pose_bones": pose_bones,
        })

    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        result["meshes"].append({
            "name": obj.name,
            "visible": obj.visible_get(),
            "hide_viewport": obj.hide_viewport,
            "hide_render": obj.hide_render,
            "vertices": len(obj.data.vertices),
            "polygons": len(obj.data.polygons),
            "parent": obj.parent.name if obj.parent else None,
            "modifiers": [
                {
                    "type": modifier.type,
                    "object": getattr(getattr(modifier, "object", None), "name", None),
                    "viewport": modifier.show_viewport,
                    "render": modifier.show_render,
                }
                for modifier in obj.modifiers
            ],
            "materials": [material.name for material in obj.data.materials if material],
        })

    for action in bpy.data.actions:
        result["actions"].append({
            "name": action.name,
            "frame_range": list(action.frame_range),
            "slots": len(getattr(action, "slots", [])),
        })

    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    with open(output, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
    print("MNANIMAT3D_RIG_REPORT=" + os.path.abspath(output))


main()
