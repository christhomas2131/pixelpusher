import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DupeGroup, DupeGroupMember, DupeAction } from '../../shared/types';

interface Props {
  sessionId: string;
  totalGroups: number;
  onDone: () => void;
}

function fmtSize(b: number): string {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(s: string | null): string {
  if (!s) return 'No date';
  try { return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return s; }
}

function fmtDims(w: number | null, h: number | null): string {
  if (!w || !h) return '—';
  return `${w.toLocaleString()}×${h.toLocaleString()}`;
}

export function DupeReview({ sessionId, totalGroups, onDone }: Props) {
  const [groups,       setGroups]       = useState<DupeGroup[]>([]);
  const [page,         setPage]         = useState(1);
  const [total,        setTotal]        = useState(totalGroups);
  const [currentIdx,   setCurrentIdx]   = useState(0);  // index within loaded groups
  const [action,       setAction]       = useState<DupeAction>('quarantine');
  const [loading,      setLoading]      = useState(true);
  const [resolving,    setResolving]    = useState(false);
  const [autoResolving,setAutoResolving]= useState(false);

  const PAGE_SIZE = 20;
  const globalIdx  = (page - 1) * PAGE_SIZE + currentIdx;
  const group      = groups[currentIdx] ?? null;

  const loadPage = useCallback(async (p: number) => {
    setLoading(true);
    const res = await window.electronAPI.getDupeGroups(sessionId, p, PAGE_SIZE);
    setGroups(res.groups);
    setTotal(res.total);
    setCurrentIdx(0);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { loadPage(1); }, [loadPage]);

  const resolve = async (keeperId: string) => {
    if (!group) return;
    setResolving(true);
    await window.electronAPI.resolveGroup(group.id, keeperId, action);
    setResolving(false);
    advance();
  };

  const keepAll = async () => {
    if (!group) return;
    setResolving(true);
    // Keep the best, but ignore (no file action on rest)
    const keeper = group.members.find(m => m.is_keeper) ?? group.members[0];
    await window.electronAPI.resolveGroup(group.id, keeper.file_id, 'ignore');
    setResolving(false);
    advance();
  };

  const keepNewest = async () => {
    if (!group) return;
    const newest = [...group.members].sort((a, b) => {
      const da = a.file.date_taken ?? '';
      const db = b.file.date_taken ?? '';
      return db.localeCompare(da);
    })[0];
    await resolve(newest.file_id);
  };

  const advance = () => {
    if (currentIdx < groups.length - 1) {
      setCurrentIdx(i => i + 1);
    } else if ((page - 1) * PAGE_SIZE + groups.length < total) {
      const next = page + 1;
      setPage(next);
      loadPage(next);
    } else {
      onDone();
    }
  };

  const handleAutoResolve = async () => {
    setAutoResolving(true);
    try {
      await window.electronAPI.autoResolveAll(sessionId, action);
    } finally {
      setAutoResolving(false);
    }
    onDone();
  };

  // While a page is loading or a resolve is in flight, lock every action
  // button. Previous version disabled some on `resolving` only and others
  // on `loading` only — rapid "Keep Best" clicks at a page boundary could
  // resolve the wrong (stale) group between IPC round-trips.
  const actionsDisabled = resolving || loading || autoResolving;

  if (loading) {
    return <div style={styles.root}><div style={styles.empty}>Loading duplicate groups…</div></div>;
  }

  if (!group) {
    return (
      <div style={styles.root}>
        <div style={styles.empty}>
          <div style={{ fontSize: 36 }}>✓</div>
          <div>All duplicate groups resolved</div>
          <button className="btn-primary" onClick={onDone}>Done</button>
        </div>
      </div>
    );
  }

  const keeper = group.members.find(m => m.is_keeper) ?? group.members[0];

  return (
    <div style={styles.root}>
      {/* Header bar */}
      <div style={styles.header}>
        <div style={styles.counter}>
          Group {globalIdx + 1} of {total}
          <span style={styles.groupSize}> · {group.member_count} files</span>
        </div>

        <div style={styles.headerActions}>
          <label style={styles.actionLabel}>Non-kept action:</label>
          {(['quarantine', 'delete', 'ignore'] as DupeAction[]).map(a => (
            <button
              key={a}
              style={{ ...styles.actionBtn, ...(action === a ? styles.actionBtnActive : {}) }}
              onClick={() => setAction(a)}
            >
              {a}
            </button>
          ))}
          <div style={styles.divider} />
          <button
            className="btn-secondary"
            style={{ fontSize: 12 }}
            disabled={autoResolving}
            onClick={handleAutoResolve}
          >
            {autoResolving ? 'Resolving…' : `Auto-resolve all ${total}`}
          </button>
          <button className="btn-secondary" style={{ fontSize: 12 }} onClick={onDone}>
            Done
          </button>
        </div>
      </div>

      {/* Cards */}
      <div style={styles.cards}>
        {group.members.map(member => (
          <MemberCard
            key={member.file_id}
            member={member}
            isKeeper={member.file_id === keeper.file_id}
            disabled={actionsDisabled}
            onKeep={() => resolve(member.file_id)}
          />
        ))}
      </div>

      {/* Group actions */}
      <div style={styles.footer}>
        <button
          className="btn-primary"
          disabled={actionsDisabled}
          onClick={() => resolve(keeper.file_id)}
        >
          Keep Best
        </button>
        <button className="btn-secondary" disabled={actionsDisabled} onClick={keepNewest}>
          Keep Newest
        </button>
        <button className="btn-secondary" disabled={actionsDisabled} onClick={keepAll}>
          Keep All
        </button>

        <div style={{ flex: 1 }} />

        <button
          className="btn-secondary"
          disabled={actionsDisabled || (currentIdx === 0 && page === 1)}
          onClick={() => {
            if (currentIdx > 0) setCurrentIdx(i => i - 1);
            else if (page > 1) { const prev = page - 1; setPage(prev); loadPage(prev); }
          }}
        >
          ← Prev
        </button>
        <button className="btn-secondary" disabled={actionsDisabled} onClick={advance}>
          Skip →
        </button>
      </div>
    </div>
  );
}

function MemberCard({
  member, isKeeper, disabled, onKeep,
}: {
  member: DupeGroupMember;
  isKeeper: boolean;
  disabled: boolean;
  onKeep: () => void;
}) {
  const f = member.file;
  // Thumbnails fetched via IPC so the renderer doesn't need img-src 'file:'
  // in CSP. Main downsamples through sharp and returns a tiny data: URL —
  // both safer (no path leakage in CSP exceptions) and cheaper (full-res
  // 24 MP photos were being shipped to the renderer just to be scaled down
  // in CSS).
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.getThumbnail(f.source_path, 240)
      .then(url => { if (!cancelled) setThumb(url); })
      .catch(() => { /* leave thumb null → placeholder */ });
    return () => { cancelled = true; };
  }, [f.source_path]);
  return (
    <div style={{ ...styles.card, ...(isKeeper ? styles.cardKeeper : {}) }}>
      {isKeeper && <div style={styles.keeperBadge}>Best</div>}
      <div style={styles.thumbWrap}>
        {thumb ? (
          <img
            src={thumb}
            alt={f.filename}
            style={styles.thumb}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div style={{ color: 'var(--text2)', fontSize: 11 }}>—</div>
        )}
      </div>
      <div style={styles.meta}>
        <div style={styles.metaFilename} title={f.source_path}>{f.filename}</div>
        <div style={styles.metaRow}>{fmtDims(f.width, f.height)}</div>
        <div style={styles.metaRow}>{fmtSize(f.size)}</div>
        <div style={styles.metaRow}>{fmtDate(f.date_taken)}</div>
        {f.camera_model && <div style={styles.metaRow}>{f.camera_model}</div>}
        <div style={{ ...styles.metaRow, fontSize: 10, wordBreak: 'break-all', color: 'var(--text2)' }}>
          {f.source_label}
        </div>
      </div>
      <button
        className={isKeeper ? 'btn-primary' : 'btn-secondary'}
        style={{ marginTop: 8, width: '100%', fontSize: 12 }}
        disabled={disabled}
        onClick={onKeep}
      >
        {isKeeper ? '✓ Keep This' : 'Keep This'}
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    overflow: 'hidden',
    background: 'var(--bg)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 14px',
    background: 'var(--surface)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
    flexWrap: 'wrap',
  },
  counter: {
    fontWeight: 700,
    fontSize: 14,
    color: 'var(--text)',
  },
  groupSize: {
    fontWeight: 400,
    color: 'var(--text2)',
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginLeft: 'auto',
    flexWrap: 'wrap',
  },
  actionLabel: {
    fontSize: 11,
    color: 'var(--text2)',
  },
  actionBtn: {
    fontSize: 11,
    padding: '3px 8px',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    color: 'var(--text)',
    cursor: 'pointer',
  },
  actionBtnActive: {
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
    color: '#fff',
  },
  divider: {
    width: 1,
    height: 20,
    background: 'var(--border)',
    margin: '0 2px',
  },
  cards: {
    display: 'flex',
    gap: 12,
    padding: 14,
    overflowX: 'auto',
    flex: 1,
    alignItems: 'flex-start',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 10,
    minWidth: 200,
    maxWidth: 240,
    position: 'relative',
  },
  cardKeeper: {
    borderColor: 'var(--accent)',
    boxShadow: '0 0 0 1px var(--accent)',
  },
  keeperBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    background: 'var(--accent)',
    color: '#fff',
    borderRadius: 4,
    fontSize: 10,
    padding: '2px 6px',
    fontWeight: 700,
  },
  thumbWrap: {
    width: '100%',
    height: 160,
    background: 'var(--bg2)',
    borderRadius: 4,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
    display: 'block',
  },
  meta: {
    marginTop: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  metaFilename: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  metaRow: {
    fontSize: 11,
    color: 'var(--text2)',
  },
  footer: {
    display: 'flex',
    gap: 8,
    padding: '10px 14px',
    background: 'var(--surface)',
    borderTop: '1px solid var(--border)',
    flexShrink: 0,
    alignItems: 'center',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 12,
    color: 'var(--text2)',
    fontSize: 14,
  },
};
