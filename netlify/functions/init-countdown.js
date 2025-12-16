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

        console.log('Initializing countdown for token:', token, 'email:', email);

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
        try {
            await store.set(token, JSON.stringify(tokenData), {
                metadata: {
                    email: email,
                    expiresAt: expiresAt.toString()
                }
            });
            console.log('✅ Token stored successfully in Blobs:', token);
        } catch (storeError) {
            console.error('❌ Error storing token in Blobs:', storeError);
            console.error('Store error details:', {
                message: storeError.message,
                stack: storeError.stack,
                name: storeError.name
            });
            throw storeError;
        }

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
        console.error('❌ Error in init-countdown:', error);
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
                error: 'Erreur serveur',
                details: process.env.NETLIFY_DEV ? error.message : undefined
            })
        };
    }
};
