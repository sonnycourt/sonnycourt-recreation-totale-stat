// Netlify Function pour désinscrire un email de Listmonk
// POST /api/unsubscribe avec { "email": "test@example.com" }
// GET /api/unsubscribe pour debug

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  const LISTMONK_URL = process.env.LISTMONK_URL || 'https://mail.sonnycourt.com';
  const LISTMONK_USER = process.env.LISTMONK_USER;
  const LISTMONK_PASS = process.env.LISTMONK_PASS;

  // GET = debug info (pour tester la config)
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'ok',
        listmonk_url: LISTMONK_URL,
        user_configured: !!LISTMONK_USER,
        pass_configured: !!LISTMONK_PASS,
      })
    };
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  console.log('LISTMONK_URL:', LISTMONK_URL);
  console.log('LISTMONK_USER configured:', !!LISTMONK_USER);
  console.log('LISTMONK_PASS configured:', !!LISTMONK_PASS);

  if (!LISTMONK_USER || !LISTMONK_PASS) {
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ 
        error: 'Service non configuré',
        debug: 'Variables LISTMONK_USER et/ou LISTMONK_PASS manquantes dans Netlify'
      }) 
    };
  }

  try {
    const { email } = JSON.parse(event.body || '{}');
    
    console.log('Unsubscribe request for:', email);
    
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
    }

    const auth = Buffer.from(`${LISTMONK_USER}:${LISTMONK_PASS}`).toString('base64');
    const apiUrl = `${LISTMONK_URL}/api/subscribers/query/delete`;
    
    console.log('Calling Listmonk API:', apiUrl);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `subscribers.email = '${email.replace(/'/g, "''")}'`
      }),
    });

    const responseText = await response.text();
    console.log('Listmonk response status:', response.status);
    console.log('Listmonk response body:', responseText);

    if (!response.ok) {
      if (response.status === 404) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, message: 'Email non trouvé ou déjà désinscrit' }),
        };
      }
      
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Erreur Listmonk',
          status: response.status,
          details: responseText.substring(0, 500)
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Désinscription réussie' }),
    };

  } catch (error) {
    console.error('Unsubscribe error:', error.message, error.stack);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Erreur serveur',
        details: error.message
      }),
    };
  }
};
