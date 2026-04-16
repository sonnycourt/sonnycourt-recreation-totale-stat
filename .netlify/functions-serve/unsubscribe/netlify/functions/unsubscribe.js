"use strict";

// netlify/functions/unsubscribe.js
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "GET") {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: "ok",
        mailerlite_configured: !!process.env.MAILERLITE_API_KEY
      })
    };
  }
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  const apiKey = process.env.MAILERLITE_API_KEY;
  console.log("MAILERLITE_API_KEY configured:", !!apiKey);
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Service non configur\xE9",
        debug: "Variable MAILERLITE_API_KEY manquante dans Netlify"
      })
    };
  }
  try {
    const { email } = JSON.parse(event.body || "{}");
    console.log("Unsubscribe request for:", email);
    if (!email || !email.includes("@")) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Email invalide" }) };
    }
    const mailerliteHeaders = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    };
    console.log("\u{1F50D} R\xE9cup\xE9ration du subscriber depuis MailerLite...");
    const getResponse = await fetch(`https://connect.mailerlite.com/api/subscribers/${encodeURIComponent(email)}`, {
      method: "GET",
      headers: mailerliteHeaders
    });
    if (!getResponse.ok) {
      if (getResponse.status === 404) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, message: "Email non trouv\xE9 ou d\xE9j\xE0 d\xE9sinscrit" })
        };
      }
      const errorText = await getResponse.text();
      console.error("\u274C Erreur r\xE9cup\xE9ration subscriber:", getResponse.status, errorText);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "Erreur MailerLite lors de la r\xE9cup\xE9ration",
          status: getResponse.status,
          details: errorText.substring(0, 500)
        })
      };
    }
    const subscriberData = await getResponse.json();
    const subscriberId = subscriberData.data?.id;
    if (!subscriberId) {
      console.error("\u274C Subscriber ID non trouv\xE9 dans la r\xE9ponse");
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Impossible de r\xE9cup\xE9rer l'ID du subscriber" })
      };
    }
    console.log(`\u2705 Subscriber trouv\xE9: ${email} (ID: ${subscriberId})`);
    console.log('\u{1F4E4} Mise \xE0 jour du status \xE0 "unsubscribed"...');
    const updateResponse = await fetch(`https://connect.mailerlite.com/api/subscribers/${subscriberId}`, {
      method: "PUT",
      headers: mailerliteHeaders,
      body: JSON.stringify({
        status: "unsubscribed"
      })
    });
    const responseText = await updateResponse.text();
    console.log("MailerLite response status:", updateResponse.status);
    console.log("MailerLite response body:", responseText);
    if (!updateResponse.ok) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "Erreur MailerLite lors de la d\xE9sinscription",
          status: updateResponse.status,
          details: responseText.substring(0, 500)
        })
      };
    }
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: "D\xE9sinscription r\xE9ussie" })
    };
  } catch (error) {
    console.error("Unsubscribe error:", error.message, error.stack);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Erreur serveur",
        details: error.message
      })
    };
  }
};
//# sourceMappingURL=unsubscribe.js.map
