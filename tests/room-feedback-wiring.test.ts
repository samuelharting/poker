import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('room feedback wiring', () => {
  it('routes server and table feedback into visible system toasts', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'room', '[code]', 'page.tsx'), 'utf8')

    expect(source).toContain("import { SystemToasts")
    expect(source).toContain('const pushSystemMessage = useCallback(')
    expect(source).toContain('onSystemMessage: pushSystemMessage')
    expect(source).toContain('onFeedback={pushSystemMessage}')
    expect(source).toContain('<SystemToasts')
  })
})
