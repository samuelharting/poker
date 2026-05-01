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
  position: [0, 2.45, 5.62],
  lookAt: [0, 1.06, 0.18],
}

const seatHorizontalPan: Record<number, number> = {
  0: 0,
  1: -0.24,
  2: -0.38,
  3: -0.3,
  4: 0,
  5: 0.3,
  6: 0.38,
  7: 0.24,
}

const seatDepthFocus: Record<number, { cameraX: number; cameraY: number; cameraZ: number; lookAtY: number; lookAtZ: number }> = {
  1: { cameraX: -0.04, cameraY: 2.46, cameraZ: 5.66, lookAtY: 1.07, lookAtZ: 0.16 },
  2: { cameraX: -0.09, cameraY: 2.45, cameraZ: 5.6, lookAtY: 1.08, lookAtZ: 0.12 },
  3: { cameraX: -0.07, cameraY: 2.43, cameraZ: 5.56, lookAtY: 1.09, lookAtZ: 0.06 },
  4: { cameraX: 0, cameraY: 2.42, cameraZ: 5.54, lookAtY: 1.1, lookAtZ: 0.02 },
  5: { cameraX: 0.07, cameraY: 2.43, cameraZ: 5.56, lookAtY: 1.09, lookAtZ: 0.06 },
  6: { cameraX: 0.09, cameraY: 2.45, cameraZ: 5.6, lookAtY: 1.08, lookAtZ: 0.12 },
  7: { cameraX: 0.04, cameraY: 2.46, cameraZ: 5.66, lookAtY: 1.07, lookAtZ: 0.16 },
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
