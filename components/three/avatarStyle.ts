import * as THREE from 'three'

/**
 * Stylized look for the rigged avatars: cel-shaded toon materials with a
 * stepped light ramp, a skinned ink outline (inverted hull), and eye blinks.
 */

let toonRamp: THREE.DataTexture | null = null

function getToonRamp() {
  if (toonRamp) return toonRamp
  // Three painted tones (shadow, mid, lit) with narrow soft steps between them:
  // linear filtering across the repeated texels gives a crisp-but-not-aliased
  // terminator instead of the old four hard bands.
  const steps = new Uint8Array([
    118, 118, 118, 118, 118, 118, 118,
    190, 190, 190, 190, 190,
    255, 255, 255, 255,
  ])
  toonRamp = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat)
  toonRamp.minFilter = THREE.LinearFilter
  toonRamp.magFilter = THREE.LinearFilter
  toonRamp.generateMipmaps = false
  toonRamp.needsUpdate = true
  return toonRamp
}

/**
 * Cloth, leather, plastic and metal character for the toon materials, all in
 * the one shared avatar program. Each material carries its own small set of
 * uniforms (see FABRIC_PRESETS); skin, hair and eyes keep `active = 0` and
 * skip the block entirely. Detail is procedural in the bind-pose "fabric
 * frame" (metres, Y up, hips at the origin) so weave, folds and creases stick
 * to the cloth as the rig moves:
 *  - weave / knit / leather grain / felt fuzz, faded out by its own screen
 *    footprint so it only shows up close and never shimmers;
 *  - heather mottling (and denim slubs) at a scale that still reads at the table;
 *  - soft drape folds plus crease rings around elbows, shoulders, waist and
 *    knees (the `fabricJoint` attribute, from the skin weights), as a bumped
 *    normal that the toon ramp turns into painted folds, and ambient darkening
 *    in the valleys;
 *  - turned hems, cuffs and collars with a stitch line (`fabricEdge`: distance
 *    to the cloth piece's open border);
 *  - a posterized highlight for satin, leather, plastic and metal, and a
 *    fuzzier or flatter rim for fleece, felt and matte cotton.
 */
const FABRIC_VERTEX_PARS = /* glsl */ `
attribute vec2 fabricEdge;
attribute vec3 fabricJoint;
uniform mat4 uFabricFrame;
varying vec3 vFabricP;
varying vec3 vFabricN;
varying vec2 vFabricEdge;
varying vec3 vFabricJoint;
`

const FABRIC_VERTEX = /* glsl */ `
#ifdef USE_SKINNING
  vec4 fabricBindP = bindMatrix * vec4(position, 1.0);
  vec3 fabricBindN = mat3(bindMatrix) * normal;
#else
  vec4 fabricBindP = vec4(position, 1.0);
  vec3 fabricBindN = normal;
#endif
  vFabricP = (uFabricFrame * fabricBindP).xyz;
  vFabricN = mat3(uFabricFrame) * fabricBindN;
  vFabricEdge = fabricEdge;
  vFabricJoint = fabricJoint;
`

const FABRIC_FRAGMENT_PARS = /* glsl */ `
uniform vec4 uFabricA;
uniform vec4 uFabricB;
uniform vec4 uFabricC;
uniform vec4 uFabricD;
uniform vec4 uFabricE;
uniform vec3 uFabricStitch;
varying vec3 vFabricP;
varying vec3 vFabricN;
varying vec2 vFabricEdge;
varying vec3 vFabricJoint;
float fabricHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float fabricNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(fabricHash(i), fabricHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(fabricHash(i + vec3(0.0, 1.0, 0.0)), fabricHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(fabricHash(i + vec3(0.0, 0.0, 1.0)), fabricHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(fabricHash(i + vec3(0.0, 1.0, 1.0)), fabricHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z
  );
}
// Value noise with its analytic gradient (xyz), for smooth bumped folds.
vec4 fabricNoiseD(vec3 x) {
  vec3 i = floor(x);
  vec3 w = fract(x);
  vec3 u = w * w * (3.0 - 2.0 * w);
  vec3 du = 6.0 * w * (1.0 - w);
  float a = fabricHash(i);
  float b = fabricHash(i + vec3(1.0, 0.0, 0.0));
  float c = fabricHash(i + vec3(0.0, 1.0, 0.0));
  float d = fabricHash(i + vec3(1.0, 1.0, 0.0));
  float e = fabricHash(i + vec3(0.0, 0.0, 1.0));
  float f = fabricHash(i + vec3(1.0, 0.0, 1.0));
  float g = fabricHash(i + vec3(0.0, 1.0, 1.0));
  float h = fabricHash(i + vec3(1.0, 1.0, 1.0));
  float k1 = b - a;
  float k2 = c - a;
  float k3 = e - a;
  float k4 = a - b - c + d;
  float k5 = a - c - e + g;
  float k6 = a - b - e + f;
  float k7 = -a + b + c - d + e - f - g + h;
  float value = a + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z;
  vec3 gradient = du * vec3(
    k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z,
    k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x,
    k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y
  );
  return vec4(value, gradient);
}
// One planar weave cell pattern in -1..1: 1 twill, 2 plain weave, 3 knit, 4 open mesh.
float fabricWeave(vec2 c, float kind) {
  if (kind < 1.5) return sin(6.2832 * (c.x + c.y)) * 0.75 + sin(12.566 * c.y) * 0.25;
  if (kind < 2.5) return (sin(6.2832 * c.x) + sin(6.2832 * c.y)) * 0.5;
  if (kind < 3.5) {
    float column = abs(fract(c.x) - 0.5);
    return sin(6.2832 * (c.y * 1.3 + column * 1.1)) * 0.6 - smoothstep(0.38, 0.5, column) * 0.8;
  }
  return 0.25 - smoothstep(0.22, 0.34, 0.5 - length(fract(c) - 0.5)) * 1.25;
}
`

