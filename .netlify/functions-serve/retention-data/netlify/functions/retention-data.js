"use strict";

// netlify/functions/retention-data.js
var crypto = require("crypto");
var SUPABASE_URL = process.env.SUPABASE_URL;
var SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
var PASSWORD_ENV = "RETENTION_DASHBOARD_PASSWORD";
var COOKIE_NAME = "retention_dashboard_auth";
var VIDEO_OPTIONS = [
  { id: "/video-manifest/", label: "Manifest" },
  { id: "/es-video/", label: "Esprit Subconscient" },
  { id: "/systeme-souhaits-realises-video/", label: "Systeme Souhaits Realises" },
  { id: "/ssr-cadeau/", label: "SSR Cadeau" }
];
var ALLOWED_VIDEO_IDS = new Set(VIDEO_OPTIONS.map((v) => v.id));
function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
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
function expectedToken() {
  const password = process.env[PASSWORD_ENV] || "";
  return crypto.createHash("sha256").update(password).digest("hex");
}
function buildRetentionPoints(rows) {
  if (!rows.length) {
    return {
      baseline_views: 0,
      points: []
    };
  }
  const bySecond = /* @__PURE__ */ new Map();
  let baselineViews = 0;
  let maxSecond = 0;
  for (const row of rows) {
    const second = Number(row.second_watched);
    const views = Number(row.views_count || 0);
    if (!Number.isInteger(second) || second < 0) continue;
    bySecond.set(second, views);
    if (second === 0) baselineViews = views;
    if (second > maxSecond) maxSecond = second;
  }
  const points = [];
  for (let second = 0; second <= maxSecond; second += 1) {
    const views = bySecond.get(second) || 0;
    const retention = baselineViews > 0 ? Number((views / baselineViews * 100).toFixed(2)) : 0;
    points.push({
      second,
      views,
      retention_percent: retention
    });
  }
  return {
    baseline_views: baselineViews,
    points
  };
}
exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(500, { error: "Supabase env vars missing" });
  }
  if (!process.env[PASSWORD_ENV]) {
    return jsonResponse(500, { error: `${PASSWORD_ENV} is missing` });
  }
  const cookies = parseCookies(event.headers.cookie || event.headers.Cookie || "");
  if (cookies[COOKIE_NAME] !== expectedToken()) {
    return jsonResponse(401, { error: "Unauthorized" });
  }
  const rawVideoId = event.queryStringParameters && event.queryStringParameters.video_id;
  const videoId = rawVideoId || VIDEO_OPTIONS[0].id;
  if (!ALLOWED_VIDEO_IDS.has(videoId)) {
    return jsonResponse(400, { error: "Invalid video_id" });
  }
  try {
    const url = `${SUPABASE_URL}/rest/v1/video_retention?select=second_watched,views_count&video_id=eq.${encodeURIComponent(videoId)}&variant=eq.original&order=second_watched.asc`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    if (!response.ok) {
      const details = await response.text();
      console.error("Supabase retention-data error:", details);
      return jsonResponse(502, { error: "Supabase query failed" });
    }
    const rows = await response.json();
    const { baseline_views, points } = buildRetentionPoints(rows);
    return jsonResponse(200, {
      video_id: videoId,
      baseline_views,
      points,
      videos: VIDEO_OPTIONS
    });
  } catch (error) {
    console.error("retention-data error:", error);
    return jsonResponse(500, { error: "Internal server error" });
  }
};
//# sourceMappingURL=retention-data.js.map
