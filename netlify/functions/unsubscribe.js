// Netlify Function pour désinscrire un email de MailerLite
// POST /api/unsubscribe avec { "email": "test@example.com" }
// GET /api/unsubscribe pour debug

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // GET = debug info (pour tester la config)
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'ok',
        mailerlite_configured: !!process.env.MAILERLITE_API_KEY,
      })
    };
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.MAILERLITE_API_KEY;

  console.log('MAILERLITE_API_KEY configured:', !!apiKey);

  if (!apiKey) {
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ 
        error: 'Service non configuré',
        debug: 'Variable MAILERLITE_API_KEY manquante dans Netlify'
      }) 
    };
  }

  try {
    const { email } = JSON.parse(event.body || '{}');
    
    console.log('Unsubscribe request for:', email);
    
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
    }

    // Headers pour l'API MailerLite
    const mailerliteHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // ÉTAPE 1: Récupérer le subscriber_id depuis l'email
    console.log('🔍 Récupération du subscriber depuis MailerLite...');
    const getResponse = await fetch(`https://connect.mailerlite.com/api/subscribers/${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: mailerliteHeaders
    });

    if (!getResponse.ok) {
      if (getResponse.status === 404) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, message: 'Email non trouvé ou déjà désinscrit' }),
        };
      }
      
      const errorText = await getResponse.text();
      console.error('❌ Erreur récupération subscriber:', getResponse.status, errorText);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Erreur MailerLite lors de la récupération',
          status: getResponse.status,
          details: errorText.substring(0, 500)
        }),
      };
    }

    const subscriberData = await getResponse.json();
    const subscriberId = subscriberData.data?.id;

    if (!subscriberId) {
      console.error('❌ Subscriber ID non trouvé dans la réponse');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Impossible de récupérer l\'ID du subscriber' }),
      };
    }

    console.log(`✅ Subscriber trouvé: ${email} (ID: ${subscriberId})`);

    // ÉTAPE 2: Mettre le status à "unsubscribed"
    console.log('📤 Mise à jour du status à "unsubscribed"...');
    const updateResponse = await fetch(`https://connect.mailerlite.com/api/subscribers/${subscriberId}`, {
      method: 'PUT',
      headers: mailerliteHeaders,
      body: JSON.stringify({
        status: 'unsubscribed'
      })
    });

    const responseText = await updateResponse.text();
    console.log('MailerLite response status:', updateResponse.status);
    console.log('MailerLite response body:', responseText);

    if (!updateResponse.ok) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Erreur MailerLite lors de la désinscription',
          status: updateResponse.status,
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
