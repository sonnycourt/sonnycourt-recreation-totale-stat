"use strict";

// netlify/functions/update-listmonk-phone.js
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  try {
    const { email, phone } = JSON.parse(event.body);
    if (!email || !phone) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Email et t\xE9l\xE9phone requis" })
      };
    }
    const LISTMONK_URL = process.env.LISTMONK_API_URL || "https://mail.sonnycourt.com";
    const LISTMONK_USER = process.env.LISTMONK_USER;
    const LISTMONK_PASS = process.env.LISTMONK_PASS;
    if (!LISTMONK_USER || !LISTMONK_PASS) {
      console.error("Credentials Listmonk manquantes");
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Configuration serveur manquante" })
      };
    }
    const authHeader = "Basic " + Buffer.from(`${LISTMONK_USER}:${LISTMONK_PASS}`).toString("base64");
    const searchResponse = await fetch(
      `${LISTMONK_URL}/api/subscribers?query=subscribers.email='${encodeURIComponent(email)}'`,
      {
        method: "GET",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json"
        }
      }
    );
    if (!searchResponse.ok) {
      console.error("Erreur recherche subscriber:", await searchResponse.text());
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Erreur recherche subscriber" })
      };
    }
    const searchData = await searchResponse.json();
    if (!searchData.data || !searchData.data.results || searchData.data.results.length === 0) {
      console.log("Subscriber non trouv\xE9:", email);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Subscriber non trouv\xE9" })
      };
    }
    const subscriber = searchData.data.results[0];
    const subscriberId = subscriber.id;
    const currentAttribs = subscriber.attribs || {};
    const updatedAttribs = { ...currentAttribs, phone };
    const updateResponse = await fetch(
      `${LISTMONK_URL}/api/subscribers/${subscriberId}`,
      {
        method: "PUT",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: subscriber.email,
          name: subscriber.name,
          status: subscriber.status,
          attribs: updatedAttribs
        })
      }
    );
    if (!updateResponse.ok) {
      console.error("Erreur mise \xE0 jour subscriber:", await updateResponse.text());
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Erreur mise \xE0 jour subscriber" })
      };
    }
    console.log(`Subscriber ${email} mis \xE0 jour avec t\xE9l\xE9phone: ${phone}`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: "T\xE9l\xE9phone mis \xE0 jour",
        email,
        phone
      })
    };
  } catch (error) {
    console.error("Erreur:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Erreur serveur", details: error.message })
    };
  }
};
//# sourceMappingURL=update-listmonk-phone.js.map
