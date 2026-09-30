import * as THREE from 'three'

/**
 * Facial hair (a moustache, or the moustache piece of a hair+beard mesh) is a rigid part of the head
 * mesh, and its crescent reads as a grin whatever the mouth ribbon does. This wraps the hair
 * material's shader (no extra draw call) so that, in the mouth region only:
 *   - the moustache BENDS with the mouth corners (vertex shader): each half follows its own corner,
 *     so a frown droops the tips, a smirk lifts one side, a laugh lifts both. Only the moustache
 *     piece itself moves (a per-vertex weight picked from the mesh's connected pieces), so beards and
 *     sideburns never tear;
 *   - on light hair, it is shaded towards its lower edge and outer tips (fragment shader), so a
 *     bright crescent never reads as teeth. Neutral and frowning faces get a soft lip shadow, happy
 *     faces keep the hair bright.
 * The ink-outline hull of the same mesh gets the identical bend so the ink never detaches.
 */
export interface FacialHairShade {
  uniforms: {
    uHairToHead: { value: THREE.Matrix4 }
    /** x = frown/shade weight 0..1, y = moustache lower edge (Head y), z = unit (eye radius), w = mouth centre x. */
    uHairShade: { value: THREE.Vector4 }
    /**
     * x = lift of the -x half, y = lift of the +x half (eye radii at the tip, + up / - down),
     * z = moustache half width (eye radii), w = centre lift (eye radii, the upper lip raising).
     */
    uHairBend: { value: THREE.Vector4 }
    /** Mesh-space vector for one eye radius of Head-space "up" (bind pose). */
    uHairUp: { value: THREE.Vector3 }
    /** 1 on light hair (shade the crescent), 0 on dark hair (bend only). */
    uHairLight: { value: number }
  }
  /** The moustache piece, measured in the bind pose (null: no separate piece found, no bend). */
  moustache: MoustacheShape | null
  restore: () => void
}

export interface MoustacheShape {
  /** Half width in eye radii (from the mouth centre line). */
  halfWidth: number
  /** Lower edge (Head y) per bin across -halfWidth..+halfWidth. */
  lowerEdge: Float32Array
  /**
   * How far the outer tips of the lower edge sit ABOVE its middle (eye radii): an upturned crescent
   * reads as a grin at rest, so the rest pose pulls the tips level by this much.
   */
  tipRise: number
}

export const MOUSTACHE_EDGE_BINS = 17

/** Vertex displacement (shared by the hair material and its outline hull). */
const BEND_VERTEX = `
  {
    vec3 hp = (uHairToHead * vec4(position, 1.0)).xyz;
    float bax = min(abs(hp.x - uHairShade.w) / (uHairShade.z * max(uHairBend.z, 0.2)), 1.1);
    float lift = hp.x < uHairShade.w ? uHairBend.x : uHairBend.y;
    float centre = (1.0 - smoothstep(0.0, 0.7, bax)) * uHairBend.w;
    transformed += uHairUp * ((lift * bax * bax + centre) * aHairBend);
  }
`

function bendUniformDecl() {
  return 'attribute float aHairBend;\nuniform mat4 uHairToHead;\nuniform vec4 uHairShade;\nuniform vec4 uHairBend;\nuniform vec3 uHairUp;'
}

/**
 * Finds the moustache piece of a hair mesh: its connected parts (welded by position) that sit
 * entirely in the lip band around the mouth. Writes a per-vertex weight (1 = moustache) as the
 * `aHairBend` attribute (on the shared template geometry, deterministic per model).
 */
