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
        const prompt = `Tu es Sonny Court. Écris un email personnel à ${quizData.prenom || 'cette personne'}.

Voici ses réponses au quiz :
- Objectif : ${quizData.objectif || 'Non spécifié'}
- Situation : ${quizData.situation || 'Non spécifié'}
- Fierté : ${quizData.fierte || 'Non spécifié'}
- Rêve : ${quizData.reve || 'Non spécifié'}
- Souffrance : ${quizData.souffrance || 'Non spécifié'}

AVANT TOUT : Si les réponses sont du charabia, des mots random, ou clairement pas sérieuses → retourne uniquement : SKIP
Si les réponses sont courtes mais cohérentes → c'est OK, génère l'email.

OBJECTIF DE L'EMAIL :
Que la personne se dise en lisant : 'Putain, il me parle à MOI. Il m'a comprise. Et il a la solution.'

Chaque phrase doit servir l'un de ces trois piliers :
1. CONNEXION → Elle se sent vue et comprise (utilise SES mots, SES détails)
2. ESPOIR → Le changement est possible pour elle spécifiquement
3. URGENCE → Chaque jour sans action renforce ses blocages

Si une phrase ne sert aucun de ces piliers, supprime-la.

MÉCANISMES À SUIVRE (dans cet ordre) :
1. Accroche → quelque chose de spécifique dans ses réponses qui t'a marqué
2. Valorise sa fierté → montre que c'est rare/courageux
3. Connecte à son rêve → c'est légitime, atteignable
4. Empathie sur sa souffrance → tu comprends, c'est dur
5. Le vrai problème → programmes subconscients, pas un défaut personnel
6. Transition naturelle → 'Du coup j'ai réfléchi à ce qui pourrait vraiment t'aider...'
7. Pack Complet = parcours stratégique, pas une compilation en vrac
8. Lien vers l'offre
9. Signature
10. PS qui crée l'urgence en reprenant un élément de sa souffrance

IMPORTANT - POSITIONNEMENT DU PACK :

Le Pack Complet est une méthode de REPROGRAMMATION DU SUBCONSCIENT.
Ce n'est PAS une formation spécialisée sur l'objectif de la personne (pas une formation business, pas une formation séduction, pas une formation confiance).

Le principe :
- Le MÉCANISME est toujours le même : reprogrammer le subconscient
- L'OBJECTIF de la personne est le RÉSULTAT que ce mécanisme permet d'atteindre

Donc : "Reprogrammer ce qui te bloque pour [son objectif]"
Jamais : "T'apprendre comment [son objectif]"

L'objectif n'est pas enseigné, il est débloqué.

ÉLÉMENTS OBLIGATOIRES :
- Commencer par 'Hello ${quizData.prenom || 'cette personne'},'
- Signature exacte : 'Je crois en toi,<br>Sonny'
- Lien : <a href='https://sonnycourt.com/pack-complet/?token=${token}' style='color: #4D97FE; text-decoration: underline;'>Cette offre est disponible 48h seulement ici</a>
- Format HTML avec <p> pour chaque paragraphe
- PS à la fin
- Pas d'emoji dans le subject ni dans le body
- Dire 'cette offre' (pas 'l'offre') pour renforcer le côté unique

LANGAGE :
- Pas de langage vulgaire (pas de "putain", "couilles", "merde", etc.)
- Ton direct mais respectueux

RÉDUCTION :
- Mentionner "-70%" mais PAS les prix exacts
- Ne pas écrire "497€ au lieu de 1682€"
- Juste dire "cette offre à -70%" ou "avec 70% de réduction"

URGENCE 48H - JUSTIFIER NATURELLEMENT :
- Ne pas juste dire "disponible 48h"
- Expliquer pourquoi : "Je te laisse 48h pour y réfléchir, pas plus - parce que dans mon expérience, au-delà de ce délai, on remet à plus tard et plus tard devient jamais."
- Ou : "48h, c'est le temps que je te donne pour décider. Assez pour réfléchir, pas assez pour procrastiner."
- L'IA peut varier la formulation mais doit toujours justifier le délai

LIBERTÉ TOTALE SUR :
- Les formulations exactes
- Le style d'accroche (varie à chaque fois)
- Le ton (adapte-le à ce que la personne a écrit)
- La longueur des paragraphes

NE JAMAIS utiliser deux fois la même accroche ou la même structure de phrase. Sois créatif, authentique, comme si tu écrivais vraiment à cette personne.

Format de réponse :
SUBJECT: [objet de l'email - doit être personnel et intrigant]
BODY: [corps de l'email incluant le PS à la fin]`;

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
        
        // Vérifier si Claude a décidé de SKIP
        if (content.trim() === 'SKIP' || content.trim().startsWith('SKIP')) {
            console.log('⚠️ Réponses jugées inexploitables par Claude');
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ 
                    skipped: true, 
                    reason: 'invalid_responses' 
                })
            };
        }
        
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
