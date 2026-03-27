#!/usr/bin/env node
/**
 * sync-terminal-sessions.js
 *
 * Claude Code CLI terminal oturumlarini Claude UI session formatina (.md) donusturur.
 *
 * Kullanim:
 *   node sync-terminal-sessions.js                  # Bugunun oturumlarini sync et
 *   node sync-terminal-sessions.js --all            # Tum oturumlari sync et
 *   node sync-terminal-sessions.js --session <id>   # Belirli bir oturumu sync et
 *   node sync-terminal-sessions.js --since 2026-03-27  # Belirli tarihten itibaren
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// --- Config ---
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const HISTORY_FILE = path.join(CLAUDE_DIR, 'history.jsonl');

// Claude UI settings'den historyDir'i oku
function getHistoryDir() {
  const settingsPath = path.join(process.env.APPDATA || '', 'claude-ui', 'claude-ui-settings.json');
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    if (settings.historyDir) return settings.historyDir;
  } catch (e) {}
  return path.join(os.homedir(), 'Documents', 'ClaudeHistory');
}

const SESSIONS_DIR = path.join(getHistoryDir(), 'sessions');

// --- Topic Detection (Claude UI ile ayni mantik) ---
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

// --- Parse JSONL conversation ---
function parseConversation(jsonlPath) {
  const content = fs.readFileSync(jsonlPath, 'utf-8');
  const lines = content.trim().split('\n');

  const messages = [];
  let sessionId = null;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      if (entry.type === 'user') {
        if (!sessionId) sessionId = entry.sessionId;
        const text = typeof entry.message?.content === 'string'
          ? entry.message.content
          : Array.isArray(entry.message?.content)
            ? entry.message.content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n')
            : '';
        if (text.trim()) {
          messages.push({
            role: 'user',
            text: text.trim(),
            timestamp: entry.timestamp
          });
        }
      } else if (entry.type === 'assistant') {
        const msg = entry.message;
        if (!msg?.content) continue;

        const textParts = [];
        const toolCalls = [];

        for (const block of msg.content) {
          if (block.type === 'text' && block.text?.trim()) {
            textParts.push(block.text.trim());
          } else if (block.type === 'tool_use') {
            toolCalls.push(block.name);
          }
        }

        let text = textParts.join('\n\n');
        if (toolCalls.length > 0 && !text) {
          text = `[Araclar: ${[...new Set(toolCalls)].join(', ')}]`;
        } else if (toolCalls.length > 0) {
          text += `\n\n_Araclar: ${[...new Set(toolCalls)].join(', ')}_`;
        }

        if (text.trim()) {
          messages.push({
            role: 'assistant',
            text: text.trim(),
            timestamp: entry.timestamp
          });
        }
      }
    } catch (e) {
      // Skip malformed lines
    }
  }

  return { messages, sessionId };
}

// --- Generate session markdown ---
function generateSessionMd(messages, sessionId) {
  if (messages.length === 0) return null;

  const firstMsg = messages[0];
  const lastMsg = messages[messages.length - 1];
  const firstTime = new Date(firstMsg.timestamp);
  const lastTime = new Date(lastMsg.timestamp);

  const dateStr = firstTime.toISOString().split('T')[0];
  const startTime = firstTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const endTime = lastTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  // Detect topic from first 20 messages (prevents drift in long sessions)
  const topicText = messages.slice(0, 20).map(m => m.text).join(' ');
  const topic = detectTopic(topicText);

  // Title from first user message
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
  md += `\n---\n\n`;

  md += `## Diyalog\n\n`;

  for (const m of messages) {
    const ts = new Date(m.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (m.role === 'user') {
      md += `### Kullanici (${ts})\n`;
      md += `${m.text}\n\n`;
    } else {
      const hasCode = /```/.test(m.text);
      const dot = hasCode ? '\u{1F7E2}' : '\u26AA';
      md += `### ${dot} Claude (${ts})\n`;
      md += `${m.text}\n\n`;
    }
  }

  // Filename
  let slug;
  if (topic) {
    slug = topic;
  } else {
    const cleaned = firstUserMsg.replace(/^(merhaba|günaydın|selam|hey|claude)\s*/gi, '').trim();
    slug = (cleaned.length > 5 ? cleaned : firstUserMsg)
      .substring(0, 40)
      .replace(/[^a-zA-Z0-9\u00C0-\u024F\u0400-\u04FFğüşıöçĞÜŞİÖÇ]/g, '_')
      .toLowerCase();
  }

  const filename = `${dateStr}_${slug}_cli.md`;

  return { md, filename, dateStr, topic, sessionId };
}

