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
        console.log('🎨 Fonction generate-page-content appelée');
        const requestBody = JSON.parse(event.body || '{}');
        const email = requestBody.email;
        const quizData = requestBody.quizData;

        if (!email || !quizData) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Email and quizData are required' })
            };
        }

        console.log('🎨 Génération contenu page pour:', email);

        // Appeler DeepSeek pour générer le contenu
        const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
        
        if (!deepseekApiKey) {
            throw new Error('DEEPSEEK_API_KEY non définie');
        }

        const prompt = `Tu es Sonny Court, copywriter expert et coach en transformation personnelle. Ta mission : écrire du contenu de page de vente ULTRA-PERSONNALISÉ qui convertit.

=== DONNÉES DE L'UTILISATEUR ===

Prénom : ${quizData.prenom || 'cette personne'}

RÉPONSES À CHOIX MULTIPLE :
- Objectif principal : ${quizData.objectif || 'Non spécifié'}
- Situation actuelle : ${quizData.situation || 'Non spécifié'}

RÉPONSES LIBRES (ÉCRITS PAR L'UTILISATEUR - UTILISE LEURS MOTS EXACTS) :
- Ce dont ils sont fiers : "${quizData.fierte || 'Non spécifié'}"
- Leur rêve/vision idéale : "${quizData.reve || 'Non spécifié'}"
- Ce qui les fait souffrir : "${quizData.souffrance || 'Non spécifié'}"

=== RÈGLES DE COPYWRITING À APPLIQUER ===

=== POSITIONNEMENT IMPORTANT ===

Le Pack Complet n'est PAS une formation spécifique pour atteindre leur objectif (pas une formation business, pas une formation séduction, etc.).

C'est un système de REPROGRAMMATION SUBCONSCIENTE et de MANIFESTATION basé sur les lois universelles.

L'idée clé : Peu importe l'objectif (argent, amour, santé, confiance), le PREMIER BLOCAGE est toujours intérieur. Le subconscient sabote. Les croyances limitantes freinent. 

Le Pack débloque cette fondation → ensuite TOUS les objectifs deviennent atteignables naturellement.

Dans le copywriting :
- Ne PAS promettre qu'on va leur apprendre à gagner de l'argent / trouver l'amour / etc.
- PROMETTRE qu'on va supprimer les blocages intérieurs qui les empêchent d'y arriver
- Le Pack est la CLÉ qui ouvre toutes les portes, pas une porte spécifique

Exemple BON : "Maximus, ton rêve de 10K€/mois commence par une chose : supprimer ce qui te bloque de l'intérieur."

Exemple MAUVAIS : "Maximus, voici comment gagner 10K€/mois avec ton business."

**FORMULE PAS (Problem-Agitate-Solve) :**
1. PROBLEM : Identifier leur douleur principale (utiliser leurs mots de "souffrance")
2. AGITATE : Amplifier l'émotion - montrer les conséquences de ne pas agir
3. SOLVE : Présenter le Pack comme LA solution naturelle

**RÈGLES HEADLINE (titre principal) :**
- Maximum 12 mots
- DOIT commencer par le prénom
- Créer une PROMESSE SPÉCIFIQUE liée à LEUR objectif ET LEUR rêve
- Utiliser leurs propres mots quand possible
- Mots puissants : "enfin", "mérites", "secret", "vraiment", "maintenant"
- INTERDITS : "transformer ta vie" (trop vague), "changer", "améliorer" (génériques)
- Structure gagnante : "[Prénom], [promesse spécifique basée sur leur rêve]"

**RÈGLES SUBHEADER (sous-titre) :**
- Maximum 20 mots
- Adresser leur SOUFFRANCE avec empathie (utiliser leurs mots exacts)
- Créer un contraste : où ils sont vs où ils veulent être
- Ton : compréhensif mais pas dramatique
- Structure : "Sans [leur obstacle], sans [leur peur]. Juste [leur désir]."

**RÈGLES INTRO_PACK (texte personnalisé avant "Ce que tu obtiens") :**
- 3-4 phrases maximum
- Ton : personnel, comme un ami qui les comprend vraiment
- Structure :
  1. Reconnaître leur fierté (montrer que tu as lu et compris)
  2. Valider leur rêve comme légitime et atteignable
  3. Faire le pont : pourquoi CE pack est fait pour EUX spécifiquement
- Utiliser "j'ai" et "tu" (pas "nous")
- Reprendre leurs mots exacts entre guillemets si pertinent

**RÈGLES POURQUOI (section "Pourquoi cette offre ?") :**
- 3 points qui résonnent avec LEUR situation
- Chaque point commence par "Tu"
- 3 points positifs uniquement (ce qu'ils veulent)
- Adapter selon leur objectif :
  * Amour → relations, connexion, solitude, être aimé
  * Argent/projet → liberté, blocages financiers, potentiel inexploité
  * Santé → énergie, vitalité, contrôle du corps
  * Confiance → estime de soi, doutes, s'affirmer

=== FORMAT DE RÉPONSE ===

Retourne UNIQUEMENT ce JSON valide (pas de markdown, pas de texte avant/après) :

{
  "header": "...",
  "subheader": "...",
  "intro_pack": "...",
  "pourquoi": [
    {"text": "...", "positive": true},
    {"text": "...", "positive": true},
    {"text": "...", "positive": true}
  ]
}

=== EXEMPLES DE BON COPYWRITING ===

Si objectif = amour, rêve = "me réveiller à côté de quelqu'un qui m'aime", souffrance = "je me sens seule depuis ma rupture" :
- Header : "Marie, et si demain tu te réveillais enfin aimée ?"
- Subheader : "Cette solitude que tu ressens depuis ta rupture n'est pas une fatalité. C'est un programme à réécrire."

Si objectif = argent, rêve = "liberté financière et voyager", souffrance = "je n'arrive pas à lancer mon projet" :
- Header : "Thomas, ton projet mérite enfin de voir le jour."
- Subheader : "Sans blocages, sans excuses. Juste toi, libre de créer la vie que tu veux."

=== ERREURS À ÉVITER ===
- Ne PAS être générique (chaque élément doit être unique à cette personne)
- Ne PAS ignorer les réponses libres (fierté, rêve, souffrance) - ce sont les plus importantes
- Ne PAS utiliser de clichés ("transformer ta vie", "devenir la meilleure version")
- Ne PAS être trop dramatique ou manipulateur`;

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
        const content = deepseekData.choices?.[0]?.message?.content || '';

        // Parser le JSON de la réponse
        let pageContent;
        try {
            // Nettoyer le contenu (enlever markdown si présent)
            const cleanedContent = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
            pageContent = JSON.parse(cleanedContent);
        } catch (parseError) {
            console.error('❌ Erreur parsing JSON DeepSeek:', parseError);
            throw new Error('Invalid JSON response from DeepSeek');
        }

        // Valider la structure
        if (!pageContent.header || !pageContent.subheader || !pageContent.intro_pack || !Array.isArray(pageContent.pourquoi)) {
            throw new Error('Invalid page content structure from DeepSeek');
        }

        // Stocker dans Supabase
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
                body: JSON.stringify({
                    page_header: pageContent.header,
                    page_subheader: pageContent.subheader,
                    page_intro_pack: pageContent.intro_pack,
                    page_pourquoi: JSON.stringify(pageContent.pourquoi)
                })
            }
        );

        if (!updateResponse.ok) {
            const errorText = await updateResponse.text();
            throw new Error(`Supabase update error: ${errorText}`);
        }

        console.log('✅ Contenu page stocké dans Supabase');

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ success: true, pageContent })
        };

    } catch (error) {
        console.log('❌ Erreur génération contenu page:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ 
                error: 'Failed to generate page content',
                details: error.message 
            })
        };
    }
};

module.exports = { handler };
