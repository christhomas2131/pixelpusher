import { useState, useEffect, useRef } from 'react';
import { ScanProgress, ScanOptions } from '../../shared/types';

export type ScanState = 'idle' | 'scanning' | 'done' | 'error';

interface UseScanReturn {
  state: ScanState;
  progress: ScanProgress | null;
  error: string | null;
  sessionId: string | null;
  startScan: (options: ScanOptions) => Promise<void>;
  cancelScan: () => void;
  reset: () => void;
}

export function useScan(): UseScanReturn {
  const [state, setState] = useState<ScanState>('idle');
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const cleanupRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    return () => { cleanupRef.current.forEach(fn => fn()); };
  }, []);

  const startScan = async (options: ScanOptions) => {
    cleanupRef.current.forEach(fn => fn());
    cleanupRef.current = [];

    setState('scanning');
    setProgress({ phase: 'discovering', discovered: 0, processed: 0, total: 0, eta: null, filesPerSecond: 0, wave: 0, totalWaves: 0 });
    setError(null);

    const removeProgress = window.electronAPI.onScanProgress((p) => setProgress(p));
    const removeComplete = window.electronAPI.onScanComplete(({ sessionId: sid }) => {
      setSessionId(sid);
      setState('done');
      setProgress(null);
    });
    const removeError = window.electronAPI.onScanError((msg) => {
      setError(msg);
      setState('error');
    });

    cleanupRef.current = [removeProgress, removeComplete, removeError];

    try {
      const sid = await window.electronAPI.startScan(options);
      setSessionId(sid);
    } catch (err) {
      setError(String(err));
      setState('error');
    }
  };

  const cancelScan = () => {
    window.electronAPI.cancelScan();
    setState('idle');
    setProgress(null);
  };

  const reset = () => {
    cleanupRef.current.forEach(fn => fn());
    cleanupRef.current = [];
    setState('idle');
    setProgress(null);
    setError(null);
    setSessionId(null);
  };

  return { state, progress, error, sessionId, startScan, cancelScan, reset };
}
