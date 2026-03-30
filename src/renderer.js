// ===== State =====
const state = {
  messages: [],
  codeBlocks: [],
  activeCodeTab: 0,
  pastedImages: [],
  isWaiting: false,
  workingDir: null,
  currentResponse: '',
  theme: 'dark',
  templates: [],
  // Chat tabs
  chatTabs: [],
  activeChatTab: 0,
  skipPermissions: false,
  // Token counter
  sessionTokens: 0,
  totalTokens: 0
};

// Permission re-send tracking
let lastSentMessage = null;
let lastSentImagePaths = [];
let lastSentTabId = null;
let permissionPending = false;

// Cancel & BTW queue
let cancelledByUser = false;
let btwQueue = [];
const PERMISSION_REQUIRED_TOOLS = new Set(['Write', 'Edit', 'Bash', 'NotebookEdit']);

// Helper: find tab by ID and check if it's active
function getTabByTabId(tabId) {
  if (!tabId) return { tab: state.chatTabs[state.activeChatTab], index: state.activeChatTab, isActive: true };
  const index = state.chatTabs.findIndex(t => t.id === tabId);
  if (index === -1) return { tab: null, index: -1, isActive: false };
  return { tab: state.chatTabs[index], index, isActive: index === state.activeChatTab };
}

function createChatTab(name) {
  const id = Date.now();
  const tabNum = state.chatTabs.length + 1;
  const label = name || `Sohbet ${tabNum}`;
  const tab = {
    id,
    label,
    tabNum,
    messages: [],
    codeBlocks: [],
    activeCodeTab: 0,
    scrollPos: 0,
    sessionId: null,
    sessionContext: null,
    isWaiting: false,
    sessionTokens: 0
  };
  state.chatTabs.push(tab);
  return tab;
}

function saveCurrentTabState() {
  const tab = state.chatTabs[state.activeChatTab];
  if (!tab) return;
  tab.messages = [...state.messages];
  tab.codeBlocks = [...state.codeBlocks];
  tab.activeCodeTab = state.activeCodeTab;
  tab.scrollPos = chatMessages.scrollTop;
  tab.isWaiting = state.isWaiting;
  tab.sessionTokens = state.sessionTokens;
  // sessionId is already on the tab object, no need to copy
}

function loadTabState(index) {
  const tab = state.chatTabs[index];
  if (!tab) return;
  state.messages = [...tab.messages];
  state.codeBlocks = [...tab.codeBlocks];
  state.activeCodeTab = tab.activeCodeTab;
  state.isWaiting = tab.isWaiting || false;
  toggleWaitingButtons(state.isWaiting);
  state.sessionTokens = tab.sessionTokens || 0;
  updateTokenDisplay();
}

function updateInputState() {
  const tab = state.chatTabs[state.activeChatTab];
  if (tab?.dialogEnded) {
    chatInput.disabled = true;
    chatInput.placeholder = 'Bu diyalog sonlandirilmis — yeni tab acin';
    sendBtn.disabled = true;
  } else {
    chatInput.disabled = false;
    chatInput.placeholder = 'Mesajinizi yazin... (Ctrl+V ile screenshot yapistirabilirsiniz)';
    sendBtn.disabled = state.isWaiting;
  }
}

function switchToTab(index) {
  if (index === state.activeChatTab && state.chatTabs.length > 0) return;
  saveCurrentTabState();
  state.activeChatTab = index;
  loadTabState(index);

  // Re-render chat
  chatMessages.innerHTML = '';
  state.messages.forEach(m => {
    renderMessageToDOM(m.role, m.text, m.images);
  });
  if (state.messages.length === 0) showWelcome();

  // Restore scroll
  chatMessages.scrollTop = state.chatTabs[index]?.scrollPos || 0;

  // Restore waiting/loading state for this tab
  const switchedTab = state.chatTabs[index];
  if (state.isWaiting) {
    showTyping();
    // Restore streaming content if this tab has an in-progress response
    if (switchedTab?._currentResponse) {
      state.currentResponse = switchedTab._currentResponse;
      updateStreamingMessage(state.currentResponse);
      updateStreamingCodePanel(state.currentResponse);
    }
  } else {
    removeTyping();
  }
  updateInputState();

  // Re-render code panel
  renderCodePanel();
  renderChatTabs();
}

function renderChatTabs() {
  const list = $('#chatTabsList');
  list.innerHTML = state.chatTabs.map((tab, i) => {
    const waitingDot = tab.isWaiting ? '<span class="tab-working-dot"></span>' : '';
    return `
    <div class="chat-tab-item ${i === state.activeChatTab ? 'active' : ''} ${tab.isWaiting ? 'tab-working' : ''}" data-index="${i}">
      ${waitingDot}<span class="tab-label" title="${tab.label}">${tab.label}</span>
      <span class="tab-close" data-index="${i}">&times;</span>
    </div>`;
  }).join('') + '<button class="chat-tab-add" id="addChatTabInline" title="Yeni sohbet (Ctrl+N)">+</button>';

  list.querySelectorAll('.chat-tab-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) return;
      switchToTab(parseInt(item.dataset.index));
    });
    // Double-click to rename tab
    item.addEventListener('dblclick', async (e) => {
      e.stopPropagation();
      const idx = parseInt(item.dataset.index);
      const tab = state.chatTabs[idx];
      if (!tab) return;
      const newName = await showPrompt('Sohbet adi:', tab.label);
      if (newName && newName.trim()) {
        tab.label = newName.trim();
        tab.labelUpdated = true;
        renderChatTabs();
        // Sync rename with left panel (session list)
        saveCurrentTabState();
        if (tab.messages && tab.messages.length >= 2) {
          await autoSaveTabSession(tab);
        }
        showToast('Tab yeniden adlandirildi');
      }
    });
  });

  list.querySelectorAll('.tab-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeChatTab(parseInt(btn.dataset.index));
    });
  });

  // + button inside the tab list
  const addBtn = list.querySelector('#addChatTabInline');
  if (addBtn) addBtn.onclick = () => $('#addChatTab')?.click() || addNewChatTab();
}

async function closeChatTab(index) {
  saveCurrentTabState();
  const closedTab = state.chatTabs[index];

  // If tab has messages, ask user what to do
  if (closedTab.messages.length > 0) {
    const choice = await showCloseDialog();
    if (!choice) return; // user dismissed

    if (choice === 'end') {
      // Sonlandır: save as finalized, mark as ended
      closedTab.dialogEnded = true;
      await autoSaveTabSession(closedTab);
    } else {
      // Devam Ettir: save as resumable
      closedTab.dialogEnded = false;
      await autoSaveTabSession(closedTab);
    }
  }

  state.chatTabs.splice(index, 1);

  // If no tabs left, create a fresh one
  if (state.chatTabs.length === 0) {
    createChatTab();
    state.activeChatTab = 0;
  } else if (state.activeChatTab >= state.chatTabs.length) {
    state.activeChatTab = state.chatTabs.length - 1;
  } else if (index < state.activeChatTab) {
    state.activeChatTab--;
  }

  loadTabState(state.activeChatTab);
  chatMessages.innerHTML = '';
  state.messages.forEach(m => renderMessageToDOM(m.role, m.text, m.images));
  if (state.messages.length === 0) showWelcome();
  renderCodePanel();
  renderChatTabs();
  await loadSessions();
}

// Detect topic from conversation content
function detectTopic(text) {
  const t = text.toLowerCase();
  const topics = [
    { keys: ['cauldroncrush', 'brewburst', 'unity', 'puzzle', 'oyun', 'level', 'iksir', 'admob', 'google play', '.aab'], label: 'CauldronCrush' },
    { keys: ['vitalboost', 'scansense', 'mediscribe', 'sağlık', 'saglik', 'ilaç', 'ilac', 'reçete', 'recete', 'medikal'], label: 'VitalBoost' },
    { keys: ['kozmetify', 'fiyatradari', 'fiyat karşılaştırma', 'kozmetik', 'trendyol', 'gratis'], label: 'Kozmetify' },
    { keys: ['masal', 'hikaye', 'fıkra', 'sesli okuma'], label: 'Masal App' },
    { keys: ['comfyui', 'workflow', 'controlnet', 'lora', 'ksampler', 'gguf'], label: 'ComfyUI' },
    { keys: ['claude ui', 'electron', 'arayüz', 'wrapper', 'panel', 'titlebar', 'session panel'], label: 'Claude UI' },
    { keys: ['github', 'git push', 'repo', 'commit'], label: 'Git/GitHub' },
    { keys: ['expo', 'react native', 'supabase'], label: 'Mobil Geliştirme' },
  ];
  // Skor bazli: en cok eslesen konu kazanir
  let bestLabel = null, bestScore = 0;
  for (const { keys, label } of topics) {
    let score = 0;
    for (const k of keys) {
      const regex = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = t.match(regex);
      if (matches) score += matches.length;
    }
    if (score > bestScore) { bestScore = score; bestLabel = label; }
  }
  return bestLabel;
}

function updateTabLabel() {
  // Tab label is set by user at creation — no auto-rename
}

// ===== DOM Elements =====
const $ = (sel) => document.querySelector(sel);
const chatMessages = $('#chatMessages');
const chatInput = $('#chatInput');
const sendBtn = $('#sendBtn');
const imagePreview = $('#imagePreview');
const sessionList = $('#sessionList');
const sessionSearch = $('#sessionSearch');
const codeTabs = $('#codeTabs');
const codeContent = $('#codeContent');
const agentLog = $('#agentLog');
const workdirLabel = $('#workdirLabel');
const helpModal = $('#helpModal');
const sessionTokensEl = $('#sessionTokens');
const totalTokensEl = $('#totalTokens');
const modelSelect = $('#modelSelect');
const contextFill = $('#contextFill');
const contextText = $('#contextText');
const toolDot = $('#toolDot');
const toolLabel = $('#toolLabel');
const mcpStatus = $('#mcpStatus');

// ===== Window Controls =====
$('#btnMin').onclick = () => window.claude.minimize();
$('#btnMax').onclick = () => window.claude.maximize();
$('#btnClose').onclick = () => window.claude.close();

