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
  templates: []
};

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

// ===== Window Controls =====
$('#btnMin').onclick = () => window.claude.minimize();
$('#btnMax').onclick = () => window.claude.maximize();
$('#btnClose').onclick = () => window.claude.close();

// ===== Sidebar Toggle =====
$('#sidebarToggle').onclick = () => $('#sidebar').classList.toggle('collapsed');

// ===== Code Panel Toggle =====
$('#codePanelToggle').onclick = () => $('#codePanel').classList.toggle('collapsed');

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

// ===== Working Directory =====
workdirLabel.onclick = async () => {
  const dir = await window.claude.selectDirectory();
  if (dir) {
    state.workingDir = dir;
    workdirLabel.textContent = dir.length > 40 ? '...' + dir.slice(-37) : dir;
    workdirLabel.title = dir;
  }
};

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', (e) => {
  // F1 - Help
  if (e.key === 'F1') { e.preventDefault(); helpModal.style.display = helpModal.style.display === 'none' ? 'flex' : 'none'; }
  // Esc - Close modals
  if (e.key === 'Escape') { helpModal.style.display = 'none'; }
  // Ctrl+B - Toggle sidebar
  if (e.ctrlKey && e.key === 'b') { e.preventDefault(); $('#sidebar').classList.toggle('collapsed'); }
  // Ctrl+J - Toggle code panel
  if (e.ctrlKey && e.key === 'j') { e.preventDefault(); $('#codePanel').classList.toggle('collapsed'); }
  // Ctrl+T - Toggle theme
  if (e.ctrlKey && e.key === 't') { e.preventDefault(); toggleTheme(); }
  // Ctrl+Shift+S - Save session
  if (e.ctrlKey && e.shiftKey && e.key === 'S') { e.preventDefault(); autoSaveSession(); showToast('Session kaydedildi'); }
  // Ctrl+Shift+E - Export
  if (e.ctrlKey && e.shiftKey && e.key === 'E') { e.preventDefault(); exportSession(); }
});

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
  { label: 'Incele', prompt: 'Bu dosyayi incele ve iyilestirme onerileri sun:' }
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
    btn.className = 'prompt-btn';
    btn.textContent = tpl.label;
    btn.dataset.prompt = tpl.prompt;
    btn.onclick = () => {
      chatInput.value = chatInput.value ? chatInput.value + '\n' + tpl.prompt : tpl.prompt;
      chatInput.focus();
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
    };
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

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text && state.pastedImages.length === 0) return;
  if (state.isWaiting) return;

  const imagePaths = state.pastedImages.map(img => img.path);
  const imageDataUrls = state.pastedImages.map(img => img.base64);

  addMessage('user', text, imageDataUrls);
  chatInput.value = '';
  chatInput.style.height = 'auto';
  state.pastedImages = [];
  renderImagePreviews();

  state.isWaiting = true;
  sendBtn.disabled = true;
  showTyping();

  try {
    state.currentResponse = '';
    const response = await window.claude.sendMessage(text, imagePaths);
    removeTyping();
    // Remove streaming message if exists
    const streamMsg = chatMessages.querySelector('.message.streaming');
    if (streamMsg) streamMsg.remove();
    addMessage('assistant', response);
    extractCodeBlocks(response);
  } catch (err) {
    removeTyping();
    addMessage('assistant', `Hata: ${err.message}`);
  }

  state.isWaiting = false;
  sendBtn.disabled = false;
  chatInput.focus();

  autoSaveSession();
}

// ===== Streaming =====
window.claude.onStream((chunk) => {
  state.currentResponse += chunk;
  updateStreamingMessage(state.currentResponse);
});

