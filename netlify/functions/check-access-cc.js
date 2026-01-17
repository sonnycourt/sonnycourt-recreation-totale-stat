// Fonction Netlify pour vérifier le token CC et récupérer le temps restant (24h)
// Utilise Supabase pour récupérer les données

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

        // Configuration Supabase
        const supabaseUrl = 'https://grjbxdraobvqkcdjkvhm.supabase.co';
        const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyamJ4ZHJhb2J2cWtjZGprdmhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0OTM0NTAsImV4cCI6MjA4NDA2OTQ1MH0.RqOx2RfaUf4-JqJpol_TW7h6GD4ExIxJB4Q4jBY5XcQ';

        // Récupérer les données du token depuis Supabase
        const response = await fetch(
            `${supabaseUrl}/rest/v1/quiz_responses?token=eq.${encodeURIComponent(token)}&select=completed_at,email,prenom`,
            {
                method: 'GET',
                headers: {
                    'apikey': supabaseAnonKey,
                    'Authorization': `Bearer ${supabaseAnonKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!response.ok) {
            console.error('❌ Error fetching from Supabase:', response.status, response.statusText);
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

        const data = await response.json();

        if (!data || data.length === 0 || !data[0]) {
            console.log('⚠️ Token CC not found in Supabase:', token);
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

        const quizResponse = data[0];
        const completedAt = quizResponse.completed_at;

        if (!completedAt) {
            console.log('⚠️ Token CC found but no completed_at date:', token);
            return new Response(JSON.stringify({ 
                valid: false, 
                error: 'Token invalide (date manquante)' 
            }), {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                }
            });
        }

        // Calculer expiresAt : 120h (5 jours) après completed_at
        // completed_at est au format ISO string, on le convertit en timestamp Unix
        const completedAtTimestamp = Math.floor(new Date(completedAt).getTime() / 1000);
        const expiresAt = completedAtTimestamp + (5 * 24 * 60 * 60); // +120h (5 jours) en secondes

        const now = Math.floor(Date.now() / 1000);

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
            startTime: completedAtTimestamp,
            email: quizResponse.email
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

