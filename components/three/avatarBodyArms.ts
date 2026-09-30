import * as THREE from 'three'
import { getFlipOffHand, type AvatarAnchors, type AvatarPose } from './avatarAnimator'
import { getHandRig, neutralizeHand } from './avatarHands'
import { ARM_MAX_EXTENSION, solveArmIK, updateWorldOf, type ArmChain } from './avatarIK'

/**
 * Arm and hand placement for the seated avatars.
 *
 * The animator decides where each wrist should be (seat space) and how the
 * hand should be held; this module turns that into bone rotations:
 *  - the chest leans in for far reaches and the collarbone (Shoulder) lifts and
 *    reaches toward the hand, so the arm never has to fully straighten;
 *  - two-bone IK reaches the wrist with an elbow that swivels toward a pole
 *    that follows the hand (elbows out and down, hanging when the hand is up
 *    at the face, raised when the hands go behind the head);
 *  - the elbow is kept out of the torso, the table rail and the chair;
 *  - the hand is oriented from a gesture frame (yaw / pitch / roll relative to
 *    palm-down) blended over a natural relaxed frame, with wrist bend limited;
 *  - the roll between forearm and hand is shared with the LowerArm bone so the
 *    wrist never candy-wraps.
 *
 * Runs per seat per frame, so everything reads matrixWorld (the room updates
 * the model just before) instead of walking parent chains, and nothing here
 * allocates.
 */

type Vec3 = [number, number, number]

export interface ArmSolveContext {
  /** The seat root (seat space: -Z faces the table). */
  root: THREE.Object3D
  bones: ReadonlyMap<string, THREE.Bone>
  anchors: AvatarAnchors
  model: THREE.Object3D
  /** False when the hole cards are not on the felt (folded, not dealt): no card clearance. */
  cardsVisible?: boolean
  /** Adds an Euler offset to a bone (the seat restores these each frame). */
  applyOffset: (bone: THREE.Bone | undefined, x: number, y: number, z: number) => void
}

interface SideRig {
  chain: ArmChain
  clavicle: THREE.Bone | undefined
  middle: THREE.Bone
  index: THREE.Bone
  pinky: THREE.Bone
  /** Knuckle bones in wrist space (measured once, fingers at bind pose): the hand frame comes from these, so no per-frame finger matrices. */
  localMiddle: THREE.Vector3
  localIndex: THREE.Vector3
  localPinky: THREE.Vector3
  measured: boolean
}

interface ArmRig {
  R: SideRig | null
  L: SideRig | null
  chest: THREE.Bone | undefined
  torso: THREE.Bone | undefined
  head: THREE.Bone | undefined
}

interface SideState {
  /** Smoothed elbow push (seat space) so clearance never pops. */
  push: THREE.Vector3
  lift: number
  liftVel: number
  reach: number
  reachVel: number
  /** Arm length (world units), measured once per root scale. */
  length: number
  lengthScale: number
  /** Forearm twist: the continuous (unwrapped) hand roll, and the smoothed share handed to LowerArm. */
  twistRaw: number
  twist: number
  twistVel: number
  /** Last frame's blended hand frame per blend stage (keeps the blend on one side of a half turn). */
  blendQ: THREE.Quaternion[]
  blendValid: boolean[]
  /** Last frame's final rotations of the arm bones and how fast each was turning (rad/s). */
  limitQ: THREE.Quaternion[]
  limitRate: number[]
  limitValid: boolean
  /** The raised-arm hand frame's weight, eased (it follows the hand height, which can cross its band quickly). */
  raiseW: number
  raiseV: number
}

interface ArmState {
  rig: ArmRig
  R: SideState
  L: SideState
}

const armStates = new WeakMap<object, ArmState>()

function createSideState(): SideState {
  return { push: new THREE.Vector3(), lift: 0, liftVel: 0, reach: 0, reachVel: 0, length: 0, lengthScale: 0, twistRaw: 0, twist: 0, twistVel: 0, blendQ: [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()], blendValid: [false, false, false, false], limitQ: [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()], limitRate: [0, 0, 0], limitValid: false, raiseW: 0, raiseV: 0 }
}

function buildSideRig(bones: ReadonlyMap<string, THREE.Bone>, side: 'R' | 'L'): SideRig | null {
  const upper = bones.get(`UpperArm${side}`)
  const lower = bones.get(`LowerArm${side}`)
  const hand = bones.get(`Wrist${side}`)
  const middle = bones.get(`Middle2${side}`)
  const index = bones.get(`Index2${side}`)
  const pinky = bones.get(`Pinky2${side}`)
  if (!upper || !lower || !hand || !middle || !index || !pinky) return null
  return { chain: { upper, lower, hand }, clavicle: bones.get(`Shoulder${side}`), middle, index, pinky, localMiddle: new THREE.Vector3(), localIndex: new THREE.Vector3(), localPinky: new THREE.Vector3(), measured: false }
}

function getArmState(bones: ReadonlyMap<string, THREE.Bone>): ArmState {
  let state = armStates.get(bones)
  if (!state) {
    state = {
      rig: {
        R: buildSideRig(bones, 'R'),
        L: buildSideRig(bones, 'L'),
        chest: bones.get('Chest'),
        torso: bones.get('Torso'),
        head: bones.get('Head'),
      },
      R: createSideState(),
      L: createSideState(),
    }
    armStates.set(bones, state)
  }
  return state
}

const ikTarget = new THREE.Vector3()
const ikPole = new THREE.Vector3()
const poleLocal = new THREE.Vector3()
const faceGuardCenter = new THREE.Vector3()
const faceGuardOffset = new THREE.Vector3()
const shoulderWorld = new THREE.Vector3()
const elbowWorld = new THREE.Vector3()
const wristWorld = new THREE.Vector3()
const forearm = new THREE.Vector3()
const restInward = new THREE.Vector3()
const restFingers = new THREE.Vector3()
const frameF = new THREE.Vector3()
const frameS = new THREE.Vector3()
const frameN = new THREE.Vector3()
const gestureF = new THREE.Vector3()
const gestureS = new THREE.Vector3()
const naturalF = new THREE.Vector3()
const naturalS = new THREE.Vector3()
const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const flipToward = new THREE.Vector3()
const elbowLocal = new THREE.Vector3()
const spineLocal = new THREE.Vector3()
const escape = new THREE.Vector3()
const pushGoal = new THREE.Vector3()
const rootInverse = new THREE.Matrix4()
const WORLD_UP = new THREE.Vector3(0, 1, 0)
const euler = new THREE.Euler(0, 0, 0, 'YXZ')
const quatA = new THREE.Quaternion()
const quatB = new THREE.Quaternion()
const quatC = new THREE.Quaternion()
const quatD = new THREE.Quaternion()
const twistAxis = new THREE.Vector3()
const basisM = new THREE.Matrix4()
const currentQ = new THREE.Quaternion()
const desiredQ = new THREE.Quaternion()
const deltaQ = new THREE.Quaternion()
const currentX = new THREE.Vector3()
const currentY = new THREE.Vector3()
const basisX = new THREE.Vector3()
const basisY = new THREE.Vector3()
const basisZ = new THREE.Vector3()
const decomposePosition = new THREE.Vector3()
const decomposeScale = new THREE.Vector3()
const scalarOut = { v: 0, vel: 0 }

