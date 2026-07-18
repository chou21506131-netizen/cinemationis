/**
 * Script pré-commit :
 * 1. Met à jour date_modification sur les fiches animés modifiées (éditorialement)
 * 2. Vérifie les URLs YouTube dans les fiches animés
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANIMES_DIR = path.join(__dirname, '..', 'src', 'content', 'animes');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Frontmatter helpers ──

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

// ── Détection des changements éditoriaux ──

/**
 * Retourne true si le corps du fichier (résumé/commentaire) n'a PAS changé.
 * Dans ce cas, date_modification ne doit pas être mise à jour.
 */
function hasOnlyTechnicalChanges(relPath) {
  try {
    const headContent = execSync(`git show HEAD:"${relPath}"`, { encoding: 'utf-8' });
    const currentContent = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf-8');

    const headParsed = parseFrontmatter(headContent);
    const currentParsed = parseFrontmatter(currentContent);
    if (!headParsed || !currentParsed) return false;

    // Normaliser les fins de ligne (CRLF → LF sur Windows)
    const headBody = headParsed.body.replace(/\r\n/g, '\n');
    const currentBody = currentParsed.body.replace(/\r\n/g, '\n');

    return headBody === currentBody;
  } catch {
    return false;
  }
}

// ── Mise à jour automatique de date_modification ──

function updateDateModification() {
  const today = new Date().toISOString().slice(0, 10);

  let staged;
  try {
    staged = execSync('git diff --cached --name-only -- src/content/animes/', { encoding: 'utf-8' })
      .trim().split('\n').filter(Boolean);
  } catch { return []; }

  if (staged.length === 0) return [];

  console.log(`📅 Mise à jour de date_modification (${staged.length} fiche(s) stagée(s))...\n`);
  const updatedFiles = [];

  for (const relPath of staged) {
    const filePath = path.join(__dirname, '..', relPath);
    if (!fs.existsSync(filePath)) continue;

    if (hasOnlyTechnicalChanges(relPath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseFrontmatter(content);
      const titre = parsed ? getValue(parsed.raw, 'titre') : path.basename(relPath, '.md');
      console.log(`  ⏭️  ${titre} : uniquement des champs techniques, date_modification ignorée`);
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseFrontmatter(content);
    if (!parsed) continue;

    const current = getValue(parsed.raw, 'date_modification');
    if (current === today) continue;

    const newRaw = setValue(parsed.raw, 'date_modification', today);
    const newContent = `---\n${newRaw}\n---${parsed.body}`;
    fs.writeFileSync(filePath, newContent, 'utf-8');
    updatedFiles.push(relPath);

    const titre = getValue(parsed.raw, 'titre') || path.basename(filePath, '.md');
    console.log(`  📅 ${titre} → ${today}`);
  }

  if (updatedFiles.length > 0) {
    for (const relPath of updatedFiles) {
      try {
        execSync(`git add -- "${relPath}"`, { cwd: path.join(__dirname, '..') });
      } catch {}
    }
    console.log(`\n✅ ${updatedFiles.length} date(s) de modification mise(s) à jour\n`);
  }

  return updatedFiles;
}

// ── Main ──

async function main() {
  // Étape 1 : Mettre à jour date_modification sur les fiches éditorialement modifiées
  updateDateModification();

  // Étape 2 : Vérifier les URLs YouTube
  const files = fs.readdirSync(ANIMES_DIR).filter(f => f.endsWith('.md'));
  console.log(`\n🎬 Vérification des vidéos YouTube (${files.length} fiches)...\n`);

  const brokenVideos = [];

  for (const file of files) {
    const filePath = path.join(ANIMES_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseFrontmatter(content);
    if (!parsed) continue;

    const videoMatch = parsed.raw.match(/^videos:\s*\n((?:\s+-\s*.+\n?)*)/m);
    if (videoMatch) {
      const urls = videoMatch[1].split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
      for (const url of urls) {
        const broken = await checkYouTubeUrl(url);
        if (broken) brokenVideos.push({ file, ...broken });
      }
    }
  }

  if (brokenVideos.length > 0) {
    console.log(`⚠️  ${brokenVideos.length} vidéo(s) YouTube indisponible(s) :`);
    brokenVideos.forEach(v => console.log(`  ❌ ${v.file} → ${v.url}`));
  } else {
    console.log('✅ Toutes les vidéos YouTube sont accessibles');
  }
}

main().catch(err => {
  console.error('Erreur pre-commit:', err.message);
  process.exit(0);
});
