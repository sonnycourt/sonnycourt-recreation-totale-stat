// Public aliases for the four profile links approved by Sonny.
// Each alias preserves its existing registry code, UTM and attribution history.
export const BIO_LINKS = Object.freeze([
  { path: '/masterclass/ig', code: '80ea24697b45', channel: 'instagram' },
  { path: '/links/tt', legacyPaths: ['/masterclass/tt'], code: 'e7dd5eb52276', channel: 'tiktok', entryPath: '/links/' },
  { path: '/links/yt', legacyPaths: ['/masterclass/yt'], code: 'd70aca695f3c', channel: 'youtube', entryPath: '/links/' },
  { path: '/masterclass/fb', code: '4a25295b1cf0', channel: 'facebook' },
]);
export function bioLinkForPath(path) {
  const normalized = path.replace(/\/$/, '');
  return BIO_LINKS.find(link => link.path === normalized || link.legacyPaths?.includes(normalized));
}
export function bioLinkForCode(code) {
  return BIO_LINKS.find(link => link.code === code);
}
