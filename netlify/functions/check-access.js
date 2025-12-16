// Fonction Netlify pour vérifier le token et récupérer le temps restant
// Utilise Netlify Blobs pour récupérer les données

const { getStore } = require('@netlify/blobs');

exports.handler = async (event, context) => {
    // Gérer les requêtes OPTIONS pour CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, OPTIONS'
            },
            body: ''
        };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: {
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const token = event.queryStringParameters?.token;

        if (!token) {
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ 
                    valid: false, 
                    error: 'Token manquant' 
                })
            };
        }

        // Obtenir le store Netlify Blobs
        // Netlify Blobs est automatiquement disponible dans les fonctions
        const store = getStore({
            name: 'countdown-tokens',
            consistency: 'strong'
        });

        // Récupérer les données du token depuis Netlify Blobs
        const tokenDataString = await store.get(token);

        if (!tokenDataString) {
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    valid: false, 
                    error: 'Token invalide' 
                })
            };
        }

        const tokenData = JSON.parse(tokenDataString);
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = tokenData.expiresAt;

        // Vérifier si le token a expiré
        if (now >= expiresAt) {
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    valid: false, 
                    error: 'Token expiré',
                    expired: true
                })
            };
        }

        // Calculer le temps restant en secondes
        const timeRemaining = expiresAt - now;

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                valid: true,
                timeRemaining: timeRemaining,
                expiresAt: expiresAt,
                startTime: tokenData.startTime,
                email: tokenData.email
            })
        };

    } catch (error) {
        console.error('Error in check-access:', error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ 
                valid: false, 
                error: 'Erreur serveur' 
            })
        };
    }
};
