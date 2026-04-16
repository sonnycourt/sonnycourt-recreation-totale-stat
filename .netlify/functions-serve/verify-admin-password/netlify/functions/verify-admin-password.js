"use strict";

// netlify/functions/verify-admin-password.cjs
var handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: ""
    };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }
  try {
    const requestBody = JSON.parse(event.body || "{}");
    const submittedPassword = requestBody.password || "";
    const correctPassword = process.env.ADMIN_MONITORING_CC_PACK_PASSWORD;
    if (!correctPassword) {
      console.error("\u274C ADMIN_MONITORING_CC_PACK_PASSWORD not configured");
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Configuration serveur manquante" })
      };
    }
    const isValid = submittedPassword === correctPassword;
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ valid: isValid })
    };
  } catch (error) {
    console.error("\u274C Erreur verify-admin-password:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};
module.exports = { handler };
//# sourceMappingURL=verify-admin-password.js.map