/** Skull radius (seat units) the wrists are kept outside of. */
const FACE_GUARD_RADIUS = 0.2
/** Most the hand may bend off the forearm line (radians). */
const MAX_WRIST_BEND = 1.55
const FLIP_MAX_WRIST_BEND = 0.6
/** Most of a forearm/hand roll handed to the LowerArm bone (fraction and radians). */
const TWIST_SHARE = 0.95
const TWIST_MAX = 2.7
const TWIST_OMEGA = 14
const TWO_PI = Math.PI * 2
const TORSO_HALF_WIDTH = 0.34
const TORSO_HALF_DEPTH = 0.3
const RAIL_ELBOW_MARGIN = 0.08
const CHAIR_ELBOW_LIMIT = 0.86

/** Critically damped step toward `goal` (result in scalarOut). */
function smoothScalar(value: number, velocity: number, goal: number, omega: number, dt: number) {
  const y = value - goal
  const e = Math.exp(-omega * dt)
  const t = velocity + omega * y
  scalarOut.v = goal + (y + t * dt) * e
  scalarOut.vel = (velocity - omega * t * dt) * e
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value
}

/**
 * Builds the world-space fingers direction and index-to-pinky direction for a
 * gesture frame (hand-relative: yaw toward the body midline, pitch up, roll
 * palm-toward-the-midline), relative to palm-down with fingers at the table.
 */
function gestureFrame(frame: readonly number[], side: 1 | -1, root: THREE.Object3D, outF: THREE.Vector3, outS: THREE.Vector3) {
  const yaw = side > 0 ? frame[1]! : -frame[1]!
  const roll = side > 0 ? -frame[3]! : frame[3]!
  euler.set(frame[2]!, yaw, roll, 'YXZ')
  quatA.setFromEuler(euler)
  outF.set(0, 0, -1).applyQuaternion(quatA)
  frameN.set(0, -1, 0).applyQuaternion(quatA)
  // index-to-pinky = mirror * (palm normal x fingers)
  outS.crossVectors(frameN, outF).multiplyScalar(side)
  outF.transformDirection(root.matrixWorld)
  outS.transformDirection(root.matrixWorld)
}

const blendQa = new THREE.Quaternion()
const blendQb = new THREE.Quaternion()
const blendQc = new THREE.Quaternion()
const blendQd = new THREE.Quaternion()

/**
 * Blends hand frame (F, S) toward (toF, toS) by `t` as a rotation (slerp of the
 * two frames' orientations). A plain vector lerp of the side vectors collapses
 * to zero when the frames are roughly opposite (palm-down toward palm-up) and
 * flips the hand a half turn in a single frame.
 */
function blendFrames(f: THREE.Vector3, sVec: THREE.Vector3, toF: THREE.Vector3, toS: THREE.Vector3, t: number, st: SideState, stage: number) {
  if (t <= 0.0005) {
    st.blendValid[stage] = false
    return
  }
  if (!frameBasis(f, sVec, blendQa) || !frameBasis(toF, toS, blendQb)) return
  const previous = st.blendQ[stage]!
  // Two ways round for the blend (q and -q are the same orientation). When the
  // frames are close to a half turn apart, which way is shorter can flip from
  // one frame to the next as they move, and the hand would snap through a half
  // turn; so keep to whichever path is closest to last frame's result.
  blendQc.copy(blendQa).slerp(blendQb, t)
  if (st.blendValid[stage]) {
    blendQb.set(-blendQb.x, -blendQb.y, -blendQb.z, -blendQb.w)
    blendQd.copy(blendQa).slerp(blendQb, t)
    const near = Math.abs(previous.dot(blendQc))
    const far = Math.abs(previous.dot(blendQd))
    if (far > near + 1e-6) blendQc.copy(blendQd)
  }
  previous.copy(blendQc)
  st.blendValid[stage] = true
  f.set(1, 0, 0).applyQuaternion(blendQc)
  sVec.set(0, 1, 0).applyQuaternion(blendQc)
}

function frameBasis(primary: THREE.Vector3, secondary: THREE.Vector3, target: THREE.Quaternion): boolean {
  basisX.copy(primary).normalize()
  basisZ.crossVectors(basisX, secondary)
  if (basisZ.lengthSq() < 1e-10) return false
  basisZ.normalize()
  basisY.crossVectors(basisZ, basisX)
  basisM.makeBasis(basisX, basisY, basisZ)
  target.setFromRotationMatrix(basisM)
  return true
}

/** Rotates `v` about unit `axis` by `angle` (in place). */
function rotateAbout(v: THREE.Vector3, axis: THREE.Vector3, angle: number) {
  quatD.setFromAxisAngle(axis, angle)
  v.applyQuaternion(quatD)
}

const profileNow = () => (process.env.NODE_ENV !== 'production' && (globalThis as { __animProf?: unknown }).__animProf ? performance.now() : 0)
function profileAdd(name: string, since: number) {
  if (!since) return
  const profile = (globalThis as { __animProf?: Record<string, number> }).__animProf
  if (profile) profile[name] = (profile[name] ?? 0) + performance.now() - since
}

export interface ArmSolveOptions {
  flipTarget?: Vec3 | null
  delta: number
}

/**
 * Reaches each hand to its animator target and orients it. Replaces the old
 * per-frame solveSeatArms (the room calls this once per seat per frame).
 * Expects the model's matrices to be current when called.
 */
export function solveAvatarArms(ctx: ArmSolveContext, pose: AvatarPose, options: ArmSolveOptions) {
  const profile = process.env.NODE_ENV !== 'production' ? (globalThis as { __animProf?: Record<string, number> }).__animProf : undefined
  const started = profile ? performance.now() : 0
  solveAvatarArmsInner(ctx, pose, options)
  if (profile) profile.arms = (profile.arms ?? 0) + performance.now() - started
}

