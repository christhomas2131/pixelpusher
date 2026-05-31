import fs from 'fs';
import path from 'path';
import os from 'os';
import { OperationHistoryEntry } from '../shared/types';

export const OPERATIONS_DIR = path.join(os.homedir(), '.photomove', 'operations');

export interface LogEntry {
  src: string;
  dest: string;
  status: 'ok' | 'error' | 'skip';
  error?: string;
}

interface OperationMeta {
  sessionId: string;
  destination: string;
  pattern: string;
  mode: 'copy' | 'move';
  successful: number;
  errors: number;
  skipped: number;
  startedAt: string;
  completedAt: string;
  logPath: string;
}

export class OperationLog {
  private stream: fs.WriteStream;
  readonly logPath: string;
  private readonly metaPath: string;

  constructor(
    readonly sessionId: string,
    private readonly destination: string,
    private readonly pattern: string,
    private readonly mode: 'copy' | 'move',
    private readonly startedAt: string
  ) {
    fs.mkdirSync(OPERATIONS_DIR, { recursive: true });
    this.logPath = path.join(OPERATIONS_DIR, `${sessionId}.jsonl`);
    this.metaPath = path.join(OPERATIONS_DIR, `${sessionId}.meta.json`);
    this.stream = fs.createWriteStream(this.logPath, { flags: 'a' });
    // Defensive error listener — if the underlying FD dies (disk full, perm
    // change), we don't want the unhandled 'error' to crash the organize.
    this.stream.on('error', () => { /* fail-soft; further writes become no-ops */ });
  }

  write(entry: LogEntry): void {
    if (!this.stream.destroyed) {
      this.stream.write(JSON.stringify(entry) + '\n');
    }
  }

  close(successful: number, errors: number, skipped: number): void {
    this.stream.end();
    const meta: OperationMeta = {
      sessionId: this.sessionId,
      destination: this.destination,
      pattern: this.pattern,
      mode: this.mode,
      successful,
      errors,
      skipped,
      startedAt: this.startedAt,
      completedAt: new Date().toISOString(),
      logPath: this.logPath,
    };
    fs.writeFileSync(this.metaPath, JSON.stringify(meta, null, 2), 'utf8');
  }
}

export function getOperationHistory(): OperationHistoryEntry[] {
  try {
    if (!fs.existsSync(OPERATIONS_DIR)) return [];
    return fs.readdirSync(OPERATIONS_DIR)
      .filter(f => f.endsWith('.meta.json'))
      .map(f => {
        try {
          const meta: OperationMeta = JSON.parse(
            fs.readFileSync(path.join(OPERATIONS_DIR, f), 'utf8')
          );
          return {
            sessionId:   meta.sessionId,
            destination: meta.destination,
            pattern:     meta.pattern,
            mode:        meta.mode,
            successful:  meta.successful,
            errors:      meta.errors,
            skipped:     meta.skipped,
            completedAt: meta.completedAt,
            logPath:     meta.logPath,
            canUndo:     true,
          } as OperationHistoryEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is OperationHistoryEntry => e !== null)
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  } catch {
    return [];
  }
}

export function readLogEntries(sessionId: string): LogEntry[] {
  const logPath = path.join(OPERATIONS_DIR, `${sessionId}.jsonl`);
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      try { return JSON.parse(line) as LogEntry; }
      catch { return null; }
    })
    .filter((e): e is LogEntry => e !== null);
}

export function getOperationMode(sessionId: string): 'copy' | 'move' | null {
  const metaPath = path.join(OPERATIONS_DIR, `${sessionId}.meta.json`);
  if (!fs.existsSync(metaPath)) return null;
  try {
    const meta: OperationMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return meta.mode;
  } catch {
    return null;
  }
}