// ===== Token Counter =====
function formatTokenCount(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function updateTokenDisplay() {
  sessionTokensEl.textContent = formatTokenCount(state.sessionTokens);
  totalTokensEl.textContent = formatTokenCount(state.totalTokens);
  // Pulse animation
  sessionTokensEl.classList.add('counting');
  setTimeout(() => sessionTokensEl.classList.remove('counting'), 300);
}

// Token update — only uses 'result' event (final, accurate data)
window.claude.onTokenUpdate((data, tabId) => {
  if (data.type !== 'result') return;

  const { tab: targetTab, isActive } = getTabByTabId(tabId);

  const usage = data.usage || {};
  const totalIn = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  const totalOut = usage.output_tokens || 0;
  const msgTokens = totalIn + totalOut;

  // Session usage tracking (global)
  sessionUsage.totalCostUsd += data.costUsd || 0;
  sessionUsage.totalInputTokens += totalIn;
  sessionUsage.totalOutputTokens += totalOut;
  sessionUsage.cacheReadTokens += usage.cache_read_input_tokens || 0;
  sessionUsage.turns++;

  // Per-tab token tracking
  if (targetTab) {
    targetTab.sessionTokens = (targetTab.sessionTokens || 0) + msgTokens;
  }

  // Update counters — use active tab's tokens for display
  if (isActive && targetTab) {
    state.sessionTokens = targetTab.sessionTokens || 0;
  }
  state.totalTokens += msgTokens;
  updateTokenDisplay();
});

// Model selector
modelSelect.onchange = () => {
  const model = modelSelect.value;
  contextWindowSize = MODEL_CONTEXT[model] || 1000000;
  updateContextBar();
  showToast(`Model: ${model}`);
};

$('#btnResetTokens').onclick = async () => {
  if (confirm('Toplam token sayaci sifirlansin mi?')) {
    state.totalTokens = 0;
    await window.claude.resetTotalTokens();
    updateTokenDisplay();
  }
};

// ===== Slash Commands =====
// Session cost/usage tracking (populated from stream-json result events)
const sessionUsage = {
  totalCostUsd: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  cacheReadTokens: 0,
  turns: 0,
  model: '',
  slashCommands: [],
  sessionId: null
};

// Context window sizes per model family
const MODEL_CONTEXT = { 'opus': 1000000, 'sonnet': 200000, 'haiku': 200000 };
let contextWindowSize = 1000000;
let contextUsedTokens = 0;

function updateContextBar() {
  const pct = contextWindowSize > 0 ? Math.min(100, (contextUsedTokens / contextWindowSize) * 100) : 0;
  contextFill.style.width = pct + '%';
  contextText.textContent = pct < 1 ? '<1%' : Math.round(pct) + '%';
  contextFill.classList.toggle('warning', pct > 75);
}

function setToolActivity(status, label) {
  toolDot.className = 'tool-dot ' + status;
  toolLabel.textContent = label;
}

// Listen for all stream-json events (tab-routed)
window.claude.onEvent((evt, tabId) => {
  const { tab: targetTab, isActive } = getTabByTabId(tabId);

  // System init events are global (model, MCP, slash commands)
  if (evt.type === 'system' && evt.subtype === 'init') {
    sessionUsage.slashCommands = evt.slash_commands || [];
    sessionUsage.model = evt.model || '';
    sessionUsage.sessionId = evt.session_id || '';
    const modelKey = (evt.model || '').includes('opus') ? 'opus'
      : (evt.model || '').includes('haiku') ? 'haiku' : 'sonnet';
    modelSelect.value = modelKey;
    contextWindowSize = MODEL_CONTEXT[modelKey] || 1000000;
    const servers = evt.mcp_servers || [];
    if (servers.length > 0) {
      const connected = servers.filter(s => s.status === 'connected').length;
      mcpStatus.textContent = `MCP: ${connected}/${servers.length}`;
    }
  }

  // Tool use tracking — only update DOM for active tab
  if (evt.type === 'assistant' && evt.message?.content) {
    const blocks = evt.message.content;
    const last = blocks[blocks.length - 1];
    if (last?.type === 'tool_use') {
      if (isActive) setToolActivity('running', last.name + '...');

      // Permission check: detect write-type tools from JSON stream
      if (!state.skipPermissions && !permissionPending && PERMISSION_REQUIRED_TOOLS.has(last.name) && isActive) {
        permissionPending = true;
        let desc = `Claude "${last.name}" aracını kullanmak istiyor.`;
        if (last.input?.file_path) desc += `\nDosya: ${last.input.file_path}`;
        if (last.input?.command) {
          const cmd = last.input.command.length > 200 ? last.input.command.substring(0, 200) + '...' : last.input.command;
          desc += `\nKomut: ${cmd}`;
        }
        if (last.input?.old_string) desc += `\nDüzenleme: ${last.input.old_string.substring(0, 100)}...`;
        showPermissionCard(desc);
      }
    }
    // Update context usage
    const usage = evt.message?.usage;
    if (usage && isActive) {
      contextUsedTokens = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0)
        + (usage.cache_creation_input_tokens || 0) + (usage.output_tokens || 0);
      updateContextBar();
    }
  }

  // Result event — turn complete
  if (evt.type === 'result') {
    if (isActive) setToolActivity('idle', 'Hazir');
    permissionPending = false;
  }
});

function handleSlashCommand(text) {
  const cmd = text.split(/\s+/)[0].toLowerCase();
  const args = text.slice(cmd.length).trim();

  switch (cmd) {
    case '/usage':
    case '/cost': {
      const costStr = sessionUsage.totalCostUsd > 0
        ? `$${sessionUsage.totalCostUsd.toFixed(4)}`
        : 'Henuz maliyet verisi yok';
      const input = formatTokenCount(sessionUsage.totalInputTokens);
      const output = formatTokenCount(sessionUsage.totalOutputTokens);
      const cache = formatTokenCount(sessionUsage.cacheReadTokens);
      return {
        showUser: true,
        response: `**Session Kullanim Raporu**\n\n` +
          `| Metrik | Deger |\n|---|---|\n` +
          `| Model | ${sessionUsage.model || 'Bilinmiyor'} |\n` +
          `| Toplam Maliyet | ${costStr} |\n` +
          `| Input Token | ${input} |\n` +
          `| Output Token | ${output} |\n` +
          `| Cache Okunan | ${cache} |\n` +
          `| Tur Sayisi | ${sessionUsage.turns} |\n` +
          `| Session Token (tahmini) | ${formatTokenCount(state.sessionTokens)} |\n` +
          `| Toplam Token (tum zamanlar) | ${formatTokenCount(state.totalTokens)} |`
      };
    }

    case '/clear':
      chatMessages.innerHTML = '';
      state.messages = [];
      showWelcome();
      return { showUser: false, response: null };

    case '/model':
      return {
        showUser: true,
        response: `Aktif model: **${sessionUsage.model || 'Bilinmiyor'}**`
      };

    case '/help': {
      const cmds = [
        '`/usage` veya `/cost` — Token kullanimi ve maliyet raporu',
        '`/clear` — Sohbet ekranini temizle',
        '`/model` — Aktif modeli goster',
        '`/help` — Bu yardim mesaji',
        '`/compact` — Konusmayi ozetle (Claude\'a gonderilir)',
        '`/reset-tokens` — Toplam token sayacini sifirla',
        '`/btw <mesaj>` — Yanit sirasinda ek mesaj kuyruga ekle',
        '`Escape` — Aktif yaniti iptal et',
        '`exit` veya `quit` — Diyalogu sonlandir'
      ];
      return {
        showUser: true,
        response: `**Kullanilabilir Komutlar**\n\n${cmds.join('\n')}`
      };
    }

    case '/reset-tokens':
      state.totalTokens = 0;
      window.claude.resetTotalTokens();
      updateTokenDisplay();
      return {
        showUser: true,
        response: 'Toplam token sayaci sifirlandi.'
      };

    default:
      // Not a local command — let it pass through to Claude CLI
      return null;
  }
}

// ===== Sidebar Toggle =====
$('#sidebarToggle').onclick = () => $('#sidebar').classList.toggle('collapsed');

// ===== Code Panel Toggle =====
function toggleCodePanel() {
  const panel = $('#codePanel');
  const reopen = $('#codePanelReopen');
  panel.classList.toggle('collapsed');
  const isCollapsed = panel.classList.contains('collapsed');
  reopen.style.display = isCollapsed ? 'flex' : 'none';
}
$('#codePanelToggle').onclick = toggleCodePanel;
$('#codePanelReopen').onclick = toggleCodePanel;

// ===== Theme Toggle =====
$('#btnTheme').onclick = toggleTheme;
function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  $('#btnTheme').innerHTML = state.theme === 'dark' ? '&#9790;' : '&#9788;';
  localStorage.setItem('claude-ui-theme', state.theme);
  showToast(`Tema: ${state.theme === 'dark' ? 'Karanlik' : 'Aydinlik'}`);
}

// Load saved theme
const savedTheme = localStorage.getItem('claude-ui-theme');
if (savedTheme) {
  state.theme = savedTheme;
  document.documentElement.setAttribute('data-theme', savedTheme);
  $('#btnTheme').innerHTML = savedTheme === 'dark' ? '&#9790;' : '&#9788;';
}

// ===== Help Modal =====
$('#btnHelp').onclick = () => helpModal.style.display = 'flex';
$('#helpClose').onclick = () => helpModal.style.display = 'none';
helpModal.onclick = (e) => { if (e.target === helpModal) helpModal.style.display = 'none'; };

// ===== Terminal Sync Button =====
$('#btnSyncTerminal').onclick = async () => {
  const btn = $('#btnSyncTerminal');
  btn.classList.add('syncing');
  try {
    const result = await window.claude.syncTerminalSessions({ force: false });
    if (result.synced > 0) {
      showToast(`${result.synced} terminal oturumu sync edildi`);
      await loadSessions();
    } else {
      showToast('Yeni terminal oturumu yok');
    }
  } catch (e) {
    showToast('Sync hatasi: ' + e.message);
  }
  btn.classList.remove('syncing');
};