function measureMoustache(
  mesh: THREE.SkinnedMesh,
  toHead: THREE.Matrix4,
  edgeY: number,
  unit: number,
  centerX: number
): { weights: Float32Array; shape: MoustacheShape } | null {
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  const count = position.count
  const parent = new Int32Array(count)
  for (let i = 0; i < count; i += 1) parent[i] = i
  const find = (i: number) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  const welded = new Map<string, number>()
  for (let i = 0; i < count; i += 1) {
    const key = `${Math.round(position.getX(i) * 1e4)},${Math.round(position.getY(i) * 1e4)},${Math.round(position.getZ(i) * 1e4)}`
    const other = welded.get(key)
    if (other === undefined) welded.set(key, i)
    else union(i, other)
  }
  const index = geometry.getIndex()
  if (index) {
    for (let t = 0; t + 2 < index.count; t += 3) {
      union(index.getX(t), index.getX(t + 1))
      union(index.getX(t), index.getX(t + 2))
    }
  }
  const head = new Float32Array(count * 2)
  const point = new THREE.Vector3()
  const boxes = new Map<number, { x: number; y0: number; y1: number }>()
  for (let i = 0; i < count; i += 1) {
    point.fromBufferAttribute(position, i).applyMatrix4(toHead)
    const x = (point.x - centerX) / unit
    const y = (point.y - edgeY) / unit
    head[i * 2] = x
    head[i * 2 + 1] = y
    const root = find(i)
    const box = boxes.get(root)
    if (box) {
      box.x = Math.max(box.x, Math.abs(x))
      box.y0 = Math.min(box.y0, y)
      box.y1 = Math.max(box.y1, y)
    } else {
      boxes.set(root, { x: Math.abs(x), y0: y, y1: y })
    }
  }
  const pieces = new Set<number>()
  for (const [root, box] of boxes) {
    // The lip band: from just under the lip line to below the nose, never wider than the cheeks.
    if (box.y0 > -1.3 && box.y1 < 1.8 && box.x < 3.2) pieces.add(root)
  }
  if (pieces.size === 0) return null
  const weights = new Float32Array(count)
  let halfWidth = 0
  for (let i = 0; i < count; i += 1) {
    if (!pieces.has(find(i))) continue
    weights[i] = 1
    halfWidth = Math.max(halfWidth, Math.abs(head[i * 2]!))
  }
  if (halfWidth < 0.3) return null
  // Lower edge per bin (Head y), empty bins filled from their neighbours.
  const lowerEdge = new Float32Array(MOUSTACHE_EDGE_BINS).fill(Infinity)
  // Each bin takes the lowest moustache vertex within one bin width either side (a conservative
  // lower envelope: sparse bins that only hold top-edge vertices would otherwise read far too high).
  for (let i = 0; i < count; i += 1) {
    if (weights[i] === 0) continue
    const f = (head[i * 2]! / halfWidth + 1) * 0.5 * (MOUSTACHE_EDGE_BINS - 1)
    const y = head[i * 2 + 1]! * unit + edgeY
    for (let b = Math.max(0, Math.floor(f - 1)); b <= Math.min(MOUSTACHE_EDGE_BINS - 1, Math.ceil(f + 1)); b += 1) {
      if (Math.abs(b - f) <= 1) lowerEdge[b] = Math.min(lowerEdge[b]!, y)
    }
  }
  for (let pass = 0; pass < MOUSTACHE_EDGE_BINS; pass += 1) {
    let missing = false
    for (let b = 0; b < MOUSTACHE_EDGE_BINS; b += 1) {
      if (Number.isFinite(lowerEdge[b]!)) continue
      const left = b > 0 ? lowerEdge[b - 1]! : Infinity
      const right = b < MOUSTACHE_EDGE_BINS - 1 ? lowerEdge[b + 1]! : Infinity
      const value = Number.isFinite(left) && Number.isFinite(right) ? (left + right) / 2 : Number.isFinite(left) ? left : right
      if (Number.isFinite(value)) lowerEdge[b] = value
      else missing = true
    }
    if (!missing) break
  }
  const mid = (MOUSTACHE_EDGE_BINS - 1) / 2
  let centre = Infinity
  let tips = Infinity
  for (let b = 0; b < MOUSTACHE_EDGE_BINS; b += 1) {
    const edge = lowerEdge[b]!
    if (!Number.isFinite(edge)) lowerEdge[b] = edgeY
    const off = Math.abs(b - mid) / mid
    if (off < 0.26) centre = Math.min(centre, lowerEdge[b]!)
    if (off > 0.9) tips = Math.min(tips, lowerEdge[b]!)
  }
  const tipRise = Number.isFinite(centre) && Number.isFinite(tips) ? (tips - centre) / unit : 0
  return { weights, shape: { halfWidth, lowerEdge, tipRise } }
}

