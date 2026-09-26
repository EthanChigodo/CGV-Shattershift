"""Import the Javelin FBX, rewire its three materials to the shipped textures, export a web .glb."""
import bpy, sys, os

argv = sys.argv[sys.argv.index("--") + 1:]
fbx, tex, out = argv[0], argv[1], argv[2]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=fbx)

MAPS = {
    "Material #1": ("Javeline Base Texture.png", "Javeline Base Normal.png"),
    "Material #2": ("BaseHandle Diffuse.png", "Base Handle Normal.png"),
    "Material #3": ("fornt_Body diffuse.png", "fornt_bodyNormal.png"),
}

def load(name):
    img = bpy.data.images.load(os.path.join(tex, name), check_existing=True)
    if max(img.size) > 1024:
        s = 1024 / max(img.size)
        img.scale(int(img.size[0] * s), int(img.size[1] * s))
    return img

for mat_name, (diff, nrm) in MAPS.items():
    mat = bpy.data.materials.get(mat_name)
    if not mat:
        continue
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out_node = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = 0.35
    bsdf.inputs["Roughness"].default_value = 0.55
    nt.links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])
    col = nt.nodes.new("ShaderNodeTexImage")
    col.image = load(diff)
    nt.links.new(col.outputs["Color"], bsdf.inputs["Base Color"])
    nimg = nt.nodes.new("ShaderNodeTexImage")
    nimg.image = load(nrm)
    nimg.image.colorspace_settings.name = "Non-Color"
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(nimg.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

# Two small parts came through with no material at all.
fallback = bpy.data.materials.get("Material #3")
for o in bpy.context.scene.objects:
    if o.type == "MESH" and not o.material_slots and fallback:
        o.data.materials.append(fallback)
    if o.type == "MESH":
        tris = sum(max(1, len(p.vertices) - 2) for p in o.data.polygons)
        if tris > 7000:
            m = o.modifiers.new("web_decimate", "DECIMATE")
            m.ratio = 7000 / tris
        o.select_set(True)

bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_apply=True,
                          export_image_format="JPEG", export_jpeg_quality=82,
                          export_cameras=False, export_lights=False, export_animations=False)
print("OK", os.path.getsize(out))
