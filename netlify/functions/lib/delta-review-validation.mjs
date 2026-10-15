export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateDeltaReview(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const text = (key) => typeof input[key] === 'string' ? input[key].trim() : '';
  const firstName = text('firstName');
  const email = text('email').toLowerCase();
  const review = text('review');
  const improvements = text('improvements');
  if (!UUID.test(input.requestId || '') || text('website')) return null;
  if (!firstName || firstName.length > 80 || /[\u0000-\u001f\u007f]/.test(firstName)) return null;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) return null;
  if (!review || review.length > 10000 || improvements.length > 10000) return null;
  if ((input.improvements != null && typeof input.improvements !== 'string') || /\u0000/.test(review + improvements)) return null;
  return {id: input.requestId, first_name: firstName, email, rating: input.rating, review, improvements,
    visibility: 'private', identity_verified: false};
}
export function reviewJson(status, body) {
  return new Response(JSON.stringify(body), {status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff'
  }});
}
