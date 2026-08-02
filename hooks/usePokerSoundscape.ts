'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { TableState } from '@/lib/poker/types'
import {
  DEFAULT_POKER_SOUND_PREFERENCES,
  advancePokerSoundEventCursor,
  createPokerSoundEventCursor,
  normalizePokerSoundPreferences,
  type PokerSoundCueKind,
  type PokerSoundEventCursor,
} from '@/lib/poker/soundscape'

export interface UsePokerSoundscapeOptions {
  enabled?: boolean
  connected?: boolean
  muted?: boolean
  volume?: number
}

export interface PokerSoundscapeController {
  /** Play a visual-timeline cue immediately; blocked/locked audio is not queued. */
  playCue: (kind: PokerSoundCueKind) => void
}

interface SoundscapeOutputState {
  enabled: boolean
  muted: boolean
  volume: number
}

type SafariWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext
}

/**
 * Plays shared, procedural table audio for either rendering mode. The hook has
 * no UI and never creates an AudioContext until a real user gesture unlocks it.
 */
export function usePokerSoundscape(
  state: TableState | undefined,
  yourId: string,
  options: UsePokerSoundscapeOptions = {}
): PokerSoundscapeController {
  const normalizedPreferences = normalizePokerSoundPreferences({
    muted: options.muted ?? DEFAULT_POKER_SOUND_PREFERENCES.muted,
    volume: options.volume ?? DEFAULT_POKER_SOUND_PREFERENCES.volume,
  })
  const outputRef = useRef<SoundscapeOutputState>({
    enabled: (options.enabled ?? true) && (options.connected ?? true),
    ...normalizedPreferences,
  })
  outputRef.current = {
    enabled: (options.enabled ?? true) && (options.connected ?? true),
    ...normalizedPreferences,
  }

  const engineRef = useRef<ProceduralPokerAudio | null>(null)
  const cursorRef = useRef<PokerSoundEventCursor>(createPokerSoundEventCursor())
  const timersRef = useRef<Set<number>>(new Set())
  const reconnectGateRef = useRef<{
    awaitingFreshState: boolean
    staleState: TableState | undefined
  }>({
    awaitingFreshState: false,
    staleState: undefined,
  })

  useEffect(() => {
    const engine = new ProceduralPokerAudio()
    engineRef.current = engine
    engine.configure(outputRef.current)

    let listeningForUnlock = true
    const stopListeningForUnlock = () => {
      if (!listeningForUnlock) return
      listeningForUnlock = false
      window.removeEventListener('pointerdown', unlock, true)
      window.removeEventListener('keydown', unlock, true)
      window.removeEventListener('touchstart', unlock, true)
    }
    const unlock = () => {
      void engine.unlock().then(unlocked => {
        if (unlocked) stopListeningForUnlock()
      })
    }
    const handleVisibilityChange = () => {
      engine.setVisible(document.visibilityState !== 'hidden')
    }

    window.addEventListener('pointerdown', unlock, true)
    window.addEventListener('keydown', unlock, true)
    window.addEventListener('touchstart', unlock, true)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    handleVisibilityChange()

    return () => {
      stopListeningForUnlock()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      for (const timer of timersRef.current) window.clearTimeout(timer)
      timersRef.current.clear()
      engine.destroy()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    engineRef.current?.configure(outputRef.current)
  }, [options.connected, options.enabled, normalizedPreferences.muted, normalizedPreferences.volume])

  useEffect(() => {
    const connected = options.connected ?? true

    if (!connected) {
      reconnectGateRef.current = {
        awaitingFreshState: true,
        staleState: state,
      }
      for (const timer of timersRef.current) window.clearTimeout(timer)
      timersRef.current.clear()
      return
    }

    const reconnectGate = reconnectGateRef.current
    if (reconnectGate.awaitingFreshState) {
      if (!state || state === reconnectGate.staleState) {
        return
      }

      cursorRef.current = advancePokerSoundEventCursor(
        createPokerSoundEventCursor(),
        state,
        yourId
      ).cursor
      reconnectGateRef.current = {
        awaitingFreshState: false,
        staleState: undefined,
      }
      return
    }

    const frame = advancePokerSoundEventCursor(cursorRef.current, state, yourId)
    cursorRef.current = frame.cursor

    if (frame.events.length === 0) {
      return
    }

    const output = outputRef.current
    if (!output.enabled || output.muted || output.volume <= 0) {
      return
    }

    for (const event of frame.events) {
      const timer = window.setTimeout(() => {
        timersRef.current.delete(timer)
        const latestOutput = outputRef.current
        if (!latestOutput.enabled || latestOutput.muted || latestOutput.volume <= 0) {
          return
        }
        engineRef.current?.play(event.kind)
      }, event.delayMs)
      timersRef.current.add(timer)
    }
  }, [options.connected, state, yourId])

  const playCue = useCallback((kind: PokerSoundCueKind) => {
    const output = outputRef.current
    if (
      reconnectGateRef.current.awaitingFreshState ||
      !output.enabled ||
      output.muted ||
      output.volume <= 0
    ) {
      return
    }
    engineRef.current?.play(kind)
  }, [])

  return { playCue }
}

class ProceduralPokerAudio {
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private ambienceSource: AudioBufferSourceNode | null = null
  private ambienceGain: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private unlocked = false
  private visible = true
  private output: SoundscapeOutputState = {
    enabled: true,
    ...DEFAULT_POKER_SOUND_PREFERENCES,
  }

  configure(output: SoundscapeOutputState): void {
    this.output = {
      enabled: output.enabled,
      ...normalizePokerSoundPreferences(output),
    }
    this.applyMasterGain()
    this.syncAmbience()
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.syncAmbience()
  }

  async unlock(): Promise<boolean> {
    const context = this.ensureContext()
    if (!context) return false

    try {
      if (context.state === 'suspended') {
        await context.resume()
      }
      this.unlocked = context.state === 'running'
      this.applyMasterGain()
      this.syncAmbience()
      return this.unlocked
    } catch {
      return false
    }
  }

  play(kind: PokerSoundCueKind): void {
    const context = this.context
    if (
      !context ||
      !this.masterGain ||
      !this.unlocked ||
      context.state !== 'running' ||
      !this.isAudible()
    ) {
      return
    }

    const now = context.currentTime + 0.008
    switch (kind) {
      case 'hand_start':
        for (let index = 0; index < 7; index += 1) {
          this.cardSlide(now + index * 0.035, 0.022 + index * 0.002)
        }
        this.cardSlide(now + 0.31, 0.055)
        this.cardSlide(now + 0.42, 0.05)
        break
      case 'board_flop':
        this.cardSlide(now, 0.06)
        this.cardSlide(now + 0.075, 0.058)
        this.cardSlide(now + 0.15, 0.056)
        break
      case 'board_turn':
      case 'board_river':
      case 'fold':
        this.cardSlide(now, kind === 'fold' ? 0.052 : 0.065)
        break
      case 'check':
        this.tableTap(now)
        break
      case 'call':
        this.chipCluster(now, 3, 0.045)
        break
      case 'bet':
      case 'raise':
        this.chipCluster(now, kind === 'raise' ? 5 : 4, 0.055)
        break
      case 'all_in':
        this.chipCluster(now, 9, 0.075)
        this.tone(now + 0.06, 128, 72, 0.22, 0.042, 'triangle')
        break
      case 'your_turn':
        this.tone(now, 660, 760, 0.13, 0.035, 'sine')
        this.tone(now + 0.12, 880, 980, 0.17, 0.032, 'sine')
        break
      case 'fold_win':
        this.chipCluster(now, 7, 0.065)
        this.tone(now + 0.08, 440, 554, 0.18, 0.035, 'sine')
        this.tone(now + 0.21, 554, 740, 0.24, 0.038, 'sine')
        break
      case 'showdown_card':
        this.cardSlide(now, 0.07)
        this.tone(now + 0.025, 310, 390, 0.09, 0.018, 'sine')
        break
      case 'showdown_winner':
        this.tone(now, 392, 523, 0.19, 0.04, 'sine')
        this.tone(now + 0.13, 523, 784, 0.28, 0.045, 'sine')
        this.tone(now + 0.29, 784, 1046, 0.34, 0.035, 'sine')
        break
      case 'pot_payout':
        this.chipCluster(now, 11, 0.072)
        break
    }
  }

  destroy(): void {
    this.stopAmbience()
    const context = this.context
    this.context = null
    this.masterGain = null
    this.noiseBuffer = null
    this.unlocked = false
    if (context && context.state !== 'closed') {
      void context.close().catch(() => {})
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context
    if (typeof window === 'undefined') return null

    const AudioContextConstructor = window.AudioContext ??
      (window as SafariWindow).webkitAudioContext
    if (!AudioContextConstructor) return null

    try {
      const context = new AudioContextConstructor()
      const masterGain = context.createGain()
      masterGain.gain.value = 0
      masterGain.connect(context.destination)
      this.context = context
      this.masterGain = masterGain
      this.noiseBuffer = this.createNoiseBuffer(context)
      return context
    } catch {
      return null
    }
  }

  private isAudible(): boolean {
    return this.output.enabled && !this.output.muted && this.output.volume > 0 && this.visible
  }

  private applyMasterGain(): void {
    if (!this.context || !this.masterGain) return
    const target = this.isAudible() ? this.output.volume : 0
    this.masterGain.gain.cancelScheduledValues(this.context.currentTime)
    this.masterGain.gain.setTargetAtTime(target, this.context.currentTime, 0.025)
  }

  private syncAmbience(): void {
    this.applyMasterGain()
    if (!this.context || !this.masterGain || !this.unlocked || !this.isAudible()) {
      this.stopAmbience()
      return
    }
    if (this.ambienceSource) return

    const source = this.context.createBufferSource()
    source.buffer = this.noiseBuffer ?? this.createNoiseBuffer(this.context)
    source.loop = true

    const lowPass = this.context.createBiquadFilter()
    lowPass.type = 'lowpass'
    lowPass.frequency.value = 1300
    lowPass.Q.value = 0.35

    const highPass = this.context.createBiquadFilter()
    highPass.type = 'highpass'
    highPass.frequency.value = 90
    highPass.Q.value = 0.25

    const gain = this.context.createGain()
    gain.gain.value = 0.018
    source.connect(lowPass)
    lowPass.connect(highPass)
    highPass.connect(gain)
    gain.connect(this.masterGain)
    source.start()
    this.ambienceSource = source
    this.ambienceGain = gain
  }

  private stopAmbience(): void {
    if (!this.ambienceSource) return
    try {
      this.ambienceSource.stop()
    } catch {
      // The source may already have ended during browser teardown.
    }
    this.ambienceSource.disconnect()
    this.ambienceGain?.disconnect()
    this.ambienceSource = null
    this.ambienceGain = null
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const length = Math.max(1, Math.floor(context.sampleRate * 2))
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)
    let seed = 0x51f15e
    let smoothed = 0

    for (let index = 0; index < data.length; index += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const white = (seed / 0xffffffff) * 2 - 1
      smoothed = smoothed * 0.965 + white * 0.035
      data[index] = smoothed * 0.42
    }

    return buffer
  }

  private cardSlide(start: number, level: number): void {
    if (!this.context || !this.masterGain || !this.noiseBuffer) return
    const source = this.context.createBufferSource()
    source.buffer = this.noiseBuffer
    const filter = this.context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(1500, start)
    filter.frequency.exponentialRampToValueAtTime(620, start + 0.17)
    filter.Q.value = 0.72
    const gain = this.context.createGain()
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(level, start + 0.018)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(this.masterGain)
    source.start(start, 0, 0.19)
    source.stop(start + 0.2)
    source.onended = () => {
      source.disconnect()
      filter.disconnect()
      gain.disconnect()
    }
  }

  private tableTap(start: number): void {
    this.tone(start, 185, 92, 0.085, 0.055, 'triangle')
    this.tone(start + 0.075, 160, 78, 0.075, 0.045, 'triangle')
  }

  private chipCluster(start: number, count: number, level: number): void {
    for (let index = 0; index < count; index += 1) {
      const pitch = 760 + ((index * 173) % 690)
      this.tone(
        start + index * 0.032,
        pitch,
        pitch * 0.68,
        0.065,
        level * (0.82 + (index % 3) * 0.09),
        index % 2 === 0 ? 'triangle' : 'sine'
      )
    }
  }

  private tone(
    start: number,
    fromFrequency: number,
    toFrequency: number,
    duration: number,
    level: number,
    type: OscillatorType
  ): void {
    if (!this.context || !this.masterGain) return
    const oscillator = this.context.createOscillator()
    const gain = this.context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(Math.max(1, fromFrequency), start)
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(1, toFrequency),
      start + duration
    )
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), start + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    oscillator.connect(gain)
    gain.connect(this.masterGain)
    oscillator.start(start)
    oscillator.stop(start + duration + 0.01)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
    }
  }
}
