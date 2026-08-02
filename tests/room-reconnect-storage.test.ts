import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  clearStoredReconnectToken,
  loadStoredReconnectToken,
  storeReconnectToken,
} from '@/hooks/useRoom'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function stubBrowserStorage() {
  const localStorage = new MemoryStorage()
  const sessionStorage = new MemoryStorage()
  vi.stubGlobal('window', { localStorage, sessionStorage })
  return { localStorage, sessionStorage }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mobile room reconnect storage', () => {
  it('persists reconnect identity beyond the current browser tab', () => {
    const { localStorage, sessionStorage } = stubBrowserStorage()

    storeReconnectToken('ABC123', 'stable-token')
    sessionStorage.clear()

    expect(localStorage.getItem('poker_reconnect_ABC123')).toBe('stable-token')
    expect(loadStoredReconnectToken('ABC123')).toBe('stable-token')
  })

  it('migrates an existing session token into persistent storage', () => {
    const { localStorage, sessionStorage } = stubBrowserStorage()
    sessionStorage.setItem('poker_reconnect_ABC123', 'legacy-token')

    expect(loadStoredReconnectToken('ABC123')).toBe('legacy-token')
    expect(localStorage.getItem('poker_reconnect_ABC123')).toBe('legacy-token')
  })

  it('clears both copies only when the player explicitly leaves', () => {
    const { localStorage, sessionStorage } = stubBrowserStorage()
    storeReconnectToken('ABC123', 'stable-token')

    clearStoredReconnectToken('ABC123')

    expect(localStorage.getItem('poker_reconnect_ABC123')).toBeNull()
    expect(sessionStorage.getItem('poker_reconnect_ABC123')).toBeNull()
  })

  it('refreshes a suspended room connection when the app becomes active again', () => {
    const source = readFileSync(join(process.cwd(), 'hooks', 'useRoom.ts'), 'utf8')

    expect(source).toContain("document.addEventListener('visibilitychange', handleVisibilityChange)")
    expect(source).toContain("window.addEventListener('focus', markActive)")
    expect(source).toContain("window.addEventListener('online', handleOnline)")
    expect(source).toContain('socket.reconnect()')
    expect(source).toContain('inactiveDuration >= BACKGROUND_RECONNECT_THRESHOLD_MS')
  })
})
