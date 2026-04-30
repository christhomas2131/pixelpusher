import { describe, it, expect } from 'vitest';
import { summarizeMappings, SAMPLE_SIZE, MAX_TREE_NODES, type DryRunMapping } from '../src/main/dry-run';

function m(dest: string, source = `/src/${dest.split('/').pop()}`, size = 1000, hasDate = true): DryRunMapping {
  return { source, dest, size, hasDate };
}

describe('summarizeMappings', () => {
  it('totals files and bytes', () => {
    const r = summarizeMappings([m('/a/b/x.jpg', '/x.jpg', 100), m('/a/b/y.jpg', '/y.jpg', 250)]);
    expect(r.totalFiles).toBe(2);
    expect(r.totalBytes).toBe(350);
  });

  it('groups files into a tree by destination directory', () => {
    const r = summarizeMappings([
      m('/dest/2024/Mar/a.jpg'),
      m('/dest/2024/Mar/b.jpg'),
      m('/dest/2024/Apr/c.jpg'),
      m('/dest/2025/Jan/d.jpg'),
    ]);

    // Top-level under root should be 'dest'
    expect(r.tree.children.length).toBe(1);
    const dest = r.tree.children[0];
    expect(dest.name).toBe('dest');

    const years = dest.children.map((c) => c.name).sort();
    expect(years).toEqual(['2024', '2025']);

    const y2024 = dest.children.find((c) => c.name === '2024')!;
    expect(y2024.count).toBe(3);
    const months24 = y2024.children.map((c) => c.name).sort();
    expect(months24).toEqual(['Apr', 'Mar']);
  });

  it('counts leaf folders (directories that hold files)', () => {
    const r = summarizeMappings([
      m('/dest/2024/Mar/a.jpg'),
      m('/dest/2024/Mar/b.jpg'),
      m('/dest/2024/Apr/c.jpg'),
      m('/dest/2025/Jan/d.jpg'),
    ]);
    // Mar, Apr, Jan = 3 leaf folders that hold files
    expect(r.uniqueFolders).toBe(3);
  });

  it('flags internal collisions (multiple files mapping to the same dest path)', () => {
    const r = summarizeMappings([
      m('/dest/2024/Mar/photo.jpg'),
      m('/dest/2024/Mar/photo.jpg'),
      m('/dest/2024/Mar/photo.jpg'),
      m('/dest/2024/Apr/photo.jpg'),  // different folder, no collision
    ]);
    // 3 files map to /dest/2024/Mar/photo.jpg → 2 collisions reported
    // (the 2nd and 3rd are collisions; the 1st is the original)
    expect(r.internalCollisions).toBe(2);
  });

  it('counts unknown-date entries', () => {
    const r = summarizeMappings([
      m('/dest/2024/a.jpg', '/x', 100, true),
      m('/dest/Unknown Date/b.jpg', '/y', 100, false),
      m('/dest/Unknown Date/c.jpg', '/z', 100, false),
    ]);
    expect(r.unknownDate).toBe(2);
  });

  it('caps the sample at SAMPLE_SIZE', () => {
    const mappings = Array.from({ length: SAMPLE_SIZE * 3 }, (_, i) =>
      m(`/dest/2024/Mar/file_${i}.jpg`, `/src/file_${i}.jpg`)
    );
    const r = summarizeMappings(mappings);
    expect(r.totalFiles).toBe(SAMPLE_SIZE * 3);
    expect(r.sample.length).toBe(SAMPLE_SIZE);
    // First entry of the sample is the first mapping
    expect(r.sample[0].source).toBe('/src/file_0.jpg');
  });

  it('returns an empty tree for zero input', () => {
    const r = summarizeMappings([]);
    expect(r.totalFiles).toBe(0);
    expect(r.totalBytes).toBe(0);
    expect(r.tree.children).toEqual([]);
    expect(r.uniqueFolders).toBe(0);
    expect(r.sample).toEqual([]);
  });

  it('children are sorted alphabetically for stable display', () => {
    const r = summarizeMappings([
      m('/dest/Z/a.jpg'),
      m('/dest/A/a.jpg'),
      m('/dest/M/a.jpg'),
    ]);
    const top = r.tree.children[0];  // 'dest'
    expect(top.children.map((c) => c.name)).toEqual(['A', 'M', 'Z']);
  });

  it('parent counts equal the sum of leaf counts', () => {
    const r = summarizeMappings([
      m('/dest/2024/Mar/a.jpg'),
      m('/dest/2024/Mar/b.jpg'),
      m('/dest/2024/Apr/c.jpg'),
    ]);
    const dest = r.tree.children[0];
    const y2024 = dest.children[0];
    expect(y2024.count).toBe(3);  // Mar(2) + Apr(1)
    expect(dest.count).toBe(3);
  });

  it('handles back-slash paths (windows) consistently with forward slashes', () => {
    const r = summarizeMappings([
      m('C:\\dest\\2024\\Mar\\a.jpg'),
      m('C:\\dest\\2024\\Mar\\b.jpg'),
    ]);
    expect(r.totalFiles).toBe(2);
    expect(r.uniqueFolders).toBe(1);
  });

  it('node cap is large enough that 1k files into one folder do not exceed it', () => {
    const mappings = Array.from({ length: 1000 }, (_, i) =>
      m(`/dest/2024/Mar/file_${i}.jpg`, `/src/${i}.jpg`)
    );
    const r = summarizeMappings(mappings);
    expect(r.totalFiles).toBe(1000);
    // tree has /, dest, 2024, Mar = 4 nodes
    function nodes(n: typeof r.tree): number {
      return 1 + n.children.reduce((s, c) => s + nodes(c), 0);
    }
    expect(nodes(r.tree)).toBeLessThanOrEqual(MAX_TREE_NODES);
  });
});
