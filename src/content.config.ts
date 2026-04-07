import { defineCollection, z } from 'astro:content';

const animes = defineCollection({
  type: 'content',
  schema: z.object({
    titre: z.string(),
    annee: z.number(),
    type: z.string().optional(),
    saisons: z.number().optional().nullable(),
    episodes: z.number().optional().nullable(),
    films: z.number().optional().nullable(),
    note: z.string(), // "17/20"
    recommandation: z.string(),
    statut: z.string().optional(),
    suite: z.string().optional().nullable(),
    genres: z.array(z.string()).default([]),
    studios: z.array(z.string()).default([]),
    realisateur: z.string().optional().nullable(),
    resume_court: z.string().optional(),
    image: z.string().optional(),
    date_ajout: z.coerce.date(),
    videos: z.array(z.string().nullable()).optional(),
    score_mal: z.number().optional().nullable(),
    mal_id: z.number().optional().nullable(),
  }),
});

const films = defineCollection({
  type: 'content',
  schema: z.object({
    titre: z.string(),
    annee: z.number(),
    note: z.string(), // "10/20"
    recommandation: z.string(),
    genres: z.array(z.string()).default([]),
    realisateur: z.string().optional().nullable(),
    resume_court: z.string().optional(),
    image: z.string().optional(),
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
    date_publication: z.coerce.date().optional(),
    resume: z.string().optional(),
    image: z.string().optional(),
  }),
});

export const collections = { animes, films, articles };
