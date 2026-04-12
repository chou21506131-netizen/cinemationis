import { defineCollection, z } from 'astro:content';

// Accepte string ou number, convertit en string (pour titres comme "86" ou "31")
const flexString = z.union([z.string(), z.number()]).transform(String);

// String ou number nullable → string avec fallback
const optionalNote = z.union([z.string(), z.number(), z.null()])
  .optional()
  .transform(val => (val == null || val === '') ? '?/20' : String(val));

// String nullable avec fallback vide
const optionalString = z.string().nullable().optional().transform(val => val ?? '');

// Array nullable avec fallback []
const optionalStringArray = z.array(z.string()).nullable().optional().transform(val => val ?? []);

const animes = defineCollection({
  type: 'content',
  schema: z.object({
    titre: flexString,
    annee: z.number(),
    type: z.string().optional().nullable(),
    saisons: z.number().optional().nullable(),
    episodes: z.number().optional().nullable(),
    films: z.number().optional().nullable(),
    note: optionalNote,
    recommandation: optionalString,
    statut: z.string().optional().nullable(),
    suite: z.string().optional().nullable(),
    genres: optionalStringArray,
    studios: optionalStringArray,
    realisateur: z.string().optional().nullable(),
    resume_court: z.string().optional().nullable(),
    image: z.string().optional().nullable(),
    date_ajout: z.coerce.date(),
    date_modification: z.coerce.date().optional().nullable(),
    videos: z.array(z.string().nullable()).optional().nullable(),
    score_mal: z.number().optional().nullable(),
    mal_id: z.number().optional().nullable(),
    raquequit: z.string().optional().nullable(),
  }),
});

const films = defineCollection({
  type: 'content',
  schema: z.object({
    titre: flexString,
    annee: z.number(),
    note: optionalNote,
    recommandation: optionalString,
    genres: optionalStringArray,
    realisateur: z.string().optional().nullable(),
    resume_court: z.string().optional().nullable(),
    image: z.string().optional().nullable(),
    date_ajout: z.coerce.date(),
    bande_annonce: z.string().optional().nullable(),
    score_alo: z.number().optional().nullable(),
  }),
});

const articles = defineCollection({
  type: 'content',
  schema: z.object({
    titre: z.string(),
    tags: optionalStringArray,
    date_publication: z.coerce.date().optional().nullable(),
    resume: z.string().optional().nullable(),
    image: z.string().optional().nullable(),
  }),
});

// Dossier Obsidian ignoré par Astro (collection vide pour éviter le warning)
const modelesPersos = defineCollection({
  type: 'content',
  schema: z.object({}).passthrough(),
});

export const collections = { animes, films, articles, 'Modèles persos': modelesPersos };
