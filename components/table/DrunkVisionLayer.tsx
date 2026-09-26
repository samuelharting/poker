'use client'

import { useEffect, useRef, useState } from 'react'
import { useDrinks } from './DrinkContext'

const HICCUP_DURATION_MS = 560
const SIP_DURATION_MS = 1400
const WAKE_DURATION_MS = 2200

function setRootVar(root: HTMLElement, name: string, value: string | null) {
  if (value === null) {
    root.style.removeProperty(name)
  } else {
    root.style.setProperty(name, value)
  }
}

/**
 * The drinker's own view: pulsing blur and double vision, sway, hiccups,
 * a sip flourish when they drink, and the pass-out / wake-up screens.
 * Effects are driven by CSS (app/styles/drinks.css) through attributes on
 * <html>, so no table component has to know about drinks, and
 * prefers-reduced-motion swaps every motion for a gentle static blur/tint.
 */
export function DrunkVisionLayer() {
  const drinks = useDrinks()
  const profile = drinks?.profile
  const myDrinks = drinks?.myDrinks
  const [hiccupKey, setHiccupKey] = useState(0)
  const [sip, setSip] = useState<{ id: string; kind: 'beer' | 'water' } | null>(null)
  const [wakeKey, setWakeKey] = useState(0)
  const lastSeenDrinkIdRef = useRef<string | null | undefined>(undefined)
  const wasPassedOutRef = useRef<boolean | undefined>(undefined)

  const tier = profile?.tier ?? 'sober'

  // Publish the effect profile as root attributes / CSS variables.
  useEffect(() => {
    const root = document.documentElement
    if (!profile || tier === 'sober') {
      delete root.dataset.drunkTier
      for (const name of ['--drunk-blur', '--drunk-ghost', '--drunk-sway-deg', '--drunk-sway-px', '--drunk-pulse', '--drunk-tint']) {
        setRootVar(root, name, null)
      }
      return
    }

    root.dataset.drunkTier = tier
    setRootVar(root, '--drunk-blur', `${profile.blurPx}px`)
    setRootVar(root, '--drunk-ghost', `${profile.ghostPx}px`)
    setRootVar(root, '--drunk-sway-deg', `${profile.swayDeg}deg`)
    setRootVar(root, '--drunk-sway-px', `${profile.swayPx}px`)
    setRootVar(root, '--drunk-pulse', `${profile.pulseSeconds}s`)
    setRootVar(root, '--drunk-tint', String(profile.tint))
    if (profile.wobblyButtons) {
      root.dataset.drunkWobble = 'true'
    } else {
      delete root.dataset.drunkWobble
    }
  }, [profile, tier])

  useEffect(() => () => {
    const root = document.documentElement
    delete root.dataset.drunkTier
    delete root.dataset.drunkWobble
    delete root.dataset.drunkHiccup
  }, [])

  // Hiccups: random, more frequent the drunker you are.
  const hiccupsEnabled = Boolean(profile?.hiccups)
  const level = profile?.level ?? 0
  useEffect(() => {
    if (!hiccupsEnabled) {
      return
    }

    let timer: number
    let clearTimer: number | undefined
    const schedule = () => {
      const base = Math.max(3800, 13000 - level * 900)
      timer = window.setTimeout(() => {
        setHiccupKey(key => key + 1)
        document.documentElement.dataset.drunkHiccup = 'true'
        clearTimer = window.setTimeout(() => {
          delete document.documentElement.dataset.drunkHiccup
        }, HICCUP_DURATION_MS)
        schedule()
      }, base + Math.random() * base * 0.8)
    }
    schedule()

    return () => {
      window.clearTimeout(timer)
      if (clearTimer !== undefined) window.clearTimeout(clearTimer)
      delete document.documentElement.dataset.drunkHiccup
    }
  }, [hiccupsEnabled, level])

  // Sip flourish when *you* drink (not on first render / reconnect).
  const lastDrink = myDrinks?.lastDrink ?? null
  useEffect(() => {
    const id = lastDrink?.id ?? null
    if (lastSeenDrinkIdRef.current === undefined) {
      lastSeenDrinkIdRef.current = id
      return
    }
    if (!lastDrink || id === lastSeenDrinkIdRef.current) {
      return
    }

    lastSeenDrinkIdRef.current = id
    setSip({ id: lastDrink.id, kind: lastDrink.kind })
    const timer = window.setTimeout(() => setSip(null), SIP_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [lastDrink])

  // Eyes-opening transition when you come to.
  const passedOut = Boolean(myDrinks?.passedOut)
  useEffect(() => {
    const wasPassedOut = wasPassedOutRef.current
    wasPassedOutRef.current = passedOut
    if (wasPassedOut && !passedOut) {
      setWakeKey(Date.now())
    }
  }, [passedOut])

  useEffect(() => {
    if (!wakeKey) {
      return
    }
    const timer = window.setTimeout(() => setWakeKey(0), WAKE_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [wakeKey])

  if (!drinks) {
    return null
  }

  return (
    <div className="drunk-vision" data-tier={tier} aria-hidden={!passedOut}>
      {tier !== 'sober' && tier !== 'out' && <div className="drunk-vignette" />}

      {hiccupKey > 0 && hiccupsEnabled && (
        <span key={hiccupKey} className="drunk-hiccup">hic!</span>
      )}

      {sip && (
        <div key={sip.id} className={`drunk-sip is-${sip.kind}`}>
          <span className="drunk-sip-glass">{sip.kind === 'beer' ? '🍺' : '🥛'}</span>
          <span className="drunk-sip-copy">{sip.kind === 'beer' ? 'glug glug' : 'hydrating…'}</span>
        </div>
      )}

      {passedOut && (
        <div className="drunk-passout" role="status" aria-live="assertive">
          <span className="drunk-eyelid is-top" />
          <span className="drunk-eyelid is-bottom" />
          <div className="drunk-passout-card">
            <span className="drunk-passout-z" aria-hidden="true">
              <i>z</i><i>z</i><i>Z</i>
            </span>
            <strong>You passed out</strong>
            <p>Your cards get folded while you sleep it off. You&apos;ll come to at the start of a new hand.</p>
          </div>
        </div>
      )}

      {wakeKey > 0 && !passedOut && (
        <div key={wakeKey} className="drunk-wake">
          <span className="drunk-eyelid is-top" />
          <span className="drunk-eyelid is-bottom" />
        </div>
      )}
    </div>
  )
}
