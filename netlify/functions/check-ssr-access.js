// Fonction Netlify pour vérifier le token SSR et récupérer le temps restant + places
// GET /.netlify/functions/check-ssr-access?token=xxx
// Utilise Netlify Blobs pour récupérer les données

import { getStore } from '@netlify/blobs';

// ============================================
// PALIERS PHASE 1 : 80 places → 0 en 7 jours (168 heures)
// 300 places totales - 220 vendues = 80 disponibles (73.3% vendues)
// ============================================
const PHASE1_PALIERS = [
    { heure: 0, places: 80 },      // J0 0h - Inscription
    { heure: 4, places: 72 },      // J0 4h
    { heure: 8, places: 65 },      // J0 8h
    { heure: 14, places: 56 },     // J0 14h
    { heure: 20, places: 47 },     // J0 20h
    { heure: 28, places: 39 },     // J1 4h
    { heure: 36, places: 33 },     // J1 12h
    { heure: 44, places: 27 },     // J1 20h
    { heure: 56, places: 23 },     // J2 8h
    { heure: 66, places: 20 },     // J2 18h
    { heure: 82, places: 17 },     // J3 10h
    { heure: 94, places: 15 },     // J3 22h - Zone haute conversion
    { heure: 106, places: 14 },    // J4 10h
    { heure: 118, places: 12 },    // J4 22h
    { heure: 128, places: 11 },    // J5 8h
    { heure: 136, places: 9 },     // J5 16h
    { heure: 143, places: 8 },     // J5 23h
    { heure: 154, places: 6 },     // J6 10h
    { heure: 162, places: 5 },     // J6 18h
    { heure: 174, places: 3 },     // J7 6h - Dernières places
    { heure: 182, places: 2 },     // J7 14h - DERNIÈRE PLACE
    { heure: 188, places: 0 },     // J7 20h - SOLD OUT → Phase 2
];

// ============================================
// PALIERS PHASE 2 : 200 places → 0 en 9 jours (216 heures)
// Commence à l'heure 192 (J8 0h, 24h après sold out)
// Total : 500 places (300 Phase 1 + 200 Phase 2)
// ============================================
const PHASE2_START_HOUR = 188; // Immédiatement après Phase 1 (pas de pause)
const PHASE2_PALIERS = [
    { heure: 0, places: 200 },     // J8 0h - Réouverture
    { heure: 6, places: 176 },     // J8 6h
    { heure: 12, places: 150 },    // J8 12h
    { heure: 20, places: 124 },    // J8 20h
    { heure: 32, places: 104 },    // J9 8h
    { heure: 42, places: 88 },     // J9 18h
    { heure: 58, places: 74 },     // J10 10h
    { heure: 70, places: 62 },     // J10 22h
    { heure: 84, places: 52 },     // J11 12h
    { heure: 95, places: 44 },     // J11 23h
    { heure: 108, places: 36 },    // J12 12h
    { heure: 119, places: 30 },    // J12 23h
    { heure: 132, places: 24 },    // J13 12h
    { heure: 142, places: 20 },    // J13 22h - Zone haute conversion
    { heure: 152, places: 18 },    // J14 8h
    { heure: 160, places: 16 },    // J14 16h
    { heure: 167, places: 14 },    // J14 23h
    { heure: 176, places: 12 },    // J15 8h
    { heure: 182, places: 10 },    // J15 14h
    { heure: 188, places: 8 },     // J15 20h
    { heure: 198, places: 6 },     // J16 6h - Dernier jour
    { heure: 204, places: 4 },     // J16 12h
    { heure: 210, places: 2 },     // J16 18h - DERNIÈRE PLACE
    { heure: 216, places: 0 },     // J16 23h59 - FERMETURE DÉFINITIVE
];

// Durée totale du countdown initial (16j 4h 30min en secondes)
const TOTAL_COUNTDOWN_SECONDS = (16 * 24 * 60 * 60); // 16 jours exactement

// Fonction pour obtenir les places selon le palier
function getPlacesFromPaliers(heuresEcoulees, paliers) {
    let places = paliers[0].places;
    for (const palier of paliers) {
        if (heuresEcoulees >= palier.heure) {
            places = palier.places;
        } else {
            break;
        }
    }
    return places;
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

        console.log('Checking SSR access for token:', token);

        // Obtenir le store Netlify Blobs
        const store = getStore('ssr-countdown-places-tokens');

        // Récupérer les données du token
        const tokenDataRaw = await store.get(token);

        if (!tokenDataRaw) {
            console.log('❌ Token non trouvé:', token);
            return new Response(JSON.stringify({
                valid: false,
                error: 'Token invalide ou non trouvé'
            }), {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                }
            });
        }

        const tokenData = JSON.parse(tokenDataRaw);
        const now = Math.floor(Date.now() / 1000);
        const startTime = tokenData.startTime;
        
        // Calculer le temps écoulé en secondes et en heures
        const secondsElapsed = now - startTime;
        const hoursElapsed = secondsElapsed / 3600;
        
        // Calculer le temps restant du countdown global
        const timeRemaining = Math.max(0, TOTAL_COUNTDOWN_SECONDS - secondsElapsed);
        
        // Déterminer la phase et les places
        let phase = 1;
        let places = 0;
        let isSoldOut = false;
        let isReopened = false;
        let isExpired = false;

        if (hoursElapsed < PHASE2_START_HOUR) {
            // Phase 1 : 0h → 192h
            phase = 1;
            places = getPlacesFromPaliers(hoursElapsed, PHASE1_PALIERS);
            
            // Vérifier si on est en sold out (entre fin phase 1 et début phase 2)
            if (places === 0 && hoursElapsed < PHASE2_START_HOUR) {
                isSoldOut = true;
            }
        } else {
            // Phase 2 : 192h → fin
            phase = 2;
            isReopened = true;
            const phase2Hours = hoursElapsed - PHASE2_START_HOUR;
            places = getPlacesFromPaliers(phase2Hours, PHASE2_PALIERS);
            
            // Vérifier si complètement expiré
            if (places === 0 && timeRemaining <= 0) {
                isExpired = true;
            }
        }

        console.log(`✅ Token valide: ${token}, Phase: ${phase}, Places: ${places}, Heures écoulées: ${hoursElapsed.toFixed(2)}`);

        return new Response(JSON.stringify({
            valid: true,
            token: token,
            phase: phase,
            places: places,
            timeRemaining: timeRemaining,
            hoursElapsed: Math.floor(hoursElapsed),
            isSoldOut: isSoldOut,
            isReopened: isReopened,
            isExpired: isExpired,
            startTime: startTime
        }), {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            }
        });

    } catch (error) {
        console.error('❌ Error in check-ssr-access:', error);
        return new Response(JSON.stringify({ 
            valid: false,
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

