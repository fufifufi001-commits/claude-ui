const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claude', {
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
  sendMessage: (message, imagePaths) => ipcRenderer.invoke('send-to-claude', message, imagePaths),
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
  searchHistory: (query) => ipcRenderer.invoke('search-history', query),

  // Images
  saveTempImage: (base64) => ipcRenderer.invoke('save-temp-image', base64),

  // Directory
  selectDirectory: () => ipcRenderer.invoke('select-directory')
});
