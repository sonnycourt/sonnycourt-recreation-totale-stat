// W13B — isolated from the currently published MC2 Session/Replay sources.
// Public Bunny pages and HLS manifests verified on 2026-09-14.
export const MC2_DRAFTX_LIBRARY_ID = '698588';
export const MC2_DRAFTX_LIVE_VIDEO_ID = 'c0135d6e-9cfe-4605-a90b-b2ea2d7d7961';
export const MC2_DRAFTX_REPLAY_VIDEO_ID = 'e538dedd-26e0-4b69-9900-13a7ec8a37f8';
const CDN = 'https://vz-601d6eb4-a9a.b-cdn.net';
export const MC2_DRAFTX_LIVE_HLS_URL = `${CDN}/${MC2_DRAFTX_LIVE_VIDEO_ID}/playlist.m3u8`;
export const MC2_DRAFTX_REPLAY_HLS_URL = `${CDN}/${MC2_DRAFTX_REPLAY_VIDEO_ID}/playlist.m3u8`;
export const MC2_DRAFTX_REPLAY_MP4_URL = `${CDN}/${MC2_DRAFTX_REPLAY_VIDEO_ID}/play_720p.mp4`;
export const MC2_DRAFTX_REPLAY_PATH = '/mc2/draftx/replay/';
export const MC2_DRAFTX_REPLAY_ENTRY = '/.netlify/functions/mc2-replay-enter?variant=draftx&t=';