const FABRIC_SURFACE = /* glsl */ `
  float fabricShade = 1.0;
  float fabricRaise = 0.0;
  if (uFabricD.x > 0.5) {
    vec3 fabP = vFabricP;
    vec3 fabN = normalize(vFabricN + vec3(1e-5));
    // Folds: a soft vertical drape everywhere, crease rings where the skin
    // weights say a joint bends. Heights are in metres of cloth, with analytic
    // gradients (not screen derivatives, which break into 2x2 pixel blocks).
    // Ridged noise stretched along gravity: soft hanging folds with crisp valleys.
    const vec3 fabS1 = vec3(9.0, 2.2, 9.0);
    const vec3 fabS2 = vec3(21.0, 5.5, 21.0);
    vec4 fabN1 = fabricNoiseD(fabP * fabS1);
    vec4 fabN2 = fabricNoiseD(fabP * fabS2 + 7.1);
    float fabSide = sign(fabN1.x * 2.0 - 1.0);
    float drape = (1.0 - abs(fabN1.x * 2.0 - 1.0)) * 0.7 + fabN2.x * 0.3;
    vec3 drapeG = -fabSide * 2.0 * fabN1.yzw * fabS1 * 0.7 + fabN2.yzw * fabS2 * 0.3;
    float fabKd = 0.016 * uFabricB.x;
    float fabH = (drape - 0.55) * fabKd;
    vec3 fabG = drapeG * fabKd;
    float fabJ = length(vFabricJoint);
    vec3 fabAxis = vFabricJoint / max(fabJ, 1e-4);
    vec4 fabWarp = fabricNoiseD(fabP * 24.0);
    float fabPhase = dot(fabP, fabAxis) * 160.0 + fabWarp.x * 2.6;
    float fabRing = sin(fabPhase);
    vec3 fabRingG = cos(fabPhase) * (fabAxis * 160.0 + fabWarp.yzw * 62.4);
    float fabBreak = smoothstep(0.3, 0.7, fabricNoise(fabP * 14.0 + 3.7));
    float fabT = clamp((fabRing - 0.3) / 0.7, 0.0, 1.0);
    float fabJm = smoothstep(0.08, 0.7, fabJ) * fabBreak * 0.0045 * uFabricB.y;
    fabH -= fabT * fabT * (3.0 - 2.0 * fabT) * fabJm;
    fabG -= 6.0 * fabT * (1.0 - fabT) / 0.7 * fabRingG * fabJm;
    fabricRaise = fabH;
    // Bump the shading normal: chain the fabric-space gradient through the
    // per-triangle screen derivatives of the fabric position.
    vec3 fabDx = dFdx(-vViewPosition);
    vec3 fabDy = dFdy(-vViewPosition);
    float fabGl = length(fabG);
    fabG *= min(1.0, 0.9 / max(fabGl, 1e-5));
    float fabHx = dot(fabG, dFdx(fabP));
    float fabHy = dot(fabG, dFdy(fabP));
    vec3 fabR1 = cross(fabDy, normal);
    vec3 fabR2 = cross(normal, fabDx);
    float fabDet = dot(fabDx, fabR1);
    vec3 fabGrad = sign(fabDet) * (fabHx * fabR1 + fabHy * fabR2);
    normal = normalize(abs(fabDet) * normal - fabGrad);
    // Valleys of folds and creases hold a little shadow.
    fabricShade *= 1.0 - clamp(-fabH / 0.01, 0.0, 1.0) * 0.3 * max(uFabricB.x, uFabricB.y);

    // Weave, knit, grain or fuzz: only where it spans enough pixels to read.
    vec3 fabQ = fabP * uFabricA.y;
    float fabFoot = length(fwidth(fabQ));
    float fabFine = 1.0 - smoothstep(0.1, 0.28, fabFoot);
    float fabWeave = 0.0;
    if (uFabricA.x > 4.5) {
      fabWeave = (fabricNoise(fabQ) + fabricNoise(fabQ * 2.7 + 5.3) * 0.5) * 1.33 - 1.0;
      if (uFabricA.x < 5.5) fabWeave = 0.6 - abs(fabWeave) * 1.9;
    } else if (uFabricA.x > 0.5) {
      vec3 fabW = pow(abs(fabN), vec3(4.0));
      fabW /= fabW.x + fabW.y + fabW.z + 1e-5;
      fabWeave = fabricWeave(fabQ.yz, uFabricA.x) * fabW.x + fabricWeave(fabQ.xz, uFabricA.x) * fabW.y + fabricWeave(fabQ.xy, uFabricA.x) * fabW.z;
    }
    fabricShade *= 1.0 + fabWeave * uFabricA.z * fabFine;
    // Heathered tone that still reads at table distance (denim: long slubs).
    vec3 fabM = uFabricD.w > 0.5 ? fabP * vec3(120.0, 9.0, 120.0) : fabP * 55.0;
    float fabMottle = fabricNoise(fabM) + fabricNoise(fabM * 2.9 + 1.7) * 0.5 * (1.0 - smoothstep(0.3, 0.8, length(fwidth(fabM * 2.9))));
    fabricShade *= 1.0 + (fabMottle - 0.75) * uFabricA.w;

    // Hems, cuffs and collars: a turned edge band, a lighter rolled lip and a stitch line.
    // (Derivatives stay outside any varying-dependent branch.)
    float fabNearEdge = step(0.001, vFabricEdge.x);
    float fabD = (1.0 - vFabricEdge.x) * 0.06;
    float fabDw = fwidth(fabD);
    float fabDashT = dot(fabP, vec3(96.0, 83.0, 91.0));
    float fabDashW = fwidth(fabDashT);
    float fabBand = 1.0 - smoothstep(0.006, 0.02, fabD);
    float fabLip = 1.0 - smoothstep(0.0, 0.0045, fabD);
    fabricShade *= 1.0 - uFabricB.z * (fabBand * 0.42 - fabLip * 0.5) * fabNearEdge;
    float fabLineW = max(fabDw, 0.0011);
    float fabLine = 1.0 - smoothstep(fabLineW * 0.6, fabLineW * 1.6, abs(fabD - 0.021));
    float fabDash = mix(0.55, step(0.42, fract(fabDashT)), 1.0 - smoothstep(0.3, 0.7, fabDashW));
    float fabStitch = fabLine * fabDash * uFabricB.w * (1.0 - smoothstep(0.004, 0.009, fabDw)) * fabNearEdge;
    vec3 fabBase = diffuseColor.rgb;
    // Denim and suede wear pale on the raised ridges of folds.
    diffuseColor.rgb = mix(fabBase, fabBase * 1.45 + vec3(0.025), uFabricC.w * smoothstep(0.0, 0.003, fabH));
    diffuseColor.rgb *= fabricShade;
    // Hard plastics: deeper, more saturated body colour; the gloss does the rest.
    if (uFabricE.y > 0.0) {
      float fabL = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = mix(vec3(fabL), diffuseColor.rgb, 1.0 + uFabricE.y) * (1.0 - uFabricE.y * 0.3);
    }
    vec3 fabThread = dot(uFabricStitch, vec3(1.0)) > 0.0 ? uFabricStitch : fabBase * 0.72;
    diffuseColor.rgb = mix(diffuseColor.rgb, fabThread, fabStitch * 0.7);
  }
`

const FABRIC_LIGHT = /* glsl */ `
  if (uFabricD.x > 0.5 && uFabricC.x > 0.0) {
    #if NUM_DIR_LIGHTS > 0
      vec3 fabL = directionalLights[0].direction;
      vec3 fabLc = directionalLights[0].color / max(max(directionalLights[0].color.r, directionalLights[0].color.g), max(directionalLights[0].color.b, 1e-3));
    #else
      vec3 fabL = normalize(vec3(0.3, 1.0, 0.5));
      vec3 fabLc = vec3(1.0);
    #endif
    float fabNh = saturate(dot(normal, normalize(fabL + geometryViewDir)));
    float fabSp = pow(fabNh, mix(6.0, 80.0, uFabricC.y));
    // Posterized like the diffuse ramp: a painted highlight shape with a soft skirt.
    fabSp = mix(fabSp, smoothstep(0.3, 0.5, fabSp), 0.65 * (1.0 - uFabricE.x * 0.6)) * smoothstep(0.08, 0.45, toonLit);
    // Leather and satin sheen take the cloth's own colour (a white blob read as a stain on light hides).
    vec3 fabTinted = diffuseColor.rgb / max(max(diffuseColor.r, diffuseColor.g), max(diffuseColor.b, 0.05)) * 0.9;
    vec3 fabSpecColor = mix(mix(fabLc, fabLc * fabTinted, uFabricE.x), diffuseColor.rgb * 1.7 + vec3(0.08), uFabricD.z);
    outgoingLight += fabSpecColor * fabSp * uFabricC.x * 0.42;
    // Metal: a sky/floor reflection gradient instead of flat colour.
    outgoingLight *= mix(1.0, mix(0.72, 1.3, saturate(normal.y * 0.5 + 0.5)), uFabricD.z);
  }
  if (uFabricD.y > 0.0) outgoingLight += diffuseColor.rgb * pow(toonFacing, 3.0) * uFabricD.y;
`

/**
 * Warm-key / cool-shadow grade plus a soft fresnel rim so characters separate
 * from the dark lounge, and the fabric pass above. Injected once; every avatar
 * toon material shares the same program (the cache key is this function's
 * source) and reads its own fabric uniforms (`this` is the material).
 */
