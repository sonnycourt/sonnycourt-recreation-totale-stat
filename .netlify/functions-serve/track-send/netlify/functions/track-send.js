"use strict";

// netlify/functions/track-send.js
var UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
var UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
async function redis(command, ...args) {
  const response = await fetch(`${UPSTASH_URL}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify([command, ...args])
  });
  return response.json();
}
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    console.error("Upstash not configured");
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Tracking not configured" }) };
  }
  try {
    const { template } = JSON.parse(event.body || "{}");
    if (!template) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Template required" }) };
    }
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    await redis("HINCRBY", "cc:sends:total", template, 1);
    await redis("HINCRBY", `cc:sends:${today}`, template, 1);
    await redis("HSET", "cc:sends:last", template, today);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, template })
    };
  } catch (error) {
    console.error("Track send error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Tracking failed" })
    };
  }
};
//# sourceMappingURL=track-send.js.map
