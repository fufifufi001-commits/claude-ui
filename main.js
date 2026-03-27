const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

// ---- Settings / Config ----
const SETTINGS_PATH = path.join(app.getPath('userData'), 'claude-ui-settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    }
  } catch (e) {}
  return null;
}

function saveSettings(settings) {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}

function getHistoryDir() {
  const settings = loadSettings();
  if (settings?.historyDir) return settings.historyDir;
  // Default fallback
  return path.join(app.getPath('documents'), 'ClaudeHistory');
}

function getWorkingDir() {
  const settings = loadSettings();
  return settings?.workingDir || null;
}

// ---- Check Claude CLI ----
function checkClaudeCLI() {
  try {
    execSync('claude --version', { stdio: 'pipe', shell: true });
    return { installed: true };
  } catch (e) {
    return { installed: false };
  }
}

// ---- Window ----
let mainWindow;
let claudeProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1a1b2e',
    webPreferences: {
      preload: path.join(__dirname, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('src/index.html');
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (claudeProcess) claudeProcess.kill();
  app.quit();
});

// ---- IPC: Setup Wizard ----
ipcMain.handle('check-first-run', async () => {
  const settings = loadSettings();
  if (settings?.setupComplete) {
    return { firstRun: false, settings };
  }
  // First run - gather system info
  const cliCheck = checkClaudeCLI();
  const defaultHistoryDir = path.join(app.getPath('documents'), 'ClaudeHistory');
  return {
    firstRun: true,
    claudeInstalled: cliCheck.installed,
    defaultHistoryDir,
    defaultWorkingDir: app.getPath('home'),
    platform: process.platform
  };
});

ipcMain.handle('complete-setup', async (event, setupData) => {
  const settings = {
    setupComplete: true,
    historyDir: setupData.historyDir,
    workingDir: setupData.workingDir,
    claudePath: setupData.claudePath || 'claude',
    setupDate: new Date().toISOString()
  };

  // Create history directory
  if (!fs.existsSync(settings.historyDir)) {
    fs.mkdirSync(settings.historyDir, { recursive: true });
  }

  saveSettings(settings);
  return settings;
});

ipcMain.handle('get-settings', async () => {
  return loadSettings() || {};
});

ipcMain.handle('update-settings', async (event, updates) => {
  const current = loadSettings() || {};
  const merged = { ...current, ...updates };
  saveSettings(merged);
  return merged;
});

ipcMain.handle('select-directory-for', async (event, purpose) => {
  const title = purpose === 'history'
    ? 'Session gecmisi klasoru secin'
    : 'Calisma dizini secin';
  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

// ---- IPC: Window Controls ----
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

// ---- IPC: Claude CLI ----
ipcMain.handle('send-to-claude', async (event, message, imagePaths) => {
  const settings = loadSettings() || {};
  const claudeCmd = settings.claudePath || 'claude';
  const cwd = settings.workingDir || process.cwd();

  return new Promise((resolve, reject) => {
    const args = ['--print'];
    if (imagePaths && imagePaths.length > 0) {
      imagePaths.forEach(p => args.push('--image', p));
    }
    args.push(message);

    const proc = spawn(claudeCmd, args, { shell: true, cwd });

    let output = '';
    let error = '';

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      mainWindow?.webContents.send('claude-stream', chunk);
    });

    proc.stderr.on('data', (data) => {
      error += data.toString();
      mainWindow?.webContents.send('claude-agent-log', data.toString());
    });

    proc.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(error || `Process exited with code ${code}`));
    });
  });
});

let interactiveProcess = null;