function updateStreamingMessage(content) {
  removeTyping();
  let streamMsg = chatMessages.querySelector('.message.assistant.streaming');
  if (!streamMsg) {
    streamMsg = document.createElement('div');
    streamMsg.className = 'message assistant streaming';
    chatMessages.appendChild(streamMsg);
  }
  streamMsg.innerHTML = formatMarkdown(content);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ===== Agent Log =====
window.claude.onAgentLog((data) => {
  addAgentLogEntry(data);
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

// ===== Messages =====
function addMessage(role, text, images) {
  const msg = document.createElement('div');
  msg.className = `message ${role}`;

  let html = '';

  // Assistant messages get dot indicator
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
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Click-to-send code blocks to code panel
  if (role === 'assistant') {
    const hasCodeBlocks = msg.querySelectorAll('pre').length > 0;

    msg.querySelectorAll('pre').forEach((pre, preIdx) => {
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

    // Click on message body (not pre) jumps to related code in panel
    if (hasCodeBlocks) {
      msg.addEventListener('click', () => {
        // Find related code blocks that were extracted from this message
        const msgIdx = state.messages.length; // current message index
        // Jump to the latest code block
        if (state.codeBlocks.length > 0) {
          $('#codePanel').classList.remove('collapsed');
          state.activeCodeTab = state.codeBlocks.length - 1;
          renderCodePanel();
        }
      });
    }
  }

  state.messages.push({ role, text, images: images || [], timestamp: Date.now() });
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

  // Code blocks with language
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre><code class="lang-${lang || 'text'}">${code.trim()}</code></pre>`;
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
      ${block.lang} #${i + 1}
    </button>
  `).join('');

  codeTabs.querySelectorAll('.code-tab').forEach(tab => {
    tab.onclick = () => {
      state.activeCodeTab = parseInt(tab.dataset.index);
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
        <pre>${escapeHtml(block.code)}</pre>
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
  sessionList.innerHTML = sessions.length === 0
    ? '<div style="color:var(--text-muted);font-size:12px;padding:8px;">Henuz gecmis yok</div>'
    : sessions.map(s => `
      <div class="session-item" data-file="${s.filename}" data-subdir="${s.subdir || ''}" title="${s.title}">
        <div class="session-item-title">${escapeHtml(s.title)}</div>
        <div class="session-item-date">${s.date}${s.subdir ? ' &middot; ' + s.subdir : ''}</div>
      </div>
    `).join('');

  sessionList.querySelectorAll('.session-item').forEach(item => {
    item.onclick = async () => {
      const content = await window.claude.loadSession(item.dataset.file, item.dataset.subdir);
      if (content) {
        addMessage('assistant', `**Yuklenen session:**\n\n${content}`);
      }
      sessionList.querySelectorAll('.session-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    };
  });
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
        item.onclick = async () => {
          const content = await window.claude.loadSession(item.dataset.file, item.dataset.subdir);
          if (content) addMessage('assistant', `**Yuklenen:**\n\n${content}`);
          sessionList.querySelectorAll('.session-item').forEach(i => i.classList.remove('active'));
          item.classList.add('active');
        };
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

  const today = new Date().toISOString().split('T')[0];
  const firstUserMsg = state.messages.find(m => m.role === 'user')?.text || 'session';
  const titleSlug = firstUserMsg.substring(0, 40).replace(/[^a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF]/g, '_').toLowerCase();
  const filename = `${today}_${titleSlug}.md`;

  const content = generateSessionMarkdown();
  await window.claude.saveSession(filename, content);
  await loadSessions();
}

function generateSessionMarkdown() {
  const now = new Date();
  const firstMsg = state.messages.find(m => m.role === 'user')?.text || 'Session';
  const title = firstMsg.substring(0, 60);

  let md = `# ${title}\n\n`;
  md += `**Tarih:** ${now.toISOString().split('T')[0]}\n`;
  md += `**Saat:** ${now.toLocaleTimeString('tr-TR')}\n`;
  if (state.workingDir) md += `**Dizin:** ${state.workingDir}\n`;
  md += `\n---\n\n`;

  md += `## Diyalog\n\n`;
  state.messages.forEach((m, i) => {
    const ts = new Date(m.timestamp).toLocaleTimeString('tr-TR');
    if (m.role === 'user') {
      md += `### Kullanici (${ts})\n`;
      md += `${m.text}\n\n`;
    } else {
      // Claude response - mark with dot type
      const hasCode = /```\w*\n[\s\S]*?```/.test(m.text || '');
      const dot = hasCode ? '🟢' : '⚪';
      const codeRef = hasCode ? ` → [Kod #${state.codeBlocks.length}]` : '';
      md += `### ${dot} Claude (${ts})${codeRef}\n`;
      md += `${m.text}\n\n`;
    }
  });

  if (state.codeBlocks.length > 0) {
    md += `## Kodlar\n\n`;
    state.codeBlocks.forEach((block, i) => {
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

// ===== Init =====
async function init() {
  await checkAndRunSetup();
  showWelcome();
  await loadSessions();
  chatInput.focus();
}

init();
