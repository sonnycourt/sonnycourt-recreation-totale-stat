"use strict";

// netlify/functions/subscribe.js
async function detectLocationFromIP(ip) {
  if (!ip) return { country: null, city: null };
  try {
    const cleanIP = ip.split(",")[0].trim();
    if (cleanIP === "127.0.0.1" || cleanIP.startsWith("192.168.") || cleanIP.startsWith("10.") || cleanIP.startsWith("172.")) {
      return { country: null, city: null };
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2e3);
    const response = await fetch(`https://ipapi.co/${cleanIP}/json/`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Netlify-Function/1.0"
      }
    });
    clearTimeout(timeoutId);
    if (response.ok) {
      const data = await response.json();
      console.log(`\u{1F4E1} R\xE9ponse ipapi.co pour IP ${cleanIP}:`, JSON.stringify({ country: data.country_name || data.country, city: data.city }));
      return {
        country: data.country_name || data.country || null,
        city: data.city || null
      };
    } else {
      console.log(`\u26A0\uFE0F R\xE9ponse ipapi.co non OK pour IP ${cleanIP}: status ${response.status}`);
    }
    return { country: null, city: null };
  } catch (error) {
    console.log(`\u26A0\uFE0F Erreur d\xE9tection localisation pour IP ${ip}:`, error.message);
    return { country: null, city: null };
  }
}
function getClientIP(event) {
  const headers = event.headers || {};
  const forwardedFor = headers["x-forwarded-for"] || headers["X-Forwarded-For"];
  const nfClientIP = headers["x-nf-client-connection-ip"] || headers["X-Nf-Client-Connection-Ip"];
  const clientIP = headers["client-ip"] || headers["Client-Ip"];
  console.log("\u{1F50D} Headers IP disponibles:", {
    "x-forwarded-for": forwardedFor,
    "x-nf-client-connection-ip": nfClientIP,
    "client-ip": clientIP
  });
  if (nfClientIP) {
    console.log("\u2705 IP r\xE9cup\xE9r\xE9e depuis x-nf-client-connection-ip:", nfClientIP);
    return nfClientIP;
  }
  if (forwardedFor) {
    console.log("\u2705 IP r\xE9cup\xE9r\xE9e depuis x-forwarded-for:", forwardedFor);
    return forwardedFor;
  }
  if (clientIP) {
    console.log("\u2705 IP r\xE9cup\xE9r\xE9e depuis client-ip:", clientIP);
    return clientIP;
  }
  if (event.requestContext && event.requestContext.identity) {
    const sourceIp = event.requestContext.identity.sourceIp;
    if (sourceIp) {
      console.log("\u2705 IP r\xE9cup\xE9r\xE9e depuis requestContext:", sourceIp);
      return sourceIp;
    }
  }
  console.log("\u26A0\uFE0F Aucune IP trouv\xE9e dans les headers");
  return null;
}
exports.handler = async (event, context) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: JSON.stringify({
        country_code: null
      })
    };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }
  try {
    const { email, groupId, prenom, nom, telephone, countryCode, country, city, uniqueToken, uniqueTokenManifest, uniqueTokenCC, uniqueTokenSSR } = JSON.parse(event.body);
    if (!email || !email.includes("@")) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Email invalide" })
      };
    }
    const apiKey = process.env.MAILERLITE_API_KEY;
    if (!apiKey) {
      console.error("MAILERLITE_API_KEY not found in environment variables");
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Configuration serveur manquante" })
      };
    }
    let targetGroupId;
    if (groupId === "WAITLIST_SSR_2026") {
      targetGroupId = process.env.MAILERLITE_GROUP_SSR_WAITINGLIST_2026_EVERGREEN;
    } else if (groupId === "SSR_2026_EVERGREEN") {
      targetGroupId = process.env.MAILERLITE_GROUP_SSR_2026_EVERGREEN;
    } else if (groupId === "COURTCIRCUIT_2") {
      targetGroupId = process.env.MAILERLITE_GROUP_COURTCIRCUIT_2;
    } else {
      targetGroupId = groupId || process.env.MAILERLITE_GROUP_SSR_2026_EVERGREEN || process.env.MAILERLITE_GROUP_COURTCIRCUIT || "172875888042443786";
    }
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
      const fullPhone = countryCode ? `${countryCode}${telephone.replace(/\s/g, "")}` : telephone;
      fields.phone = fullPhone;
    }
    let detectedCountry = country;
    let detectedCity = city;
    const clientIP = getClientIP(event);
    console.log(`\u{1F50D} Tentative d\xE9tection localisation pour ${email}, IP: ${clientIP || "non trouv\xE9e"}`);
    if (clientIP) {
      try {
        console.log(`\u{1F504} D\xE9marrage d\xE9tection IP pour ${email}...`);
        const locationPromise = detectLocationFromIP(clientIP);
        const timeoutPromise = new Promise((resolve) => setTimeout(() => {
          console.log(`\u23F1\uFE0F Timeout d\xE9tection IP pour ${email} (1.5s)`);
          resolve({ country: null, city: null });
        }, 1500));
        const location = await Promise.race([locationPromise, timeoutPromise]);
        console.log(`\u{1F4CA} R\xE9sultat d\xE9tection pour ${email}:`, JSON.stringify(location));
        if (!detectedCountry && location.country) {
          detectedCountry = location.country;
          console.log(`\u{1F30D} Pays d\xE9tect\xE9 c\xF4t\xE9 serveur pour ${email}: ${detectedCountry}`);
        } else if (detectedCountry) {
          console.log(`\u2705 Pays fourni par le client pour ${email}: ${detectedCountry}`);
        }
        if (!detectedCity && location.city) {
          detectedCity = location.city;
          console.log(`\u{1F3D9}\uFE0F Ville d\xE9tect\xE9e c\xF4t\xE9 serveur pour ${email}: ${detectedCity}`);
        } else if (detectedCity) {
          console.log(`\u2705 Ville fournie par le client pour ${email}: ${detectedCity}`);
        } else {
          console.log(`\u26A0\uFE0F Aucune ville dans la r\xE9ponse pour ${email}`);
        }
        if (!detectedCountry && !detectedCity) {
          console.log(`\u26A0\uFE0F Aucune localisation d\xE9tect\xE9e pour ${email} (IP: ${clientIP})`);
        }
      } catch (error) {
        console.log(`\u26A0\uFE0F Erreur d\xE9tection localisation pour ${email}:`, error.message);
      }
    } else {
      console.log(`\u26A0\uFE0F IP non disponible pour ${email}`);
      if (detectedCountry) {
        console.log(`\u2705 Pays fourni par le client pour ${email}: ${detectedCountry}`);
      }
    }
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "application/json"
    };
    let countryFieldName = null;
    let cityFieldName = null;
    try {
      const fieldsResponse = await fetch("https://connect.mailerlite.com/api/fields", {
        method: "GET",
        headers
      });
      if (fieldsResponse.ok) {
        const fieldsData = await fieldsResponse.json();
        const countryField = fieldsData.data?.find(
          (field) => field.key && field.key.toLowerCase() === "location"
        );
        if (countryField) {
          countryFieldName = countryField.key;
          console.log(`\u{1F50D} Champ location trouv\xE9 dans MailerLite: "${countryFieldName}"`);
        } else {
          const fallbackField = fieldsData.data?.find(
            (field) => field.key && field.key.toLowerCase().includes("country")
          );
          if (fallbackField) {
            countryFieldName = fallbackField.key;
            console.log(`\u{1F50D} Champ pays (fallback) trouv\xE9 dans MailerLite: "${countryFieldName}"`);
          } else {
            console.log(`\u26A0\uFE0F Aucun champ location/country trouv\xE9 dans MailerLite`);
          }
        }
        const cityField = fieldsData.data?.find(
          (field) => field.key && (field.key.toLowerCase().includes("city") || field.key.toLowerCase().includes("ville"))
        );
        if (cityField) {
          cityFieldName = cityField.key;
          console.log(`\u{1F50D} Champ ville trouv\xE9 dans MailerLite: "${cityFieldName}"`);
        } else {
          console.log(`\u26A0\uFE0F Aucun champ ville trouv\xE9 dans MailerLite`);
        }
      }
    } catch (e) {
      console.log(`\u26A0\uFE0F Impossible de r\xE9cup\xE9rer les champs MailerLite: ${e.message}`);
    }
    if (detectedCountry) {
      if (countryFieldName) {
        fields[countryFieldName] = detectedCountry;
        console.log(`\u{1F4DD} Pays ajout\xE9 dans le champ location: ${countryFieldName} = ${detectedCountry}`);
      } else {
        fields.location = detectedCountry;
        fields.Location = detectedCountry;
        console.log(`\u{1F4DD} Pays ajout\xE9 dans location (fallback): ${detectedCountry}`);
      }
    } else {
      console.log(`\u26A0\uFE0F Aucun pays \xE0 ajouter pour ${email}`);
    }
    if (detectedCity) {
      if (cityFieldName) {
        fields[cityFieldName] = detectedCity;
        console.log(`\u{1F4DD} Ville ajout\xE9e avec le nom exact du champ: ${cityFieldName} = ${detectedCity}`);
      } else {
        fields.City = detectedCity;
        fields.city = detectedCity;
        fields.Ville = detectedCity;
        fields.ville = detectedCity;
        console.log(`\u{1F4DD} Ville ajout\xE9e aux fields (variantes): ${detectedCity}`);
      }
    }
    if (uniqueToken) {
      fields.unique_token_es = uniqueToken;
    }
    if (uniqueTokenManifest) {
      fields.unique_token_manifest = uniqueTokenManifest;
    }
    if (uniqueTokenCC) {
      fields.unique_token_cc = uniqueTokenCC;
    }
    if (uniqueTokenSSR) {
      fields.unique_token_ssr = uniqueTokenSSR;
    }
    let subscriberId = null;
    let contactExists = false;
    try {
      const checkResponse = await fetch(`https://connect.mailerlite.com/api/subscribers/${encodeURIComponent(email)}`, {
        method: "GET",
        headers
      });
      if (checkResponse.ok) {
        const existingData = await checkResponse.json();
        subscriberId = existingData.data?.id;
        contactExists = true;
        console.log(`\u2705 Contact existant trouv\xE9: ${email} (ID: ${subscriberId})`);
      }
    } catch (e) {
      console.log(`\u2139\uFE0F Contact n'existe pas encore: ${email}`);
    }
    let subscriberData;
    let mailerliteResponse;
    if (contactExists && subscriberId) {
      const updateData = {
        status: "active"
      };
      if (Object.keys(fields).length > 0) {
        updateData.fields = fields;
      }
      console.log(`\u{1F504} Mise \xE0 jour du contact ${email} avec:`, JSON.stringify(updateData, null, 2));
      mailerliteResponse = await fetch(`https://connect.mailerlite.com/api/subscribers/${subscriberId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(updateData)
      });
      const updateResult = await mailerliteResponse.json();
      if (!mailerliteResponse.ok) {
        console.error("\u274C Erreur mise \xE0 jour:", updateResult);
      } else {
        console.log(`\u2705 Contact mis \xE0 jour: ${email}`);
        subscriberData = updateResult;
      }
    } else {
      const createData = {
        email,
        status: "active"
      };
      if (Object.keys(fields).length > 0) {
        createData.fields = fields;
      }
      console.log(`\u2795 Cr\xE9ation du contact ${email} avec:`, JSON.stringify(createData, null, 2));
      mailerliteResponse = await fetch("https://connect.mailerlite.com/api/subscribers", {
        method: "POST",
        headers,
        body: JSON.stringify(createData)
      });
      const createResult = await mailerliteResponse.json();
      if (!mailerliteResponse.ok) {
        console.error("\u274C Erreur cr\xE9ation:", createResult);
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Erreur lors de l'inscription",
            details: createResult.message || "Erreur inconnue"
          })
        };
      }
      subscriberId = createResult.data?.id;
      subscriberData = createResult;
      console.log(`\u2705 Contact cr\xE9\xE9: ${email} (ID: ${subscriberId})`);
    }
    if (subscriberId && targetGroupId) {
      try {
        console.log(`\u{1F4C1} Ajout au groupe ${targetGroupId}...`);
        const groupResponse = await fetch(`https://connect.mailerlite.com/api/subscribers/${subscriberId}/groups/${targetGroupId}`, {
          method: "POST",
          headers
        });
        if (groupResponse.ok) {
          console.log(`\u2705 Contact ajout\xE9 au groupe ${targetGroupId}`);
        } else {
          const groupError = await groupResponse.json();
          if (groupResponse.status !== 422) {
            console.error("\u26A0\uFE0F Erreur ajout groupe:", groupError);
          } else {
            console.log(`\u2139\uFE0F Contact d\xE9j\xE0 dans le groupe ${targetGroupId}`);
          }
        }
      } catch (groupErr) {
        console.error("\u26A0\uFE0F Exception ajout groupe:", groupErr);
      }
    }
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: JSON.stringify({
        success: true,
        id: subscriberId,
        message: contactExists ? "Contact mis \xE0 jour" : "Inscription r\xE9ussie",
        updated: contactExists,
        country_code: detectedCountry || null
      })
    };
  } catch (error) {
    console.error("Error in subscribe function:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Erreur serveur",
        details: error.message
      })
    };
  }
};
//# sourceMappingURL=subscribe.js.map
