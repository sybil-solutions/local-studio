import { fullscreen_clip_position, fullscreen_uv } from "../shared/fullscreen.wgsl";
import { aces_tonemap, linear_to_display } from "../shared/tonemap.wgsl";

// Bloom composite pass. Adds finite-radius blurred bloom in linear HDR, then tonemaps once.

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

struct CompositeParams {
  strength: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var sceneTexture: texture_2d<f32>;
@group(0) @binding(1) var bloomTexture: texture_2d<f32>;
@group(0) @binding(2) var texSampler: sampler;
@group(0) @binding(3) var<uniform> params: CompositeParams;

const BLOOM_RADIAL_FULL_RADIUS = 0.55;
const MAX_DARK_DISPLAY_LUMA = 0.42;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;
  output.position = fullscreen_clip_position(vertexIndex);
  output.uv = fullscreen_uv(vertexIndex);
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let scene = textureSample(sceneTexture, texSampler, input.uv);
  let bloom = textureSample(bloomTexture, texSampler, input.uv).rgb;
  let sceneSize = vec2f(textureDimensions(sceneTexture));
  let aspectCorrectUv = (input.uv - vec2f(0.5)) * vec2f(sceneSize.x / max(sceneSize.y, 1.0), 1.0);
  let bloomRadial = smoothstep(0.0, BLOOM_RADIAL_FULL_RADIUS, length(aspectCorrectUv));
  // eve.dev composites onto an opaque canvas, so its bloom is allowed to add
  // light outside the logo silhouette. This hero composites over the page, so
  // gate the glow by scene alpha to keep it hugging the mark instead of
  // floating as a faint disc behind it.
  let bloomMask = smoothstep(0.0, 0.4, scene.a);
  // The MSAA scene target stores premultiplied color. Recover straight color
  // before nonlinear tone mapping, then premultiply exactly once for canvas output.
  let straightScene = scene.rgb / max(scene.a, 0.0001);
  let linearColor = straightScene + bloom * params.strength * bloomRadial * bloomMask;
  let displayColor = linear_to_display(aces_tonemap(linearColor));
  let displayLuma = dot(displayColor, vec3f(0.2126, 0.7152, 0.0722));
  let nightSky = displayColor * min(1.0, MAX_DARK_DISPLAY_LUMA / max(displayLuma, 0.001));
  return vec4f(nightSky * scene.a, scene.a);
}
