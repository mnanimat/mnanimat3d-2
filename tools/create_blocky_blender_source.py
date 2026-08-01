import bpy
import os
import sys


CONTROLLERS = {
    "root": "Corpo (raiz)",
    "torso": "Tronco",
    "head": "Cabeça",
    "arm-left": "Braço esquerdo",
    "arm-right": "Braço direito",
    "leg-left": "Perna esquerda",
    "leg-right": "Perna direita",
}


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(args) < 2:
        raise RuntimeError("Uso: input.glb output.blend")

    input_path, output_path = map(os.path.abspath, args[:2])
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=input_path)

    scene = bpy.context.scene
    scene["mnanimat3d_asset"] = "Personagem blocada"
    scene["source"] = "https://kenney.nl/assets/blocky-characters"
    scene["license"] = "CC0 1.0 Universal"
    scene["credit"] = "Kenney"

    palette = {
        "root": (0.49, 0.36, 1.0, 1.0),
        "torso": (0.15, 0.84, 1.0, 1.0),
        "head": (1.0, 0.31, 0.78, 1.0),
    }
    for object_name, label in CONTROLLERS.items():
        obj = bpy.data.objects.get(object_name)
        if not obj:
            continue
        obj["mnanimat3d_controller"] = True
        obj["controller_label"] = label
        obj.show_name = True
        obj.color = palette.get(object_name, (0.31, 0.88, 0.64, 1.0))
        if hasattr(obj, "show_in_front"):
            obj.show_in_front = True

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=output_path)
    print("MNANIMAT3D_BLOCKY_BLEND=" + output_path)


main()
