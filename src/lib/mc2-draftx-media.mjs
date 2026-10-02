// W14 — vidéos remplacées, pages publiques et manifestes Bunny vérifiés le 02/10/2026.
export const MC2_DRAFTX_LIBRARY_ID = '698588';
export const MC2_DRAFTX_LIVE_VIDEO_ID = '87943222-3a1e-48ec-ab14-8624d76ba5a1';
export const MC2_DRAFTX_REPLAY_VIDEO_ID = 'd9e4743b-e95e-483d-a0db-180b9520acbd';
const CDN = 'https://vz-601d6eb4-a9a.b-cdn.net';
export const MC2_DRAFTX_LIVE_HLS_URL = `${CDN}/${MC2_DRAFTX_LIVE_VIDEO_ID}/playlist.m3u8`;
export const MC2_DRAFTX_REPLAY_HLS_URL = `${CDN}/${MC2_DRAFTX_REPLAY_VIDEO_ID}/playlist.m3u8`;
// Aucun MP4 public disponible sur W14 ; le lecteur utilise son HLS adaptatif.
export const MC2_DRAFTX_REPLAY_MP4_URL = '';
export const MC2_DRAFTX_REPLAY_PATH = '/mc2/draftx/replay/';
export const MC2_DRAFTX_REPLAY_ENTRY = '/.netlify/functions/mc2-replay-enter?variant=draftx&t=';
