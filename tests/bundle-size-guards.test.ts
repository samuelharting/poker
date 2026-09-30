import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AVATAR_CLIP_NAMES } from '@/components/three/avatarAssetLoader'

const root = process.cwd()

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap(name => {
    const path = join(dir, name)
    if (statSync(join(root, path)).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('bundle size guards', () => {
  it('only ever loads emoji-picker-react through a dynamic import', () => {
    // A value import (even of its Theme / EmojiStyle enums) puts the ~300 kB
    // picker back into the room's first-load JS.
    for (const file of [...sourceFiles('app'), ...sourceFiles('components'), ...sourceFiles('hooks'), ...sourceFiles('lib')]) {
      const source = readFileSync(join(root, file), 'utf8')
      // [^'] keeps a match inside one import statement (no semicolons in this codebase).
      const staticImports = source.match(/^import\s+(?!type\s)[^']*from\s+'emoji-picker-react'/gm) ?? []
      expect(staticImports, file).toEqual([])
    }
  })

  it('keeps three.js out of the landing page and the room page entry', () => {
    for (const file of ['app/page.tsx', 'app/room/[code]/page.tsx', 'components/table/PokerTable.tsx']) {
      const source = readFileSync(join(root, file), 'utf8')
      expect(source, file).not.toMatch(/^import\s+(?!type\s)[^']*from\s+'three(\/[^']*)?'/m)
      expect(source, file).not.toMatch(/^import\s+(?!type\s)[^']*from\s+'@\/components\/three\/DesktopPokerRoom3D'/m)
    }
  })

  it('serves avatar GLBs slimmed to the clips the loader uses', () => {
    const kept = Object.values(AVATAR_CLIP_NAMES).sort()
    const dir = join(root, 'public', 'models', 'avatars')
    const files = readdirSync(dir).filter(name => name.endsWith('.glb'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const buffer = readFileSync(join(dir, file))
      const jsonLength = buffer.readUInt32LE(12)
      const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')) as { animations?: Array<{ name: string }> }
      const clips = (json.animations ?? []).map(clip => clip.name).sort()
      expect(clips, `${file}: run npm run assets:avatars`).toEqual(kept)
    }
  })
})