function avatarToonLook(this: THREE.Material | undefined, shader: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, fabricUniformsFor(this))
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${FABRIC_VERTEX_PARS}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${FABRIC_VERTEX}`)
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FABRIC_FRAGMENT_PARS}`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FABRIC_SURFACE}`)
    .replace(
      '#include <opaque_fragment>',
      `{
      float toonLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      float toonLit = dot(reflectedLight.directDiffuse, vec3(0.299, 0.587, 0.114)) / max(toonLuma, 0.02);
      float toonWarm = smoothstep(0.08, 0.7, toonLit);
      outgoingLight *= mix(vec3(0.84, 0.9, 1.1), vec3(1.06, 1.0, 0.92), toonWarm);
      float toonFacing = saturate(dot(normal, geometryViewDir));
      float toonRim = smoothstep(0.52, 0.86, 1.0 - toonFacing) * saturate(normal.y * 0.6 + 0.55);
      outgoingLight += (diffuseColor.rgb * 0.55 + vec3(0.07, 0.075, 0.09)) * toonRim * 0.55 * (uFabricD.x > 0.5 ? uFabricC.z : 1.0);
      ${FABRIC_LIGHT}
    }
    #include <opaque_fragment>`
    )
}

/** Cloth and hard-surface characters for avatar materials. */
export type AvatarFabricKind =
  | 'none'
  | 'wool'
  | 'cotton'
  | 'jersey'
  | 'satin'
  | 'denim'
  | 'fleece'
  | 'knit'
  | 'leather'
  | 'suede'
  | 'canvas'
  | 'hivis'
  | 'tape'
  | 'plastic'
  | 'rubber'
  | 'felt'
  | 'straw'
  | 'metal'
  | 'acetate'

interface FabricPreset {
  /** weave type (0 none, 1 twill, 2 plain, 3 knit, 4 mesh, 5 leather grain, 6 fuzz), cycles per metre, weave contrast, mottle contrast */
  a: [number, number, number, number]
  /** drape folds, joint creases, hem darkening, stitch strength */
  b: [number, number, number, number]
  /** highlight strength, gloss (0 broad .. 1 tight), rim multiplier, ridge wear */
  c: [number, number, number, number]
  /** retro-reflective facing glow, metal, long slub mottle */
  d?: [number, number, number]
  /** highlight tint toward the cloth colour, hard-plastic colour depth */
  e?: [number, number]
  stitch?: [number, number, number]
}

const FABRIC_PRESETS: Record<Exclude<AvatarFabricKind, 'none'>, FabricPreset> = {
  wool: { a: [1, 900, 0.1, 0.05], b: [0.7, 0.8, 0.3, 0.15], c: [0, 0, 0.8, 0] },
  cotton: { a: [2, 760, 0.045, 0.03], b: [0.9, 1.0, 0.25, 0.12], c: [0, 0, 0.7, 0] },
  jersey: { a: [3, 520, 0.07, 0.04], b: [1.0, 1.0, 0.3, 0.1], c: [0, 0, 0.9, 0] },
  satin: { a: [0, 1, 0, 0.02], b: [0.6, 0.6, 0.2, 0], c: [0.6, 0.35, 1.2, 0], e: [0.5, 0] },
  denim: { a: [1, 430, 0.22, 0.2], b: [0.7, 1.1, 0.4, 0.9], c: [0, 0, 0.6, 0.4], d: [0, 0, 1], stitch: [0.62, 0.42, 0.16] },
  fleece: { a: [3, 380, 0.07, 0.07], b: [1.1, 1.1, 0.3, 0.1], c: [0, 0, 1.45, 0] },
  knit: { a: [3, 170, 0.22, 0.1], b: [0.3, 0.3, 0.2, 0], c: [0, 0, 1.3, 0] },
  leather: { a: [5, 240, 0.12, 0.06], b: [0.45, 1.1, 0.3, 0.5], c: [0.4, 0.75, 0.9, 0.12], e: [0.75, 0] },
  suede: { a: [6, 520, 0.1, 0.12], b: [0.5, 0.9, 0.3, 0.4], c: [0.06, 0.1, 1.35, 0.25] },
  canvas: { a: [2, 600, 0.05, 0.06], b: [0.65, 0.9, 0.3, 0.2], c: [0, 0, 0.6, 0.12] },
  hivis: { a: [4, 520, 0.16, 0.03], b: [0.5, 0.7, 0.15, 0.3], c: [0.18, 0.4, 0.8, 0] },
  tape: { a: [0, 1, 0, 0.02], b: [0.3, 0.4, 0.1, 0], c: [0.55, 0.5, 0.8, 0], d: [0.55, 0, 0] },
  plastic: { a: [0, 1, 0, 0.02], b: [0, 0, 0.2, 0], c: [1.1, 0.8, 0.55, 0], e: [0, 0.35] },
  rubber: { a: [0, 1, 0, 0.04], b: [0, 0.3, 0.2, 0], c: [0.12, 0.2, 0.7, 0] },
  felt: { a: [6, 700, 0.07, 0.1], b: [0.2, 0.25, 0.25, 0], c: [0.04, 0.05, 1.4, 0] },
  straw: { a: [2, 150, 0.3, 0.12], b: [0.1, 0.1, 0.2, 0.3], c: [0.1, 0.2, 0.8, 0] },
  metal: { a: [0, 1, 0, 0.02], b: [0, 0, 0, 0], c: [1.0, 0.9, 1.2, 0], d: [0, 1, 0] },
  acetate: { a: [0, 1, 0, 0.02], b: [0, 0, 0, 0], c: [0.9, 0.92, 1.0, 0], e: [0, 0.2] },
}

interface FabricUniforms {
  uFabricA: { value: THREE.Vector4 }
  uFabricB: { value: THREE.Vector4 }
  uFabricC: { value: THREE.Vector4 }
  uFabricD: { value: THREE.Vector4 }
  uFabricE: { value: THREE.Vector4 }
  uFabricStitch: { value: THREE.Color }
  uFabricFrame: { value: THREE.Matrix4 }
}

const fabricUniforms = new WeakMap<THREE.Material, FabricUniforms>()
const FABRIC_KIND_KEY = 'avatarFabric'
const FABRIC_FRAME_KEY = 'avatarFabricFrame'

function writeFabricUniforms(uniforms: FabricUniforms, kind: AvatarFabricKind, frame: ArrayLike<number> | null) {
  if (kind === 'none') {
    uniforms.uFabricD.value.set(0, 0, 0, 0)
    uniforms.uFabricE.value.set(0, 0, 0, 0)
  } else {
    const preset = FABRIC_PRESETS[kind]
    uniforms.uFabricA.value.fromArray(preset.a)
    uniforms.uFabricB.value.fromArray(preset.b)
    uniforms.uFabricC.value.fromArray(preset.c)
    const d = preset.d ?? [0, 0, 0]
    uniforms.uFabricD.value.set(1, d[0], d[1], d[2])
    const e = preset.e ?? [0, 0]
    uniforms.uFabricE.value.set(e[0], e[1], 0, 0)
    if (preset.stitch) uniforms.uFabricStitch.value.setRGB(preset.stitch[0], preset.stitch[1], preset.stitch[2], THREE.SRGBColorSpace)
    else uniforms.uFabricStitch.value.setRGB(0, 0, 0)
  }
  if (frame) uniforms.uFabricFrame.value.fromArray(frame)
}

