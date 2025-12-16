// Fonction Netlify pour initialiser le countdown de 7 jours
// Utilise Netlify Blobs pour stocker les données

import { getStore } from '@netlify/blobs';

export default async (req, context) => {
    // Gérer les requêtes OPTIONS pour CORS
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            }
        });
    }

    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            }
        });
    }

    try {
        const { token, email } = await req.json();

        if (!token || !email) {
            return new Response(JSON.stringify({ error: 'Token et email requis' }), {
                status: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                }
            });
        }

        console.log('Initializing countdown for token:', token, 'email:', email);

        // Obtenir le store Netlify Blobs avec le contexte automatique
        const store = getStore('countdown-tokens');

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

        return new Response(JSON.stringify({
            success: true,
            token: token,
            startTime: startTime,
            expiresAt: expiresAt
        }), {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            }
        });

    } catch (error) {
        console.error('❌ Error in init-countdown:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        return new Response(JSON.stringify({ 
            error: 'Erreur serveur',
            details: process.env.NETLIFY_DEV ? error.message : undefined
        }), {
            status: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            }
        });
    }
};
