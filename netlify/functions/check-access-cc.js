// Fonction Netlify pour vérifier le token CC et récupérer le temps restant (24h)
// Utilise Netlify Blobs pour récupérer les données

import { getStore } from '@netlify/blobs';

export default async (req, context) => {
    // Gérer les requêtes OPTIONS pour CORS
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, OPTIONS'
            }
        });
    }

    if (req.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            }
        });
    }

    try {
        const url = new URL(req.url);
        const token = url.searchParams.get('token');

        if (!token) {
            return new Response(JSON.stringify({ 
                valid: false, 
                error: 'Token manquant' 
            }), {
                status: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                }
            });
        }

        console.log('Checking access CC for token:', token);

        // Obtenir le store Netlify Blobs avec le contexte automatique
        const store = getStore('countdown-tokens-cc');

        // Récupérer les données du token depuis Netlify Blobs
        let tokenDataString;
        try {
            tokenDataString = await store.get(token);
            console.log('Token CC lookup result for', token, ':', tokenDataString ? 'Found' : 'Not found');
        } catch (getError) {
            console.error('❌ Error getting token CC from Blobs:', getError);
            console.error('Get error details:', {
                message: getError.message,
                stack: getError.stack,
                name: getError.name
            });
            return new Response(JSON.stringify({ 
                valid: false, 
                error: 'Erreur lors de la récupération du token' 
            }), {
                status: 500,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                }
            });
        }

        if (!tokenDataString) {
            console.log('⚠️ Token CC not found in Blobs:', token);
            return new Response(JSON.stringify({ 
                valid: false, 
                error: 'Token invalide' 
            }), {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                }
            });
        }

        const tokenData = JSON.parse(tokenDataString);
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = tokenData.expiresAt;

        // Vérifier si le token a expiré
        if (now >= expiresAt) {
            console.log('⏰ Token CC expired:', token, 'expiresAt:', expiresAt, 'now:', now);
            return new Response(JSON.stringify({ 
                valid: false, 
                error: 'Token expiré',
                expired: true
            }), {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                }
            });
        }

        // Calculer le temps restant en secondes
        const timeRemaining = expiresAt - now;
        console.log('✅ Token CC valid, time remaining:', timeRemaining, 'seconds');

        return new Response(JSON.stringify({
            valid: true,
            timeRemaining: timeRemaining,
            expiresAt: expiresAt,
            startTime: tokenData.startTime,
            email: tokenData.email
        }), {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            }
        });

    } catch (error) {
        console.error('❌ Error in check-access-cc:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        return new Response(JSON.stringify({ 
            valid: false, 
            error: 'Erreur serveur' 
        }), {
            status: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            }
        });
    }
};

