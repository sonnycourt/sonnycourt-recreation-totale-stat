import { prunePageviews } from './lib/delta-pageviews.mjs';
export default async function handler() {
  await prunePageviews();
  return new Response(null, { status: 204 });
}
export const config = { schedule: '29 3 * * *' };
