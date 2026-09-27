import { useEffect, useState } from 'react'

/**
 * The simple 2D table (no drinks, tiny Lady Luck) is used for every narrow
 * screen and for every touch-first device, so an iPad in landscape (>= 1024px)
 * still gets the 2D layout instead of the 3D room. Keep in sync with the
 * matching media queries in app/styles/table-2d.css.
 */
export const TWO_D_LAYOUT_QUERY = '(max-width: 1023px), (hover: none) and (pointer: coarse)'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }

    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const mediaQuery = window.matchMedia(query)
    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches)
    }

    setMatches(mediaQuery.matches)

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }

    mediaQuery.addListener(handleChange)
    return () => mediaQuery.removeListener(handleChange)
  }, [query])

  return matches
}

/** True when the room should render the simple 2D layout. */
export function useIsTwoDLayout(): boolean {
  return useMediaQuery(TWO_D_LAYOUT_QUERY)
}
