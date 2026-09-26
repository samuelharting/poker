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
}

/**
 * Key/fill/rim stage lighting: one warm soft-shadow spot over the felt, a dim
 * sky fill, two cool rims behind the far seats to cut characters out of the
 * dark room, and a green bounce off the felt onto faces.
 */
export function createStageLights(scene: THREE.Scene): StageLights {
  const fill = new THREE.HemisphereLight('#b9d8ff', '#1a0f08', 0.34)
  scene.add(fill)

  const key = new THREE.SpotLight('#ffe2b0', 105, 30, 0.6, 0.7, 1.6)
  key.position.set(0.6, 11, 2.4)
  key.target.position.set(0, 0.2, -0.2)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.bias = -0.00012
  key.shadow.normalBias = 0.03
  key.shadow.radius = 6
  key.shadow.camera.near = 4
  key.shadow.camera.far = 22
  scene.add(key, key.target)

  const rimLeft = new THREE.SpotLight('#7fb6ff', 60, 22, 0.7, 0.8, 1.5)
  rimLeft.position.set(-8, 6.2, -8.5)
  rimLeft.target.position.set(-1.5, 1.2, 0)
  scene.add(rimLeft, rimLeft.target)

  const rimRight = new THREE.SpotLight('#ffb27f', 52, 22, 0.7, 0.8, 1.5)
  rimRight.position.set(8, 6.2, -8.5)
  rimRight.target.position.set(1.5, 1.2, 0)
  scene.add(rimRight, rimRight.target)

  const bounce = new THREE.PointLight('#2fbf8a', 6, 9, 1.6)
  bounce.position.set(0, 1.2, 0)
  scene.add(bounce)

  const accent = new THREE.PointLight('#ffcf73', 0, 12, 1.4)
  accent.position.set(0, 3.2, 0)
  scene.add(accent)

  return { key, fill, rimLeft, rimRight, bounce, accent }
}

const VignetteShader = {
  name: 'PokerVignetteShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    strength: { value: 0.42 },
    softness: { value: 0.62 },
    warmth: { value: 0.06 },
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
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 centered = vUv - vec2(0.5, 0.52);
      centered.x *= 1.15;
      float distanceFromCenter = length(centered);
      float vignette = smoothstep(0.78, 0.78 - softness, distanceFromCenter);
      color.rgb *= mix(1.0 - strength, 1.0, vignette);
      color.rgb += vec3(warmth, warmth * 0.55, 0.0) * vignette * 0.12;
      gl_FragColor = color;
    }
  `,
}

export interface PostFx {
  composer: EffectComposer
  bloom: UnrealBloomPass
  fxaa: ShaderPass
  setSize: (width: number, height: number, pixelRatio: number) => void
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
  composer.addPass(bloom)
  composer.addPass(new ShaderPass(VignetteShader))
  composer.addPass(new OutputPass())
  const fxaa = new ShaderPass(FXAAShader)
  composer.addPass(fxaa)

  return {
    composer,
    bloom,
    fxaa,
    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio)
      composer.setSize(width, height)
      const resolution = fxaa.material.uniforms.resolution?.value as THREE.Vector2 | undefined
      resolution?.set(1 / (width * pixelRatio), 1 / (height * pixelRatio))
    },
    dispose() {
      composer.dispose()
      bloom.dispose()
    },
  }
}

/**
 * Watches frame time and reports when the device can't afford post effects.
 * Uses a rolling average so a single hitch (GC, tab switch) never downgrades.
 */
export class FrameBudget {
  private samples: number[] = []
  private readonly limitMs: number
  private readonly window: number
  degraded = false

  constructor(limitMs = 22, window = 90) {
    this.limitMs = limitMs
    this.window = window
  }

  push(deltaSeconds: number) {
    if (this.degraded) return false
    this.samples.push(deltaSeconds * 1000)
    if (this.samples.length < this.window) return false
    const average = this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length
    this.samples = []
    if (average > this.limitMs) {
      this.degraded = true
      return true
    }
    return false
  }
}
