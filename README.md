# Fold Cycle

org-mode style `S-TAB` fold cycling for Obsidian, using the CM6 `foldEffect` API for real per-heading fold control.

## States

```
SHOW ALL → TOP LEVEL → H1 + H2 → ALL HEADINGS → SHOW ALL → ...
```

| State | What's visible |
|---|---|
| **▼ SHOW ALL** | Everything unfolded |
| **▶ TOP LEVEL** | H1 heading lines only — full sections collapsed |
| **▷ H1 + H2** | H1 and H2 heading lines — H3+, body text collapsed |
| **▸ ALL HEADINGS** | Every heading level visible — body text collapsed |

A brief notice appears top-right confirming the current state.
State resets to SHOW ALL on file switch.

## Build

```bash
npm install
npm run build   # produces main.js
```

Then copy the folder (manifest.json + main.js) into `.obsidian/plugins/fold-cycle/`.

## Hotkey

Settings → Hotkeys → search `Cycle fold state` → assign `Shift+Tab`.
First clear `Shift+Tab` from the built-in **Fold all** command if it's set there.

## Implementation notes

Uses `foldEffect` / `unfoldEffect` / `foldedRanges` from `@codemirror/language`
dispatched via `editor.cm` (the internal CM6 EditorView). This is the same approach
Obsidian uses internally and gives proper per-range fold control, unlike the
`editor.fold(lineNumber)` approach which is unreliable without a build step.

The `@codemirror/*` packages are declared `external` in esbuild so they're not
bundled — Obsidian ships them and they're resolved at runtime from the app.
