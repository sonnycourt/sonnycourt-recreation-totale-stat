// Fonction Netlify pour mettre à jour le téléphone d'un subscriber Listmonk
// Variables d'environnement requises: LISTMONK_API_URL, LISTMONK_USERNAME, LISTMONK_PASSWORD

exports.handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { email, phone } = JSON.parse(event.body);

    if (!email || !phone) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: 'Email et téléphone requis' }) 
      };
    }

    const LISTMONK_URL = process.env.LISTMONK_API_URL || 'https://mail.sonnycourt.com';
    const LISTMONK_USER = process.env.LISTMONK_USERNAME;
    const LISTMONK_PASS = process.env.LISTMONK_PASSWORD;

    if (!LISTMONK_USER || !LISTMONK_PASS) {
      console.error('Credentials Listmonk manquantes');
      return { 
        statusCode: 500, 
        headers, 
        body: JSON.stringify({ error: 'Configuration serveur manquante' }) 
      };
    }

    const authHeader = 'Basic ' + Buffer.from(`${LISTMONK_USER}:${LISTMONK_PASS}`).toString('base64');

    // 1. Chercher le subscriber par email
    const searchResponse = await fetch(
      `${LISTMONK_URL}/api/subscribers?query=subscribers.email='${encodeURIComponent(email)}'`,
      {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!searchResponse.ok) {
      console.error('Erreur recherche subscriber:', await searchResponse.text());
      return { 
        statusCode: 500, 
        headers, 
        body: JSON.stringify({ error: 'Erreur recherche subscriber' }) 
      };
    }

    const searchData = await searchResponse.json();
    
    if (!searchData.data || !searchData.data.results || searchData.data.results.length === 0) {
      console.log('Subscriber non trouvé:', email);
      return { 
        statusCode: 404, 
        headers, 
        body: JSON.stringify({ error: 'Subscriber non trouvé' }) 
      };
    }

    const subscriber = searchData.data.results[0];
    const subscriberId = subscriber.id;

    // 2. Mettre à jour les attributs du subscriber
    const currentAttribs = subscriber.attribs || {};
    const updatedAttribs = { ...currentAttribs, phone: phone };

    const updateResponse = await fetch(
      `${LISTMONK_URL}/api/subscribers/${subscriberId}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: subscriber.email,
          name: subscriber.name,
          status: subscriber.status,
          attribs: updatedAttribs
        })
      }
    );

    if (!updateResponse.ok) {
      console.error('Erreur mise à jour subscriber:', await updateResponse.text());
      return { 
        statusCode: 500, 
        headers, 
        body: JSON.stringify({ error: 'Erreur mise à jour subscriber' }) 
      };
    }

    console.log(`Subscriber ${email} mis à jour avec téléphone: ${phone}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true, 
        message: 'Téléphone mis à jour',
        email: email,
        phone: phone
      })
    };

  } catch (error) {
    console.error('Erreur:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur serveur', details: error.message })
    };
  }
};
