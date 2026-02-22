import type { APIRoute } from 'astro';
import { promo } from '../../config/promo';

export const GET: APIRoute = () => {
  return new Response(JSON.stringify(promo), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://systemeviral.com',
      'Cache-Control': 'public, max-age=60',
    },
  });
};
