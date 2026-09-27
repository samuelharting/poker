import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js'
import type { PostFx } from './sceneLighting'
import type { AvatarFaceRig } from './avatarFace'
import type { ThreeTableViewModel } from './tableViewModel'
import { createDrinkProp, disposeDrinkProp, type DrinkProp } from './drinkProps'

/**
 * The drinking game's 3D side, kept out of the (busy) room component:
 *
 * - Blackout: other players see the head bonk the rail and bounce, then sit
 *   back up dazed under a ring of cartoon stars. The blacked-out player's own
 *   camera pitches down into the table with a jolt (their eyelids are DOM, see
 *   DrunkVisionLayer).
 * - Hangover: shades and temple rubs for everyone else to see.
 * - The pill trip: a post-processing pass (colour melt, breathing warp,
 *   kaleidoscope bursts in waves, chromatic smear) plus afterimage trails,
 *   a slow room roll, a breathing lens, a melting felt, pulsing lights, candy
 *   chips, balloon heads with spiral eyes on everyone else, and Lady Luck as a
 *   giant cat. Everyone else sees the victim staring at their hands in a
 *   rainbow aura with spiral eyes. A capsule drops into their water first.
 *
 * Nothing here touches the DOM HUD: action buttons, timer, bet amounts and
 * the hero's 2D cards are rendered above the canvas and stay legible.
 */

type Vec3 = [number, number, number]

/** Pose inputs the avatar animator reads (see avatarAnimator 19-22). */
export interface FunPoseInput {
  blackoutElapsed?: number | null
  dazedElapsed?: number | null
  hungover?: boolean
  tripping?: boolean
}

/** The bits of a seat runtime this module needs. */
export interface FunSeat {
  playerId: string
  root: THREE.Group
  head: THREE.Group
  avatar: { bones: ReadonlyMap<string, THREE.Bone> } | null
  face: AvatarFaceRig | null
  anchors: { drinkRest: Vec3 }
  funPose?: FunPoseInput
}

export interface FunFxOptions {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  postFx: PostFx | null
  feltMaterial: THREE.MeshStandardMaterial | null
  lights: THREE.Light[]
  chipMaterials: THREE.Material[]
  companionGroup: THREE.Object3D | null
}

/** Blackout beat, seconds (matches BUZZ.blackoutFx and the CSS eyelids). */
const LIDS_CLOSE = 0.6
const BONK_AT = 0.62
const BONK_DOWN = 0.28
const BLACK_UNTIL = 2.55
const RISE_SECONDS = 1.6
const DAZED_SECONDS = 2.6
/** Trip look: melt in, then drain back to normal colour over ~5s at the end. */
const TRIP_FADE_IN = 3.5
const TRIP_FADE_OUT = 5
/** The capsule plops into the glass and fizzes before the colours go. */
const CAPSULE_SECONDS = 1.9
/** Seconds a trip may vanish from the view before it counts as over. */
const TRIP_GRACE = 1.5


// ---------------------------------------------------------------------------
// Post-processing: the trip pass
// ---------------------------------------------------------------------------

const TripShader = {
  name: 'PillTripShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    strength: { value: 0 },
    kaleido: { value: 0 },
    warp: { value: 0 },
    aspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float strength;
    uniform float kaleido;
    uniform float warp;
    uniform float aspect;
    varying vec2 vUv;

    vec3 hueShift(vec3 color, float angle) {
      const vec3 k = vec3(0.57735);
      float c = cos(angle);
      return color * c + cross(k, color) * sin(angle) + k * dot(k, color) * (1.0 - c);
    }

    vec2 mirror(vec2 uv) {
      return 1.0 - abs(1.0 - mod(uv, 2.0));
    }

    void main() {
      vec2 p = vUv - 0.5;
      p.x *= aspect;
      float r = length(p);
      float a = atan(p.y, p.x);

      // The room breathes: slow radial swells plus a ripple running outward.
      float swell = sin(time * 0.9) * 0.035 + sin(r * 11.0 - time * 2.4) * 0.012 + sin(a * 5.0 + time * 1.1) * 0.008;
      p *= 1.0 + swell * warp;
      p += vec2(sin(p.y * 7.0 + time * 1.7), cos(p.x * 6.0 - time * 1.3)) * 0.01 * warp;

      // Kaleidoscope bursts: fold the angle into mirrored wedges.
      if (kaleido > 0.001) {
        float wedge = 6.2831853 / 8.0;
        float folded = mod(a + time * 0.25, wedge);
        folded = abs(folded - wedge * 0.5);
        vec2 kp = vec2(cos(folded), sin(folded)) * length(p) * (1.0 + 0.15 * sin(time * 2.0));
        p = mix(p, kp, kaleido);
      }

      p.x /= aspect;
      vec2 uv = mirror(p + 0.5);

      // Chromatic smear.
      vec2 dir = normalize(vUv - 0.5 + 1e-4);
      float ab = (0.0035 + 0.006 * kaleido) * strength;
      vec3 color;
      color.r = texture2D(tDiffuse, mirror(uv + dir * ab)).r;
      color.g = texture2D(tDiffuse, uv).g;
      color.b = texture2D(tDiffuse, mirror(uv - dir * ab)).b;

      // Colour melt: the hue slides across the screen and through time.
      float hue = time * 0.8 + (uv.x * 1.7 + uv.y * 2.3) * 1.6 + sin(time * 0.6 + uv.y * 5.0) * 0.9;
      vec3 melted = hueShift(color, hue);
      float luma = dot(melted, vec3(0.299, 0.587, 0.114));
      melted = mix(vec3(luma), melted, 1.55);
      // Liquid rainbow bands washing over everything.
      float bands = 0.5 + 0.5 * sin(r * 26.0 - time * 3.1 + a * 3.0);
      vec3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + bands * 0.6 + time * 0.12));
      melted = mix(melted, melted * 0.75 + rainbow * 0.5 * (0.35 + luma), 0.22 + 0.2 * kaleido);

      vec3 base = texture2D(tDiffuse, vUv).rgb;
      gl_FragColor = vec4(mix(base, max(melted, 0.0), clamp(strength, 0.0, 1.0)), 1.0);
    }
  `,
}

// ---------------------------------------------------------------------------
// Canvas textures (cartoon props)
// ---------------------------------------------------------------------------

function canvasTexture(size: number, draw: (context: CanvasRenderingContext2D, size: number) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context) draw(context, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function spiralTexture() {
  return canvasTexture(128, (ctx, size) => {
    const c = size / 2
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(c, c, c - 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#6b1fb3'
    ctx.lineWidth = 7
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (let t = 0; t < Math.PI * 7; t += 0.08) {
      const radius = (t / (Math.PI * 7)) * (c - 6)
      const x = c + Math.cos(t) * radius
      const y = c + Math.sin(t) * radius
      if (t === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  })
}

function auraTexture() {
  return canvasTexture(256, (ctx, size) => {
    const c = size / 2
    const colors = ['#ff3b3b', '#ffb13b', '#fff23b', '#3bff6e', '#3bc8ff', '#7a3bff', '#ff3bd8']
    for (let ring = colors.length - 1; ring >= 0; ring -= 1) {
      const gradient = ctx.createRadialGradient(c, c, 0, c, c, c)
      const inner = 0.3 + ring * 0.09
      gradient.addColorStop(Math.max(0, inner - 0.08), 'rgba(0,0,0,0)')
      gradient.addColorStop(inner, colors[ring]!)
      gradient.addColorStop(Math.min(1, inner + 0.08), 'rgba(0,0,0,0)')
      ctx.fillStyle = gradient
      ctx.globalAlpha = 0.55
      ctx.fillRect(0, 0, size, size)
    }
  })
}

function starTexture() {
  return canvasTexture(64, (ctx, size) => {
    const c = size / 2
    ctx.fillStyle = '#ffe14d'
    ctx.strokeStyle = '#8a5a00'
    ctx.lineWidth = 3
    ctx.beginPath()
    for (let i = 0; i < 10; i += 1) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5
      const radius = i % 2 === 0 ? c - 4 : c * 0.42
      ctx.lineTo(c + Math.cos(angle) * radius, c + Math.sin(angle) * radius)
    }
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  })
}

function catTexture() {
  return canvasTexture(256, (ctx, size) => {
    ctx.font = `${Math.round(size * 0.86)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('🐱', size / 2, size / 2 + size * 0.04)
  })
}

// ---------------------------------------------------------------------------
// Per-seat props
// ---------------------------------------------------------------------------

interface SeatProps {
  group: THREE.Group
  aura: THREE.Sprite
  stars: THREE.Sprite[]
  spirals: THREE.Mesh[]
  shades: THREE.Group | null
  capsule: { group: THREE.Group; glass: DrinkProp; bubbles: THREE.Points; startedAt: number } | null
  /** The bone (or fallback group) the spirals and shades hang on. */
  headNode: THREE.Object3D | null
}

interface Tracked {
  passedOut: boolean
  blackoutAt: number | null
  wokeAt: number | null
  hungover: boolean
  tripping: boolean
  tripStartedAt: number | null
  /** Last frame the view said they were tripping (brief view hiccups don't restart the trip). */
  lastTripSeen: number
  isHero: boolean
  props: SeatProps | null
}

const worldA = new THREE.Vector3()
const worldB = new THREE.Vector3()
const scratchColor = new THREE.Color()

export class FunFx {
  private readonly options: FunFxOptions
  private readonly tracked = new Map<string, Tracked>()
  private readonly tripPass: ShaderPass | null
  private readonly afterimage: AfterimagePass | null
  private readonly textures: { spiral: THREE.Texture; aura: THREE.Texture; star: THREE.Texture; cat: THREE.Texture }
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly materials: THREE.Material[] = []
  private readonly spiralMaterial: THREE.MeshBasicMaterial
  private readonly shadesMaterial: THREE.MeshStandardMaterial
  private readonly cat: THREE.Sprite
  private readonly baseFelt: THREE.Color | null
  private readonly baseLights: Array<{ light: THREE.Light; color: THREE.Color; intensity: number }>
  private readonly baseChips: Array<{ material: THREE.MeshStandardMaterial; color: THREE.Color; emissive: THREE.Color }>
  private companionHidden: THREE.Object3D[] = []
  private heroId: string | null = null
  /** 0..1 how hard the hero is tripping right now (fades in and drains out). */
  private tripLevel = 0
  private heroTripStartedAt: number | null = null
  private heroTripEndedAt: number | null = null
  private heroBlackoutAt: number | null = null
  private heroWokeAt: number | null = null
  private appliedFovDelta = 0
  private levelAtEnd = 0

  private scenePatched = false
  reducedMotion = false

  constructor(options: FunFxOptions) {
    this.options = options
    this.textures = { spiral: spiralTexture(), aura: auraTexture(), star: starTexture(), cat: catTexture() }
    this.spiralMaterial = new THREE.MeshBasicMaterial({ map: this.textures.spiral, transparent: true, depthWrite: false })
    this.shadesMaterial = new THREE.MeshStandardMaterial({ color: '#0b0b12', roughness: 0.15, metalness: 0.6 })
    this.materials.push(this.spiralMaterial, this.shadesMaterial)

    const catMaterial = new THREE.SpriteMaterial({ map: this.textures.cat, transparent: true, depthWrite: false })
    this.materials.push(catMaterial)
    this.cat = new THREE.Sprite(catMaterial)
    this.cat.scale.set(2.6, 2.6, 1)
    this.cat.visible = false
    options.scene.add(this.cat)

    this.baseFelt = options.feltMaterial ? options.feltMaterial.color.clone() : null
    this.baseLights = options.lights.map(light => ({ light, color: light.color.clone(), intensity: light.intensity }))
    this.baseChips = options.chipMaterials
      .filter((material): material is THREE.MeshStandardMaterial => (material as THREE.MeshStandardMaterial).isMeshStandardMaterial === true)
      .map(material => ({ material, color: material.color.clone(), emissive: material.emissive.clone() }))

    let tripPass: ShaderPass | null = null
    let afterimage: AfterimagePass | null = null
    const composer = options.postFx?.composer
    if (composer) {
      try {
        tripPass = new ShaderPass(TripShader)
        tripPass.enabled = false
        afterimage = new AfterimagePass(0.82)
        afterimage.enabled = false
        // After the bloom, before tone mapping / FXAA.
        const outputIndex = composer.passes.findIndex(pass => pass.constructor.name === 'OutputPass')
        const index = outputIndex > 0 ? outputIndex - 1 : Math.max(1, composer.passes.length - 2)
        composer.insertPass(afterimage, index)
        composer.insertPass(tripPass, index)
      } catch (error) {
        console.warn('Trip effects unavailable.', error)
        tripPass = null
        afterimage = null
      }
    }
    this.tripPass = tripPass
    this.afterimage = afterimage
  }

  /** True while the hero's trip visuals are on screen (drives a CSS fallback when post FX is off). */
  get heroTripLevel() {
    return this.tripLevel
  }

  /**
   * Once per frame, before the seats animate: read the view, track state
   * changes and hand each seat its pose inputs.
   */
  update(view: ThreeTableViewModel, seats: ReadonlyMap<string, FunSeat>, time: number) {
    const seen = new Set<string>()
    for (const player of view.players) {
      seen.add(player.id)
      if (player.isHero) this.heroId = player.id
      const drinks = player.drinks
      const entry = this.tracked.get(player.id) ?? {
        passedOut: drinks.passedOut,
        blackoutAt: drinks.passedOut ? time - 10 : null,
        wokeAt: null,
        hungover: Boolean(drinks.hungover),
        tripping: Boolean(drinks.tripping),
        tripStartedAt: drinks.tripping ? time - CAPSULE_SECONDS - TRIP_FADE_IN : null,
        lastTripSeen: drinks.tripping ? time : Number.NEGATIVE_INFINITY,
        isHero: player.isHero,
        props: null,
      }
      entry.isHero = player.isHero
      if (drinks.passedOut && !entry.passedOut) {
        entry.blackoutAt = time
        entry.wokeAt = null
      } else if (!drinks.passedOut && entry.passedOut) {
        entry.wokeAt = time
      }
      entry.passedOut = drinks.passedOut
      entry.hungover = Boolean(drinks.hungover)
      if (drinks.tripping) {
        if (entry.tripStartedAt === null || time - entry.lastTripSeen > TRIP_GRACE) entry.tripStartedAt = time
        entry.lastTripSeen = time
      }
      // A view that drops the flag for a moment (hand transitions) doesn't end it.
      entry.tripping = Boolean(drinks.tripping) || time - entry.lastTripSeen <= TRIP_GRACE
      this.tracked.set(player.id, entry)

      if (player.isHero) {
        if (entry.passedOut && this.heroBlackoutAt !== entry.blackoutAt) this.heroBlackoutAt = entry.blackoutAt
        if (!entry.passedOut && entry.wokeAt !== null) this.heroWokeAt = entry.wokeAt
        if (entry.tripping) {
          this.heroTripStartedAt = entry.tripStartedAt
          this.heroTripEndedAt = null
        } else if (this.heroTripStartedAt !== null && this.heroTripEndedAt === null) {
          this.heroTripEndedAt = time
        }
      }

      const seat = seats.get(player.id)
      if (seat) {
        const dazed = entry.wokeAt !== null && !entry.passedOut && time - entry.wokeAt < DAZED_SECONDS
          ? time - entry.wokeAt
          : null
        seat.funPose = {
          blackoutElapsed: entry.passedOut && entry.blackoutAt !== null ? time - entry.blackoutAt : null,
          dazedElapsed: dazed,
          hungover: entry.hungover && !entry.passedOut,
          tripping: entry.tripping && entry.tripStartedAt !== null && time - entry.tripStartedAt > CAPSULE_SECONDS * 0.6,
        }
      }
    }
    for (const [playerId, entry] of Array.from(this.tracked.entries())) {
      if (!seen.has(playerId)) {
        this.disposeProps(entry.props)
        this.tracked.delete(playerId)
      }
    }
  }

  /** After the seats animate (bones are posed): props, balloon heads, the trip scene. */
  afterSeats(view: ThreeTableViewModel, seats: ReadonlyMap<string, FunSeat>, time: number, delta: number) {
    const motion = this.reducedMotion ? 0 : 1
    this.updateHeroTripLevel(time, delta)
    const heroTrip = this.tripLevel

    for (const [playerId, entry] of this.tracked) {
      const seat = seats.get(playerId)
      if (!seat || entry.isHero) {
        if (entry.props) {
          this.disposeProps(entry.props)
          entry.props = null
        }
        continue
      }
      const tripping = entry.tripping && entry.tripStartedAt !== null
      const dazed = entry.wokeAt !== null && time - entry.wokeAt < DAZED_SECONDS + 0.6
      const blackStars = entry.passedOut && entry.blackoutAt !== null && time - entry.blackoutAt > BONK_AT + 0.2
      const needProps = tripping || dazed || blackStars || entry.hungover || heroTrip > 0.01
      if (!needProps) {
        if (entry.props) {
          this.disposeProps(entry.props)
          entry.props = null
        }
        this.resetHead(seat)
        continue
      }
      const props = entry.props ?? (entry.props = this.createProps(seat))
      const headNode = props.headNode

      // Where the head is, for the aura and the stars.
      if (headNode) headNode.getWorldPosition(worldA)
      else seat.root.getWorldPosition(worldA).add(worldB.set(0, 1.5, 0))

      // Rainbow aura behind the tripping player (everyone else sees it).
      const tripFade = tripping ? Math.min(1, (time - entry.tripStartedAt! - CAPSULE_SECONDS * 0.5) / 1.5) : 0
      props.aura.visible = tripFade > 0
      if (props.aura.visible) {
        props.aura.position.copy(worldA).add(worldB.set(0, -0.35, 0))
        const breathe = 1 + Math.sin(time * 2.1) * 0.08 * motion
        props.aura.scale.set(2.1 * breathe, 2.4 * breathe, 1)
        const material = props.aura.material as THREE.SpriteMaterial
        material.opacity = 0.75 * tripFade
        material.rotation = time * 0.6 * motion
        material.color.setHSL((time * 0.15) % 1, 0.6, 0.72)
      }

      // Spiral eyes: on the tripper for everyone, and on everyone for the tripper.
      const spirals = (tripping && tripFade > 0.3) || heroTrip > 0.25
      for (const spiral of props.spirals) {
        spiral.visible = spirals
        spiral.rotation.z = -time * 5 * motion
      }
      if (props.shades) props.shades.visible = entry.hungover && !entry.passedOut

      // Cartoon stars circling a bonked / dazed head.
      const starsOn = blackStars || dazed
      props.stars.forEach((star, index) => {
        star.visible = starsOn
        if (!starsOn) return
        const angle = time * 3.2 * (motion || 0.2) + (index / props.stars.length) * Math.PI * 2
        star.position.set(
          worldA.x + Math.cos(angle) * 0.28,
          worldA.y + 0.24 + Math.sin(angle * 2) * 0.03,
          worldA.z + Math.sin(angle) * 0.28
        )
      })

      // Balloon heads, only in the tripper's own eyes.
      const headBone = seat.avatar?.bones.get('Head') ?? null
      const balloon = heroTrip > 0 ? 1 + heroTrip * (0.45 + 0.18 * Math.sin(time * 1.3 + seat.root.id) * motion) : 1
      if (headBone) headBone.scale.setScalar(balloon)
      else seat.head.scale.setScalar(balloon)

      this.updateCapsule(props, seat, entry, time)
    }

    this.updateTripScene(view, time, motion)
  }

  /**
   * Camera moves: the hero's head hitting the table during a blackout, and
   * the slow room roll plus breathing lens while tripping. Call after lookAt.
   */
  applyCamera(camera: THREE.PerspectiveCamera, time: number) {
    // Undo last frame's lens change so the base FOV (set on resize) is kept.
    if (this.appliedFovDelta !== 0) {
      camera.fov -= this.appliedFovDelta
      this.appliedFovDelta = 0
    }
    const motion = this.reducedMotion ? 0 : 1

    // Blackout: head down onto the table with a bonk, then back up.
    let pitch = 0
    if (this.heroBlackoutAt !== null) {
      const e = time - this.heroBlackoutAt
      if (e >= 0 && e < BLACK_UNTIL + RISE_SECONDS) {
        const down = smooth((e - BONK_AT) / BONK_DOWN)
        const bounce = e > BONK_AT + BONK_DOWN ? Math.exp(-(e - BONK_AT - BONK_DOWN) * 9) * Math.sin((e - BONK_AT - BONK_DOWN) * 38) : 0
        const rise = smooth((e - BLACK_UNTIL) / RISE_SECONDS)
        pitch = (0.62 * down - 0.05 * bounce * motion) * (1 - rise)
      } else if (e >= BLACK_UNTIL + RISE_SECONDS) {
        this.heroBlackoutAt = null
      }
    }
    if (pitch !== 0) camera.rotateX(-pitch)

    const trip = this.tripLevel
    if (trip > 0 && motion > 0 && this.heroTripStartedAt !== null) {
      const elapsed = time - this.heroTripStartedAt
      // The room slowly rolls upside down and back, once, ~40s in.
      const rollU = (elapsed - 40) / 26
      const roll = rollU > 0 && rollU < 1 ? Math.PI * (1 - Math.cos(rollU * Math.PI * 2)) / 2 : 0
      const sway = Math.sin(elapsed * 0.45) * 0.07
      camera.rotateZ((roll + sway) * trip)
      const lens = (Math.sin(elapsed * 0.85) * 6 + Math.sin(elapsed * 0.31) * 3) * trip
      camera.fov += lens
      this.appliedFovDelta = lens
    }
    if (this.appliedFovDelta !== 0 || trip > 0) camera.updateProjectionMatrix()
  }

