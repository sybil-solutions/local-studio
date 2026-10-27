// Shared SVG-subpath -> swept extruded-solid mesh machinery.
// Extracted verbatim from generate-logo-mesh.mjs so the committed logo mesh
// stays byte-identical; new marks reuse the same fillet/cap pipeline.
import earcut from "earcut";
import fs from "node:fs";

export const FLATTEN_TOLERANCE = 0.06; // svg units; silhouette smoothness budget
export const MAX_BEZIER_DEPTH = 24;

export function parseSubpath(data) {
  // Supports the subset needed by the brand paths: m/M, c/C, l/L, z/Z.
  const tokens = data.match(/[mMcClLzZ]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let i = 0;
  let cursor = [0, 0];
  let start = [0, 0];
  const contours = [];
  let contour = [];
  const readNumber = () => Number(tokens[i++]);
  const readPoint = () => [readNumber(), readNumber()];
  while (i < tokens.length) {
    const raw = tokens[i++];
    const cmd = raw.toLowerCase();
    const absolute = raw !== cmd;
    if (cmd === "m") {
      if (contour.length > 1) contours.push(contour);
      const p = readPoint();
      cursor = absolute ? p : [cursor[0] + p[0], cursor[1] + p[1]];
      start = [...cursor];
      contour = [cursor];
    } else if (cmd === "c") {
      const read = () => {
        const p = readPoint();
        return absolute ? p : [cursor[0] + p[0], cursor[1] + p[1]];
      };
      const c1 = read();
      const c2 = read();
      const end = read();
      contour.push(...flattenCubic(cursor, c1, c2, end, 0));
      cursor = end;
    } else if (cmd === "l") {
      const p = readPoint();
      cursor = absolute ? p : [cursor[0] + p[0], cursor[1] + p[1]];
      contour.push(cursor);
    } else if (cmd === "z") {
      contour.push(start);
      cursor = [...start];
    } else {
      throw new Error(`Unsupported path command: ${raw}`);
    }
  }
  if (contour.length > 1) contours.push(contour);
  return contours;
}

function flattenCubic(p0, p1, p2, p3, depth) {
  // Flatness: control points close to the chord p0->p3.
  const dx = p3[0] - p0[0];
  const dy = p3[1] - p0[1];
  const d1 = Math.abs((p1[0] - p3[0]) * dy - (p1[1] - p3[1]) * dx);
  const d2 = Math.abs((p2[0] - p3[0]) * dy - (p2[1] - p3[1]) * dx);
  if (depth >= MAX_BEZIER_DEPTH || (d1 + d2) ** 2 <= FLATTEN_TOLERANCE ** 2 * (dx * dx + dy * dy)) {
    return depth === 0 ? [p3] : [p3];
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const p01 = mid(p0, p1);
  const p12 = mid(p1, p2);
  const p23 = mid(p2, p3);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const p0123 = mid(p012, p123);
  return [
    ...flattenCubic(p0, p01, p012, p0123, depth + 1),
    ...flattenCubic(p0123, p123, p23, p3, depth + 1),
  ];
}

export function dedupeContour(points) {
  const out = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1e-6) out.push(p);
  }
  while (
    out.length > 1 &&
    Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-6
  ) {
    out.pop();
  }
  return out;
}

export function signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

export function contourNormals(points) {
  // Outward 2D normals from neighbor tangents. The dense adaptive sampling
  // keeps these smooth along G1 curves.
  const n = points.length;
  const normals = Array.from({ length: n });
  for (let i = 0; i < n; i += 1) {
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    let tx = next[0] - prev[0];
    let ty = next[1] - prev[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    // For CCW winding, (ty, -tx) points outward.
    normals[i] = [ty, -tx];
  }
  return normals;
}

export function assertSimpleContour(points, label) {
  const cross = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    for (let j = i + 2; j < points.length; j += 1) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j];
      const d = points[(j + 1) % points.length];
      const abC = cross(a, b, c);
      const abD = cross(a, b, d);
      const cdA = cross(c, d, a);
      const cdB = cross(c, d, b);
      if (abC * abD < -1e-14 && cdA * cdB < -1e-14)
        throw new Error(`${label} self-intersects at segments ${i} and ${j}`);
    }
  }
}

