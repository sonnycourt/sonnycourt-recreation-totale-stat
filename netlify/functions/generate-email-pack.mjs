import fetch from 'node-fetch';
import crypto from 'node:crypto';
import { withLambda } from '@netlify/aws-lambda-compat';

// Configuration Supabase
// Colonnes anti-doublon quiz_responses : email_sent (initial), email_24h_sent, email_4h_sent (boolean, default false)
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

    let lockAcquired = false, email, emailType, sentColumn;

    try {
        // LOG INITIAL : Voir ce que MailerLite envoie
        console.log('📥 Body reçu de MailerLite:', JSON.stringify(event.body ? JSON.parse(event.body) : {}, null, 2));
        
        // 1. VÉRIFIER LA SECRET KEY (pour les webhooks MailerLite)
        const expectedSecret = 'pack-complet-webhook-2026';
        const signature = event.headers['x-mailerlite-signature'] || event.headers['X-Mailerlite-Signature'] || '';
        
        // Si c'est un webhook MailerLite, vérifier la signature
        if (signature && signature !== expectedSecret) {
            console.error('❌ Secret key invalide:', signature);
            return {
                statusCode: 401,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Unauthorized - Invalid secret key' })
            };
        }
        
        // 2. PARSER LE BODY ET EXTRAIRE L'EMAIL
        const requestBody = JSON.parse(event.body || '{}');
        
        // Récupérer le paramètre model (query string ou body, défaut: 'deepseek')
        const model = event.queryStringParameters?.model || requestBody.model || 'deepseek';
        
        // Récupérer le paramètre type (initial, 24h, 4h)
        emailType = event.queryStringParameters?.type || requestBody.type || 'initial';
        
        // Extraire l'email depuis le format MailerLite webhook
        email = requestBody.events?.[0]?.subscriber?.email || requestBody.email;

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

        console.log('✅ Données du quiz récupérées:', {
            prenom: quizData.prenom,
            objectif: quizData.objectif,
            situation: quizData.situation,
            token: quizData.token ? 'présent' : 'absent'
        });

        // Anti-doublon atomique : UPDATE seulement si le flag est encore false
        sentColumn = emailType === 'initial' ? 'email_sent' : (emailType === '24h' ? 'email_24h_sent' : 'email_4h_sent');
        const atomicUpdateRes = await fetch(
            `${supabaseUrl}/rest/v1/quiz_responses?email=eq.${encodeURIComponent(email)}&${sentColumn}=eq.false`,
            {
                method: 'PATCH',
                headers: {
                    'apikey': supabaseAnonKey,
                    'Authorization': `Bearer ${supabaseAnonKey}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify({ [sentColumn]: true })
            }
        );
        const atomicUpdateBody = await atomicUpdateRes.json();
        if (!atomicUpdateRes.ok) {
            console.error('❌ Erreur Supabase atomic update:', atomicUpdateBody);
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'Supabase atomic update failed', details: atomicUpdateBody })
            };
        }
        if (!atomicUpdateBody || !Array.isArray(atomicUpdateBody) || atomicUpdateBody.length === 0) {
            console.log(`⏭️ SKIP: Email ${emailType} déjà en cours/envoyé pour ${email}`);
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ skipped: true, type: emailType })
            };
        }
        lockAcquired = true;
        console.log(`🔒 Verrou acquis pour ${emailType} - ${email}`);

        // Vérification de l'ordre des emails
        if (emailType === '24h') {
            const checkInitial = await fetch(
                `${supabaseUrl}/rest/v1/quiz_responses?email=eq.${encodeURIComponent(email)}&select=email_sent`,
                { method: 'GET', headers: { 'apikey': supabaseAnonKey, 'Authorization': `Bearer ${supabaseAnonKey}` } }
            );
            const checkData = await checkInitial.json();
            if (!checkData[0]?.email_sent) {
                console.log('⏳ ATTENTE: Email 24h demandé mais email initial pas encore envoyé pour', email);
                // Rollback le lock
                await fetch(
                    `${supabaseUrl}/rest/v1/quiz_responses?email=eq.${encodeURIComponent(email)}`,
                    { method: 'PATCH', headers: { 'apikey': supabaseAnonKey, 'Authorization': `Bearer ${supabaseAnonKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ [sentColumn]: false }) }
                );
                return { statusCode: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ retry: true, reason: 'initial_not_sent_yet' }) };
            }
        }

        if (emailType === '4h') {
            const check24h = await fetch(
                `${supabaseUrl}/rest/v1/quiz_responses?email=eq.${encodeURIComponent(email)}&select=email_24h_sent`,
                { method: 'GET', headers: { 'apikey': supabaseAnonKey, 'Authorization': `Bearer ${supabaseAnonKey}` } }
            );
            const checkData = await check24h.json();
            if (!checkData[0]?.email_24h_sent) {
                console.log('⏳ ATTENTE: Email 4h demandé mais email 24h pas encore envoyé pour', email);
                // Rollback le lock
                await fetch(
                    `${supabaseUrl}/rest/v1/quiz_responses?email=eq.${encodeURIComponent(email)}`,
                    { method: 'PATCH', headers: { 'apikey': supabaseAnonKey, 'Authorization': `Bearer ${supabaseAnonKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ [sentColumn]: false }) }
                );
                return { statusCode: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ retry: true, reason: '24h_not_sent_yet' }) };
            }
        }

        console.log('✅ Ordre vérifié, continuation pour', emailType);

        // 2. Utiliser le token depuis Supabase (ou générer un nouveau si absent)
        let token = quizData.token;
        
        if (!token) {
            // Si pas de token dans Supabase, en générer un nouveau et le mettre à jour
            token = crypto.randomUUID();
            console.log('🔑 Token généré (absent dans Supabase):', token);
            
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
        } else {
            console.log('✅ Token récupéré depuis Supabase:', token);
        }

        // 3. Appeler l'API LLM (Claude ou DeepSeek selon le paramètre model)
        console.log('🤖 Modèle LLM sélectionné:', model);
        console.log('📧 Type d\'email:', emailType);
        
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
            // Prompt rappel 24h
            prompt = `Tu es Sonny Court. Email de rappel court.

RÈGLE CRITIQUE : Tu dois retourner EXACTEMENT ce format avec SUBJECT: sur une ligne et BODY: sur une ligne séparée.

SUBJECT: Offre expire demain

BODY:
<div style="font-family: Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #333;">
<p style="margin-bottom: 8px;">Hello ${quizData.prenom},</p>
<p style="margin-bottom: 8px;">Je voulais juste m'assurer que tu avais vu mon message d'hier.</p>
<p style="margin-bottom: 8px;">L'offre sur le Pack Complet expire demain.</p>
<p style="margin-bottom: 8px;"><a href='https://sonnycourt.com/pack-complet/?token=${token}' style='color: #4D97FE; text-decoration: underline;'>Voir l'offre</a></p>
<p style="margin-bottom: 8px;">Sonny</p>
<p style="margin-top: 16px; font-style: italic;">PS : [Une phrase créative et émotionnelle qui utilise le rêve pour créer l'envie d'agir. Rêve du user : ${quizData.reve}. Ne PAS juste répéter mot pour mot, mais UTILISER les mots pour raviver le désir. Exemple : "Cette liberté dont tu rêves, elle commence par une décision."]</p>
</div>

IMPORTANT : 
- SUBJECT: doit être sur sa propre ligne, suivi d'un saut de ligne
- BODY: doit être sur sa propre ligne, suivi du HTML
- Ne PAS mettre le body dans le subject
- Formatage HTML strict : <div style="font-family: Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #333;"> pour le wrapper et <p style="margin-bottom: 8px;"> pour chaque paragraphe`;
        }
        else if (emailType === '4h') {
            // Prompt urgence 4h
            prompt = `Tu es Sonny Court. Dernier rappel à ${quizData.prenom}.

L'offre expire dans 4h.

RÈGLE CRITIQUE : Tu dois retourner EXACTEMENT ce format avec SUBJECT: sur une ligne et BODY: sur une ligne séparée.

SUBJECT: Dernière chance

BODY:
<div style="font-family: Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #333;">
<p style="margin-bottom: 8px;">Hello ${quizData.prenom},</p>
<p style="margin-bottom: 8px;">L'offre expire dans 4h.</p>
<p style="margin-bottom: 8px;"><a href='https://sonnycourt.com/pack-complet/?token=${token}' style='color: #4D97FE; text-decoration: underline;'>Dernière chance</a></p>
<p style="margin-bottom: 8px;">Sonny</p>
<p style="margin-top: 16px; font-style: italic;">PS : [Une phrase créative et émotionnelle qui utilise la souffrance pour créer l'urgence. Souffrance du user : ${quizData.souffrance}. Ne PAS juste répéter mot pour mot, mais UTILISER les mots pour créer l'envie d'agir maintenant. Exemple : "Dans 4h, soit tu restes avec ce manque de confiance, soit tu décides que ça change."]</p>
</div>

IMPORTANT : 
- SUBJECT: doit être sur sa propre ligne, suivi d'un saut de ligne
- BODY: doit être sur sa propre ligne, suivi du HTML
- Ne PAS mettre le body dans le subject
- Formatage HTML strict : <div style="font-family: Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #333;"> pour le wrapper et <p style="margin-bottom: 8px;"> pour chaque paragraphe`;
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
        let usedModel = 'deepseek';

        // Essayer DeepSeek d'abord (sauf si explicitement demandé sonnet)
        if (model !== 'sonnet') {
            try {
                const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
                
                if (!deepseekApiKey) {
                    throw new Error('DEEPSEEK_API_KEY non définie');
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
                    throw new Error(`DeepSeek API error: ${errorText}`);
                }

                const deepseekData = await deepseekResponse.json();
                console.log('✅ Réponse DeepSeek reçue');
                console.log('Réponse DeepSeek brute:', JSON.stringify(deepseekData, null, 2));

                // Extraire le contenu de la réponse (format OpenAI)
                content = deepseekData.choices?.[0]?.message?.content || '';
                
            } catch (deepseekError) {
                // FALLBACK DÉSACTIVÉ - décommenter si nécessaire
                // console.log('⚠️ DeepSeek a échoué, fallback vers Claude:', deepseekError.message);
                // usedModel = 'sonnet';
                // 
                // // Fallback vers Claude
                // const anthropicApiKey = process.env.ANTHROPIC_API_KEY_EMAIL_PACK;
                // 
                // if (!anthropicApiKey) {
                //     console.error('❌ ANTHROPIC_API_KEY_EMAIL_PACK non définie');
                //     return {
                //         statusCode: 500,
                //         headers: {
                //             'Content-Type': 'application/json',
                //             'Access-Control-Allow-Origin': '*'
                //         },
                //         body: JSON.stringify({ error: 'Anthropic API key not configured' })
                //     };
                // }
                // 
                // console.log('🤖 Appel à l\'API Anthropic (Claude Sonnet)...');
                // 
                // const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
                //     method: 'POST',
                //     headers: {
                //         'Content-Type': 'application/json',
                //         'x-api-key': anthropicApiKey,
                //         'anthropic-version': '2023-06-01'
                //     },
                //     body: JSON.stringify({
                //         model: 'claude-sonnet-4-20250514',
                //         max_tokens: 2000,
                //         messages: [
                //             {
                //                 role: 'user',
                //                 content: prompt
                //             }
                //         ]
                //     })
                // });
                // 
                // if (!anthropicResponse.ok) {
                //     const errorText = await anthropicResponse.text();
                //     console.error('❌ Erreur API Anthropic:', errorText);
                //     return {
                //         statusCode: 500,
                //         headers: {
                //             'Content-Type': 'application/json',
                //             'Access-Control-Allow-Origin': '*'
                //         },
                //         body: JSON.stringify({ 
                //             error: 'Anthropic API error',
                //             details: errorText 
                //         })
                //     };
                // }
                // 
                // const anthropicData = await anthropicResponse.json();
                // console.log('✅ Réponse Anthropic reçue');
                // console.log('Réponse Anthropic brute:', JSON.stringify(anthropicData, null, 2));
                // 
                // // Extraire le contenu de la réponse (format Anthropic)
                // content = anthropicData.content?.[0]?.text || '';

                // Version actuelle : DeepSeek uniquement
                console.error('❌ Erreur DeepSeek:', deepseekError.message);
                throw deepseekError;
            }
        } else {
            // Utiliser Claude directement si explicitement demandé
            usedModel = 'sonnet';
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
            console.log('Réponse Anthropic brute:', JSON.stringify(anthropicData, null, 2));

            // Extraire le contenu de la réponse (format Anthropic)
            content = anthropicData.content?.[0]?.text || '';
        }

        console.log('🤖 Modèle utilisé:', usedModel);

        console.log('📄 Contenu brut extrait:', content);
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
            // Fallback : si le format n'est pas respecté, utiliser tout le contenu comme body
            body = content.trim();
            subject = 'Un message pour toi';
        }
        
        // Correction : Si le subject contient du HTML, c'est que le body s'est retrouvé dans le subject
        if (subject.includes('<p') || subject.includes('<div')) {
            const htmlStart = subject.indexOf('<');
            body = subject.substring(htmlStart) + (body || '');
            subject = subject.substring(0, htmlStart).trim();
        }
        
        // Nettoyer le sujet de tout formatage Markdown
        subject = subject.replace(/\*\*/g, '').replace(/__/g, '').replace(/\*/g, '').replace(/_/g, '').trim();
        
        console.log('Subject extrait:', subject);
        console.log('Body extrait:', body);
        console.log('Body contient HTML:', body.includes('<p>') || body.includes('<div>') || body.includes('<br>'));
        
        // Sauvegarder l'email généré dans Supabase avant l'envoi
        const subjectColumn = emailType === 'initial' ? 'email_initial_subject' : 
                              emailType === '24h' ? 'email_24h_subject' : 'email_4h_subject';
        const bodyColumn = emailType === 'initial' ? 'email_initial_body' : 
                           emailType === '24h' ? 'email_24h_body' : 'email_4h_body';
        
        try {
            const saveEmailRes = await fetch(
                `${supabaseUrl}/rest/v1/quiz_responses?email=eq.${encodeURIComponent(email)}`,
                {
                    method: 'PATCH',
                    headers: {
                        'apikey': supabaseAnonKey,
                        'Authorization': `Bearer ${supabaseAnonKey}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'return=minimal'
                    },
                    body: JSON.stringify({
                        [subjectColumn]: subject,
                        [bodyColumn]: body
                    })
                }
            );
            
            if (saveEmailRes.ok) {
                console.log('💾 Email sauvegardé dans Supabase:', emailType);
            } else {
                const errorText = await saveEmailRes.text();
                console.error('⚠️ Erreur sauvegarde email dans Supabase:', errorText);
                // On continue quand même, la sauvegarde n'est pas critique
            }
        } catch (saveError) {
            console.error('⚠️ Erreur lors de la sauvegarde de l\'email:', saveError);
            // On continue quand même, la sauvegarde n'est pas critique
        }
        
        // S'assurer que le body est bien en HTML
        let htmlBody = body || content.trim();
        
        // Si le body ne contient pas de balises HTML, ajouter un wrapper
        if (!htmlBody.includes('<p>') && !htmlBody.includes('<div>') && !htmlBody.includes('<br>')) {
            console.log('⚠️ Body ne contient pas de HTML, ajout d\'un wrapper...');
            htmlBody = `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">${htmlBody.replace(/\n/g, '<br>')}</div>`;
        }
        
        // Nettoyer le body pour 24h et 4h uniquement : supprimer tous les <br>
        if (emailType === '24h' || emailType === '4h') {
            htmlBody = htmlBody.replace(/<br\s*\/?>/gi, '');
            console.log('🧹 Body nettoyé des <br>');
        }
        
        // Ajouter le footer de désinscription
        const footer = `
<p style="margin-top: 32px; font-size: 12px; color: #666; text-align: left;">
  <a href="https://sonnycourt.com/.netlify/functions/unsubscribe?email=${email}" style="color: #666;">Se désinscrire</a>
</p>
`;
        const bodyWithFooter = htmlBody + footer;
        
        const result = {
            subject: subject || 'Email personnalisé',
            body: bodyWithFooter,
            token: token
        };
        
        // 3. ENVOYER L'EMAIL VIA LISTMONK
        const listmonkUrl = process.env.LISTMONK_URL || 'https://mail.sonnycourt.com';
        const listmonkUser = process.env.LISTMONK_USER;
        const listmonkPass = process.env.LISTMONK_PASS;
        
        if (!listmonkUser || !listmonkPass) {
            console.error('❌ LISTMONK_USER ou LISTMONK_PASS non définie');
            return {
                statusCode: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ 
                    error: 'ListMonk credentials not configured' 
                })
            };
        }
        
        try {
            console.log('📨 Envoi de l\'email via ListMonk...');
            console.log('🔗 LISTMONK_URL:', listmonkUrl);
            console.log('👤 LISTMONK_USER présent:', !!listmonkUser);
            console.log('📧 Email destinataire:', email);
            console.log('📧 Subject:', result.subject);
            console.log('👤 Prénom:', quizData.prenom || 'Non spécifié');
            
            // Le bodyWithFooter est déjà créé avec le footer de désinscription
            console.log('📝 Body HTML final (premiers 200 caractères):', result.body.substring(0, 200));
            
            // Authentification Basic
            const authHeader = 'Basic ' + Buffer.from(`${listmonkUser}:${listmonkPass}`).toString('base64');
            
            // ÉTAPE 1: Créer ou mettre à jour l'abonné dans ListMonk
            console.log('👤 Création/mise à jour de l\'abonné dans ListMonk...');
            const createSubscriber = await fetch(`${listmonkUrl}/api/subscribers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': authHeader
                },
                body: JSON.stringify({
                    email: email,
                    name: quizData.prenom || '',
                    status: 'enabled',
                    lists: [1]
                })
            });
            
            const createSubscriberText = await createSubscriber.text();
            if (createSubscriber.ok) {
                console.log('✅ Abonné créé/mis à jour dans ListMonk');
            } else {
                console.log('⚠️ Erreur création/mise à jour abonné ListMonk (continuité quand même):', createSubscriber.status, createSubscriberText);
                // On continue quand même, l'abonné existe peut-être déjà
            }
            
            // ÉTAPE 2: Envoyer l'email via ListMonk API transactionnelle avec template
            console.log('🚨 ENVOI EMAIL - ' + Date.now() + ' - ' + email + ' - ' + emailType);
            const listmonkResponse = await fetch(`${listmonkUrl}/api/tx`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': authHeader
                },
                body: JSON.stringify({
                    subscriber_email: email,
                    template_id: 11,
                    data: {
                        subject: result.subject,
                        body: result.body
                    },
                    from_email: 'Sonny Court <info@sonnycourt.com>',
                    messenger: 'email'
                })
            });
            
            const listmonkResponseText = await listmonkResponse.text();
            
            if (!listmonkResponse.ok) {
                console.error('❌ Erreur ListMonk API:', listmonkResponse.status, listmonkResponseText);
                // Rollback : remettre le flag à false pour permettre un retry
                if (lockAcquired && sentColumn) {
                    const rb = await fetch(`${supabaseUrl}/rest/v1/quiz_responses?email=eq.${encodeURIComponent(email)}`, {
                        method: 'PATCH',
                        headers: { 'apikey': supabaseAnonKey, 'Authorization': `Bearer ${supabaseAnonKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ [sentColumn]: false })
                    });
                    if (!rb.ok) console.error('⚠️ Rollback Supabase failed', await rb.text());
                }
                return {
                    statusCode: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    },
                    body: JSON.stringify({ 
                        error: 'Failed to send email via ListMonk',
                        details: listmonkResponseText,
                        status: listmonkResponse.status
                    })
                };
            }
            
            console.log('✅ Email envoyé via ListMonk');
            console.log('📧 Response:', listmonkResponseText);
            
        } catch (listmonkError) {
            console.error('❌ Erreur lors de l\'envoi ListMonk:', listmonkError);
            console.error('❌ Erreur message:', listmonkError.message);
            console.error('❌ Erreur stack:', listmonkError.stack);
            
            // Rollback : remettre le flag à false pour permettre un retry
            if (lockAcquired && sentColumn) {
                const rb = await fetch(`${supabaseUrl}/rest/v1/quiz_responses?email=eq.${encodeURIComponent(email)}`, {
                    method: 'PATCH',
                    headers: { 'apikey': supabaseAnonKey, 'Authorization': `Bearer ${supabaseAnonKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ [sentColumn]: false })
                });
                if (!rb.ok) console.error('⚠️ Rollback Supabase failed', await rb.text());
            }
            
            return {
                statusCode: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ 
                    error: 'Failed to send email via ListMonk',
                    details: listmonkError.message || String(listmonkError),
                    type: listmonkError.constructor?.name || 'UnknownError'
                })
            };
        }

        console.log('✅ Traitement terminé avec succès pour:', email);

        // Retourner 200 après tout le traitement
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error('❌ Erreur dans handler (validation):', error);
        
        // Rollback : remettre le flag à false si on avait acquis le verrou
        if (lockAcquired && email && emailType && sentColumn) {
            try {
                const rb = await fetch(`${supabaseUrl}/rest/v1/quiz_responses?email=eq.${encodeURIComponent(email)}`, {
                    method: 'PATCH',
                    headers: { 'apikey': supabaseAnonKey, 'Authorization': `Bearer ${supabaseAnonKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ [sentColumn]: false })
                });
                if (!rb.ok) console.error('⚠️ Rollback Supabase failed', await rb.text());
            } catch (rbErr) {
                console.error('⚠️ Rollback error:', rbErr);
            }
        }
        
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

export default withLambda(handler);
