const fetch = require('node-fetch');
const crypto = require('crypto');

// Configuration Supabase
const supabaseUrl = 'https://grjbxdraobvqkcdjkvhm.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyamJ4ZHJhb2J2cWtjZGprdmhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0OTM0NTAsImV4cCI6MjA4NDA2OTQ1MH0.RqOx2RfaUf4-JqJpol_TW7h6GD4ExIxJB4Q4jBY5XcQ';

const handler = async (event) => {
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
        const requestBody = JSON.parse(event.body || '{}');
        const { email } = requestBody;

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

        // 2. Générer un token unique et le stocker dans Supabase
        const token = crypto.randomUUID();
        console.log('🔑 Token généré:', token);

        // Mettre à jour le token dans Supabase
        const updateResponse = await fetch(
            `${supabaseUrl}/rest/v1/quiz_responses?email=eq.${encodeURIComponent(email)}`,
            {
                method: 'PATCH',
                headers: {
                    'apikey': supabaseAnonKey,
                    'Authorization': `Bearer ${supabaseAnonKey}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({ token: token })
            }
        );

        if (!updateResponse.ok) {
            const errorText = await updateResponse.text();
            console.error('⚠️ Erreur lors de la mise à jour du token:', errorText);
            // On continue quand même, ce n'est pas bloquant
        } else {
            console.log('✅ Token stocké dans Supabase');
        }

        // 3. Appeler l'API Anthropic
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

IMPORTANT : L'email doit TOUJOURS commencer par "Hello ${quizData.prenom || 'cette personne'}," (pas "Salut", pas "Hey", pas autre chose).

Tu dois écrire un email qui suit cette structure :

1. ACCROCHE - Commence par "Depuis que j'ai lu tes réponses, y'a un truc qui me lâche pas..." puis cite un élément spécifique de ses réponses qui t'a marqué.

2. VALORISE CE QU'ELLE A DE SPÉCIAL - Utilise sa fierté comme preuve qu'elle a une capacité rare. "La plupart des gens restent coincés toute leur vie, toi t'as prouvé que..."

3. CONNECTE SON RÊVE - Décris son rêve comme atteignable et légitime. Elle a le droit d'y prétendre.

4. ADRESSE SA SOUFFRANCE - Avec empathie, sans dramatiser. Montre que tu comprends ce qu'elle vit.

5. EXPLIQUE LE VRAI PROBLÈME - Ce qui la bloque c'est pas un manque de volonté. C'est des programmes installés dans son subconscient depuis des années. La reprogrammation du subconscient c'est LA clé de toute transformation durable.

6. PRÉSENTE LE PACK COMPLET - Utilise cette approche :
   - Phrase de transition : "Du coup j'ai réfléchi à ce qui pourrait vraiment t'aider..."
   - Explique que le Pack a été conçu comme un PARCOURS STRATÉGIQUE pour des situations comme la sienne
   - Insiste : ce n'est PAS une compilation de formations jetées en vrac
   - Chaque formation a sa place dans le parcours vers son objectif spécifique
   - Fais le lien entre les formations du Pack et ce qu'elle a partagé dans le quiz
   - Mentionne que l'offre est disponible 48h seulement

7. PS ÉMOTIONNEL - Termine par un PS qui appuie sur SA souffrance spécifique (ce qu'elle a écrit). Connecte ça à l'urgence de décider maintenant. Rédige une phrase unique et personnalisée, pas de formule générique.

Ton style :
- Direct, pas de blabla
- Authentique, comme un message à un ami
- Pas de formules marketing bateau
- Tutoiement
- 300 mots max (sans compter le PS)

Format de réponse :
SUBJECT: [objet de l'email - doit être personnel et intrigant]
BODY: [corps de l'email incluant le PS à la fin]

IMPORTANT - FORMAT HTML POUR LE BODY :
L'email doit être ENTIÈREMENT en HTML, prêt à être injecté dans MailerLite :
- Chaque paragraphe dans des balises <p></p>
- Sauts de ligne avec <br>
- Lien avec <a href="https://sonnycourt.com/pack-complet/?token=${token}" style="color: #f59e0b; text-decoration: none; font-weight: bold;">Cette offre est disponible 48h seulement ici</a>
- Intègre le lien naturellement dans le texte, par exemple : "Cette offre est dispo 48h : <a href="https://sonnycourt.com/pack-complet/?token=${token}">Accéder à mon offre personnalisée</a>"
- Signature en HTML : <p>Je crois en toi,<br>Sonny</p>
- Le body doit être du HTML valide, pas du texte brut ni du markdown`;

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
        console.log('Réponse Anthropic brute:', JSON.stringify(anthropicData, null, 2));

        // Extraire le contenu de la réponse
        const content = anthropicData.content?.[0]?.text || '';
        console.log('Contenu brut extrait:', content);
        
        // Parser le contenu pour extraire SUBJECT et BODY
        let subject = '';
        let body = '';
        
        // Approche basée sur indexOf pour éviter les problèmes de regex
        const subjectIndex = content.indexOf('SUBJECT:');
        const bodyIndex = content.indexOf('BODY:');
        
        if (subjectIndex !== -1 && bodyIndex !== -1) {
            // Extraire le subject entre SUBJECT: et BODY:
            const subjectText = content.substring(subjectIndex + 8, bodyIndex); // 8 = longueur de "SUBJECT:"
            subject = subjectText.trim();
            
            // Extraire tout le texte après BODY:
            const bodyText = content.substring(bodyIndex + 5); // 5 = longueur de "BODY:"
            body = bodyText.trim();
        } else if (subjectIndex !== -1) {
            // Seulement SUBJECT: trouvé
            const subjectText = content.substring(subjectIndex + 8);
            subject = subjectText.trim();
        } else if (bodyIndex !== -1) {
            // Seulement BODY: trouvé
            const bodyText = content.substring(bodyIndex + 5);
            body = bodyText.trim();
        } else {
            // Fallback : si le format n'est pas respecté, utiliser tout le contenu comme body
            body = content.trim();
            subject = 'Email personnalisé';
        }
        
        console.log('Subject extrait:', subject);
        console.log('Body extrait:', body);
        
        const result = {
            subject: subject || 'Email personnalisé',
            body: body || content.trim(),
            token: token
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

module.exports = { handler };
