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

        console.log('Checking access for token:', token);

        // Obtenir le store Netlify Blobs avec le contexte explicite
        // Récupérer le siteID depuis le contexte ou les headers
        const siteID = context.site?.id || 
                      process.env.NETLIFY_SITE_ID || 
                      event.headers['x-nf-site-id'] ||
                      event.headers['x-nf-account-id'];
        
        // Récupérer le token depuis les variables d'environnement ou le contexte
        const blobsToken = process.env.NETLIFY_BLOBS_TOKEN || 
                          context.netlify?.blobs?.token ||
                          event.headers['x-nf-blobs-token'];

        if (!siteID || !blobsToken) {
            console.error('Missing Blobs configuration:', {
                hasSiteID: !!siteID,
                hasToken: !!blobsToken,
                contextSiteId: context.site?.id,
                envSiteId: process.env.NETLIFY_SITE_ID,
                headerSiteId: event.headers['x-nf-site-id'],
                envToken: !!process.env.NETLIFY_BLOBS_TOKEN
            });
            return {
                statusCode: 500,
                headers: {
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ 
                    valid: false,
                    error: 'Configuration Netlify Blobs manquante',
                    details: 'siteID ou token non disponible'
                })
            };
        }

        // Créer le store avec le contexte explicite
        const store = getStore({
            name: 'countdown-tokens',
            siteID: siteID,
            token: blobsToken
        });

        // Récupérer les données du token depuis Netlify Blobs
        let tokenDataString;
        try {
            tokenDataString = await store.get(token);
            console.log('Token lookup result for', token, ':', tokenDataString ? 'Found' : 'Not found');
        } catch (getError) {
            console.error('❌ Error getting token from Blobs:', getError);
            console.error('Get error details:', {
                message: getError.message,
                stack: getError.stack,
                name: getError.name
            });
            return {
                statusCode: 500,
                headers: {
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ 
                    valid: false, 
                    error: 'Erreur lors de la récupération du token' 
                })
            };
        }

        if (!tokenDataString) {
            console.log('⚠️ Token not found in Blobs:', token);
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
            console.log('⏰ Token expired:', token, 'expiresAt:', expiresAt, 'now:', now);
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
        console.log('✅ Token valid, time remaining:', timeRemaining, 'seconds');

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
        console.error('❌ Error in check-access:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
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