function solveAvatarArmsInner(ctx: ArmSolveContext, pose: AvatarPose, options: ArmSolveOptions) {
  const { bones, root, anchors } = ctx
  const flipTarget = options.flipTarget ?? null
  const dt = Math.min(0.05, Math.max(0.001, options.delta))
  const state = getArmState(bones)
  const { rig } = state
  let mark = profileNow()
  root.updateWorldMatrix(true, false)
  rootInverse.copy(root.matrixWorld).invert()
  for (const sideRig of [rig.R, rig.L]) if (sideRig && !sideRig.measured) measureHandRig(bones, sideRig)
  profileAdd('a.neutral', mark)

  // Lean in for far reaches (pushing chips, shoving all-in) before solving.
  mark = profileNow()
  let overshoot = 0
  let leanNet = 0
  for (let i = 0; i < 2; i += 1) {
    const sideRig = i === 0 ? rig.R : rig.L
    const st = i === 0 ? state.R : state.L
    const hand = i === 0 ? pose.handR : pose.handL
    if (!sideRig) continue
    measureArmLength(sideRig.chain, st, root.scale.x)
    ikTarget.set(hand[0], hand[1], hand[2]).applyMatrix4(root.matrixWorld)
    shoulderWorld.setFromMatrixPosition(sideRig.chain.upper.matrixWorld)
    // How far past a comfortable reach the target is (soft elbow: 90% extension).
    overshoot = Math.max(overshoot, shoulderWorld.distanceTo(ikTarget) - st.length * ARM_MAX_EXTENSION)
  }
  if (overshoot > 0.001) {
    // Lean over the (wide) rail to reach the felt, keeping the eyes up so the
    // face stays readable from across the table.
    const lean = Math.min(0.55, (overshoot / Math.max(0.2, root.scale.x)) * 0.9)
    ctx.applyOffset(rig.chest, lean * 0.62, 0, 0)
    ctx.applyOffset(rig.torso, lean * 0.38, 0, 0)
    ctx.applyOffset(rig.head, -lean * 0.65, 0, 0)
    leanNet = lean * 0.35
    ctx.model.updateMatrixWorld(true)
  }
  // Keep the face up: the spine's pitch, summed down to the head (the animator's
  // own leans and their spring overshoot, plus the reach lean above), is capped
  // with a soft knee by counter-pitching the head, so a deep lean over the chips
  // or a fold never buries the face under a hat brim. (Passed-out is exempt: the
  // head is meant to be down on the rail.)
  if (rig.head && pose.bones.Chest[0] < 0.55) {
    const spine = pose.bones.Torso[0] + pose.bones.Chest[0] + pose.bones.Neck[0] + pose.bones.Head[0] + leanNet
    const over = spine - HEAD_PITCH_CAP
    if (over > 0) {
      ctx.applyOffset(rig.head, -(over * over) / (over + HEAD_PITCH_KNEE), 0, 0)
      updateWorldOf(rig.head, rig.head.parent!)
    }
  }
  profileAdd('a.lean', mark)

  // Collarbone assist: the shoulder reaches toward a far hand and lifts for a
  // high one (before the IK, so the arm has slack instead of locking straight).
  mark = profileNow()
  for (let i = 0; i < 2; i += 1) {
    const sideRig = i === 0 ? rig.R : rig.L
    const st = i === 0 ? state.R : state.L
    const hand = i === 0 ? pose.handR : pose.handL
    const out = i === 0 ? 1 : -1
    if (!sideRig || !sideRig.clavicle) continue
    ikTarget.set(hand[0], hand[1], hand[2]).applyMatrix4(root.matrixWorld)
    shoulderWorld.setFromMatrixPosition(sideRig.chain.upper.matrixWorld)
    const reachFraction = shoulderWorld.distanceTo(ikTarget) / Math.max(1e-4, st.length)
    const reachGoal = smoothstep(0.55, 0.95, reachFraction)
    const above = (hand[1] - anchors.shoulderR[1]) / Math.max(0.1, root.scale.x)
    const liftGoal = smoothstep(-0.05, 0.5, above)
    smoothScalar(st.reach, st.reachVel, reachGoal, 9, dt)
    st.reach = scalarOut.v
    st.reachVel = scalarOut.vel
    smoothScalar(st.lift, st.liftVel, liftGoal, 9, dt)
    st.lift = scalarOut.v
    st.liftVel = scalarOut.vel
    if (st.reach > 0.01 || st.lift > 0.01) {
      // Protract (x) and elevate (z, mirrored per side); only the arm subtree moves.
      ctx.applyOffset(sideRig.clavicle, 0.34 * st.reach, 0, 0.3 * st.lift * out)
      updateWorldOf(sideRig.clavicle, sideRig.clavicle.parent!)
      updateWorldOf(sideRig.chain.upper, sideRig.clavicle)
      updateWorldOf(sideRig.chain.lower, sideRig.chain.upper)
      updateWorldOf(sideRig.chain.hand, sideRig.chain.lower)
    }
  }
  profileAdd('a.assist', mark)

  const splay = clamp(pose.elbowOut, 0, 1)
  const raiseAll = clamp(pose.elbowUp, 0, 1)
  // Face guard: the live skull, as a sphere a little above the head bone
  // (which sits at the top of the neck), in seat space. A wrist target that
  // would pass through it (hands travelling to or from behind the head, a rub
  // on the crown) is slid out sideways, toward its own shoulder, so the hand
  // goes round the side of the head and never in front of the face.
  let guardRadius = 0
  if (rig.head) {
    faceGuardCenter.setFromMatrixPosition(rig.head.matrixWorld).applyMatrix4(rootInverse)
    faceGuardCenter.y += 0.13
    guardRadius = FACE_GUARD_RADIUS
  }

  for (let i = 0; i < 2; i += 1) {
    const sideRig = i === 0 ? rig.R : rig.L
    const st = i === 0 ? state.R : state.L
    const hand = i === 0 ? pose.handR : pose.handL
    const shoulder = i === 0 ? anchors.shoulderR : anchors.shoulderL
    const frame = i === 0 ? pose.frameR : pose.frameL
    const out = i === 0 ? 1 : -1
    if (!sideRig) continue
    const { chain } = sideRig
    ikTarget.set(hand[0], hand[1], hand[2])
    const raise = raiseAll * smoothstep(shoulder[1] - 0.05, shoulder[1] + 0.2, hand[1])
    // Hands at the head (laced behind it, rubbing it, head in hands, fixing a
    // hat) go where the head is now: the targets are laid out against the
    // upright rest pose, and a lounge, flinch or slump moves the skull by a
    // hand's width.
    const carry = Math.max(raise, clamp(pose.headFollow, 0, 1))
    if (carry > 0.01 && guardRadius > 0) {
      const restHead = anchors.chin
      ikTarget.x += (faceGuardCenter.x - restHead[0]) * carry
      ikTarget.y += (faceGuardCenter.y - 0.13 - (restHead[1] - 0.02)) * carry
      ikTarget.z += (faceGuardCenter.z - (restHead[2] + 0.26)) * carry
    }
    // Never through the hole cards: a hand whose palm or fingers would land
    // on them is lifted clear (fingers hang below the wrist plane), faded in
    // and out by how far it overlaps, and off while a gesture owns the hand
    // (peeking, folding: those go to the cards on purpose).
    if (ctx.cardsVisible !== false) {
      const cardOverlap = getCardOverlap(anchors, ikTarget, pose.cardLift) * (1 - clamp(frame[0]!, 0, 1))
      if (cardOverlap > 0.001) {
        const minY = anchors.cards[1] - 0.01 + 0.09 * pose.cardLift + CARD_HAND_CLEARANCE
        if (ikTarget.y < minY) ikTarget.y += (minY - ikTarget.y) * cardOverlap
      }
    }
    // Never through the player's own chip stack unless the gesture is taking
    // chips from it (stackGrip): the wrist is kept out of a cylinder around the
    // stack (the hand rests beside it instead of the top chip sitting on the
    // wrist).
    const stackFree = 1 - clamp(pose.stackGrip, 0, 1)
    if (stackFree > 0.01) {
      const cx = anchors.stack[0] - STACK_ANCHOR_OFFSET
      const cz = anchors.stack[2]
      const dx = ikTarget.x - cx
      const dz = ikTarget.z - cz + 0.002
      const dist = Math.hypot(dx, dz)
      if (dist < STACK_CLEAR_RADIUS) {
        const above = 1 - smoothstep(anchors.stack[1] + 0.25, anchors.stack[1] + 0.4, ikTarget.y)
        const w = stackFree * above
        if (w > 0.001) {
          const k = (STACK_CLEAR_RADIUS / dist - 1) * w
          ikTarget.x += dx * k
          ikTarget.z += dz * k
        }
      }
    }
    // Never into the padded rail: over its cushion a wrist stays at least a
    // forearm's thickness above the crown (the rail anchor sits there).
    const railAnchor = out > 0 ? anchors.railR : anchors.railL
    if (ikTarget.z < railAnchor[2] + 0.05 && ikTarget.z > railAnchor[2] - 0.4) {
      ikTarget.y = Math.max(ikTarget.y, railAnchor[1] - 0.03)
    }
    if (guardRadius > 0) {
      faceGuardOffset.subVectors(ikTarget, faceGuardCenter)
      const across = guardRadius * guardRadius - faceGuardOffset.y * faceGuardOffset.y - faceGuardOffset.z * faceGuardOffset.z
      if (across > 0) {
        const clearX = Math.sqrt(across)
        if (faceGuardOffset.x * out < clearX) ikTarget.x = faceGuardCenter.x + out * clearX
      }
    }
    ikTarget.applyMatrix4(root.matrixWorld)
    // Elbows swing out to the side and down/back, like arms resting on a rail;
    // folded on the rail (passed out) they splay out level with the hands;
    // a hand raised to or above the head (elbowUp) lifts its own elbow only.
    // (Relaxed: out more than down, so the elbows sit a little away from the
    // ribs instead of pinned to them with the forearms in a tight V.)
    // A hand up near the face or chest (a chin rest, a facepalm, arms thrown
    // up) lets the elbow hang: down and only a little out, so the forearm rises
    // to the hand instead of lying across the face.
    const handHigh = smoothstep(shoulder[1] - 0.5, shoulder[1] - 0.15, hand[1]) * (1 - raise)
    const poleOut = (0.95 + 0.25 * splay + 0.1 * raise) * (1 - handHigh) + 0.5 * handHigh
    const poleDown = ((0.5 * (1 - splay) + 0.12 * splay) * (1 - raise) - 0.5 * raise) * (1 - handHigh) + 1.0 * handHigh
    const poleBack = ((0.25 * (1 - splay) + 0.05 * splay) * (1 - raise) + 0.15 * raise) * (1 - handHigh) - 0.1 * handHigh
    poleLocal.set(shoulder[0] + out * poleOut, shoulder[1] - poleDown, shoulder[2] + poleBack)
    // Keep the elbow out of the body, rail and chair: a smoothed push on the pole.
    ikPole.copy(poleLocal).add(st.push).applyMatrix4(root.matrixWorld)
    // The idle clip rolls the forearm about its own axis (about 50 degrees,
    // once a second) with the hand held still by the alignment: pure churn
    // that saturates the rotation limiter. The forearm's roll is owned by the
    // twist share below; positions are unaffected (the wrist is on the axis).
    if (!(process.env.NODE_ENV !== 'production' && (globalThis as { __noStrip?: boolean }).__noStrip)) stripTwist(chain.lower, chain.hand)
    mark = profileNow()
    solveArmIK(chain, ikTarget, ikPole, 1, true)
    profileAdd('a.ik', mark)
    mark = profileNow()
    if (updateElbowClearance(ctx, rig, chain, out, st, dt)) {
      ikPole.copy(poleLocal).add(st.push).applyMatrix4(root.matrixWorld)
      solveArmIK(chain, ikTarget, ikPole, 1, true)
    }
    profileAdd('a.clear', mark)
    // Rotation limits (see limitBoneRotation); quick gestures (flick-off, chip
    // flick) get a higher ceiling.
    limitActive = !pose.instant
    limitScale = 1 + (flipTarget ? 1 : 0) + 1.2 * Math.min(1, Math.max(0, Math.max(pose.handShapeR.speed, pose.handShapeL.speed) - 1))
    if (limitActive && limitBoneRotation(chain.upper, st, 0, dt, limitScale)) {
      updateWorldOf(chain.upper, chain.upper.parent!)
      updateWorldOf(chain.lower, chain.upper)
      updateWorldOf(chain.hand, chain.lower)
    }
    mark = profileNow()
    orientHand(ctx, sideRig, pose, i === 0 ? 'WristR' : 'WristL', out, hand, frame, flipTarget, st, dt)
    profileAdd('a.orient', mark)
    st.limitValid = limitActive
    if (process.env.NODE_ENV !== 'production') {
      const diag = (globalThis as { __armDiag?: Record<string, unknown> }).__armDiag
      if (diag) diag[out > 0 ? 'R' : 'L'] = { raise, handHigh, push: st.push.length(), twist: st.twist, twistRaw: st.twistRaw, target: [ikTarget.x, ikTarget.y, ikTarget.z], g: frame[0], rate: st.limitRate.slice() }
    }
  }
}