/** The per-material fabric uniforms (created from userData, so material clones keep their cloth). */
function fabricUniformsFor(material: THREE.Material | undefined): FabricUniforms | Record<string, never> {
  if (!material) return {}
  let uniforms = fabricUniforms.get(material)
  if (!uniforms) {
    uniforms = {
      uFabricA: { value: new THREE.Vector4() },
      uFabricB: { value: new THREE.Vector4() },
      uFabricC: { value: new THREE.Vector4() },
      uFabricD: { value: new THREE.Vector4() },
      uFabricE: { value: new THREE.Vector4() },
      uFabricStitch: { value: new THREE.Color(0, 0, 0) },
      uFabricFrame: { value: new THREE.Matrix4() },
    }
    const kind = (material.userData[FABRIC_KIND_KEY] as AvatarFabricKind | undefined) ?? 'none'
    const frame = material.userData[FABRIC_FRAME_KEY] as number[] | undefined
    writeFabricUniforms(uniforms, kind in FABRIC_PRESETS ? kind : 'none', frame ?? null)
    fabricUniforms.set(material, uniforms)
  }
  return uniforms
}

/**
 * Gives an avatar toon material its cloth character. `frame` maps the mesh's
 * bind space (or, for unskinned accessories, geometry space) to metres.
 * Safe to call after the material has compiled: the live uniforms update.
 */
export function setAvatarFabric(material: THREE.Material, kind: AvatarFabricKind, frame?: THREE.Matrix4) {
  material.userData[FABRIC_KIND_KEY] = kind
  if (frame) material.userData[FABRIC_FRAME_KEY] = frame.toArray()
  const live = fabricUniforms.get(material)
  if (live) writeFabricUniforms(live, kind, frame ? frame.elements : null)
}

/** Converts a material to the shared avatar toon look (also used for re-coloured clones). */
export function applyAvatarToonLook(material: THREE.Material) {
  if (!(material as THREE.MeshToonMaterial).isMeshToonMaterial) return
  material.onBeforeCompile = avatarToonLook
  material.needsUpdate = true
}

/**
 * A toon material in the avatar look for procedural accessories (hats, glasses
 * frames, jackets) so they shade like the bodies they sit on instead of as
 * glossy PBR plastic. Metals get a touch of emissive so gilt still glints
 * without an environment map.
 */
export function createAvatarToonMaterial(
  color: THREE.ColorRepresentation,
  options: { metallic?: boolean; fabric?: AvatarFabricKind } = {}
) {
  const toon = new THREE.MeshToonMaterial({ color, gradientMap: getToonRamp() })
  if (options.metallic) {
    toon.emissive.set(color).multiplyScalar(0.18)
  }
  if (options.fabric) setAvatarFabric(toon, options.fabric)
  applyAvatarToonLook(toon)
  return toon
}

function toToonMaterial(source: THREE.Material) {
  const standard = source as THREE.MeshStandardMaterial
  const toon = new THREE.MeshToonMaterial({
    name: source.name,
    color: standard.color ? standard.color.clone() : new THREE.Color('#ffffff'),
    map: standard.map ?? null,
    gradientMap: getToonRamp(),
    transparent: source.transparent,
    opacity: source.opacity,
    side: source.side,
  })
  // Lift skin and cloth slightly so the ramp's darkest band never goes muddy.
  toon.color.offsetHSL(0, 0.04, 0.02)
  applyAvatarToonLook(toon)
  return toon
}

/** Outline thickness as a fraction of each mesh's bounding radius (rigs use different units). */
const OUTLINE_WIDTH_RATIO = 0.0075
/** Outline budget per avatar (each hull re-skins its mesh every frame). */
const MAX_OUTLINES_PER_AVATAR = 3
const OUTLINE_MIN_VERTICES = 400
/** Skinned parts smaller than this skip the shadow pass. */
const SHADOW_MIN_VERTICES = 300

function createOutlineMaterial(width: number) {
  const material = new THREE.MeshBasicMaterial({
    color: '#120a07',
    side: THREE.BackSide,
    transparent: false,
  })
  material.name = 'avatar-ink-outline'
  material.onBeforeCompile = shader => {
    shader.uniforms.outlineWidth = { value: width }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float outlineWidth;')
      .replace(
        '#include <skinning_vertex>',
        '#include <skinning_vertex>\n  float outlineNormalLength = length(objectNormal);\n  if (outlineNormalLength > 1e-4) transformed += (objectNormal / outlineNormalLength) * outlineWidth;'
      )
  }
  // Every outline shares one program even though materials are per seat.
  return material
}

/** Per-player colouring for the shared GLB bodies. */
export interface AvatarLook {
  /** sRGB hex from the avatar profile (also used by the HUD swatch). */
  skinColor?: string
  /** Stable per-player seed string (player id). */
  seed?: string
}

type Palette = Record<string, string>

// Jewel-toned wardrobe that sits well against the teal lounge and green felt.
// Keys are the GLB material names; each model gets a few variants per player.
const OUTFIT_PALETTES: Record<string, Palette[]> = {
  Suit: [
    { Suit: '#27324d', White: '#efe8d8', Tie: '#a3263c' },
    { Suit: '#3a2a45', White: '#f1ead9', Tie: '#d8a23a' },
    { Suit: '#1f3b3a', White: '#ece6d6', Tie: '#c2573a' },
    { Suit: '#2c2c33', White: '#f2ecde', Tie: '#2f8f83' },
  ],
  Casual2: [
    { LightBrown: '#d2a03f', LightBlue: '#35507a', White: '#ece6da', Red_Dark: '#8f2433' },
    { LightBrown: '#c8604e', LightBlue: '#2f3f5e', White: '#ece6da', Red_Dark: '#1f5c55' },
    { LightBrown: '#7fa36a', LightBlue: '#3b4f78', White: '#ece6da', Red_Dark: '#7a2a3a' },
    { LightBrown: '#e0d3b4', LightBlue: '#2c4a6e', White: '#ece6da', Red_Dark: '#b8403a' },
  ],
  Casual: [
    { Purple: '#5d3a8a', LightBlue: '#34496e', White: '#ece6da' },
    { Purple: '#1f7f7a', LightBlue: '#2e3f5c', White: '#ece6da' },
    { Purple: '#a83246', LightBlue: '#33476a', White: '#ece6da' },
    { Purple: '#3f64a8', LightBlue: '#2c3a52', White: '#ece6da' },
  ],
  Worker: [
    { Worker_Vest: '#e0692c', Worker_Yellow: '#e8b640', LightBrown: '#7c95a6', Brown: '#46506a', Brown2: '#2c2f3a' },
    { Worker_Vest: '#d9a32e', Worker_Yellow: '#e8c35a', LightBrown: '#b0544a', Brown: '#3b4a5e', Brown2: '#2c2f3a' },
    { Worker_Vest: '#2f8f7a', Worker_Yellow: '#e2ae3a', LightBrown: '#d8cdb3', Brown: '#40465a', Brown2: '#2c2f3a' },
  ],
  Punk: [
    { Black: '#26242c', White: '#ebe4d6', LightBlue: '#2f3e58' },
    { Black: '#3a1f2c', White: '#e8e0cf', LightBlue: '#27324a' },
    { Black: '#1f2c34', White: '#f0e8d8', LightBlue: '#353148' },
  ],
  Adventurer: [
    { Green: '#3f6d55', LightGreen: '#c4a46a', Brown: '#6e4a2c', Brown2: '#3a3140', Gold: '#e0b04a' },
    { Green: '#7a3b33', LightGreen: '#d6c29a', Brown: '#5c3e28', Brown2: '#2e3244', Gold: '#e0b04a' },
    { Green: '#34577a', LightGreen: '#c9b07a', Brown: '#6a4630', Brown2: '#33303c', Gold: '#e0b04a' },
  ],
}

