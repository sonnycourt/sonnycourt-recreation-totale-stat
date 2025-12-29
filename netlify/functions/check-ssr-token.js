// Fonction Netlify pour vérifier si un email existe dans le groupe SSR
// et récupérer son unique_token_ssr
// GET /.netlify/functions/check-ssr-token?email=test@example.com

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

    // Vérifier que c'est une requête GET
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        // Récupérer l'email depuis les query parameters
        const email = event.queryStringParameters?.email;

        if (!email || !email.includes('@')) {
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({ error: 'Email invalide ou manquant' })
            };
        }

        // Récupérer l'API key depuis les variables d'environnement
        const apiKey = process.env.MAILERLITE_API_KEY;
        
        if (!apiKey) {
            console.error('MAILERLITE_API_KEY not found in environment variables');
            return {
                statusCode: 500,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({ error: 'Configuration serveur manquante' })
            };
        }

        // Récupérer le Group ID SSR depuis les variables d'environnement
        const ssrGroupId = process.env.MAILERLITE_GROUP_SSR_2026_EVERGREEN;
        
        if (!ssrGroupId) {
            console.error('MAILERLITE_GROUP_SSR_2026_EVERGREEN not found in environment variables');
            return {
                statusCode: 500,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({ error: 'Configuration groupe SSR manquante' })
            };
        }

        // Headers pour les appels API MailerLite
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json'
        };

        // ÉTAPE 1: Vérifier si le contact existe dans MailerLite
        let subscriberData = null;
        let subscriberId = null;

        try {
            const checkResponse = await fetch(`https://connect.mailerlite.com/api/subscribers/${encodeURIComponent(email)}`, {
                method: 'GET',
                headers: headers
            });

            if (checkResponse.ok) {
                subscriberData = await checkResponse.json();
                subscriberId = subscriberData.data?.id;
                console.log(`✅ Contact trouvé: ${email} (ID: ${subscriberId})`);
            } else {
                // Contact n'existe pas
                return {
                    statusCode: 200,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                    },
                    body: JSON.stringify({
                        exists: false,
                        inGroup: false,
                        token: null
                    })
                };
            }
        } catch (e) {
            console.log(`ℹ️ Erreur lors de la vérification du contact: ${e.message}`);
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    exists: false,
                    inGroup: false,
                    token: null
                })
            };
        }

        // ÉTAPE 2: Récupérer le token unique_token_ssr depuis les champs personnalisés
        const uniqueTokenSSR = subscriberData.data?.fields?.unique_token_ssr || null;

        // Si le token existe, c'est que le contact a déjà été inscrit via SSR
        // On retourne le token pour qu'il soit réutilisé
        if (uniqueTokenSSR) {
            console.log(`✅ Token SSR trouvé pour ${email}: ${uniqueTokenSSR}`);
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    exists: true,
                    hasToken: true,
                    token: uniqueTokenSSR
                })
            };
        }

        // Contact existe mais pas de token SSR (inscrit via un autre funnel)
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
                exists: true,
                hasToken: false,
                token: null
            })
        };

    } catch (error) {
        console.error('Error in check-ssr-token function:', error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({ 
                error: 'Erreur serveur',
                details: error.message 
            })
        };
    }
};

