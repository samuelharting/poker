// Slims the avatar GLBs the table downloads. The Poly Pizza source files each
// carry 24 animation clips (Run, Gun_Shoot, Sword_Slash, Kick, ...), but the
// app only looks up the clips named in AVATAR_CLIP_NAMES
// (components/three/avatarAssetLoader.ts) and only plays Idle_Neutral. This
// drops every other clip, prunes the accessors / buffer views that only those
// clips used, dedups byte-identical buffer views and accessors, and repacks
// the binary chunk. Meshes, skins, materials, nodes (names, order, hierarchy,
// transforms) and the kept clips are copied byte for byte.
//
// No dependencies: a GLB is a JSON chunk plus one binary chunk, so this works
// on the raw glTF JSON.
//
// usage: node scripts/slim-avatars.mjs [--src assets-src/avatars] [--out public/models/avatars] [--check]
//   --check   exit non-zero if any output differs from what the script would write
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > 0 ? process.argv[index + 1] : fallback
}
const srcDir = path.resolve(repo, arg('src', 'assets-src/avatars'))
const outDir = path.resolve(repo, arg('out', 'public/models/avatars'))
const checkOnly = process.argv.includes('--check')

// Keep exactly the clips the loader can hand out. Read them from the loader so
// the two never drift apart.
function readKeptClipNames() {
  const loader = readFileSync(path.join(repo, 'components/three/avatarAssetLoader.ts'), 'utf8')
  const block = loader.match(/AVATAR_CLIP_NAMES\s*=\s*\{([\s\S]*?)\}\s*as const/)
  if (!block) throw new Error('AVATAR_CLIP_NAMES not found in avatarAssetLoader.ts')
  const names = [...block[1].matchAll(/:\s*'([^']+)'/g)].map(match => match[1])
  if (names.length === 0) throw new Error('AVATAR_CLIP_NAMES is empty')
  return names
}

function readGlb(file) {
  const buffer = readFileSync(file)
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a GLB`)
  const jsonLength = buffer.readUInt32LE(12)
  if (buffer.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${file}: first chunk is not JSON`)
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'))
  const binStart = 20 + jsonLength
  let bin = Buffer.alloc(0)
  if (binStart < buffer.length) {
    const binLength = buffer.readUInt32LE(binStart)
    if (buffer.readUInt32LE(binStart + 4) !== 0x004e4942) throw new Error(`${file}: second chunk is not BIN`)
    bin = buffer.subarray(binStart + 8, binStart + 8 + binLength)
  }
  return { json, bin }
}

function writeGlb(json, bin) {
  const pad = (data, byte) => {
    const rest = data.length % 4
    return rest === 0 ? data : Buffer.concat([data, Buffer.alloc(4 - rest, byte)])
  }
  const jsonChunk = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20)
  const binChunk = pad(bin, 0)
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  const chunkHeader = (length, type) => {
    const head = Buffer.alloc(8)
    head.writeUInt32LE(length, 0)
    head.writeUInt32LE(type, 4)
    return head
  }
  const parts = [header, chunkHeader(jsonChunk.length, 0x4e4f534a), jsonChunk]
  if (binChunk.length > 0) parts.push(chunkHeader(binChunk.length, 0x004e4942), binChunk)
  const out = Buffer.concat(parts)
  out.writeUInt32LE(out.length, 8)
  return out
}

