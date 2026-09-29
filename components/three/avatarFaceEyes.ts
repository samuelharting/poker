import * as THREE from 'three'
import { createAvatarToonMaterial } from './avatarStyle'
import type { FaceIrisTone } from './avatarFacePersonality'

/**
 * Procedural eyes.
 *
 * Each eye is ONE small dome mesh with ONE toon material whose fragment shader
 * paints everything: the skin of the lids, the almond-shaped eye opening (upper
 * and lower lid curves that really close on a blink), lash line and lid crease,
 * a shaded sclera with vein tint, the iris (radial fibres, collarette, limbal
 * ring), a dilating pupil, a wet waterline, and a cornea catch-light. The gaze
 * is a uniform, so looking around costs nothing but a uniform write.
 *
 * Coordinates: the dome is a unit sphere whose +Z pole faces out of the face;
 * `q = p.xy * uQScale` is the position in eye-radius units (r).
 */

export interface EyeUniforms {
  /** Eye-local unit gaze direction (+Z is straight out of the face). */
  uGaze: { value: THREE.Vector3 }
  /** x = upper lid full amplitude, y = lower lid amplitude, z = half width, w = outer-corner tilt (r units). */
  uAper: { value: THREE.Vector4 }
  /** x = upper peak position 0..1 (from -x corner), y = lower peak, z = side (+1 eye on +x), w = crease strength. */
  uLid: { value: THREE.Vector4 }
  /** x = openness 0 closed..1 open (up to 1.3 wide), y = lash weight, z = lid shadow strength, w = dim (folded). */
  uState: { value: THREE.Vector4 }
  /** x = iris radius (rad), y = pupil radius (rad), z = limbal ring, w = wetness. */
  uIris: { value: THREE.Vector4 }
  /** Catch-light offset from the pupil in iris radii (xy) + redness (z) + inner-corner pink (w). */
  uLight: { value: THREE.Vector4 }
  uIrisA: { value: THREE.Color }
  uIrisB: { value: THREE.Color }
  uSclera: { value: THREE.Color }
  uLash: { value: THREE.Color }
  uQScale: { value: THREE.Vector2 }
}

export function createEyeUniforms(side: 1 | -1): EyeUniforms {
  return {
    uGaze: { value: new THREE.Vector3(0, 0, 1) },
    uAper: { value: new THREE.Vector4(0.3, 0.17, 0.5, 0.05) },
    uLid: { value: new THREE.Vector4(side > 0 ? 0.36 : 0.64, side > 0 ? 0.64 : 0.36, side, 1) },
    uState: { value: new THREE.Vector4(1, 1, 0.5, 1) },
    uIris: { value: new THREE.Vector4(0.44, 0.19, 0.6, 1) },
    uLight: { value: new THREE.Vector4(-0.32, 0.4, 0, 1) },
    uIrisA: { value: new THREE.Color('#4a2c17') },
    uIrisB: { value: new THREE.Color('#9a6a3a') },
    uSclera: { value: new THREE.Color('#f1ebe2') },
    uLash: { value: new THREE.Color('#1b100c') },
    uQScale: { value: new THREE.Vector2(0.74, 0.66) },
  }
}

export const IRIS_PALETTE: Record<FaceIrisTone, [string, string]> = {
  dark: ['#241209', '#5a341b'],
  brown: ['#4a2812', '#a5723c'],
  hazel: ['#4c3a14', '#b3963c'],
  green: ['#1f4a2b', '#7fae5a'],
  blue: ['#20456e', '#7fb2d8'],
  gray: ['#3a4650', '#a4b3bd'],
}

const VERTEX_PREFIX = `
varying vec3 vEyeP;
varying float vEyeFacing;
`

const FRAGMENT_PREFIX = `
varying vec3 vEyeP;
varying float vEyeFacing;
uniform vec3 uGaze;
uniform vec4 uAper;
uniform vec4 uLid;
uniform vec4 uState;
uniform vec4 uIris;
uniform vec4 uLight;
uniform vec3 uIrisA;
uniform vec3 uIrisB;
uniform vec3 uSclera;
uniform vec3 uLash;
uniform vec2 uQScale;
float eyeLidCurve(float x01, float peak) {
  float a = x01 < peak ? x01 / peak : (1.0 - x01) / (1.0 - peak);
  return sin(1.5707963 * clamp(a, 0.0, 1.0));
}
`

