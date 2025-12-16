exports.handler = async (event, context) => {
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

    // Vérifier que c'est une requête POST
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        // Récupérer les données du body
        const { email, groupId, prenom, nom, telephone, countryCode, uniqueToken } = JSON.parse(event.body);

        // Validation basique
        if (!email || !email.includes('@')) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Email invalide' })
            };
        }

        // Récupérer l'API key depuis les variables d'environnement
        const apiKey = process.env.MAILERLITE_API_KEY;
        
        if (!apiKey) {
            console.error('MAILERLITE_API_KEY not found in environment variables');
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Configuration serveur manquante' })
            };
        }

        // Récupérer le Group ID depuis les variables d'environnement ou utiliser celui fourni
        const defaultGroupId = process.env.MAILERLITE_GROUP_COURTCIRCUIT || groupId || '172875888042443786';
        
        // Préparer les données pour MailerLite
        const subscriberData = {
            email: email,
            groups: [groupId || defaultGroupId],
            status: 'active'
        };

        // Ajouter les champs personnalisés si disponibles
        const fields = {};
        if (prenom && nom) {
            fields.name = `${prenom} ${nom}`;
            fields.first_name = prenom;
            fields.last_name = nom;
        } else if (prenom) {
            fields.name = prenom;
            fields.first_name = prenom;
        } else if (nom) {
            fields.name = nom;
            fields.last_name = nom;
        }
        
        if (telephone) {
            const fullPhone = countryCode ? `${countryCode}${telephone.replace(/\s/g, '')}` : telephone;
            fields.phone = fullPhone;
        }
        
        // Ajouter le token unique si fourni (pour Esprit Subconscient)
        if (uniqueToken) {
            fields.unique_token = uniqueToken;
        }
        
        if (Object.keys(fields).length > 0) {
            subscriberData.fields = fields;
        }

        // Appel à l'API MailerLite
        const mailerliteResponse = await fetch('https://connect.mailerlite.com/api/subscribers', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json'
            },
            body: JSON.stringify(subscriberData)
        });

        const mailerliteData = await mailerliteResponse.json();

        if (!mailerliteResponse.ok) {
            console.error('MailerLite API error:', mailerliteData);
            return {
                statusCode: 400,
                body: JSON.stringify({ 
                    error: 'Erreur lors de l\'inscription',
                    details: mailerliteData.message || 'Erreur inconnue'
                })
            };
        }

        // Succès
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: JSON.stringify({
                success: true,
                id: mailerliteData.id,
                message: 'Inscription réussie'
            })
        };

    } catch (error) {
        console.error('Error in subscribe function:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Erreur serveur',
                details: error.message 
            })
        };
    }
};