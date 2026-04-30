import fs from 'fs';
import path from 'path';

export interface TakeoutCheck {
  isTakeout: boolean;
  jsonCount: number;
}

export function checkTakeout(folder: string): TakeoutCheck {
  const hasTakeoutStructure =
    fs.existsSync(path.join(folder, 'Takeout')) ||
    fs.existsSync(path.join(folder, 'Google Photos'));

  let jsonCount = 0;
  try {
    const entries = fs.readdirSync(folder, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.startsWith('metadata')) {
        jsonCount++;
        if (jsonCount >= 10) break; // early exit
      }
    }
  } catch {}

  return {
    isTakeout: hasTakeoutStructure || jsonCount >= 3,
    jsonCount,
  };
}

export interface TakeoutSidecar {
  title?: string;
  description?: string;
  photoTakenTime?: { timestamp: string; formatted?: string };
  geoData?: { latitude: number; longitude: number; altitude?: number };
  geoDataExif?: { latitude: number; longitude: number };
}

export function parseTakeoutSidecar(jsonPath: string): TakeoutSidecar | null {
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as TakeoutSidecar;
  } catch {
    return null;
  }
}

// Google Photos often truncates filenames at 46 chars before adding .json
export function findSidecarForFile(imagePath: string): string | null {
  const ext  = path.extname(imagePath);
  const base = imagePath.slice(0, -ext.length); // full path without extension

  const candidates = [
    imagePath + '.json',                              // image.jpg.json
    base + '.json',                                   // image.json
    base.slice(0, 46) + ext + '.json',                // truncated + ext + .json
    base.slice(0, 46) + '.json',                      // truncated.json
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function extractDateFromSidecar(sidecar: TakeoutSidecar): string | null {
  const ts = sidecar.photoTakenTime?.timestamp;
  if (!ts) return null;
  const unix = parseInt(ts, 10);
  if (isNaN(unix) || unix <= 0) return null;
  return new Date(unix * 1000).toISOString();
}