export function assertDisjointContours(contours, label) {
  const cross = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let first = 0; first < contours.length; first += 1) {
    for (let second = first + 1; second < contours.length; second += 1) {
      const a = contours[first];
      const b = contours[second];
      for (let i = 0; i < a.length; i += 1) {
        for (let j = 0; j < b.length; j += 1) {
          const abC = cross(a[i], a[(i + 1) % a.length], b[j]);
          const abD = cross(a[i], a[(i + 1) % a.length], b[(j + 1) % b.length]);
          const cdA = cross(b[j], b[(j + 1) % b.length], a[i]);
          const cdB = cross(b[j], b[(j + 1) % b.length], a[(i + 1) % a.length]);
          if (abC * abD < -1e-14 && cdA * cdB < -1e-14)
            throw new Error(`${label} contours ${first} and ${second} intersect`);
        }
      }
    }
  }
}

// Sweeps every contour through a quarter-circle fillet profile and returns the
// side-wall mesh plus per-contour cap vertex ranges. Cap triangulation policy
// (holes vs disjoint outers) stays with the caller.
export function buildSweptSolid(contours, contourNormals2d, bevelContours, {
  halfThickness,
  filletRadius,
  filletSteps,
}) {
  const positions = [];
  const normals = [];
  const indices = [];
  const capCoordinates = [];
  const holeStarts = [];
  const frontCapVertices = [];
  const backCapVertices = [];
  const perContour = [];
  const T = halfThickness;
  const r = filletRadius;
  const K = filletSteps;
  const fillet = (k) => {
    const alpha = (k / K) * (Math.PI / 2);
    return { inset: r * Math.sin(alpha), z: T - r + r * Math.cos(alpha) };
  };

  for (let contourIndex = 0; contourIndex < contours.length; contourIndex += 1) {
    const outline = contours[contourIndex];
    const n = outline.length;
    const normals2d = contourNormals2d[contourIndex];
    if (contourIndex > 0) holeStarts.push(capCoordinates.length / 2);
    const coordinateStart = capCoordinates.length / 2;
    for (const point of outline) capCoordinates.push(...point);

    const pushRing = (inset, z, normalFor) => {
      const start = positions.length / 3;
      for (let i = 0; i < n; i += 1) {
        const point = outline[i];
        const normal2d = normals2d[i];
        positions.push(
          point[0] - normal2d[0] * inset,
          point[1] - normal2d[1] * inset,
          z,
        );
        normals.push(...normalFor(i));
      }
      return start;
    };
    const linkRings = (a, b) => {
      for (let i = 0; i < n; i += 1) {
        const j = (i + 1) % n;
        indices.push(a + i, b + i, b + j, a + i, b + j, a + j);
      }
    };

    const frontCap = pushRing(0, T, () => [0, 0, 1]);
    for (let i = 0; i < n; i += 1) frontCapVertices.push(frontCap + i);
    const frontRings = [];
    for (let k = 1; k <= K; k += 1) {
      const { inset, z } = fillet(k);
      const alpha = (k / K) * (Math.PI / 2);
      frontRings.push(
        pushRing(inset, z, (i) => [
          normals2d[i][0] * Math.sin(alpha),
          normals2d[i][1] * Math.sin(alpha),
          Math.cos(alpha),
        ]),
      );
    }
    const wallTop = frontRings[frontRings.length - 1];
    const wallBottom = pushRing(r, -(T - r), (i) => [
      normals2d[i][0],
      normals2d[i][1],
      0,
    ]);
    const backRings = [];
    for (let k = K - 1; k >= 1; k -= 1) {
      const { inset, z } = fillet(k);
      const alpha = (k / K) * (Math.PI / 2);
      backRings.push(
        pushRing(inset, -z, (i) => [
          normals2d[i][0] * Math.sin(alpha),
          normals2d[i][1] * Math.sin(alpha),
          -Math.cos(alpha),
        ]),
      );
    }
    const backCap = pushRing(0, -T, () => [0, 0, -1]);
    for (let i = 0; i < n; i += 1) backCapVertices.push(backCap + i);

    let upper = frontCap;
    for (const ring of frontRings) {
      linkRings(upper, ring);
      upper = ring;
    }
    linkRings(wallTop, wallBottom);
    upper = wallBottom;
    for (const ring of backRings) {
      linkRings(upper, ring);
      upper = ring;
    }
    linkRings(upper, backCap);

    perContour.push({
      coordinateStart,
      frontStart: frontCap,
      backStart: backCap,
      count: n,
    });
  }

  return {
    positions,
    normals,
    indices,
    capCoordinates,
    holeStarts,
    frontCapVertices,
    backCapVertices,
    perContour,
    earcut,
  };
}

