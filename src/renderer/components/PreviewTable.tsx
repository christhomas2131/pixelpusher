import React, { useRef, useState, useEffect, useCallback } from 'react';
import { FileRecord, FileFilters, FileStatus, FileCategory } from '../../shared/types';

interface Props {
  files: FileRecord[];
  page: number;
  totalPages: number;
  totalCount: number;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  filters: FileFilters;
  loading: boolean;
  onPageChange: (p: number) => void;
  onSort: (col: string) => void;
  onFilterChange: (f: FileFilters) => void;
}

const ROW_HEIGHT = 36;
const BUFFER = 8;

const COLUMNS: Array<{ key: string; label: string; width?: number }> = [
  { key: '_thumb',              label: '',            width: 48 },
  { key: 'status',             label: 'Status',      width: 90 },
  { key: 'filename',           label: 'Filename' },
  { key: 'date_taken',         label: 'Date',        width: 120 },
  { key: 'camera_model',       label: 'Camera',      width: 120 },
  { key: 'source_path',        label: 'Source',      width: 200 },
  { key: 'proposed_destination', label: 'Destination', width: 200 },
  { key: 'size',               label: 'Size',        width: 80 },
];

export function PreviewTable({
  files, page, totalPages, totalCount, sortBy, sortDir,
  filters, loading, onPageChange, onSort, onFilterChange,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setContainerHeight(entries[0].contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
  }, []);

  useEffect(() => {
    if (scrollRef.current) { scrollRef.current.scrollTop = 0; setScrollTop(0); }
  }, [page]);

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
  const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT) + BUFFER * 2;
  const endIndex = Math.min(files.length, startIndex + visibleCount);
  const visibleFiles = files.slice(startIndex, endIndex);
  const topPad = startIndex * ROW_HEIGHT;
  const bottomPad = (files.length - endIndex) * ROW_HEIGHT;

  const emptyMessage = (() => {
    if (loading && files.length === 0) return 'Loading…';
    if (files.length === 0 && (filters.status || filters.category || filters.search))
      return 'No files match your filter.';
    if (files.length === 0) return 'No supported files found in this folder.';
    return null;
  })();

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        <FilterBar filters={filters} onChange={onFilterChange} />
        <div style={styles.pagination}>
          {totalCount > 0 && (
            <span style={styles.pageInfo}>
              {totalCount.toLocaleString()} files &nbsp;|&nbsp; page {page} / {totalPages}
            </span>
          )}
          <button
            className="btn-secondary"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || loading}
            style={styles.pageBtn}
          >‹</button>
          <button
            className="btn-secondary"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || loading}
            style={styles.pageBtn}
          >›</button>
        </div>
      </div>

      <div style={styles.tableWrap} ref={scrollRef} onScroll={handleScroll}>
        <table style={styles.table}>
          <thead>
            <tr>
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  onClick={col.key !== '_thumb' ? () => onSort(col.key) : undefined}
                  style={{
                    ...styles.th,
                    width: col.width,
                    cursor: col.key === '_thumb' ? 'default' : 'pointer',
                  }}
                >
                  {col.label}
                  {sortBy === col.key && (
                    <span style={styles.sortArrow}>{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {emptyMessage ? (
              <tr><td colSpan={COLUMNS.length} style={styles.emptyCell}>{emptyMessage}</td></tr>
            ) : (
              <>
                {topPad > 0 && <tr style={{ height: topPad }}><td colSpan={COLUMNS.length} /></tr>}
                {visibleFiles.map((f, i) => (
                  <tr
                    key={f.id}
                    style={{ height: ROW_HEIGHT, background: (startIndex + i) % 2 === 1 ? 'var(--row-alt)' : undefined }}
                  >
                    <td style={{ ...styles.td, padding: '4px 6px', textAlign: 'center' }}>
                      <FileTypeIcon category={f.file_category} />
                    </td>
                    <td style={styles.td}><StatusPill status={f.status} /></td>
                    <td style={{ ...styles.td, ...styles.nameCell }} title={f.filename}>{f.filename}</td>
                    <td style={styles.td}>{f.date_taken ? formatDate(f.date_taken) : <span style={styles.muted}>—</span>}</td>
                    <td style={{ ...styles.td, ...styles.truncCell }} title={f.camera_model ?? ''}>
                      {f.camera_model ?? <span style={styles.muted}>—</span>}
                    </td>
                    <td style={{ ...styles.td, ...styles.truncCell }} title={f.source_path}>{f.source_path}</td>
                    <td style={{ ...styles.td, ...styles.truncCell }} title={f.proposed_destination ?? ''}>
                      {f.proposed_destination ?? <span style={styles.muted}>—</span>}
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{formatSize(f.size)}</td>
                  </tr>
                ))}
                {bottomPad > 0 && <tr style={{ height: bottomPad }}><td colSpan={COLUMNS.length} /></tr>}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterBar({ filters, onChange }: { filters: FileFilters; onChange: (f: FileFilters) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <select
        value={filters.status ?? ''}
        onChange={e => onChange({ ...filters, status: (e.target.value as FileStatus) || undefined })}
        style={{ fontSize: 12, padding: '3px 8px' }}
      >
        <option value="">All statuses</option>
        <option value="pending">Pending</option>
        <option value="ready">Ready</option>
        <option value="junk">Junk</option>
        <option value="error">Error</option>
        <option value="organized">Organized</option>
      </select>
      <select
        value={filters.category ?? ''}
        onChange={e => onChange({ ...filters, category: (e.target.value as FileCategory) || undefined })}
        style={{ fontSize: 12, padding: '3px 8px' }}
      >
        <option value="">All types</option>
        <option value="images">Images</option>
        <option value="videos">Videos</option>
        <option value="raw">RAW</option>
        <option value="documents">Documents</option>
        <option value="audio">Audio</option>
      </select>
      <input
        type="text"
        placeholder="Search filename…"
        value={filters.search ?? ''}
        onChange={e => onChange({ ...filters, search: e.target.value || undefined })}
        style={{ fontSize: 12, padding: '3px 8px', width: 180 }}
      />
    </div>
  );
}

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  pending:   { color: '#8E8E93', label: 'Pending' },
  ready:     { color: '#34C759', label: 'Ready' },
  junk:      { color: '#FF3B30', label: 'Junk' },
  error:     { color: '#FF3B30', label: 'Error' },
  organized: { color: '#2E7AF5', label: 'Done' },
  skipped:   { color: '#8E8E93', label: 'Skip' },
};

function StatusPill({ status }: { status: FileRecord['status'] }) {
  const cfg = STATUS_CONFIG[status] ?? { color: '#8E8E93', label: status };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        background: cfg.color, flexShrink: 0, display: 'inline-block',
      }} />
      <span style={{ color: cfg.color, fontSize: 11, fontWeight: 600 }}>{cfg.label}</span>
    </span>
  );
}

const TYPE_CONFIG: Record<string, { bg: string; label: string }> = {
  images:    { bg: '#2E7AF5', label: 'IMG' },
  videos:    { bg: '#FF3B30', label: 'VID' },
  raw:       { bg: '#FF9500', label: 'RAW' },
  documents: { bg: '#34C759', label: 'DOC' },
  audio:     { bg: '#AF52DE', label: 'AUD' },
  design:    { bg: '#FF2D55', label: 'DSG' },
  '3d':      { bg: '#5AC8FA', label: '3D' },
};

function FileTypeIcon({ category }: { category: FileCategory }) {
  const cfg = TYPE_CONFIG[category] ?? { bg: '#8E8E93', label: '???' };
  return (
    <span style={{
      display: 'inline-block',
      width: 30, height: 20,
      background: cfg.bg + '33',
      border: `1px solid ${cfg.bg}66`,
      borderRadius: 3,
      fontSize: 9, fontWeight: 800,
      color: cfg.bg, textAlign: 'center',
      lineHeight: '18px',
      letterSpacing: '0.02em',
    }}>
      {cfg.label}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
  } catch {
    return iso;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden',
  },
  toolbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 12px', background: 'var(--surface)',
    borderBottom: '1px solid var(--border)', flexShrink: 0, gap: 12, flexWrap: 'wrap',
  },
  pagination: { display: 'flex', alignItems: 'center', gap: 6 },
  pageInfo: { fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' },
  pageBtn: { padding: '2px 10px', fontSize: 14, minWidth: 28 },
  tableWrap: { flex: 1, overflowY: 'auto', overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: {
    textAlign: 'left', padding: '7px 10px', background: 'var(--bg2)',
    borderBottom: '1px solid var(--border)', fontWeight: 600,
    color: 'var(--text2)', userSelect: 'none',
    whiteSpace: 'nowrap', position: 'sticky', top: 0, fontSize: 11,
  },
  td: {
    padding: '5px 10px', borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap', maxWidth: 0, verticalAlign: 'middle',
  },
  sortArrow: { fontSize: 10 },
  nameCell: { overflow: 'hidden', textOverflow: 'ellipsis' },
  truncCell: { overflow: 'hidden', textOverflow: 'ellipsis' },
  emptyCell: { textAlign: 'center', padding: '48px 32px', color: 'var(--text2)', fontSize: 14 },
  muted: { color: 'var(--text2)' },
};