export function installFacialHairShade(
  material: THREE.MeshToonMaterial,
  mesh: THREE.SkinnedMesh,
  toHead: THREE.Matrix4,
  edgeY: number,
  unit: number,
  centerX: number,
  options: { light: boolean; outline?: THREE.SkinnedMesh | null }
): FacialHairShade {
  const measured = measureMoustache(mesh, toHead, edgeY, unit, centerX)
  const weights = measured?.weights ?? new Float32Array(mesh.geometry.getAttribute('position').count)
  // Shared template geometry: the same model always measures the same, so writing it once is safe.
  if (!mesh.geometry.getAttribute('aHairBend')) mesh.geometry.setAttribute('aHairBend', new THREE.BufferAttribute(weights, 1))
  const outline = options.outline ?? null
  if (outline && !outline.geometry.getAttribute('aHairBend')) outline.geometry.setAttribute('aHairBend', mesh.geometry.getAttribute('aHairBend'))
  // One eye radius of Head "up", expressed in the mesh's bind space (the displacement happens before skinning).
  const inverse = toHead.clone().invert()
  const up0 = new THREE.Vector3(0, 0, 0).applyMatrix4(inverse)
  const up1 = new THREE.Vector3(0, unit, 0).applyMatrix4(inverse)
  const uniforms: FacialHairShade['uniforms'] = {
    uHairToHead: { value: toHead.clone() },
    uHairShade: { value: new THREE.Vector4(0.3, edgeY, unit, centerX) },
    uHairBend: { value: new THREE.Vector4(0, 0, measured ? measured.shape.halfWidth : 1.6, 0) },
    uHairUp: { value: up1.sub(up0) },
    uHairLight: { value: options.light ? 1 : 0 },
  }
  const previous = material.onBeforeCompile
  const previousKey = material.customProgramCacheKey
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vHairHeadP;\n${bendUniformDecl()}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n  vHairHeadP = (uHairToHead * vec4(position, 1.0)).xyz;\n${BEND_VERTEX}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHairHeadP;\nuniform vec4 uHairShade;\nuniform float uHairLight;')
      .replace(
        '#include <opaque_fragment>',
        `if (uHairLight > 0.5) {
      float hu = uHairShade.z;
      float hy = (vHairHeadP.y - uHairShade.y) / hu;
      float hx = abs(vHairHeadP.x - uHairShade.w) / hu;
      // Moustache zone: a band around the mouth, in front of the face, not the hair above the eyes.
      float zone = smoothstep(-1.2, -0.5, hy) * (1.0 - smoothstep(0.9, 1.5, hy)) * (1.0 - smoothstep(1.5, 2.3, hx));
      float lower = 1.0 - smoothstep(-0.1, 0.75, hy);
      float tips = smoothstep(0.35, 1.25, hx);
      float shade = min(0.45, zone * (0.12 + uHairShade.x * (0.36 * lower + 0.34 * tips)));
      // Shade towards a deeper, richer version of the hair's own colour (plain darkening turned
      // gold and blond moustaches a muddy olive).
      vec3 deep = diffuseColor.rgb * diffuseColor.rgb * 0.75;
      outgoingLight = mix(outgoingLight, deep * (outgoingLight / max(diffuseColor.rgb, vec3(0.05))) * 0.8, shade);
      outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.96, 0.94, 0.96), zone * 0.5);
    }
    #include <opaque_fragment>`
      )
  }
  material.customProgramCacheKey = () => 'avatar-facial-hair-shade-v4'
  material.needsUpdate = true

  // The ink hull of the same mesh: same bend, or the outline would stay behind as a ghost moustache.
  const outlineMaterial = outline && !Array.isArray(outline.material) ? outline.material : null
  const outlinePrevious = outlineMaterial?.onBeforeCompile
  const outlinePreviousKey = outlineMaterial?.customProgramCacheKey
  if (outlineMaterial && outlinePrevious) {
    outlineMaterial.onBeforeCompile = (shader, renderer) => {
      outlinePrevious.call(outlineMaterial, shader, renderer)
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${bendUniformDecl()}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${BEND_VERTEX}`)
    }
    outlineMaterial.customProgramCacheKey = () => 'avatar-ink-outline-hair-bend-v2'
    outlineMaterial.needsUpdate = true
  }
  return {
    uniforms,
    moustache: measured?.shape ?? null,
    restore() {
      material.onBeforeCompile = previous
      material.customProgramCacheKey = previousKey
      material.needsUpdate = true
      if (outlineMaterial && outlinePrevious && outlinePreviousKey) {
        outlineMaterial.onBeforeCompile = outlinePrevious
        outlineMaterial.customProgramCacheKey = outlinePreviousKey
        outlineMaterial.needsUpdate = true
      }
    },
  }
}
