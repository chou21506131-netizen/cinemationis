/**
 * Script pré-commit :
 * 1. Met à jour les scores MAL via l'API Jikan
 * 2. Vérifie les URLs YouTube
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANIMES_DIR = path.join(__dirname, '..', 'src', 'content', 'animes');
const JIKAN_BASE = 'https://api.jikan.moe/v4';
const DELAY = 400;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJSON(url) {
  const res = await fetch(url);
  if (res.status === 429) {
    console.log('  ⏳ Rate limit, attente 2s...');
    await sleep(2000);
    return fetchJSON(url);
  }
  if (!res.ok) return null;
  return res.json();
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  return { raw: match[1], body: content.slice(match[0].length) };
}

function getValue(raw, key) {
  const m = raw.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  if (!m) return null;
  const val = m[1].trim();
  return (val === '' || val === 'null' || val === '~') ? null : val.replace(/^["']|["']$/g, '');
}

function setValue(raw, key, value) {
  const regex = new RegExp(`^(${key}:)\\s*.*$`, 'm');
  return regex.test(raw) ? raw.replace(regex, `$1 ${value}`) : raw + `\n${key}: ${value}`;
}

// ── YouTube check ──

async function checkYouTubeUrl(url) {
  if (!url || !url.includes('youtu')) return null;
  try {
    let videoId = url.includes('v=') ? url.split('v=')[1]?.split('&')[0]
      : url.includes('youtu.be/') ? url.split('youtu.be/')[1]?.split('?')[0]
      : null;
    if (!videoId) return null;
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (res.status === 404 || res.status === 401) return { url, videoId, status: 'indisponible' };
    return null;
  } catch { return null; }
}

// ── Main ──

async function main() {
  const files = fs.readdirSync(ANIMES_DIR).filter(f => f.endsWith('.md'));
  console.log(`📊 Mise à jour des scores MAL (${files.length} fiches)...`);

  let updated = 0;
  const brokenVideos = [];

  for (const file of files) {
    const filePath = path.join(ANIMES_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseFrontmatter(content);
    if (!parsed) continue;

    let newRaw = parsed.raw;
    let changed = false;
    const titre = getValue(parsed.raw, 'titre') || file;
    const malId = getValue(parsed.raw, 'mal_id');

    // ── Score MAL ──
    if (malId) {
      await sleep(DELAY);
      const data = await fetchJSON(`${JIKAN_BASE}/anime/${malId}`);
      const score = data?.data?.score;
      if (score) {
        const current = getValue(newRaw, 'score_mal');
        if (String(score) !== current) {
          newRaw = setValue(newRaw, 'score_mal', score);
          console.log(`  📝 ${titre} : ${current || '?'} → ${score}`);
          changed = true;
        }
      }
    }

    // ── YouTube ──
    const videoMatch = parsed.raw.match(/^videos:\s*\n((?:\s+-\s*.+\n?)*)/m);
    if (videoMatch) {
      const urls = videoMatch[1].split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
      for (const url of urls) {
        const broken = await checkYouTubeUrl(url);
        if (broken) brokenVideos.push({ file, ...broken });
      }
    }

    if (changed) {
      const newContent = `---\n${newRaw}\n---${parsed.body}`;
      fs.writeFileSync(filePath, newContent, 'utf-8');
      updated++;
    }
  }

  console.log(`\n✅ ${updated} score(s) MAL mis à jour`);
  if (brokenVideos.length > 0) {
    console.log(`⚠️  ${brokenVideos.length} vidéo(s) YouTube indisponible(s) :`);
    brokenVideos.forEach(v => console.log(`  ❌ ${v.file} → ${v.url}`));
  } else {
    console.log('🎬 Toutes les vidéos YouTube sont accessibles');
  }
}

main().catch(err => {
  console.error('Erreur pre-commit:', err.message);
  process.exit(0);
});