/** Limits on how fast (rad/s) and how sharply (rad/s^2) an arm bone may start turning, per bone. */
const LIMIT_RATE = [12, 15, 15] as const
const LIMIT_ACCEL = [380, 480, 480] as const
const limitTmp = new THREE.Quaternion()
let limitActive = false
let limitScale = 1

/**
 * Keeps a bone's rotation from jumping: whatever the IK or the hand-frame maths
 * asked for, the bone turns toward it no faster than a human limb could, and
 * speeds up over a few frames instead of in one. (Whatever the cause of a
 * discontinuity upstream, the arm never pops.) Returns true if it clipped.
 */
function limitBoneRotation(bone: THREE.Bone, st: SideState, slot: number, dt: number, scale: number): boolean {
  const previous = st.limitQ[slot]!
  const goal = bone.quaternion
  if (!st.limitValid) {
    previous.copy(goal)
    st.limitRate[slot] = 0
    return false
  }
  const dot = Math.abs(previous.dot(goal))
  const angle = 2 * Math.acos(dot > 1 ? 1 : dot)
  const allowedRate = Math.min(LIMIT_RATE[slot]! * scale, st.limitRate[slot]! + LIMIT_ACCEL[slot]! * scale * dt)
  const allowed = allowedRate * dt
  if (angle > allowed && angle > 1e-5) {
    limitTmp.copy(goal)
    if (previous.dot(limitTmp) < 0) limitTmp.set(-limitTmp.x, -limitTmp.y, -limitTmp.z, -limitTmp.w)
    previous.slerp(limitTmp, allowed / angle)
    goal.copy(previous)
    st.limitRate[slot] = allowedRate
    return true
  }
  st.limitRate[slot] = angle / dt
  previous.copy(goal)
  return false
}

