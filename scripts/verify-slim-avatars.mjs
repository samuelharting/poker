// Proves the slimmed avatar GLBs load in three.js exactly like the sources:
// same node tree (names, order, transforms), same meshes / materials / geometry
// attribute bytes, same skins (bone order, inverse binds), and the kept clips
// with identical tracks. Only the unused clips may be missing.
//
// usage: node scripts/verify-slim-avatars.mjs [--src assets-src/avatars] [--out public/models/avatars]
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > 0 ? process.argv[index + 1] : fallback
}
const srcDir = path.resolve(repo, arg('src', 'assets-src/avatars'))
const outDir = path.resolve(repo, arg('out', 'public/models/avatars'))

const load = file => new Promise((resolve, reject) => {
  const bytes = readFileSync(file)
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  new GLTFLoader().parse(buffer, '', resolve, reject)
})

const sameArray = (a, b) => {
  if (!a || !b) return a === b
  if (a.constructor !== b.constructor || a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return false
  return true
}

function describeTree(root) {
  const lines = []
  root.traverse(object => {
    const materials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : []
    lines.push([
      object.type,
      object.name,
      object.parent?.name ?? '',
      object.position.toArray().join(','),
      object.quaternion.toArray().join(','),
      object.scale.toArray().join(','),
      materials.map(material => `${material.type}:${material.name}:${material.color?.getHexString?.() ?? ''}:${material.roughness ?? ''}:${material.metalness ?? ''}:${material.transparent}:${material.side}`).join('|'),
    ].join(' '))
  })
  return lines
}

function compareMeshes(a, b, problems) {
  const meshesA = []
  const meshesB = []
  a.traverse(object => { if (object.isMesh) meshesA.push(object) })
  b.traverse(object => { if (object.isMesh) meshesB.push(object) })
  if (meshesA.length !== meshesB.length) problems.push(`mesh count ${meshesA.length} vs ${meshesB.length}`)
  meshesA.forEach((meshA, index) => {
    const meshB = meshesB[index]
    if (!meshB) return
    const geoA = meshA.geometry
    const geoB = meshB.geometry
    const names = Object.keys(geoA.attributes).sort()
    if (names.join() !== Object.keys(geoB.attributes).sort().join()) problems.push(`${meshA.name}: attribute set differs`)
    for (const name of names) {
      const attrA = geoA.attributes[name]
      const attrB = geoB.attributes[name]
      if (!attrB || attrA.itemSize !== attrB.itemSize || attrA.normalized !== attrB.normalized || !sameArray(attrA.array, attrB.array)) {
        problems.push(`${meshA.name}: attribute ${name} differs`)
      }
    }
    if (!sameArray(geoA.index?.array, geoB.index?.array)) problems.push(`${meshA.name}: index differs`)
    if (JSON.stringify(geoA.groups) !== JSON.stringify(geoB.groups)) problems.push(`${meshA.name}: groups differ`)
    if (meshA.isSkinnedMesh) {
      const skA = meshA.skeleton
      const skB = meshB.skeleton
      if (skA.bones.map(bone => bone.name).join() !== skB.bones.map(bone => bone.name).join()) problems.push(`${meshA.name}: bone order differs`)
      skA.boneInverses.forEach((inverse, i) => {
        if (!sameArray(inverse.elements, skB.boneInverses[i]?.elements)) problems.push(`${meshA.name}: bone inverse ${i} differs`)
      })
      if (!sameArray(meshA.bindMatrix.elements, meshB.bindMatrix.elements)) problems.push(`${meshA.name}: bind matrix differs`)
    }
  })
}

let failures = 0
for (const file of readdirSync(srcDir).filter(name => name.endsWith('.glb')).sort()) {
  const [source, slim] = await Promise.all([load(path.join(srcDir, file)), load(path.join(outDir, file))])
  const problems = []
  const treeA = describeTree(source.scene)
  const treeB = describeTree(slim.scene)
  if (treeA.join('\n') !== treeB.join('\n')) {
    const firstDiff = treeA.findIndex((line, i) => line !== treeB[i])
    problems.push(`node tree differs at ${firstDiff}: "${treeA[firstDiff]}" vs "${treeB[firstDiff]}"`)
  }
  compareMeshes(source.scene, slim.scene, problems)
  for (const clip of slim.animations) {
    const original = source.animations.find(candidate => candidate.name === clip.name)
    if (!original) { problems.push(`clip ${clip.name} not in source`); continue }
    if (original.duration !== clip.duration || original.tracks.length !== clip.tracks.length) problems.push(`clip ${clip.name}: duration/track count differs`)
    original.tracks.forEach((track, i) => {
      const other = clip.tracks[i]
      if (!other || other.name !== track.name || !sameArray(track.times, other.times) || !sameArray(track.values, other.values) || track.getInterpolation() !== other.getInterpolation()) {
        problems.push(`clip ${clip.name}: track ${track.name} differs`)
      }
    })
  }
  const dropped = source.animations.length - slim.animations.length
  if (problems.length) {
    failures += 1
    console.log(`FAIL ${file}\n  ${problems.slice(0, 12).join('\n  ')}`)
  } else {
    console.log(`ok   ${file}: ${treeA.length} nodes, clips ${slim.animations.map(clip => clip.name.split('|').pop()).join('/')} identical, ${dropped} unused clips removed`)
  }
}
process.exit(failures ? 1 : 0)
