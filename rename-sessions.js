const fs = require('fs');
const path = require('path');

const DIR = 'D:\\ClaudeHistory\\sessions';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.md'));

// Keywords to detect topics
const TOPIC_KEYWORDS = [
  { keywords: ['cauldroncrush', 'brewburst', 'oyun', 'unity', 'puzzle', 'level', 'kazan', 'iksir', 'simya', 'admob', 'iap', 'google play', 'aab', 'build'], topic: 'CauldronCrush' },
  { keywords: ['mediscribe', 'vitalboost', 'scansense', 'saglik', 'sağlık', 'ilac', 'ilaç', 'recete', 'reçete', 'medikal', 'medical', 'tarama', 'barkod', 'qr'], topic: 'VitalBoost' },
  { keywords: ['kozmetify', 'fiyatradari', 'fiyat karşılaştırma', 'fiyat karsilastirma', 'kozmetik', 'scraping', 'trendyol', 'gratis', 'watsons'], topic: 'Kozmetify' },
  { keywords: ['masal', 'hikaye', 'fıkra', 'fikra', 'sesli okuma', 'dallanma'], topic: 'Masal App' },
  { keywords: ['comfyui', 'workflow', 'qwen', 'controlnet', 'lora', 'inpainting', 'ksampler', 'gguf', 'checkpoint'], topic: 'ComfyUI' },
  { keywords: ['virtual tryon', 'tryon', 'giysi', 'kıyafet', 'kiyafet'], topic: 'ComfyUI - Virtual TryOn' },
  { keywords: ['claude ui', 'arayüz', 'arayuz', 'electron', 'panel', 'wrapper'], topic: 'Claude UI' },
  { keywords: ['expo', 'react native', 'supabase', 'edge function'], topic: 'Mobil Geliştirme' },
  { keywords: ['malware', 'virus', 'temizlik', 'startup', 'registry', 'dism', 'sfc'], topic: 'Sistem Temizliği' },
  { keywords: ['github', 'git', 'repo', 'push', 'commit', 'branch'], topic: 'Git/GitHub' },
  { keywords: ['wsl', 'ubuntu', 'linux'], topic: 'WSL Kurulumu' },
  { keywords: ['force update', 'güncelleme', 'guncelleme', 'versiyon'], topic: 'Uygulama Güncelleme' },
  { keywords: ['app-ads', 'reklam', 'banner', 'interstitial', 'monetiz'], topic: 'Reklam/Monetizasyon' },
  { keywords: ['apple', 'duns', 'ios', 'xcode'], topic: 'Apple/iOS' },
  { keywords: ['gemini', 'api', 'openrouter', 'mistral', 'groq', 'fallback', 'provider'], topic: 'AI Provider' },
];

// Greetings that should be replaced
const GREETING_PATTERNS = /^(merhaba|günaydın|gunaydın|iyi akşamlar|iyi aksamlar|selam|hey|hi|hello|claude|niye çıktın|seni yanlışlıkla|\[request interrupted)/i;

let updated = 0;
let renamed = 0;

files.forEach(filename => {
  const fp = path.join(DIR, filename);
  let content = fs.readFileSync(fp, 'utf-8');
  const currentTitle = content.match(/^# (.+)/m)?.[1] || '';

  // Check if title needs updating
  if (!GREETING_PATTERNS.test(currentTitle.trim()) &&
      !currentTitle.includes('local-command-caveat') &&
      !currentTitle.includes('Implement the following plan')) {
    return; // Title seems fine
  }

  const contentLower = content.toLowerCase();

  // Find topic from content
  let detectedTopic = '';
  let maxScore = 0;

  TOPIC_KEYWORDS.forEach(({ keywords, topic }) => {
    let score = 0;
    keywords.forEach(kw => {
      const regex = new RegExp(kw, 'gi');
      const matches = contentLower.match(regex);
      if (matches) score += matches.length;
    });
    if (score > maxScore) {
      maxScore = score;
      detectedTopic = topic;
    }
  });

  if (!detectedTopic || maxScore < 2) {
    // Try to find topic from first meaningful user message
    const userMessages = content.match(/### Kullanici.*?\n([\s\S]*?)(?=###|$)/g) || [];
    for (const msg of userMessages) {
      const text = msg.replace(/### Kullanici.*?\n/, '').trim();
      if (text.length > 20 && !GREETING_PATTERNS.test(text)) {
        detectedTopic = text.substring(0, 50).replace(/\n/g, ' ').trim();
        break;
      }
    }
  }

  if (!detectedTopic) detectedTopic = 'Genel Sohbet';

  // Extract date from filename
  const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : '';

  // Build new title
  const newTitle = `${detectedTopic} — ${date}`;

  // Update content
  content = content.replace(/^# .+/m, `# ${newTitle}`);
  fs.writeFileSync(fp, content, 'utf-8');

  // Rename file
  const newSlug = detectedTopic.substring(0, 30)
    .replace(/[^a-zA-Z0-9\u00C0-\u024FğüşıöçĞÜŞİÖÇ ]/g, '_')
    .replace(/\s+/g, '_')
    .toLowerCase();
  const newFilename = `${date}_${newSlug}.md`;
  const newFp = path.join(DIR, newFilename);

  if (newFp !== fp && !fs.existsSync(newFp)) {
    fs.renameSync(fp, newFp);
    renamed++;
  } else if (newFp !== fp) {
    // Add index to avoid collision
    let idx = 2;
    let altFp = path.join(DIR, `${date}_${newSlug}_${idx}.md`);
    while (fs.existsSync(altFp)) { idx++; altFp = path.join(DIR, `${date}_${newSlug}_${idx}.md`); }
    fs.renameSync(fp, altFp);
    renamed++;
  }

  updated++;
});

console.log(`Updated: ${updated} titles, Renamed: ${renamed} files`);
