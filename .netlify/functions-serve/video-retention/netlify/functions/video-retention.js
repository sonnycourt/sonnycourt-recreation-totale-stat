"use strict";

// netlify/functions/video-retention.js
var SUPABASE_URL = process.env.SUPABASE_URL;
var SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
var ALLOWED_VIDEO_IDS = /* @__PURE__ */ new Set([
  "/video-manifest/",
  "/es-video/",
  "/systeme-souhaits-realises-video/",
  "/ssr-cadeau/"
]);
var ALLOWED_VARIANTS = /* @__PURE__ */ new Set(["original", "nouveau-timer"]);
function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
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
function sanitizeSeconds(seconds) {
  if (!Array.isArray(seconds)) return [];
  const unique = /* @__PURE__ */ new Set();
  for (const value of seconds) {
    const second = Number(value);
    if (!Number.isInteger(second)) continue;
    if (second < 0 || second > 60 * 60 * 8) continue;
    unique.add(second);
  }
  return Array.from(unique).sort((a, b) => a - b);
}
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(204, {});
  }
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(500, { error: "Supabase env vars missing" });
  }
  try {
    const payload = JSON.parse(decodeBody(event) || "{}");
    const videoId = payload.video_id;
    const variant = typeof payload.variant === "string" ? payload.variant : "original";
    const seconds = sanitizeSeconds(payload.seconds);
    if (!ALLOWED_VIDEO_IDS.has(videoId)) {
      return jsonResponse(400, { error: "Invalid video_id" });
    }
    if (!ALLOWED_VARIANTS.has(variant)) {
      return jsonResponse(400, { error: "Invalid variant" });
    }
    if (seconds.length === 0) {
      return jsonResponse(200, { success: true, inserted: 0 });
    }
    const rpcUrl = `${SUPABASE_URL}/rest/v1/rpc/increment_video_retention`;
    const rpcResponse = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        p_video_id: videoId,
        p_seconds: seconds,
        p_variant: variant
      })
    });
    if (!rpcResponse.ok) {
      const details = await rpcResponse.text();
      console.error("Supabase RPC error:", details);
      return jsonResponse(502, { error: "Supabase RPC failed" });
    }
    return jsonResponse(200, { success: true, inserted: seconds.length });
  } catch (error) {
    console.error("video-retention error:", error);
    return jsonResponse(500, { error: "Internal server error" });
  }
};
//# sourceMappingURL=video-retention.js.map
