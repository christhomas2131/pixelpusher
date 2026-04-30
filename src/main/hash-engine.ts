import sharp from 'sharp';

const N = 32; // DCT input size

// Precompute cosine table at module load — O(N^2), done once
const cosTable = new Float32Array(N * N);
for (let k = 0; k < N; k++) {
  for (let n = 0; n < N; n++) {
    cosTable[k * N + n] = Math.cos((Math.PI / N) * (n + 0.5) * k);
  }
}

function dct2d(pixels: Uint8Array): Float32Array {
  const tmp = new Float32Array(N * N);
  const out = new Float32Array(N * N);

  // Row-wise 1D DCT
  for (let y = 0; y < N; y++) {
    for (let u = 0; u < N; u++) {
      let sum = 0;
      for (let x = 0; x < N; x++) {
        sum += pixels[y * N + x] * cosTable[u * N + x];
      }
      tmp[y * N + u] = (u === 0 ? 1 / Math.SQRT2 : 1) * sum;
    }
  }

  // Column-wise 1D DCT
  for (let v = 0; v < N; v++) {
    for (let u = 0; u < N; u++) {
      let sum = 0;
      for (let y = 0; y < N; y++) {
        sum += tmp[y * N + u] * cosTable[v * N + y];
      }
      out[v * N + u] = (v === 0 ? 1 / Math.SQRT2 : 1) * sum;
    }
  }

  return out;
}

// Returns 16-char hex string (64 bits) or null on failure
export async function computePHash(filePath: string): Promise<string | null> {
  try {
    const { data } = await sharp(filePath)
      .resize(N, N, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const dct = dct2d(new Uint8Array(data.buffer, data.byteOffset, data.length));

    // Extract 8×8 top-left block (low-frequency coefficients)
    const block = new Float32Array(64);
    for (let v = 0; v < 8; v++) {
      for (let u = 0; u < 8; u++) {
        block[v * 8 + u] = dct[v * N + u];
      }
    }

    // Mean of 63 values (skip DC component at index 0)
    let sum = 0;
    for (let i = 1; i < 64; i++) sum += block[i];
    const mean = sum / 63;

    // Encode 64 bits as 16 hex nibbles
    let hash = '';
    for (let i = 0; i < 64; i += 4) {
      let nibble = 0;
      for (let j = 0; j < 4; j++) {
        if (block[i + j] > mean) nibble |= (1 << j);
      }
      hash += nibble.toString(16);
    }

    return hash;
  } catch {
    return null;
  }
}
