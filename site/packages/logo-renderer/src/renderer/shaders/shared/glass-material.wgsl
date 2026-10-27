import { env_reflection_from_dir } from "./material-core.wgsl";

// Optical profile requested for the hero: low-index polished glass with visible
// spectral separation. The back and front mesh passes apply this at both interfaces.
const IOR = 1.2;
const ROUGHNESS = 0.015;
const DISPERSION_SPREAD = 0.035;

export fn dielectric_fresnel_schlick(cosTheta: f32, f0: vec3f) -> vec3f {
  let m = clamp(1.0 - cosTheta, 0.0, 1.0);
  let factor = pow(m, 5.0);
  return f0 + (vec3f(1.0) - f0) * factor;
}

export fn beer_lambert_transmittance(absorption: vec3f, thickness: f32) -> vec3f {
  return exp(-absorption * thickness);
}

fn environment_sample(
  studioCube: texture_2d_array<f32>,
  studioSampler: sampler,
  direction: vec3f,
  envYaw: f32,
  envPitch: f32,
) -> vec3f {
  let axis = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(direction.y) > 0.9);
  let tangent = normalize(cross(axis, direction));
  let center = env_reflection_from_dir(studioCube, studioSampler, direction, envYaw, envPitch);
  let left = env_reflection_from_dir(studioCube, studioSampler, normalize(direction - tangent * ROUGHNESS), envYaw, envPitch);
  let right = env_reflection_from_dir(studioCube, studioSampler, normalize(direction + tangent * ROUGHNESS), envYaw, envPitch);
  return center * 0.92 + (left + right) * 0.04;
}

fn dispersed_transmission(
  studioCube: texture_2d_array<f32>,
  studioSampler: sampler,
  normal: vec3f,
  view: vec3f,
  envYaw: f32,
  envPitch: f32,
) -> vec3f {
  let incident = -view;
  let redDirection = refract(incident, normal, 1.0 / (IOR - DISPERSION_SPREAD * 0.5));
  let greenDirection = refract(incident, normal, 1.0 / IOR);
  let blueDirection = refract(incident, normal, 1.0 / (IOR + DISPERSION_SPREAD * 0.5));
  let fallback = normalize(mix(incident, reflect(incident, normal), 0.12));
  let red = environment_sample(studioCube, studioSampler, select(fallback, redDirection, dot(redDirection, redDirection) > 0.0), envYaw, envPitch);
  let green = environment_sample(studioCube, studioSampler, select(fallback, greenDirection, dot(greenDirection, greenDirection) > 0.0), envYaw, envPitch);
  let blue = environment_sample(studioCube, studioSampler, select(fallback, blueDirection, dot(blueDirection, blueDirection) > 0.0), envYaw, envPitch);
  return vec3f(red.r, green.g, blue.b);
}

fn grade_transmitted_light(radiance: vec3f) -> vec3f {
  // The supplied LDR sky atlases have compressed dark values. Restore a
  // studio-like light-to-shadow range only in transmission; reflected cards
  // retain their current color and intensity.
  let luminance = dot(radiance, vec3f(0.2126, 0.7152, 0.0722));
  let lighting = mix(0.48, 1.06, smoothstep(0.12, 0.75, luminance));
  return radiance * lighting;
}

export fn shade_glass(
  studioCube: texture_2d_array<f32>,
  studioSampler: sampler,
  n: vec3f,
  v: vec3f,
  reflected: vec3f,
  envYaw: f32,
  envPitch: f32,
  inside: bool,
  absorptionStrength: f32,
) -> vec4f {
  let ndotv = clamp(dot(n, v), 0.0, 1.0);
  let f0 = pow((IOR - 1.0) / (IOR + 1.0), 2.0);
  let fresnel = dielectric_fresnel_schlick(ndotv, vec3f(f0));
  let reflection = environment_sample(studioCube, studioSampler, reflected, envYaw, envPitch);
  let transmissionSample = dispersed_transmission(studioCube, studioSampler, n, v, envYaw, envPitch);
  let transmittedLight = grade_transmitted_light(transmissionSample);

  let baseThickness = select(0.20, 0.12, inside);
  let thickness = clamp(baseThickness / max(ndotv, 0.08), 0.04, 2.0);
  let absorption = beer_lambert_transmittance(vec3f(0.14) * absorptionStrength, thickness);
  let transmission = transmittedLight * absorption * (vec3f(1.0) - fresnel);
  // Dark cubemap directions can otherwise form a thin black ring where Fresnel
  // becomes reflection-only. Fill only those missing grazing reflections from
  // the local transmitted environment; brighter reflection detail is untouched.
  let rimWeight = pow(clamp(1.0 - ndotv, 0.0, 1.0), 3.0);
  let rimFloor = transmittedLight * 0.22;
  let seamlessReflection = mix(reflection, max(reflection, rimFloor), rimWeight);
  // A transparent hero has no GPU-rendered floor behind the object as the
  // Transmission example does. Keep front faces genuinely transmissive and
  // increase coverage only toward grazing angles, where glass is reflective.
  let grazing = pow(clamp(1.0 - ndotv, 0.0, 1.0), 0.65);
  let opacity = mix(0.36, 0.86, grazing);
  return vec4f(
    transmission + seamlessReflection * fresnel,
    select(opacity, opacity * 0.65, inside),
  );
}
