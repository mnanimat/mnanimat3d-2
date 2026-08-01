"""Conversor local .blend -> .glb para o MNAnimat3D v3.2.

Executado pelo Blender em modo background com autoexec desativado.
O GLB incorpora texturas compatíveis, materiais, armatures, morph targets e animações.
"""
from __future__ import annotations

import bpy
import os
import sys
import traceback


def parse_args() -> dict[str, str]:
    argv = sys.argv
    args = argv[argv.index("--") + 1 :] if "--" in argv else []
    result: dict[str, str] = {}
    index = 0
    while index < len(args):
        if args[index].startswith("--") and index + 1 < len(args):
            result[args[index][2:]] = args[index + 1]
            index += 2
        else:
            index += 1
    return result


def supported_properties() -> set[str]:
    try:
        return {item.identifier for item in bpy.ops.export_scene.gltf.get_rna_type().properties}
    except Exception:
        return set()


def export(output: str) -> None:
    os.makedirs(os.path.dirname(output), exist_ok=True)
    supported = supported_properties()

    requested = {
        "filepath": output,
        "export_format": "GLB",
        "use_selection": False,
        "use_visible": True,
        "export_animations": True,
        "export_frame_range": True,
        "export_force_sampling": True,
        "export_nla_strips": True,
        "export_skins": True,
        "export_morph": True,
        "export_materials": "EXPORT",
        "export_image_format": "AUTO",
        "export_cameras": True,
        "export_lights": True,
        "export_extras": True,
        "export_yup": True,
        "export_apply": False,
        "export_def_bones": False,
    }
    kwargs = {key: value for key, value in requested.items() if not supported or key in supported}

    try:
        result = bpy.ops.export_scene.gltf(**kwargs)
    except Exception:
        # Fallback mínimo para versões do exportador com nomes de parâmetros diferentes.
        minimal = {
            key: value
            for key, value in {
                "filepath": output,
                "export_format": "GLB",
                "use_selection": False,
                "export_animations": True,
            }.items()
            if not supported or key in supported
        }
        result = bpy.ops.export_scene.gltf(**minimal)

    if "FINISHED" not in result:
        raise RuntimeError(f"O exportador glTF retornou: {result}")
    if not os.path.isfile(output) or os.path.getsize(output) < 1024:
        raise RuntimeError("O GLB não foi criado ou ficou vazio.")


def main() -> None:
    args = parse_args()
    output = os.path.abspath(args.get("output", "mnanimat3d-import.glb"))
    print(f"[MNAnimat3D] Blender: {bpy.app.version_string}", flush=True)
    print(f"[MNAnimat3D] Arquivo: {bpy.data.filepath}", flush=True)
    print(f"[MNAnimat3D] Exportando: {output}", flush=True)
    export(output)
    print(f"[MNAnimat3D] Concluído: {os.path.getsize(output)} bytes", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise
