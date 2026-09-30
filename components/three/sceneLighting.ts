import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js'

/**
 * Image-based lighting from three's built-in RoomEnvironment. It gives brass,
 * leather and cards something soft to reflect without shipping an HDRI.
 */
export function applyEnvironmentLighting(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const pmrem = new THREE.PMREMGenerator(renderer)
  const environment = new RoomEnvironment()
  const target = pmrem.fromScene(environment, 0.035)
  scene.environment = target.texture
  scene.environmentIntensity = 0.3
  environment.traverse(object => {
    const mesh = object as THREE.Mesh
    mesh.geometry?.dispose()
    const material = mesh.material as THREE.Material | undefined
    material?.dispose()
  })
  pmrem.dispose()
  return target
}

export interface StageLights {
  key: THREE.SpotLight
  fill: THREE.HemisphereLight
  rimLeft: THREE.SpotLight
  rimRight: THREE.SpotLight
  bounce: THREE.PointLight
  /** Warm pool that swells on a winner or an all-in. */
  accent: THREE.PointLight
  /** Soft warm fill from behind the camera so the near rail and hands never go muddy. */
  front: THREE.PointLight
}

/**
 * Key/fill/rim stage lighting: one warm soft-shadow spot over the felt, a dim
 * sky fill, two cool rims behind the far seats to cut characters out of the
 * dark room, and a green bounce off the felt onto faces.
 */
export function createStageLights(scene: THREE.Scene): StageLights {
  const fill = new THREE.HemisphereLight('#b9d8ff', '#1a0f08', 0.34)
  scene.add(fill)

  // Hot enough to pool light on the felt, not so hot that chips, cards and
  // brass clip to white under it (the front fill lifts the near side instead).
  const key = new THREE.SpotLight('#ffe2b0', 88, 30, 0.6, 0.7, 1.6)
  key.position.set(0.6, 11, 2.4)
  key.target.position.set(0, 0.2, -0.2)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.bias = -0.00012
  key.shadow.normalBias = 0.03
  key.shadow.radius = 6
  key.shadow.camera.near = 4
  key.shadow.camera.far = 22
  scene.add(key, key.target)

  const rimLeft = new THREE.SpotLight('#7fb6ff', 74, 22, 0.7, 0.8, 1.5)
  rimLeft.position.set(-8, 6.2, -8.5)
  rimLeft.target.position.set(-1.5, 1.2, 0)
  scene.add(rimLeft, rimLeft.target)

  const rimRight = new THREE.SpotLight('#ffb27f', 64, 22, 0.7, 0.8, 1.5)
  rimRight.position.set(8, 6.2, -8.5)
  rimRight.target.position.set(1.5, 1.2, 0)
  scene.add(rimRight, rimRight.target)

  const bounce = new THREE.PointLight('#2fbf8a', 6, 9, 1.6)
  bounce.position.set(0, 1.2, 0)
  scene.add(bounce)

  const accent = new THREE.PointLight('#ffcf73', 0, 12, 1.4)
  accent.position.set(0, 3.2, 0)
  scene.add(accent)

  const front = new THREE.PointLight('#ffd9b0', 8, 11, 1.5)
  front.position.set(0, 3.4, 6.2)
  scene.add(front)

  return { key, fill, rimLeft, rimRight, bounce, accent, front }
}

const VignetteShader = {
  name: 'PokerVignetteShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    strength: { value: 0.32 },
    softness: { value: 0.62 },
    warmth: { value: 0.06 },
    time: { value: 0 },
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
    uniform float strength;
    uniform float softness;
    uniform float warmth;
    uniform float time;
    varying vec2 vUv;
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec2 centered = vUv - vec2(0.5, 0.52);
      centered.x *= 1.15;
      float distanceFromCenter = length(centered);
      vec4 color = texture2D(tDiffuse, vUv);
      float vignette = smoothstep(0.78, 0.78 - softness, distanceFromCenter);
      color.rgb *= mix(1.0 - strength, 1.0, vignette);
      color.rgb += vec3(warmth, warmth * 0.55, 0.0) * vignette * 0.12;
      // Split-tone grade: cool, slightly teal shadows and warm highlights, like a lit set.
      float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      color.rgb = mix(color.rgb, color.rgb * vec3(1.05, 1.0, 0.93), smoothstep(0.25, 1.1, luma));
      color.rgb += vec3(-0.002, 0.002, 0.004) * (1.0 - smoothstep(0.0, 0.25, luma));
      // Fine film grain (also dithers the dark gradients): strongest in the mids.
      float grain = hash(gl_FragCoord.xy + fract(time * 7.13) * 91.7) - 0.5;
      color.rgb *= 1.0 + grain * 0.045 * (0.5 + smoothstep(0.02, 0.4, luma));
      gl_FragColor = color;
    }
  `,
}

export interface PostFx {
  composer: EffectComposer
  bloom: UnrealBloomPass
  fxaa: ShaderPass
  setSize: (width: number, height: number, pixelRatio: number) => void
  /** Full-resolution bloom (false) or a half-resolution bloom chain (true). */
  setReducedBloom: (reduced: boolean) => void
  /**
   * Top quality tier only: multisample the composer's targets (true geometric
   * antialiasing on card, chip and rail edges) and drop the FXAA blur. Lower
   * tiers keep single-sample targets + FXAA.
   */
  setMultisample: (samples: number) => void
  dispose: () => void
}

/**
 * Bloom only catches genuinely bright pixels (brass glints, winner glow,
 * all-in ember) because the threshold sits above the lit felt and faces.
 */
export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera
): PostFx {
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.24, 0.32, 0.97)
  // One NaN/Inf pixel from any shader would otherwise be blurred by the bloom
  // mips across the whole frame and composited back: the table goes black until
  // a reload. Scrub bad texels where the bloom reads the scene.
  const highPass = bloom.materialHighPassFilter
  highPass.fragmentShader = highPass.fragmentShader.replace(
    'vec4 texel = texture2D( tDiffuse, vUv );',
    'vec4 texel = texture2D( tDiffuse, vUv );\n\t\t\tif ( any( isnan( texel ) ) || any( isinf( texel ) ) ) texel = vec4( 0.0 );'
  )
  highPass.needsUpdate = true
  composer.addPass(bloom)
  const vignettePass = new ShaderPass(VignetteShader)
  // Drives the grain: the pass owns its uniforms, so stamp the clock as it renders.
  const renderVignette = vignettePass.render.bind(vignettePass)
  vignettePass.render = (...args: Parameters<ShaderPass['render']>) => {
    vignettePass.uniforms.time!.value = (performance.now() / 1000) % 1000
    renderVignette(...args)
  }
  composer.addPass(vignettePass)
  composer.addPass(new OutputPass())
  const fxaa = new ShaderPass(FXAAShader)
  composer.addPass(fxaa)
  const maxSamples = renderer.capabilities.maxSamples ?? 0

  let reducedBloom = false
  const size = { width: 1, height: 1, pixelRatio: 1 }
  const applyBloomSize = () => {
    const scale = reducedBloom ? 0.5 : 1
    bloom.setSize(
      Math.max(1, Math.round(size.width * size.pixelRatio * scale)),
      Math.max(1, Math.round(size.height * size.pixelRatio * scale))
    )
  }

  return {
    composer,
    bloom,
    fxaa,
    setSize(width, height, pixelRatio) {
      size.width = width
      size.height = height
      size.pixelRatio = pixelRatio
      composer.setPixelRatio(pixelRatio)
      composer.setSize(width, height)
      applyBloomSize()
      const resolution = fxaa.material.uniforms.resolution?.value as THREE.Vector2 | undefined
      resolution?.set(1 / (width * pixelRatio), 1 / (height * pixelRatio))
    },
    setReducedBloom(reduced) {
      if (reduced === reducedBloom) return
      reducedBloom = reduced
      applyBloomSize()
    },
    setMultisample(samples) {
      const wanted = Math.max(0, Math.min(samples, maxSamples))
      if (composer.renderTarget1.samples === wanted && composer.renderTarget2.samples === wanted) return
      for (const target of [composer.renderTarget1, composer.renderTarget2]) {
        target.samples = wanted
        // Reallocated with the new sample count on next use.
        target.dispose()
      }
      fxaa.enabled = wanted === 0
    },
    dispose() {
      composer.dispose()
      bloom.dispose()
    },
  }
}

/** 0 = full post (bloom, vignette, FXAA); 1 = half-res bloom, lower pixel ratio; 2 = no post. */
export type RenderQuality = 0 | 1 | 2

/**
 * Adaptive quality: watches steady-state frame times and steps render quality
 * down when the device can't hold ~60fps, and back up when it can.
 *
 * - The first seconds after start (and after any avatar load, resume or
 *   resize, see `settle`) are ignored: shader compiles and model uploads are
 *   one-off stalls, not the device's steady cost.
 * - Single hitches (>250ms: GC, tab switch, a React commit) never count.
 * - It uses the window median, so a few slow frames can't trigger a change.
 * - It recovers: sustained headroom steps quality back up, with a longer
 *   hold-off whenever an upgrade had to be undone (no oscillation).
 */
export class FrameBudget {
  level: RenderQuality = 0
  private samples: number[] = []
  private settleUntil: number
  private cooldownUntil = 0
  private upgradeBlockedUntil = 0
  private lastUpgradeAt = Number.NEGATIVE_INFINITY
  private fastWindows = 0
  private slowWindows = 0
  private readonly window: number

  constructor(startTime = 0, private readonly warmupSeconds = 5, window = 120) {
    this.window = window
    this.settleUntil = startTime + warmupSeconds
  }

  /** Ignore frame times until `time + seconds` (loads, resumes, resizes). */
  settle(time: number, seconds = 2.5) {
    this.settleUntil = Math.max(this.settleUntil, time + seconds)
    this.samples.length = 0
  }

  /** @returns the new quality level when it changes, otherwise null. */
  push(deltaSeconds: number, time: number): RenderQuality | null {
    if (time < this.settleUntil || time < this.cooldownUntil) return null
    const ms = deltaSeconds * 1000
    if (ms > 250) return null
    this.samples.push(ms)
    if (this.samples.length < this.window) return null
    const sorted = this.samples.slice().sort((a, b) => a - b)
    this.samples.length = 0
    const median = sorted[sorted.length >> 1]!
    const p80 = sorted[Math.floor(sorted.length * 0.8)]!
    // One slow window (a GC, a model load, a busy tab) is not a slow machine.
    this.slowWindows = median > 22 ? this.slowWindows + 1 : 0
    if (this.slowWindows >= 2 && this.level < 2) {
      this.slowWindows = 0
      // Every quality change reallocates the render targets (a visible hitch
      // of its own), so settle on a level: after any step down, stay there for
      // a while, and much longer if the last step up did not hold.
      this.upgradeBlockedUntil = Math.max(
        this.upgradeBlockedUntil,
        time + (time - this.lastUpgradeAt < 20 ? 180 : 45)
      )
      this.fastWindows = 0
      this.cooldownUntil = time + 1.5
      this.level = (this.level + 1) as RenderQuality
      return this.level
    }
    if (this.level > 0 && median < 17.5 && p80 < 18.5 && time >= this.upgradeBlockedUntil) {
      this.fastWindows += 1
      if (this.fastWindows >= 5) {
        this.fastWindows = 0
        this.cooldownUntil = time + 1.5
        this.lastUpgradeAt = time
        this.level = (this.level - 1) as RenderQuality
        return this.level
      }
    } else {
      this.fastWindows = 0
    }
    return null
  }
}
