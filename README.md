# SubtideX

<div align="center">
  <img src="icons/icon128.png" alt="SubtideX" width="96" height="96">
  <p><strong>Download YouTube captions in one calm click.</strong></p>
  <p>
    <a href="https://github.com/yniijia/SubtideX">GitHub</a> ·
    <a href="https://github.com/yniijia/SubtideX/issues">Report an issue</a>
  </p>
</div>

SubtideX is a Chrome extension (Manifest V3) that extracts subtitles from YouTube videos and saves them as CSV. It opens YouTube’s transcript panel, reads captions directly from the page, and downloads a timestamped file to your **Downloads** folder.

Built for researchers, creators, language learners, and anyone who needs transcripts without copy-pasting line by line.

## Features

- **One-click download** — open the popup on a watch page and click **Download Captions**
- **Transcript-panel extraction** — reads captions from YouTube’s visible transcript UI (works when API URLs are token-gated)
- **Live progress** — a bottom-right panel shows three steps: open panel → read captions → save CSV
- **Video context in popup** — thumbnail and title for the current video
- **Tidal UI** — calm, premium interface with automatic light/dark mode
- **Privacy-first** — extraction runs locally in your browser; no external servers
- **Original filename** — CSV is named after the video title

## Requirements

- Google Chrome or a Chromium-based browser (Edge, Brave, Arc, etc.)
- A YouTube video with captions or a transcript available

## Installation

### From source (developer mode)

1. Clone the repository:
   ```bash
   git clone https://github.com/yniijia/SubtideX.git
   cd SubtideX
   ```
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode**
4. Click **Load unpacked** and select the project folder

### From a release ZIP

1. Download `subtidex.zip` from [Releases](https://github.com/yniijia/SubtideX/releases) (or run `npm run build` locally)
2. Unzip the archive
3. Load the unzipped folder via **Load unpacked** on `chrome://extensions/`

## Usage

1. Open any YouTube video (`youtube.com/watch?v=…`)
2. Click the **SubtideX** icon in the toolbar
3. Click **Download Captions**
4. Watch the progress panel in the bottom-right corner of the page
5. Find the CSV in your **Downloads** folder

The extension opens the transcript panel automatically. You can also open it yourself first (**⋯ → Show transcript**) if a video loads captions slowly.

## CSV format

| Column      | Description                          |
|-------------|--------------------------------------|
| Start Time  | When the line begins (`HH:MM:SS.mmm`) |
| End Time    | When the line ends                   |
| Duration    | Length in seconds                    |
| Text        | Caption text                         |

Example:

```csv
Start Time,End Time,Duration,Text
00:00:00.000,00:00:04.160,4.16,"Welcome to this tutorial"
00:00:04.160,00:00:08.240,4.08,"Today we'll cover the basics"
```

## How it works

SubtideX uses a transcript-first extraction flow:

1. **Open** YouTube’s transcript engagement panel (right side of the watch page)
2. **Scrape** caption rows from the DOM (`.segment-text`, `#segments-container`, and related 2025–2026 YouTube UI selectors)
3. **Scroll** the panel to load virtualized segments
4. **Convert** results to CSV and trigger a browser download

If transcript scraping is unavailable, the extension may fall back to player caption data when YouTube serves non-token-gated URLs. Videos that only expose token-protected caption endpoints (`exp=xpe`) rely on the transcript panel path.

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| “No subtitles found” | Refresh the page, open **Show transcript**, wait for lines to appear, retry |
| Timeout | Ensure the transcript panel is visible and the video has captions |
| Empty CSV / partial file | Scroll the transcript manually, then extract again |
| Extension not on video page | URL must be `youtube.com/watch?v=…` |

For persistent problems, open DevTools (**F12 → Console**) and look for `SubtideX:` log messages, then [open an issue](https://github.com/yniijia/SubtideX/issues) with the video URL and error text.

## Development

### Project structure

```
SubtideX/
├── manifest.json          # Extension manifest (MV3)
├── popup.html / popup.js  # Toolbar popup UI
├── content.js             # YouTube page script (extraction + Tidal overlay)
├── background.js          # Service worker (downloads, messaging)
├── innertube-extract.js   # Optional MAIN-world InnerTube helpers
├── error.html             # Error fallback page
├── ui/
│   └── tidal.css          # Shared Tidal design system (popup + error)
├── icons/                 # Extension icons
├── scripts/
│   └── check.mjs          # Sanity checks for required files
└── package.json           # Build/check scripts
```

### Scripts

No npm dependencies are required. From the project root:

```bash
# Verify required files and manifest JSON
npm run check

# Create dist/subtidex.zip for distribution
npm run build

# Remove build output
npm run clean
```

After changing code, reload the extension on `chrome://extensions/` and hard-refresh the YouTube tab.

## Browser support

| Browser | Supported |
|---------|-----------|
| Google Chrome | Yes |
| Microsoft Edge | Yes |
| Brave | Yes |
| Firefox | No (MV3 APIs differ) |

## Limitations

- Only works on YouTube **watch** pages with available captions/transcripts
- Live streams and some premium or region-locked content may not expose transcripts
- Caption quality depends on what YouTube provides (auto-generated vs. manual)

## Roadmap

- [ ] Additional export formats (TXT, SRT, VTT)
- [ ] Recent extraction history
- [ ] Keyboard shortcut on YouTube watch pages

## License

MIT — see [LICENSE](LICENSE).

## Author

**Tony Fiston** — [github.com/yniijia](https://github.com/yniijia)

If SubtideX saves you time, consider [starring the repo](https://github.com/yniijia/SubtideX).
