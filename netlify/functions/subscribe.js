// Fonction pour détecter le pays et la ville depuis l'IP côté serveur
async function detectLocationFromIP(ip) {
    if (!ip) return { country: null, city: null };
    
    try {
        // Nettoyer l'IP (prendre la première si plusieurs dans x-forwarded-for)
        const cleanIP = ip.split(',')[0].trim();
        
        // Éviter les IPs locales/internes
        if (cleanIP === '127.0.0.1' || cleanIP.startsWith('192.168.') || cleanIP.startsWith('10.') || cleanIP.startsWith('172.')) {
            return { country: null, city: null };
        }
        
        // Requête à ipapi.co avec timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // Timeout de 2 secondes
        
        const response = await fetch(`https://ipapi.co/${cleanIP}/json/`, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Netlify-Function/1.0'
            }
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
            const data = await response.json();
            console.log(`📡 Réponse ipapi.co pour IP ${cleanIP}:`, JSON.stringify({ country: data.country_name || data.country, city: data.city }));
            // Retourner le pays et la ville
            return {
                country: data.country_name || data.country || null,
                city: data.city || null
            };
        } else {
            console.log(`⚠️ Réponse ipapi.co non OK pour IP ${cleanIP}: status ${response.status}`);
        }
        
        return { country: null, city: null };
    } catch (error) {
        // Erreur silencieuse - on continue sans localisation
        console.log(`⚠️ Erreur détection localisation pour IP ${ip}:`, error.message);
        return { country: null, city: null };
    }
}

