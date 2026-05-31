import fs from 'fs';
import path from 'path';
import os from 'os';

export const LOG_DIR  = path.join(os.homedir(), '.photomove', 'logs');
export const LOG_FILE = path.join(LOG_DIR, 'pixelpusher.log');

const MAX_SIZE  = 10 * 1024 * 1024; // 10 MB per file
const MAX_FILES = 5;                 // keep pixelpusher.log + .1 through .4

type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

class Logger {
  private stream: fs.WriteStream | null = null;
  private currentSize = 0;

  constructor() {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    this.openStream();
  }

  private openStream() {
    try {
      if (this.stream) this.stream.end();
      const stat = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE) : null;
      this.currentSize = stat ? stat.size : 0;
      const s = fs.createWriteStream(LOG_FILE, { flags: 'a' });
      // Attach error listener so a disk-full / permission-denied stream error
      // doesn't crash the whole process via uncaught 'error' emit.
      s.on('error', () => { this.stream = null; });
      this.stream = s;
    } catch {
      this.stream = null;
    }
  }

  private rotate() {
    if (!fs.existsSync(LOG_FILE)) return;
    if (this.stream) { this.stream.end(); this.stream = null; }
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      const src = i === 1 ? LOG_FILE : `${LOG_FILE}.${i - 1}`;
      const dst = `${LOG_FILE}.${i}`;
      if (fs.existsSync(src)) fs.renameSync(src, dst);
    }
    this.openStream();
  }

  private write(level: Level, category: string, message: string, extra?: string) {
    const ts  = new Date().toISOString().replace('T', ' ').slice(0, 23); // include ms
    const pid = process.pid;
    const line = extra
      ? `[${ts}] [${pid}] [${level.padEnd(5)}] [${category}] ${message}\n  ${extra}\n`
      : `[${ts}] [${pid}] [${level.padEnd(5)}] [${category}] ${message}\n`;

    this.currentSize += Buffer.byteLength(line);
    if (this.currentSize >= MAX_SIZE) this.rotate();

    if (this.stream && !this.stream.destroyed) this.stream.write(line);
  }

  debug(category: string, message: string) { this.write('DEBUG', category, message); }
  info (category: string, message: string) { this.write('INFO',  category, message); }

  warn(category: string, message: string, extra?: string) {
    this.write('WARN', category, message, extra);
  }

  error(category: string, message: string, extra?: string) {
    this.write('ERROR', category, message, extra);
  }

  fatal(category: string, message: string, extra?: string) {
    this.write('FATAL', category, message, extra);
  }

  // Properly formats an Error object, including its full stack trace
  logError(category: string, message: string, err: unknown) {
    if (err instanceof Error) {
      const extra = err.stack ?? `${err.name}: ${err.message}`;
      this.write('ERROR', category, message, extra);
    } else {
      this.write('ERROR', category, message, String(err));
    }
  }

  logFatal(category: string, message: string, err: unknown) {
    if (err instanceof Error) {
      const extra = err.stack ?? `${err.name}: ${err.message}`;
      this.write('FATAL', category, message, extra);
    } else {
      this.write('FATAL', category, message, String(err));
    }
  }

  flushSync() {
    try {
      if (this.stream && !this.stream.destroyed) {
        this.stream.end();
        this.stream = null;
      }
    } catch {
      // best effort during crash
    }
  }

  logStartup(version: string) {
    const mem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
    this.info('startup', `─────────────────────────────────────────`);
    this.info('startup', `PixelPusher v${version} starting  PID=${process.pid}`);
    this.info('startup', `Platform: ${process.platform} ${process.arch}`);
    this.info('startup', `Node: ${process.version}  Electron: ${process.versions.electron ?? 'n/a'}`);
    this.info('startup', `RAM: ${mem}GB  CPUs: ${os.cpus().length}`);
    this.info('startup', `Log: ${LOG_FILE}`);
  }
}

export const logger = new Logger();