ipcMain.handle('start-interactive-session', async (event, workingDir) => {
  if (interactiveProcess) interactiveProcess.kill();
  const settings = loadSettings() || {};
  const claudeCmd = settings.claudePath || 'claude';

  interactiveProcess = spawn(claudeCmd, [], {
    shell: true,
    cwd: workingDir || settings.workingDir || process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe']
  });

  interactiveProcess.stdout.on('data', (data) => {
    mainWindow?.webContents.send('claude-stream', data.toString());
  });
  interactiveProcess.stderr.on('data', (data) => {
    mainWindow?.webContents.send('claude-agent-log', data.toString());
  });
  interactiveProcess.on('close', (code) => {
    mainWindow?.webContents.send('claude-session-ended', code);
    interactiveProcess = null;
  });

  return true;
});

ipcMain.handle('send-interactive', async (event, message) => {
  if (interactiveProcess && interactiveProcess.stdin.writable) {
    interactiveProcess.stdin.write(message + '\n');
    return true;
  }
  return false;
});

// ---- IPC: Session History ----
function collectMdFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  files.forEach(f => {
    try {
      const content = fs.readFileSync(path.join(dir, f), 'utf-8');
      const titleMatch = content.match(/^# (.+)/m);
      const dateMatch = content.match(/\*\*Tarih:\*\* (.+)/m);
      results.push({
        filename: f,
        subdir: path.basename(dir) === path.basename(getHistoryDir()) ? '' : path.basename(dir),
        title: titleMatch ? titleMatch[1] : f,
        date: dateMatch ? dateMatch[1] : f.substring(0, 10),
        path: path.join(dir, f)
      });
    } catch (e) {}
  });
  return results;
}

ipcMain.handle('get-sessions', async () => {
  try {
    const histDir = getHistoryDir();
    if (!fs.existsSync(histDir)) fs.mkdirSync(histDir, { recursive: true });

    // Collect from root and sessions/ subfolder
    let all = [];
    all.push(...collectMdFiles(histDir));
    const sessionsDir = path.join(histDir, 'sessions');
    if (fs.existsSync(sessionsDir)) {
      all.push(...collectMdFiles(sessionsDir));
    }

    return all.sort((a, b) => b.filename.localeCompare(a.filename));
  } catch (e) {
    return [];
  }
});

ipcMain.handle('load-session', async (event, filename, subdir) => {
  const histDir = getHistoryDir();
  // Try subdir first, then sessions/, then root
  const candidates = [
    subdir ? path.join(histDir, subdir, filename) : null,
    path.join(histDir, 'sessions', filename),
    path.join(histDir, filename)
  ].filter(Boolean);

  for (const fp of candidates) {
    if (fs.existsSync(fp)) return fs.readFileSync(fp, 'utf-8');
  }
  return null;
});

ipcMain.handle('save-session', async (event, filename, content) => {
  // Save new sessions to sessions/ subfolder
  const sessionsDir = path.join(getHistoryDir(), 'sessions');
  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, filename), content, 'utf-8');
  return true;
});

// Senkron versiyon (beforeunload icin)
ipcMain.on('save-session-sync', (event, filename, content) => {
  try {
    const sessionsDir = path.join(getHistoryDir(), 'sessions');
    if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, filename), content, 'utf-8');
    event.returnValue = true;
  } catch (e) {
    event.returnValue = false;
  }
});

// ---- IPC: Search across sessions and projects ----
ipcMain.handle('search-history', async (event, query) => {
  const histDir = getHistoryDir();
  const results = [];
  const q = query.toLowerCase();

  function searchDir(dir, category) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir);
    items.forEach(item => {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory() && item !== '.git' && item !== 'node_modules') {
        searchDir(fullPath, category || item);
      } else if (item.endsWith('.md') || item.endsWith('.json')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (content.toLowerCase().includes(q) || item.toLowerCase().includes(q)) {
            const titleMatch = content.match(/^# (.+)/m);
            results.push({
              filename: item,
              title: titleMatch ? titleMatch[1] : item,
              category: category || 'sessions',
              path: fullPath,
              snippet: getSnippet(content, q)
            });
          }
        } catch (e) {}
      }
    });
  }

  function getSnippet(text, query) {
    const idx = text.toLowerCase().indexOf(query);
    if (idx === -1) return '';
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + query.length + 40);
    return (start > 0 ? '...' : '') + text.substring(start, end) + (end < text.length ? '...' : '');
  }

  searchDir(histDir, '');
  return results.slice(0, 50);
});

