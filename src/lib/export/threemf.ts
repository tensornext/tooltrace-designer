import { zipSync, strToU8 } from 'fflate';
import type { TriMesh } from './mesh';

/** 3MF (zip of XML) with a single mesh object in millimetres. Vertices are de-duplicated. */
export function to3mf(mesh: TriMesh, name = 'tooltrace'): Uint8Array {
  const verts: number[] = [];
  const index = new Map<string, number>();
  const tris: number[] = [];
  const t = mesh.tris;
  for (let i = 0; i < t.length; i += 3) {
    const key = `${t[i].toFixed(4)},${t[i + 1].toFixed(4)},${t[i + 2].toFixed(4)}`;
    let id = index.get(key);
    if (id === undefined) { id = verts.length / 3; index.set(key, id); verts.push(t[i], t[i + 1], t[i + 2]); }
    tris.push(id);
  }
  let vx = '';
  for (let i = 0; i < verts.length; i += 3) vx += `<vertex x="${verts[i].toFixed(4)}" y="${verts[i + 1].toFixed(4)}" z="${verts[i + 2].toFixed(4)}"/>`;
  let tx = '';
  for (let i = 0; i < tris.length; i += 3) tx += `<triangle v1="${tris[i]}" v2="${tris[i + 1]}" v3="${tris[i + 2]}"/>`;
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">${name}</metadata>
  <metadata name="Application">tooltrace-designer</metadata>
  <resources>
    <object id="1" name="${name}" type="model">
      <mesh><vertices>${vx}</vertices><triangles>${tx}</triangles></mesh>
    </object>
  </resources>
  <build><item objectid="1"/></build>
</model>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(model),
  }, { level: 6 });
}