// Natural hair plus a couple of playful dyes; punks get the loud ones.
const HAIR_COLORS = ['#1c1613', '#3a2419', '#5e3520', '#8a3a1e', '#b8612a', '#d9ae5e', '#e6dcc0', '#8d8a86', '#2d2a33']
const PUNK_HAIR_COLORS = ['#d8345f', '#1fb3a6', '#c8283c', '#8150d8', '#f0a030']

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function detectOutfitFamily(model: THREE.Object3D) {
  let family: string | null = null
  model.traverse(object => {
    if (family || !(object as THREE.Mesh).isMesh) return
    const match = /^(Suit|Casual2|Casual|Worker|Punk|Adventurer)_/.exec(object.name)
    if (match) family = match[1]!
  })
  return family as string | null
}

/** Recolours the converted toon materials for this player (skin, hair, outfit). */
function applyLook(model: THREE.Object3D, materials: Iterable<THREE.MeshToonMaterial>, look: AvatarLook) {
  const seed = hashString(look.seed ?? '')
  const family = detectOutfitFamily(model)
  const variants = family ? OUTFIT_PALETTES[family] : undefined
  const palette: Palette = variants ? variants[seed % variants.length]! : {}
  const hairChoices = family === 'Punk' ? PUNK_HAIR_COLORS : HAIR_COLORS
  const hair = new THREE.Color(hairChoices[(seed >>> 8) % hairChoices.length]!)
  const skin = look.skinColor ? new THREE.Color(look.skinColor) : null
  if (skin) skin.offsetHSL(0, 0.06, -0.035)

  for (const material of materials) {
    const name = material.name
    if (skin && /^skin$/i.test(name)) material.color.copy(skin)
    else if (skin && /^skin_darker$/i.test(name)) material.color.copy(skin).multiplyScalar(0.84)
    else if (/^(hair|moustache)$/i.test(name) || (family === 'Punk' && /^red(_dark)?$/i.test(name))) {
      material.color.copy(hair)
      if (/^red_dark$/i.test(name)) material.color.multiplyScalar(0.72)
    } else if (palette[name]) material.color.set(palette[name]!)
    else if (/^black$/i.test(name)) material.color.set('#22222a')
    else if (/^grey$/i.test(name)) material.color.set('#3a3a44')
  }
}

const SMOOTH_CREASE_COS = Math.cos(THREE.MathUtils.degToRad(62))
const outlineGeometries = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>()

function groupByPosition(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position')
  const groups = new Map<string, number[]>()
  for (let index = 0; index < position.count; index += 1) {
    const key = `${Math.round(position.getX(index) * 1e4)},${Math.round(position.getY(index) * 1e4)},${Math.round(position.getZ(index) * 1e4)}`
    const list = groups.get(key)
    if (list) list.push(index)
    else groups.set(key, [index])
  }
  return groups
}

/**
 * The low-poly GLBs ship flat per-face normals, which the toon ramp turns into
 * a patchwork of facets. Average normals across coincident vertices within a
 * crease angle so curved surfaces shade as one form while hat brims, collars
 * and shoe soles keep a crisp edge. Runs once per shared template geometry.
 */
function smoothTemplateNormals(geometry: THREE.BufferGeometry) {
  if (geometry.userData.toonSmoothed) return
  geometry.userData.toonSmoothed = true
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  if (!normal) return
  const source = new Float32Array(normal.count * 3)
  for (let index = 0; index < normal.count; index += 1) {
    source[index * 3] = normal.getX(index)
    source[index * 3 + 1] = normal.getY(index)
    source[index * 3 + 2] = normal.getZ(index)
  }
  const result = new Float32Array(source)
  for (const members of groupByPosition(geometry).values()) {
    if (members.length < 2) continue
    for (const a of members) {
      let x = 0
      let y = 0
      let z = 0
      for (const b of members) {
        const dot = source[a * 3]! * source[b * 3]! + source[a * 3 + 1]! * source[b * 3 + 1]! + source[a * 3 + 2]! * source[b * 3 + 2]!
        if (dot < SMOOTH_CREASE_COS) continue
        x += source[b * 3]!
        y += source[b * 3 + 1]!
        z += source[b * 3 + 2]!
      }
      const length = Math.hypot(x, y, z) || 1
      result[a * 3] = x / length
      result[a * 3 + 1] = y / length
      result[a * 3 + 2] = z / length
    }
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(result, 3))
}

/**
 * Outline hulls need one normal per position (fully averaged) or the hull
 * splits into shards along every hard edge. Shares every other attribute with
 * the source geometry so no skinning data is duplicated on the GPU.
 */
function getOutlineGeometry(geometry: THREE.BufferGeometry) {
  const cached = outlineGeometries.get(geometry)
  if (cached) return cached
  const outline = new THREE.BufferGeometry()
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (name !== 'normal') outline.setAttribute(name, attribute)
  }
  outline.setIndex(geometry.index)
  for (const group of geometry.groups) outline.addGroup(group.start, group.count, group.materialIndex)
  const normal = geometry.getAttribute('normal')
  const averaged = new Float32Array(normal.count * 3)
  for (const members of groupByPosition(geometry).values()) {
    let x = 0
    let y = 0
    let z = 0
    for (const index of members) {
      x += normal.getX(index)
      y += normal.getY(index)
      z += normal.getZ(index)
    }
    const length = Math.hypot(x, y, z) || 1
    for (const index of members) {
      averaged[index * 3] = x / length
      averaged[index * 3 + 1] = y / length
      averaged[index * 3 + 2] = z / length
    }
  }
  outline.setAttribute('normal', new THREE.BufferAttribute(averaged, 3))
  geometry.computeBoundingSphere()
  outline.boundingSphere = geometry.boundingSphere
  outline.boundingBox = geometry.boundingBox
  outlineGeometries.set(geometry, outline)
  return outline
}

/**
 * What each GLB material is made of, per outfit family. Keys are the GLB
 * material names; `feet`, `head` and `pack` override by mesh (shoes, the
 * worker's hard hat and the adventurer's backpack share names with clothes).
 */
const FABRIC_BY_FAMILY: Record<string, { body: Record<string, AvatarFabricKind>; feet?: Record<string, AvatarFabricKind>; head?: Record<string, AvatarFabricKind>; pack?: Record<string, AvatarFabricKind> }> = {
  Suit: {
    body: { Suit: 'wool', White: 'cotton', Tie: 'satin', Black: 'leather' },
  },
  Casual2: {
    body: { LightBrown: 'jersey', LightBlue: 'denim' },
    feet: { White: 'rubber', Red_Dark: 'canvas' },
  },
  Casual: {
    body: { Purple: 'fleece', LightBlue: 'denim' },
    feet: { White: 'rubber', Purple: 'canvas' },
  },
  Worker: {
    body: { Worker_Vest: 'hivis', Worker_Yellow: 'tape', LightBrown: 'cotton', Brown: 'canvas', Brown2: 'leather' },
    feet: { Black: 'rubber', Grey: 'leather' },
    head: { Worker_Yellow: 'plastic' },
  },
  Punk: {
    body: { Black: 'leather', White: 'jersey', LightBlue: 'denim', Earrings: 'metal' },
    feet: { Black: 'leather' },
  },
  Adventurer: {
    body: { Green: 'canvas', LightGreen: 'canvas', Brown: 'canvas', Brown2: 'leather', Gold: 'metal' },
    feet: { Black: 'rubber', Grey: 'suede' },
    pack: { Brown: 'leather', LightGreen: 'canvas', Green: 'canvas', Gold: 'metal' },
  },
}