  /** Post-processing uniforms. Call just before the composer renders. */
  beforeRender(time: number, width: number, height: number) {
    const trip = this.tripLevel
    const motion = this.reducedMotion ? 0 : 1
    if (this.tripPass) {
      this.tripPass.enabled = trip > 0.001
      const uniforms = this.tripPass.material.uniforms
      if (this.tripPass.enabled && this.heroTripStartedAt !== null) {
        const elapsed = time - this.heroTripStartedAt
        // Bursts come in waves: every ~13s a few seconds of kaleidoscope.
        const wave = Math.max(0, Math.sin((elapsed - 6) * (Math.PI * 2 / 13)))
        const burst = Math.pow(wave, 3)
        uniforms.time!.value = motion ? time : 0
        uniforms.strength!.value = this.reducedMotion ? trip * 0.35 : trip
        uniforms.kaleido!.value = motion ? burst * trip * 0.7 : 0
        uniforms.warp!.value = motion ? trip * (0.8 + 0.6 * Math.max(0, Math.sin(elapsed * 0.4))) : 0
        uniforms.aspect!.value = width / Math.max(1, height)
      }
    }
    if (this.afterimage) {
      this.afterimage.enabled = trip > 0.05 && !this.reducedMotion
      const damp = (this.afterimage as unknown as { uniforms?: Record<string, THREE.IUniform> }).uniforms?.damp
      if (damp) damp.value = 0.62 + 0.2 * trip
    }
  }

  dispose() {
    for (const entry of this.tracked.values()) this.disposeProps(entry.props)
    this.tracked.clear()
    this.restoreScene()
    this.cat.removeFromParent()
    Object.values(this.textures).forEach(texture => texture.dispose())
    this.materials.forEach(material => material.dispose())
    this.geometries.forEach(geometry => geometry.dispose())
    this.tripPass?.dispose?.()
    this.afterimage?.dispose?.()
  }

  // -------------------------------------------------------------------------

  private updateHeroTripLevel(time: number, delta: number) {
    const heroTracked = this.heroId ? this.tracked.get(this.heroId) : undefined
    if (heroTracked?.tripping && this.heroTripStartedAt !== null) {
      // The hero sees the colours start melting right away.
      const target = smooth((time - this.heroTripStartedAt) / TRIP_FADE_IN)
      this.tripLevel += (target - this.tripLevel) * Math.min(1, delta * 6)
      this.levelAtEnd = this.tripLevel
      return
    }
    if (this.heroTripEndedAt !== null) {
      // The subtle end: colours drain back to normal over ~5s.
      const drained = (time - this.heroTripEndedAt) / TRIP_FADE_OUT
      if (drained < 1) {
        this.tripLevel = this.levelAtEnd * (1 - smooth(drained))
        return
      }
      this.heroTripEndedAt = null
      this.heroTripStartedAt = null
    }
    this.tripLevel = 0
  }

  private updateTripScene(view: ThreeTableViewModel, time: number, motion: number) {
    const trip = this.tripLevel
    if (trip <= 0) {
      if (this.scenePatched) this.restoreScene()
      return
    }
    this.scenePatched = true
    const hue = (time * 0.07) % 1

    // The felt melts purple -> orange -> teal.
    if (this.options.feltMaterial && this.baseFelt) {
      const cycle = (Math.sin(time * 0.35 * (motion || 0.2)) + 1) / 2
      const purple = scratchColor.set('#7b2cff')
      const orange = new THREE.Color('#ff7a1a')
      const teal = new THREE.Color('#12d6c4')
      const target = cycle < 0.5 ? purple.lerp(orange, cycle * 2) : orange.lerp(teal, (cycle - 0.5) * 2)
      this.options.feltMaterial.color.copy(this.baseFelt).lerp(target, 0.75 * trip)
    }
    // The lights pulse through the rainbow.
    this.baseLights.forEach(({ light, color, intensity }, index) => {
      const pulse = 1 + Math.sin(time * 2.2 + index * 1.3) * 0.35 * motion
      light.color.copy(color).lerp(scratchColor.setHSL((hue + index * 0.17) % 1, 0.9, 0.6), 0.7 * trip)
      light.intensity = intensity * (1 + (pulse - 1) * trip)
    })
    // Chips turn to candy: pastel, glowing, slowly shifting.
    this.baseChips.forEach(({ material, color, emissive }, index) => {
      const candy = scratchColor.setHSL((hue * 2 + index * 0.13) % 1, 0.85, 0.72)
      material.color.copy(color).lerp(candy, 0.85 * trip)
      material.emissive.copy(emissive).lerp(candy, 0.35 * trip)
    })

    // Lady Luck becomes a giant cat.
    const companion = this.options.companionGroup
    const ladyLuckHere = Boolean(companion && companion.visible && view.companion)
    if (companion && ladyLuckHere && trip > 0.3) {
      if (this.companionHidden.length === 0) {
        companion.children.forEach(child => {
          if (child.visible) {
            child.visible = false
            this.companionHidden.push(child)
          }
        })
      }
      companion.getWorldPosition(worldA)
      this.cat.visible = true
      this.cat.position.set(worldA.x, worldA.y + 1.5 + Math.sin(time * 1.4) * 0.08 * motion, worldA.z)
      const grow = 2.4 + Math.sin(time * 0.9) * 0.2 * motion
      this.cat.scale.set(grow, grow, 1)
    } else {
      this.showCompanion()
      this.cat.visible = false
    }
  }

