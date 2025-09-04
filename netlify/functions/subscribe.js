exports.handler = async (event, context) => {
    // Vérifier que c'est une requête POST
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        // Récupérer les données du body
        const { email, groupId } = JSON.parse(event.body);

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

        // Appel à l'API MailerLite
        const mailerliteResponse = await fetch('https://connect.mailerlite.com/api/subscribers', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                groups: [groupId]
            })
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