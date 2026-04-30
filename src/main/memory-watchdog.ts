import { logger } from './logger';

const THRESHOLDS = {
  normal: 0,
  elevated: 500,
  warning: 1000,
  critical: 1500,
  emergency: 2000,
} as const;

type MemLevel = keyof typeof THRESHOLDS;

let lastHeapMB = 0;
let lastCheckTime = Date.now();
let intervalHandle: ReturnType<typeof setInterval> | null = null;

function getHeapMB(): number {
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

function getLevel(mb: number): MemLevel {
  if (mb >= THRESHOLDS.emergency) return 'emergency';
  if (mb >= THRESHOLDS.critical) return 'critical';
  if (mb >= THRESHOLDS.warning) return 'warning';
  if (mb >= THRESHOLDS.elevated) return 'elevated';
  return 'normal';
}

function forceGC() {
  if (typeof global.gc === 'function') {
    global.gc();
  }
}

function check() {
  const now = Date.now();
  const heapMB = getHeapMB();
  const level = getLevel(heapMB);

  const elapsedMin = (now - lastCheckTime) / 60000;
  const growthRate = elapsedMin > 0 ? (heapMB - lastHeapMB) / elapsedMin : 0;

  if (growthRate > 100) {
    logger.warn('memory', `Possible leak: +${growthRate.toFixed(0)}MB/min`, `heap=${heapMB.toFixed(0)}MB`);
  }

  const msg = `heap=${heapMB.toFixed(0)}MB level=${level}`;

  switch (level) {
    case 'normal':
      logger.debug('memory', msg);
      break;
    case 'elevated':
      logger.info('memory', msg);
      forceGC();
      break;
    case 'warning':
      logger.warn('memory', msg);
      forceGC();
      break;
    case 'critical':
    case 'emergency':
      logger.error('memory', msg);
      forceGC();
      break;
  }

  lastHeapMB = heapMB;
  lastCheckTime = now;
}

export function startMemoryWatchdog() {
  if (intervalHandle) return;
  intervalHandle = setInterval(check, 30_000);
  logger.info('memory', 'Memory watchdog started');
}

export function stopMemoryWatchdog() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