// ===== Export =====
$('#btnExport').onclick = exportSession;
function exportSession() {
  if (state.messages.length === 0) { showToast('Export edilecek mesaj yok'); return; }
  const md = generateSessionMarkdown();
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const today = new Date().toISOString().split('T')[0];
  const firstMsg = state.messages.find(m => m.role === 'user')?.text || 'session';
  const slug = firstMsg.substring(0, 30).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  a.download = `${today}_${slug}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Session export edildi');
}

// ===== Toast =====
function showToast(text) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// ===== Custom Prompt Dialog =====
function showPrompt(title, defaultValue = '') {
  return new Promise((resolve) => {
    const existing = document.querySelector('.prompt-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'prompt-overlay';
    overlay.innerHTML = `
      <div class="prompt-dialog">
        <div class="prompt-title">${title}</div>
        <input class="prompt-input" type="text" value="${escapeHtml(defaultValue)}" />
        <div class="prompt-actions">
          <button class="prompt-cancel">Iptal</button>
          <button class="prompt-ok">Tamam</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('.prompt-input');
    input.focus();
    input.select();

    const close = (val) => { overlay.remove(); resolve(val); };

    overlay.querySelector('.prompt-ok').onclick = () => close(input.value);
    overlay.querySelector('.prompt-cancel').onclick = () => close(null);
    overlay.onclick = (e) => { if (e.target === overlay) close(null); };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value);
      if (e.key === 'Escape') close(null);
    });
  });
}

