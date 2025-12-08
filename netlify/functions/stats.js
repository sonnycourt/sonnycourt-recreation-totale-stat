// Netlify Function pour afficher les stats de visites ET envois
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

function parseHashResult(result) {
  const obj = {};
  if (result && result.result) {
    const arr = result.result;
    for (let i = 0; i < arr.length; i += 2) {
      obj[arr[i]] = arr[i + 1];
    }
  }
  return obj;
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  };

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

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
    // ===== CLICKS DATA =====
    const clickTotalsResult = await redis('HGETALL', 'cc:visits:total');
    const clickLastResult = await redis('HGETALL', 'cc:visits:last');
    
    const clickTotals = {};
    const clickLast = {};
    
    if (clickTotalsResult.result) {
      const arr = clickTotalsResult.result;
      for (let i = 0; i < arr.length; i += 2) {
        clickTotals[arr[i]] = parseInt(arr[i + 1], 10);
      }
    }
    
    if (clickLastResult.result) {
      const arr = clickLastResult.result;
      for (let i = 0; i < arr.length; i += 2) {
        clickLast[arr[i]] = arr[i + 1];
      }
    }

    // Daily clicks (last 365 days for charts)
    const dailyClicks = {};
    const today = new Date();
    
    for (let i = 0; i < 365; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayResult = await redis('HGETALL', `cc:visits:${dateStr}`);
      if (dayResult.result && dayResult.result.length > 0) {
        dailyClicks[dateStr] = {};
        const arr = dayResult.result;
        for (let j = 0; j < arr.length; j += 2) {
          dailyClicks[dateStr][arr[j]] = parseInt(arr[j + 1], 10);
        }
      }
    }

    // ===== SENDS DATA =====
    const sendTotalsResult = await redis('HGETALL', 'cc:sends:total');
    const sendLastResult = await redis('HGETALL', 'cc:sends:last');
    
    const sendTotals = {};
    const sendLast = {};
    
    if (sendTotalsResult.result) {
      const arr = sendTotalsResult.result;
      for (let i = 0; i < arr.length; i += 2) {
        sendTotals[arr[i]] = parseInt(arr[i + 1], 10);
      }
    }
    
    if (sendLastResult.result) {
      const arr = sendLastResult.result;
      for (let i = 0; i < arr.length; i += 2) {
        sendLast[arr[i]] = arr[i + 1];
      }
    }

    // ===== BUILD RESPONSE =====
    const pages = Object.keys(clickTotals).sort();
    const pageStats = pages.map(page => ({
      page,
      clicks: clickTotals[page] || 0,
      lastClick: clickLast[page] || null,
    }));

    const templates = Object.keys(sendTotals).sort();
    const sendStats = templates.map(template => ({
      template,
      sends: sendTotals[template] || 0,
      lastSend: sendLast[template] || null,
    }));

    const totalClicks = Object.values(clickTotals).reduce((a, b) => a + b, 0);
    const totalSends = Object.values(sendTotals).reduce((a, b) => a + b, 0);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        summary: {
          totalPages: pages.length,
          totalVisits: totalClicks,
          totalTemplates: templates.length,
          totalSends: totalSends,
          generatedAt: new Date().toISOString(),
        },
        pages: pageStats,
        sends: sendStats,
        daily: dailyClicks,
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
