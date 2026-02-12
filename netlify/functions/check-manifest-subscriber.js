// Fonction Netlify pour vérifier si un email est déjà inscrit à Manifest
// et déterminer l'état de son token (valide / expiré / inexistant)
// GET /.netlify/functions/check-manifest-subscriber?email=test@example.com

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
        const email = url.searchParams.get('email');

        if (!email || !email.includes('@')) {
            return new Response(JSON.stringify({ error: 'Email invalide ou manquant' }), {
                status: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                }
            });
        }

        const apiKey = process.env.MAILERLITE_API_KEY;
        if (!apiKey) {
            console.error('MAILERLITE_API_KEY not found');
            return new Response(JSON.stringify({ isExisting: false }), {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                }
            });
        }

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json'
        };

        // ÉTAPE 1: Vérifier si le contact existe dans MailerLite
        let subscriberData = null;

        try {
            const checkResponse = await fetch(`https://connect.mailerlite.com/api/subscribers/${encodeURIComponent(email)}`, {
                method: 'GET',
                headers: headers
            });

            if (!checkResponse.ok) {
                // Contact n'existe pas
                console.log(`ℹ️ Contact n'existe pas: ${email}`);
                return new Response(JSON.stringify({ isExisting: false }), {
                    status: 200,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Content-Type': 'application/json'
                    }
                });
            }

            subscriberData = await checkResponse.json();
            console.log(`✅ Contact trouvé: ${email}`);
        } catch (e) {
            console.error(`❌ Erreur vérification contact: ${e.message}`);
            // En cas d'erreur, on retourne isExisting: false (fallback tunnel classique)
            return new Response(JSON.stringify({ isExisting: false }), {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                }
            });
        }

        // ÉTAPE 2: Récupérer le token unique_token_manifest
        const token = subscriberData.data?.fields?.unique_token_manifest || null;

        if (!token) {
            // Contact existe mais pas de token Manifest (inscrit via un autre funnel)
            console.log(`ℹ️ Contact existe mais pas de token Manifest: ${email}`);
            return new Response(JSON.stringify({ isExisting: false }), {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                }
            });
        }

        console.log(`✅ Token Manifest trouvé pour ${email}: ${token}`);

        // ÉTAPE 3: Vérifier l'état du token dans Netlify Blobs
        try {
            const store = getStore('manifest-places-tokens');
            const tokenDataString = await store.get(token);

            if (!tokenDataString) {
                // Token dans MailerLite mais pas dans Blobs (données purgées ou bug)
                // On traite comme expiré → dernière chance
                console.log(`⚠️ Token dans MailerLite mais pas dans Blobs: ${token}`);
                return new Response(JSON.stringify({
                    isExisting: true,
                    tokenExpired: true
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

            if (now >= expiresAt) {
                // Token expiré (> 7 jours) → dernière chance
                console.log(`⏰ Token expiré pour ${email}: ${token}`);
                return new Response(JSON.stringify({
                    isExisting: true,
                    tokenExpired: true
                }), {
                    status: 200,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Content-Type': 'application/json'
                    }
                });
            }

            // Token encore valide (< 7 jours) → renvoyer vers page de vente avec le token
            console.log(`✅ Token encore valide pour ${email}: ${token}`);
            return new Response(JSON.stringify({
                isExisting: true,
                tokenValid: true,
                token: token
            }), {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                }
            });

        } catch (blobError) {
            console.error(`❌ Erreur Netlify Blobs: ${blobError.message}`);
            // En cas d'erreur Blobs, on traite comme expiré par sécurité
            return new Response(JSON.stringify({
                isExisting: true,
                tokenExpired: true
            }), {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                }
            });
        }

    } catch (error) {
        console.error('❌ Error in check-manifest-subscriber:', error);
        // Erreur globale → fallback tunnel classique
        return new Response(JSON.stringify({ isExisting: false }), {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            }
        });
    }
};
