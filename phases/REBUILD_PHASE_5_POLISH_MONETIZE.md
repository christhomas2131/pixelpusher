# PixelPusher — Rebuild Phase 5: UI Polish + Monetization

## Context

Phases 1-4 complete: full pipeline working — scan, metadata, organize, dupes, multi-source, sort by type, Google Takeout. This phase polishes the UI, adds licensing, and creates the landing page.

## Part 1: UI Polish

### Theme System
- CSS variables for all colors
- Dark mode (default), Light mode, System (follows OS via nativeTheme)
- Toggle in View menu and Settings panel

### Typography and Spacing
- Consistent font scale: titles 18px, headers 14px, body 13px, small 11px, badges 10px
- Consistent spacing: panels 16px, gaps 12px, tight 6px
- Long filenames/paths truncate with ellipsis + tooltip on hover

### Preview Table
- Virtual scrolling — only render visible rows (30-50) not all rows as DOM
- Sticky header row
- Alternating row backgrounds (subtle)
- Row hover highlight
- Sort arrows on active column
- Column widths: Thumb 48px, Type 70px, Filename flex, Date 120px, Camera 120px, Source 200px, Dest 200px, Size 80px

### Empty States
- No source selected: "Select a folder to get started"
- No files found: "No supported files found in this folder"
- No dupes: "No duplicates detected — your library is clean!"
- History empty: "No operations yet"
- Filter no results: "No files match your filter"

### Before/After Visualization
- Side-by-side folder tree view
- Before: source structure with color coding
- After: destination structure (projected or actual)
- Stats between trees: folder count reduction, depth reduction

### PDF Export Report
- Cover page: "PixelPusher — Organization Report"
- Summary: files processed, dupes found, junk detected, errors
- Date distribution chart
- Format breakdown
- Error list
- Save dialog for export

### Error Boundaries
- React ErrorBoundary wrapping entire app
- Shows "Something went wrong" with Restart button instead of white screen
- Logs error to logger

## Part 2: License System

### Key Format
Prefix: `PXLP`
Format: `PXLP-XXXX-XXXX-XXXX-XXXX` (alphanumeric, no I/O/0/1)
Offline validation via embedded checksum — no server needed

### Free vs Pro

| Feature | Free | Pro ($12) |
|---------|------|-----------|
| Scan + preview | Unlimited | Unlimited |
| Organize | 100 files/session | Unlimited |
| Duplicates | 5 groups shown | Unlimited |
| Multi-source | No | Yes |
| Undo | No | Yes |
| Sort by Type | No | Yes |
| AI tagging | No | Yes |
| Updates | Current version | 1 year |

### License UI
- "Upgrade to Pro" button in header (orange, visible in free mode)
- Settings > License: key entry field, Activate button
- Pro features show lock icon with "Upgrade" tooltip in free mode

### Key Generator
`scripts/generate-license-key.ts` — generates batch of valid keys
Run: `npx tsx scripts/generate-license-key.ts --count 100`

## Part 3: Landing Page

Create `website/index.html` — single-page, dark theme, self-contained HTML/CSS/JS.

Sections:
- Hero: "Your photos are everywhere. Put them where they belong." + Download/Buy buttons
- Stats bar: 40K+ files, 100% local, $12 one-time, 3 platforms
- Problem: scattered photos, Google Takeout nightmare, tools that crash
- Features: 8 cards (date org, dupe detection, Takeout parser, multi-source, junk detection, sort by type, undo, AI tagging)
- Google Takeout callout section with before/after code block
- How it works: 3 steps (Scan → Review → Organize)
- Pricing: Free vs Pro comparison table
- FAQ: 6 questions (privacy, file count, originals safe, SmartScreen, formats, refund)
- CTA: "Stop scrolling. Start organizing."
- Footer: privacy policy link, contact email

Create `website/privacy.html` — PixelPusher collects no data, all local, no tracking.

## Part 4: Build Configuration

electron-builder.yml:
```yaml
appId: com.pixelpusher.app
productName: PixelPusher
publish:
  provider: github
win:
  target: nsis
mac:
  target: dmg
  category: public.app-category.photography
linux:
  target:
    - AppImage
    - deb
```

Window remembers size/position between sessions.
Minimum size: 900x600.

## Done Criteria

1. Dark/light/system theme works
2. Preview table has virtual scrolling
3. All empty states have friendly messages
4. Before/after tree visualization works
5. PDF export report generates
6. Error boundaries prevent white screen
7. License key system validates offline
8. Free tier limits enforced
9. Upgrade to Pro button works
10. Landing page complete and responsive
11. Privacy policy written
12. electron-builder produces .exe installer
13. Window size persists
