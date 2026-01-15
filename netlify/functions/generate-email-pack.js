// Configuration Supabase
const supabaseUrl = 'https://grjbxdraobvqkcdjkvhm.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyamJ4ZHJhb2J2cWtjZGprdmhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0OTM0NTAsImV4cCI6MjA4NDA2OTQ1MH0.RqOx2RfaUf4-JqJpol_TW7h6GD4ExIxJB4Q4jBY5XcQ';

export const handler = async (event) => {
    // Vérifier que c'est une requête POST
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

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

    try {
        // Parser le body de la requête
        const body = JSON.parse(event.body || '{}');
        const { email } = body;

        if (!email) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Email is required' })
            };
        }

        // 1. Récupérer les données du quiz depuis Supabase via API REST
        console.log(`🔍 Recherche des données du quiz pour l'email: ${email}`);
        
        const supabaseResponse = await fetch(
            `${supabaseUrl}/rest/v1/quiz_responses?email=eq.${encodeURIComponent(email)}&select=prenom,objectif,situation,fierte,reve,souffrance`,
            {
                method: 'GET',
                headers: {
                    'apikey': supabaseAnonKey,
                    'Authorization': `Bearer ${supabaseAnonKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!supabaseResponse.ok) {
            const errorText = await supabaseResponse.text();
            console.error('❌ Erreur Supabase:', errorText);
            return {
                statusCode: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ 
                    error: 'Supabase API error',
                    details: errorText 
                })
            };
        }

        const quizDataArray = await supabaseResponse.json();
        
        if (!quizDataArray || quizDataArray.length === 0) {
            console.error('❌ Email non trouvé dans quiz_responses');
            return {
                statusCode: 404,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ 
                    error: 'Email not found in quiz responses'
                })
            };
        }

        const quizData = quizDataArray[0];

        console.log('✅ Données du quiz récupérées:', {
            prenom: quizData.prenom,
            objectif: quizData.objectif,
            situation: quizData.situation
        });

        // 2. Appeler l'API Anthropic
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY_EMAIL_PACK;
        
        if (!anthropicApiKey) {
            console.error('❌ ANTHROPIC_API_KEY_EMAIL_PACK non définie');
            return {
                statusCode: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Anthropic API key not configured' })
            };
        }

        // Préparer le prompt
        const prompt = `Tu es Sonny Court. Tu écris un email personnel et authentique à ${quizData.prenom || 'cette personne'}.

Il y a 3 jours, cette personne a répondu à ton quiz. Voici ses réponses :

- Ce qu'elle veut : ${quizData.objectif || 'Non spécifié'}
- Où elle en est : ${quizData.situation || 'Non spécifié'}
- Ce dont elle est fière : ${quizData.fierte || 'Non spécifié'}
- Son rêve : ${quizData.reve || 'Non spécifié'}
- Ce qui la fait souffrir : ${quizData.souffrance || 'Non spécifié'}

Tu dois écrire un email qui :
1. Montre que tu as VRAIMENT lu ses réponses (cite des éléments spécifiques)
2. Valorise ce qu'elle a accompli (sa fierté)
3. Connecte son rêve à ce qui est possible
4. Adresse sa souffrance avec empathie (sans dramatiser)
5. Présente le Pack Complet (497€) comme LA solution pour elle

Ton style :
- Direct, pas de blabla
- Authentique, comme un message à un ami
- Pas de formules marketing bateau
- Tutoiement
- Court (max 200 mots)

Format de réponse :
SUBJECT: [objet de l'email]
BODY: [corps de l'email]

L'email doit se terminer par un lien vers le Pack Complet : https://sonnycourt.com/pack-complet`;

        console.log('🤖 Appel à l\'API Anthropic...');

        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': anthropicApiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 2000,
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ]
            })
        });

        if (!anthropicResponse.ok) {
            const errorText = await anthropicResponse.text();
            console.error('❌ Erreur API Anthropic:', errorText);
            return {
                statusCode: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ 
                    error: 'Anthropic API error',
                    details: errorText 
                })
            };
        }

        const anthropicData = await anthropicResponse.json();
        console.log('✅ Réponse Anthropic reçue');

        // Extraire le contenu de la réponse
        const content = anthropicData.content?.[0]?.text || '';
        
        // Parser le contenu pour extraire SUBJECT et BODY
        let subject = '';
        let body = '';
        
        // Chercher le format SUBJECT: ... BODY: ...
        const subjectMatch = content.match(/SUBJECT:\s*(.+?)(?:\n|$)/i);
        const bodyMatch = content.match(/BODY:\s*([\s\S]+?)(?:\n\n|$)/i) || content.match(/BODY:\s*([\s\S]+)/i);
        
        if (subjectMatch) {
            subject = subjectMatch[1].trim();
        }
        
        if (bodyMatch) {
            body = bodyMatch[1].trim();
        } else if (!subjectMatch) {
            // Fallback : si le format n'est pas respecté, utiliser tout le contenu comme body
            body = content.trim();
            subject = 'Email personnalisé';
        }
        
        const result = {
            subject: subject || 'Email personnalisé',
            body: body || content.trim()
        };

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error('❌ Erreur dans generate-email-pack:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ 
                error: 'Internal server error',
                details: error.message 
            })
        };
    }
};
