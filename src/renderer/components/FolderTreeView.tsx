import React, { useMemo, useState } from 'react';
import { FileRecord } from '../../shared/types';

interface Props {
  files: FileRecord[];
  totalCount: number;
}

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  count: number;
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: '', children: new Map(), count: 0 };
  for (const p of paths) {
    const norm = p.replace(/\\/g, '/');
    const parts = norm.split('/').filter(Boolean);
    let node = root;
    for (const part of parts) {
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, children: new Map(), count: 0 });
      }
      node = node.children.get(part)!;
      node.count++;
    }
  }
  return root;
}

function TreeNodeView({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.size > 0;
  return (
    <div style={{ marginLeft: depth * 14 }}>
      <div style={styles.treeRow} onClick={() => setOpen(o => !o)}>
        <span style={styles.treeArrow}>{hasChildren ? (open ? '▾' : '▸') : ' '}</span>
        <span style={styles.treeName}>{node.name}</span>
        <span style={styles.treeCount}>{node.count}</span>
      </div>
      {open && hasChildren && (
        <div>
          {Array.from(node.children.values()).slice(0, 50).map(child => (
            <TreeNodeView key={child.name} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FolderTreeView({ files, totalCount }: Props) {
  // Memoize the tree build — previous version walked the entire `files`
  // array twice and allocated two Maps per render. Even at the 100-row cap
  // that's wasted work when only an unrelated parent prop changes.
  const { sourceTree, destTree, sourceFolders, destFolders, reduction, destCount } = useMemo(() => {
    const sourcePaths = files.map(f => {
      const norm = f.source_path.replace(/\\/g, '/');
      const parts = norm.split('/');
      return parts.slice(0, -1).join('/');
    });
    const destPaths = files
      .filter(f => f.proposed_destination)
      .map(f => {
        const norm = (f.proposed_destination ?? '').replace(/\\/g, '/');
        const parts = norm.split('/');
        return parts.slice(0, -1).join('/');
      });
    const srcFolders = new Set(sourcePaths).size;
    const dstFolders = new Set(destPaths).size;
    return {
      sourceTree: buildTree(sourcePaths),
      destTree: buildTree(destPaths),
      sourceFolders: srcFolders,
      destFolders: dstFolders,
      reduction: srcFolders > 0 ? Math.round((1 - dstFolders / srcFolders) * 100) : 0,
      destCount: destPaths.length,
    };
  }, [files]);

  return (
    <div style={styles.root}>
      <div style={styles.panel}>
        <div style={styles.panelHeader}>Before</div>
        <div style={styles.treeArea}>
          {Array.from(sourceTree.children.values()).map(n => (
            <TreeNodeView key={n.name} node={n} depth={0} />
          ))}
        </div>
      </div>

      <div style={styles.stats}>
        <div style={styles.statItem}>
          <div style={styles.statVal}>{sourceFolders}</div>
          <div style={styles.statLabel}>Source folders</div>
        </div>
        <div style={styles.arrow}>→</div>
        <div style={styles.statItem}>
          <div style={styles.statVal}>{destFolders}</div>
          <div style={styles.statLabel}>Dest folders</div>
        </div>
        {reduction > 0 && (
          <div style={{ ...styles.statItem, marginTop: 8 }}>
            <div style={{ ...styles.statVal, color: 'var(--success)' }}>{reduction}%</div>
            <div style={styles.statLabel}>Reduction</div>
          </div>
        )}
      </div>

      <div style={styles.panel}>
        <div style={{ ...styles.panelHeader, color: 'var(--success)' }}>After</div>
        <div style={styles.treeArea}>
          {destCount === 0 ? (
            <div style={styles.empty}>Organize to preview destination structure</div>
          ) : (
            Array.from(destTree.children.values()).map(n => (
              <TreeNodeView key={n.name} node={n} depth={0} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', alignItems: 'flex-start', gap: 12,
    padding: 16, overflow: 'hidden',
  },
  panel: {
    flex: 1, background: 'var(--bg2)', borderRadius: 6,
    border: '1px solid var(--border)', overflow: 'hidden',
  },
  panelHeader: {
    padding: '8px 12px', fontWeight: 700, fontSize: 12,
    borderBottom: '1px solid var(--border)', color: 'var(--text2)',
    textTransform: 'uppercase', letterSpacing: '0.05em',
  },
  treeArea: {
    padding: '8px 4px', overflowY: 'auto', maxHeight: 240, fontSize: 12,
  },
  treeRow: {
    display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px',
    cursor: 'pointer', borderRadius: 3,
  },
  treeArrow: { color: 'var(--text2)', fontSize: 10, width: 12, flexShrink: 0 },
  treeName: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  treeCount: {
    fontSize: 10, color: 'var(--text2)', background: 'var(--bg3)',
    borderRadius: 3, padding: '0 4px',
  },
  stats: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: 4, flexShrink: 0, padding: '0 8px',
  },
  statItem: { textAlign: 'center' },
  statVal: { fontSize: 18, fontWeight: 700, color: 'var(--text)' },
  statLabel: { fontSize: 10, color: 'var(--text2)' },
  arrow: { fontSize: 18, color: 'var(--text2)' },
  empty: { padding: '16px 12px', color: 'var(--text2)', fontSize: 12, fontStyle: 'italic' },
};