function slim(json, bin, keptClips) {
  if ((json.buffers ?? []).length > 1 || json.buffers?.[0]?.uri) throw new Error('expected one embedded buffer')
  const missing = keptClips.filter(name => !(json.animations ?? []).some(clip => clip.name === name))
  if (missing.length > 0) throw new Error(`source is missing clips: ${missing.join(', ')}`)
  const droppedClips = (json.animations ?? []).filter(clip => !keptClips.includes(clip.name)).map(clip => clip.name)
  json.animations = (json.animations ?? []).filter(clip => keptClips.includes(clip.name))

  // 1. Every accessor still referenced, in a stable order.
  // Mesh data is never merged, even when two primitives hold identical bytes:
  // GLTFLoader would then hand both meshes one shared BufferAttribute /
  // geometry, and per-mesh code that edits geometry would leak across parts.
  const accessorRefs = []
  const meshAccessors = new Set()
  const visitAccessor = (owner, key, mesh = false) => {
    if (!owner || owner[key] == null) return
    accessorRefs.push([owner, key])
    if (mesh) meshAccessors.add(owner[key])
  }
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      for (const key of Object.keys(primitive.attributes)) visitAccessor(primitive.attributes, key, true)
      visitAccessor(primitive, 'indices', true)
      for (const target of primitive.targets ?? []) for (const key of Object.keys(target)) visitAccessor(target, key, true)
    }
  }
  for (const skin of json.skins ?? []) visitAccessor(skin, 'inverseBindMatrices')
  for (const clip of json.animations) for (const sampler of clip.samplers) { visitAccessor(sampler, 'input'); visitAccessor(sampler, 'output') }

  // 2. Buffer views referenced by those accessors (and by images), deduped by content.
  const meshViews = new Set([...meshAccessors].map(index => json.accessors[index].bufferView))
  const viewKey = (view, oldIndex) => {
    if (meshViews.has(oldIndex)) return `mesh:${oldIndex}`
    const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
    return `${view.byteStride ?? ''}|${view.target ?? ''}|${createHash('sha1').update(bytes).digest('hex')}`
  }
  const newViews = []
  const newViewByKey = new Map()
  const viewRemap = new Map()
  const chunks = []
  let offset = 0
  const keepView = oldIndex => {
    if (viewRemap.has(oldIndex)) return viewRemap.get(oldIndex)
    const view = json.bufferViews[oldIndex]
    const key = viewKey(view, oldIndex)
    let index = newViewByKey.get(key)
    if (index == null) {
      const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
      const align = (4 - (offset % 4)) % 4
      if (align) { chunks.push(Buffer.alloc(align)); offset += align }
      const next = { ...view, buffer: 0, byteOffset: offset }
      if (next.byteOffset === 0) delete next.byteOffset
      chunks.push(bytes)
      offset += bytes.length
      index = newViews.push(next) - 1
      newViewByKey.set(key, index)
    }
    viewRemap.set(oldIndex, index)
    return index
  }

  // 3. Accessors, deduped when they describe the same data.
  const newAccessors = []
  const accessorByKey = new Map()
  const accessorRemap = new Map()
  const keepAccessor = oldIndex => {
    if (accessorRemap.has(oldIndex)) return accessorRemap.get(oldIndex)
    const accessor = structuredClone(json.accessors[oldIndex])
    if (accessor.bufferView != null) accessor.bufferView = keepView(accessor.bufferView)
    if (accessor.sparse) {
      accessor.sparse.indices.bufferView = keepView(accessor.sparse.indices.bufferView)
      accessor.sparse.values.bufferView = keepView(accessor.sparse.values.bufferView)
    }
    const { name, ...shape } = accessor
    const key = meshAccessors.has(oldIndex) ? `mesh:${oldIndex}` : JSON.stringify(shape)
    let index = accessorByKey.get(key)
    if (index == null) {
      index = newAccessors.push(accessor) - 1
      accessorByKey.set(key, index)
    }
    accessorRemap.set(oldIndex, index)
    return index
  }
  for (const [owner, key] of accessorRefs) owner[key] = keepAccessor(owner[key])
  for (const image of json.images ?? []) if (image.bufferView != null) image.bufferView = keepView(image.bufferView)

  json.accessors = newAccessors
  json.bufferViews = newViews
  const newBin = Buffer.concat(chunks)
  json.buffers = [{ byteLength: newBin.length }]
  return { json, bin: newBin, droppedClips }
}

const keptClips = readKeptClipNames()
if (!existsSync(srcDir)) throw new Error(`source folder not found: ${srcDir}`)
mkdirSync(outDir, { recursive: true })
let stale = 0
let before = 0
let after = 0
for (const file of readdirSync(srcDir).filter(name => name.endsWith('.glb')).sort()) {
  const source = readGlb(path.join(srcDir, file))
  const sourceBytes = readFileSync(path.join(srcDir, file)).length
  const result = slim(source.json, source.bin, keptClips)
  const out = writeGlb(result.json, result.bin)
  const target = path.join(outDir, file)
  before += sourceBytes
  after += out.length
  if (checkOnly) {
    const current = existsSync(target) ? readFileSync(target) : null
    if (!current || !current.equals(out)) { stale += 1; console.log(`stale: ${file}`) }
    continue
  }
  writeFileSync(target, out)
  console.log(`${file}: ${sourceBytes} -> ${out.length} bytes (kept ${result.json.animations.length} clips, dropped ${result.droppedClips.length})`)
}
console.log(`total: ${before} -> ${after} bytes (${((1 - after / before) * 100).toFixed(1)}% smaller); clips kept: ${keptClips.join(', ')}`)
if (checkOnly && stale > 0) process.exit(1)
