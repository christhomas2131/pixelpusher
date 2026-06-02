import { useState, useCallback, useEffect, useRef } from 'react';
import { FileRecord, FileCounts, GetFilesPageRequest, FileFilters } from '../../shared/types';

const PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 300;

interface UseFilesReturn {
  files: FileRecord[];
  counts: FileCounts | null;
  page: number;
  totalPages: number;
  totalCount: number;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  filters: FileFilters;
  loading: boolean;
  loadError: string | null;
  setPage: (p: number) => void;
  setSortBy: (col: string) => void;
  toggleSortDir: () => void;
  setFilters: (f: FileFilters) => void;
  refresh: () => void;
}

export function useFiles(sessionId: string | null): UseFilesReturn {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [counts, setCounts] = useState<FileCounts | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [sortBy, setSortBy] = useState('date_taken');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [filters, setFilters] = useState<FileFilters>({});
  // Effective filters — `filters` updates on every keystroke (controlled
  // input), `debouncedFilters` lags 300 ms so we don't fire an IPC round-trip
  // per character on a 40 K-file DB.
  const [debouncedFilters, setDebouncedFilters] = useState<FileFilters>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filter debounce: only the `search` field is keystroke-driven; status /
  // category change on explicit clicks and want to apply immediately, so
  // bypass the debounce for those.
  const lastNonSearchFiltersRef = useRef<Omit<FileFilters, 'search'>>({});
  useEffect(() => {
    const { search, ...rest } = filters;
    const nonSearchChanged = JSON.stringify(rest) !== JSON.stringify(lastNonSearchFiltersRef.current);
    lastNonSearchFiltersRef.current = rest;
    if (nonSearchChanged) {
      setDebouncedFilters(filters);
      return;
    }
    const id = setTimeout(() => setDebouncedFilters(filters), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [filters]);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const req: GetFilesPageRequest = {
        sessionId,
        page,
        pageSize: PAGE_SIZE,
        sortBy,
        sortDir,
        filters: Object.keys(debouncedFilters).length > 0 ? debouncedFilters : undefined,
      };
      const [pageRes, countsRes] = await Promise.all([
        window.electronAPI.getFilesPage(req),
        window.electronAPI.getFileCounts(sessionId),
      ]);
      setFiles(pageRes.files);
      setTotalPages(pageRes.totalPages);
      setTotalCount(pageRes.totalCount);
      setCounts(countsRes);
      setLoadError(null);
    } catch (err: any) {
      // Surface the failure so the user sees something other than a stuck spinner.
      setLoadError(String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  }, [sessionId, page, sortBy, sortDir, debouncedFilters]);

  useEffect(() => {
    if (sessionId) load();
  }, [load, sessionId]);

  const toggleSortDir = () => setSortDir(d => d === 'asc' ? 'desc' : 'asc');

  const handleSetFilters = (f: FileFilters) => {
    setFilters(f);
    setPage(1);
  };

  const handleSetPage = (p: number) => setPage(p);
  const handleSetSortBy = (col: string) => {
    if (col === sortBy) toggleSortDir();
    else { setSortBy(col); setSortDir('asc'); setPage(1); }
  };

  return {
    files, counts, page, totalPages, totalCount,
    sortBy, sortDir, filters, loading, loadError,
    setPage: handleSetPage,
    setSortBy: handleSetSortBy,
    toggleSortDir,
    setFilters: handleSetFilters,
    refresh: load,
  };
}
