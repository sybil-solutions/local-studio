import { fullscreen_clip_position, fullscreen_uv } from "../shared/fullscreen.wgsl";
import { aces_tonemap, linear_to_display } from "../shared/tonemap.wgsl";

// Light-mode composite pass. Tonemaps scene color and writes premultiplied alpha for a transparent canvas.

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var sceneTexture: texture_2d<f32>;
@group(0) @binding(1) var texSampler: sampler;


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
  let straightScene = scene.rgb / max(scene.a, 0.0001);
  let sky = linear_to_display(aces_tonemap(straightScene));
  // Preserve hue and movement while keeping every possible reflected pixel
  // pale enough for the site's dark foreground APCA roles.
  let rgb = mix(sky, vec3f(1.0), 0.80);
  let a = clamp(scene.a, 0.0, 1.0);
  return vec4f(rgb * a, a);
}