/** Wrist height above the card top that keeps the (drooping) fingers off the card face. */
const CARD_HAND_CLEARANCE = 0.12
/** The stack anchor sits this far right of the stack's axis; hands keep this far from the axis. */
const STACK_ANCHOR_OFFSET = 0.07
const STACK_CLEAR_RADIUS = 0.2
/** Summed spine pitch (rad) beyond which the head counter-pitches, and how soft the knee is. */
const HEAD_PITCH_CAP = 0.22
const HEAD_PITCH_KNEE = 0.1
/** Hole cards: half-width of the pair, half-depth of one card (seat units). */
const CARD_HALF_WIDTH = 0.42
const CARD_HALF_DEPTH = 0.34
/** How far the fingers reach ahead of / behind the wrist point (toward the table is -z). */
const HAND_FORWARD = 0.4
const HAND_BACK = 0.06

/** 0..1 how much the hand at `wrist` (seat space) overlaps the hole cards, with soft edges. */
function getCardOverlap(anchors: AvatarAnchors, wrist: THREE.Vector3, lift: number) {
  const cz = anchors.cards[2]
  const outsideX = Math.abs(wrist.x) - CARD_HALF_WIDTH
  const near = wrist.z + HAND_BACK
  const far = wrist.z - HAND_FORWARD
  const gap = Math.max(far - (cz + CARD_HALF_DEPTH), cz - CARD_HALF_DEPTH - near)
  const overlapX = 1 - smoothstep(-0.02, 0.1, outsideX)
  const overlapZ = 1 - smoothstep(-0.02, 0.1, gap)
  void lift
  return overlapX * overlapZ
}

const tipLocal = new THREE.Vector3()
const dirLocal = new THREE.Vector3()

/**
 * Tips the fingers up (a wrist extension) so their tips clear the hole cards:
 * the fingertip point is estimated from the wrist and the finger direction,
 * and if it would land on a card the direction is raised just enough (faded by
 * how far the fingers overlap the cards, limited to a modest bend).
 */
function raiseFingersOffCards(ctx: ArmSolveContext, pose: AvatarPose, wrist: THREE.Vector3, direction: THREE.Vector3) {
  const { anchors } = ctx
  tipLocal.copy(wrist).applyMatrix4(rootInverse)
  dirLocal.copy(direction).transformDirection(rootInverse)
  const cz = anchors.cards[2]
  const top = anchors.cards[1] - 0.01 + 0.05 * pose.cardLift + 0.03
  let need = 0
  let weight = 0
  for (let step = 0; step < 3; step += 1) {
    const reach = 0.13 + step * 0.13
    const x = tipLocal.x + dirLocal.x * reach
    const z = tipLocal.z + dirLocal.z * reach
    const y = tipLocal.y + dirLocal.y * reach - 0.15 * (step + 1) / 3
    const overlap = (1 - smoothstep(-0.02, 0.08, Math.abs(x) - CARD_HALF_WIDTH)) *
      (1 - smoothstep(-0.02, 0.08, Math.abs(z - cz) - CARD_HALF_DEPTH))
    if (overlap <= 0.001) continue
    const deficit = (top - y) / reach
    if (deficit * overlap > need * weight) {
      need = deficit
      weight = overlap
    }
  }
  if (need <= 0 || weight <= 0.001) return
  const lift = Math.min(0.7, need * weight)
  // Raise along seat-up (world up for an upright seat); keep the length.
  direction.y += lift
  direction.normalize()
}

const stripAxis = new THREE.Vector3()
const stripTwistQ = new THREE.Quaternion()

/** Removes the rotation of `bone` about the line to its `child` (swing-twist), leaving the swing. */
function stripTwist(bone: THREE.Bone, child: THREE.Bone) {
  stripAxis.copy(child.position)
  if (stripAxis.lengthSq() < 1e-12) return
  stripAxis.normalize()
  const q = bone.quaternion
  const dot = q.x * stripAxis.x + q.y * stripAxis.y + q.z * stripAxis.z
  stripTwistQ.set(stripAxis.x * dot, stripAxis.y * dot, stripAxis.z * dot, q.w)
  const length = stripTwistQ.length()
  if (length < 1e-6) return
  stripTwistQ.set(stripTwistQ.x / length, stripTwistQ.y / length, stripTwistQ.z / length, stripTwistQ.w / length)
  // q = swing * twist  =>  swing = q * twist^-1
  stripTwistQ.set(-stripTwistQ.x, -stripTwistQ.y, -stripTwistQ.z, stripTwistQ.w)
  q.multiply(stripTwistQ)
}

