// W14 — pages publiques et manifestes Bunny vérifiés le 27/09/2026.
export const MC2_DRAFTX_LIBRARY_ID = '698588';
export const MC2_DRAFTX_LIVE_VIDEO_ID = '9565de4f-915e-47b5-a1c5-01d1bbab0aba';
export const MC2_DRAFTX_REPLAY_VIDEO_ID = 'd76c8290-cb8d-4edb-9902-c0d48ab4d78b';
const CDN = 'https://vz-601d6eb4-a9a.b-cdn.net';
export const MC2_DRAFTX_LIVE_HLS_URL = `${CDN}/${MC2_DRAFTX_LIVE_VIDEO_ID}/playlist.m3u8`;
export const MC2_DRAFTX_REPLAY_HLS_URL = `${CDN}/${MC2_DRAFTX_REPLAY_VIDEO_ID}/playlist.m3u8`;
// Aucun MP4 public disponible sur W14 ; le lecteur utilise son HLS adaptatif.
export const MC2_DRAFTX_REPLAY_MP4_URL = '';
export const MC2_DRAFTX_REPLAY_PATH = '/mc2/draftx/replay/';
export const MC2_DRAFTX_REPLAY_ENTRY = '/.netlify/functions/mc2-replay-enter?variant=draftx&t=';
