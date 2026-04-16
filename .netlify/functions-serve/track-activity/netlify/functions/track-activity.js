"use strict";

// netlify/functions/track-activity.js
var LISTMONK_URL = process.env.LISTMONK_URL || "http://168.119.238.147:9000";
var LISTMONK_USER = process.env.LISTMONK_USER || "api";
var LISTMONK_PASS = process.env.LISTMONK_PASS;
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  const email = event.queryStringParameters?.email;
  if (!email || !email.includes("@")) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Email invalide ou manquant" }) };
  }
  if (!LISTMONK_PASS) {
    console.error("LISTMONK_PASS not configured");
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Service not configured" }) };
  }
  const auth = Buffer.from(`${LISTMONK_USER}:${LISTMONK_PASS}`).toString("base64");
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  try {
    const searchUrl = `${LISTMONK_URL}/api/subscribers?query=subscribers.email='${encodeURIComponent(email)}'`;
    console.log("Searching subscriber:", searchUrl);
    const searchResponse = await fetch(searchUrl, {
      method: "GET",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json"
      }
    });
    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error("Listmonk search error:", searchResponse.status, errorText);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Erreur lors de la recherche", status: searchResponse.status })
      };
    }
    const searchData = await searchResponse.json();
    console.log("Search result:", JSON.stringify(searchData));
    if (!searchData.data?.results || searchData.data.results.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Subscriber non trouv\xE9", email })
      };
    }
    const subscriber = searchData.data.results[0];
    const subscriberId = subscriber.id;
    console.log("Found subscriber ID:", subscriberId);
    const updateUrl = `${LISTMONK_URL}/api/subscribers/${subscriberId}`;
    console.log("Updating subscriber:", updateUrl);
    const existingAttribs = subscriber.attribs || {};
    const updatedAttribs = {
      ...existingAttribs,
      last_click: today
    };
    const updateResponse = await fetch(updateUrl, {
      method: "PUT",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: subscriber.email,
        name: subscriber.name,
        status: subscriber.status,
        lists: subscriber.lists?.map((l) => l.id) || [],
        attribs: updatedAttribs
      })
    });
    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error("Listmonk update error:", updateResponse.status, errorText);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Erreur lors de la mise \xE0 jour", status: updateResponse.status })
      };
    }
    const updateData = await updateResponse.json();
    console.log("Update result:", JSON.stringify(updateData));
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        email,
        last_click: today,
        subscriber_id: subscriberId
      })
    };
  } catch (error) {
    console.error("Track activity error:", error.message, error.stack);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Erreur serveur", details: error.message })
    };
  }
};
//# sourceMappingURL=track-activity.js.map
