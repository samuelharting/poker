'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { activateThreeFallback } from './threeFallback'

interface ThreeErrorBoundaryProps {
  children: ReactNode
  /** Called once when the 3D view throws (defaults to switching the tab to the 2D table). */
  onError?: (error: unknown) => void
}

interface ThreeErrorBoundaryState {
  failed: boolean
}

/**
 * Catches anything the desktop 3D room throws while rendering (including a
 * failed lazy chunk load) so one bad frame of React never blanks the whole
 * table: the room switches to the 2D table instead.
 */
export class ThreeErrorBoundary extends Component<ThreeErrorBoundaryProps, ThreeErrorBoundaryState> {
  state: ThreeErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ThreeErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('The 3D table crashed; switching to the 2D table.', error, info.componentStack)
    if (this.props.onError) this.props.onError(error)
    else activateThreeFallback('render-error', error)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
