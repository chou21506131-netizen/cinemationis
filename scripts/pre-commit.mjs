/**
 * Script pré-commit :
 * 1. Met à jour date_modification sur les fiches animés modifiées (éditorialement)
 * 2. Met à jour les scores MAL (moyenne de toutes les saisons/suites/films)
 * 3. Vérifie les URLs YouTube
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANIMES_DIR = path.join(__dirname, '..', 'src', 'content', 'animes');
const JIKAN_BASE = 'https://api.jikan.moe/v4';
const DELAY = 600;
const MAX_RETRIES = 5;


function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJSON(url, retries = 0) {
  const res = await fetch(url);
  if (res.status === 429) {
    if (retries >= MAX_RETRIES) return null;
    await sleep(2000 + retries * 1000);
    return fetchJSON(url, retries + 1);
  }
  if (!res.ok) return null;
  return res.json();
}

// ── Vérification et correction du mal_id ──

function normalizeTitle(s) {
  return s.toLowerCase()
    .replace(/[!:;,.\-–—'"'"«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titlesMatch(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

async function searchMALByTitle(titre) {
  await sleep(DELAY);
  const query = encodeURIComponent(titre);
  const data = await fetchJSON(`${JIKAN_BASE}/anime?q=${query}&limit=5`);
  if (!data?.data || data.data.length === 0) return null;

  for (const result of data.data) {
    const titles = [result.title, ...(result.titles || []).map(t => t.title)];
    if (titles.some(t => titlesMatch(t, titre))) {
      return result;
    }
  }
  return null;
}

async function verifyOrFixMALId(malId, titre) {
  await sleep(DELAY);
  const data = await fetchJSON(`${JIKAN_BASE}/anime/${malId}`);

  if (data?.data) {
    const malTitle = data.data.title;
    const allTitles = [malTitle, ...(data.data.titles || []).map(t => t.title)];

    if (allTitles.some(t => titlesMatch(t, titre))) {
      return { id: parseInt(malId), changed: false, malTitle };
    }

    console.log(`  ⚠️  ${titre} : l'ID ${malId} correspond à "${malTitle}" sur MAL`);
  } else {
    console.log(`  ⚠️  ${titre} : l'ID ${malId} n'existe pas sur MAL`);
  }

  const found = await searchMALByTitle(titre);
  if (found) {
    console.log(`  🔄 Nouvel ID trouvé : ${found.mal_id} ("${found.title}")`);
    return { id: found.mal_id, changed: true, oldId: parseInt(malId), malTitle: found.title };
  }

  if (data?.data) {
    console.log(`  ℹ️  Recherche infructueuse, ID conservé (vérifier titre_mal)`);
    return { id: parseInt(malId), changed: false, malTitle: data.data.title };
  }

  console.log(`  ❌ Impossible de trouver "${titre}" sur MAL, ID conservé`);
  return { id: parseInt(malId), changed: false, malTitle: '?' };
}

// ── Collecte de toutes les entrées liées (saisons, films, etc.) ──

const FOLLOW_RELATIONS = ['Sequel', 'Prequel'];

async function collectAllMALIds(startId) {
  const visited = new Set();
  const toVisit = [startId];
  const entries = [];

  while (toVisit.length > 0) {
    const id = toVisit.pop();
    if (visited.has(id)) continue;
    visited.add(id);

    await sleep(DELAY);

    const animeData = await fetchJSON(`${JIKAN_BASE}/anime/${id}`);
    if (animeData?.data) {
      const d = animeData.data;
      const validTypes = ['TV', 'Movie', 'OVA', 'ONA', 'Special'];
      if (d.score && d.score > 0 && validTypes.includes(d.type)) {
        entries.push({ mal_id: id, title: d.title, score: d.score, type: d.type });
      }
    }

    await sleep(DELAY);

    const relData = await fetchJSON(`${JIKAN_BASE}/anime/${id}/relations`);
    if (relData?.data) {
      for (const rel of relData.data) {
        if (!FOLLOW_RELATIONS.includes(rel.relation)) continue;
        for (const entry of rel.entry) {
          if (entry.type === 'anime' && !visited.has(entry.mal_id)) {
            toVisit.push(entry.mal_id);
          }
        }
      }
    }
  }

  return entries;
}

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

// ── FIX : Détecte si un fichier a des changements éditoriaux (vs HEAD) ──
// Retourne true si SEULS des champs techniques ont changé → on ne touche pas date_modification

function hasOnlyTechnicalChanges(relPath) {
  try {
    const headContent = execSync(`git show HEAD:"${relPath}"`, { encoding: 'utf-8' });
    const currentContent = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf-8');

    const headParsed = parseFrontmatter(headContent);
    const currentParsed = parseFrontmatter(currentContent);
    if (!headParsed || !currentParsed) return false;

    // Uniquement le corps (résumé + commentaire) déclenche date_modification
    return headParsed.body === currentParsed.body;
  } catch {
    return false;
  }
}

// ── date_modification automatique ──

function updateDateModification() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

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

    // FIX 1 : Ne pas toucher date_modification si seuls des champs techniques ont changé
    // (ex : score_mal, mal_id mis à jour par update-mal.mjs)
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
    if (current === today) continue; // déjà à jour

    const newRaw = setValue(parsed.raw, 'date_modification', today);
    const newContent = `---\n${newRaw}\n---${parsed.body}`;
    fs.writeFileSync(filePath, newContent, 'utf-8');
    updatedFiles.push(relPath);

    const titre = getValue(parsed.raw, 'titre') || path.basename(filePath, '.md');
    console.log(`  📅 ${titre} → ${today}`);
  }

  // FIX 2 : Re-stager UNIQUEMENT les fichiers modifiés par ce script (pas tout le dossier)
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

async function main() {
  // Étape 0 : Mettre à jour date_modification sur les fiches éditorialement modifiées
  updateDateModification();

  // Étape 1 : MAJ des scores MAL + check YouTube

  const files = fs.readdirSync(ANIMES_DIR).filter(f => f.endsWith('.md'));
  console.log(`\n📊 Mise à jour des scores MAL (${files.length} fiches)...\n`);

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
    const titreMal = getValue(parsed.raw, 'titre_mal');
    const titreRecherche = titreMal || titre;
    const malId = getValue(parsed.raw, 'mal_id');

    if (malId) {
      const check = await verifyOrFixMALId(malId, titreRecherche);
      let effectiveId = check.id;

      if (check.changed) {
        newRaw = setValue(newRaw, 'mal_id', check.id);
        changed = true;
      }

      const entries = await collectAllMALIds(effectiveId);

      if (entries.length > 0) {
        const avg = entries.reduce((sum, e) => sum + e.score, 0) / entries.length;
        const rounded = Math.round(avg * 100) / 100;

        const current = getValue(newRaw, 'score_mal');
        const scoreChanged = String(rounded) !== current;

        if (scoreChanged || check.changed) {
          newRaw = setValue(newRaw, 'score_mal', rounded);
          changed = true;
        }

        if (scoreChanged || check.changed) {
          console.log(`  ──── ${titre} ────`);
          if (check.changed) console.log(`    ID : ${check.oldId} → ${check.id}`);
          console.log(`    Note : ${current || '?'} → ${rounded}`);
          console.log(`    Calcul (${entries.length} oeuvres) :`);
          entries.forEach(e => console.log(`      • ${e.title} (${e.type}) : ${e.score}`));
        } else {
          console.log(`  ${titre} : RAS (${rounded})`);
        }
      } else {
        console.log(`  ${titre} : aucun score trouvé sur MAL`);
      }
    } else {
      console.log(`  ❌ ${titre} : pas de mal_id`);
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

    // FIX 3 : Préserver date_modification — ce script ne doit jamais la modifier
    const originalDateMod = getValue(parsed.raw, 'date_modification');
    if (originalDateMod) {
      newRaw = setValue(newRaw, 'date_modification', originalDateMod);
    }

    // FIX 4 : N'écrire sur le disque que si le contenu a réellement changé
    if (changed && newRaw !== parsed.raw) {
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
