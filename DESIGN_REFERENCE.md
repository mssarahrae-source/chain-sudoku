# Chain Sudoku — Design Reference

Use this document when building a new game that should match the look and feel of Chain Sudoku.
Full source files are at: /a0/usr/projects/chain_sudoku/

---

## Color Palette

| Role | Light Mode | Dark Mode |
|------|-----------|----------|
| Page background | #f0f4f8 | #1a1a2e |
| Game board background | #ffffff | #16213e |
| Primary button (blue) | #4a7fc1 | #4a7fc1 |
| Primary button hover | #3a6aa8 | #3a6aaa |
| Success button (green) | #5cb85c | #2a6e2a |
| Success button hover | #4cae4c | #3a7e3a |
| Given/clue cell fill | #FFE600 (yellow) | #DED790 (pale yellow) |
| Selected cell fill | pale blue tint + glow | deep navy + blue glow |
| Error/blink color | #ff6b35 (orange-red) | #cc3300 (dark red) |
| Circle stroke (normal) | #222 | #ffffff |
| Chain line stroke | #222 | #ffffff |
| Notes text color | #4a7fc1 (blue) | #7ab3f5 |
| Text | #333 | #e0e0e0 |

---

## Typography
- Font: system-ui, sans-serif
- Base button font size: 0.9rem, font-weight: 600
- Title: ~1.8rem bold
- Subtitle/hint: ~0.85rem, color #666

---

## Button System

All buttons share a base style:
```css
button {
  padding: 8px 18px;
  border: none;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}
button:active { transform: scale(0.96); }
```

### Button Types
- **Blue (primary)**: New Puzzle, How to Play, Play Again — background #4a7fc1
- **Green (action)**: Check, Print Puzzle — background #5cb85c
- **Grey (toggle)**: Notes, Undo, Clear, Dark Mode, Color Chains — background #eee, border 2px solid #bbb
- **Active toggle**: turns blue (#4a7fc1) when on
- **Active notes**: turns green (#5cb85c) when on

---

## Layout Structure

```
[Header: title + subtitle/hint]
[Row 1: New Puzzle | Grid selector | Difficulty selector | How to Play]
[Print Puzzle button row]
[Game Board (SVG)]
[Status message]
[Action Row 1: Notes | Undo | Clear | Check]
[Action Row 2: Dark Mode | Color Chains]
[Win overlay (hidden until win)]
[Rules modal (hidden until help clicked)]
```

---

## Puzzle Generation Pattern
- generator.js is separate from game.js
- Uses backtracking solver with MRV (Minimum Remaining Values) heuristic
- Solver has node limits to prevent browser freeze (30,000 solve / 8,000 uniqueness check)
- tryGeneratePuzzle() returns null if over limit — caller retries in async loop
- mainThreadGenerate() yields to browser every 3 attempts via setTimeout(0)
- Web Worker attempted first; falls back to main thread on file:// protocol
- Difficulty: Easy=35% removed, Medium=50%, Hard=65%

---

## Key Features Implemented
1. True yellow given cells (#FFE600), pale yellow in dark mode
2. Dark mode toggle (full theme swap)
3. Color Chains toggle (each chain gets distinct color)
4. Notes mode (candidate numbers centered in circle, small font)
5. Undo stack (Ctrl+Z supported)
6. Arrow key navigation (moves through all cells including given)
7. Blink animation on incorrect entry (temporarily removes selected class)
8. Win celebration: rainbow row/col flash + chain color flash
9. Difficulty selector (Easy/Medium/Hard)
10. Printable version (two-page: puzzle + answer key)
11. How to Play modal
12. Notes conflict prevention (blocks conflicting candidates)

---

## SVG Board Rendering
- Board drawn entirely in SVG
- Circles use cx/cy/r attributes with inline style for stroke (not CSS class) to allow JS color override
- Chain lines drawn as SVG <line> elements with inline style stroke
- Selected cell: add CSS class + JS updates fill/filter for glow effect
- Notes: SVG <text> elements positioned at circle center
- Given cells: SVG <text> with given-text class for dark mode outline

---

## GitHub / itch.io
- GitHub: https://github.com/mssarahrae-source/chain-sudoku
- GitHub Pages: https://mssarahrae-source.github.io/chain-sudoku/
- Git user: mssarahrae-source / ms.sarahrae@gmail.com
- To ship update: git is initialized in /a0/usr/projects/chain_sudoku/
