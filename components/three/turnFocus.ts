export type Vec3 = [number, number, number]

export interface TurnCameraPose {
  position: Vec3
  lookAt: Vec3
}

export interface AvatarHeadTurn {
  yaw: number
  pitch: number
}

const defaultCameraPose: TurnCameraPose = {
  position: [0, 3.58, 5.72],
  lookAt: [0, 1.12, 0.08],
}

const seatHorizontalPan: Record<number, number> = {
  0: 0,
  1: -0.72,
  2: -1.12,
  3: -0.86,
  4: 0,
  5: 0.86,
  6: 1.12,
  7: 0.72,
}

const seatDepthFocus: Record<number, { cameraX: number; cameraY: number; cameraZ: number; lookAtY: number; lookAtZ: number }> = {
  1: { cameraX: -0.14, cameraY: 3.5, cameraZ: 5.62, lookAtY: 1.18, lookAtZ: 0.02 },
  2: { cameraX: -0.3, cameraY: 3.44, cameraZ: 5.42, lookAtY: 1.22, lookAtZ: -0.06 },
  3: { cameraX: -0.2, cameraY: 3.36, cameraZ: 5.34, lookAtY: 1.26, lookAtZ: -0.2 },
  4: { cameraX: 0, cameraY: 3.34, cameraZ: 5.32, lookAtY: 1.28, lookAtZ: -0.3 },
  5: { cameraX: 0.2, cameraY: 3.36, cameraZ: 5.34, lookAtY: 1.26, lookAtZ: -0.2 },
  6: { cameraX: 0.3, cameraY: 3.44, cameraZ: 5.42, lookAtY: 1.22, lookAtZ: -0.06 },
  7: { cameraX: 0.14, cameraY: 3.5, cameraZ: 5.62, lookAtY: 1.18, lookAtZ: 0.02 },
}

export function getTurnCameraPose(actingVisualSeat: number | null): TurnCameraPose {
  if (actingVisualSeat === null) {
    return {
      position: [...defaultCameraPose.position],
      lookAt: [...defaultCameraPose.lookAt],
    }
  }

  if (actingVisualSeat === 0) {
    return {
      position: [...defaultCameraPose.position],
      lookAt: [...defaultCameraPose.lookAt],
    }
  }

  const horizontalPan = seatHorizontalPan[actingVisualSeat]
  const depthFocus = seatDepthFocus[actingVisualSeat]

  if (horizontalPan === undefined || depthFocus === undefined) {
    return {
      position: [...defaultCameraPose.position],
      lookAt: [...defaultCameraPose.lookAt],
    }
  }

  return {
    position: [depthFocus.cameraX, depthFocus.cameraY, depthFocus.cameraZ],
    lookAt: [horizontalPan, depthFocus.lookAtY, depthFocus.lookAtZ],
  }
}

export function getAvatarHeadTurn(sourceVisualSeat: number, actingVisualSeat: number | null): AvatarHeadTurn {
  if (actingVisualSeat === null || sourceVisualSeat === actingVisualSeat) {
    return { yaw: 0, pitch: -0.035 }
  }

  const clockwiseSteps = (actingVisualSeat - sourceVisualSeat + 8) % 8
  const shortestSteps = clockwiseSteps > 4 ? clockwiseSteps - 8 : clockwiseSteps
  const yaw = Math.max(-0.52, Math.min(0.52, shortestSteps * 0.17))
  const pitch = -0.04 + Math.min(0.07, Math.abs(shortestSteps) * 0.016)

  return { yaw, pitch }
}
