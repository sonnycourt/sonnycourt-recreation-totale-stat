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
        const { email, groupId, prenom, nom, telephone, countryCode, country, uniqueToken, uniqueTokenManifest, uniqueTokenCC, uniqueTokenSSR } = JSON.parse(event.body);

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
        // Mapping des groupes spéciaux
        let targetGroupId;
        if (groupId === 'WAITLIST_SSR_2026') {
            // Liste d'attente SSR 2026
            targetGroupId = process.env.MAILERLITE_GROUP_SSR_WAITINGLIST_2026_EVERGREEN;
        } else if (groupId === 'SSR_2026_EVERGREEN') {
            // Groupe principal SSR
            targetGroupId = process.env.MAILERLITE_GROUP_SSR_2026_EVERGREEN;
        } else {
            // Priorité : groupId dans le body > MAILERLITE_GROUP_SSR_2026_EVERGREEN > MAILERLITE_GROUP_COURTCIRCUIT > fallback
            targetGroupId = groupId || process.env.MAILERLITE_GROUP_SSR_2026_EVERGREEN || process.env.MAILERLITE_GROUP_COURTCIRCUIT || '172875888042443786';
        }

        // Préparer les champs personnalisés
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
        
        // Ajouter le pays si fourni
        if (country) {
            fields.Country = country;
        }
        
        // Ajouter le token unique si fourni (pour Esprit Subconscient)
        if (uniqueToken) {
            fields.unique_token_es = uniqueToken;
        }
        
        // Ajouter le token unique si fourni (pour Manifest)
        if (uniqueTokenManifest) {
            fields.unique_token_manifest = uniqueTokenManifest;
        }
        
        // Ajouter le token unique si fourni (pour Court-Circuit)
        if (uniqueTokenCC) {
            fields.unique_token_cc = uniqueTokenCC;
        }
        
        // Ajouter le token unique si fourni (pour SSR)
        if (uniqueTokenSSR) {
            fields.unique_token_ssr = uniqueTokenSSR;
        }

        // Headers pour les appels API
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json'
        };

        // ÉTAPE 1: Vérifier si le contact existe déjà
        let subscriberId = null;
        let contactExists = false;

        try {
            const checkResponse = await fetch(`https://connect.mailerlite.com/api/subscribers/${encodeURIComponent(email)}`, {
                method: 'GET',
                headers: headers
            });

            if (checkResponse.ok) {
                const existingData = await checkResponse.json();
                subscriberId = existingData.data?.id;
                contactExists = true;
                console.log(`✅ Contact existant trouvé: ${email} (ID: ${subscriberId})`);
            }
        } catch (e) {
            console.log(`ℹ️ Contact n'existe pas encore: ${email}`);
        }

        // ÉTAPE 2: Créer ou mettre à jour le contact
        let subscriberData;
        let mailerliteResponse;

        if (contactExists && subscriberId) {
            // Contact existe → PUT pour mettre à jour
            const updateData = {
                status: 'active'
            };
            
            if (Object.keys(fields).length > 0) {
                updateData.fields = fields;
            }

            console.log(`🔄 Mise à jour du contact ${email} avec:`, JSON.stringify(updateData));

            mailerliteResponse = await fetch(`https://connect.mailerlite.com/api/subscribers/${subscriberId}`, {
                method: 'PUT',
                headers: headers,
                body: JSON.stringify(updateData)
            });

            const updateResult = await mailerliteResponse.json();
            
            if (!mailerliteResponse.ok) {
                console.error('❌ Erreur mise à jour:', updateResult);
            } else {
                console.log(`✅ Contact mis à jour: ${email}`);
                subscriberData = updateResult;
            }

        } else {
            // Contact n'existe pas → POST pour créer
            const createData = {
                email: email,
                status: 'active'
            };
            
            if (Object.keys(fields).length > 0) {
                createData.fields = fields;
            }

            console.log(`➕ Création du contact ${email} avec:`, JSON.stringify(createData));

            mailerliteResponse = await fetch('https://connect.mailerlite.com/api/subscribers', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(createData)
            });

            const createResult = await mailerliteResponse.json();
            
            if (!mailerliteResponse.ok) {
                console.error('❌ Erreur création:', createResult);
                return {
                    statusCode: 400,
                    body: JSON.stringify({ 
                        error: 'Erreur lors de l\'inscription',
                        details: createResult.message || 'Erreur inconnue'
                    })
                };
            }
            
            subscriberId = createResult.data?.id;
            subscriberData = createResult;
            console.log(`✅ Contact créé: ${email} (ID: ${subscriberId})`);
        }

        // ÉTAPE 3: Ajouter au groupe (séparément pour garantir l'ajout)
        if (subscriberId && targetGroupId) {
            try {
                console.log(`📁 Ajout au groupe ${targetGroupId}...`);
                
                const groupResponse = await fetch(`https://connect.mailerlite.com/api/subscribers/${subscriberId}/groups/${targetGroupId}`, {
                    method: 'POST',
                    headers: headers
                });

                if (groupResponse.ok) {
                    console.log(`✅ Contact ajouté au groupe ${targetGroupId}`);
                } else {
                    const groupError = await groupResponse.json();
                    // 422 signifie souvent "déjà dans le groupe", ce n'est pas une erreur critique
                    if (groupResponse.status !== 422) {
                        console.error('⚠️ Erreur ajout groupe:', groupError);
                    } else {
                        console.log(`ℹ️ Contact déjà dans le groupe ${targetGroupId}`);
                    }
                }
            } catch (groupErr) {
                console.error('⚠️ Exception ajout groupe:', groupErr);
            }
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
                id: subscriberId,
                message: contactExists ? 'Contact mis à jour' : 'Inscription réussie',
                updated: contactExists
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
