import { deliverTrackingMeta } from './lib/mc2-tracking-meta-worker.mjs';
import { scheduledJson } from './lib/scheduled-response.mjs';
export default async (_req, runtime) => {
  try { return scheduledJson(await deliverTrackingMeta({ deployContext: runtime?.deploy?.context || process.env.CONTEXT })); }
  catch { return scheduledJson({ error: 'tracking_delivery_unavailable' }, 503); }
};
