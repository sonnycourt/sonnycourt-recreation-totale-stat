"use strict";

// netlify/functions/check-ssr-token.js
exports.handler = async (event, context) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS"
      },
      body: ""
    };
  }
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }
  try {
    const email = event.queryStringParameters?.email;
    if (!email || !email.includes("@")) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Email invalide ou manquant" })
      };
    }
    const apiKey = process.env.MAILERLITE_API_KEY;
    if (!apiKey) {
      console.error("MAILERLITE_API_KEY not found in environment variables");
      return {
        statusCode: 500,
        headers: {
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Configuration serveur manquante" })
      };
    }
    const ssrGroupId = process.env.MAILERLITE_GROUP_SSR_2026_EVERGREEN;
    if (!ssrGroupId) {
      console.error("MAILERLITE_GROUP_SSR_2026_EVERGREEN not found in environment variables");
      return {
        statusCode: 500,
        headers: {
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Configuration groupe SSR manquante" })
      };
    }
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "application/json"
    };
    let subscriberData = null;
    let subscriberId = null;
    try {
      const checkResponse = await fetch(`https://connect.mailerlite.com/api/subscribers/${encodeURIComponent(email)}`, {
        method: "GET",
        headers
      });
      if (checkResponse.ok) {
        subscriberData = await checkResponse.json();
        subscriberId = subscriberData.data?.id;
        console.log(`\u2705 Contact trouv\xE9: ${email} (ID: ${subscriberId})`);
      } else {
        return {
          statusCode: 200,
          headers: {
            "Access-Control-Allow-Origin": "*"
          },
          body: JSON.stringify({
            exists: false,
            inGroup: false,
            token: null
          })
        };
      }
    } catch (e) {
      console.log(`\u2139\uFE0F Erreur lors de la v\xE9rification du contact: ${e.message}`);
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
          exists: false,
          inGroup: false,
          token: null
        })
      };
    }
    const uniqueTokenSSR = subscriberData.data?.fields?.unique_token_ssr || null;
    if (uniqueTokenSSR) {
      console.log(`\u2705 Token SSR trouv\xE9 pour ${email}: ${uniqueTokenSSR}`);
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
          exists: true,
          hasToken: true,
          token: uniqueTokenSSR
        })
      };
    }
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        exists: true,
        hasToken: false,
        token: null
      })
    };
  } catch (error) {
    console.error("Error in check-ssr-token function:", error);
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        error: "Erreur serveur",
        details: error.message
      })
    };
  }
};
//# sourceMappingURL=check-ssr-token.js.map
