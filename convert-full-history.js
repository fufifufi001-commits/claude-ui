const fs = require('fs');
const path = require('path');

const SRC_DIR = 'C:\\Users\\DELL\\.claude\\projects\\C--Users-DELL-Desktop';
const DST_DIR = 'D:\\ClaudeHistory\\sessions';

// Get all JSONL files
const jsonlFiles = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.jsonl'));
console.log(`Found ${jsonlFiles.length} JSONL session files`);

let converted = 0;

jsonlFiles.forEach(file => {
  try {
    const lines = fs.readFileSync(path.join(SRC_DIR, file), 'utf-8')
      .split('\n').filter(l => l.trim());

    const messages = [];
    let sessionDate = null;

    lines.forEach(line => {
      try {
        const entry = JSON.parse(line);

        // Skip non-message entries
        if (!entry.message || !entry.message.role) return;

        const role = entry.message.role;
        let text = '';

        if (typeof entry.message.content === 'string') {
          text = entry.message.content;
        } else if (Array.isArray(entry.message.content)) {
          text = entry.message.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');
        }

        if (!text.trim()) return;

        const timestamp = entry.timestamp || new Date().toISOString();
        if (!sessionDate) sessionDate = timestamp;

        messages.push({ role, text, timestamp });
      } catch (e) {}
    });

    if (messages.length < 2) return; // Need at least user + assistant

    // Build markdown
    const date = new Date(sessionDate);
    const dateStr = date.toISOString().split('T')[0];
    const time = date.toLocaleTimeString('tr-TR');

    // Title from first user message
    const firstUser = messages.find(m => m.role === 'user');
    const title = firstUser
      ? firstUser.text.substring(0, 80).replace(/\n/g, ' ').trim()
      : 'Session';

    let md = `# ${title}\n\n`;
    md += `**Tarih:** ${dateStr}\n`;
    md += `**Saat:** ${time}\n`;
    md += `**Session:** ${file.replace('.jsonl', '')}\n`;
    md += `**Mesaj sayisi:** ${messages.length}\n`;
    md += `\n---\n\n`;
    md += `## Diyalog\n\n`;

    messages.forEach(m => {
      const ts = new Date(m.timestamp).toLocaleTimeString('tr-TR');

      if (m.role === 'user') {
        md += `### Kullanici (${ts})\n`;
        // Truncate very long messages
        const text = m.text.length > 2000 ? m.text.substring(0, 2000) + '\n\n... (truncated)' : m.text;
        md += `${text}\n\n`;
      } else {
        const hasCode = /```\w*\n[\s\S]*?```/.test(m.text);
        const dot = hasCode ? '🟢' : '⚪';
        md += `### ${dot} Claude (${ts})\n`;
        const text = m.text.length > 3000 ? m.text.substring(0, 3000) + '\n\n... (truncated)' : m.text;
        md += `${text}\n\n`;
      }
    });

    // Filename
    const slug = title.substring(0, 40)
      .replace(/[^a-zA-Z0-9\u00C0-\u024FğüşıöçĞÜŞİÖÇ ]/g, '_')
      .replace(/\s+/g, '_')
      .toLowerCase();
    let filename = `${dateStr}_${slug}.md`;
    let finalPath = path.join(DST_DIR, filename);
    let idx = 1;
    while (fs.existsSync(finalPath)) {
      finalPath = path.join(DST_DIR, `${dateStr}_${slug}_${idx}.md`);
      idx++;
    }

    fs.writeFileSync(finalPath, md, 'utf-8');
    converted++;
  } catch (e) {
    console.error(`Error processing ${file}:`, e.message);
  }
});

console.log(`Converted: ${converted} full sessions (with Claude responses)`);
