import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { app } from 'electron';
import { logger } from './logger';

const LICENSE_PATH = path.join(os.homedir(), '.photomove', 'license.json');

// Charset: A-Z + 2-9, excludes 0, 1, I, O (easy to confuse)
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars
const SECRET   = 'ppusher-v1-7k2q4m'; // embedded in binary — not a server secret
const DEV_KEY  = 'PXLP-DEV0-0000-0000-0000';

function isDevKey(raw: string): boolean {
  return !app.isPackaged && raw.toUpperCase() === DEV_KEY;
}

export type LicenseStatus = 'valid' | 'invalid' | 'missing';

export interface LicenseInfo {
  status: LicenseStatus;
  key?: string;
  email?: string;
  activatedAt?: string;
  developer?: boolean;
}

// ── Key validation ────────────────────────────────────────────────────────────

function computeChecksum(payload: string): string {
  // HMAC-SHA256(payload, SECRET) → first 20 bits → 4 charset chars (32 = 2^5, 4 chars = 20 bits)
  const hmac = crypto.createHmac('sha256', SECRET).update(payload).digest();
  let num = ((hmac[0] << 12) | (hmac[1] << 4) | (hmac[2] >> 4)) & 0xFFFFF;
  const chars: string[] = [];
  for (let i = 0; i < 4; i++) {
    chars.unshift(CHARSET[num % 32]);
    num = Math.floor(num / 32);
  }
  return chars.join('');
}

export function validateKey(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return false;
  if (isDevKey(raw)) return true;
  const parts = raw.toUpperCase().split('-');
  if (parts.length !== 5) return false;
  if (parts[0] !== 'PXLP') return false;
  const charsetRx = /^[A-HJ-NP-Z2-9]{4}$/; // CHARSET pattern
  for (let i = 1; i < 5; i++) {
    if (!charsetRx.test(parts[i])) return false;
  }
  const payload  = parts[1] + parts[2] + parts[3];
  const expected = computeChecksum(payload);
  return parts[4] === expected;
}

export function generateKey(): string {
  const payload = Array.from({ length: 12 }, () =>
    CHARSET[Math.floor(Math.random() * CHARSET.length)]
  ).join('');
  const checksum = computeChecksum(payload);
  return `PXLP-${payload.slice(0,4)}-${payload.slice(4,8)}-${payload.slice(8,12)}-${checksum}`;
}

// ── Persistence ───────────────────────────────────────────────────────────────

export function getLicenseInfo(): LicenseInfo {
  try {
    if (!fs.existsSync(LICENSE_PATH)) return { status: 'missing' };
    const raw  = fs.readFileSync(LICENSE_PATH, 'utf8');
    const data = JSON.parse(raw) as { key: string; email: string; activatedAt: string };
    if (isDevKey(data.key)) {
      return { status: 'valid', key: data.key, email: 'dev', activatedAt: data.activatedAt, developer: true };
    }
    if (!validateKey(data.key)) return { status: 'invalid', key: data.key };
    return { status: 'valid', key: data.key, email: data.email, activatedAt: data.activatedAt };
  } catch {
    return { status: 'missing' };
  }
}

export function getLicenseStatus(): LicenseStatus {
  return getLicenseInfo().status;
}

export function isPro(): boolean {
  return getLicenseStatus() === 'valid';
}

export function activateLicense(key: string, email: string): boolean {
  if (!validateKey(key)) {
    logger.warn('license', `Invalid key attempted: ${key.slice(0, 9)}…`);
    return false;
  }
  const dir = path.dirname(LICENSE_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LICENSE_PATH, JSON.stringify({ key: key.toUpperCase(), email, activatedAt: new Date().toISOString() }, null, 2));
  logger.info('license', `License activated for ${email}`);
  return true;
}

export function deactivateLicense(): void {
  try {
    if (fs.existsSync(LICENSE_PATH)) fs.unlinkSync(LICENSE_PATH);
    logger.info('license', 'License deactivated');
  } catch (err) {
    logger.warn('license', 'Failed to remove license file', String(err));
  }
}