// Dialog: "Bu Diyaloğu Sonlandır" / "Bu Diyaloğu Devam Ettir"
function showCloseDialog() {
  return new Promise((resolve) => {
    const existing = document.querySelector('.prompt-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'prompt-overlay';
    overlay.innerHTML = `
      <div class="prompt-dialog">
        <div class="prompt-title">Bu diyalog ne olsun?</div>
        <div class="prompt-actions" style="gap:10px;margin-top:16px;">
          <button class="prompt-cancel" data-action="end">Bu Diyalogu Sonlandir</button>
          <button class="prompt-ok" data-action="continue">Bu Diyalogu Devam Ettir</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = (val) => { overlay.remove(); resolve(val); };

    overlay.querySelector('[data-action="end"]').onclick = () => close('end');
    overlay.querySelector('[data-action="continue"]').onclick = () => close('continue');
    overlay.onclick = (e) => { if (e.target === overlay) close(null); };
    document.addEventListener('keydown', function handler(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', handler); close(null); }
    });
  });
}

// ===== Working Directory =====
workdirLabel.onclick = async () => {
  const dir = await window.claude.selectDirectory();
  if (dir) {
    state.workingDir = dir;
    workdirLabel.textContent = dir.length > 40 ? '...' + dir.slice(-37) : dir;
    workdirLabel.title = dir;
    await window.claude.updateSettings({ workingDir: dir });
  }
};

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', (e) => {
  // F1 - Help
  if (e.key === 'F1') { e.preventDefault(); helpModal.style.display = helpModal.style.display === 'none' ? 'flex' : 'none'; }
  // Esc - Cancel active response OR close modals
  if (e.key === 'Escape') {
    if (state.isWaiting) {
      e.preventDefault();
      cancelActiveResponse();
    } else {
      helpModal.style.display = 'none';
    }
  }
  // Ctrl+B - Toggle sidebar
  if (e.ctrlKey && e.key === 'b') { e.preventDefault(); $('#sidebar').classList.toggle('collapsed'); }
  // Ctrl+J - Toggle code panel
  if (e.ctrlKey && e.key === 'j') { e.preventDefault(); toggleCodePanel(); }
  // Ctrl+T - Toggle theme
  if (e.ctrlKey && e.key === 't') { e.preventDefault(); toggleTheme(); }
  // Ctrl+Shift+S - Save session
  if (e.ctrlKey && e.shiftKey && e.key === 'S') { e.preventDefault(); autoSaveSession(); showToast('Session kaydedildi'); }
  // Ctrl+Shift+E - Export
  if (e.ctrlKey && e.shiftKey && e.key === 'E') { e.preventDefault(); exportSession(); }
  // Ctrl+N - New chat tab
  if (e.ctrlKey && e.key === 'n') { e.preventDefault(); addNewChatTab(); }
  // Ctrl+W - Close current tab
  if (e.ctrlKey && e.key === 'w') { e.preventDefault(); closeChatTab(state.activeChatTab); }
  // Ctrl+Tab - Next tab
  if (e.ctrlKey && e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    const next = (state.activeChatTab + 1) % state.chatTabs.length;
    switchToTab(next);
  }
  // Ctrl+Shift+Tab - Previous tab
  if (e.ctrlKey && e.key === 'Tab' && e.shiftKey) {
    e.preventDefault();
    const prev = (state.activeChatTab - 1 + state.chatTabs.length) % state.chatTabs.length;
    switchToTab(prev);
  }
});

// ===== Cancel Active Response =====
async function cancelActiveResponse() {
  const currentTab = state.chatTabs[state.activeChatTab];
  const tabId = currentTab?.id || null;

  cancelledByUser = true;

  // Kill the process
  await window.claude.killActiveProcess(tabId);

  // Capture partial response
  const partial = state.currentResponse || '';
  removeTyping();
  const streamMsg = chatMessages.querySelector('.message.streaming');
  if (streamMsg) streamMsg.remove();

  if (partial.trim()) {
    addMessage('assistant', partial + '\n\n*⏹ Yanit iptal edildi.*');
    extractCodeBlocks(partial);
  } else {
    addMessage('assistant', '*⏹ Yanit iptal edildi.*');
  }

  // Reset state
  state.isWaiting = false;
  toggleWaitingButtons(false);
  state.currentResponse = '';
  if (currentTab) {
    currentTab.isWaiting = false;
    currentTab._currentResponse = '';
    renderChatTabs();
  }
  sendBtn.disabled = false;
  setToolActivity('idle');
  btwQueue = []; // Clear queued btw messages
  chatInput.focus();
  autoSaveSession();
}

// ===== Resize Handles =====
function setupResize(handleId, leftEl, rightEl, direction) {
  const handle = $(handleId);
  let startX, startWidth;

  handle.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    const el = direction === 'left' ? $(leftEl) : $(rightEl);
    startWidth = el.getBoundingClientRect().width;
    handle.classList.add('active');

    const onMove = (e) => {
      const diff = e.clientX - startX;
      const newWidth = direction === 'left' ? startWidth + diff : startWidth - diff;
      el.style.width = Math.max(44, Math.min(500, newWidth)) + 'px';
    };

    const onUp = () => {
      handle.classList.remove('active');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

setupResize('#resizeLeft', '#sidebar', null, 'left');
setupResize('#resizeRight', null, '#codePanel', 'right');

// ===== Screenshot Paste =====
chatInput.addEventListener('paste', async (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const blob = item.getAsFile();
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        const tempPath = await window.claude.saveTempImage(base64);
        state.pastedImages.push({ base64: reader.result, path: tempPath });
        renderImagePreviews();
        showToast('Screenshot yapistrildi');
      };
      reader.readAsDataURL(blob);
    }
  }
});

// Drag & drop images
chatInput.addEventListener('dragover', (e) => { e.preventDefault(); });
chatInput.addEventListener('drop', async (e) => {
  e.preventDefault();
  for (const file of e.dataTransfer.files) {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        const tempPath = await window.claude.saveTempImage(base64);
        state.pastedImages.push({ base64: reader.result, path: tempPath });
        renderImagePreviews();
      };
      reader.readAsDataURL(file);
    }
  }
});

function renderImagePreviews() {
  if (state.pastedImages.length === 0) {
    imagePreview.style.display = 'none';
    return;
  }
  imagePreview.style.display = 'flex';
  imagePreview.innerHTML = state.pastedImages.map((img, i) => `
    <div class="image-preview-item">
      <img src="${img.base64}" alt="paste">
      <button class="remove-img" data-index="${i}">&times;</button>
    </div>
  `).join('');

  imagePreview.querySelectorAll('.remove-img').forEach(btn => {
    btn.onclick = () => {
      state.pastedImages.splice(parseInt(btn.dataset.index), 1);
      renderImagePreviews();
    };
  });
}

// ===== Prompt Templates (Dynamic + Editable) =====
const DEFAULT_TEMPLATES = [
  { label: 'Hata Bul', prompt: 'Bu kodda hata var mi? Bul ve duzelt:' },
  { label: 'Refactor', prompt: 'Bu kodu refactor et, daha temiz hale getir:' },
  { label: 'Test Yaz', prompt: 'Bu kod icin test yaz:' },
  { label: 'Acikla', prompt: 'Bu kodu acikla, ne yapiyor:' },
  { label: 'Optimize', prompt: 'Bu kodu optimize et, performansi artir:' },
  { label: 'Incele', prompt: 'Bu dosyayi incele ve iyilestirme onerileri sun:' },
  { label: 'Review', prompt: '/review', slash: true },
  { label: 'Guvenlik', prompt: '/security-review', slash: true },
  { label: 'Compact', prompt: '/compact', slash: true },
  { label: 'Tam Yetki', prompt: '', danger: true }
];

const templateModal = $('#templateModal');
const templateList = $('#templateList');

function loadTemplates() {
  const saved = localStorage.getItem('claude-ui-templates');
  state.templates = saved ? JSON.parse(saved) : [...DEFAULT_TEMPLATES];
  renderTemplateButtons();
}

function saveTemplates() {
  localStorage.setItem('claude-ui-templates', JSON.stringify(state.templates));
}

function renderTemplateButtons() {
  const container = $('#promptTemplates');
  // Remove old buttons (keep edit button)
  container.querySelectorAll('.prompt-btn').forEach(b => b.remove());
  const editBtn = $('#editTemplatesBtn');

  state.templates.forEach((tpl, i) => {
    const btn = document.createElement('button');
    btn.className = 'prompt-btn' + (tpl.danger ? ' prompt-btn-danger' : '');
    btn.textContent = tpl.label;
    btn.dataset.prompt = tpl.prompt;

    if (tpl.danger) {
      // Toggle dangerously-skip-permissions mode
      btn.onclick = () => {
        state.skipPermissions = !state.skipPermissions;
        btn.classList.toggle('active', state.skipPermissions);
        btn.textContent = state.skipPermissions ? 'Tam Yetki ON' : 'Tam Yetki';
        showToast(state.skipPermissions ? 'Tum izinler otomatik onaylanacak!' : 'Izin modu normal');
      };
    } else if (tpl.slash) {
      btn.classList.add('prompt-btn-slash');
      btn.onclick = () => {
        chatInput.value = tpl.prompt;
        sendMessage();
      };
    } else {
      btn.onclick = () => {
        chatInput.value = chatInput.value ? chatInput.value + '\n' + tpl.prompt : tpl.prompt;
        chatInput.focus();
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
      };
    }
    container.insertBefore(btn, editBtn);
  });
}

// Template editor modal
$('#editTemplatesBtn').onclick = () => {
  templateModal.style.display = 'flex';
  renderTemplateEditor();
};
$('#templateModalClose').onclick = () => templateModal.style.display = 'none';
templateModal.onclick = (e) => { if (e.target === templateModal) templateModal.style.display = 'none'; };

function renderTemplateEditor() {
  templateList.innerHTML = state.templates.map((tpl, i) => `
    <div class="template-item" draggable="true" data-index="${i}">
      <span class="drag-handle">&#9776;</span>
      <span class="tpl-label">${escapeHtml(tpl.label)}</span>
      <span class="tpl-prompt">${escapeHtml(tpl.prompt)}</span>
      <button class="tpl-delete" data-index="${i}" title="Sil">&times;</button>
    </div>
  `).join('');

  // Delete handlers
  templateList.querySelectorAll('.tpl-delete').forEach(btn => {
    btn.onclick = () => {
      state.templates.splice(parseInt(btn.dataset.index), 1);
      saveTemplates();
      renderTemplateButtons();
      renderTemplateEditor();
      showToast('Sablon silindi');
    };
  });

  // Drag & drop reorder
  let dragIdx = null;
  templateList.querySelectorAll('.template-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      dragIdx = parseInt(item.dataset.index);
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      dragIdx = null;
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      const dropIdx = parseInt(item.dataset.index);
      if (dragIdx !== null && dragIdx !== dropIdx) {
        const moved = state.templates.splice(dragIdx, 1)[0];
        state.templates.splice(dropIdx, 0, moved);
        saveTemplates();
        renderTemplateButtons();
        renderTemplateEditor();
      }
    });
  });
}

// Add new template
$('#addTemplateBtn').onclick = () => {
  const label = $('#newTemplateLabel').value.trim();
  const prompt = $('#newTemplatePrompt').value.trim();
  if (!label || !prompt) { showToast('Ad ve prompt doldurulmali'); return; }
  state.templates.push({ label, prompt });
  saveTemplates();
  renderTemplateButtons();
  renderTemplateEditor();
  $('#newTemplateLabel').value = '';
  $('#newTemplatePrompt').value = '';
  showToast(`"${label}" sablonu eklendi`);
};

// Enter key in template inputs
$('#newTemplateLabel').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#newTemplatePrompt').focus(); }
});
$('#newTemplatePrompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#addTemplateBtn').click(); }
});

// Reset to defaults
$('#resetTemplatesBtn').onclick = () => {
  state.templates = [...DEFAULT_TEMPLATES];
  saveTemplates();
  renderTemplateButtons();
  renderTemplateEditor();
  showToast('Sablonlar varsayilana donduruldu');
};

loadTemplates();

// ===== Send Message =====
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
});
sendBtn.onclick = () => sendMessage();

// Cancel & BTW buttons
const btnCancel = $('#btnCancel');
const btnBtw = $('#btnBtw');
btnCancel.onclick = () => cancelActiveResponse();
btnBtw.onclick = () => {
  const btwText = chatInput.value.trim();
  if (!btwText) {
    chatInput.value = '/btw ';
    chatInput.focus();
  } else {
    // Prepend /btw if not already there
    const msg = btwText.startsWith('/btw') ? btwText : '/btw ' + btwText;
    chatInput.value = msg;
    sendMessage();
  }
};

function toggleWaitingButtons(waiting) {
  console.log('[DEBUG] toggleWaitingButtons called:', waiting, 'btnCancel:', btnCancel, 'btnBtw:', btnBtw);
  btnCancel.style.display = waiting ? 'inline-block' : 'none';
  btnBtw.style.display = waiting ? 'inline-block' : 'none';
  console.log('[DEBUG] btnCancel.style.display:', btnCancel.style.display, 'btnBtw.style.display:', btnBtw.style.display);
}

async function sendMessage(overrideText) {
  const text = overrideText || chatInput.value.trim();
  if (!text && state.pastedImages.length === 0) return;

  // Handle /btw while waiting — queue message for after response completes
  if (state.isWaiting) {
    if (text.toLowerCase().startsWith('/btw')) {
      const btwArgs = text.slice(4).trim();
      chatInput.value = '';
      chatInput.style.height = 'auto';
      if (!btwArgs) {
        addMessage('assistant', '`/btw <mesaj>` — Yanit bittikten sonra ek mesaj gonderir.');
      } else {
        btwQueue.push(btwArgs);
        addMessage('user', text);
        addMessage('assistant', `📌 Ek mesaj kuyruga eklendi (${btwQueue.length}). Yanit bittikten sonra gonderilecek.`);
      }
      chatInput.focus();
      return;
    }
    return;
  }

  // Handle exit command: save session and reset tab
  if (/^(exit|quit|cikis|çıkış)$/i.test(text)) {
    chatInput.value = '';
    chatInput.style.height = 'auto';

    const exitTab = state.chatTabs[state.activeChatTab];
    if (exitTab && exitTab.messages.length > 0) {
      const choice = await showCloseDialog();
      if (!choice) return; // user dismissed

      if (choice === 'end') {
        addMessage('user', text);
        addMessage('assistant', 'Diyalog sonlandirildi. Gorusmek uzere!');
        exitTab.dialogEnded = true;
        saveCurrentTabState();
        await autoSaveTabSession(exitTab);
        // Reset tab to clean state
        exitTab.messages = [];
        exitTab.codeBlocks = [];
        exitTab.sessionId = null;
        exitTab.sessionContext = null;
        exitTab.resumeFallback = false;
        exitTab.labelUpdated = false;
        exitTab.sessionTokens = 0;
        exitTab.label = `Sohbet ${exitTab.tabNum}`;
        state.messages = [];
        state.codeBlocks = [];
        state.activeCodeTab = 0;
        state.sessionTokens = 0;
        updateTokenDisplay();
        chatMessages.innerHTML = '';
        showWelcome();
        showToast('Diyalog sonlandirildi');
      } else {
        addMessage('user', text);
        addMessage('assistant', 'Diyalog kaydedildi. Tekrar actiginizda devam edebilirsiniz.');
        exitTab.dialogEnded = false;
        saveCurrentTabState();
        await autoSaveTabSession(exitTab);
        // Reset tab to clean state
        exitTab.messages = [];
        exitTab.codeBlocks = [];
        exitTab.sessionId = null;
        exitTab.sessionContext = null;
        exitTab.resumeFallback = false;
        exitTab.labelUpdated = false;
        exitTab.sessionTokens = 0;
        exitTab.label = `Sohbet ${exitTab.tabNum}`;
        state.messages = [];
        state.codeBlocks = [];
        state.activeCodeTab = 0;
        state.sessionTokens = 0;
        updateTokenDisplay();
        chatMessages.innerHTML = '';
        showWelcome();
        showToast('Diyalog kaydedildi — devam edilebilir');
      }
    } else {
      addMessage('user', text);
      addMessage('assistant', 'Oturum kapatildi.');
    }

    renderCodePanel();
    renderChatTabs();
    await loadSessions();
    chatInput.focus();
    return;
  }

  // Handle slash commands locally
  if (text.startsWith('/')) {
    const slashResult = handleSlashCommand(text);
    if (slashResult !== null) {
      chatInput.value = '';
      chatInput.style.height = 'auto';
      if (slashResult.showUser) addMessage('user', text);
      if (slashResult.response) addMessage('assistant', slashResult.response);
      chatInput.focus();
      return;
    }
    // Not a local command — pass through to Claude CLI
  }

  const imagePaths = state.pastedImages.map(img => img.path);
  const imageDataUrls = state.pastedImages.map(img => img.base64);

  // Get current tab for conversation continuity
  const currentTab = state.chatTabs[state.activeChatTab];

  // Track for permission re-send
  lastSentMessage = text;
  lastSentImagePaths = [...imagePaths];
  lastSentTabId = currentTab?.id || null;
  permissionPending = false;
  let sessionId = currentTab?.sessionId || null;
  // Determine how to handle session continuity
  let sessionContext = null;

  if (sessionId) {
    // Existing session (loaded UI session or continued tab) → use --resume, no context needed
    sessionContext = null;
  } else {
    // No session yet → generate new UUID + signal for --session-id
    sessionId = window.claude.generateUUID();
    const tabContext = currentTab?.sessionContext || null;
    if (tabContext) {
      // Old/CLI session loaded with context
      sessionContext = tabContext;
    } else {
      // Brand new conversation
      sessionContext = '__new__';
    }
  }

  addMessage('user', text, imageDataUrls);
  chatInput.value = '';
  chatInput.style.height = 'auto';
  state.pastedImages = [];
  renderImagePreviews();

  state.isWaiting = true;
  toggleWaitingButtons(true);
  if (currentTab) { currentTab.isWaiting = true; renderChatTabs(); }
  sendBtn.disabled = true;
  showTyping();
  setToolActivity('running', 'Claude dusunuyor...');

  try {
    state.currentResponse = '';
    if (currentTab) currentTab._currentResponse = '';
    cancelledByUser = false;
    let response;
    try {
      response = await window.claude.sendMessage(text, imagePaths, sessionId, sessionContext, state.skipPermissions, modelSelect.value, currentTab?.id);
    } catch (resumeErr) {
      // If --resume failed (JSONL missing), fallback to context approach
      const isResumeFail = resumeErr.message?.includes('No conversation found') || resumeErr.message?.includes('already in use');
      if (currentTab?.resumeFallback && currentTab.sessionContext && isResumeFail) {
        state.currentResponse = '';
        if (currentTab) currentTab._currentResponse = '';
        const fallbackId = window.claude.generateUUID();
        response = await window.claude.sendMessage(text, imagePaths, fallbackId, currentTab.sessionContext, state.skipPermissions, modelSelect.value, currentTab?.id);
        sessionId = fallbackId;
        currentTab.resumeFallback = false;
      } else {
        throw resumeErr;
      }
    }
    removeTyping();
    // Remove streaming message if exists
    const streamMsg = chatMessages.querySelector('.message.streaming');
    if (streamMsg) streamMsg.remove();

    // Extract text from response
    const responseText = (typeof response === 'object' && response !== null) ? response.text : response;

    // Store session ID for conversation continuity (--resume on next messages)
    if (sessionId && currentTab) {
      currentTab.sessionId = sessionId;
    }
    // Clear sessionContext after first use
    if (currentTab) {
      currentTab.sessionContext = null;
      currentTab.resumeFallback = false;
    }

    addMessage('assistant', responseText);
    extractCodeBlocks(responseText);
  } catch (err) {
    // If cancelled by user, cancelActiveResponse already handled cleanup
    if (cancelledByUser) {
      cancelledByUser = false;
      return;
    }

    // If permission resend is in progress, don't touch DOM or show errors
    if (permissionPending) {
      return; // resendWithPermission manages everything
    }

    removeTyping();
    const streamMsg = chatMessages.querySelector('.message.streaming');
    if (streamMsg) streamMsg.remove();

    // If this looks like a permission error, show permission card instead of error
    const msg = (err.message || '').toLowerCase();
    const isPermErr = !state.skipPermissions && (
      /permission|not allowed|denied|user rejected|aborted|izin|izni|onaylam|reddedil|yazma izni/.test(msg)
    );
    if (isPermErr) {
      permissionPending = true;
      showPermissionCard('Claude bir araç kullanmak istedi ancak izin verilemedi.\nTekrar denemek için izin verin.');
      return; // permission card manages isWaiting/sendBtn state
    }

    addMessage('assistant', `Hata: ${err.message}`);
  }

  state.isWaiting = false;
  toggleWaitingButtons(false);
  if (currentTab) { currentTab.isWaiting = false; renderChatTabs(); }
  sendBtn.disabled = false;
  chatInput.focus();

  autoSaveSession();

  // Process btw queue — send next queued message automatically
  if (btwQueue.length > 0) {
    const nextMsg = btwQueue.shift();
    setTimeout(() => sendMessage(nextMsg), 300);
  }
}

// ===== Streaming =====
window.claude.onStream((chunk, tabId) => {
  const { tab: targetTab, isActive } = getTabByTabId(tabId);

  // Always accumulate response on the correct tab
  if (targetTab) {
    if (!targetTab._currentResponse) targetTab._currentResponse = '';
    targetTab._currentResponse += chunk;
  }

  // Only update DOM and global state if this is the active tab
  if (isActive) {
    state.currentResponse = targetTab ? targetTab._currentResponse : (state.currentResponse + chunk);
    updateStreamingMessage(state.currentResponse);
    updateStreamingCodePanel(state.currentResponse);
  }
});

function updateStreamingMessage(content) {
  removeTyping();
  let streamMsg = chatMessages.querySelector('.message.assistant.streaming');
  if (!streamMsg) {
    streamMsg = document.createElement('div');
    streamMsg.className = 'message assistant streaming';
    chatMessages.appendChild(streamMsg);
  }
  // In chat, show text but replace active code blocks with a one-line reference
  const chatContent = content.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (match, lang) => `<div style="padding:4px 10px;background:var(--bg-tertiary);border-radius:4px;font-size:11px;color:var(--accent);margin:6px 0;cursor:pointer;" class="code-ref">🟢 Kod yaziliyor → Kod panelinde goruntuluyor (${lang || 'code'})</div>`
  );
  // If there's an unclosed code block, show reference for it too
  const unclosedMatch = content.match(/```(\w*)\n([^`]*)$/);
  let displayContent = chatContent;
  if (unclosedMatch) {
    displayContent = chatContent.replace(
      /```(\w*)\n([^`]*)$/,
      `<div style="padding:4px 10px;background:var(--bg-tertiary);border-radius:4px;font-size:11px;color:var(--warning);margin:6px 0;">🟡 Kod yaziliyor... → Kod panelinde canli (${unclosedMatch[1] || 'code'})</div>`
    );
  }
  streamMsg.innerHTML = formatMarkdown(displayContent.replace(/```(\w*)\n([\s\S]*?)$/g, ''));
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Live code streaming in code panel
let streamingCodeLang = '';
function updateStreamingCodePanel(content) {
  // Find all complete code blocks
  const completeBlocks = [...content.matchAll(/```(\w*)\n([\s\S]*?)```/g)];

  // Find unclosed (currently writing) code block
  const unclosedMatch = content.match(/```(\w*)\n([^`]*)$/);

  if (unclosedMatch) {
    // Code is being written RIGHT NOW
    const lang = unclosedMatch[1] || 'code';
    const code = unclosedMatch[2];
    streamingCodeLang = lang;

    // Ensure code panel is visible
    $('#codePanel').classList.remove('collapsed');

    // Show live code
    codeContent.innerHTML = `
      <div class="code-block">
        <div class="code-block-header">
          <span class="code-block-lang">${lang}</span>
          <span style="color:var(--warning);font-size:10px;">● Yaziliyor...</span>
        </div>
        <pre style="min-height:100px;">${highlightCode(code, lang)}<span style="animation:pulse 0.8s infinite;color:var(--accent);">|</span></pre>
      </div>
    `;

    // Auto-scroll code panel to bottom
    codeContent.scrollTop = codeContent.scrollHeight;
  } else if (completeBlocks.length > 0) {
    // Code block just completed — finalize in code panel
    const lastBlock = completeBlocks[completeBlocks.length - 1];
    const lang = lastBlock[1] || 'text';
    const code = lastBlock[2].trim();

    // Check if we already have this exact block
    const exists = state.codeBlocks.some(b => b.code === code && b.lang === lang);
    if (!exists && streamingCodeLang) {
      state.codeBlocks.push({ lang, code, id: state.codeBlocks.length });
      state.activeCodeTab = state.codeBlocks.length - 1;
      streamingCodeLang = '';
    }

    renderCodePanel();
  }
}

// ===== Agent Log =====
window.claude.onAgentLog((data, tabId) => {
  const { isActive } = getTabByTabId(tabId);
  if (isActive) addAgentLogEntry(data);
});

function addAgentLogEntry(text) {
  const entry = document.createElement('div');
  entry.className = 'agent-log-item';

  let statusClass = 'running';
  let label = text.trim();

  if (text.includes('completed') || text.includes('done') || text.includes('finished')) {
    statusClass = 'done';
  } else if (text.includes('error') || text.includes('Error')) {
    statusClass = 'error';
  }

  if (label.length > 60) label = label.substring(0, 57) + '...';

  entry.innerHTML = `
    <span class="status ${statusClass}"></span>
    <span class="label">${escapeHtml(label)}</span>
    <span class="time">${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
  `;

  agentLog.prepend(entry);
  while (agentLog.children.length > 50) agentLog.removeChild(agentLog.lastChild);
}

// ===== Permission Request Handling =====
window.claude.onPermissionRequest((data, tabId) => {
  const { isActive } = getTabByTabId(tabId);
  if (isActive) showPermissionCard(data);
});

function showPermissionCard(promptText) {
  removeTyping();

  // Remove any existing permission card
  const existing = chatMessages.querySelector('.permission-card');
  if (existing) existing.remove();

  const card = document.createElement('div');
  card.className = 'permission-card';
  card.innerHTML = `
    <div class="permission-header">
      <span class="permission-icon">&#128274;</span>
      <span class="permission-title">Izin Gerekiyor</span>
    </div>
    <div class="permission-desc">${escapeHtml(promptText.trim())}</div>
    <div class="permission-actions">
      <button class="perm-btn perm-allow">Bu Sefer Izin Ver</button>
      <button class="perm-btn perm-allow-all">Her Zaman Izin Ver</button>
      <button class="perm-btn perm-deny">Reddet</button>
    </div>
  `;
  chatMessages.appendChild(card);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Re-send message with permissions
  async function resendWithPermission(enableGlobal) {
    card.remove();
    // Keep permissionPending=true until resend completes — this prevents
    // the original sendMessage catch block from showing "Hata" when the
    // old process is killed (kill triggers reject → catch sees permissionPending=true → suppresses error)
    if (enableGlobal) {
      state.skipPermissions = true;
      // Update Tam Yetki button visual
      document.querySelectorAll('.prompt-btn').forEach(btn => {
        if (btn.dataset.danger === 'true') {
          btn.classList.add('active');
          btn.textContent = 'Tam Yetki ON';
        }
      });
    }

    const permTabId = lastSentTabId;
    await window.claude.killActiveProcess(permTabId);
    showTyping();

    const currentTab = state.chatTabs[state.activeChatTab];
    let sessionId = currentTab?.sessionId || null;
    let sessionContext = null;

    if (sessionId) {
      sessionContext = null;
    } else {
      sessionId = window.claude.generateUUID();
      const tabContext = currentTab?.sessionContext || null;
      sessionContext = tabContext || '__new__';
    }

    try {
      state.currentResponse = '';
      if (currentTab) currentTab._currentResponse = '';
      const response = await window.claude.sendMessage(
        lastSentMessage, lastSentImagePaths, sessionId, sessionContext, true, modelSelect.value, permTabId
      );
      removeTyping();
      const streamMsg = chatMessages.querySelector('.message.streaming');
      if (streamMsg) streamMsg.remove();

      const responseText = (typeof response === 'object' && response !== null) ? response.text : response;
      if (sessionId && currentTab) currentTab.sessionId = sessionId;
      if (currentTab) { currentTab.sessionContext = null; currentTab.resumeFallback = false; }

      addMessage('assistant', responseText);
      extractCodeBlocks(responseText);
    } catch (err) {
      removeTyping();
      addMessage('assistant', `Hata: ${err.message}`);
    }

    permissionPending = false;
    state.isWaiting = false;
    toggleWaitingButtons(false);
    if (currentTab) { currentTab.isWaiting = false; renderChatTabs(); }
    sendBtn.disabled = false;
    chatInput.focus();
    autoSaveSession();
  }

  card.querySelector('.perm-allow').onclick = () => resendWithPermission(false);
  card.querySelector('.perm-allow-all').onclick = () => {
    showToast('Tam yetki aktif — mesaj yeniden gonderiliyor');
    resendWithPermission(true);
  };
  card.querySelector('.perm-deny').onclick = async () => {
    card.remove();
    // Keep permissionPending=true until kill completes — prevents original
    // sendMessage catch from showing "Hata" when the process dies
    await window.claude.killActiveProcess(lastSentTabId);
    permissionPending = false;
    addMessage('assistant', 'Izin reddedildi. Islem iptal edildi.');
    state.isWaiting = false;
    toggleWaitingButtons(false);
    const currentTab = state.chatTabs[state.activeChatTab];
    if (currentTab) { currentTab.isWaiting = false; renderChatTabs(); }
    sendBtn.disabled = false;
    chatInput.focus();
  };
}

// ===== Messages =====
// Render-only (no state push) — used when restoring tabs
function renderMessageToDOM(role, text, images) {
  const msg = document.createElement('div');
  msg.className = `message ${role}`;
  let html = '';

  if (role === 'assistant' && text) {
    const hasCode = /```\w*\n[\s\S]*?```/.test(text);
    if (hasCode) {
      msg.classList.add('has-code');
      html += '<span class="msg-dot code" title="Kod iceriyor - tikla"></span>';
    } else {
      html += '<span class="msg-dot text" title="Metin cevabi"></span>';
    }
  }

  if (images && images.length > 0) {
    html += images.map(src => `<img src="${src}" alt="screenshot">`).join('');
  }
  if (text) {
    html += role === 'assistant' ? formatMarkdown(text) : escapeHtml(text);
  }

  msg.innerHTML = html;
  chatMessages.appendChild(msg);

  if (role === 'assistant') {
    msg.querySelectorAll('pre').forEach(pre => {
      pre.addEventListener('click', (e) => {
        e.stopPropagation();
        const codeEl = pre.querySelector('code');
        const code = codeEl ? codeEl.textContent : pre.textContent;
        const langMatch = codeEl?.className?.match(/lang-(\w+)/);
        const lang = langMatch ? langMatch[1] : 'text';
        $('#codePanel').classList.remove('collapsed');
        state.codeBlocks.push({ lang, code, id: state.codeBlocks.length });
        state.activeCodeTab = state.codeBlocks.length - 1;
        renderCodePanel();
        showToast(`Kod paneline eklendi (${lang})`);
      });
    });

    if (msg.querySelectorAll('pre').length > 0) {
      msg.addEventListener('click', () => {
        if (state.codeBlocks.length > 0) {
          $('#codePanel').classList.remove('collapsed');
          state.activeCodeTab = state.codeBlocks.length - 1;
          renderCodePanel();
        }
      });
    }
  }

  return msg;
}

function addMessage(role, text, images) {
  renderMessageToDOM(role, text, images);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  state.messages.push({ role, text, images: images || [], timestamp: Date.now() });
  updateTabLabel();
}

function showTyping() {
  const typing = document.createElement('div');
  typing.className = 'typing-indicator';
  typing.id = 'typingIndicator';
  typing.innerHTML = '<span></span><span></span><span></span>';
  chatMessages.appendChild(typing);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTyping() {
  const typing = document.getElementById('typingIndicator');
  if (typing) typing.remove();
}

// ===== Markdown Formatting =====
function formatMarkdown(text) {
  let html = escapeHtml(text);

  // Code blocks with language + syntax highlighting
  // Note: code is already escaped by the top-level escapeHtml, so use highlightEscaped
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const highlighted = highlightEscaped(code.trim(), lang || 'text');
    return `<pre><code class="lang-${lang || 'text'}">${highlighted}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Headers
  html = html.replace(/^### (.+)/gm, '<strong style="font-size:14px;">$1</strong>');
  html = html.replace(/^## (.+)/gm, '<strong style="font-size:15px;">$1</strong>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return html;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Syntax highlight for already-escaped HTML (used in formatMarkdown where text is pre-escaped)
function highlightEscaped(escapedCode, lang) {
  return _highlightLines(escapedCode.split('\n'), lang);
}

// Syntax highlighting matching Claude Code terminal style
function highlightCode(code, lang) {
  return _highlightLines(escapeHtml(code).split('\n'), lang);
}

function _highlightLines(lines, lang) {
  return lines.map(line => {
    // Diff highlighting: deleted lines (red bg), added lines (green bg)
    if (lang === 'diff' || line.match(/^[-+]/)) {
      if (/^[-]/.test(line) && !/^---/.test(line)) {
        return `<span class="hl-diff-del">${line}</span>`;
      }
      if (/^[+]/.test(line) && !/^\+\+\+/.test(line)) {
        return `<span class="hl-diff-add">${line}</span>`;
      }
      if (/^@@/.test(line)) {
        return `<span class="hl-diff-hunk">${line}</span>`;
      }
    }
    // General syntax highlighting
    let hl = line;
    // Strings (double and single quotes)
    hl = hl.replace(/(["'`])(?:(?!\1|\\).|\\.)*?\1/g, '<span class="hl-string">$&</span>');
    // Comments (// and #)
    hl = hl.replace(/(\/\/.*$|#.*$)/gm, '<span class="hl-comment">$&</span>');
    // Keywords
    hl = hl.replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|new|this|try|catch|throw|switch|case|break|default|continue|typeof|instanceof|in|of|do|yield|void|delete|null|undefined|true|false|def|self|elif|except|finally|with|as|lambda|pass|raise|print|None|True|False|pub|fn|use|mod|struct|impl|enum|match|mut|loop|crate|trait|type|interface|extends|implements|abstract|super|static|final|public|private|protected|package|override)\b/g, '<span class="hl-keyword">$&</span>');
    // Numbers
    hl = hl.replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-number">$&</span>');
    // Function calls
    hl = hl.replace(/\b([a-zA-Z_]\w*)\s*\(/g, '<span class="hl-func">$1</span>(');
    return hl;
  }).join('\n');
}

// ===== Code Panel =====
function extractCodeBlocks(text) {
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match;
  let found = false;

  while ((match = regex.exec(text)) !== null) {
    found = true;
    const lang = match[1] || 'text';
    const code = match[2].trim();
    state.codeBlocks.push({ lang, code, id: state.codeBlocks.length });
  }

  if (found) {
    state.activeCodeTab = state.codeBlocks.length - 1;
    renderCodePanel();
  }
}

function renderCodePanel() {
  if (state.codeBlocks.length === 0) {
    codeContent.innerHTML = '<div class="code-placeholder">Kod bloklari burada gorunecek<br><br><span style="font-size:11px;color:var(--text-muted);">Sohbetteki kod bloklarina tiklayarak<br>buraya gonderebilirsiniz</span></div>';
    codeTabs.innerHTML = '';
    return;
  }

  codeTabs.innerHTML = state.codeBlocks.map((block, i) => `
    <button class="code-tab ${i === state.activeCodeTab ? 'active' : ''}" data-index="${i}">
      <span>${block.lang} #${i + 1}</span>
      <span class="code-tab-close" data-index="${i}">&times;</span>
    </button>
  `).join('');

  codeTabs.querySelectorAll('.code-tab').forEach(tab => {
    tab.onclick = (e) => {
      if (e.target.classList.contains('code-tab-close')) return;
      state.activeCodeTab = parseInt(tab.dataset.index);
      renderCodePanel();
    };
  });

  // Code tab close buttons
  codeTabs.querySelectorAll('.code-tab-close').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      state.codeBlocks.splice(idx, 1);
      if (state.activeCodeTab >= state.codeBlocks.length) {
        state.activeCodeTab = Math.max(0, state.codeBlocks.length - 1);
      }
      renderCodePanel();
    };
  });

  const block = state.codeBlocks[state.activeCodeTab];
  if (block) {
    codeContent.innerHTML = `
      <div class="code-block">
        <div class="code-block-header">
          <span class="code-block-lang">${block.lang}</span>
          <button class="code-block-copy" data-code="${state.activeCodeTab}">Kopyala</button>
        </div>
        <pre>${highlightCode(block.code, block.lang)}</pre>
      </div>
    `;

    codeContent.querySelector('.code-block-copy').onclick = (e) => {
      navigator.clipboard.writeText(block.code);
      e.target.textContent = 'Kopyalandi!';
      e.target.classList.add('copied');
      setTimeout(() => {
        e.target.textContent = 'Kopyala';
        e.target.classList.remove('copied');
      }, 1500);
    };
  }
}

