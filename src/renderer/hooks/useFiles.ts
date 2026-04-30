import { useState, useCallback, useEffect } from 'react';
import { FileRecord, FileCounts, GetFilesPageRequest, FileFilters } from '../../shared/types';

const PAGE_SIZE = 100;

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
  const [loading, setLoading] = useState(false);

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
        filters: Object.keys(filters).length > 0 ? filters : undefined,
      };
      const [pageRes, countsRes] = await Promise.all([
        window.electronAPI.getFilesPage(req),
        window.electronAPI.getFileCounts(sessionId),
      ]);
      setFiles(pageRes.files);
      setTotalPages(pageRes.totalPages);
      setTotalCount(pageRes.totalCount);
      setCounts(countsRes);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [sessionId, page, sortBy, sortDir, filters]);

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
    sortBy, sortDir, filters, loading,
    setPage: handleSetPage,
    setSortBy: handleSetSortBy,
    toggleSortDir,
    setFilters: handleSetFilters,
    refresh: load,
  };
}
