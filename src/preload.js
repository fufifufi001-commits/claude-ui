const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claude', {
  generateUUID: () => {
    // Simple UUID v4 generator (no crypto dependency)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  },
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Setup wizard
  checkFirstRun: () => ipcRenderer.invoke('check-first-run'),
  completeSetup: (data) => ipcRenderer.invoke('complete-setup', data),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (updates) => ipcRenderer.invoke('update-settings', updates),
  selectDirectoryFor: (purpose) => ipcRenderer.invoke('select-directory-for', purpose),

  // Claude communication
  sendMessage: (message, imagePaths, sessionId, sessionContext, skipPermissions, model, tabId) => ipcRenderer.invoke('send-to-claude', message, imagePaths, sessionId, sessionContext, skipPermissions, model, tabId),
  startSession: (workingDir) => ipcRenderer.invoke('start-interactive-session', workingDir),
  sendInteractive: (message) => ipcRenderer.invoke('send-interactive', message),

  // Streams (tabId routing for tab isolation)
  onStream: (callback) => ipcRenderer.on('claude-stream', (_, data, tabId) => callback(data, tabId)),
  onEvent: (callback) => ipcRenderer.on('claude-event', (_, data, tabId) => callback(data, tabId)),
  onAgentLog: (callback) => ipcRenderer.on('claude-agent-log', (_, data, tabId) => callback(data, tabId)),
  onSessionEnded: (callback) => ipcRenderer.on('claude-session-ended', (_, code) => callback(code)),
  onPermissionRequest: (callback) => ipcRenderer.on('claude-permission-request', (_, data, tabId) => callback(data, tabId)),
  killActiveProcess: (tabId) => ipcRenderer.invoke('kill-active-process', tabId),

  // Sessions
  getSessions: () => ipcRenderer.invoke('get-sessions'),
  loadSession: (filename, subdir) => ipcRenderer.invoke('load-session', filename, subdir),
  saveSession: (filename, content) => ipcRenderer.invoke('save-session', filename, content),
  saveSessionSync: (filename, content) => ipcRenderer.sendSync('save-session-sync', filename, content),
  deleteSession: (filename, subdir) => ipcRenderer.invoke('delete-session', filename, subdir),
  renameSession: (oldFilename, newFilename, subdir) => ipcRenderer.invoke('rename-session', oldFilename, newFilename, subdir),
  searchHistory: (query) => ipcRenderer.invoke('search-history', query),
  syncTerminalSessions: (opts) => ipcRenderer.invoke('sync-terminal-sessions', opts),

  // Images
  saveTempImage: (base64) => ipcRenderer.invoke('save-temp-image', base64),

  // Directory
  selectDirectory: () => ipcRenderer.invoke('select-directory'),

  // Token counter
  onTokenUpdate: (callback) => ipcRenderer.on('token-update', (_, data, tabId) => callback(data, tabId)),
  getTotalTokens: () => ipcRenderer.invoke('get-total-tokens'),
  saveTotalTokens: (tokens) => ipcRenderer.invoke('save-total-tokens', tokens),
  saveTotalTokensSync: (tokens) => ipcRenderer.sendSync('save-total-tokens-sync', tokens),
  resetTotalTokens: () => ipcRenderer.invoke('reset-total-tokens'),

  // Terminal
  createTerminal: () => ipcRenderer.invoke('terminal:create'),
  writeTerminal: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
  killTerminal: (id) => ipcRenderer.invoke('terminal:kill', id),
  onTerminalData: (callback) => ipcRenderer.on('terminal:data', (_, id, data) => callback(id, data)),
  onTerminalExit: (callback) => ipcRenderer.on('terminal:exit', (_, id, code) => callback(id, code)),

  // Web Preview
  createPreview: () => ipcRenderer.invoke('preview:create'),
  navigatePreview: (url) => ipcRenderer.invoke('preview:navigate', url),
  setPreviewBounds: (bounds) => ipcRenderer.invoke('preview:set-bounds', bounds),
  hidePreview: () => ipcRenderer.invoke('preview:hide'),
  refreshPreview: () => ipcRenderer.invoke('preview:refresh'),
  screenshotPreview: () => ipcRenderer.invoke('preview:screenshot'),
  getPreviewUrl: () => ipcRenderer.invoke('preview:get-url')
});