// ===== Session Management =====
async function loadSessions() {
  const sessions = await window.claude.getSessions();
  renderSessionList(sessions);
}

function renderSessionList(sessions) {
  if (sessions.length === 0) {
    sessionList.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px;">Henuz gecmis yok</div>';
    return;
  }

  // Group sessions by date category
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  const groups = { today: [], yesterday: [], thisWeek: [], older: [] };
  for (const s of sessions) {
    if (s.date === today) groups.today.push(s);
    else if (s.date === yesterday) groups.yesterday.push(s);
    else if (s.date >= weekAgo) groups.thisWeek.push(s);
    else groups.older.push(s);
  }

  let html = '';
  function renderGroup(label, items) {
    if (items.length === 0) return '';
    let out = `<div class="session-group-label">${label}</div>`;
    for (const s of items) {
      const sourceTag = s.source === 'CLI' ? '<span class="session-item-source">CLI</span>' : '';
      const topicTag = s.topic ? `<span class="session-item-topic">${escapeHtml(s.topic)}</span>` : '';
      // Show time: extract start time from "HH:MM - HH:MM" or "HH:MM"
      const timeStr = s.time ? s.time.split(' - ')[0].trim() : '';
      const timeTag = timeStr ? `<span class="session-item-time">${timeStr}</span>` : '';
      // Clean title: remove topic prefix if redundant, truncate
      let title = s.title || s.filename;
      if (title.length > 60) title = title.substring(0, 57) + '...';

      out += `
      <div class="session-item" data-file="${s.filename}" data-subdir="${s.subdir || ''}" title="${escapeHtml(s.title)}\n${s.date} ${s.time || ''}\n${s.msgCount || ''}">
        <div class="session-item-title">${escapeHtml(title)}${sourceTag}</div>
        <div class="session-item-meta">${topicTag}${timeTag}</div>
      </div>`;
    }
    return out;
  }

  html += renderGroup('Bugun', groups.today);
  html += renderGroup('Dun', groups.yesterday);
  html += renderGroup('Bu Hafta', groups.thisWeek);
  html += renderGroup('Onceki', groups.older.slice(0, 30));

  sessionList.innerHTML = html;

  sessionList.querySelectorAll('.session-item').forEach(item => {
    // Single click: select (highlight only)
    item.onclick = () => {
      sessionList.querySelectorAll('.session-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    };

    // Double click: open session in a new tab
    item.addEventListener('dblclick', async () => {
      const content = await window.claude.loadSession(item.dataset.file, item.dataset.subdir);
      if (!content) return;
      loadSessionIntoTab(content, item.dataset.file);
    });

    // Right-click context menu
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showSessionContextMenu(e.clientX, e.clientY, item.dataset.file, item.dataset.subdir);
    });
  });
}

