import fs from 'fs';
import crypto from 'crypto';

// Streaming SHA-256 of a file. Used in DataHoarder mode to detect byte-exact
// duplicate documents/audio/etc. without loading the file into memory.
//
// This is intentionally separate from `hash-engine.ts` (which computes
// perceptual hashes for images): byte-exact and perceptual are different
// dedup strategies for different content types and the renderer dispatches
// to one or the other based on the session's mode.
export async function computeByteHash(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 256 * 1024 });
    let resolved = false;

    const finish = (value: string | null) => {
      if (resolved) return;
      resolved = true;
      stream.destroy();
      resolve(value);
    };

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => finish(hash.digest('hex')));
    stream.on('error', () => finish(null));
  });
}