function fabricKindFor(family: string | null, materialName: string, meshName: string): AvatarFabricKind {
  if (!family) return 'none'
  const table = FABRIC_BY_FAMILY[family]
  if (!table) return 'none'
  const part = /feet|foot/i.test(meshName) ? table.feet : /head/i.test(meshName) ? table.head : /backpack/i.test(meshName) ? table.pack : undefined
  if (part) return part[materialName] ?? (/head/i.test(meshName) ? 'none' : table.body[materialName] ?? 'none')
  if (/head/i.test(meshName)) return 'none'
  return table.body[materialName] ?? 'none'
}

/** Crease strength by the pair of bones a vertex is split between (sanitized Quaternius names). */
function creaseWeightFor(a: string, b: string) {
  const pair = [a, b].sort().join('|')
  if (/UpperArm/.test(pair) && /LowerArm/.test(pair)) return 1
  if (/LowerLeg/.test(pair) && /UpperLeg/.test(pair)) return 0.9
  if (/UpperLeg/.test(pair) && /Hips|Abdomen/.test(pair)) return 0.7
  if (/Shoulder/.test(pair) && /UpperArm/.test(pair)) return 0.55
  if (/Wrist/.test(pair) && /LowerArm/.test(pair)) return 0.45
  if (/Abdomen/.test(pair) && /Hips/.test(pair)) return 0.65
  if (/Torso/.test(pair) && /Abdomen/.test(pair)) return 0.5
  // Upper torso: the chest barely creases, and rings there read as streaks by the collar.
  if (/Chest/.test(pair) && /Torso/.test(pair)) return 0.04
  if (/Shoulder/.test(pair) && /Chest/.test(pair)) return 0.04
  return 0
}

/**
 * Bind space -> metres, Y up, hips at the origin, from the skeleton's bind
 * pose (robust to how the GLB was exported, scaled or quantized).
 */
function computeFabricFrame(meshes: readonly THREE.SkinnedMesh[]) {
  const frame = new THREE.Matrix4()
  const mesh = meshes[0]
  if (!mesh) return frame
  const bones = mesh.skeleton.bones
  const bindWorld = (index: number) => new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[index]!.clone().invert())
  const hipsIndex = bones.findIndex(bone => /^hips$/i.test(bone.name))
  const headIndex = bones.findIndex(bone => /^head$/i.test(bone.name))
  const hips = hipsIndex >= 0 ? bindWorld(hipsIndex) : new THREE.Vector3()
  const up = headIndex >= 0 && hipsIndex >= 0 ? bindWorld(headIndex).sub(hips).normalize() : new THREE.Vector3(0, 1, 0)
  // Height along `up` over every skinned vertex, in bind space.
  let low = Infinity
  let high = -Infinity
  const point = new THREE.Vector3()
  for (const skinned of meshes) {
    const position = skinned.geometry.getAttribute('position')
    for (let index = 0; index < position.count; index += 7) {
      point.fromBufferAttribute(position, index).applyMatrix4(skinned.bindMatrix)
      const h = point.dot(up)
      if (h < low) low = h
      if (h > high) high = h
    }
  }
  const height = high > low ? high - low : 1
  const scale = 1.8 / height
  const rotation = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(0, 1, 0)))
  frame.makeScale(scale, scale, scale).multiply(rotation).multiply(new THREE.Matrix4().makeTranslation(-hips.x, -hips.y, -hips.z))
  return frame
}

const FABRIC_EDGE_RANGE = 0.06

/**
 * Bakes the two fabric attributes into a shared template geometry (once):
 * `fabricEdge.x` = 1 at the cloth piece's open border (cuff, collar, hem)
 * fading to 0 at FABRIC_EDGE_RANGE metres along the surface; `fabricJoint` =
 * the bend axis between the two bones a vertex is split across, scaled by how
 * evenly it is split and how much that joint creases.
 */
/** Cloth vertices of a whole model in the fabric frame, bucketed for "is this edge covered?" tests. */
interface ClothPointIndex {
  cells: Map<string, Array<{ x: number; y: number; z: number; owner: THREE.BufferGeometry }>>
  size: number
}

const COVER_RADIUS = 0.03

function buildClothPointIndex(meshes: readonly THREE.SkinnedMesh[], frame: THREE.Matrix4): ClothPointIndex {
  const index: ClothPointIndex = { cells: new Map(), size: COVER_RADIUS }
  const point = new THREE.Vector3()
  for (const mesh of meshes) {
    const toFabric = frame.clone().multiply(mesh.bindMatrix)
    const position = mesh.geometry.getAttribute('position')
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      point.fromBufferAttribute(position, vertex).applyMatrix4(toFabric)
      const key = `${Math.floor(point.x / index.size)},${Math.floor(point.y / index.size)},${Math.floor(point.z / index.size)}`
      let cell = index.cells.get(key)
      if (!cell) index.cells.set(key, (cell = []))
      cell.push({ x: point.x, y: point.y, z: point.z, owner: mesh.geometry })
    }
  }
  return index
}

/**
 * An open edge tucked under another cloth piece (a shirt edge inside a
 * jacket) is not a visible hem: true when another piece lies within reach on
 * the outside of the surface (along its normal) at that point.
 */
function isEdgeCovered(index: ClothPointIndex | null, owner: THREE.BufferGeometry, x: number, y: number, z: number, nx: number, ny: number, nz: number) {
  if (!index) return false
  const cx = Math.floor(x / index.size)
  const cy = Math.floor(y / index.size)
  const cz = Math.floor(z / index.size)
  for (let ix = cx - 1; ix <= cx + 1; ix += 1) {
    for (let iy = cy - 1; iy <= cy + 1; iy += 1) {
      for (let iz = cz - 1; iz <= cz + 1; iz += 1) {
        const cell = index.cells.get(`${ix},${iy},${iz}`)
        if (!cell) continue
        for (const other of cell) {
          if (other.owner === owner) continue
          const dx = other.x - x
          const dy = other.y - y
          const dz = other.z - z
          const distance = Math.hypot(dx, dy, dz)
          if (distance > COVER_RADIUS) continue
          if (dx * nx + dy * ny + dz * nz > -0.004) return true
        }
      }
    }
  }
  return false
}