// ===== Session Context Menu =====
function showSessionContextMenu(x, y, filename, subdir) {
  // Remove existing menu
  const existing = document.querySelector('.session-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'session-context-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.innerHTML = `
    <div class="ctx-item" data-action="rename">Yeniden Adlandir</div>
    <div class="ctx-item" data-action="export">Dosya Yolunu Kopyala</div>
    <div class="ctx-divider"></div>
    <div class="ctx-item ctx-danger" data-action="delete">Sil</div>
  `;
  document.body.appendChild(menu);

  // Keep menu within viewport
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (x - rect.width) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';

  // Handle actions
  menu.querySelectorAll('.ctx-item').forEach(item => {
    item.onclick = async () => {
      const action = item.dataset.action;
      menu.remove();

      if (action === 'delete') {
        const confirmName = await showPrompt(`Silmek icin "sil" yazin:`, '');
        if (confirmName && confirmName.toLowerCase() === 'sil') {
          await window.claude.deleteSession(filename, subdir);
          showToast('Session silindi');
          await loadSessions();
        }
      } else if (action === 'rename') {
        const baseName = filename.replace('.md', '');
        const newName = await showPrompt('Yeni dosya adi:', baseName);
        if (newName && newName !== baseName) {
          const newFilename = newName.endsWith('.md') ? newName : newName + '.md';
          await window.claude.renameSession(filename, newFilename, subdir);
          showToast('Session yeniden adlandirildi');
          await loadSessions();
        }
      } else if (action === 'export') {
        const settings = await window.claude.getSettings();
        const histDir = settings?.historyDir || '';
        const fullPath = subdir ? `${histDir}\\${subdir}\\${filename}` : `${histDir}\\sessions\\${filename}`;
        navigator.clipboard.writeText(fullPath);
        showToast('Dosya yolu kopyalandi');
      }
    };
  });

  // Close on click outside
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 10);
}

