# Claude UI

A modern, 4-panel desktop wrapper for [Claude Code CLI](https://github.com/anthropics/claude-code). Makes working with Claude Code visual, intuitive and productive.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Electron](https://img.shields.io/badge/electron-41-purple)

---

## Features

- **4-Panel Layout** — Chat, Code, History, Agent/Skill logs all visible at once
- **Screenshot Paste** — `Ctrl+V` to paste screenshots directly into chat (no more Paint!)
- **Code Panel** — Code blocks auto-extracted to a dedicated panel with syntax highlighting, tabs, and one-click copy
- **Click-to-Send** — Click any code block in chat to send it to the code panel
- **Session History** — All conversations auto-saved, searchable, and exportable as Markdown
- **Custom Prompt Templates** — Add, edit, reorder, and delete your own quick-action buttons
- **Dark/Light Theme** — Toggle with `Ctrl+T`
- **Agent & Skill Monitor** — Real-time log of what Claude is doing behind the scenes
- **Setup Wizard** — First-run guide configures history folder, working directory, and checks CLI
- **Portable .exe** — No installation needed, just double-click and go
- **Keyboard Shortcuts** — Full shortcut support for power users

## Screenshots

```
+--------+-------------------------+------------------+
| History|      Active Chat        |   Code Panel     |
| -------|                         |   [tabs]         |
| Search |  User <-> Claude        |   syntax hl      |
|        |  screenshot paste       |   copy button    |
| Agent  |  prompt templates       |   diff view      |
| Logs   |                         |                  |
+--------+-------------------------+------------------+
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `Ctrl+V` | Paste screenshot |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+J` | Toggle code panel |
| `Ctrl+T` | Toggle theme |
| `Ctrl+Shift+S` | Save session |
| `Ctrl+Shift+E` | Export session as MD |
| `F1` | Help screen |

## Installation

### Windows (Portable)

1. Download `Claude.UI.1.0.0.exe` from [Releases](../../releases)
2. Double-click to run — no installation needed
3. Setup wizard will guide you through initial configuration

### macOS

1. Clone this repo
2. Run the setup script:
```bash
chmod +x setup-mac.sh
./setup-mac.sh
```

### From Source

```bash
git clone https://github.com/fufifufi001-commits/claude-ui.git
cd claude-ui
npm install
npm start
```

## Requirements

- [Claude Code CLI](https://github.com/anthropics/claude-code) must be installed:
```bash
npm install -g @anthropic-ai/claude-code
```

## Build

```bash
# Windows
npm run build

# macOS (must be on macOS)
npm run build:mac
```

## Tech Stack

- **Electron** — Cross-platform desktop app
- **Vanilla HTML/CSS/JS** — No framework overhead, fast and lightweight
- **Claude Code CLI** — Powers the AI backend

## License

MIT

---

Built with Claude Code.
