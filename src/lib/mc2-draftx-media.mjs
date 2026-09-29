// W14 — pages publiques et manifestes Bunny vérifiés le 29/09/2026.
export const MC2_DRAFTX_LIBRARY_ID = '698588';
export const MC2_DRAFTX_LIVE_VIDEO_ID = '6698c2d5-edc9-4f2a-9eea-e98de9f40a3c';
export const MC2_DRAFTX_REPLAY_VIDEO_ID = 'b8206f43-4b10-4ddc-a4a6-938a3f1ac78c';
const CDN = 'https://vz-601d6eb4-a9a.b-cdn.net';
export const MC2_DRAFTX_LIVE_HLS_URL = `${CDN}/${MC2_DRAFTX_LIVE_VIDEO_ID}/playlist.m3u8`;
export const MC2_DRAFTX_REPLAY_HLS_URL = `${CDN}/${MC2_DRAFTX_REPLAY_VIDEO_ID}/playlist.m3u8`;
// Aucun MP4 public disponible sur W14 ; le lecteur utilise son HLS adaptatif.
export const MC2_DRAFTX_REPLAY_MP4_URL = '';
export const MC2_DRAFTX_REPLAY_PATH = '/mc2/draftx/replay/';
export const MC2_DRAFTX_REPLAY_ENTRY = '/.netlify/functions/mc2-replay-enter?variant=draftx&t=';