// --- Find all conversation JSONL files ---
function findConversations(opts = {}) {
  const conversations = [];

  if (!fs.existsSync(PROJECTS_DIR)) return conversations;

  const projectDirs = fs.readdirSync(PROJECTS_DIR);
  for (const projDir of projectDirs) {
    const projPath = path.join(PROJECTS_DIR, projDir);
    if (!fs.statSync(projPath).isDirectory()) continue;

    const files = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const filePath = path.join(projPath, file);
      const stat = fs.statSync(filePath);
      const sessionId = file.replace('.jsonl', '');

      // Filter by session ID
      if (opts.sessionId && sessionId !== opts.sessionId) continue;

      // Filter by date
      if (opts.since) {
        const sinceDate = new Date(opts.since);
        if (stat.mtime < sinceDate) continue;
      }

      // Default: today only
      if (!opts.all && !opts.since && !opts.sessionId) {
        const today = new Date().toISOString().split('T')[0];
        const fileDate = stat.mtime.toISOString().split('T')[0];
        if (fileDate !== today) continue;
      }

      conversations.push({
        path: filePath,
        sessionId,
        mtime: stat.mtime,
        size: stat.size,
        project: projDir
      });
    }
  }

  return conversations.sort((a, b) => a.mtime - b.mtime);
}

// --- Check if already synced ---
function isAlreadySynced(sessionId) {
  if (!fs.existsSync(SESSIONS_DIR)) return false;
  const files = fs.readdirSync(SESSIONS_DIR);
  for (const f of files) {
    if (!f.endsWith('_cli.md')) continue;
    try {
      const content = fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf-8');
      if (content.includes(`session:${sessionId}`)) return f;
    } catch (e) {}
  }
  return false;
}

// --- Main ---
function main() {
  const args = process.argv.slice(2);
  const opts = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--all') opts.all = true;
    if (args[i] === '--session' && args[i + 1]) { opts.sessionId = args[i + 1]; i++; }
    if (args[i] === '--since' && args[i + 1]) { opts.since = args[i + 1]; i++; }
    if (args[i] === '--force') opts.force = true;
  }

  // Ensure sessions dir exists
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  const conversations = findConversations(opts);

  if (conversations.length === 0) {
    console.log('Sync edilecek terminal oturumu bulunamadi.');
    return;
  }

  console.log(`${conversations.length} oturum bulundu.\n`);

  let synced = 0;
  let skipped = 0;

  for (const conv of conversations) {
    // Skip very small files (< 1KB, probably empty/test)
    if (conv.size < 1000) {
      console.log(`  Atlandi (cok kucuk): ${conv.sessionId}`);
      skipped++;
      continue;
    }

    // Check if already synced
    if (!opts.force) {
      const existing = isAlreadySynced(conv.sessionId);
      if (existing) {
        console.log(`  Zaten mevcut: ${existing}`);
        skipped++;
        continue;
      }
    }

    console.log(`  Isleniyor: ${conv.sessionId} (${(conv.size / 1024).toFixed(0)} KB)...`);

    try {
      const { messages } = parseConversation(conv.path);

      if (messages.length < 2) {
        console.log(`    Atlandi (yetersiz mesaj: ${messages.length})`);
        skipped++;
        continue;
      }

      const result = generateSessionMd(messages, conv.sessionId);
      if (!result) {
        skipped++;
        continue;
      }

      // Add session ID marker for dedup
      const mdWithMarker = result.md + `\n---\n_<!-- session:${conv.sessionId} -->_\n`;

      const outPath = path.join(SESSIONS_DIR, result.filename);

      // If file exists (same topic, same day), append session number
      let finalPath = outPath;
      if (fs.existsSync(outPath) && !opts.force) {
        const base = result.filename.replace('.md', '');
        let n = 2;
        while (fs.existsSync(path.join(SESSIONS_DIR, `${base}_${n}.md`))) n++;
        finalPath = path.join(SESSIONS_DIR, `${base}_${n}.md`);
      }

      fs.writeFileSync(finalPath, mdWithMarker, 'utf-8');
      console.log(`    Kaydedildi: ${path.basename(finalPath)} (${messages.length} mesaj)`);
      synced++;
    } catch (e) {
      console.error(`    Hata: ${e.message}`);
    }
  }

  console.log(`\nTamamlandi: ${synced} sync, ${skipped} atlandi.`);
}

main();