  private showCompanion() {
    this.companionHidden.forEach(child => { child.visible = true })
    this.companionHidden = []
  }

  private restoreScene() {
    this.scenePatched = false
    if (this.options.feltMaterial && this.baseFelt) this.options.feltMaterial.color.copy(this.baseFelt)
    this.baseLights.forEach(({ light, color, intensity }) => {
      light.color.copy(color)
      light.intensity = intensity
    })
    this.baseChips.forEach(({ material, color, emissive }) => {
      material.color.copy(color)
      material.emissive.copy(emissive)
    })
    this.showCompanion()
    this.cat.visible = false
  }

  private resetHead(seat: FunSeat) {
    const headBone = seat.avatar?.bones.get('Head')
    if (headBone && headBone.scale.x !== 1) headBone.scale.setScalar(1)
    if (seat.head.scale.x !== 1) seat.head.scale.setScalar(1)
  }

  private createProps(seat: FunSeat): SeatProps {
    const group = new THREE.Group()
    group.name = 'fun-props'
    this.options.scene.add(group)

    const auraMaterial = new THREE.SpriteMaterial({
      map: this.textures.aura,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.materials.push(auraMaterial)
    const aura = new THREE.Sprite(auraMaterial)
    aura.visible = false
    aura.renderOrder = 2
    group.add(aura)

    const starMaterial = new THREE.SpriteMaterial({ map: this.textures.star, transparent: true, depthWrite: false })
    this.materials.push(starMaterial)
    const stars = Array.from({ length: 4 }, () => {
      const star = new THREE.Sprite(starMaterial)
      star.scale.set(0.17, 0.17, 1)
      star.visible = false
      group.add(star)
      return star
    })

    // Spirals over each eye (rigged faces) or on the fallback head.
    const headBone = seat.avatar?.bones.get('Head') ?? null
    const headNode: THREE.Object3D | null = headBone ?? seat.head
    const spirals: THREE.Mesh[] = []
    const disc = new THREE.CircleGeometry(1, 24)
    this.geometries.push(disc)
    if (seat.face && seat.face.eyes.length > 0) {
      for (const eye of seat.face.eyes) {
        const spiral = new THREE.Mesh(disc, this.spiralMaterial)
        spiral.position.set(0, 0, 0.62)
        spiral.scale.setScalar(0.62)
        spiral.visible = false
        spiral.renderOrder = 3
        eye.root.add(spiral)
        spirals.push(spiral)
      }
    } else if (headNode) {
      for (const side of [-1, 1]) {
        const spiral = new THREE.Mesh(disc, this.spiralMaterial)
        spiral.position.set(side * 0.07, 0.03, -0.17)
        spiral.rotation.y = Math.PI
        spiral.scale.setScalar(0.045)
        spiral.visible = false
        headNode.add(spiral)
        spirals.push(spiral)
      }
    }

    // Hangover shades across both eyes.
    let shades: THREE.Group | null = null
    if (seat.face && seat.face.eyes.length >= 2 && headBone) {
      const [a, b] = seat.face.eyes
      const mid = a!.root.position.clone().lerp(b!.root.position, 0.5)
      const span = a!.root.position.distanceTo(b!.root.position)
      const radius = a!.radius
      shades = new THREE.Group()
      shades.position.copy(mid)
      shades.quaternion.copy(a!.root.quaternion)
      const lens = new THREE.CapsuleGeometry(radius * 1.25, radius * 0.6, 4, 12)
      lens.rotateZ(Math.PI / 2)
      lens.scale(1, 1, 0.35)
      const bridge = new THREE.BoxGeometry(span * 0.5, radius * 0.25, radius * 0.25)
      this.geometries.push(lens, bridge)
      for (const eye of [a!, b!]) {
        const mesh = new THREE.Mesh(lens, this.shadesMaterial)
        mesh.position.copy(eye.root.position).sub(mid).setZ(radius * 0.95)
        shades.add(mesh)
      }
      const bridgeMesh = new THREE.Mesh(bridge, this.shadesMaterial)
      bridgeMesh.position.set(0, radius * 0.25, radius * 0.95)
      shades.add(bridgeMesh)
      shades.visible = false
      headBone.add(shades)
    }

    return { group, aura, stars, spirals, shades, capsule: null, headNode }
  }

  /** The pill plops into their water and fizzes, right as the trip kicks in. */
  private updateCapsule(props: SeatProps, seat: FunSeat, entry: Tracked, time: number) {
    const since = entry.tripping && entry.tripStartedAt !== null ? time - entry.tripStartedAt : Infinity
    if (since > CAPSULE_SECONDS || this.reducedMotion) {
      if (props.capsule) {
        props.capsule.group.removeFromParent()
        disposeDrinkProp(props.capsule.glass)
        props.capsule.bubbles.geometry.dispose()
        ;(props.capsule.bubbles.material as THREE.Material).dispose()
        props.capsule = null
      }
      return
    }
    if (!props.capsule) {
      const group = new THREE.Group()
      const glass = createDrinkProp('water')
      // Drink props are created hidden (they normally wait for a hand to lift them).
      glass.group.visible = true
      group.add(glass.group)
      const capsuleGeometry = new THREE.CapsuleGeometry(0.018, 0.035, 4, 10)
      this.geometries.push(capsuleGeometry)
      const top = new THREE.MeshToonMaterial({ color: '#ff3d7f' })
      const bottom = new THREE.MeshToonMaterial({ color: '#ffffff' })
      this.materials.push(top, bottom)
      const pill = new THREE.Group()
      const upper = new THREE.Mesh(capsuleGeometry, top)
      upper.scale.set(1, 0.55, 1)
      upper.position.y = 0.012
      const lower = new THREE.Mesh(capsuleGeometry, bottom)
      lower.scale.set(1, 0.55, 1)
      lower.position.y = -0.012
      pill.add(upper, lower)
      pill.name = 'pill'
      pill.rotation.z = 0.9
      group.add(pill)
      const count = 24
      const positions = new Float32Array(count * 3)
      const bubbleGeometry = new THREE.BufferGeometry()
      bubbleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const bubbles = new THREE.Points(bubbleGeometry, new THREE.PointsMaterial({ color: '#e8fbff', size: 0.012, transparent: true, depthWrite: false }))
      group.add(bubbles)
      seat.root.localToWorld(worldA.set(...seat.anchors.drinkRest))
      group.position.copy(worldA)
      group.scale.setScalar(1.4)
      this.options.scene.add(group)
      props.capsule = { group, glass, bubbles, startedAt: time }
    }
    const capsule = props.capsule
    // The glass grows in on the felt and shrinks away at the end, never pops.
    const grow = smooth(since / 0.22) * (1 - smooth((since - (CAPSULE_SECONDS - 0.3)) / 0.3))
    capsule.group.scale.setScalar(1.4 * Math.max(0.001, grow))
    const pill = capsule.group.getObjectByName('pill')
    const drop = Math.min(1, since / 0.55)
    if (pill) {
      pill.position.set(0, 0.42 - 0.34 * drop * drop, 0)
      pill.rotation.z = 0.9 + since * 6
      pill.visible = since < 1.2
      pill.scale.setScalar(since < 0.55 ? 1 : Math.max(0.2, 1 - (since - 0.55)))
    }
    const positions = capsule.bubbles.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let index = 0; index < positions.count; index += 1) {
      const local = Math.max(0, since - 0.5 - (index % 8) * 0.08)
      const rise = (local * 0.35) % 0.22
      positions.setXYZ(index, Math.sin(index * 12.9) * 0.03, 0.06 + rise, Math.cos(index * 7.3) * 0.03)
    }
    positions.needsUpdate = true
    ;(capsule.bubbles.material as THREE.PointsMaterial).opacity = since > 0.5 ? 0.9 * (1 - smooth((since - 1.3) / 0.6)) : 0
  }

  private disposeProps(props: SeatProps | null) {
    if (!props) return
    props.group.removeFromParent()
    props.spirals.forEach(spiral => spiral.removeFromParent())
    props.shades?.removeFromParent()
    if (props.capsule) {
      props.capsule.group.removeFromParent()
      disposeDrinkProp(props.capsule.glass)
      props.capsule.bubbles.geometry.dispose()
      ;(props.capsule.bubbles.material as THREE.Material).dispose()
    }
  }
}

function smooth(value: number) {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped * clamped * (3 - 2 * clamped)
}
