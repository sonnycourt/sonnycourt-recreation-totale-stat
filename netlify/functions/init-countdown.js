// Fonction Netlify pour initialiser le countdown de 7 jours
// Utilise Netlify Blobs pour stocker les données

const { getStore } = require('@netlify/blobs');

exports.handler = async (event, context) => {
    // Gérer les requêtes OPTIONS pour CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: {
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const { token, email } = JSON.parse(event.body);

        if (!token || !email) {
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Token et email requis' })
            };
        }

        // Obtenir le store Netlify Blobs
        // Netlify Blobs est automatiquement disponible dans les fonctions
        const store = getStore({
            name: 'countdown-tokens',
            consistency: 'strong'
        });

        // Calculer les timestamps
        const startTime = Math.floor(Date.now() / 1000); // Timestamp Unix en secondes
        const expiresAt = startTime + (7 * 24 * 60 * 60); // 7 jours en secondes

        // Préparer les données à stocker
        const tokenData = {
            token: token,
            email: email,
            startTime: startTime,
            expiresAt: expiresAt,
            createdAt: new Date().toISOString()
        };

        // Stocker dans Netlify Blobs (la clé est le token)
        await store.set(token, JSON.stringify(tokenData), {
            metadata: {
                email: email,
                expiresAt: expiresAt.toString()
            }
        });

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                token: token,
                startTime: startTime,
                expiresAt: expiresAt
            })
        };

    } catch (error) {
        console.error('Error in init-countdown:', error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'Erreur serveur' })
        };
    }
};
