import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('room feedback wiring', () => {
  it('keeps server and table feedback from rendering popup notifications', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'room', '[code]', 'page.tsx'), 'utf8')
    const roomHookSource = readFileSync(join(process.cwd(), 'hooks', 'useRoom.ts'), 'utf8')

    expect(source).not.toContain('SystemToasts')
    expect(source).not.toContain('pushSystemMessage')
    expect(source).toContain('onFeedback={ignoreFeedback}')
    expect(source).not.toContain('room-connection-banner')
    expect(roomHookSource).not.toContain('onSystemMessage')
  })

  it('persists and publishes explicitly saved avatar changes', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'room', '[code]', 'page.tsx'), 'utf8')

    expect(source).toContain('const [currentProfile, setCurrentProfile]')
    expect(source).toContain('const handleUpdateAvatar = useCallback(')
    expect(source).toContain('saveStoredPlayerProfile({')
    expect(source).toContain("sendMessage({ type: 'update_avatar', avatar: normalizedAvatar })")
    expect(source).not.toContain("pushSystemMessage('Avatar saved and updated at the table.', 'success')")
    expect(source).toContain('avatarCustomization={currentProfile.avatar ?? DEFAULT_PLAYER_AVATAR_CUSTOMIZATION}')
    expect(source).toContain('onUpdateAvatar={handleUpdateAvatar}')
  })
})
