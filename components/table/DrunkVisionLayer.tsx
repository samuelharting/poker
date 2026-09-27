'use client'

import { useEffect, useRef, useState } from 'react'
import { useDrinks } from './DrinkContext'

const SIP_DURATION_MS = 1400

function setRootVar(root: HTMLElement, name: string, value: string | null) {
  if (value === null) {
    root.style.removeProperty(name)
  } else {
    root.style.setProperty(name, value)
  }
}

/**
 * The drinker's own view: pulsing blur and double vision, sway, and a warm
 * wash when they drink. Effects are driven by CSS (app/styles/drinks.css)
 * through attributes on <html>, so no table component has to know about
 * drinks, and prefers-reduced-motion swaps every motion for a gentle static
 * blur/tint. No text, ever: drinking shows up as pictures only. Blackouts,
 * hangovers, the sober look and the pill trip live in FunLayer.
 */
export function DrunkVisionLayer() {
  const drinks = useDrinks()
  const profile = drinks?.profile
  const myDrinks = drinks?.myDrinks
  const [sip, setSip] = useState<{ id: string; kind: 'beer' | 'water' } | null>(null)
  const lastSeenDrinkIdRef = useRef<string | null | undefined>(undefined)

  const tier = profile?.tier ?? 'sober'

  // Publish the effect profile as root attributes / CSS variables.
  useEffect(() => {
    const root = document.documentElement
    // A blackout has its own quick first-person beat (FunLayer): no drunk blur on top.
    if (!profile || tier === 'sober' || tier === 'out') {
      delete root.dataset.drunkTier
      delete root.dataset.drunkWobble
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
  }, [])

  // A warm wash when *you* drink (not on first render / reconnect).
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

  if (!drinks) {
    return null
  }

  return (
    <div className="drunk-vision" data-tier={tier} aria-hidden="true">
      {tier !== 'sober' && tier !== 'out' && <div className="drunk-vignette" />}
      {sip && (
        // The glass itself is drawn in 3D (firstPersonDrink.ts); this is just a warm wash.
        <div key={sip.id} className={`drunk-sip is-${sip.kind}`} aria-hidden="true" />
      )}
    </div>
  )
}