function bakeFabricAttributes(mesh: THREE.SkinnedMesh, frame: THREE.Matrix4, cover: ClothPointIndex | null = null) {
  const geometry = mesh.geometry
  if (geometry.userData.fabricBaked) return
  geometry.userData.fabricBaked = true
  const position = geometry.getAttribute('position')
  const count = position.count
  const fabricPoints = new Float32Array(count * 3)
  const toFabric = frame.clone().multiply(mesh.bindMatrix)
  const point = new THREE.Vector3()
  for (let index = 0; index < count; index += 1) {
    point.fromBufferAttribute(position, index).applyMatrix4(toFabric)
    fabricPoints[index * 3] = point.x
    fabricPoints[index * 3 + 1] = point.y
    fabricPoints[index * 3 + 2] = point.z
  }

  // Weld coincident vertices, then find the open border edges.
  const weldIds = new Int32Array(count)
  const welded = new Map<string, number>()
  for (let index = 0; index < count; index += 1) {
    const key = `${Math.round(fabricPoints[index * 3]! * 1e4)},${Math.round(fabricPoints[index * 3 + 1]! * 1e4)},${Math.round(fabricPoints[index * 3 + 2]! * 1e4)}`
    let id = welded.get(key)
    if (id === undefined) {
      id = welded.size
      welded.set(key, id)
    }
    weldIds[index] = id
  }
  const nodeCount = welded.size
  const nodePoint = new Float32Array(nodeCount * 3)
  const nodeNormal = new Float32Array(nodeCount * 3)
  const normalAttribute = geometry.getAttribute('normal')
  const normalMatrix = new THREE.Matrix3().setFromMatrix4(toFabric)
  const normal = new THREE.Vector3()
  for (let index = 0; index < count; index += 1) {
    const id = weldIds[index]!
    nodePoint[id * 3] = fabricPoints[index * 3]!
    nodePoint[id * 3 + 1] = fabricPoints[index * 3 + 1]!
    nodePoint[id * 3 + 2] = fabricPoints[index * 3 + 2]!
    if (normalAttribute) {
      normal.fromBufferAttribute(normalAttribute, index).applyMatrix3(normalMatrix)
      nodeNormal[id * 3] += normal.x
      nodeNormal[id * 3 + 1] += normal.y
      nodeNormal[id * 3 + 2] += normal.z
    }
  }
  const index = geometry.getIndex()
  const triangleCount = index ? index.count / 3 : count / 3
  const vertexAt = (i: number) => weldIds[index ? index.getX(i) : i]!
  const edgeUses = new Map<number, number>()
  const neighbours: number[][] = Array.from({ length: nodeCount }, () => [])
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const a = vertexAt(triangle * 3 + corner)
      const b = vertexAt(triangle * 3 + ((corner + 1) % 3))
      if (a === b) continue
      const key = a < b ? a * nodeCount + b : b * nodeCount + a
      const uses = edgeUses.get(key) ?? 0
      edgeUses.set(key, uses + 1)
      if (uses === 0) {
        neighbours[a]!.push(b)
        neighbours[b]!.push(a)
      }
    }
  }
  // Multi-source shortest path from the border along the surface (small graphs: a simple heap).
  const distance = new Float32Array(nodeCount).fill(Infinity)
  const heap: Array<[number, number]> = []
  const push = (d: number, node: number) => {
    heap.push([d, node])
    let i = heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (heap[parent]![0] <= heap[i]![0]) break
      ;[heap[parent], heap[i]] = [heap[i]!, heap[parent]!]
      i = parent
    }
  }
  const pop = () => {
    const top = heap[0]!
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      let i = 0
      for (;;) {
        const left = i * 2 + 1
        const right = left + 1
        let smallest = i
        if (left < heap.length && heap[left]![0] < heap[smallest]![0]) smallest = left
        if (right < heap.length && heap[right]![0] < heap[smallest]![0]) smallest = right
        if (smallest === i) break
        ;[heap[smallest], heap[i]] = [heap[i]!, heap[smallest]!]
        i = smallest
      }
    }
    return top
  }
  for (const [key, uses] of edgeUses) {
    if (uses !== 1) continue
    const a = Math.floor(key / nodeCount)
    const b = key % nodeCount
    for (const node of [a, b]) {
      const nx = nodeNormal[node * 3]!
      const ny = nodeNormal[node * 3 + 1]!
      const nz = nodeNormal[node * 3 + 2]!
      const length = Math.hypot(nx, ny, nz) || 1
      if (isEdgeCovered(cover, geometry, nodePoint[node * 3]!, nodePoint[node * 3 + 1]!, nodePoint[node * 3 + 2]!, nx / length, ny / length, nz / length)) continue
      if (distance[node] !== 0) {
        distance[node] = 0
        push(0, node)
      }
    }
  }
  while (heap.length > 0) {
    const [d, node] = pop()
    if (d > distance[node]! || d > FABRIC_EDGE_RANGE) continue
    for (const next of neighbours[node]!) {
      const step = Math.hypot(
        nodePoint[next * 3]! - nodePoint[node * 3]!,
        nodePoint[next * 3 + 1]! - nodePoint[node * 3 + 1]!,
        nodePoint[next * 3 + 2]! - nodePoint[node * 3 + 2]!
      )
      if (d + step < distance[next]!) {
        distance[next] = d + step
        push(d + step, next)
      }
    }
  }
  const edge = new Float32Array(count * 2)
  for (let vertex = 0; vertex < count; vertex += 1) {
    edge[vertex * 2] = Math.max(0, 1 - distance[weldIds[vertex]!]! / FABRIC_EDGE_RANGE)
  }
  geometry.setAttribute('fabricEdge', new THREE.BufferAttribute(edge, 2))

  // Joint creases from the two strongest skin weights.
  const joint = new Float32Array(count * 3)
  const skinIndex = geometry.getAttribute('skinIndex')
  const skinWeight = geometry.getAttribute('skinWeight')
  if (skinIndex && skinWeight) {
    const bones = mesh.skeleton.bones
    const bonePoints = mesh.skeleton.boneInverses.map(inverse => new THREE.Vector3().setFromMatrixPosition(inverse.clone().invert()).applyMatrix4(frame))
    const axis = new THREE.Vector3()
    for (let vertex = 0; vertex < count; vertex += 1) {
      let first = -1
      let second = -1
      let firstWeight = 0
      let secondWeight = 0
      for (let slot = 0; slot < 4; slot += 1) {
        const weight = skinWeight.getComponent(vertex, slot)
        const bone = skinIndex.getComponent(vertex, slot)
        if (weight > firstWeight) {
          second = first
          secondWeight = firstWeight
          first = bone
          firstWeight = weight
        } else if (weight > secondWeight) {
          second = bone
          secondWeight = weight
        }
      }
      if (first < 0 || second < 0 || firstWeight <= 0) continue
      const strength = creaseWeightFor(bones[first]?.name ?? '', bones[second]?.name ?? '')
      if (strength <= 0) continue
      // Consistent direction (lower bone index first) so neighbours interpolate cleanly.
      const [from, to] = first < second ? [first, second] : [second, first]
      axis.subVectors(bonePoints[to]!, bonePoints[from]!)
      if (axis.lengthSq() < 1e-10) continue
      axis.normalize().multiplyScalar((secondWeight / firstWeight) * strength)
      joint[vertex * 3] = axis.x
      joint[vertex * 3 + 1] = axis.y
      joint[vertex * 3 + 2] = axis.z
    }
  }
  geometry.setAttribute('fabricJoint', new THREE.BufferAttribute(joint, 3))
}

/**
 * Cloth character for the procedural accessories (hats, glasses, jacket
 * overrides), called once they are built. The accessory groups are named
 * `avatar-hat-<style>`, `avatar-glasses-<style>` and `avatar-jacket-<style>-*`.
 */
