// Removes CSS selectors whose class names never appear in application source.
//
// Usage: node scripts/css-prune.mjs [--write] app/globals.css app/poker-polish.css
//
// A selector survives when every class it references is either a literal token
// in app/components/hooks/lib source or matches a dynamic template prefix such
// as `cinematic-seat-${index}`. Unused @keyframes are dropped as well.
import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'

const args = process.argv.slice(2)
const write = args.includes('--write')
const cssFiles = args.filter(arg => !arg.startsWith('--'))
const SOURCE_DIRS = ['app', 'components', 'hooks', 'lib', 'shared']
const SOURCE_EXT = /\.(tsx?|jsx?|mjs)$/
const EXTERNAL_CLASS_PREFIXES = ['epr', 'EmojiPickerReact', '__next', 'nextjs']

async function collectSource(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const chunks = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) chunks.push(...await collectSource(full))
    else if (SOURCE_EXT.test(entry.name)) chunks.push(await readFile(full, 'utf8'))
  }
  return chunks
}

const source = (await Promise.all(SOURCE_DIRS.map(collectSource))).flat().join('\n')
const tokens = new Set(source.match(/[A-Za-z_][\w-]*/g) ?? [])
const prefixes = new Set()
for (const match of source.matchAll(/([A-Za-z][\w-]*-)\$\{/g)) prefixes.add(match[1])
for (const match of source.matchAll(/['"`]([A-Za-z][\w-]*-)['"`]\s*\+/g)) prefixes.add(match[1])

function isClassUsed(name) {
  if (tokens.has(name)) return true
  if (EXTERNAL_CLASS_PREFIXES.some(prefix => name.startsWith(prefix))) return true
  for (const prefix of prefixes) {
    if (name.startsWith(prefix)) return true
  }
  return false
}

function isSelectorLive(selector) {
  let live = true
  selectorParser(root => {
    root.walkClasses(node => {
      if (!isClassUsed(node.value)) live = false
    })
  }).processSync(selector)
  return live
}

let totalRemovedRules = 0
let totalRemovedSelectors = 0
for (const file of cssFiles) {
  const css = await readFile(file, 'utf8')
  const root = postcss.parse(css, { from: file })
  let removedRules = 0
  let removedSelectors = 0

  root.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return
    const selectors = rule.selectors
    const live = selectors.filter(isSelectorLive)
    if (live.length === 0) {
      rule.remove()
      removedRules += 1
      removedSelectors += selectors.length
    } else if (live.length < selectors.length) {
      removedSelectors += selectors.length - live.length
      rule.selectors = live
    }
  })

  const cssText = root.toString()
  const animationNames = new Set()
  root.walkDecls(/^animation(-name)?$/, decl => {
    for (const word of decl.value.split(/[\s,]+/)) animationNames.add(word)
  })
  root.walkAtRules(/keyframes$/i, atRule => {
    if (!animationNames.has(atRule.params) && !source.includes(atRule.params)) {
      atRule.remove()
      removedRules += 1
    }
  })

  let removedEmpty = true
  while (removedEmpty) {
    removedEmpty = false
    root.walkAtRules(atRule => {
      if (atRule.nodes && atRule.nodes.length === 0) {
        atRule.remove()
        removedEmpty = true
      }
    })
  }

  const before = css.split('\n').length
  const output = root.toString().replace(/\n{3,}/g, '\n\n')
  const after = output.split('\n').length
  console.log(`${file}: removed ${removedRules} rules / ${removedSelectors} selectors, ${before} -> ${after} lines`)
  void cssText
  totalRemovedRules += removedRules
  totalRemovedSelectors += removedSelectors
  if (write) await writeFile(file, output)
}
console.log(`total: ${totalRemovedRules} rules, ${totalRemovedSelectors} selectors${write ? ' (written)' : ' (dry run)'}`)
