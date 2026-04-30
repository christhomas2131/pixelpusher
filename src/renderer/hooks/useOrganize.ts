import { useState, useCallback, useEffect } from 'react';
import { OrganizeOptions, OrganizeProgress, OrganizeResult } from '../../shared/types';

export type OrganizeState = 'idle' | 'organizing' | 'complete' | 'error';

export function useOrganize() {
  const [state, setState]       = useState<OrganizeState>('idle');
  const [progress, setProgress] = useState<OrganizeProgress | null>(null);
  const [result, setResult]     = useState<OrganizeResult | null>(null);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    const removeProgress = window.electronAPI.onOrganizeProgress(p => setProgress(p));
    const removeComplete = window.electronAPI.onOrganizeComplete(r => {
      setResult(r);
      setState('complete');
    });
    const removeError = window.electronAPI.onOrganizeError(msg => {
      setError(msg);
      setState('error');
    });
    return () => {
      removeProgress();
      removeComplete();
      removeError();
    };
  }, []);

  const startOrganize = useCallback(async (options: OrganizeOptions) => {
    setState('organizing');
    setProgress(null);
    setResult(null);
    setError(null);
    try {
      await window.electronAPI.startOrganize(options);
    } catch (err) {
      setError(String(err));
      setState('error');
    }
  }, []);

  const cancelOrganize = useCallback(() => window.electronAPI.cancelOrganize(), []);

  const reset = useCallback(() => {
    setState('idle');
    setProgress(null);
    setResult(null);
    setError(null);
  }, []);

  return { state, progress, result, error, startOrganize, cancelOrganize, reset };
}
