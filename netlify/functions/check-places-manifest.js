// Fonction Netlify pour vérifier le token et calculer les places restantes
// Utilise Netlify Blobs pour récupérer les données
// Calcule les places avec interpolation linéaire entre paliers

import { getStore } from '@netlify/blobs';

// Tableau de paliers pour le calcul des places
const paliers = [
    { heure: 0, places: 27 },
    { heure: 24, places: 20 },
    { heure: 48, places: 14 },
    { heure: 72, places: 10 },
    { heure: 96, places: 7 },
    { heure: 120, places: 5 },
    { heure: 144, places: 3 },
    { heure: 156, places: 2 },
    { heure: 162, places: 1 },
    { heure: 168, places: 0 }
];

// Fonction pour calculer les places restantes avec interpolation linéaire
function calculatePlacesRemaining(startTime) {
    const now = Math.floor(Date.now() / 1000);
    const elapsedSeconds = now - startTime;
    const elapsedHours = elapsedSeconds / 3600; // Convertir en heures

    // Si plus de 168 heures (7 jours), retourner 0
    if (elapsedHours >= 168) {
        return 0;
    }

    // Trouver les deux paliers qui encadrent l'heure écoulée
    let palierInf = paliers[0];
    let palierSup = paliers[paliers.length - 1];

    for (let i = 0; i < paliers.length - 1; i++) {
        if (elapsedHours >= paliers[i].heure && elapsedHours < paliers[i + 1].heure) {
            palierInf = paliers[i];
            palierSup = paliers[i + 1];
            break;
        }
    }

    // Si on est exactement sur un palier
    if (elapsedHours === palierInf.heure) {
        return palierInf.places;
    }

    // Interpolation linéaire entre les deux paliers
    const deltaHeures = palierSup.heure - palierInf.heure;
    const deltaPlaces = palierSup.places - palierInf.places;
    const progression = (elapsedHours - palierInf.heure) / deltaHeures;
    const placesInterpolees = palierInf.places + (deltaPlaces * progression);

    // Arrondir à l'entier inférieur
    return Math.floor(placesInterpolees);
}

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

        console.log('Checking places for Manifest token:', token);

        // Obtenir le store Netlify Blobs avec le contexte automatique
        const store = getStore('manifest-places-tokens');

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
            console.log('⚠️ Token not found in Blobs:', token);
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
        const startTime = tokenData.startTime;

        // Vérifier si le token a expiré (après 7 jours)
        if (now >= expiresAt) {
            console.log('⏰ Token expired:', token, 'expiresAt:', expiresAt, 'now:', now);
            return new Response(JSON.stringify({ 
                valid: false, 
                error: 'Token expiré',
                expired: true,
                placesRemaining: 0
            }), {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                }
            });
        }

        // Calculer les places restantes avec interpolation linéaire
        const placesRemaining = calculatePlacesRemaining(startTime);
        const timeRemaining = expiresAt - now;

        console.log('✅ Token valid, places remaining:', placesRemaining, 'time remaining:', timeRemaining, 'seconds');

        return new Response(JSON.stringify({
            valid: true,
            placesRemaining: placesRemaining,
            timeRemaining: timeRemaining,
            expiresAt: expiresAt,
            startTime: startTime,
            email: tokenData.email,
            initialPlaces: tokenData.initialPlaces || 27
        }), {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            }
        });

    } catch (error) {
        console.error('❌ Error in check-places-manifest:', error);
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

