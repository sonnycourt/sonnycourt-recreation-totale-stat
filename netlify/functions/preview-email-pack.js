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
        // PARSER LE BODY ET EXTRAIRE L'EMAIL
        const requestBody = JSON.parse(event.body || '{}');
        
        // Récupérer le paramètre model (query string ou body, défaut: 'sonnet')
        const model = event.queryStringParameters?.model || requestBody.model || 'sonnet';
        
        // Récupérer le paramètre type (initial, 24h, 4h)
        const emailType = requestBody.type || 'initial';
        
        // Extraire l'email
        const email = requestBody.email;

        if (!email) {
            console.error('❌ Email non trouvé dans la requête');
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Email is required' })
            };
        }
        
        console.log('✅ Email reçu:', email);
        console.log('🤖 Modèle LLM sélectionné:', model);
        console.log('📧 Type d\'email:', emailType);

        // Récupérer les données du quiz depuis Supabase via API REST
        console.log(`🔍 Recherche des données du quiz pour l'email: ${email}`);
        
        const supabaseResponse = await fetch(
            `${supabaseUrl}/rest/v1/quiz_responses?email=eq.${encodeURIComponent(email)}&select=prenom,objectif,situation,fierte,reve,souffrance,token`,
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
        const token = quizData.token || crypto.randomUUID();

        console.log('✅ Données du quiz récupérées:', {
            prenom: quizData.prenom,
            objectif: quizData.objectif,
            situation: quizData.situation
        });

        // Appeler l'API LLM (Claude ou DeepSeek selon le paramètre model)
        // Préparer le prompt selon le type d'email
        let prompt = '';
        
        if (emailType === 'initial') {
            // Prompt actuel - premier contact, présentation du Pack Complet
            prompt = `Tu es Sonny Court. Écris un email personnel à ${quizData.prenom || 'cette personne'}.

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

FORMATAGE HTML DE L'EMAIL :
- Taille de police : 16px minimum pour le body
- Interligne : line-height 1.7 pour une lecture agréable
- Espacement : marge entre chaque paragraphe (margin-bottom: 16px sur les <p>)
- Mots/phrases clés en <strong> pour attirer l'œil (2-3 par email max, pas plus)
- Lien CTA bien visible : couleur #4D97FE, souligné
- Signature avec espacement au-dessus

Structure HTML :
<div style="font-family: Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #333;">
  <p style="margin-bottom: 16px;">Hello ${quizData.prenom || 'cette personne'},</p>
  <p style="margin-bottom: 16px;">Paragraphe avec <strong>mots clés</strong> en gras...</p>
  ...
  <p style="margin-bottom: 16px;"><a href="https://sonnycourt.com/pack-complet/?token=${token}" style="color: #4D97FE; text-decoration: underline;">Cette offre est disponible 48h seulement ici</a> avec 70% de réduction.</p>
  <p style="margin-top: 24px;">Je crois en toi,<br>Sonny</p>
  <p style="margin-top: 16px; font-style: italic;">PS : ...</p>
</div>

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
SUBJECT: [objet de l'email - doit être personnel et intrigant - TEXTE BRUT UNIQUEMENT, pas de ** ou __ ou * ou _, pas de formatage Markdown]
BODY: [corps de l'email incluant le PS à la fin]`;
        } 
        else if (emailType === '24h') {
            // Prompt rappel 24h - très court, 5 phrases max
            prompt = `Tu es Sonny Court. Email de rappel TRÈS COURT à ${quizData.prenom}.

Tu lui as envoyé un email hier. Tu veux juste t'assurer qu'elle l'a vu.

L'offre expire dans 24h.

RÈGLES STRICTES :
- Maximum 5 phrases au total
- Pas de re-pitch du Pack Complet
- Pas de mention de la fierté/souffrance/rêve
- Juste : "Tu as vu mon email d'hier ? L'offre expire demain."

STRUCTURE EXACTE :
Hello ${quizData.prenom},

Je voulais juste m'assurer que tu avais vu mon message d'hier.

L'offre sur le Pack Complet expire demain.

<a href='https://sonnycourt.com/pack-complet/?token=${token}' style='color: #4D97FE; text-decoration: underline;'>Voir l'offre</a>

Sonny

PS : Ajouter un PS d'une seule phrase qui rappelle leur objectif en utilisant leurs propres mots du quiz.
Objectif du user : ${quizData.objectif}
Le PS doit reprendre les termes exacts utilisés par le user dans ses réponses.
Format : <p style="margin-top: 16px; font-style: italic;">PS : ...</p>

FORMAT :
SUBJECT: [3-5 mots max - TEXTE BRUT UNIQUEMENT, pas de ** ou __ ou * ou _, pas de formatage Markdown]
BODY: [HTML avec <p style="margin-bottom: 16px;"> - 5 phrases max + PS]`;
        }
        else if (emailType === '4h') {
            // Prompt urgence 4h - ultra court, 3 phrases max
            prompt = `Tu es Sonny Court. Dernier rappel ULTRA COURT à ${quizData.prenom}.

L'offre expire dans 4h.

RÈGLES STRICTES :
- Maximum 3 phrases au total
- Juste factuel, pas de pitch

STRUCTURE EXACTE :
Hello ${quizData.prenom},

L'offre expire dans 4h.

<a href='https://sonnycourt.com/pack-complet/?token=${token}' style='color: #4D97FE; text-decoration: underline;'>Dernière chance</a>

Sonny

PS : Ajouter un PS d'une seule phrase très courte qui rappelle leur SOUFFRANCE (pas objectif).
Souffrance du user : ${quizData.souffrance}
Le PS doit reprendre les mots exacts utilisés par le user pour décrire sa souffrance.
Créer l'urgence : cette souffrance continue tant qu'ils n'agissent pas.
Format : <p style="margin-top: 16px; font-style: italic;">PS : ...</p>

FORMAT :
SUBJECT: [2-3 mots max - TEXTE BRUT UNIQUEMENT, pas de ** ou __ ou * ou _, pas de formatage Markdown]
BODY: [HTML - 3 phrases max + PS]`;
        } else {
            // Fallback vers initial si type inconnu
            prompt = `Tu es Sonny Court. Écris un email personnel à ${quizData.prenom || 'cette personne'}.

Voici ses réponses au quiz :
- Objectif : ${quizData.objectif || 'Non spécifié'}
- Situation : ${quizData.situation || 'Non spécifié'}
- Fierté : ${quizData.fierte || 'Non spécifié'}
- Rêve : ${quizData.reve || 'Non spécifié'}
- Souffrance : ${quizData.souffrance || 'Non spécifié'}

AVANT TOUT : Si les réponses sont du charabia, des mots random, ou clairement pas sérieuses → retourne uniquement : SKIP
Si les réponses sont courtes mais cohérentes → c'est OK, génère l'email.

Format de réponse :
SUBJECT: [objet de l'email - doit être personnel et intrigant - TEXTE BRUT UNIQUEMENT, pas de ** ou __ ou * ou _, pas de formatage Markdown]
BODY: [corps de l'email incluant le PS à la fin]`;
        }

        let content = '';

        if (model === 'deepseek') {
            // Utiliser DeepSeek API
            const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
            
            if (!deepseekApiKey) {
                console.error('❌ DEEPSEEK_API_KEY non définie');
                return {
                    statusCode: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    },
                    body: JSON.stringify({ error: 'DeepSeek API key not configured' })
                };
            }

            console.log('🤖 Appel à l\'API DeepSeek...');

            const deepseekResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${deepseekApiKey}`
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'user', content: prompt }
                    ]
                })
            });

            if (!deepseekResponse.ok) {
                const errorText = await deepseekResponse.text();
                console.error('❌ Erreur API DeepSeek:', errorText);
                return {
                    statusCode: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    },
                    body: JSON.stringify({ 
                        error: 'DeepSeek API error',
                        details: errorText 
                    })
                };
            }

            const deepseekData = await deepseekResponse.json();
            console.log('✅ Réponse DeepSeek reçue');

            // Extraire le contenu de la réponse (format OpenAI)
            const deepseekContent = deepseekData.choices?.[0]?.message?.content || '';
            
            // DeepSeek retourne déjà le format SUBJECT:/BODY:, pas besoin de reformater
            content = deepseekContent;

        } else {
            // Utiliser Claude API (défaut: 'sonnet')
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

            console.log('🤖 Appel à l\'API Anthropic (Claude Sonnet)...');

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

            // Extraire le contenu de la réponse (format Anthropic)
            content = anthropicData.content?.[0]?.text || '';
        }

        console.log('📄 Contenu brut extrait:', content);
        
        // Vérifier si SKIP
        if (content.trim() === 'SKIP' || content.trim().startsWith('SKIP')) {
            console.log('⚠️ Réponses jugées inexploitables');
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
        
        if (content.includes('BODY:')) {
            // Format avec BODY: explicite (format Claude standard)
            subject = content.split('SUBJECT:')[1].split('BODY:')[0].trim();
            body = content.split('BODY:')[1].trim();
        } else if (content.includes('SUBJECT:') && content.includes('<div')) {
            // Format DeepSeek : SUBJECT: xxx <div... (pas de BODY: entre les deux)
            const subjectStart = content.indexOf('SUBJECT:') + 8;
            const htmlStart = content.indexOf('<div');
            subject = content.substring(subjectStart, htmlStart).trim();
            body = content.substring(htmlStart).trim();
        } else if (content.includes('SUBJECT:')) {
            // Seulement SUBJECT: trouvé
            subject = content.substring(content.indexOf('SUBJECT:') + 8).trim();
            body = content.trim();
        } else if (content.includes('BODY:')) {
            // Seulement BODY: trouvé
            body = content.substring(content.indexOf('BODY:') + 5).trim();
            subject = 'Email personnalisé';
        } else {
            // Fallback
            body = content.trim();
            subject = 'Un message pour toi';
        }
        
        // Nettoyer le sujet de tout formatage Markdown
        subject = subject.replace(/\*\*/g, '').replace(/__/g, '').replace(/\*/g, '').replace(/_/g, '').trim();
        
        console.log('Subject extrait:', subject);
        console.log('Body extrait (premiers 200 caractères):', body.substring(0, 200));
        
        // S'assurer que le body est bien en HTML
        let htmlBody = body || content.trim();
        
        // Si le body ne contient pas de balises HTML, ajouter un wrapper
        if (!htmlBody.includes('<p>') && !htmlBody.includes('<div>') && !htmlBody.includes('<br>')) {
            console.log('⚠️ Body ne contient pas de HTML, ajout d\'un wrapper...');
            htmlBody = `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">${htmlBody.replace(/\n/g, '<br>')}</div>`;
        }
        
        // Ajouter le footer de désinscription
        const footer = `
<p style="margin-top: 32px; font-size: 12px; color: #666; text-align: left;">
  sonnycourt.com<br>
  <a href="https://sonnycourt.com/.netlify/functions/unsubscribe?email=${email}" style="color: #666;">Se désinscrire</a>
</p>
`;
        const bodyWithFooter = htmlBody + footer;

        // Retourner directement subject, body et model (SANS envoyer d'email)
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ 
                success: true,
                subject: subject || 'Email personnalisé',
                body: bodyWithFooter,
                model: model
            })
        };

    } catch (error) {
        console.error('❌ Erreur dans preview-email-pack:', error);
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