// Fonction pour extraire l'IP depuis les headers Netlify
function getClientIP(event) {
    // Netlify met l'IP dans x-forwarded-for ou x-nf-client-connection-ip
    // Les headers sont en minuscules dans Netlify Functions
    const headers = event.headers || {};
    const forwardedFor = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
    const nfClientIP = headers['x-nf-client-connection-ip'] || headers['X-Nf-Client-Connection-Ip'];
    const clientIP = headers['client-ip'] || headers['Client-Ip'];
    
    // Debug: logger les headers pour diagnostic
    console.log('🔍 Headers IP disponibles:', {
        'x-forwarded-for': forwardedFor,
        'x-nf-client-connection-ip': nfClientIP,
        'client-ip': clientIP
    });
    
    // Priorité : x-nf-client-connection-ip > x-forwarded-for > client-ip
    if (nfClientIP) {
        console.log('✅ IP récupérée depuis x-nf-client-connection-ip:', nfClientIP);
        return nfClientIP;
    }
    if (forwardedFor) {
        console.log('✅ IP récupérée depuis x-forwarded-for:', forwardedFor);
        return forwardedFor;
    }
    if (clientIP) {
        console.log('✅ IP récupérée depuis client-ip:', clientIP);
        return clientIP;
    }
    
    // Fallback pour AWS Lambda
    if (event.requestContext && event.requestContext.identity) {
        const sourceIp = event.requestContext.identity.sourceIp;
        if (sourceIp) {
            console.log('✅ IP récupérée depuis requestContext:', sourceIp);
            return sourceIp;
        }
    }
    
    console.log('⚠️ Aucune IP trouvée dans les headers');
    return null;
}

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
            body: JSON.stringify({
                country_code: null
            })
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
        const { email, groupId, prenom, nom, telephone, countryCode, country, city, uniqueToken, uniqueTokenManifest, uniqueTokenCC, uniqueTokenSSR } = JSON.parse(event.body);

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
        } else if (groupId === 'COURTCIRCUIT_2') {
            // Court-Circuit version 2 (avec Quiz)
            targetGroupId = process.env.MAILERLITE_GROUP_COURTCIRCUIT_2;
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
        
        // Détection automatique du pays et de la ville côté serveur
        // On détecte toujours l'IP pour récupérer la ville, même si le pays est fourni
        let detectedCountry = country;
        let detectedCity = city; // Utiliser la ville fournie par le client si disponible
        
        const clientIP = getClientIP(event);
        console.log(`🔍 Tentative détection localisation pour ${email}, IP: ${clientIP || 'non trouvée'}`);
        
        if (clientIP) {
            // Détection avec timeout pour ne pas ralentir l'inscription
            try {
                console.log(`🔄 Démarrage détection IP pour ${email}...`);
                const locationPromise = detectLocationFromIP(clientIP);
                const timeoutPromise = new Promise((resolve) => setTimeout(() => {
                    console.log(`⏱️ Timeout détection IP pour ${email} (1.5s)`);
                    resolve({ country: null, city: null });
                }, 1500)); // Timeout de 1.5s
                const location = await Promise.race([locationPromise, timeoutPromise]);
                
                console.log(`📊 Résultat détection pour ${email}:`, JSON.stringify(location));
                
                // Utiliser le pays détecté seulement si non fourni par le client
                if (!detectedCountry && location.country) {
                    detectedCountry = location.country;
                    console.log(`🌍 Pays détecté côté serveur pour ${email}: ${detectedCountry}`);
                } else if (detectedCountry) {
                    console.log(`✅ Pays fourni par le client pour ${email}: ${detectedCountry}`);
                }
                
                // Utiliser la ville détectée depuis l'IP seulement si non fournie par le client
                if (!detectedCity && location.city) {
                    detectedCity = location.city;
                    console.log(`🏙️ Ville détectée côté serveur pour ${email}: ${detectedCity}`);
                } else if (detectedCity) {
                    console.log(`✅ Ville fournie par le client pour ${email}: ${detectedCity}`);
                } else {
                    console.log(`⚠️ Aucune ville dans la réponse pour ${email}`);
                }
                
                if (!detectedCountry && !detectedCity) {
                    console.log(`⚠️ Aucune localisation détectée pour ${email} (IP: ${clientIP})`);
                }
            } catch (error) {
                // Erreur silencieuse - on continue sans localisation
                console.log(`⚠️ Erreur détection localisation pour ${email}:`, error.message);
            }
        } else {
            console.log(`⚠️ IP non disponible pour ${email}`);
            if (detectedCountry) {
                console.log(`✅ Pays fourni par le client pour ${email}: ${detectedCountry}`);
            }
        }
        
        // Headers pour les appels API
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json'
        };

        // Récupérer les champs personnalisés disponibles dans MailerLite pour vérifier le nom exact
        let countryFieldName = null;
        let cityFieldName = null;
        try {
            const fieldsResponse = await fetch('https://connect.mailerlite.com/api/fields', {
                method: 'GET',
                headers: headers
            });
            if (fieldsResponse.ok) {
                const fieldsData = await fieldsResponse.json();
                // Chercher le champ "location" (utilisé pour le pays dans MailerLite)
                const countryField = fieldsData.data?.find(field => 
                    field.key && field.key.toLowerCase() === 'location'
                );
                if (countryField) {
                    countryFieldName = countryField.key;
                    console.log(`🔍 Champ location trouvé dans MailerLite: "${countryFieldName}"`);
                } else {
                    // Fallback: chercher "country" si "location" n'existe pas
                    const fallbackField = fieldsData.data?.find(field => 
                        field.key && field.key.toLowerCase().includes('country')
                    );
                    if (fallbackField) {
                        countryFieldName = fallbackField.key;
                        console.log(`🔍 Champ pays (fallback) trouvé dans MailerLite: "${countryFieldName}"`);
                    } else {
                        console.log(`⚠️ Aucun champ location/country trouvé dans MailerLite`);
                    }
                }
                
                // Chercher le champ qui contient "city" ou "ville" (insensible à la casse)
                const cityField = fieldsData.data?.find(field => 
                    field.key && (field.key.toLowerCase().includes('city') || field.key.toLowerCase().includes('ville'))
                );
                if (cityField) {
                    cityFieldName = cityField.key;
                    console.log(`🔍 Champ ville trouvé dans MailerLite: "${cityFieldName}"`);
                } else {
                    console.log(`⚠️ Aucun champ ville trouvé dans MailerLite`);
                }
            }
        } catch (e) {
            console.log(`⚠️ Impossible de récupérer les champs MailerLite: ${e.message}`);
        }

        // Ajouter le pays si fourni (priorité au pays envoyé depuis le client, sinon pays détecté)
        if (detectedCountry) {
            // Utiliser le nom exact du champ si trouvé, sinon essayer les variantes
            if (countryFieldName) {
                fields[countryFieldName] = detectedCountry;
                console.log(`📝 Pays ajouté dans le champ location: ${countryFieldName} = ${detectedCountry}`);
            } else {
                // Fallback: utiliser "location" par défaut (nom standard dans MailerLite)
                fields.location = detectedCountry;
                fields.Location = detectedCountry;
                console.log(`📝 Pays ajouté dans location (fallback): ${detectedCountry}`);
            }
        } else {
            console.log(`⚠️ Aucun pays à ajouter pour ${email}`);
        }

        // Ajouter la ville si détectée
        if (detectedCity) {
            // Utiliser le nom exact du champ si trouvé, sinon essayer les variantes
            if (cityFieldName) {
                fields[cityFieldName] = detectedCity;
                console.log(`📝 Ville ajoutée avec le nom exact du champ: ${cityFieldName} = ${detectedCity}`);
            } else {
                // Fallback: essayer les variantes communes
                fields.City = detectedCity;
                fields.city = detectedCity;
                fields.Ville = detectedCity;
                fields.ville = detectedCity;
                console.log(`📝 Ville ajoutée aux fields (variantes): ${detectedCity}`);
            }
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

            console.log(`🔄 Mise à jour du contact ${email} avec:`, JSON.stringify(updateData, null, 2));

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

            console.log(`➕ Création du contact ${email} avec:`, JSON.stringify(createData, null, 2));

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
                updated: contactExists,
                country_code: detectedCountry || null
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