export function applyAvatarAccessoryFabrics(set: { groups: readonly THREE.Object3D[]; materials: readonly THREE.Material[] } | null | undefined) {
  if (!set) return
  let jacketStyle = ''
  const accessoryMaterials = new Set<THREE.Material>()
  for (const group of set.groups) {
    group.traverse(object => {
      const match = /^avatar-(hat|glasses|jacket)-([a-z]+)/.exec(object.name)
      if (!match) return
      const [, part, style] = match
      if (part === 'jacket') {
        // The group is visited before its child `avatar-jacket-accent`: keep the first (the style).
        if (!jacketStyle && style !== 'accent') jacketStyle = style!
        return
      }
      // Materials by how much of the piece they cover: the biggest is the body of the hat.
      const coverage = new Map<THREE.Material, number>()
      const onTorus = new Set<THREE.Material>()
      let radius = 0
      object.traverse(child => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh || Array.isArray(mesh.material)) return
        const material = mesh.material
        if (!(material as THREE.MeshToonMaterial).isMeshToonMaterial) return
        coverage.set(material, (coverage.get(material) ?? 0) + mesh.geometry.getAttribute('position').count)
        if ((mesh.geometry as THREE.BufferGeometry).type === 'TorusGeometry') onTorus.add(material)
        mesh.geometry.computeBoundingSphere()
        radius = Math.max(radius, (mesh.geometry.boundingSphere?.radius ?? 0) + mesh.position.length())
      })
      if (coverage.size === 0) return
      // Geometry units -> metres (hats span ~0.34 m, glasses ~0.2 m).
      const toMetres = radius > 0 ? (part === 'hat' ? 0.17 : 0.1) / radius : 1
      const frame = new THREE.Matrix4().makeScale(toMetres, toMetres, toMetres)
      const ranked = [...coverage.entries()].sort((a, b) => b[1] - a[1]).map(([material]) => material)
      ranked.forEach((material, rank) => {
        let kind: AvatarFabricKind = 'none'
        if (part === 'glasses') kind = style === 'aviator' ? 'metal' : 'acetate'
        else if (style === 'fedora') kind = rank === 0 ? 'felt' : 'satin'
        else if (style === 'cowboy') kind = rank === 0 ? 'suede' : 'leather'
        else if (style === 'beanie') kind = onTorus.has(material) ? 'felt' : 'knit'
        else if (style === 'visor') kind = rank === 0 ? 'plastic' : 'jersey'
        else if (style === 'crown') kind = 'metal'
        else kind = 'felt'
        setAvatarFabric(material, kind, frame)
        accessoryMaterials.add(material)
      })
    })
  }
  // Rigged jacket overrides are clones of the body's own cloth materials.
  if (jacketStyle && jacketStyle !== 'none') {
    const kind: AvatarFabricKind | null = jacketStyle === 'leather' ? 'leather' : jacketStyle === 'tuxedo' || jacketStyle === 'smoking' ? 'wool' : jacketStyle === 'western' ? 'suede' : jacketStyle === 'varsity' ? 'wool' : null
    if (kind) {
      for (const material of set.materials) {
        if (material.userData[FABRIC_KIND_KEY] && material.userData[FABRIC_KIND_KEY] !== 'none' && !accessoryMaterials.has(material)) setAvatarFabric(material, kind)
      }
    }
  }
}

export interface StylizedAvatar {
  materials: THREE.Material[]
  outlineMeshes: THREE.Object3D[]
  eyeMaterials: THREE.MeshToonMaterial[]
  eyeColors: THREE.Color[]
  skinColor: THREE.Color | null
}

/**
 * Converts every mesh in the rig to toon shading and adds an ink outline to
 * skinned meshes. Returns the new per-instance materials (the originals are
 * disposed) plus the eye materials used for blinking.
 */
export function stylizeAvatar(
  model: THREE.Object3D,
  previous: readonly THREE.Material[],
  look: AvatarLook = {}
): StylizedAvatar {
  // One toon material per source material and cloth kind (the worker's hard
  // hat and vest tape share a GLB material but not a fabric).
  const converted = new Map<string, THREE.MeshToonMaterial>()
  const outlineMeshes: THREE.Object3D[] = []
  const skinnedMeshes: THREE.SkinnedMesh[] = []
  const clothMeshes: THREE.SkinnedMesh[] = []
  const family = detectOutfitFamily(model)

  model.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    let cloth = false
    const convert = (material: THREE.Material) => {
      const kind = fabricKindFor(family, material.name, mesh.name)
      if (kind !== 'none') cloth = true
      const key = `${material.uuid}:${kind}`
      let toon = converted.get(key)
      if (!toon) {
        toon = toToonMaterial(material)
        setAvatarFabric(toon, kind)
        converted.set(key, toon)
      }
      return toon
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material)
    smoothTemplateNormals(mesh.geometry)
    // Cel-shaded characters read cleaner without self-shadow acne from the
    // key light's soft shadow map (it broke skin and cloth into dithered blotches).
    mesh.receiveShadow = false
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      skinnedMeshes.push(mesh as THREE.SkinnedMesh)
      if (cloth) clothMeshes.push(mesh as THREE.SkinnedMesh)
    }
  })
  applyLook(model, converted.values(), look)
  if (clothMeshes.length > 0) {
    const frame = computeFabricFrame(skinnedMeshes)
    const cover = clothMeshes.some(mesh => !mesh.geometry.userData.fabricBaked) ? buildClothPointIndex(clothMeshes, frame) : null
    for (const mesh of clothMeshes) bakeFabricAttributes(mesh, frame, cover)
    for (const material of converted.values()) {
      const kind = material.userData[FABRIC_KIND_KEY] as AvatarFabricKind | undefined
      if (kind && kind !== 'none') setAvatarFabric(material, kind, frame)
    }
  }

  const outlineMaterials: THREE.Material[] = []
  // Perf: every outline is a second skinned draw. Legs/feet hide under the
  // table skirt and small parts (eyes, teeth, trims) read fine without ink, so
  // only the largest few shells (body, head, hair) get a hull.
  const vertexCountOf = (mesh: THREE.SkinnedMesh) => mesh.geometry.getAttribute('position').count
  const outlined = new Set(
    skinnedMeshes
      .filter(mesh => !/legs|feet|foot/i.test(mesh.name) && vertexCountOf(mesh) >= OUTLINE_MIN_VERTICES)
      .sort((a, b) => vertexCountOf(b) - vertexCountOf(a))
      .slice(0, MAX_OUTLINES_PER_AVATAR)
  )
  for (const mesh of skinnedMeshes) {
    // Shadow pass cost: hidden legs/feet and tiny parts never cast.
    if (/legs|feet|foot/i.test(mesh.name) || vertexCountOf(mesh) < SHADOW_MIN_VERTICES) mesh.castShadow = false
  }
  for (const mesh of skinnedMeshes) {
    if (!outlined.has(mesh)) continue
    mesh.geometry.computeBoundingSphere()
    const radius = mesh.geometry.boundingSphere?.radius ?? 1
    const outlineMaterial = createOutlineMaterial(radius * OUTLINE_WIDTH_RATIO)
    outlineMaterials.push(outlineMaterial)
    const outline = new THREE.SkinnedMesh(getOutlineGeometry(mesh.geometry), outlineMaterial)
    outline.name = `${mesh.name}-outline`
    outline.bind(mesh.skeleton, mesh.bindMatrix)
    outline.frustumCulled = false
    outline.castShadow = false
    outline.receiveShadow = false
    outline.renderOrder = mesh.renderOrder
    outline.position.copy(mesh.position)
    outline.quaternion.copy(mesh.quaternion)
    outline.scale.copy(mesh.scale)
    mesh.parent?.add(outline)
    outlineMeshes.push(outline)
  }

  previous.forEach(material => material.dispose())

  const materials = [...converted.values(), ...outlineMaterials]
  const eyeMaterials = [...converted.values()].filter(material => /^eye$/i.test(material.name))
  const skin = [...converted.values()].find(material => /^skin$/i.test(material.name))
  return {
    materials,
    outlineMeshes,
    eyeMaterials,
    eyeColors: eyeMaterials.map(material => material.color.clone()),
    skinColor: skin ? skin.color.clone() : null,
  }
}

/** Closes the eyes (eye colour → skin colour) for `closed` in 0..1. */
export function applyBlink(style: StylizedAvatar, closed: number) {
  if (!style.skinColor) return
  style.eyeMaterials.forEach((material, index) => {
    const open = style.eyeColors[index]
    if (open) material.color.copy(open).lerp(style.skinColor!, closed)
  })
}

/** A natural blink schedule: quick double-blinks now and then. */
export function getBlinkAmount(time: number, seed: number) {
  const period = 3.4 + seed * 2.2
  const phase = (time + seed * 17) % period
  const blink = (start: number) => {
    const t = (phase - start) / 0.13
    return t >= 0 && t <= 1 ? Math.sin(t * Math.PI) : 0
  }
  return Math.max(blink(0), seed > 0.6 ? blink(0.22) : 0)
}