const FRAGMENT_BODY = `
{
  if (vEyeFacing < 0.3) discard;
  vec2 q = vEyeP.xy * uQScale;
  float side = uLid.z;
  float W = uAper.z;
  float x01 = clamp(q.x / (2.0 * W) + 0.5, 0.0, 1.0);
  float outerT = side > 0.0 ? x01 : 1.0 - x01;
  float tilt = uAper.w * q.x * side;
  float su = pow(eyeLidCurve(x01, uLid.x), 0.82);
  float sl = pow(eyeLidCurve(x01, uLid.y), 1.15);
  float lowerEdge = tilt - uAper.y * sl;
  float fullUpper = tilt + uAper.x * su;
  float upperEdge = lowerEdge + uState.x * (fullUpper - lowerEdge);
  float dUp = upperEdge - q.y;
  float dLo = q.y - lowerEdge;
  float px = max(fwidth(q.y) * 1.2, 1e-4);
  float inside = smoothstep(0.0, px, min(dUp, dLo)) * step(abs(q.x), W * 1.02);
  float edgeR = length(vEyeP.xy);
  // Lid skin fades out at grazing angles so the far eye never overhangs the face silhouette.
  if (inside < 0.5 && dot(normal, geometryViewDir) < 0.55) discard;
  // Only a ring of lid skin around the opening is drawn; beyond it the real face shows,
  // so there is no visible oval "patch" on the cheeks.
  float outside = max(max(-dUp, -dLo), abs(q.x) - W * 1.02);
  if (outside > 0.19) discard;

  // ---- skin part (lids) ----
  vec3 lid = outgoingLight;
  lid = mix(vec3(dot(lid, vec3(0.299, 0.587, 0.114))), lid, 0.88);
  float lashW = (0.018 + 0.03 * outerT) * uState.y * (1.0 + 0.7 * (1.0 - clamp(uState.x, 0.0, 1.0)));
  float inX = 1.0 - smoothstep(W * 0.98, W * 1.08, abs(q.x));
  float crease = (1.0 - smoothstep(0.0, 0.02, abs(q.y - (upperEdge + 0.075 + 0.11 * uAper.x)))) * uLid.w * smoothstep(0.25, 0.7, uState.x) * inX;
  lid *= 1.0 - 0.2 * crease;
  // Lid skin is a touch pinker and shaded near the lash line; the socket rim darkens.
  lid *= mix(vec3(1.0), vec3(1.0, 0.94, 0.93), (1.0 - smoothstep(0.0, 0.24, -dUp)) * step(0.0, -dUp) * inX);
  lid *= 1.0 - 0.13 * smoothstep(0.08, 0.19, outside);
  float lashUp = smoothstep(-lashW - px, -lashW, dUp) * (1.0 - smoothstep(0.0, px, dUp)) * step(0.0, dLo + lashW) * inX;
  float lashLo = smoothstep(-0.02 - px, -0.02, dLo) * (1.0 - smoothstep(0.0, px, dLo)) * step(0.0, dUp) * 0.32 * inX;
  lid = mix(lid, uLash * 0.9, clamp(lashUp + lashLo, 0.0, 1.0));

  // ---- eyeball part ----
  vec3 dir = normalize(vEyeP);
  float cosA = clamp(dot(dir, uGaze), -1.0, 1.0);
  float th = acos(cosA);
  vec2 off = dir.xy - uGaze.xy;
  float phi = atan(off.y, off.x);
  float rI = uIris.x;
  float rP = uIris.y;
  float t = clamp(th / rI, 0.0, 1.0);
  float irisMask = 1.0 - smoothstep(rI - 0.03, rI, th);
  vec3 irisCol = mix(uIrisB, uIrisA, smoothstep(0.12, 0.85, t));
  float fibA = 0.5 + 0.5 * sin(phi * 27.0 + sin(phi * 5.0) * 1.6);
  float fibB = 0.5 + 0.5 * sin(phi * 63.0 + t * 7.0);
  irisCol *= 0.8 + 0.3 * fibA + 0.18 * fibB * smoothstep(0.2, 0.6, t);
  irisCol = mix(irisCol, uIrisB * 1.18, 0.4 * exp(-pow((t - 0.4) * 8.0, 2.0)));
  irisCol = mix(irisCol, uIrisA * 0.32, smoothstep(0.66, 1.0, t) * uIris.z);
  // The light coming through the iris: the side opposite the catch-light glows.
  vec2 lightDir = normalize(uLight.xy + vec2(0.0001, 0.0));
  vec2 irisLocal = off / max(rI, 0.001);
  irisCol += uIrisB * 0.36 * smoothstep(0.1, 0.9, dot(irisLocal, -lightDir)) * smoothstep(0.25, 0.8, t);
  float pupil = 1.0 - smoothstep(rP - 0.012, rP + 0.014, th);
  irisCol = mix(irisCol, vec3(0.01, 0.007, 0.007), pupil);

  vec3 scl = uSclera;
  scl *= 1.0 - 0.34 * smoothstep(0.32, 0.98, edgeR);
  float innerT = 1.0 - outerT;
  float caruncle = smoothstep(0.78, 1.0, innerT) * uLight.w;
  scl = mix(scl, vec3(0.88, 0.5, 0.46), caruncle * 0.7);
  float vein = 0.4 + 0.6 * smoothstep(0.35, 0.95, sin(atan(dir.y, dir.x) * 13.0 + edgeR * 9.0));
  scl = mix(scl, vec3(0.78, 0.2, 0.18), uLight.z * (0.2 + 0.8 * smoothstep(0.28, 0.9, edgeR)) * vein);
  vec3 eyeCol = mix(scl, irisCol, irisMask);
  // Depth: the upper lid shades the eyeball; the lower lid glows a wet pink line.
  eyeCol *= 1.0 - uState.z * (1.0 - smoothstep(0.0, 0.2, dUp));
  eyeCol *= 1.0 - 0.14 * (1.0 - smoothstep(0.0, 0.07, dLo));
  float water = (1.0 - smoothstep(0.0, 0.045, dLo)) * (1.0 - irisMask * 0.5);
  eyeCol = mix(eyeCol, vec3(0.86, 0.5, 0.48), water * 0.5 * uIris.w);
  // Lighting that matches the toon skin: warm where lit, cool in shade, never black.
  float eyeLit = smoothstep(0.05, 0.8, dot(reflectedLight.directDiffuse, vec3(0.299, 0.587, 0.114)) / max(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), 0.02));
  eyeCol *= mix(0.58, 1.02, eyeLit) * mix(vec3(0.84, 0.9, 1.06), vec3(1.05, 1.0, 0.95), eyeLit);
  eyeCol *= uState.w;

  // Catch-lights (cornea reflections): fixed relative to the pupil so they stay in the iris.
  vec2 pc = uGaze.xy * uQScale + vec2(0.0);
  vec2 hl1 = pc + uLight.xy * (rI * 0.6) * 0.66;
  vec2 hl2 = pc - uLight.xy * (rI * 0.6) * 0.42;
  float corneaMask = 1.0 - smoothstep(rI * 0.85, rI * 1.05, th);
  float s1 = 1.0 - smoothstep(0.03, 0.05, length(q - hl1));
  float s1soft = (1.0 - smoothstep(0.02, 0.11, length(q - hl1))) * 0.2;
  float s2 = (1.0 - smoothstep(0.014, 0.026, length(q - hl2))) * 0.7;
  float glint = (s1 + s1soft + s2) * corneaMask * uIris.w;
  // A thin bright wet line along the lower lid.
  float wetLine = (1.0 - smoothstep(0.0, 0.012, abs(dLo - 0.03))) * smoothstep(0.0, 0.2, uState.x) * 0.35 * uIris.w * (0.4 + 0.6 * (1.0 - innerT));
  eyeCol += vec3(1.0, 0.97, 0.94) * (glint + wetLine) * uState.w;

  outgoingLight = mix(lid, eyeCol, inside);
}
`

