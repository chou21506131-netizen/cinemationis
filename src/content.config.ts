import { defineCollection, z } from 'astro:content';

// Accepte string ou number, convertit en string (pour titres comme "86" ou "31")
const flexString = z.union([z.string(), z.number()]).transform(String);

const animes = defineCollection({
  type: 'content',
  schema: z.object({
    titre: flexString,
    annee: z.number(),
    type: z.string().optional().nullable(),
    saisons: z.number().optional().nullable(),
    episodes: z.number().optional().nullable(),
    films: z.number().optional().nullable(),
    note: flexString,
    recommandation: z.string(),
    statut: z.string().optional().nullable(),
    suite: z.string().optional().nullable(),
    genres: z.array(z.string()).default([]),
    studios: z.array(z.string()).default([]),
    realisateur: z.string().optional().nullable(),
    resume_court: z.string().optional().nullable(),
    image: z.string().optional().nullable(),
    date_ajout: z.coerce.date(),
    videos: z.array(z.string().nullable()).optional().nullable(),
    score_mal: z.number().optional().nullable(),
    mal_id: z.number().optional().nullable(),
  }),
});

const films = defineCollection({
  type: 'content',
  schema: z.object({
    titre: flexString,
    annee: z.number(),
    note: flexString,
    recommandation: z.string(),
    genres: z.array(z.string()).default([]),
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
    tags: z.array(z.string()).default([]),
    date_publication: z.coerce.date().optional().nullable(),
    resume: z.string().optional().nullable(),
    image: z.string().optional().nullable(),
  }),
});

export const collections = { animes, films, articles };
