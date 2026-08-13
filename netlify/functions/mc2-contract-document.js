import {
  loadMc2ContractDocumentByAccessToken,
} from './lib/mc2-contract-documents.mjs';

const SECURITY_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; navigate-to 'self' https://sonnycourt.com mailto:",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

function response(status, body, extraHeaders = {}) {
  return new Response(body, { status, headers: { ...SECURITY_HEADERS, ...extraHeaders } });
}

export default async (req) => {
  if (!['GET', 'HEAD'].includes(req.method)) return response(405, 'Méthode non autorisée.');
  try {
    const url = new URL(req.url);
    const token = String(url.searchParams.get('token') || '').trim();
    const document = await loadMc2ContractDocumentByAccessToken(token);
    if (!document) return response(404, 'Document introuvable.');
    const download = url.searchParams.get('download') === '1';
    const { snapshot, html } = document;
    const headers = { 'Content-Type': 'text/html; charset=utf-8' };
    if (download) {
      const reference = String(snapshot.document_reference || 'confirmation-commande').replace(/[^A-Za-z0-9_-]/g, '');
      headers['Content-Disposition'] = `attachment; filename="${reference}.html"`;
    }
    return response(200, req.method === 'HEAD' ? '' : html, headers);
  } catch (error) {
    console.error('mc2-contract-document:', String(error?.message || 'document_error').slice(0, 160));
    return response(500, 'Document indisponible.');
  }
};
