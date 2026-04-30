# PixelPusher — Rebuild Phase 4: Dupes, Multi-Source, Sort by Type

## Context

Phases 1-3 complete: full scan pipeline, metadata extraction, organization engine with batched organize, undo, pattern system. This phase adds duplicate detection, multi-source scanning, and sort-by-type mode.

## Part 1: Duplicate Detection

### Perceptual Hashing (hash-engine.ts)

- Use `sharp` to resize image to 16x16 grayscale, compute DCT-based pHash (64-bit)
- Hash in batches, same pattern as EXIF: query from DB, process batch, update DB, yield
- Skip junk-flagged files
- Skip videos for now (hash first frame in v2)
- Store hash in `phash` column

### Dupe Grouping (dupe-detector.ts)

- Compare hashes using hamming distance
- Default threshold: 92% match (hamming distance <= 5 out of 64 bits)
- Configurable slider: 80% to 100%
- Group into clusters — each cluster has 2+ similar files
- Rank within group: highest resolution → largest size → most recent → has EXIF
- Auto-suggest best file as keeper
- Store groups in dupe_groups and dupe_group_members tables

### Dupe Review UI

- Group-by-group card view
- Side-by-side thumbnails (200px+) with metadata below each
- "Keep Best" / "Keep All" / "Keep Newest" buttons per group
- Navigation: Prev / Next group, counter "3 of 47"
- Bulk "Auto-resolve all" button
- Action for non-kept: quarantine (default), delete, ignore
- Quarantine folder: `_PixelPusher_Quarantine/` in destination

## Part 2: Multi-Source Scanning

### Multiple Source Folders

- Source list supports 2+ folders via "+ Add Source" button
- Each source gets a color-coded badge (Source A, Source B, Source C)
- Overlap detection: warn if Source B is inside Source A
- One source can be marked as "Primary" (star icon) for tiebreaking

### Unified Scan

- Scan all sources into one combined database session
- Each file record has `source_index` and `source_label`
- Progress bar is cumulative across all sources, never resets

### Cross-Source Dupe Detection

- Hash ALL files across ALL sources into one pool
- Dupes can span sources (photo in Source A matches photo in Source C)
- Cross-source dupes labeled with source badges in review UI
- Primary source wins ties in auto-resolve

### Merge to Single Destination

- All unique files from all sources organized into one destination
- Confirmation: "Merging X unique files from Y sources"

## Part 3: Sort by Type Mode

### Mode Toggle

On organize screen: "Organize by Date" (default) | "Sort by Type"

### Sort by Type Config

When enabled, files split into separate folders by category and year:
```
2025 Photos/     (5,000 files)
2025 Videos/     (500 files)
2025 Documents/  (1,000 files)
```

Settings:
- Folder pattern: `{YYYY} {TYPE_LABEL}` (default)
- Editable labels per category: "Photos", "Videos", "MP3s" etc.
- Split by extension toggle per category (PDFs vs DOCX)
- Add date subfolders inside toggle
- Presets: Split Everything, Detailed Split, Media vs Documents, Archive, Custom

### File Type Categories

Six categories with toggle on/off in settings:

| Category | Extensions | Default |
|----------|-----------|---------|
| Images | .jpg .jpeg .png .tiff .heic .cr2 .nef .arw .dng .webp .bmp .gif | ON |
| Videos | .mp4 .mov .avi .mkv .wmv .flv .webm .m4v .3gp | ON |
| Documents | .pdf .docx .doc .xlsx .xls .pptx .ppt .txt .rtf .csv | OFF |
| Audio | .mp3 .flac .wav .aac .ogg .wma .m4a | OFF |
| Design | .psd .ai .svg .eps .indd .sketch .fig .xd | OFF |
| 3D/CAD | .stl .obj .fbx .gltf .step .blend .dxf | OFF |

Non-image categories use SHA-256 content hash for dedup (not perceptual).
Dupes never cross categories.

## Part 4: Google Photos Takeout

### Takeout Detection

Auto-detect when source folder is a Google Takeout export:
- Look for `.json` sidecar files alongside images
- Look for `Takeout/Google Photos/` structure

### JSON Sidecar Parsing

- Match each image to its `.json` sidecar (handle truncated filenames)
- Extract `photoTakenTime.timestamp`, `geoData`, `title`, `description`
- JSON date takes priority over EXIF (Google sometimes corrupts EXIF on export)
- Detect album duplicates (same photo in date folder AND album folder)
- Link Live Photo pairs (.jpg + .mp4)

### UI

- Banner: "Google Photos Takeout detected. Dates will be recovered from JSON metadata."
- Stats: "4,230 photos recovered from JSON metadata"

## Done Criteria

1. Perceptual hashing works on images
2. Dupe groups identified by hamming distance
3. Dupe review UI with side-by-side comparison
4. Auto-resolve and manual resolution
5. Quarantine system
6. Multi-source scanning with unified progress
7. Cross-source dupe detection
8. Merge to single destination
9. Sort by Type mode with presets
10. Extended file type categories
11. Google Takeout parsing
12. All batched with yields, no memory leaks
