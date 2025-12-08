// Netlify Function pour désinscrire un email de Listmonk
// POST /api/unsubscribe avec { "email": "test@example.com" }

const LISTMONK_URL = process.env.LISTMONK_URL || 'http://168.119.238.147:9000';
const LISTMONK_USER = process.env.LISTMONK_USER;
const LISTMONK_PASS = process.env.LISTMONK_PASS;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!LISTMONK_USER || !LISTMONK_PASS) {
    console.error('Listmonk credentials not configured');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Service not configured' }) };
  }

  try {
    const { email } = JSON.parse(event.body || '{}');
    
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
    }

    // Appel API Listmonk pour supprimer l'abonné
    const auth = Buffer.from(`${LISTMONK_USER}:${LISTMONK_PASS}`).toString('base64');
    
    const response = await fetch(`${LISTMONK_URL}/api/subscribers/query/delete`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `subscribers.email = '${email.replace(/'/g, "''")}'`
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Listmonk error:', response.status, errorText);
      
      // Si 404 ou pas trouvé, on considère que c'est OK (déjà désinscrit)
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
        body: JSON.stringify({ error: 'Erreur lors de la désinscription' }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Désinscription réussie' }),
    };

  } catch (error) {
    console.error('Unsubscribe error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur serveur' }),
    };
  }
};

