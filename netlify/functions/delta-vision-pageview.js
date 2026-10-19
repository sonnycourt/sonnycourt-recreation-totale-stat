import { makePageviewHandler } from './lib/delta-pageviews.mjs';
export default makePageviewHandler();
// Platform-level abuse protection; no IP is written to the audience dataset.
export const config = { rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
