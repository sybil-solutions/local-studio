import { cube_dir } from "../shared/cube-face.wgsl";

const MAX_ENV_LIGHTS = 16u;

struct EnvLight {
  positionRadius: vec4f,
  colorIntensity: vec4f,
  params: vec4f,
};

struct CubeParams {
  face: f32,
  lightCount: f32,
  _pad0: f32,
  _pad1: f32,
  lights: array<EnvLight, 16>,
};

struct VertexOutput {
  @builtin(position) clipPosition: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var<uniform> params: CubeParams;

// Cloud-sky base layer. The site wants "freedom": a metallic mark mirroring an
// open sky. The sky (gradient + FBM clouds + sun) is baked here, once, under
// the eve.dev HDR softbox layer; per-frame material shaders only sample the
// baked cubemap array, so runtime cost is a plain texture fetch.

const SUN_DIRECTION = vec3f(0.32, 0.44, 0.84);
const WIND_OFFSET = vec2f(2.7, -1.4);
const CLOUD_COVERAGE_LO = 0.46;
const CLOUD_COVERAGE_HI = 0.74;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let xy = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  let p = xy[vertexIndex];
  var output: VertexOutput;
  output.clipPosition = vec4f(p, 0.0, 1.0);
  // The rasterizer writes clip-top (p.y = +1) to texel row 0, but cube_dir/cube_lookup_uv_face
  // treat uv.y as texture-v growing DOWNWARD (p.y = 2v-1). Without flipping v here, the baked
  // face is stored vertically mirrored relative to how the sampler reads it, which inverts +Y
  // and disagrees with the /cube-camera rasterized capture. Flip v so bake matches read.
  output.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return output;
}

fn spot(dir: vec3f, center: vec3f, radius: f32, softness: f32, luminance: f32, color: vec3f, intensity: f32) -> vec3f {
  let d = distance(normalize(dir), normalize(center));
  let soft = clamp(softness, 0.0, 1.0);
  // Gaussian softboxes keep an HDR tail instead of clamping to exact zero at radius.
  // This avoids content-driven hard cuts in reflected highlights when only one or two
  // manually edited lights are enabled. Radius still controls apparent card size;
  // softness widens/narrows the falloff without changing the desaturated white color.
  let sigma = max(radius * mix(0.35, 0.85, soft), 0.001);
  let t = exp(-0.5 * (d / sigma) * (d / sigma));
  // Units are scene-linear relative cd/m^2-ish values.
  return color * (t * luminance * intensity);
}

fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn value_noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 5-octave FBM with a per-octave rotation to break axis alignment.
fn fbm(p: vec2f) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var freq = 1.0;
  let rot = mat2x2f(0.8, 0.6, -0.6, 0.8);
  var q = p;
  for (var i = 0; i < 5; i++) {
    sum += value_noise(q * freq) * amp;
    q = rot * q;
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

fn cloud_field(dir: vec3f) -> vec2f {
  // Perspective projection of a cloud layer at fixed altitude: the view ray
  // hits the layer plane far away near the horizon, compressing detail there.
  // Returns (coverage, detail); detail doubles as a thickness proxy for
  // shading: thin edges glow, thick cores darken.
  let uv = dir.xz / (dir.y + 0.12) * 1.15 + WIND_OFFSET;
  let shape = fbm(uv * 0.55);
  let detail = fbm(uv * 1.35 + vec2f(3.7, 1.1));
  let density = shape * 0.72 + detail * 0.38;
  return vec2f(smoothstep(CLOUD_COVERAGE_LO, CLOUD_COVERAGE_HI, density), detail);
}

fn sky_radiance(dir: vec3f) -> vec3f {
  let y = dir.y;
  // Clear blue vertical gradient, scene-linear. The saturated sky separates
  // from the black page while keeping the chrome silhouette dark.
  let zenith = vec3f(0.035, 0.110, 0.300);
  let horizon = vec3f(0.300, 0.560, 0.900);
  let horizonWeight = pow(1.0 - clamp(y, 0.0, 1.0), 2.2);
  var radiance = mix(zenith, horizon, horizonWeight);

  let cosSun = dot(dir, SUN_DIRECTION);

  if (y > 0.015) {
    let field = cloud_field(dir);
    let density = field.x;
    // Bright cloud tops and blue-grey cores stay readable on the metal.
    let thickness = clamp(field.y * 0.9 + 0.25, 0.0, 1.0);
    let body = mix(vec3f(0.820, 0.900, 1.000), vec3f(0.150, 0.240, 0.390), thickness);
    let silverLining = pow(max(cosSun, 0.0), 4.0) * 0.48;
    let cloudColor = body + vec3f(silverLining);
    // Clouds compress into haze at the horizon instead of aliasing.
    let horizonFade = smoothstep(0.015, 0.18, y);
    radiance = mix(radiance, cloudColor, density * horizonFade);
  }

  // Crisp HDR sun: a small hot disc whose glint sweeps across the metal as
  // the pointer rotates the environment, plus a restrained atmospheric halo.
  radiance += vec3f(1.0, 0.97, 0.92) * pow(max(cosSun, 0.0), 1400.0) * 26.0;
  radiance += vec3f(0.9, 0.95, 1.0) * pow(max(cosSun, 0.0), 9.0) * 0.18;

  return radiance;
}


@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let dir = cube_dir(params.face, input.uv);

  // Cloud sky base with high-dynamic-range configurable cards/softboxes on top.
  var radiance = sky_radiance(dir);
  let lightCount = min(u32(params.lightCount), MAX_ENV_LIGHTS);

  for (var index = 0u; index < MAX_ENV_LIGHTS; index += 1u) {
    if (index >= lightCount) {
      break;
    }

    let light = params.lights[index];
    radiance += spot(
      dir,
      light.positionRadius.xyz,
      light.positionRadius.w,
      light.params.x,
      light.params.y,
      light.colorIntensity.rgb,
      light.colorIntensity.w,
    );
  }

  return vec4f(radiance, 1.0);
}
