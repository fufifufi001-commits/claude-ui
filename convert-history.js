const fs = require('fs');
const path = require('path');

const HISTORY_SRC = 'C:\\Users\\DELL\\.claude\\history.jsonl';
const HISTORY_DST = 'D:\\ClaudeHistory\\sessions';

// Read and parse JSONL
const lines = fs.readFileSync(HISTORY_SRC, 'utf-8').split('\n').filter(l => l.trim());
const entries = [];

lines.forEach(line => {
  try {
    entries.push(JSON.parse(line));
  } catch (e) {}
});

console.log(`Total entries: ${entries.length}`);

// Group by sessionId
const sessions = {};
entries.forEach(e => {
  const sid = e.sessionId || 'unknown';
  if (!sessions[sid]) sessions[sid] = [];
  sessions[sid].push(e);
});

console.log(`Total sessions: ${Object.keys(sessions).length}`);

// Convert each session to MD
let converted = 0;

Object.entries(sessions).forEach(([sessionId, msgs]) => {
  if (msgs.length === 0) return;

  // Sort by timestamp
  msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  const firstMsg = msgs[0];
  const date = new Date(firstMsg.timestamp || Date.now());
  const dateStr = date.toISOString().split('T')[0];
  const time = date.toLocaleTimeString('tr-TR');
  const project = firstMsg.project || '';

  // Title from first message
  const title = (firstMsg.display || 'Session').substring(0, 80).replace(/\n/g, ' ');

  // Build MD
  let md = `# ${title}\n\n`;
  md += `**Tarih:** ${dateStr}\n`;
  md += `**Saat:** ${time}\n`;
  md += `**Proje:** ${project}\n`;
  md += `**Session:** ${sessionId}\n`;
  md += `**Mesaj sayisi:** ${msgs.length}\n`;
  md += `\n---\n\n`;
  md += `## Kullanici Mesajlari\n\n`;

  msgs.forEach((m, i) => {
    const ts = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('tr-TR') : '';
    const display = m.display || '(bos)';
    md += `### ${i + 1}. (${ts})\n`;
    md += `${display}\n\n`;

    // If there are pasted contents
    if (m.pastedContents && Object.keys(m.pastedContents).length > 0) {
      md += `*Yapistirilan dosyalar:*\n`;
      Object.keys(m.pastedContents).forEach(k => {
        md += `- ${k}\n`;
      });
      md += '\n';
    }
  });

  // Filename
  const slug = title.substring(0, 40)
    .replace(/[^a-zA-Z0-9\u00C0-\u024F\u0400-\u04FFğüşıöçĞÜŞİÖÇ ]/g, '_')
    .replace(/\s+/g, '_')
    .toLowerCase();
  let filename = `${dateStr}_${slug}.md`;

  let finalPath = path.join(HISTORY_DST, filename);
  let idx = 1;
  while (fs.existsSync(finalPath)) {
    finalPath = path.join(HISTORY_DST, `${dateStr}_${slug}_${idx}.md`);
    idx++;
  }

  fs.writeFileSync(finalPath, md, 'utf-8');
  converted++;
});

console.log(`Converted: ${converted} sessions to ${HISTORY_DST}`);