export function writeGltf(mesh, options) {
  const { outGltf, outBin, binUri, generator, name, check } = options;
  const vertexCount = mesh.positions.length / 3;
  const positionBytes = mesh.positions.byteLength;
  const normalBytes = mesh.normals.byteLength;
  const indexBytes = mesh.indices.byteLength;
  const bufferLength = positionBytes + normalBytes + indexBytes;
  const buffer = new Uint8Array(bufferLength);
  buffer.set(new Uint8Array(mesh.positions.buffer, 0, positionBytes), 0);
  buffer.set(new Uint8Array(mesh.normals.buffer, 0, normalBytes), positionBytes);
  buffer.set(new Uint8Array(mesh.indices.buffer, 0, indexBytes), positionBytes + normalBytes);

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    minX = Math.min(minX, mesh.positions[i]);
    maxX = Math.max(maxX, mesh.positions[i]);
    minY = Math.min(minY, mesh.positions[i + 1]);
    maxY = Math.max(maxY, mesh.positions[i + 1]);
    minZ = Math.min(minZ, mesh.positions[i + 2]);
    maxZ = Math.max(maxZ, mesh.positions[i + 2]);
  }

  const gltf = {
    asset: { generator, version: "2.0" },
    scene: 0,
    scenes: [{ name: "Scene", nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [
      {
        name,
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1 },
            indices: 2,
          },
        ],
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: vertexCount,
        type: "VEC3",
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
      },
      { bufferView: 1, componentType: 5126, count: vertexCount, type: "VEC3" },
      { bufferView: 2, componentType: 5125, count: mesh.indices.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteLength: positionBytes, byteOffset: 0, target: 34962 },
      { buffer: 0, byteLength: normalBytes, byteOffset: positionBytes, target: 34962 },
      {
        buffer: 0,
        byteLength: indexBytes,
        byteOffset: positionBytes + normalBytes,
        target: 34963,
      },
    ],
    buffers: [{ byteLength: bufferLength, uri: binUri }],
  };

  const gltfBody = `${JSON.stringify(gltf, null, "\t")}\n`;
  if (check) {
    const mismatches = [];
    if (!fs.existsSync(outBin) || !Buffer.from(fs.readFileSync(outBin)).equals(Buffer.from(buffer))) {
      mismatches.push(outBin);
    }
    if (!fs.existsSync(outGltf) || fs.readFileSync(outGltf, "utf8") !== gltfBody) {
      mismatches.push(outGltf);
    }
    if (mismatches.length) {
      console.error(`mesh outputs are stale:\n${mismatches.join("\n")}`);
      process.exitCode = 1;
      return;
    }
    console.log(`${name} mesh outputs ok (${bufferLength} bytes, ${vertexCount} vertices)`);
    return;
  }
  fs.writeFileSync(outBin, buffer);
  fs.writeFileSync(outGltf, gltfBody);
  console.log(
    `wrote ${outGltf} (${bufferLength} bytes): ${vertexCount} vertices, ${mesh.indices.length / 3} triangles`,
  );
}
