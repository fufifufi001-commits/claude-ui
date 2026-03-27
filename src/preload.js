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
  sendMessage: (message, imagePaths, sessionId, sessionContext, skipPermissions) => ipcRenderer.invoke('send-to-claude', message, imagePaths, sessionId, sessionContext, skipPermissions),
  startSession: (workingDir) => ipcRenderer.invoke('start-interactive-session', workingDir),
  sendInteractive: (message) => ipcRenderer.invoke('send-interactive', message),

  // Streams
  onStream: (callback) => ipcRenderer.on('claude-stream', (_, data) => callback(data)),
  onAgentLog: (callback) => ipcRenderer.on('claude-agent-log', (_, data) => callback(data)),
  onSessionEnded: (callback) => ipcRenderer.on('claude-session-ended', (_, code) => callback(code)),

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
  selectDirectory: () => ipcRenderer.invoke('select-directory')
});
