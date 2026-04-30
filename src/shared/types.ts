export type FileStatus = 'pending' | 'ready' | 'junk' | 'error' | 'organized' | 'skipped';
export type LicenseStatus = 'valid' | 'invalid' | 'missing';

export interface LicenseInfo {
  status: LicenseStatus;
  key?: string;
  email?: string;
  activatedAt?: string;
  developer?: boolean;
}
export type FileCategory = 'images' | 'videos' | 'raw' | 'documents' | 'audio' | 'design' | '3d';
export type MetadataDepth = 'quick' | 'full';
export type ScanDepth = 'quick' | 'full';
export type ScanSpeed = 'safe' | 'balanced' | 'fast';
export type SessionStatus = 'running' | 'complete' | 'error' | 'cancelled';
export type OperationMode = 'copy' | 'move';
export type ConflictStrategy = 'rename' | 'skip' | 'overwrite';
export type Theme = 'system' | 'light' | 'dark' | 'pusher';
export type DateSource = 'exif' | 'filename' | 'modified' | 'created' | 'takeout' | 'unknown';
export type DupeAction = 'quarantine' | 'delete' | 'ignore';
export type OrganizeMode = 'date' | 'type';

export interface FileRecord {
  id: string;
  filename: string;
  source_path: string;
  proposed_destination: string | null;
  size: number;
  date_source: string | null;
  date_taken: string | null;
  camera_make: string | null;
  camera_model: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  width: number | null;
  height: number | null;
  format: string;
  status: FileStatus;
  junk_reason: string | null;
  junk_confidence: string | null;
  phash: string | null;
  file_category: FileCategory;
  extended_meta: string | null;
  metadata_depth: MetadataDepth;
  error_message: string | null;
  source_index: number;
  source_label: string;
  scan_session_id: string;
  created_at: string;
}

export interface ScanSession {
  id: string;
  source_folders: string;
  started_at: string;
  completed_at: string | null;
  total_files: number;
  total_size: number;
  scan_depth: ScanDepth;
  scan_speed: ScanSpeed;
  status: SessionStatus;
}

export interface FileCounts {
  total: number;
  ready: number;
  withDate: number;
  unknownDate: number;
  junk: number;
  dupes: number;
  totalSize: number;
  byCategory: Record<FileCategory, number>;
}

export interface ScanOptions {
  sourceFolders: string[];
  scanDepth: ScanDepth;
  scanSpeed: ScanSpeed;
  enabledCategories?: FileCategory[];
}

export interface ScanProgress {
  phase: 'discovering' | 'extracting';
  discovered: number;
  processed: number;
  total: number;
  eta: number | null;
  filesPerSecond: number;
  wave: number;
  totalWaves: number;
}

export interface OrganizeOptions {
  sessionId: string;
  destination: string;
  pattern: string;
  mode: OperationMode;
  conflictStrategy: ConflictStrategy;
}

export interface OrganizeProgress {
  processed: number;
  total: number;
  successful: number;
  errors: number;
  skipped: number;
  currentFile: string;
  eta: number | null;
  filesPerSecond: number;
  bytesProcessed: number;
  totalBytes: number;
}

export interface OrganizeResult {
  sessionId: string;
  processed: number;
  total: number;
  successful: number;
  errors: number;
  skipped: number;
  recentErrors: string[];
  destination: string;
}

export interface OperationHistoryEntry {
  sessionId: string;
  destination: string;
  pattern: string;
  mode: OperationMode;
  successful: number;
  errors: number;
  skipped: number;
  completedAt: string;
  logPath: string;
  canUndo: boolean;
}

export interface HashProgress {
  processed: number;
  total: number;
  filesPerSecond: number;
  eta: number | null;
}

export interface DupeGroupMember {
  group_id: string;
  file_id: string;
  is_keeper: number;
  rank: number;
  file: FileRecord;
}

export interface DupeGroup {
  id: string;
  scan_session_id: string;
  member_count: number;
  status: 'pending' | 'resolved';
  members: DupeGroupMember[];
}

export interface AppSettings {
  lastSourceFolders: string[];
  lastDestination: string;
  folderPattern: string;
  operationMode: OperationMode;
  conflictStrategy: ConflictStrategy;
  scanDepth: ScanDepth;
  scanSpeed: ScanSpeed;
  theme: Theme;
  enabledFileCategories: FileCategory[];
  recentFolders: string[];
  windowBounds: { x: number; y: number; width: number; height: number } | null;
  leftPanelWidth: number;
}

export interface GetFilesPageRequest {
  sessionId: string;
  page: number;
  pageSize: number;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  filters?: FileFilters;
}

export interface FileFilters {
  status?: FileStatus;
  category?: FileCategory;
  search?: string;
}

export interface GetFilesPageResponse {
  files: FileRecord[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface OperationProgress {
  session_id: string;
  total_files: number;
  processed_files: number;
  successful_files: number;
  error_files: number;
  skipped_files: number;
  last_processed_id: string | null;
  status: 'running' | 'complete' | 'error' | 'cancelled';
  updated_at: string;
}

export interface ElectronAPI {
  // Scan
  startScan: (options: ScanOptions) => Promise<string>;
  cancelScan: () => Promise<void>;
  onScanProgress: (cb: (p: ScanProgress) => void) => () => void;
  onScanComplete: (cb: (r: { sessionId: string; totalFiles: number }) => void) => () => void;
  onScanError: (cb: (msg: string) => void) => () => void;
  // Files
  getFilesPage: (request: GetFilesPageRequest) => Promise<GetFilesPageResponse>;
  getFileCounts: (sessionId: string) => Promise<FileCounts>;
  // Organize
  startOrganize: (options: OrganizeOptions) => Promise<void>;
  cancelOrganize: () => Promise<void>;
  undoOrganize: (sessionId: string) => Promise<{ undone: number; errors: number }>;
  getOrganizeHistory: () => Promise<OperationHistoryEntry[]>;
  onOrganizeProgress: (cb: (p: OrganizeProgress) => void) => () => void;
  onOrganizeComplete: (cb: (r: OrganizeResult) => void) => () => void;
  onOrganizeError: (cb: (msg: string) => void) => () => void;
  // Hash & dupes
  startHash: (sessionId: string) => Promise<void>;
  cancelHash: () => Promise<void>;
  onHashProgress: (cb: (p: HashProgress) => void) => () => void;
  onHashComplete: (cb: (r: { sessionId: string; hashed: number; dupeGroups: number }) => void) => () => void;
  onHashError: (cb: (msg: string) => void) => () => void;
  getDupeGroups: (sessionId: string, page: number, pageSize: number) => Promise<{ groups: DupeGroup[]; total: number }>;
  resolveGroup: (groupId: string, keeperId: string, action: DupeAction) => Promise<void>;
  autoResolveAll: (sessionId: string, action: DupeAction) => Promise<{ resolved: number }>;
  // Takeout
  checkTakeout: (folder: string) => Promise<{ isTakeout: boolean; jsonCount: number }>;
  // License
  getLicense: () => Promise<LicenseInfo>;
  activateLicense: (key: string, email: string) => Promise<boolean>;
  deactivateLicense: () => Promise<void>;
  // Report
  exportReport: (sessionId: string) => Promise<void>;
  // Settings / dialogs
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  openFolderDialog: () => Promise<string | null>;
  getPictures: () => Promise<string>;
  openLogFolder: () => Promise<void>;
  openPath: (p: string) => Promise<void>;
  onHeartbeat: (cb: (ts: number) => void) => () => void;
  onThemeChanged: (cb: (theme: Theme) => void) => () => void;
  onNewSession: (cb: () => void) => () => void;
}
