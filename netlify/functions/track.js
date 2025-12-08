// Netlify Function pour tracker les visites des pages /cc/
// Utilise Upstash Redis (gratuit) pour stocker les compteurs

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(command, ...args) {
  const response = await fetch(`${UPSTASH_URL}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([command, ...args]),
  });
  return response.json();
}

exports.handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Vérifier que Upstash est configuré
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    console.error('Upstash not configured');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Tracking not configured' }) };
  }

  try {
    const { page } = JSON.parse(event.body || '{}');
    
    if (!page || !page.startsWith('/cc/')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid page' }) };
    }

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Incrémenter le compteur total pour cette page
    await redis('HINCRBY', 'cc:visits:total', page, 1);
    
    // Incrémenter le compteur du jour
    await redis('HINCRBY', `cc:visits:${today}`, page, 1);
    
    // Garder trace de la dernière visite
    await redis('HSET', 'cc:visits:last', page, today);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error('Track error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Tracking failed' }),
    };
  }
};

