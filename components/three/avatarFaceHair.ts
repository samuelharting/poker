import * as THREE from 'three'

/**
 * Light facial hair (a white or blond moustache) is a rigid part of the head mesh, and its bright
 * crescent reads as a toothy grin whatever the mouth ribbon does. This wraps the hair material's
 * shader (no extra draw call) so that, in the mouth region only, the hair is toned down a little and
 * shaded towards its lower edge and outer tips. The shading strength follows the emotion: neutral
 * and frowning faces get a soft lip shadow that hides the smile shape, happy faces keep the hair
 * bright. Head-space position comes from the vertex shader (bind-pose to Head bone matrix uniform).
 */
export interface FacialHairShade {
  uniforms: {
    uHairToHead: { value: THREE.Matrix4 }
    /** x = frown weight 0..1, y = moustache lower edge (Head y), z = unit (eye radius), w = mouth centre x. */
    uHairShade: { value: THREE.Vector4 }
  }
  restore: () => void
}

export function installFacialHairShade(
  material: THREE.MeshToonMaterial,
  toHead: THREE.Matrix4,
  edgeY: number,
  unit: number,
  centerX: number
): FacialHairShade {
  const uniforms = {
    uHairToHead: { value: toHead.clone() },
    uHairShade: { value: new THREE.Vector4(0.3, edgeY, unit, centerX) },
  }
  const previous = material.onBeforeCompile
  const previousKey = material.customProgramCacheKey
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHairHeadP;\nuniform mat4 uHairToHead;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vHairHeadP = (uHairToHead * vec4(position, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHairHeadP;\nuniform vec4 uHairShade;')
      .replace(
        '#include <opaque_fragment>',
        `{
      float hu = uHairShade.z;
      float hy = (vHairHeadP.y - uHairShade.y) / hu;
      float hx = abs(vHairHeadP.x - uHairShade.w) / hu;
      // Moustache zone: a band around the mouth, in front of the face, not the hair above the eyes.
      float zone = smoothstep(-1.2, -0.5, hy) * (1.0 - smoothstep(0.9, 1.5, hy)) * (1.0 - smoothstep(1.5, 2.3, hx));
      float lower = 1.0 - smoothstep(-0.1, 0.75, hy);
      float tips = smoothstep(0.35, 1.25, hx);
      float shade = zone * (0.12 + uHairShade.x * (0.36 * lower + 0.34 * tips));
      outgoingLight *= 1.0 - shade;
      outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.9, 0.88, 0.9), zone * 0.5);
    }
    #include <opaque_fragment>`
      )
  }
  material.customProgramCacheKey = () => 'avatar-facial-hair-shade-v1'
  material.needsUpdate = true
  return {
    uniforms,
    restore() {
      material.onBeforeCompile = previous
      material.customProgramCacheKey = previousKey
      material.needsUpdate = true
    },
  }
}