// Parse session markdown to extract messages and session ID
function parseSessionMarkdown(content) {
  // Extract CLI session ID if present
  const sessionIdMatch = content.match(/session:([a-f0-9-]+)/);
  const sessionId = sessionIdMatch ? sessionIdMatch[1] : null;

  // Extract topic
  const topicMatch = content.match(/\*\*Konu:\*\* (.+)/m);
  const topic = topicMatch ? topicMatch[1].trim() : null;

  // Parse messages from ## Diyalog section
  const messages = [];
  // Match both formats: "### Kullanici (time)" and "### ⚪/🟢 Claude (time)"
  const parts = content.split(/^### /m).slice(1); // Split by ### headers, skip content before first
  for (const part of parts) {
    const headerEnd = part.indexOf('\n');
    if (headerEnd === -1) continue;
    const header = part.substring(0, headerEnd);
    const body = part.substring(headerEnd + 1).replace(/\n---[\s\S]*$/, '').replace(/\n## [\s\S]*$/, '').trim();
    if (!body) continue;

    if (/Kullanici/i.test(header)) {
      messages.push({ role: 'user', text: body });
    } else if (/Claude/i.test(header)) {
      messages.push({ role: 'assistant', text: body });
    }
  }

  // Detect source: UI sessions have **SessionID:** field, CLI have <!-- session: -->
  const uiSessionMatch = content.match(/\*\*SessionID:\*\* ([a-f0-9-]+)/);
  const source = uiSessionMatch ? 'UI' : (sessionId ? 'CLI' : 'unknown');
  // Prefer UI sessionId field over CLI comment
  const finalSessionId = uiSessionMatch ? uiSessionMatch[1] : sessionId;

  // Check dialog status
  const statusMatch = content.match(/\*\*Durum:\*\* (.+)/m);
  const dialogEnded = statusMatch ? statusMatch[1].trim() === 'Sonlandirildi' : false;

  return { sessionId: finalSessionId, topic, messages, source, dialogEnded };
}

// Build context summary from old session messages (for --append-system-prompt)
function buildSessionContext(messages, topic) {
  // Take last 10 exchanges max to avoid huge prompts
  const recent = messages.slice(-20);
  let ctx = 'Kullanici ile onceki konusmamizin devami. Kaldigi yerden devam et.\n';
  if (topic) ctx += `Konu: ${topic}\n`;
  ctx += '\nOnceki diyalog (son mesajlar):\n\n';
  for (const m of recent) {
    const label = m.role === 'user' ? 'Kullanici' : 'Claude';
    // Truncate very long messages to keep context manageable
    const text = m.text.length > 500 ? m.text.substring(0, 500) + '...' : m.text;
    ctx += `${label}: ${text}\n\n`;
  }
  return ctx;
}

// Load a session into a new chat tab
function loadSessionIntoTab(content, filename) {
  const parsed = parseSessionMarkdown(content);

  // Create new tab
  saveCurrentTabState();
  const tabName = filename.replace(/^\d{4}-\d{2}-\d{2}_/, '').replace(/\.md$/, '').replace(/_/g, ' ');
  const tab = createChatTab(tabName);
  state.activeChatTab = state.chatTabs.length - 1;
  state.messages = [];
  state.codeBlocks = [];
  state.activeCodeTab = 0;

  // Clear chat and render loaded messages
  chatMessages.innerHTML = '';
  for (const msg of parsed.messages) {
    renderMessageToDOM(msg.role, msg.text);
    state.messages.push({ role: msg.role, text: msg.text, images: [], timestamp: Date.now() });
    // Extract code blocks from assistant messages
    if (msg.role === 'assistant') {
      extractCodeBlocks(msg.text);
    }
  }

  if (parsed.dialogEnded) {
    // Sonlandırılmış diyalog: salt okunur, devam edilemez
    tab.dialogEnded = true;
    showToast('Bu diyalog sonlandirilmis — salt okunur');
  } else if (parsed.source === 'UI' && parsed.sessionId) {
    // UI session: use --resume for full memory (fallback to context on error)
    tab.sessionId = parsed.sessionId;
    tab.sessionContext = buildSessionContext(parsed.messages, parsed.topic); // fallback
    tab.resumeFallback = true; // flag to retry with context if resume fails
    showToast('Session yuklendi — tam hafiza ile devam');
  } else {
    // CLI/old session: use context approach
    tab.sessionContext = buildSessionContext(parsed.messages, parsed.topic);
    showToast('Session yuklendi — context ile devam');
  }

  // Save loaded messages to tab
  tab.messages = [...state.messages];
  tab.codeBlocks = [...state.codeBlocks];

  chatMessages.scrollTop = chatMessages.scrollHeight;
  renderChatTabs();
  renderCodePanel();
  updateInputState();
  chatInput.focus();
}

let searchTimeout = null;
sessionSearch.addEventListener('input', async () => {
  const query = sessionSearch.value.trim().toLowerCase();
  clearTimeout(searchTimeout);

  if (!query) {
    await loadSessions();
    return;
  }

  // Quick filter on loaded sessions first
  searchTimeout = setTimeout(async () => {
    if (query.length >= 2) {
      // Deep search across all files (sessions + projects)
      const results = await window.claude.searchHistory(query);
      sessionList.innerHTML = results.length === 0
        ? '<div style="color:var(--text-muted);font-size:12px;padding:8px;">Sonuc bulunamadi</div>'
        : results.map(r => `
          <div class="session-item" data-file="${r.filename}" data-subdir="${r.category}" title="${r.snippet}">
            <div class="session-item-title">${escapeHtml(r.title)}</div>
            <div class="session-item-date">${r.category || 'session'} &middot; ${r.filename.substring(0, 10)}</div>
          </div>
        `).join('');

      sessionList.querySelectorAll('.session-item').forEach(item => {
        // Single click: select only
        item.onclick = () => {
          sessionList.querySelectorAll('.session-item').forEach(i => i.classList.remove('active'));
          item.classList.add('active');
        };
        // Double click: open session
        item.addEventListener('dblclick', async () => {
          const content = await window.claude.loadSession(item.dataset.file, item.dataset.subdir);
          if (!content) return;
          loadSessionIntoTab(content, item.dataset.file);
        });
      });
    } else {
      const sessions = await window.claude.getSessions();
      const filtered = sessions.filter(s =>
        s.title.toLowerCase().includes(query) || s.filename.toLowerCase().includes(query)
      );
      renderSessionList(filtered);
    }
  }, 300);
});

async function autoSaveSession() {
  if (state.messages.length < 2) return;
  const tab = state.chatTabs[state.activeChatTab];
  await autoSaveTabSession(tab || { messages: state.messages, codeBlocks: state.codeBlocks, tabNum: 1 });
}

async function autoSaveTabSession(tab) {
  const msgs = tab.messages || state.messages;
  const codes = tab.codeBlocks || state.codeBlocks;
  if (msgs.length < 2) return;

  const today = new Date().toISOString().split('T')[0];
  const topicText = msgs.slice(0, 20).map(m => m.text || '').join(' ');
  const topic = detectTopic(topicText);

  // Use tab label as filename slug
  const tabLabel = tab.label || 'session';
  const titleSlug = tabLabel.substring(0, 40).replace(/[^a-zA-Z0-9\u00C0-\u024F\u0400-\u04FFğüşıöçĞÜŞİÖÇ]/g, '_').toLowerCase();
  const tabSuffix = (tab.tabNum && tab.tabNum > 1) ? `_t${tab.tabNum}` : '';
  const filename = `${today}_${titleSlug}${tabSuffix}.md`;

  const tabSessionId = tab.sessionId || null;
  const dialogStatus = tab.dialogEnded ? 'ended' : 'active';
  const content = generateSessionMarkdownFor(msgs, codes, topic, tabSessionId, dialogStatus);
  await window.claude.saveSession(filename, content);
  await loadSessions();
}

function generateSessionMarkdown() {
  const topicText = state.messages.slice(0, 20).map(m => m.text || '').join(' ');
  const currentTab = state.chatTabs[state.activeChatTab];
  return generateSessionMarkdownFor(state.messages, state.codeBlocks, detectTopic(topicText), currentTab?.sessionId);
}

function generateSessionMarkdownFor(msgs, codes, topic, sessionId, dialogStatus) {
  const now = new Date();
  // Use current tab label as title
  const currentTab = state.chatTabs[state.activeChatTab];
  const title = currentTab?.label || topic || 'Session';

  // Baslangic-bitis saat araligi
  const firstTime = msgs[0]?.timestamp ? new Date(msgs[0].timestamp) : now;
  const lastTime = msgs[msgs.length - 1]?.timestamp ? new Date(msgs[msgs.length - 1].timestamp) : now;
  const startStr = firstTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const endStr = lastTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const timeRange = startStr === endStr ? startStr : `${startStr} - ${endStr}`;

  const userCount = msgs.filter(m => m.role === 'user').length;
  const assistantCount = msgs.filter(m => m.role === 'assistant').length;

  let md = `# ${title}\n\n`;
  md += `**Tarih:** ${now.toISOString().split('T')[0]}\n`;
  md += `**Saat:** ${timeRange}\n`;
  md += `**Kaynak:** Claude UI\n`;
  md += `**Mesaj:** ${userCount} kullanici, ${assistantCount} asistan\n`;
  if (topic) md += `**Konu:** ${topic}\n`;
  if (sessionId) md += `**SessionID:** ${sessionId}\n`;
  if (dialogStatus) md += `**Durum:** ${dialogStatus === 'ended' ? 'Sonlandirildi' : 'Devam Edebilir'}\n`;
  if (state.workingDir) md += `**Dizin:** ${state.workingDir}\n`;
  md += `\n---\n\n`;

  md += `## Diyalog\n\n`;
  let codeIdx = 0;
  msgs.forEach((m, i) => {
    const ts = m.timestamp
      ? new Date(m.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '';
    if (m.role === 'user') {
      md += `### Kullanici (${ts})\n`;
      md += `${m.text}\n\n`;
    } else {
      const hasCode = /```\w*\n[\s\S]*?```/.test(m.text || '');
      const dot = hasCode ? '\u{1F7E2}' : '\u26AA';
      if (hasCode) codeIdx++;
      const codeRef = hasCode ? ` \u2192 [Kod #${codeIdx}]` : '';
      md += `### ${dot} Claude (${ts})${codeRef}\n`;
      md += `${m.text}\n\n`;
    }
  });

  if (codes && codes.length > 0) {
    md += `## Kodlar\n\n`;
    codes.forEach((block, i) => {
      md += `### ${block.lang} #${i + 1}\n`;
      md += `\`\`\`${block.lang}\n${block.code}\n\`\`\`\n\n`;
    });
  }

  return md;
}

// ===== Welcome Screen =====
function showWelcome() {
  chatMessages.innerHTML = `
    <div class="welcome">
      <h2>&#9672; Claude UI</h2>
      <p>Claude Code icin gorsel arayuz.<br>
      Mesaj yazin, screenshot yapistirin, kodlarinizi takip edin.</p>
      <p style="font-size:11px;color:var(--text-muted);">
        Ipucu: <kbd style="background:var(--bg-tertiary);padding:2px 6px;border-radius:3px;font-size:10px;">Ctrl+V</kbd> ile ekran goruntusu yapistirabilirsiniz
        &nbsp;&middot;&nbsp;
        <kbd style="background:var(--bg-tertiary);padding:2px 6px;border-radius:3px;font-size:10px;">F1</kbd> yardim
      </p>
    </div>
  `;
}

// ===== Setup Wizard =====
const setupWizard = $('#setupWizard');

async function checkAndRunSetup() {
  const result = await window.claude.checkFirstRun();

  if (!result.firstRun) {
    // Already set up — load settings into UI
    setupWizard.style.display = 'none';
    if (result.settings?.workingDir) {
      state.workingDir = result.settings.workingDir;
      const dir = result.settings.workingDir;
      workdirLabel.textContent = dir.length > 40 ? '...' + dir.slice(-37) : dir;
      workdirLabel.title = dir;
    }
    return false;
  }

  // First run — show wizard
  setupWizard.style.display = 'flex';

  // Step 1: CLI check
  const cliStatus = $('#cliStatus');
  if (result.claudeInstalled) {
    cliStatus.className = 'cli-status ok';
    cliStatus.innerHTML = '&#10003; Claude CLI kurulu ve calisiyor.<br>Her sey hazir!';
  } else {
    cliStatus.className = 'cli-status warn';
    cliStatus.innerHTML = '&#9888; Claude CLI bulunamadi.<br><br>Uygulamayi kullanabilmek icin Claude CLI gereklidir.<br>Terminalde su komutu calistirin:<br><code style="background:var(--code-bg);padding:2px 8px;border-radius:3px;">npm install -g @anthropic-ai/claude-code</code><br><br>Kurduktan sonra devam edebilirsiniz.';
  }

  // Set defaults
  $('#setupHistoryDir').value = result.defaultHistoryDir;
  $('#setupWorkDir').value = result.defaultWorkingDir;

  // Step navigation
  const steps = ['setupStep1', 'setupStep2', 'setupStep3'];
  function showStep(n) {
    steps.forEach((s, i) => {
      $('#' + s).style.display = i === n ? 'block' : 'none';
    });
  }

  $('#step1Next').onclick = () => showStep(1);
  $('#step2Back').onclick = () => showStep(0);
  $('#step2Next').onclick = () => showStep(2);
  $('#step3Back').onclick = () => showStep(1);

  // Browse buttons
  $('#browseHistory').onclick = async () => {
    const dir = await window.claude.selectDirectoryFor('history');
    if (dir) $('#setupHistoryDir').value = dir;
  };
  $('#browseWorkDir').onclick = async () => {
    const dir = await window.claude.selectDirectoryFor('work');
    if (dir) $('#setupWorkDir').value = dir;
  };

  // Complete setup
  return new Promise((resolve) => {
    $('#setupComplete').onclick = async () => {
      const settings = await window.claude.completeSetup({
        historyDir: $('#setupHistoryDir').value,
        workingDir: $('#setupWorkDir').value
      });

      state.workingDir = settings.workingDir;
      const dir = settings.workingDir;
      workdirLabel.textContent = dir.length > 40 ? '...' + dir.slice(-37) : dir;
      workdirLabel.title = dir;

      setupWizard.style.display = 'none';
      showToast('Kurulum tamamlandi!');
      resolve(true);
    };
  });
}

// ===== Chat Tab Events =====
async function addNewChatTab() {
  const name = await showPrompt('Sohbet adi:', '');
  if (name === null) return; // user cancelled
  const label = name.trim() || `Sohbet ${state.chatTabs.length + 1}`;

  saveCurrentTabState();
  const tab = createChatTab(label);
  tab.labelUpdated = true; // Prevent auto-rename
  state.activeChatTab = state.chatTabs.length - 1;
  state.messages = [];
  state.codeBlocks = [];
  state.activeCodeTab = 0;
  chatMessages.innerHTML = '';
  showWelcome();
  renderCodePanel();
  renderChatTabs();
  chatInput.focus();
  showToast(`"${label}" acildi`);
}

// ===== Init =====
async function init() {
  await checkAndRunSetup();

  // Load total token count from settings
  state.totalTokens = await window.claude.getTotalTokens() || 0;
  updateTokenDisplay();

  // Try to restore previous tabs from last session
  let tabsRestored = false;
  const savedTabsData = localStorage.getItem('claude-ui-open-tabs');
  if (savedTabsData) {
    try {
      const { tabs, activeTab } = JSON.parse(savedTabsData);
      if (tabs && tabs.length > 0 && tabs.some(t => t.hasMessages)) {
        for (const tabData of tabs) {
          if (tabData.hasMessages && tabData.filename) {
            try {
              const content = await window.claude.loadSession(tabData.filename, '');
              if (content) {
                loadSessionIntoTab(content, tabData.filename);
                // Override tab label with saved label
                const newTab = state.chatTabs[state.chatTabs.length - 1];
                if (tabData.label) newTab.label = tabData.label;
                if (tabData.sessionId) newTab.sessionId = tabData.sessionId;
                tabsRestored = true;
                continue;
              }
            } catch (e) { console.error('Tab restore load error:', e); }
          }
          // Empty tab or file not found — create with label
          createChatTab(tabData.label || undefined);
        }
        if (tabsRestored) {
          const target = Math.min(activeTab || 0, state.chatTabs.length - 1);
          switchToTab(target);
          renderChatTabs();
          showToast('Onceki sekmeler geri yuklendi');
        }
      }
    } catch (e) {
      console.error('Tab restore error:', e);
    }
    localStorage.removeItem('claude-ui-open-tabs');
  }

  if (!tabsRestored) {
    // Create first tab (fresh start)
    createChatTab();
    renderChatTabs();
    showWelcome();
  }

  // Acilista terminal oturumlarini sync et
  try {
    const syncResult = await window.claude.syncTerminalSessions();
    if (syncResult.synced > 0) {
      showToast(`${syncResult.synced} terminal oturumu sync edildi`);
    }
  } catch (e) { console.error('Terminal sync hatasi:', e); }

  await loadSessions();
  chatInput.focus();

  // Periyodik auto-save: her 2 dakikada bir (mesaj varsa)
  setInterval(() => {
    if (state.messages.length >= 2) {
      autoSaveSession();
    }
  }, 2 * 60 * 1000);

  // Uygulama kapanirken tum tab'lari kaydet + sekme durumunu localStorage'a yaz
  window.addEventListener('beforeunload', (e) => {
    // Save total tokens (sync - beforeunload can't do async reliably)
    window.claude.saveTotalTokensSync(state.totalTokens);

    saveCurrentTabState();

    const tabRestoreData = [];

    for (const tab of state.chatTabs) {
      const msgs = tab.messages || [];
      const hasMessages = msgs.length >= 2;

      let filename = '';
      if (hasMessages) {
        const today = new Date().toISOString().split('T')[0];
        const topicText = msgs.slice(0, 20).map(m => m.text || '').join(' ');
        const topic = detectTopic(topicText);
        let slug;
        if (topic) {
          slug = topic.toLowerCase().replace(/[^a-z0-9]/g, '_');
        } else {
          const firstUserMsg = msgs.find(m => m.role === 'user')?.text || 'session';
          slug = firstUserMsg.substring(0, 40).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        }
        const tabSuffix = (tab.tabNum && tab.tabNum > 1) ? `_t${tab.tabNum}` : '';
        filename = `${today}_${slug}${tabSuffix}.md`;

        // Save session content (sync — beforeunload can't do async)
        const codes = tab.codeBlocks || [];
        const content = generateSessionMarkdownFor(msgs, codes);
        window.claude.saveSessionSync(filename, content);
      }

      tabRestoreData.push({
        label: tab.label,
        sessionId: tab.sessionId || null,
        filename: filename,
        dialogEnded: tab.dialogEnded || false,
        hasMessages: hasMessages
      });
    }

    // Save tab state for restoration on next launch
    localStorage.setItem('claude-ui-open-tabs', JSON.stringify({
      tabs: tabRestoreData,
      activeTab: state.activeChatTab
    }));
  });
}

init();
