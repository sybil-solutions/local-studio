const VERSION = 4;
const SIZE = VERSION * 4 + 17;
const DATA_CODEWORDS = 80;
const ECC_CODEWORDS = 20;
const QUIET_ZONE = 4;

function gfMultiply(left: number, right: number): number {
  let x = left;
  let y = right;
  let result = 0;
  while (y > 0) {
    if (y & 1) result ^= x;
    y >>>= 1;
    x = (x << 1) ^ ((x >>> 7) * 0x11d);
  }
  return result;
}

function reedSolomonDivisor(degree: number): number[] {
  const result = Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let index = 0; index < degree; index += 1) {
    for (let offset = 0; offset < degree; offset += 1) {
      result[offset] = gfMultiply(result[offset] ?? 0, root);
      if (offset + 1 < degree) result[offset] ^= result[offset + 1] ?? 0;
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

function reedSolomonRemainder(data: number[], degree: number): number[] {
  const divisor = reedSolomonDivisor(degree);
  const result = Array<number>(degree).fill(0);
  for (const value of data) {
    const factor = value ^ (result[0] ?? 0);
    result.shift();
    result.push(0);
    for (let index = 0; index < degree; index += 1) {
      result[index] = (result[index] ?? 0) ^ gfMultiply(divisor[index] ?? 0, factor);
    }
  }
  return result;
}

function appendBits(target: boolean[], value: number, length: number): void {
  for (let bit = length - 1; bit >= 0; bit -= 1) target.push(((value >>> bit) & 1) !== 0);
}

function dataCodewords(value: string): number[] {
  const bytes = [...new TextEncoder().encode(value)];
  if (bytes.length > 78) throw new Error("Phone URL is too long for the QR code");
  const bits: boolean[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  for (const byte of bytes) appendBits(bits, byte, 8);
  const capacity = DATA_CODEWORDS * 8;
  appendBits(bits, 0, Math.min(4, capacity - bits.length));
  while (bits.length % 8 !== 0) bits.push(false);
  const result: number[] = [];
  for (let offset = 0; offset < bits.length; offset += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit += 1) byte = (byte << 1) | (bits[offset + bit] ? 1 : 0);
    result.push(byte);
  }
  for (let pad = 0; result.length < DATA_CODEWORDS; pad += 1) {
    result.push(pad % 2 === 0 ? 0xec : 0x11);
  }
  return result;
}

function formatBits(mask: number): number {
  const data = (1 << 3) | mask;
  let remainder = data << 10;
  for (let bit = 14; bit >= 10; bit -= 1) {
    if (((remainder >>> bit) & 1) !== 0) remainder ^= 0x537 << (bit - 10);
  }
  return (((data << 10) | remainder) ^ 0x5412) & 0x7fff;
}

function emptyGrid(): boolean[][] {
  return Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false));
}

function setFunctionModule(
  modules: boolean[][],
  functions: boolean[][],
  x: number,
  y: number,
  dark: boolean,
): void {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  modules[y]![x] = dark;
  functions[y]![x] = true;
}

function drawFinder(
  modules: boolean[][],
  functions: boolean[][],
  centerX: number,
  centerY: number,
) {
  for (let y = -4; y <= 4; y += 1) {
    for (let x = -4; x <= 4; x += 1) {
      const distance = Math.max(Math.abs(x), Math.abs(y));
      setFunctionModule(
        modules,
        functions,
        centerX + x,
        centerY + y,
        distance !== 2 && distance !== 4,
      );
    }
  }
}

function drawAlignment(
  modules: boolean[][],
  functions: boolean[][],
  centerX: number,
  centerY: number,
) {
  for (let y = -2; y <= 2; y += 1) {
    for (let x = -2; x <= 2; x += 1) {
      setFunctionModule(
        modules,
        functions,
        centerX + x,
        centerY + y,
        Math.max(Math.abs(x), Math.abs(y)) !== 1,
      );
    }
  }
}

function drawFormat(modules: boolean[][], functions: boolean[][], mask: number): void {
  const bits = formatBits(mask);
  const bit = (index: number) => ((bits >>> index) & 1) !== 0;
  for (let index = 0; index <= 5; index += 1) {
    setFunctionModule(modules, functions, 8, index, bit(index));
  }
  setFunctionModule(modules, functions, 8, 7, bit(6));
  setFunctionModule(modules, functions, 8, 8, bit(7));
  setFunctionModule(modules, functions, 7, 8, bit(8));
  for (let index = 9; index < 15; index += 1) {
    setFunctionModule(modules, functions, 14 - index, 8, bit(index));
  }
  for (let index = 0; index < 8; index += 1) {
    setFunctionModule(modules, functions, SIZE - 1 - index, 8, bit(index));
  }
  for (let index = 8; index < 15; index += 1) {
    setFunctionModule(modules, functions, 8, SIZE - 15 + index, bit(index));
  }
  setFunctionModule(modules, functions, 8, SIZE - 8, true);
}

export function createQrMatrix(value: string): boolean[][] {
  const modules = emptyGrid();
  const functions = emptyGrid();
  drawFinder(modules, functions, 3, 3);
  drawFinder(modules, functions, SIZE - 4, 3);
  drawFinder(modules, functions, 3, SIZE - 4);
  for (let index = 8; index < SIZE - 8; index += 1) {
    setFunctionModule(modules, functions, 6, index, index % 2 === 0);
    setFunctionModule(modules, functions, index, 6, index % 2 === 0);
  }
  drawAlignment(modules, functions, 26, 26);
  drawFormat(modules, functions, 0);
  const data = dataCodewords(value);
  const codewords = [...data, ...reedSolomonRemainder(data, ECC_CODEWORDS)];
  const bits: boolean[] = [];
  for (const codeword of codewords) appendBits(bits, codeword, 8);
  let bitIndex = 0;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vertical = 0; vertical < SIZE; vertical += 1) {
      const y = upward ? SIZE - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const x = right - offset;
        if (functions[y]![x]) continue;
        const source = bits[bitIndex] ?? false;
        modules[y]![x] = source !== ((x + y) % 2 === 0);
        bitIndex += 1;
      }
    }
  }
  return modules;
}

export function QrCode({ value, label }: { value: string; label: string }) {
  const modules = createQrMatrix(value);
  const dimension = SIZE + QUIET_ZONE * 2;
  const path = modules
    .flatMap((row, y) =>
      row.flatMap((dark, x) => (dark ? [`M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`] : [])),
    )
    .join("");
  return (
    <svg
      viewBox={`0 0 ${dimension} ${dimension}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className="h-full w-full"
    >
      <rect width={dimension} height={dimension} fill="white" />
      <path d={path} fill="black" />
    </svg>
  );
}
