# PixelPusher

> Organize thousands of photos and videos into clean, date-based folders. Fast, safe, local.

![PixelPusher](https://img.shields.io/badge/version-1.0.0-blue)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)
![License](https://img.shields.io/badge/license-Proprietary-red)

PixelPusher is a desktop app for anyone drowning in unorganized photos. Point it at a messy folder (or a whole drive), and it'll read the dates from your photos and videos, find duplicates, and organize everything into a folder structure you choose. Nothing leaves your computer.

## What it does

- **Scans any folder** — recursively finds every photo and video, reads EXIF dates, falls back to filename and file system dates when EXIF is missing
- **Organizes by date** — customizable folder patterns like `2024/January` or `2024/Q1/March` or `By Camera/iPhone 14 Pro/2024`
- **Finds duplicates** — perceptual hashing catches visually identical photos even if they're renamed, resized, or slightly different quality
- **Handles Google Takeout and iCloud exports** — parses the JSON sidecars, links Live Photo pairs, deduplicates album copies
- **Junk detection** — flags thumbnails, face crops, and cache files from Lightroom, iPhoto, Picasa, and Synology
- **Supports 40,000+ file libraries** — tested on real photo libraries with stable memory usage throughout
- **Safe by default** — copies files rather than moves, logs every operation, full undo for any session

## Screenshots

<!-- Add screenshots here -->

## Installation

### Windows

1. Download `PixelPusher Setup 1.0.0.exe` from the [latest release](https://github.com/christhomas2131/pixelpusher/releases/latest)
2. Double-click to install
3. Launch PixelPusher from the Start menu

**Note on Windows SmartScreen:** PixelPusher is not currently code-signed, so Windows will show a "Windows protected your PC" warning on first install. Click **More info** → **Run anyway**. This is standard for small indie apps until a code signing certificate is purchased.

### System Requirements

- Windows 10 or 11 (64-bit)
- 8 GB RAM recommended for libraries over 20,000 files
- 500 MB free disk space for the app itself
- Additional disk space equal to your library size if using Copy mode

## Quick Start

1. **Add a source folder** — click "+ Add Source" and pick the folder (or drive) with your photos
2. **Pick scan settings** — Quick Scan (date only, fastest) or Full Scan (all metadata); Safe, Balanced, or Fast speed
3. **Click Scan Folder** — PixelPusher reads every file and extracts metadata
4. **Choose a destination** — where the organized copies should go
5. **Pick a folder pattern** — e.g. `{YYYY}/{MMM}` for `2024/January`
6. **Choose Copy or Move** — Copy is safer (keeps originals), Move frees up space
7. **Click Organize** — PixelPusher creates the folder structure and places every file correctly

Every operation is logged. You can undo any session from the History panel.

## Folder Pattern Tokens

Build your own folder structure using these tokens:

| Token | Example |
|-------|---------|
| `{YYYY}` | 2024 |
| `{YY}` | 24 |
| `{MM}` | 03 |
| `{MMM}` | March |
| `{DD}` | 15 |
| `{QUARTER}` | Q1 |
| `{HALF}` | H1 |
| `{YEAR_RANGE}` | 2020-2024 |
| `{CAMERA}` | iPhone 14 Pro |
| `{TYPE}` | image |
| `{TYPE_LABEL}` | Photos |
| `{EXT}` | jpg |

**Examples:**
- `{YYYY}/{MMM}` → `2024/March`
- `{YYYY}/{QUARTER}/{MMM}` → `2024/Q1/March`
- `{CAMERA}/{YYYY}` → `iPhone 14 Pro/2024`
- `{TYPE_LABEL}/{YYYY}` → `Photos/2024` and `Videos/2024`

## Supported File Types

**Photos:** JPG, JPEG, PNG, HEIC, HEIF, RAW (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2, and more)

**Videos:** MP4, MOV, M4V, AVI, MKV, WMV, 3GP, MTS

**Also supported (toggle in settings):** PDF, DOCX, MP3, FLAC, PSD, AI, STL, OBJ, and more

## Privacy

PixelPusher runs entirely on your computer. No photos, metadata, or telemetry ever leave your device. There is no cloud sync, no online account, no external servers.

## Pricing

- **Free tier** — 500 files per scan, core organize features
- **Pro** — unlimited files, multi-source folders, duplicate detection, Sort by Type, undo, $12 one-time purchase

## Known Issues

- Code signing not yet in place — Windows SmartScreen will warn on first install (see Installation notes above)
- macOS and Linux builds coming in future releases
- Very large libraries (100,000+ files) may take 30+ minutes on slower drives

## Roadmap

- [ ] macOS support
- [ ] Linux support (AppImage)
- [ ] Code signing certificate
- [ ] Face recognition grouping (opt-in, fully local)
- [ ] Smart album suggestions
- [ ] Folder watcher for auto-organizing new files

## Report Bugs

Open an issue at [github.com/christhomas2131/pixelpusher/issues](https://github.com/christhomas2131/pixelpusher/issues) and include:
- Your Windows version
- PixelPusher version (Help > About)
- A description of what happened
- The log file from `%USERPROFILE%\.photomove\logs\` (drag and drop onto the issue)

## License

Copyright © 2026. All rights reserved. PixelPusher is proprietary software. See [LICENSE](LICENSE) for terms.

---

*Built with Electron, TypeScript, React, SQLite, and exiftool.*
