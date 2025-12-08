// Netlify Function pour afficher les stats de visites
// Accès: GET /api/stats ou GET /.netlify/functions/stats

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
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  };

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Vérifier que Upstash est configuré
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ 
        error: 'Stats not configured',
        setup: 'Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to Netlify env vars'
      }) 
    };
  }

  try {
    // Récupérer tous les totaux
    const totalsResult = await redis('HGETALL', 'cc:visits:total');
    const lastVisitResult = await redis('HGETALL', 'cc:visits:last');
    
    // Parser les résultats (Upstash retourne un array plat [key, value, key, value, ...])
    const totals = {};
    const lastVisits = {};
    
    if (totalsResult.result) {
      const arr = totalsResult.result;
      for (let i = 0; i < arr.length; i += 2) {
        totals[arr[i]] = parseInt(arr[i + 1], 10);
      }
    }
    
    if (lastVisitResult.result) {
      const arr = lastVisitResult.result;
      for (let i = 0; i < arr.length; i += 2) {
        lastVisits[arr[i]] = arr[i + 1];
      }
    }

    // Récupérer les stats des 7 derniers jours
    const dailyStats = {};
    const today = new Date();
    
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayResult = await redis('HGETALL', `cc:visits:${dateStr}`);
      if (dayResult.result && dayResult.result.length > 0) {
        dailyStats[dateStr] = {};
        const arr = dayResult.result;
        for (let j = 0; j < arr.length; j += 2) {
          dailyStats[dateStr][arr[j]] = parseInt(arr[j + 1], 10);
        }
      }
    }

    // Construire la réponse
    const pages = Object.keys(totals).sort();
    const stats = pages.map(page => ({
      page,
      total: totals[page] || 0,
      lastVisit: lastVisits[page] || null,
    }));

    // Calculer le total global
    const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        summary: {
          totalPages: pages.length,
          totalVisits: grandTotal,
          generatedAt: new Date().toISOString(),
        },
        pages: stats,
        daily: dailyStats,
      }, null, 2),
    };
  } catch (error) {
    console.error('Stats error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch stats' }),
    };
  }
};

