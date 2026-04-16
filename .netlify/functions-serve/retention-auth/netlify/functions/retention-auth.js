"use strict";

// netlify/functions/retention-auth.js
var crypto = require("crypto");
var PASSWORD_ENV = "RETENTION_DASHBOARD_PASSWORD";
var COOKIE_NAME = "retention_dashboard_auth";
var COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12;
function jsonResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}
function decodeBody(event) {
  if (!event.body) return "";
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64").toString("utf8");
  }
  return event.body;
}
function expectedToken() {
  const password = process.env[PASSWORD_ENV] || "";
  return crypto.createHash("sha256").update(password).digest("hex");
}
function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  const parts = cookieHeader.split(";");
  const cookies = {};
  for (const part of parts) {
    const [name, ...rest] = part.trim().split("=");
    if (!name) continue;
    cookies[name] = decodeURIComponent(rest.join("=") || "");
  }
  return cookies;
}
function isSecureRequest(event) {
  const proto = event.headers["x-forwarded-proto"] || event.headers["X-Forwarded-Proto"];
  return proto === "https";
}
function buildAuthCookie(token, secure) {
  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax"
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}
function buildClearCookie(secure) {
  const attributes = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax"
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}
exports.handler = async (event) => {
  const configuredPassword = process.env[PASSWORD_ENV];
  if (!configuredPassword) {
    return jsonResponse(500, { error: `${PASSWORD_ENV} is missing` });
  }
  const secure = isSecureRequest(event);
  const token = expectedToken();
  const cookies = parseCookies(event.headers.cookie || event.headers.Cookie || "");
  const isAuthenticated = cookies[COOKIE_NAME] === token;
  if (event.httpMethod === "GET") {
    return jsonResponse(200, { authenticated: isAuthenticated });
  }
  if (event.httpMethod === "DELETE") {
    return jsonResponse(
      200,
      { success: true },
      { "Set-Cookie": buildClearCookie(secure) }
    );
  }
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }
  try {
    const payload = JSON.parse(decodeBody(event) || "{}");
    const password = payload.password || "";
    if (password !== configuredPassword) {
      return jsonResponse(401, { error: "Mot de passe invalide" });
    }
    return jsonResponse(
      200,
      { success: true },
      { "Set-Cookie": buildAuthCookie(token, secure) }
    );
  } catch (error) {
    console.error("retention-auth error:", error);
    return jsonResponse(500, { error: "Internal server error" });
  }
};
//# sourceMappingURL=retention-auth.js.map
