export const ROOM_CODE_LENGTH = 6
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const SAFE_ROOM_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/
const LEGACY_NUMERIC_ROOM_CODE_RE = /^[0-9]{1,20}$/

type RandomByteSource = (length: number) => Uint8Array

function browserRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes)
    return bytes
  }

  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256)
  }
  return bytes
}

export function createRoomCode(randomBytes: RandomByteSource = browserRandomBytes): string {
  const bytes = randomBytes(ROOM_CODE_LENGTH)
  let code = ''

  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    const byte = bytes[index] ?? 0
    code += ROOM_CODE_ALPHABET[byte & 31]
  }

  return code
}

export function normalizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '').trim()
}

export function formatRoomCodeInput(raw: string): string {
  return normalizeRoomCode(raw).replace(/[^A-Z0-9]/g, '').slice(0, 20)
}

export function isValidRoomCode(raw: string): boolean {
  const code = normalizeRoomCode(raw)
  return SAFE_ROOM_CODE_RE.test(code) || LEGACY_NUMERIC_ROOM_CODE_RE.test(code)
}