/** Puts the fingers on their bind pose once and stores the knuckle positions in wrist space. */
function measureHandRig(bones: ReadonlyMap<string, THREE.Bone>, sideRig: SideRig) {
  const rigs = getHandRig(bones)
  neutralizeHand(sideRig.chain.hand.name.endsWith('R') ? rigs.R : rigs.L)
  sideRig.chain.hand.updateMatrixWorld(true)
  const { hand } = sideRig.chain
  hand.worldToLocal(sideRig.localMiddle.setFromMatrixPosition(sideRig.middle.matrixWorld))
  hand.worldToLocal(sideRig.localIndex.setFromMatrixPosition(sideRig.index.matrixWorld))
  hand.worldToLocal(sideRig.localPinky.setFromMatrixPosition(sideRig.pinky.matrixWorld))
  sideRig.measured = true
}

/** Arm length in world units (measured once per root scale; the rig never changes). */
function measureArmLength(chain: ArmChain, st: SideState, scale: number) {
  if (st.length > 0 && st.lengthScale === scale) return
  shoulderWorld.setFromMatrixPosition(chain.upper.matrixWorld)
  elbowWorld.setFromMatrixPosition(chain.lower.matrixWorld)
  wristWorld.setFromMatrixPosition(chain.hand.matrixWorld)
  st.length = shoulderWorld.distanceTo(elbowWorld) + elbowWorld.distanceTo(wristWorld)
  st.lengthScale = scale
}

/**
 * Checks the solved elbow against the torso, the table rail and the chair
 * shell (seat space). Inside one, it grows a push on the pole so the elbow
 * swivels out (the caller re-solves); clear of all of them the push relaxes,
 * so an elbow hovers along the boundary and never pops. Returns whether the
 * arm needs to be re-solved.
 */
function updateElbowClearance(ctx: ArmSolveContext, rig: ArmRig, chain: ArmChain, out: 1 | -1, st: SideState, dt: number): boolean {
  const { anchors } = ctx
  elbowLocal.setFromMatrixPosition(chain.lower.matrixWorld).applyMatrix4(rootInverse)
  escape.set(0, 0, 0)

  // Torso: an ellipse around the spine axis (seen from above), chest height and up.
  if (rig.chest) {
    spineLocal.setFromMatrixPosition(rig.chest.matrixWorld).applyMatrix4(rootInverse)
    const dx = elbowLocal.x - spineLocal.x
    const dz = elbowLocal.z - spineLocal.z
    const heightFactor = smoothstep(anchors.railR[1] - 0.12, anchors.railR[1] + 0.05, elbowLocal.y)
    const norm = Math.hypot(dx / TORSO_HALF_WIDTH, dz / TORSO_HALF_DEPTH)
    if (norm < 1 && heightFactor > 0) {
      // Out to the boundary along the ellipse normal.
      const inv = 1 / Math.max(norm, 0.25)
      escape.x += (dx * inv - dx) * heightFactor
      escape.z += (dz * inv - dz) * heightFactor
    }
  }

  // Rail cushion: the block in front of the ribs, from its crown line down.
  const railTop = anchors.railR[1] - 0.05 + RAIL_ELBOW_MARGIN
  const railBack = anchors.railR[2] + 0.1 + RAIL_ELBOW_MARGIN
  const railFront = anchors.railR[2] - 0.5
  if (elbowLocal.z < railBack && elbowLocal.z > railFront && elbowLocal.y < railTop) {
    const up = railTop - elbowLocal.y
    const back = railBack - elbowLocal.z
    // Up is cheaper than back for an elbow that is beside the rail.
    if (up < back * 1.4) escape.y += up
    else escape.z += back
  }

  // Chair shell: elbows stay inside the wraparound arms.
  const outward = elbowLocal.x * out
  if (outward > CHAIR_ELBOW_LIMIT && elbowLocal.z > -0.35) escape.x -= (outward - CHAIR_ELBOW_LIMIT) * out

  if (escape.lengthSq() > 4e-6) {
    // A pole displacement of ~2.5x moves the elbow by about the displacement.
    // The push is eased toward its new value (never applied in one frame), so
    // an elbow meeting the ribs swivels out instead of jumping.
    pushGoal.copy(st.push).addScaledVector(escape, 2.5)
    if (pushGoal.length() > 1.2) pushGoal.setLength(1.2)
    st.push.lerp(pushGoal, 1 - Math.exp(-dt * 12))
    return true
  }
  if (st.push.lengthSq() > 1e-6) st.push.multiplyScalar(Math.exp(-2.2 * dt))
  return false
}

/**
 * Orients the hand: a natural relaxed frame (aligned with the forearm, palm
 * down on the rail, turning in toward the body in the air) blended toward the
 * animator's gesture frame, with the wrist bend limited and the roll shared
 * between the forearm and the wrist.
 */