let toonHook: ((shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void) | null = null
let toonRamp: THREE.Texture | null | undefined

function ensureToonDonor() {
  if (toonHook !== null) return
  const donor = createAvatarToonMaterial('#ffffff')
  toonHook = donor.onBeforeCompile as unknown as typeof toonHook
  toonRamp = (donor as THREE.MeshToonMaterial).gradientMap
  donor.dispose()
}

/** The one shared unit dome: a front cap of a sphere with its +Z pole out of the face. */
export function createEyeDomeGeometry() {
  const geometry = new THREE.SphereGeometry(1, 30, 18, 0, Math.PI * 2, 0, Math.PI * 0.56)
  geometry.rotateX(Math.PI / 2)
  return geometry
}

export function createEyeMaterial(uniforms: EyeUniforms, skinColor: THREE.ColorRepresentation, gradientMap?: THREE.Texture | null) {
  ensureToonDonor()
  const material = new THREE.MeshToonMaterial({
    color: skinColor,
    gradientMap: gradientMap ?? toonRamp ?? null,
  })
  material.name = 'avatar-eye-dome'
  material.onBeforeCompile = (shader, renderer) => {
    toonHook?.(shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PREFIX}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  vEyeP = position;
  // Viewed obliquely (the far eye of a turned head) the eye shrinks and flattens towards the
  // face instead of sticking out past the silhouette; nearly edge-on it disappears entirely.
  vec3 eyeNormalView = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
  vec3 eyeToCamera = normalize(-(modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
  vEyeFacing = dot(eyeNormalView, eyeToCamera);
  float eyeFit = smoothstep(0.3, 0.8, vEyeFacing);
  transformed.xy *= eyeFit;
  transformed.z *= mix(0.4, 1.0, eyeFit);
`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PREFIX}`)
      .replace('#include <opaque_fragment>', `${FRAGMENT_BODY}\n#include <opaque_fragment>`)
  }
  material.customProgramCacheKey = () => 'avatar-eye-dome-v3'
  return material
}
