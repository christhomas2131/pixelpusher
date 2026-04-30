import fs from 'fs';
import path from 'path';
import { getFilesForOrganize } from './database';
import { buildFullDestination } from './file-mover';
import type { OrganizeOptions, DryRunResult, DryRunNode, DryRunSampleEntry } from '../shared/types';

export const SAMPLE_SIZE = 20;
export const MAX_TREE_NODES = 5000;
const BATCH = 500;
// Limit existence checks so a 50 K-file dry run doesn't pound the FS.
const EXISTENCE_CHECK_BUDGET = 2000;

interface MutNode {
  name: string;
  count: number;
  bytes: number;
  internalCollisions: number;
  children: Map<string, MutNode>;
  // Tracks proposed *filenames* under this directory so we can spot two files
  // mapping to the exact same destination path (i.e. conflictStrategy: rename
  // would auto-rename, but the user still wants to see the count surfaced).
  filenames?: Map<string, number>;
}

function newNode(name: string): MutNode {
  return { name, count: 0, bytes: 0, internalCollisions: 0, children: new Map() };
}

function addToTree(root: MutNode, destPath: string, bytes: number, filename: string): { collision: boolean } {
  // Walk path segments, creating nodes as we go. The leaf node is the directory
  // immediately containing the file — the filename itself is recorded on that
  // node's `filenames` map for collision detection.
  const norm = destPath.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  const dir = idx === -1 ? '' : norm.slice(0, idx);
  const parts = dir.split('/').filter(Boolean);

  let node = root;
  node.count++;
  node.bytes += bytes;

  for (const part of parts) {
    let child = node.children.get(part);
    if (!child) {
      if (countNodes(root) >= MAX_TREE_NODES) {
        // Stop branching once the cap is reached. Files still count at the
        // truncation point so totals stay accurate.
        node.count++;
        node.bytes += bytes;
        return { collision: false };
      }
      child = newNode(part);
      node.children.set(part, child);
    }
    node = child;
    node.count++;
    node.bytes += bytes;
  }

  if (!node.filenames) node.filenames = new Map();
  const prior = node.filenames.get(filename) ?? 0;
  node.filenames.set(filename, prior + 1);
  if (prior >= 1) {
    node.internalCollisions++;
    return { collision: true };
  }
  return { collision: false };
}

function countNodes(root: MutNode): number {
  let n = 1;
  for (const child of root.children.values()) n += countNodes(child);
  return n;
}

function freeze(node: MutNode): DryRunNode {
  const children = Array.from(node.children.values())
    .map(freeze)
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    name: node.name,
    count: node.count,
    bytes: node.bytes,
    internalCollisions: node.internalCollisions,
    children,
  };
}

export async function dryRunOrganize(options: OrganizeOptions): Promise<DryRunResult> {
  const { sessionId, destination, pattern } = options;

  // Streaming variant of summarizeMappings — interleaves DB fetches and FS
  // existence checks so we don't materialize the whole library in memory and
  // can yield to the event loop between batches.
  const root = newNode('');
  const sample: DryRunSampleEntry[] = [];
  let totalFiles = 0;
  let totalBytes = 0;
  let unknownDate = 0;
  let internalCollisions = 0;
  let existingConflicts = 0;
  let existenceChecksRemaining = EXISTENCE_CHECK_BUDGET;

  let lastId: string | null = null;
  while (true) {
    const batch = getFilesForOrganize(sessionId, lastId, BATCH);
    if (batch.length === 0) break;

    for (const file of batch) {
      const dest = buildFullDestination(destination, pattern, file);
      const { collision } = addToTree(root, dest, file.size || 0, path.basename(dest));
      if (collision) internalCollisions++;
      if (!file.date_taken) unknownDate++;

      if (existenceChecksRemaining > 0) {
        existenceChecksRemaining--;
        try {
          if (fs.existsSync(dest)) existingConflicts++;
        } catch {
          // ignore — permission errors etc.
        }
      }

      if (sample.length < SAMPLE_SIZE) {
        sample.push({ source: file.source_path, dest });
      }
      totalFiles++;
      totalBytes += file.size || 0;
    }

    lastId = batch[batch.length - 1].id;
    await new Promise<void>((r) => setImmediate(r));
  }

  return {
    totalFiles,
    totalBytes,
    uniqueFolders: countLeafFolders(root),
    unknownDate,
    internalCollisions,
    existingConflicts,
    tree: freeze(root),
    sample,
  };
}

function countLeafFolders(node: MutNode): number {
  // A "leaf folder" is one that holds files (i.e. has filenames recorded),
  // even if it also has subdirectories.
  let n = node.filenames && node.filenames.size > 0 ? 1 : 0;
  for (const child of node.children.values()) n += countLeafFolders(child);
  return n;
}

// Pure tree-builder: takes already-resolved (source, dest, size, hasDate)
// triples and returns a DryRunResult sans existingConflicts (which requires
// FS access). Exported for unit testing.
export interface DryRunMapping {
  source: string;
  dest: string;
  size: number;
  hasDate: boolean;
}

export function summarizeMappings(mappings: Iterable<DryRunMapping>): Omit<DryRunResult, 'existingConflicts'> {
  const root = newNode('');
  const sample: DryRunSampleEntry[] = [];
  let totalFiles = 0;
  let totalBytes = 0;
  let unknownDate = 0;
  let internalCollisions = 0;

  for (const m of mappings) {
    const { collision } = addToTree(root, m.dest, m.size, path.basename(m.dest));
    if (collision) internalCollisions++;
    if (!m.hasDate) unknownDate++;
    if (sample.length < SAMPLE_SIZE) sample.push({ source: m.source, dest: m.dest });
    totalFiles++;
    totalBytes += m.size;
  }

  return {
    totalFiles,
    totalBytes,
    uniqueFolders: countLeafFolders(root),
    unknownDate,
    internalCollisions,
    tree: freeze(root),
    sample,
  };
}
