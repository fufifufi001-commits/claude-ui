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
