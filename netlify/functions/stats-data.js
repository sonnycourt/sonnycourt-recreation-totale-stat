// Netlify Function pour gérer les données stats (views-history, subscribers-monthly-history, etc.)
// Protège les entrées créées par les cron jobs contre les écrasements manuels

import { getStore } from '@netlify/blobs';
import { safeUpdateHistory } from './protect-cron-data.js';

const STORE_NAME = 'stats-data';
const VIEWS_HISTORY_KEY = 'views-history';
const SUBSCRIBERS_MONTHLY_HISTORY_KEY = 'subscribers-monthly-history';

export default async (req) => {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
    };

    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders });
    }

    try {
        const store = getStore({
            name: STORE_NAME,
            consistency: 'strong',
        });

        const url = new URL(req.url);
        const type = url.searchParams.get('type') || 'views-history'; // 'views-history' ou 'subscribers-monthly-history'

        let dataKey;
        if (type === 'subscribers-monthly-history') {
            dataKey = SUBSCRIBERS_MONTHLY_HISTORY_KEY;
        } else {
            dataKey = VIEWS_HISTORY_KEY;
        }

        // GET - Récupérer les données
        if (req.method === 'GET') {
            try {
                const data = await store.get(dataKey);
                if (data) {
                    return new Response(data, {
                        status: 200,
                        headers: corsHeaders,
                    });
                }
                return new Response(JSON.stringify([]), {
                    status: 200,
                    headers: corsHeaders,
                });
            } catch (error) {
                console.error(`Error reading ${type} from Blobs:`, error);
                return new Response(JSON.stringify([]), {
                    status: 200,
                    headers: corsHeaders,
                });
            }
        }

        // POST/PUT - Sauvegarder les données (avec protection des entrées cron)
        if (req.method === 'POST' || req.method === 'PUT') {
            const newData = await req.json();

            // Charger l'historique existant
            let existingHistory = {};
            try {
                const existingData = await store.get(dataKey);
                if (existingData) {
                    existingHistory = JSON.parse(existingData);
                }
            } catch (error) {
                console.log(`No existing ${type} found, starting fresh`);
            }

            // Si c'est un tableau (format array), convertir en objet avec dates en clés
            let historyObject = {};
            if (Array.isArray(newData)) {
                // Convertir le tableau en objet avec dates en clés
                for (const entry of newData) {
                    const dateKey = entry.date || entry.month || new Date().toISOString().split('T')[0];
                    historyObject[dateKey] = entry;
                }
            } else if (typeof newData === 'object') {
                // Si c'est déjà un objet, l'utiliser directement
                historyObject = newData;
            } else {
                return new Response(JSON.stringify({ error: 'Invalid data format' }), {
                    status: 400,
                    headers: corsHeaders,
                });
            }

            // Protéger les entrées du cron lors des sauvegardes manuelles
            // isCronJob = false car c'est une sauvegarde manuelle
            let protectedHistory = { ...existingHistory };
            for (const [dateKey, entryData] of Object.entries(historyObject)) {
                protectedHistory = safeUpdateHistory(protectedHistory, dateKey, entryData, false);
            }

            // Sauvegarder l'historique protégé
            await store.set(dataKey, JSON.stringify(protectedHistory), {
                metadata: {
                    updatedAt: new Date().toISOString(),
                    type: type,
                },
            });

            return new Response(JSON.stringify({ 
                success: true,
                message: 'Data saved (cron-protected entries preserved)'
            }), {
                status: 200,
                headers: corsHeaders,
            });
        }

        return new Response(JSON.stringify({ error: 'Méthode non autorisée' }), {
            status: 405,
            headers: corsHeaders,
        });

    } catch (error) {
        console.error('Error in stats-data function:', error);
        return new Response(JSON.stringify({
            error: error.message || 'Erreur serveur',
            details: process.env.NETLIFY_DEV ? error.stack : undefined,
        }), {
            status: 500,
            headers: corsHeaders,
        });
    }
};

