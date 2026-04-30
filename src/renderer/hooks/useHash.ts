import { useState, useCallback, useEffect } from 'react';
import { HashProgress } from '../../shared/types';

export type HashState = 'idle' | 'hashing' | 'complete' | 'error';

export interface HashResult {
  sessionId: string;
  hashed: number;
  dupeGroups: number;
}

export function useHash() {
  const [state,    setState]    = useState<HashState>('idle');
  const [progress, setProgress] = useState<HashProgress | null>(null);
  const [result,   setResult]   = useState<HashResult | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    const removeProgress = window.electronAPI.onHashProgress(p => setProgress(p));
    const removeComplete = window.electronAPI.onHashComplete(r => {
      setResult(r);
      setState('complete');
    });
    const removeError = window.electronAPI.onHashError(msg => {
      setError(msg);
      setState('error');
    });
    return () => {
      removeProgress();
      removeComplete();
      removeError();
    };
  }, []);

  const startHash = useCallback(async (sessionId: string) => {
    setState('hashing');
    setProgress(null);
    setResult(null);
    setError(null);
    try {
      await window.electronAPI.startHash(sessionId);
    } catch (err) {
      setError(String(err));
      setState('error');
    }
  }, []);

  const cancelHash = useCallback(() => window.electronAPI.cancelHash(), []);

  const reset = useCallback(() => {
    setState('idle');
    setProgress(null);
    setResult(null);
    setError(null);
  }, []);

  return { state, progress, result, error, startHash, cancelHash, reset };
}
