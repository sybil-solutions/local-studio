// Public vgpu geometry creation plus normalization and line-index generation.
import { geometry, type Gpu } from "vgpu";
import type { Bounds, GpuMesh, MeshData } from "./types";

export function createGpuMesh(gpu: Gpu, mesh: MeshData): GpuMesh {
  const vertices = normalizeMeshForGpu(mesh);
  const triangles = geometry(gpu, {
    label: "eve-5-logo-triangles",
    vertexCount: vertices.length / 6,
    buffers: [
      {
        data: vertices,
        stride: 24,
        attributes: { position: "float32x3", normal: "float32x3" },
      },
    ],
    indices: new Uint32Array(mesh.indices),
  });
  const lines = geometry(gpu, {
    label: "eve-5-logo-lines",
    topology: "line-list",
    vertexCount: vertices.length / 6,
    buffers: [
      {
        buffer: triangles.buffers[0]!.gpu,
        stride: 24,
        attributes: { position: "float32x3", normal: "float32x3" },
      },
    ],
    indices: triangleIndicesToLineIndices(mesh.indices),
  });
  return { triangles, lines };
}

export function normalizedMeshBounds(bounds: Bounds): Bounds {
  const height = bounds.max[1] - bounds.min[1] || 1;
  const centerX = (bounds.min[0] + bounds.max[0]) * 0.5;
  const centerY = (bounds.min[1] + bounds.max[1]) * 0.5;
  const frontZ = bounds.max[2];
  return {
    min: [
      (bounds.min[0] - centerX) / height,
      (bounds.min[1] - centerY) / height,
      (bounds.min[2] - frontZ) / height,
    ],
    max: [
      (bounds.max[0] - centerX) / height,
      (bounds.max[1] - centerY) / height,
      (bounds.max[2] - frontZ) / height,
    ],
  };
}

function normalizeMeshForGpu(mesh: MeshData) {
  const height = mesh.bounds.max[1] - mesh.bounds.min[1];
  const centerX = (mesh.bounds.min[0] + mesh.bounds.max[0]) * 0.5;
  const centerY = (mesh.bounds.min[1] + mesh.bounds.max[1]) * 0.5;
  const frontZ = mesh.bounds.max[2];
  const data = new Float32Array((mesh.positions.length / 3) * 6);
  for (let i = 0, j = 0; i < mesh.positions.length; i += 3, j += 6) {
    data[j] = (mesh.positions[i]! - centerX) / height;
    data[j + 1] = (mesh.positions[i + 1]! - centerY) / height;
    data[j + 2] = (mesh.positions[i + 2]! - frontZ) / height;
    data[j + 3] = mesh.normals[i]!;
    data[j + 4] = mesh.normals[i + 1]!;
    data[j + 5] = mesh.normals[i + 2]!;
  }
  return data;
}
function triangleIndicesToLineIndices(indices: Uint32Array) {
  const lines = new Uint32Array(indices.length * 2);
  for (let i = 0, j = 0; i < indices.length; i += 3, j += 6) {
    const a = indices[i]!,
      b = indices[i + 1]!,
      c = indices[i + 2]!;
    lines.set([a, b, b, c, c, a], j);
  }
  return lines;
}