// ---- IPC: Terminal Session Sync ----
function syncTerminalSessions(opts = {}) {
  const os = require('os');
  const claudeDir = path.join(os.homedir(), '.claude');
  const projectsDir = path.join(claudeDir, 'projects');
  const sessionsDir = path.join(getHistoryDir(), 'sessions');

  if (!fs.existsSync(projectsDir)) return { synced: 0, skipped: 0, errors: [] };
  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

  const TOPIC_MAP = {
    'cauldroncrush': /cauldroncrush|brewburst|cauldron|puzzle|level|oyun|game/i,
    'vitalboost': /vitalboost|scansense|mediscribe|saglik|health|ilac|medikal/i,
    'kozmetify': /kozmetify|fiyatradari|fiyat|kozmetik|cosmetic/i,
    'claude_ui': /claude.?ui|electron|wrapper|panel|aray[uü]z|session.*panel|titlebar/i,
    'comfyui': /comfyui|workflow|controlnet|lora|sampler|qwen.*image/i,
    'masal': /masal|hikaye|story|tale|fikra/i,
    'git_github': /github|git\s|commit|push|pull.*request|repo/i,
    'ai_provider': /openrouter|groq|mistral|gemini|api.*key|provider|fallback/i,
    'apple_ios': /apple|ios|xcode|testflight|duns|app.*store/i,
    'wsl_build': /wsl|ubuntu|linux|aab.*build/i,
  };

  function detectTopic(text) {
    let bestTopic = null, bestScore = 0;
    for (const [topic, regex] of Object.entries(TOPIC_MAP)) {
      const matches = text.match(new RegExp(regex.source, 'gi'));
      const score = matches ? matches.length : 0;
      if (score > bestScore) { bestScore = score; bestTopic = topic; }
    }
    return bestTopic;
  }

  function isAlreadySynced(sessionId) {
    try {
      const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('_cli.md'));
      for (const f of files) {
        const content = fs.readFileSync(path.join(sessionsDir, f), 'utf-8');
        if (content.includes(`session:${sessionId}`)) return f;
      }
    } catch (e) {}
    return false;
  }

  function parseConversation(jsonlPath) {
    const content = fs.readFileSync(jsonlPath, 'utf-8');
    const lines = content.trim().split('\n');
    const messages = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'user') {
          const text = typeof entry.message?.content === 'string'
            ? entry.message.content
            : Array.isArray(entry.message?.content)
              ? entry.message.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
              : '';
          if (text.trim()) messages.push({ role: 'user', text: text.trim(), timestamp: entry.timestamp });
        } else if (entry.type === 'assistant' && entry.message?.content) {
          const textParts = [];
          const toolCalls = [];
          for (const block of entry.message.content) {
            if (block.type === 'text' && block.text?.trim()) textParts.push(block.text.trim());
            else if (block.type === 'tool_use') toolCalls.push(block.name);
          }
          let text = textParts.join('\n\n');
          if (toolCalls.length > 0 && !text) text = `[Araclar: ${[...new Set(toolCalls)].join(', ')}]`;
          else if (toolCalls.length > 0) text += `\n\n_Araclar: ${[...new Set(toolCalls)].join(', ')}_`;
          if (text.trim()) messages.push({ role: 'assistant', text: text.trim(), timestamp: entry.timestamp });
        }
      } catch (e) {}
    }
    return messages;
  }

  // Find conversations
  const conversations = [];
  const projectDirs = fs.readdirSync(projectsDir);
  for (const projDir of projectDirs) {
    const projPath = path.join(projectsDir, projDir);
    if (!fs.statSync(projPath).isDirectory()) continue;
    const files = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const filePath = path.join(projPath, file);
      const stat = fs.statSync(filePath);
      if (stat.size < 1000) continue;
      if (!opts.all) {
        const today = new Date().toISOString().split('T')[0];
        const fileDate = stat.mtime.toISOString().split('T')[0];
        if (fileDate !== today) continue;
      }
      conversations.push({ path: filePath, sessionId: file.replace('.jsonl', ''), mtime: stat.mtime, size: stat.size });
    }
  }

  let synced = 0, skipped = 0;
  const errors = [];

  for (const conv of conversations) {
    if (!opts.force && isAlreadySynced(conv.sessionId)) { skipped++; continue; }
    try {
      const messages = parseConversation(conv.path);
      if (messages.length < 2) { skipped++; continue; }

      const firstMsg = messages[0];
      const lastMsg = messages[messages.length - 1];
      const firstTime = new Date(firstMsg.timestamp);
      const lastTime = new Date(lastMsg.timestamp);
      const dateStr = firstTime.toISOString().split('T')[0];
      const startTime = firstTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      const endTime = lastTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      // Topic detection: ilk 20 mesajdan belirle (uzun oturumlarda konu kaymasini onler)
      const topicText = messages.slice(0, 20).map(m => m.text).join(' ');
      const topic = detectTopic(topicText);
      const firstUserMsg = messages.find(m => m.role === 'user')?.text || 'Session';
      const title = firstUserMsg.substring(0, 80).replace(/\n/g, ' ');
      const userCount = messages.filter(m => m.role === 'user').length;
      const assistantCount = messages.filter(m => m.role === 'assistant').length;

      let md = `# ${title}\n\n`;
      md += `**Tarih:** ${dateStr}\n`;
      md += `**Saat:** ${startTime} - ${endTime}\n`;
      md += `**Kaynak:** Terminal (Claude Code CLI)\n`;
      md += `**Mesaj:** ${userCount} kullanici, ${assistantCount} asistan\n`;
      if (topic) md += `**Konu:** ${topic}\n`;
      md += `\n---\n\n## Diyalog\n\n`;

      for (const m of messages) {
        const ts = new Date(m.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (m.role === 'user') {
          md += `### Kullanici (${ts})\n${m.text}\n\n`;
        } else {
          const dot = /```/.test(m.text) ? '\u{1F7E2}' : '\u26AA';
          md += `### ${dot} Claude (${ts})\n${m.text}\n\n`;
        }
      }
      md += `\n---\n_<!-- session:${conv.sessionId} -->_\n`;

      const slug = topic || firstUserMsg.substring(0, 40).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      let filename = `${dateStr}_${slug}_cli.md`;
      let outPath = path.join(sessionsDir, filename);
      if (fs.existsSync(outPath) && !opts.force) {
        const base = filename.replace('.md', '');
        let n = 2;
        while (fs.existsSync(path.join(sessionsDir, `${base}_${n}.md`))) n++;
        outPath = path.join(sessionsDir, `${base}_${n}.md`);
        filename = `${base}_${n}.md`;
      }

      fs.writeFileSync(outPath, md, 'utf-8');
      synced++;
    } catch (e) {
      errors.push(`${conv.sessionId}: ${e.message}`);
    }
  }

  return { synced, skipped, errors, total: conversations.length };
}

ipcMain.handle('sync-terminal-sessions', async (event, opts) => {
  return syncTerminalSessions(opts || {});
});

// ---- IPC: Temp Images ----
ipcMain.handle('save-temp-image', async (event, base64Data) => {
  const tempDir = path.join(app.getPath('temp'), 'claude-ui-images');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const filename = `paste_${Date.now()}.png`;
  const filePath = path.join(tempDir, filename);
  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
  return filePath;
});

// ---- IPC: Select Directory ----
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});
