import { pruneMetaAttribution } from './lib/delta-meta-attribution.mjs';
export default async function handler() {
  await pruneMetaAttribution();
  return new Response(null, { status: 204 });
}
export const config = { schedule: '41 3 * * *' };
