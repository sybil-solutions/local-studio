// Back-surface refraction helpers for the front glass entry shader.
// INVARIANT: texture/sampler resources are passed as parameters; this module declares no bindings.
// INVARIANT: fallback 1x1 back-depth texture means zero thickness and disables absorption.

const BACK_MIN_TRANSMISSION = 0.38;
const BACK_ABSORPTION_TINT = vec3f(0.9);

export fn normalized_thickness(
  backDepthTexture: texture_2d<f32>,
  cameraAxisDepth: f32,
  thicknessScale: f32,
  pixel: vec2i,
  backSize: vec2i,
) -> f32 {
  // A 1x1 back-depth texture is the fallback used before a depth map is available.
  // Treat it as zero thickness so absorption remains disabled.
  if (backSize.x <= 1 || backSize.y <= 1 || !all(pixel >= vec2i(0)) || !all(pixel < backSize)) {
    return 0.0;
  }

  let backCameraAxisDepth = textureLoad(backDepthTexture, pixel, 0).r;
  let thickness = max(backCameraAxisDepth - cameraAxisDepth, 0.0);
  return clamp(thickness / max(thicknessScale, 0.000001), 0.0, 1.0);
}

export fn blurred_back_contribution(
  backMaterialTexture: texture_2d<f32>,
  backDepthTexture: texture_2d<f32>,
  backSampler: sampler,
  uv: vec2f,
  pixel: vec2i,
  cameraAxisDepth: f32,
  thicknessScale: f32,
  glassAbsorption: f32,
) -> vec3f {
  let normalizedThickness = normalized_thickness(
    backDepthTexture,
    cameraAxisDepth,
    thicknessScale,
    pixel,
    vec2i(textureDimensions(backDepthTexture)),
  );
  let backContribution = textureSampleLevel(backMaterialTexture, backSampler, uv, 0.0).rgb;
  let thicknessFade = pow(clamp(normalizedThickness, 0.0, 1.0), 0.5);
  let absorptionFade = thicknessFade * glassAbsorption;
  let transmission = mix(1.0, BACK_MIN_TRANSMISSION, absorptionFade);
  let absorptionTint = mix(vec3f(1.0), BACK_ABSORPTION_TINT, absorptionFade);
  // The rear interface is the second refraction, not a second full-strength sky.
  return backContribution * transmission * absorptionTint * 0.18;
}