function orientHand(
  ctx: ArmSolveContext,
  sideRig: SideRig,
  pose: AvatarPose,
  wristKey: 'WristR' | 'WristL',
  out: 1 | -1,
  hand: Vec3,
  frame: readonly number[],
  flipTarget: Vec3 | null,
  st: SideState,
  dt: number
) {
  const { root, anchors } = ctx
  const { chain } = sideRig
  elbowWorld.setFromMatrixPosition(chain.lower.matrixWorld)
  wristWorld.setFromMatrixPosition(chain.hand.matrixWorld)
  forearm.subVectors(wristWorld, elbowWorld)
  if (forearm.lengthSq() < 1e-10) return
  forearm.normalize()

  // Natural frame. Near the rail: palm down on the cushion, fingers carrying on
  // from the forearm and curving in toward the table; in the air: aligned
  // with the forearm, palm turned in toward the body.
  const railY = out > 0 ? anchors.railR[1] : anchors.railL[1]
  const restWeight = 1 - smoothstep(0.04, 0.14, Math.abs(hand[1] - railY))
  restInward.set(0, 0, -1).transformDirection(root.matrixWorld).setY(0).normalize()
  restFingers.copy(forearm).setY(0)
  if (restFingers.lengthSq() < 1e-8) restFingers.copy(restInward)
  // (Half along the forearm, half toward the table: turned in any further the
  // resting wrist sat on its sideways limit, creasing the skin at the wrist.)
  restFingers.normalize().multiplyScalar(0.45).addScaledVector(restInward, 0.55).normalize()
  // resting: cross(fingers, up) * out, tipped so the pinky edge sits a touch lower
  tmpA.crossVectors(restFingers, WORLD_UP).normalize().multiplyScalar(out)
  tmpA.addScaledVector(WORLD_UP, -0.15).normalize()
  // Fingers draping over the crown of the cushion, dipping with the forearm's
  // own slope (a flat hand on a steeply sloping forearm otherwise bends back
  // to its extension limit and the wrist creases).
  restFingers.y = Math.min(0, forearm.y) * 0.7 - 0.1
  restFingers.normalize()
  // In the air: fingers along the forearm, palm toward the body a little.
  naturalF.copy(forearm)
  // (Side = the seat's lateral axis made perpendicular to the forearm. The
  // old forearm x world-up was singular for a vertical forearm: with the arm
  // straight up it flipped the palm a half turn.)
  tmpB.set(out, 0, 0).transformDirection(root.matrixWorld)
  tmpB.addScaledVector(naturalF, -tmpB.dot(naturalF))
  if (tmpB.lengthSq() < 1e-6) tmpB.set(0, 0, -1).transformDirection(root.matrixWorld)
  tmpB.normalize()
  // palm-down side vector for the current forearm, then roll it in by ~40 degrees
  naturalS.copy(tmpB)
  rotateAbout(naturalS, naturalF, 0.7 * out)
  // Blend rest and air frames.
  blendFrames(naturalF, naturalS, restFingers, tmpA, restWeight, st, 0)

  frameF.copy(naturalF)
  frameS.copy(naturalS)

  // Gesture frame from the animator (weight, yaw, pitch, roll).
  const g = clamp(frame[0]!, 0, 1)
  if (g > 0.001) {
    gestureFrame(frame, out, root, gestureF, gestureS)
    blendFrames(frameF, frameS, gestureF, gestureS, g, st, 1)
  }

  // Flick-off: fingers up (tipped toward the target), back of the hand to them.
  if (flipTarget && (wristKey === 'WristL' ? 'L' : 'R') === getFlipOffHand(flipTarget) && pose.middleFinger > 0.01) {
    flipToward.set(flipTarget[0], flipTarget[1], flipTarget[2]).applyMatrix4(root.matrixWorld)
    flipToward.sub(wristWorld).setY(0)
    if (flipToward.lengthSq() > 1e-6) {
      flipToward.normalize()
      gestureF.copy(WORLD_UP).addScaledVector(flipToward, 0.28).normalize()
      // Keep the wrist bend believable: a hand snapped 90 degrees up off a
      // level forearm reads as a flat wedge instead of a raised finger.
      const cos = clamp(forearm.dot(gestureF), -1, 1)
      if (Math.acos(cos) > FLIP_MAX_WRIST_BEND) {
        gestureF.addScaledVector(forearm, -cos)
        if (gestureF.lengthSq() > 1e-8) {
          gestureF.normalize().multiplyScalar(Math.sin(FLIP_MAX_WRIST_BEND))
          gestureF.addScaledVector(forearm, Math.cos(FLIP_MAX_WRIST_BEND)).normalize()
        } else {
          gestureF.copy(forearm)
        }
      }
      gestureS.crossVectors(WORLD_UP, flipToward).normalize().multiplyScalar(out)
      blendFrames(frameF, frameS, gestureF, gestureS, pose.middleFinger, st, 2)
    }
  }

  // Raised arms (hands behind the head): fingers up and back over the skull,
  // palms to the head, instead of jutting straight inward across the face.
  const raiseGoal = clamp(pose.elbowUp, 0, 1) * smoothstep(anchors.shoulderR[1] - 0.05, anchors.shoulderR[1] + 0.2, hand[1])
  if (pose.instant) {
    st.raiseW = raiseGoal
    st.raiseV = 0
  } else {
    smoothScalar(st.raiseW, st.raiseV, raiseGoal, 9, dt)
    st.raiseW = scalarOut.v
    st.raiseV = scalarOut.vel
  }
  const raise = clamp(st.raiseW, 0, 1)
  if (raise > 0.01) {
    gestureF.set(0, 0.4, 0.92).transformDirection(root.matrixWorld)
    gestureS.set(0, -0.6, 0.8).transformDirection(root.matrixWorld)
    blendFrames(frameF, frameS, gestureF, gestureS, raise, st, 3)
  }

  frameF.normalize()
  if (ctx.cardsVisible !== false) raiseFingersOffCards(ctx, pose, wristWorld, frameF)
  // limit the wrist bend off the forearm line
  const cosBend = clamp(frameF.dot(forearm), -1, 1)
  if (cosBend < Math.cos(MAX_WRIST_BEND) && !(flipTarget && pose.middleFinger > 0.5)) {
    tmpA.copy(frameF).addScaledVector(forearm, -cosBend)
    if (tmpA.lengthSq() > 1e-8) {
      tmpA.normalize().multiplyScalar(Math.sin(MAX_WRIST_BEND)).addScaledVector(forearm, Math.cos(MAX_WRIST_BEND))
      frameF.copy(tmpA).normalize()
    }
  }
  // orthogonalise the side vector
  frameS.addScaledVector(frameF, -frameS.dot(frameF))
  if (frameS.lengthSq() < 1e-8) return
  frameS.normalize()
  // palm normal = F x S for the right hand (mirrored for the left)
  frameN.crossVectors(frameS, frameF).multiplyScalar(-out)
  // Legacy wrist offsets (flexion, roll, deviation) applied about the hand's own axes.
  const wristOffset = pose.bones[wristKey]
  const flex = wristOffset[0]
  const roll = wristOffset[1]
  const dev = wristOffset[2]
  if (Math.abs(flex) + Math.abs(roll) + Math.abs(dev) > 1e-4) {
    // fingers toward the palm side for positive flexion
    rotateAbout(frameF, frameS, -flex * out)
    rotateAbout(frameN, frameS, -flex * out)
    rotateAbout(frameF, frameN, dev * out)
    rotateAbout(frameS, frameN, dev * out)
    rotateAbout(frameS, frameF, roll * out)
    rotateAbout(frameN, frameF, roll * out)
  }
  // Anatomical limits (after the legacy offsets, which bend too): a wrist bends
  // much further toward the palm than back, and only a little side to side.
  // Past these the skinned wrist folds into a crease whose ink outline spikes.
  if (!(flipTarget && pose.middleFinger > 0.5)) {
    limitWristBend(frameF, frameS, forearm, out)
    frameS.addScaledVector(frameF, -frameS.dot(frameF))
    if (frameS.lengthSq() < 1e-8) return
    frameS.normalize()
  }
  alignHand(chain, sideRig, st, dt)
}

