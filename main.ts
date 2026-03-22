import { Plugin, Editor, MarkdownView, Notice } from 'obsidian';
import { foldEffect, unfoldEffect, foldedRanges } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

// ─── Types ────────────────────────────────────────────────────────────────────

type FoldState = 'showall' | 'toplevel' | 'h1h2' | 'allheadings';

const CYCLE: FoldState[] = ['showall', 'toplevel', 'h1h2', 'allheadings'];

const LABELS: Record<FoldState, string> = {
  showall:     '▼ SHOW ALL',
  toplevel:    '▶ TOP LEVEL (H1 only)',
  h1h2:        '▷ H1 + H2',
  allheadings: '▸ ALL HEADINGS',
};

// ─── Heading ──────────────────────────────────────────────────────────────────

interface Heading {
  level:     number;  // 1–6
  lineStart: number;  // line index (0-based)
  from:      number;  // char offset of heading line start
  to:        number;  // char offset of end of this heading's section
}

const HEADING_RE = /^(#{1,6}) /;

/**
 * Parse all headings from the CM6 EditorState and compute the character range
 * each heading "owns" (from its line start up to, but not including, the next
 * heading at the same level or higher, or EOF).
 */
function parseHeadings(state: EditorState): Heading[] {
  const doc = state.doc;
  const headings: Heading[] = [];

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const m = line.text.match(HEADING_RE);
    if (!m) continue;
    headings.push({
      level:     m[1].length,
      lineStart: i,
      from:      line.from,
      to:        -1, // filled below
    });
  }

  // Compute the `to` for each heading: end of last line before next sibling/ancestor
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    let endLine = doc.lines; // default: EOF

    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= h.level) {
        // next heading at same level or higher — section ends before it
        endLine = headings[j].lineStart - 1;
        break;
      }
    }

    h.to = doc.line(endLine).to;
  }

  return headings;
}

// ─── CM6 fold helpers ─────────────────────────────────────────────────────────

/**
 * Unfold everything by dispatching unfoldEffect for every currently-folded range.
 */
function unfoldAll(cm: EditorView) {
  const folded = foldedRanges(cm.state);
  const effects: ReturnType<typeof unfoldEffect.of>[] = [];

  let cursor = folded.iter();
  while (cursor.value !== null) {
    effects.push(unfoldEffect.of({ from: cursor.from, to: cursor.to }));
    cursor.next();
  }

  if (effects.length) cm.dispatch({ effects });
}

/**
 * Fold a set of headings by dispatching foldEffect for each.
 * `from` is placed one character past the heading line end so the
 * heading text itself remains visible; `to` is the section end.
 */
function foldHeadings(cm: EditorView, headings: Heading[]) {
  const doc = cm.state.doc;
  const effects: ReturnType<typeof foldEffect.of>[] = [];

  for (const h of headings) {
    const headingLineEnd = doc.line(h.lineStart).to;
    // Only fold if there is actually content after the heading line
    if (headingLineEnd < h.to) {
      effects.push(foldEffect.of({ from: headingLineEnd, to: h.to }));
    }
  }

  if (effects.length) cm.dispatch({ effects });
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default class FoldCyclePlugin extends Plugin {
  private stateIndex = 0;

  async onload() {
    // Reset to SHOW ALL on file switch
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.stateIndex = 0;
      })
    );

    this.addCommand({
      id:   'cycle-global-fold',
      name: 'Cycle fold state (org-mode style)',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        // Access the underlying CM6 EditorView
        // @ts-ignore — internal Obsidian API
        const cm = editor.cm as EditorView;
        if (!cm) {
          new Notice('Fold Cycle: could not access editor internals.', 3000);
          return;
        }
        this.cycleFold(cm);
      },
    });
  }

  private cycleFold(cm: EditorView) {
    this.stateIndex = (this.stateIndex + 1) % CYCLE.length;
    const state = CYCLE[this.stateIndex];

    switch (state) {
      case 'showall':
        unfoldAll(cm);
        break;

      case 'toplevel':
        this.applyTopLevel(cm);
        break;

      case 'h1h2':
        this.applyH1H2(cm);
        break;

      case 'allheadings':
        this.applyAllHeadings(cm);
        break;
    }

    new Notice(LABELS[state], 1500);
  }

  /**
   * TOP LEVEL: unfold everything, then fold every heading at level >= 1.
   * Only H1 heading lines remain visible; their entire sections collapse.
   */
  private applyTopLevel(cm: EditorView) {
    unfoldAll(cm);
    const headings = parseHeadings(cm.state);
    // Fold all H1 sections (which implicitly hides H2+ inside them)
    foldHeadings(cm, headings.filter(h => h.level === 1));
  }

  /**
   * H1 + H2: unfold everything, then fold every heading at level >= 2.
   * H1 and H2 heading lines stay visible; H3+ and body text are hidden.
   */
  private applyH1H2(cm: EditorView) {
    unfoldAll(cm);
    const headings = parseHeadings(cm.state);
    foldHeadings(cm, headings.filter(h => h.level >= 2));
  }

  /**
   * ALL HEADINGS: unfold everything, then fold any heading whose section
   * contains body content (non-heading lines). All heading lines at every
   * level remain visible; only body text is hidden.
   */
  private applyAllHeadings(cm: EditorView) {
    unfoldAll(cm);
    const headings = parseHeadings(cm.state);
    const doc = cm.state.doc;

    const toFold = headings.filter(h => {
      // Walk lines inside this heading's section (after the heading line itself)
      for (let ln = h.lineStart + 1; ln <= doc.lines; ln++) {
        const lineFrom = doc.line(ln).from;
        if (lineFrom > h.to) break;

        const text = doc.line(ln).text.trim();
        if (text === '') continue;
        if (!HEADING_RE.test(text)) return true; // body content found
        break; // hit a sub-heading — no direct body content
      }
      return false;
    });

    foldHeadings(cm, toFold);
  }
}
