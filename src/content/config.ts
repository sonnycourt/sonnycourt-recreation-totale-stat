import { defineCollection, z } from 'astro:content';

const blogCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.date(),
    updatedDate: z.date().optional(),
    heroImage: z.string().optional(),
    category: z.string(),
    tags: z.array(z.string()).optional(),
    author: z.string().default('Sonny Court'),
    featured: z.boolean().default(false),
  }),
});

export const collections = {
  'blog': blogCollection,
};