/** Wrist limits (radians): toward the palm, back toward the forearm, and side to side. */
const WRIST_FLEX_MAX = 1.2
const WRIST_EXTEND_MAX = 0.85
const WRIST_DEVIATE_MAX = 0.8
const wristN = new THREE.Vector3()
const wristSide = new THREE.Vector3()

/**
 * Clamps the fingers direction `f` off the forearm into the wrist's range:
 * flexion/extension about the palm's side axis and deviation about the palm
 * normal, measured in a frame built round the forearm (so the two stay
 * independent). `s` is the index-to-pinky direction (it keeps the roll).
 */
export function limitWristBend(f: THREE.Vector3, s: THREE.Vector3, forearmDir: THREE.Vector3, out: 1 | -1) {
  // Palm normal of the requested frame (see orientHand), made perpendicular to the forearm.
  // The frame round the forearm is built from the hand's side (index-to-pinky)
  // axis, which stays well away from the forearm line; the palm normal does
  // not (a steep forearm over a flat palm), and a split built on it mislabels
  // extension as a sideways bend and pins the wrist on the sideways limit.
  wristSide.copy(s).addScaledVector(forearmDir, -s.dot(forearmDir))
  if (wristSide.lengthSq() < 1e-8) return
  wristSide.normalize()
  wristN.crossVectors(wristSide, forearmDir).multiplyScalar(-out)
  const along = f.dot(forearmDir)
  const flex = Math.atan2(f.dot(wristN), along)
  const deviate = Math.atan2(f.dot(wristSide), along)
  const flexC = clamp(flex, -WRIST_EXTEND_MAX, WRIST_FLEX_MAX)
  const deviateC = clamp(deviate, -WRIST_DEVIATE_MAX, WRIST_DEVIATE_MAX)
  if (process.env.NODE_ENV !== 'production') {
    const diag = (globalThis as { __wristDiag?: { flex: number; ext: number; dev: number; n: number; last?: Record<string, number[]> } }).__wristDiag
    if (diag) {
      if (diag.last) diag.last[out > 0 ? 'R' : 'L'] = [flex, deviate, flexC, deviateC]
      diag.flex = Math.max(diag.flex, flex)
      diag.ext = Math.min(diag.ext, flex)
      diag.dev = Math.max(diag.dev, Math.abs(deviate))
      diag.n += 1
    }
    if ((globalThis as { __noWristLimit?: boolean }).__noWristLimit) return
  }
  if (flexC === flex && deviateC === deviate) return
  f.copy(forearmDir).addScaledVector(wristN, Math.tan(flexC)).addScaledVector(wristSide, Math.tan(deviateC)).normalize()
}

/**
 * Rotates the wrist so the (wrist -> middle knuckle) direction lines up with
 * frameF and the (index -> pinky) direction with frameS, in the lower arm's
 * frame (local' = (P^-1 delta P) * local), then hands part of the roll to the
 * LowerArm bone so a fully pronated (palm-down) hand is not all twisted at the
 * wrist joint.
 */
function alignHand(chain: ArmChain, sideRig: SideRig, st: SideState, dt: number) {
  const { lower, hand } = chain
  // The hand's current frame from its own matrix and the stored knuckle
  // offsets (the fingers' matrices are not needed, and stay stale).
  currentX.copy(sideRig.localMiddle).applyMatrix4(hand.matrixWorld).sub(wristWorld)
  currentY.copy(sideRig.localPinky).applyMatrix4(hand.matrixWorld).sub(tmpA.copy(sideRig.localIndex).applyMatrix4(hand.matrixWorld))
  if (currentX.lengthSq() < 1e-12 || currentY.lengthSq() < 1e-12) return
  basisQuaternionFrom(currentX, currentY, currentQ)
  basisQuaternionFrom(frameF, frameS, desiredQ)
  deltaQ.copy(desiredQ).multiply(currentQ.invert())
  // world delta -> the lower arm's frame
  lower.matrixWorld.decompose(decomposePosition, quatA, decomposeScale)
  quatA.invert()
  tmpA.set(deltaQ.x, deltaQ.y, deltaQ.z).applyQuaternion(quatA)
  quatB.set(tmpA.x, tmpA.y, tmpA.z, deltaQ.w)
  hand.quaternion.premultiply(quatB)

  // Share the roll about the forearm axis with the LowerArm bone. Any share
  // leaves the hand where it is (lower' = lower*T(s), hand' = T(-s)*hand), so
  // the share only has to be continuous: the roll is unwrapped against last
  // frame's (a palm-up hand crossing 180 degrees must not flip the share
  // from +max to -max) and the share itself is critically damped.
  twistAxis.copy(hand.position)
  if (twistAxis.lengthSq() > 1e-12) {
    twistAxis.normalize()
    quatA.copy(hand.quaternion)
    const dot = quatA.x * twistAxis.x + quatA.y * twistAxis.y + quatA.z * twistAxis.z
    let angle = 2 * Math.atan2(dot, quatA.w)
    let diff = angle - st.twistRaw
    diff -= Math.round(diff / TWO_PI) * TWO_PI
    st.twistRaw += diff
    angle = st.twistRaw
    const tweak = process.env.NODE_ENV === 'production' ? undefined : (globalThis as { __twist?: [number, number] }).__twist
    const goal = tweak ? clamp(angle * tweak[0], -tweak[1], tweak[1]) : clamp(angle * TWIST_SHARE, -TWIST_MAX, TWIST_MAX)
    smoothScalar(st.twist, st.twistVel, goal, TWIST_OMEGA, dt)
    st.twist = scalarOut.v
    st.twistVel = scalarOut.vel
    if (Math.abs(st.twist) > 1e-4) {
      quatC.setFromAxisAngle(twistAxis, st.twist)
      // lower' = lower * T(share); hand' = T(-share) * hand
      lower.quaternion.multiply(quatC)
      quatC.invert()
      hand.quaternion.premultiply(quatC)
    }
  }
  if (limitActive) {
    limitBoneRotation(lower, st, 1, dt, limitScale)
    limitBoneRotation(hand, st, 2, dt, limitScale)
  }
  updateWorldOf(lower, chain.upper)
  updateWorldOf(hand, lower)
}

/** Orthonormal basis (x = primary, z = x cross secondary) as a quaternion. */
function basisQuaternionFrom(primary: THREE.Vector3, secondary: THREE.Vector3, target: THREE.Quaternion) {
  basisX.copy(primary).normalize()
  basisZ.crossVectors(basisX, secondary).normalize()
  basisY.crossVectors(basisZ, basisX)
  basisM.makeBasis(basisX, basisY, basisZ)
  return target.setFromRotationMatrix(basisM)
}
