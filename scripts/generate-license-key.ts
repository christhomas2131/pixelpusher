import crypto from 'crypto';

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SECRET   = 'ppusher-v1-7k2q4m';

function computeChecksum(payload: string): string {
  const hmac = crypto.createHmac('sha256', SECRET).update(payload).digest();
  let num = ((hmac[0] << 12) | (hmac[1] << 4) | (hmac[2] >> 4)) & 0xFFFFF;
  const chars: string[] = [];
  for (let i = 0; i < 4; i++) {
    chars.unshift(CHARSET[num % 32]);
    num = Math.floor(num / 32);
  }
  return chars.join('');
}

function generateKey(): string {
  const payload = Array.from({ length: 12 }, () =>
    CHARSET[Math.floor(Math.random() * CHARSET.length)]
  ).join('');
  const checksum = computeChecksum(payload);
  return `PXLP-${payload.slice(0,4)}-${payload.slice(4,8)}-${payload.slice(8,12)}-${checksum}`;
}

const args = process.argv.slice(2);
const countArg = args.findIndex(a => a === '--count');
const count = countArg !== -1 ? parseInt(args[countArg + 1], 10) || 1 : 1;

for (let i = 0; i < count; i++) {
  console.log(generateKey());
}
