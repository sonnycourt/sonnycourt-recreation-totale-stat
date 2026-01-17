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
        
        // Gérer les deux formats MailerLite
        let email = null;
        if (requestBody.events && requestBody.events[0] && requestBody.events[0].data && requestBody.events[0].data.subscriber) {
            email = requestBody.events[0].data.subscriber.email;
            console.log('📧 Email extrait depuis format webhook MailerLite (events[0].data.subscriber.email)');
        } else if (requestBody.email) {
            email = requestBody.email;
            console.log('📧 Email extrait depuis format direct (email)');
        } else {
            email = requestBody.email; // Fallback pour compatibilité avec l'ancien format
        }

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

        // 1. Récupérer les données du quiz depuis Supabase via API REST
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
        console.log('Body contient HTML:', body.includes('<p>') || body.includes('<div>') || body.includes('<br>'));
        
        // S'assurer que le body est bien en HTML
        let htmlBody = body || content.trim();
        
        // Si le body ne contient pas de balises HTML, ajouter un wrapper
        if (!htmlBody.includes('<p>') && !htmlBody.includes('<div>') && !htmlBody.includes('<br>')) {
            console.log('⚠️ Body ne contient pas de HTML, ajout d\'un wrapper...');
            htmlBody = `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">${htmlBody.replace(/\n/g, '<br>')}</div>`;
        }
        
        const result = {
            subject: subject || 'Email personnalisé',
            body: htmlBody,
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
            
            // Préparer le body HTML (s'assurer qu'il est bien en HTML)
            const emailBody = result.body.includes('<p>') || result.body.includes('<div>') || result.body.includes('<br>') 
                ? result.body 
                : `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">${result.body.replace(/\n/g, '<br>')}</div>`;
            
            console.log('📝 Body HTML final (premiers 200 caractères):', emailBody.substring(0, 200));
            
            // Authentification Basic
            const authHeader = 'Basic ' + Buffer.from(`${listmonkUser}:${listmonkPass}`).toString('base64');
            
            // Envoyer l'email via ListMonk API transactionnelle avec template
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
                        body: emailBody
                    },
                    from_email: 'Sonny Court <info@sonnycourt.com>',
                    messenger: 'email',
                    content_type: 'html'
                })
            });
            
            const listmonkResponseText = await listmonkResponse.text();
            
            if (!listmonkResponse.ok) {
                console.error('❌ Erreur ListMonk API:', listmonkResponse.status, listmonkResponseText);
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
            
            // On continue quand même, mais on ne marque pas comme envoyé
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
        
        // 4. MARQUER COMME ENVOYÉ DANS SUPABASE (seulement si l'envoi a réussi)
        try {
            console.log('📝 Marquage email_sent = true dans Supabase...');
            
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
                    body: JSON.stringify({ email_sent: true })
                }
            );
            
            if (updateResponse.ok) {
                console.log('✅ email_sent = true dans Supabase');
            } else {
                const errorText = await updateResponse.text();
                console.error('⚠️ Erreur lors de la mise à jour email_sent:', errorText);
                // On continue quand même, ce n'est pas bloquant
            }
        } catch (updateError) {
            console.error('⚠️ Erreur lors de la mise à jour email_sent:', updateError);
            // On continue quand même, ce n'est pas bloquant
        }

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
