/**
 * Script pré-build : met à jour les données MAL (MyAnimeList) via l'API Jikan.
 * - Si mal_id est absent, cherche l'anime par titre
 * - Met à jour : score_mal, mal_id
 * - Remplit les champs vides : image, realisateur, episodes, saisons, studios
 *
 * Usage : node scripts/update-mal.mjs
 * Intégré au build via package.json "prebuild"
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANIMES_DIR = path.join(__dirname, '..', 'src', 'content', 'animes');
const JIKAN_BASE = 'https://api.jikan.moe/v4';
const DELAY = 400; // ms entre requêtes (rate limit Jikan : 3/s)

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  return { raw: match[1], body: content.slice(match[0].length) };
}

function getFrontmatterValue(raw, key) {
  const regex = new RegExp(`^${key}:\\s*(.*)$`, 'm');
  const match = raw.match(regex);
  if (!match) return null;
  const val = match[1].trim();
  if (val === '' || val === 'null' || val === '~') return null;
  return val.replace(/^["']|["']$/g, '');
}

function setFrontmatterValue(raw, key, value) {
  const regex = new RegExp(`^(${key}:)\\s*.*$`, 'm');
  // Formater la valeur : les strings avec des caractères spéciaux sont entre guillemets
  const formatted = typeof value === 'string' && /[:#\[\]{},&*?|>!%@`]/.test(value)
    ? `"${value}"`
    : value;
  if (regex.test(raw)) {
    return raw.replace(regex, `$1 ${formatted}`);
  }
  return raw + `\n${key}: ${formatted}`;
}

function getFrontmatterArray(raw, key) {
  const regex = new RegExp(`^${key}:\\s*\\n((?:  - .+\\n?)*)`, 'm');
  const match = raw.match(regex);
  if (!match) return [];
  return match[1].split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
}

function isEmpty(val) {
  return !val || val === '' || val === 'null' || val === '~';
}

async function searchAnime(titre) {
  const data = await fetchJSON(`${JIKAN_BASE}/anime?q=${encodeURIComponent(titre)}&limit=5`);
  if (!data?.data?.length) return null;

  const lower = titre.toLowerCase();
  // Chercher correspondance exacte d'abord
  for (const anime of data.data) {
    const titles = [
      anime.title?.toLowerCase(),
      anime.title_english?.toLowerCase(),
      ...(anime.titles || []).map(t => t.title?.toLowerCase()),
    ].filter(Boolean);
    if (titles.some(t => t === lower)) return anime;
  }
  // Correspondance partielle
  for (const anime of data.data) {
    const titles = [
      anime.title?.toLowerCase(),
      anime.title_english?.toLowerCase(),
      ...(anime.titles || []).map(t => t.title?.toLowerCase()),
    ].filter(Boolean);
    if (titles.some(t => t.includes(lower) || lower.includes(t))) return anime;
  }
  // Fallback premier résultat
  return data.data[0];
}

async function getAnimeDetails(malId) {
  const data = await fetchJSON(`${JIKAN_BASE}/anime/${malId}/full`);
  return data?.data || null;
}

async function main() {
  const files = fs.readdirSync(ANIMES_DIR).filter(f => f.endsWith('.md'));
  console.log(`📊 MAL Update : ${files.length} fiches à traiter`);

  let updated = 0;
  let errors = 0;

  for (const file of files) {
    const filePath = path.join(ANIMES_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseFrontmatter(content);
    if (!parsed) continue;

    const titre = getFrontmatterValue(parsed.raw, 'titre') || '';
    let malId = getFrontmatterValue(parsed.raw, 'mal_id');
    let newRaw = parsed.raw;
    let changed = false;
    let animeData = null;

    // Si pas de mal_id, chercher via le titre
    if (isEmpty(malId)) {
      console.log(`🔍 Recherche MAL pour "${titre}"...`);
      await sleep(DELAY);
      const result = await searchAnime(titre);
      if (result) {
        malId = String(result.mal_id);
        newRaw = setFrontmatterValue(newRaw, 'mal_id', result.mal_id);
        changed = true;
        animeData = result;
        console.log(`  ✅ Trouvé : MAL #${malId}`);
      } else {
        console.log(`  ❌ Non trouvé sur MAL`);
        errors++;
        continue;
      }
    }

    // Récupérer les détails complets si on a un mal_id
    if (!animeData) {
      await sleep(DELAY);
      animeData = await getAnimeDetails(parseInt(malId));
    }

    if (!animeData) {
      console.log(`  ⚠️ ${titre} : impossible de récupérer les détails MAL`);
      if (changed) {
        const newContent = `---\n${newRaw}\n---${parsed.body}`;
        fs.writeFileSync(filePath, newContent, 'utf-8');
        updated++;
      }
      continue;
    }

    // Mettre à jour score_mal
    if (animeData.score) {
      const current = getFrontmatterValue(parsed.raw, 'score_mal');
      if (String(animeData.score) !== current) {
        newRaw = setFrontmatterValue(newRaw, 'score_mal', animeData.score);
        changed = true;
      }
    }

    // Remplir image si vide
    if (isEmpty(getFrontmatterValue(newRaw, 'image'))) {
      const img = animeData.images?.jpg?.large_image_url || animeData.images?.jpg?.image_url;
      if (img) {
        newRaw = setFrontmatterValue(newRaw, 'image', img);
        changed = true;
        console.log(`  🖼️ ${titre} : image ajoutée`);
      }
    }

    // Remplir realisateur si vide
    if (isEmpty(getFrontmatterValue(newRaw, 'realisateur'))) {
      // Chercher le réalisateur dans les staff (pas dans /full, on prend le Director)
      const directors = (animeData.studios || []).length > 0 ? null : null; // placeholder
      // L'API full ne donne pas le staff directement, on essaie avec /staff
      await sleep(DELAY);
      const staffData = await fetchJSON(`${JIKAN_BASE}/anime/${malId}/staff`);
      if (staffData?.data) {
        const director = staffData.data.find(s =>
          s.positions?.some(p => p.toLowerCase().includes('director'))
        );
        if (director?.person?.name) {
          // Jikan renvoie "Nom, Prénom" → on inverse
          const parts = director.person.name.split(', ');
          const name = parts.length === 2 ? `${parts[1]} ${parts[0]}` : director.person.name;
          newRaw = setFrontmatterValue(newRaw, 'realisateur', name);
          changed = true;
          console.log(`  🎬 ${titre} : réalisateur → ${name}`);
        }
      }
    }

    // Remplir episodes si vide
    if (isEmpty(getFrontmatterValue(newRaw, 'episodes')) && animeData.episodes) {
      newRaw = setFrontmatterValue(newRaw, 'episodes', animeData.episodes);
      changed = true;
    }

    // Remplir studios si vide
    const currentStudios = getFrontmatterArray(newRaw, 'studios');
    if (currentStudios.length === 0 && animeData.studios?.length > 0) {
      const studioNames = animeData.studios.map(s => s.name);
      // Remplacer la ligne studios vide
      const studioYaml = 'studios:\n' + studioNames.map(s => `  - ${s}`).join('\n');
      newRaw = newRaw.replace(/^studios:\s*\n(  - \s*\n)?/m, studioYaml + '\n');
      changed = true;
      console.log(`  🏢 ${titre} : studios → ${studioNames.join(', ')}`);
    }

    // Remplir genres si vide
    const currentGenres = getFrontmatterArray(newRaw, 'genres');
    if (currentGenres.length === 0 && (animeData.genres?.length > 0 || animeData.themes?.length > 0)) {
      const genreNames = [
        ...(animeData.genres || []).map(g => g.name),
        ...(animeData.themes || []).map(t => t.name),
      ];
      const genreYaml = 'genres:\n' + genreNames.map(g => `  - ${g}`).join('\n');
      newRaw = newRaw.replace(/^genres:\s*\n(  - \s*\n)?/m, genreYaml + '\n');
      changed = true;
    }

    if (changed) {
      const newContent = `---\n${newRaw}\n---${parsed.body}`;
      fs.writeFileSync(filePath, newContent, 'utf-8');
      updated++;
      console.log(`  📝 ${titre} : fiche mise à jour`);
    }
  }

  console.log(`\n✅ Terminé : ${updated} fiches mises à jour, ${errors} non trouvées`);
}

main().catch(err => {
  console.error('❌ Erreur script MAL:', err.message);
  // Ne pas faire échouer le build
  process.exit(0);
});
