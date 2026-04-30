# Changelog

All notable changes to PixelPusher are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-04-17

### Added
- Initial release
- Recursive folder scanning with EXIF metadata extraction
- Date fallback chain (EXIF → filename → filesystem)
- Customizable folder patterns with 12 tokens
- Copy and Move modes with conflict resolution strategies
- Perceptual-hash duplicate detection for images
- SHA-256 deduplication for documents and videos
- Junk file detection (thumbnails, caches, face crops)
- Google Photos Takeout parser with Live Photo linking
- iCloud export handling
- Multi-source folder merging with color-coded badges
- Sort by Type mode (auto-splits into category folders)
- Full operation history with per-session undo
- Quick Scan and Full Scan depth options
- Safe, Balanced, and Fast speed presets
- Dark mode (default), Light mode, and Pusher Mode themes
- Resizable left panel with position persistence
- Crash logging to `%USERPROFILE%\.photomove\logs\`
- Auto-updater via GitHub Releases
- License key system for Free vs Pro tier
- Before/After folder tree visualization
- PDF export reports

### Security
- Fully local — no data leaves the user's device
- Parameterized database queries prevent SQL injection
- Input sanitization on folder patterns
- Pre-flight drive readiness check for external drives

### Performance
- Tested on libraries of 50,000+ files
- Stable memory usage (RSS under 1 GB) even on large libraries
- Batch-based processing with event loop yielding
- Operation logs stream to disk (not kept in memory)
- ExifTool singleton pattern prevents process leaks

## [Unreleased]

Future releases will be tracked here.
