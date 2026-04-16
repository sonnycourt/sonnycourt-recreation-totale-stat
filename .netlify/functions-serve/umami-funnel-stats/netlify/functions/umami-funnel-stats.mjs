
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


// netlify/functions/lib/admin-es2-crypto.mjs
import crypto from "node:crypto";
var COOKIE_NAME = "admin_es2_session";
function b64urlDecode(str) {
  const pad = 4 - str.length % 4;
  const s = str.replace(/-/g, "+").replace(/_/g, "/") + (pad < 4 ? "=".repeat(pad) : "");
  return Buffer.from(s, "base64");
}
function verifySessionToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payloadB64 || !sig || sig.length !== 64) return null;
  const expected = crypto.createHmac("sha256", secret).update(payloadB64).digest("hex");
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let data;
  try {
    data = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
  if (!data || typeof data.exp !== "number" || data.exp < Date.now()) return null;
  return data;
}
function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  const out = {};
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(val);
  }
  return out;
}
function getSessionCookieValue(cookieHeader) {
  const c = parseCookies(cookieHeader || "");
  return c[COOKIE_NAME] || "";
}

// netlify/functions/lib/admin-es2-session-secret.mjs
import crypto2 from "node:crypto";

// netlify/functions/lib/supabase-rest.mjs
function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, key };
}

// netlify/functions/lib/admin-es2-session-secret.mjs
function getAdminEs2CookieSecret() {
  const { key } = getSupabaseConfig();
  if (!key || typeof key !== "string") return "";
  return crypto2.createHash("sha256").update(`admin-es2-cookie|${key}`).digest("hex");
}

// netlify/functions/lib/admin-es2-verify-cookie.mjs
function getSessionFromRequest(req) {
  const secret = getAdminEs2CookieSecret();
  if (!secret) return null;
  const raw = getSessionCookieValue(req.headers.get("cookie") || "");
  return verifySessionToken(raw, secret);
}

// netlify/functions/umami-funnel-stats.js
var FUNNEL_PAGES = [
  { path: "/masterclass", name: "Opt-in" },
  { path: "/masterclass/confirmation", name: "Confirmation" },
  { path: "/masterclass/session", name: "Session masterclass" },
  { path: "/invitation", name: "Invitation (sales)" },
  { path: "/masterclass/success", name: "Success" }
];
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function pct(num, den) {
  if (!den) return 0;
  return Number((num / den * 100).toFixed(1));
}
function normalizePath(value) {
  if (!value) return "";
  const s = String(value).trim();
  try {
    if (s.startsWith("http://") || s.startsWith("https://")) {
      const u = new URL(s);
      return `${u.pathname}${u.search || ""}`;
    }
  } catch {
  }
  return s;
}
function rowLabel(row) {
  return String(
    row.x ?? row.name ?? row.label ?? row.value ?? ""
  ).trim();
}
function rowValue(row) {
  return toNum(row.y ?? row.count ?? row.value ?? row.total ?? 0);
}
function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}
async function umamiLogin(baseUrl, username, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Umami login failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data?.token) throw new Error("Umami login succeeded without token");
  return data.token;
}
async function umamiGet(baseUrl, auth, path, params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === void 0 || v === null || v === "") return;
    qs.set(k, String(v));
  });
  const url = `${baseUrl}${path}?${qs.toString()}`;
  const res = await fetch(url, {
    headers: {
      ...auth.type === "api-key" ? { "x-umami-api-key": auth.value } : { Authorization: `Bearer ${auth.value}` }
    }
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Umami GET ${path} failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  return res.json();
}
function aggregateRows(rows) {
  const map = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const label = rowLabel(row);
    if (!label) continue;
    map.set(label, (map.get(label) || 0) + rowValue(row));
  }
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}
function normalizeSource(name) {
  const n = name.toLowerCase();
  if (!n || n === "(none)" || n === "direct" || n === "direct / none") return "Direct";
  if (n.includes("instagram") || n.includes("ig")) return "Instagram";
  if (n.includes("tiktok")) return "TikTok";
  if (n.includes("youtube") || n.includes("youtu.be")) return "YouTube";
  if (n.includes("mail") || n.includes("newsletter")) return "Email";
  return name;
}
function topSources(rows) {
  const agg = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const key = normalizeSource(r.name || "");
    agg.set(key, (agg.get(key) || 0) + toNum(r.value));
  }
  return [...agg.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 3);
}
function topCountries(rows) {
  return rows.map((r) => ({ name: (r.name || "Unknown").toUpperCase(), value: toNum(r.value) })).sort((a, b) => b.value - a.value).slice(0, 3);
}
function deviceSplit(rows) {
  const buckets = { mobile: 0, desktop: 0, tablet: 0 };
  for (const r of rows) {
    const n = (r.name || "").toLowerCase();
    const v = toNum(r.value);
    if (n.includes("mobile")) buckets.mobile += v;
    else if (n.includes("tablet")) buckets.tablet += v;
    else buckets.desktop += v;
  }
  const total = buckets.mobile + buckets.desktop + buckets.tablet;
  return {
    mobile: pct(buckets.mobile, total),
    desktop: pct(buckets.desktop, total),
    tablet: pct(buckets.tablet, total)
  };
}
async function resolveUrlVariants(baseUrl, auth, websiteId, startAt, endAt, pagePath) {
  const urlsRaw = await umamiGet(
    baseUrl,
    auth,
    `/api/websites/${websiteId}/metrics`,
    { startAt, endAt, type: "url", limit: 1e3 }
  );
  const rows = extractRows(urlsRaw);
  const variants = rows.map((r) => ({ path: normalizePath(rowLabel(r)), value: rowValue(r) })).filter((r) => r.path && r.path.startsWith(pagePath)).sort((a, b) => b.value - a.value).map((r) => r.path);
  if (variants.length) return variants;
  return [pagePath];
}
async function fetchVariantData(baseUrl, auth, websiteId, startAt, endAt, url) {
  const [statsRaw, sourcesRaw, countriesRaw, devicesRaw] = await Promise.all([
    umamiGet(baseUrl, auth, `/api/websites/${websiteId}/stats`, { startAt, endAt, url }),
    umamiGet(baseUrl, auth, `/api/websites/${websiteId}/metrics`, { startAt, endAt, type: "referrer", url, limit: 50 }),
    umamiGet(baseUrl, auth, `/api/websites/${websiteId}/metrics`, { startAt, endAt, type: "country", url, limit: 50 }),
    umamiGet(baseUrl, auth, `/api/websites/${websiteId}/metrics`, { startAt, endAt, type: "device", url, limit: 50 })
  ]);
  const stats = {
    pageviews: toNum(statsRaw?.pageviews),
    visitors: toNum(statsRaw?.visitors),
    bounces: toNum(statsRaw?.bounces),
    totaltime: toNum(statsRaw?.totaltime)
  };
  return {
    stats,
    sources: aggregateRows(extractRows(sourcesRaw)),
    countries: aggregateRows(extractRows(countriesRaw)),
    devices: aggregateRows(extractRows(devicesRaw))
  };
}
async function buildPageStats(baseUrl, auth, websiteId, startAt, endAt, page) {
  const variants = await resolveUrlVariants(baseUrl, auth, websiteId, startAt, endAt, page.path);
  const variantData = await Promise.all(
    variants.map((u) => fetchVariantData(baseUrl, auth, websiteId, startAt, endAt, u))
  );
  const totals = {
    pageviews: 0,
    visitors: 0,
    bounces: 0,
    totaltime: 0,
    sources: [],
    countries: [],
    devices: []
  };
  for (const v of variantData) {
    totals.pageviews += v.stats.pageviews;
    totals.visitors += v.stats.visitors;
    totals.bounces += v.stats.bounces;
    totals.totaltime += v.stats.totaltime;
    totals.sources.push(...v.sources);
    totals.countries.push(...v.countries);
    totals.devices.push(...v.devices);
  }
  const avgTime = totals.visitors > 0 ? Math.round(totals.totaltime / totals.visitors) : 0;
  const bounceRate = pct(totals.bounces, totals.pageviews);
  return {
    path: page.path,
    name: page.name,
    pageviews: totals.pageviews,
    visitors: totals.visitors,
    avgTime,
    bounceRate,
    topSources: topSources(totals.sources),
    topCountries: topCountries(totals.countries),
    devices: deviceSplit(totals.devices)
  };
}
var umami_funnel_stats_default = async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "GET") return json(405, { error: "Method not allowed" });
  if (process.env.ADMIN_DEV_BYPASS !== "true") {
    const session = getSessionFromRequest(req);
    if (!session) return json(401, { error: "Unauthorized" });
  }
  const url = new URL(req.url);
  const startAt = toNum(url.searchParams.get("startAt"));
  const endAt = toNum(url.searchParams.get("endAt"));
  if (!startAt || !endAt || startAt >= endAt) {
    return json(400, { error: "startAt/endAt invalides" });
  }
  const isDevBypass = process.env.ADMIN_DEV_BYPASS === "true";
  const baseUrl = (process.env.UMAMI_BASE_URL || "").replace(/\/+$/, "");
  const websiteId = process.env.UMAMI_WEBSITE_ID || "";
  const apiKey = process.env.UMAMI_API_KEY || "";
  const username = process.env.UMAMI_USERNAME || "";
  const password = process.env.UMAMI_PASSWORD || "";
  if (!baseUrl || !websiteId || !apiKey && (!username || !password)) {
    if (isDevBypass) {
      const mockVisitors = [1200, 980, 760, 510, 140];
      const mockPages = FUNNEL_PAGES.map((p, i) => ({
        path: p.path,
        name: `${p.name} (mock)`,
        pageviews: mockVisitors[i] + 200,
        visitors: mockVisitors[i],
        avgTime: 45 + i * 18,
        bounceRate: 25 + i * 8,
        topSources: [
          { name: "Instagram", value: 420 - i * 30 },
          { name: "Direct", value: 280 - i * 20 },
          { name: "YouTube", value: 190 - i * 12 }
        ],
        topCountries: [
          { name: "FR", value: 700 - i * 35 },
          { name: "BE", value: 120 - i * 6 },
          { name: "CH", value: 90 - i * 5 }
        ],
        devices: { mobile: 74, desktop: 23, tablet: 3 }
      }));
      return json(200, {
        period: { startAt, endAt },
        pages: mockPages,
        mock: true
      });
    }
    return json(500, {
      error: "Umami env vars manquantes: UMAMI_BASE_URL, UMAMI_WEBSITE_ID, et (UMAMI_API_KEY ou UMAMI_USERNAME + UMAMI_PASSWORD)"
    });
  }
  try {
    const auth = apiKey ? { type: "api-key", value: apiKey } : { type: "bearer", value: await umamiLogin(baseUrl, username, password) };
    const pages = await Promise.all(
      FUNNEL_PAGES.map((p) => buildPageStats(baseUrl, auth, websiteId, startAt, endAt, p))
    );
    return json(200, {
      period: { startAt, endAt },
      pages
    });
  } catch (err) {
    return json(503, {
      error: "Umami indisponible",
      detail: err instanceof Error ? err.message : "Erreur inconnue"
    });
  }
};
export {
  umami_funnel_stats_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9mdW5jdGlvbnMvbGliL2FkbWluLWVzMi1jcnlwdG8ubWpzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL2xpYi9hZG1pbi1lczItc2Vzc2lvbi1zZWNyZXQubWpzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL2xpYi9zdXBhYmFzZS1yZXN0Lm1qcyIsICJuZXRsaWZ5L2Z1bmN0aW9ucy9saWIvYWRtaW4tZXMyLXZlcmlmeS1jb29raWUubWpzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL3VtYW1pLWZ1bm5lbC1zdGF0cy5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IGNyeXB0byBmcm9tICdub2RlOmNyeXB0byc7XG5cbmNvbnN0IENPT0tJRV9OQU1FID0gJ2FkbWluX2VzMl9zZXNzaW9uJztcblxuZnVuY3Rpb24gYjY0dXJsKGJ1Zikge1xuICByZXR1cm4gQnVmZmVyLmZyb20oYnVmKVxuICAgIC50b1N0cmluZygnYmFzZTY0JylcbiAgICAucmVwbGFjZSgvXFwrL2csICctJylcbiAgICAucmVwbGFjZSgvXFwvL2csICdfJylcbiAgICAucmVwbGFjZSgvPSskLywgJycpO1xufVxuXG5mdW5jdGlvbiBiNjR1cmxEZWNvZGUoc3RyKSB7XG4gIGNvbnN0IHBhZCA9IDQgLSAoc3RyLmxlbmd0aCAlIDQpO1xuICBjb25zdCBzID0gc3RyLnJlcGxhY2UoLy0vZywgJysnKS5yZXBsYWNlKC9fL2csICcvJykgKyAocGFkIDwgNCA/ICc9Jy5yZXBlYXQocGFkKSA6ICcnKTtcbiAgcmV0dXJuIEJ1ZmZlci5mcm9tKHMsICdiYXNlNjQnKTtcbn1cblxuLyoqXG4gKiBAcGFyYW0ge3N0cmluZ30gc2VjcmV0XG4gKiBAcGFyYW0ge251bWJlcn0gdHRsTXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNpZ25TZXNzaW9uVG9rZW4oc2VjcmV0LCB0dGxNcykge1xuICBjb25zdCBleHAgPSBEYXRlLm5vdygpICsgdHRsTXM7XG4gIGNvbnN0IHBheWxvYWQgPSBKU09OLnN0cmluZ2lmeSh7IGV4cCwgdjogMSB9KTtcbiAgY29uc3QgcGF5bG9hZEI2NCA9IGI2NHVybChCdWZmZXIuZnJvbShwYXlsb2FkLCAndXRmOCcpKTtcbiAgY29uc3Qgc2lnID0gY3J5cHRvLmNyZWF0ZUhtYWMoJ3NoYTI1NicsIHNlY3JldCkudXBkYXRlKHBheWxvYWRCNjQpLmRpZ2VzdCgnaGV4Jyk7XG4gIHJldHVybiBgJHtwYXlsb2FkQjY0fS4ke3NpZ31gO1xufVxuXG4vKipcbiAqIEBwYXJhbSB7c3RyaW5nfSB0b2tlblxuICogQHBhcmFtIHtzdHJpbmd9IHNlY3JldFxuICogQHJldHVybnMge3sgZXhwOiBudW1iZXIgfSB8IG51bGx9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2ZXJpZnlTZXNzaW9uVG9rZW4odG9rZW4sIHNlY3JldCkge1xuICBpZiAoIXRva2VuIHx8IHR5cGVvZiB0b2tlbiAhPT0gJ3N0cmluZycpIHJldHVybiBudWxsO1xuICBjb25zdCBkb3QgPSB0b2tlbi5sYXN0SW5kZXhPZignLicpO1xuICBpZiAoZG90IDw9IDApIHJldHVybiBudWxsO1xuICBjb25zdCBwYXlsb2FkQjY0ID0gdG9rZW4uc2xpY2UoMCwgZG90KTtcbiAgY29uc3Qgc2lnID0gdG9rZW4uc2xpY2UoZG90ICsgMSk7XG4gIGlmICghcGF5bG9hZEI2NCB8fCAhc2lnIHx8IHNpZy5sZW5ndGggIT09IDY0KSByZXR1cm4gbnVsbDtcbiAgY29uc3QgZXhwZWN0ZWQgPSBjcnlwdG8uY3JlYXRlSG1hYygnc2hhMjU2Jywgc2VjcmV0KS51cGRhdGUocGF5bG9hZEI2NCkuZGlnZXN0KCdoZXgnKTtcbiAgdHJ5IHtcbiAgICBjb25zdCBhID0gQnVmZmVyLmZyb20oc2lnLCAnaGV4Jyk7XG4gICAgY29uc3QgYiA9IEJ1ZmZlci5mcm9tKGV4cGVjdGVkLCAnaGV4Jyk7XG4gICAgaWYgKGEubGVuZ3RoICE9PSBiLmxlbmd0aCB8fCAhY3J5cHRvLnRpbWluZ1NhZmVFcXVhbChhLCBiKSkgcmV0dXJuIG51bGw7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGxldCBkYXRhO1xuICB0cnkge1xuICAgIGRhdGEgPSBKU09OLnBhcnNlKGI2NHVybERlY29kZShwYXlsb2FkQjY0KS50b1N0cmluZygndXRmOCcpKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgaWYgKCFkYXRhIHx8IHR5cGVvZiBkYXRhLmV4cCAhPT0gJ251bWJlcicgfHwgZGF0YS5leHAgPCBEYXRlLm5vdygpKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIGRhdGE7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvb2tpZXMoY29va2llSGVhZGVyKSB7XG4gIGlmICghY29va2llSGVhZGVyKSByZXR1cm4ge307XG4gIGNvbnN0IG91dCA9IHt9O1xuICBmb3IgKGNvbnN0IHBhcnQgb2YgY29va2llSGVhZGVyLnNwbGl0KCc7JykpIHtcbiAgICBjb25zdCBpZHggPSBwYXJ0LmluZGV4T2YoJz0nKTtcbiAgICBpZiAoaWR4ID09PSAtMSkgY29udGludWU7XG4gICAgY29uc3QgbmFtZSA9IHBhcnQuc2xpY2UoMCwgaWR4KS50cmltKCk7XG4gICAgY29uc3QgdmFsID0gcGFydC5zbGljZShpZHggKyAxKS50cmltKCk7XG4gICAgaWYgKG5hbWUpIG91dFtuYW1lXSA9IGRlY29kZVVSSUNvbXBvbmVudCh2YWwpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRTZXNzaW9uQ29va2llVmFsdWUoY29va2llSGVhZGVyKSB7XG4gIGNvbnN0IGMgPSBwYXJzZUNvb2tpZXMoY29va2llSGVhZGVyIHx8ICcnKTtcbiAgcmV0dXJuIGNbQ09PS0lFX05BTUVdIHx8ICcnO1xufVxuXG4vKipcbiAqIEBwYXJhbSB7eyB2YWx1ZTogc3RyaW5nLCBtYXhBZ2VTZWM6IG51bWJlciwgc2VjdXJlOiBib29sZWFuIH19IG9wdHNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkU2Vzc2lvblNldENvb2tpZShvcHRzKSB7XG4gIGNvbnN0IHBhcnRzID0gW1xuICAgIGAke0NPT0tJRV9OQU1FfT0ke2VuY29kZVVSSUNvbXBvbmVudChvcHRzLnZhbHVlKX1gLFxuICAgICdQYXRoPS8nLFxuICAgIGBNYXgtQWdlPSR7b3B0cy5tYXhBZ2VTZWN9YCxcbiAgICAnSHR0cE9ubHknLFxuICAgICdTYW1lU2l0ZT1TdHJpY3QnLFxuICBdO1xuICBpZiAob3B0cy5zZWN1cmUpIHBhcnRzLnB1c2goJ1NlY3VyZScpO1xuICByZXR1cm4gcGFydHMuam9pbignOyAnKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkU2Vzc2lvbkNsZWFyQ29va2llKHNlY3VyZSkge1xuICBjb25zdCBwYXJ0cyA9IFtcbiAgICBgJHtDT09LSUVfTkFNRX09YCxcbiAgICAnUGF0aD0vJyxcbiAgICAnTWF4LUFnZT0wJyxcbiAgICAnSHR0cE9ubHknLFxuICAgICdTYW1lU2l0ZT1TdHJpY3QnLFxuICBdO1xuICBpZiAoc2VjdXJlKSBwYXJ0cy5wdXNoKCdTZWN1cmUnKTtcbiAgcmV0dXJuIHBhcnRzLmpvaW4oJzsgJyk7XG59XG5cbmV4cG9ydCB7IENPT0tJRV9OQU1FIH07XG4iLCAiaW1wb3J0IGNyeXB0byBmcm9tICdub2RlOmNyeXB0byc7XG5pbXBvcnQgeyBnZXRTdXBhYmFzZUNvbmZpZyB9IGZyb20gJy4vc3VwYWJhc2UtcmVzdC5tanMnO1xuXG4vKiogU2VjcmV0IGRlIGNvb2tpZSBkXHUwMEU5cml2XHUwMEU5IGRlIGxhIHNlcnZpY2Ugcm9sZSAoYXVjdW5lIHZhcmlhYmxlIE5ldGxpZnkgZFx1MDBFOWRpXHUwMEU5ZSkuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0QWRtaW5FczJDb29raWVTZWNyZXQoKSB7XG4gIGNvbnN0IHsga2V5IH0gPSBnZXRTdXBhYmFzZUNvbmZpZygpO1xuICBpZiAoIWtleSB8fCB0eXBlb2Yga2V5ICE9PSAnc3RyaW5nJykgcmV0dXJuICcnO1xuICByZXR1cm4gY3J5cHRvLmNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShgYWRtaW4tZXMyLWNvb2tpZXwke2tleX1gKS5kaWdlc3QoJ2hleCcpO1xufVxuIiwgImV4cG9ydCBmdW5jdGlvbiBnZXRTdXBhYmFzZUNvbmZpZygpIHtcbiAgY29uc3QgdXJsID0gcHJvY2Vzcy5lbnYuU1VQQUJBU0VfVVJMO1xuICBjb25zdCBrZXkgPSBwcm9jZXNzLmVudi5TVVBBQkFTRV9TRVJWSUNFX1JPTEVfS0VZO1xuICByZXR1cm4geyB1cmwsIGtleSB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc3VwYWJhc2VIZWFkZXJzKGV4dHJhID0ge30pIHtcbiAgY29uc3QgeyBrZXkgfSA9IGdldFN1cGFiYXNlQ29uZmlnKCk7XG4gIHJldHVybiB7XG4gICAgYXBpa2V5OiBrZXksXG4gICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke2tleX1gLFxuICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgLi4uZXh0cmEsXG4gIH07XG59XG5cbi8qKiBAcGFyYW0ge3N0cmluZ30gcGF0aCBxdWVyeSBlLmcuIFwid2ViaW5haXJlX3JlZ2lzdHJhdGlvbnM/dG9rZW49ZXEueFwiICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3VwYWJhc2VHZXQocGF0aCkge1xuICBjb25zdCB7IHVybCwga2V5IH0gPSBnZXRTdXBhYmFzZUNvbmZpZygpO1xuICBpZiAoIXVybCB8fCAha2V5KSB7XG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCBzdGF0dXM6IDUwMCwgZGF0YTogbnVsbCwgZXJyb3I6ICdTdXBhYmFzZSBub24gY29uZmlndXJcdTAwRTknIH07XG4gIH1cbiAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goYCR7dXJsfS9yZXN0L3YxLyR7cGF0aH1gLCB7XG4gICAgaGVhZGVyczogc3VwYWJhc2VIZWFkZXJzKCksXG4gIH0pO1xuICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVzLnRleHQoKTtcbiAgbGV0IGRhdGEgPSBudWxsO1xuICB0cnkge1xuICAgIGRhdGEgPSB0ZXh0ID8gSlNPTi5wYXJzZSh0ZXh0KSA6IG51bGw7XG4gIH0gY2F0Y2gge1xuICAgIGRhdGEgPSB0ZXh0O1xuICB9XG4gIHJldHVybiB7IG9rOiByZXMub2ssIHN0YXR1czogcmVzLnN0YXR1cywgZGF0YSwgZXJyb3I6IHJlcy5vayA/IG51bGwgOiBkYXRhIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzdXBhYmFzZVBvc3QodGFibGUsIGJvZHksIHsgcHJlZmVyID0gJ3JldHVybj1yZXByZXNlbnRhdGlvbicgfSA9IHt9KSB7XG4gIGNvbnN0IHsgdXJsLCBrZXkgfSA9IGdldFN1cGFiYXNlQ29uZmlnKCk7XG4gIGlmICghdXJsIHx8ICFrZXkpIHtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIHN0YXR1czogNTAwLCBkYXRhOiBudWxsLCBlcnJvcjogJ1N1cGFiYXNlIG5vbiBjb25maWd1clx1MDBFOScgfTtcbiAgfVxuICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaChgJHt1cmx9L3Jlc3QvdjEvJHt0YWJsZX1gLCB7XG4gICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgaGVhZGVyczogc3VwYWJhc2VIZWFkZXJzKHsgUHJlZmVyOiBwcmVmZXIgfSksXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoYm9keSksXG4gIH0pO1xuICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVzLnRleHQoKTtcbiAgbGV0IGRhdGEgPSBudWxsO1xuICB0cnkge1xuICAgIGRhdGEgPSB0ZXh0ID8gSlNPTi5wYXJzZSh0ZXh0KSA6IG51bGw7XG4gIH0gY2F0Y2gge1xuICAgIGRhdGEgPSB0ZXh0O1xuICB9XG4gIHJldHVybiB7IG9rOiByZXMub2ssIHN0YXR1czogcmVzLnN0YXR1cywgZGF0YSwgZXJyb3I6IHJlcy5vayA/IG51bGwgOiBkYXRhIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzdXBhYmFzZVBhdGNoKHRhYmxlLCBxdWVyeSwgYm9keSkge1xuICBjb25zdCB7IHVybCwga2V5IH0gPSBnZXRTdXBhYmFzZUNvbmZpZygpO1xuICBpZiAoIXVybCB8fCAha2V5KSB7XG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCBzdGF0dXM6IDUwMCwgZGF0YTogbnVsbCwgZXJyb3I6ICdTdXBhYmFzZSBub24gY29uZmlndXJcdTAwRTknIH07XG4gIH1cbiAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goYCR7dXJsfS9yZXN0L3YxLyR7dGFibGV9PyR7cXVlcnl9YCwge1xuICAgIG1ldGhvZDogJ1BBVENIJyxcbiAgICBoZWFkZXJzOiBzdXBhYmFzZUhlYWRlcnMoeyBQcmVmZXI6ICdyZXR1cm49cmVwcmVzZW50YXRpb24nIH0pLFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGJvZHkpLFxuICB9KTtcbiAgY29uc3QgdGV4dCA9IGF3YWl0IHJlcy50ZXh0KCk7XG4gIGxldCBkYXRhID0gbnVsbDtcbiAgdHJ5IHtcbiAgICBkYXRhID0gdGV4dCA/IEpTT04ucGFyc2UodGV4dCkgOiBudWxsO1xuICB9IGNhdGNoIHtcbiAgICBkYXRhID0gdGV4dDtcbiAgfVxuICByZXR1cm4geyBvazogcmVzLm9rLCBzdGF0dXM6IHJlcy5zdGF0dXMsIGRhdGEsIGVycm9yOiByZXMub2sgPyBudWxsIDogZGF0YSB9O1xufVxuIiwgImltcG9ydCB7IHZlcmlmeVNlc3Npb25Ub2tlbiwgZ2V0U2Vzc2lvbkNvb2tpZVZhbHVlIH0gZnJvbSAnLi9hZG1pbi1lczItY3J5cHRvLm1qcyc7XG5pbXBvcnQgeyBnZXRBZG1pbkVzMkNvb2tpZVNlY3JldCB9IGZyb20gJy4vYWRtaW4tZXMyLXNlc3Npb24tc2VjcmV0Lm1qcyc7XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRTZXNzaW9uRnJvbVJlcXVlc3QocmVxKSB7XG4gIGNvbnN0IHNlY3JldCA9IGdldEFkbWluRXMyQ29va2llU2VjcmV0KCk7XG4gIGlmICghc2VjcmV0KSByZXR1cm4gbnVsbDtcbiAgY29uc3QgcmF3ID0gZ2V0U2Vzc2lvbkNvb2tpZVZhbHVlKHJlcS5oZWFkZXJzLmdldCgnY29va2llJykgfHwgJycpO1xuICByZXR1cm4gdmVyaWZ5U2Vzc2lvblRva2VuKHJhdywgc2VjcmV0KTtcbn1cbiIsICJpbXBvcnQgeyBnZXRTZXNzaW9uRnJvbVJlcXVlc3QgfSBmcm9tICcuL2xpYi9hZG1pbi1lczItdmVyaWZ5LWNvb2tpZS5tanMnO1xuXG5jb25zdCBGVU5ORUxfUEFHRVMgPSBbXG4gIHsgcGF0aDogJy9tYXN0ZXJjbGFzcycsIG5hbWU6ICdPcHQtaW4nIH0sXG4gIHsgcGF0aDogJy9tYXN0ZXJjbGFzcy9jb25maXJtYXRpb24nLCBuYW1lOiAnQ29uZmlybWF0aW9uJyB9LFxuICB7IHBhdGg6ICcvbWFzdGVyY2xhc3Mvc2Vzc2lvbicsIG5hbWU6ICdTZXNzaW9uIG1hc3RlcmNsYXNzJyB9LFxuICB7IHBhdGg6ICcvaW52aXRhdGlvbicsIG5hbWU6ICdJbnZpdGF0aW9uIChzYWxlcyknIH0sXG4gIHsgcGF0aDogJy9tYXN0ZXJjbGFzcy9zdWNjZXNzJywgbmFtZTogJ1N1Y2Nlc3MnIH0sXG5dO1xuXG5mdW5jdGlvbiBqc29uKHN0YXR1cywgYm9keSkge1xuICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KGJvZHkpLCB7XG4gICAgc3RhdHVzLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAnQ2FjaGUtQ29udHJvbCc6ICduby1zdG9yZScsXG4gICAgfSxcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIHRvTnVtKHYpIHtcbiAgY29uc3QgbiA9IE51bWJlcih2KTtcbiAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKSA/IG4gOiAwO1xufVxuXG5mdW5jdGlvbiBwY3QobnVtLCBkZW4pIHtcbiAgaWYgKCFkZW4pIHJldHVybiAwO1xuICByZXR1cm4gTnVtYmVyKCgobnVtIC8gZGVuKSAqIDEwMCkudG9GaXhlZCgxKSk7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVBhdGgodmFsdWUpIHtcbiAgaWYgKCF2YWx1ZSkgcmV0dXJuICcnO1xuICBjb25zdCBzID0gU3RyaW5nKHZhbHVlKS50cmltKCk7XG4gIHRyeSB7XG4gICAgaWYgKHMuc3RhcnRzV2l0aCgnaHR0cDovLycpIHx8IHMuc3RhcnRzV2l0aCgnaHR0cHM6Ly8nKSkge1xuICAgICAgY29uc3QgdSA9IG5ldyBVUkwocyk7XG4gICAgICByZXR1cm4gYCR7dS5wYXRobmFtZX0ke3Uuc2VhcmNoIHx8ICcnfWA7XG4gICAgfVxuICB9IGNhdGNoIHtcbiAgICAvLyBpZ25vcmVcbiAgfVxuICByZXR1cm4gcztcbn1cblxuZnVuY3Rpb24gcm93TGFiZWwocm93KSB7XG4gIHJldHVybiBTdHJpbmcoXG4gICAgcm93LnggPz9cbiAgICAgIHJvdy5uYW1lID8/XG4gICAgICByb3cubGFiZWwgPz9cbiAgICAgIHJvdy52YWx1ZSA/P1xuICAgICAgJydcbiAgKS50cmltKCk7XG59XG5cbmZ1bmN0aW9uIHJvd1ZhbHVlKHJvdykge1xuICByZXR1cm4gdG9OdW0ocm93LnkgPz8gcm93LmNvdW50ID8/IHJvdy52YWx1ZSA/PyByb3cudG90YWwgPz8gMCk7XG59XG5cbmZ1bmN0aW9uIGV4dHJhY3RSb3dzKHBheWxvYWQpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkocGF5bG9hZCkpIHJldHVybiBwYXlsb2FkO1xuICBpZiAocGF5bG9hZCAmJiBBcnJheS5pc0FycmF5KHBheWxvYWQuZGF0YSkpIHJldHVybiBwYXlsb2FkLmRhdGE7XG4gIHJldHVybiBbXTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gdW1hbWlMb2dpbihiYXNlVXJsLCB1c2VybmFtZSwgcGFzc3dvcmQpIHtcbiAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goYCR7YmFzZVVybH0vYXBpL2F1dGgvbG9naW5gLCB7XG4gICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgaGVhZGVyczogeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyB1c2VybmFtZSwgcGFzc3dvcmQgfSksXG4gIH0pO1xuICBpZiAoIXJlcy5vaykge1xuICAgIGNvbnN0IHR4dCA9IGF3YWl0IHJlcy50ZXh0KCkuY2F0Y2goKCkgPT4gJycpO1xuICAgIHRocm93IG5ldyBFcnJvcihgVW1hbWkgbG9naW4gZmFpbGVkICgke3Jlcy5zdGF0dXN9KTogJHt0eHQuc2xpY2UoMCwgMjAwKX1gKTtcbiAgfVxuICBjb25zdCBkYXRhID0gYXdhaXQgcmVzLmpzb24oKTtcbiAgaWYgKCFkYXRhPy50b2tlbikgdGhyb3cgbmV3IEVycm9yKCdVbWFtaSBsb2dpbiBzdWNjZWVkZWQgd2l0aG91dCB0b2tlbicpO1xuICByZXR1cm4gZGF0YS50b2tlbjtcbn1cblxuYXN5bmMgZnVuY3Rpb24gdW1hbWlHZXQoYmFzZVVybCwgYXV0aCwgcGF0aCwgcGFyYW1zID0ge30pIHtcbiAgY29uc3QgcXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKCk7XG4gIE9iamVjdC5lbnRyaWVzKHBhcmFtcykuZm9yRWFjaCgoW2ssIHZdKSA9PiB7XG4gICAgaWYgKHYgPT09IHVuZGVmaW5lZCB8fCB2ID09PSBudWxsIHx8IHYgPT09ICcnKSByZXR1cm47XG4gICAgcXMuc2V0KGssIFN0cmluZyh2KSk7XG4gIH0pO1xuICBjb25zdCB1cmwgPSBgJHtiYXNlVXJsfSR7cGF0aH0/JHtxcy50b1N0cmluZygpfWA7XG4gIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKHVybCwge1xuICAgIGhlYWRlcnM6IHtcbiAgICAgIC4uLihhdXRoLnR5cGUgPT09ICdhcGkta2V5J1xuICAgICAgICA/IHsgJ3gtdW1hbWktYXBpLWtleSc6IGF1dGgudmFsdWUgfVxuICAgICAgICA6IHsgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke2F1dGgudmFsdWV9YCB9KSxcbiAgICB9LFxuICB9KTtcbiAgaWYgKCFyZXMub2spIHtcbiAgICBjb25zdCB0eHQgPSBhd2FpdCByZXMudGV4dCgpLmNhdGNoKCgpID0+ICcnKTtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVtYW1pIEdFVCAke3BhdGh9IGZhaWxlZCAoJHtyZXMuc3RhdHVzfSk6ICR7dHh0LnNsaWNlKDAsIDIwMCl9YCk7XG4gIH1cbiAgcmV0dXJuIHJlcy5qc29uKCk7XG59XG5cbmZ1bmN0aW9uIGFnZ3JlZ2F0ZVJvd3Mocm93cykge1xuICBjb25zdCBtYXAgPSBuZXcgTWFwKCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBjb25zdCBsYWJlbCA9IHJvd0xhYmVsKHJvdyk7XG4gICAgaWYgKCFsYWJlbCkgY29udGludWU7XG4gICAgbWFwLnNldChsYWJlbCwgKG1hcC5nZXQobGFiZWwpIHx8IDApICsgcm93VmFsdWUocm93KSk7XG4gIH1cbiAgcmV0dXJuIFsuLi5tYXAuZW50cmllcygpXVxuICAgIC5tYXAoKFtuYW1lLCB2YWx1ZV0pID0+ICh7IG5hbWUsIHZhbHVlIH0pKVxuICAgIC5zb3J0KChhLCBiKSA9PiBiLnZhbHVlIC0gYS52YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVNvdXJjZShuYW1lKSB7XG4gIGNvbnN0IG4gPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIGlmICghbiB8fCBuID09PSAnKG5vbmUpJyB8fCBuID09PSAnZGlyZWN0JyB8fCBuID09PSAnZGlyZWN0IC8gbm9uZScpIHJldHVybiAnRGlyZWN0JztcbiAgaWYgKG4uaW5jbHVkZXMoJ2luc3RhZ3JhbScpIHx8IG4uaW5jbHVkZXMoJ2lnJykpIHJldHVybiAnSW5zdGFncmFtJztcbiAgaWYgKG4uaW5jbHVkZXMoJ3Rpa3RvaycpKSByZXR1cm4gJ1Rpa1Rvayc7XG4gIGlmIChuLmluY2x1ZGVzKCd5b3V0dWJlJykgfHwgbi5pbmNsdWRlcygneW91dHUuYmUnKSkgcmV0dXJuICdZb3VUdWJlJztcbiAgaWYgKG4uaW5jbHVkZXMoJ21haWwnKSB8fCBuLmluY2x1ZGVzKCduZXdzbGV0dGVyJykpIHJldHVybiAnRW1haWwnO1xuICByZXR1cm4gbmFtZTtcbn1cblxuZnVuY3Rpb24gdG9wU291cmNlcyhyb3dzKSB7XG4gIGNvbnN0IGFnZyA9IG5ldyBNYXAoKTtcbiAgZm9yIChjb25zdCByIG9mIHJvd3MpIHtcbiAgICBjb25zdCBrZXkgPSBub3JtYWxpemVTb3VyY2Uoci5uYW1lIHx8ICcnKTtcbiAgICBhZ2cuc2V0KGtleSwgKGFnZy5nZXQoa2V5KSB8fCAwKSArIHRvTnVtKHIudmFsdWUpKTtcbiAgfVxuICByZXR1cm4gWy4uLmFnZy5lbnRyaWVzKCldXG4gICAgLm1hcCgoW25hbWUsIHZhbHVlXSkgPT4gKHsgbmFtZSwgdmFsdWUgfSkpXG4gICAgLnNvcnQoKGEsIGIpID0+IGIudmFsdWUgLSBhLnZhbHVlKVxuICAgIC5zbGljZSgwLCAzKTtcbn1cblxuZnVuY3Rpb24gdG9wQ291bnRyaWVzKHJvd3MpIHtcbiAgcmV0dXJuIHJvd3NcbiAgICAubWFwKChyKSA9PiAoeyBuYW1lOiAoci5uYW1lIHx8ICdVbmtub3duJykudG9VcHBlckNhc2UoKSwgdmFsdWU6IHRvTnVtKHIudmFsdWUpIH0pKVxuICAgIC5zb3J0KChhLCBiKSA9PiBiLnZhbHVlIC0gYS52YWx1ZSlcbiAgICAuc2xpY2UoMCwgMyk7XG59XG5cbmZ1bmN0aW9uIGRldmljZVNwbGl0KHJvd3MpIHtcbiAgY29uc3QgYnVja2V0cyA9IHsgbW9iaWxlOiAwLCBkZXNrdG9wOiAwLCB0YWJsZXQ6IDAgfTtcbiAgZm9yIChjb25zdCByIG9mIHJvd3MpIHtcbiAgICBjb25zdCBuID0gKHIubmFtZSB8fCAnJykudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCB2ID0gdG9OdW0oci52YWx1ZSk7XG4gICAgaWYgKG4uaW5jbHVkZXMoJ21vYmlsZScpKSBidWNrZXRzLm1vYmlsZSArPSB2O1xuICAgIGVsc2UgaWYgKG4uaW5jbHVkZXMoJ3RhYmxldCcpKSBidWNrZXRzLnRhYmxldCArPSB2O1xuICAgIGVsc2UgYnVja2V0cy5kZXNrdG9wICs9IHY7XG4gIH1cbiAgY29uc3QgdG90YWwgPSBidWNrZXRzLm1vYmlsZSArIGJ1Y2tldHMuZGVza3RvcCArIGJ1Y2tldHMudGFibGV0O1xuICByZXR1cm4ge1xuICAgIG1vYmlsZTogcGN0KGJ1Y2tldHMubW9iaWxlLCB0b3RhbCksXG4gICAgZGVza3RvcDogcGN0KGJ1Y2tldHMuZGVza3RvcCwgdG90YWwpLFxuICAgIHRhYmxldDogcGN0KGJ1Y2tldHMudGFibGV0LCB0b3RhbCksXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVVcmxWYXJpYW50cyhiYXNlVXJsLCBhdXRoLCB3ZWJzaXRlSWQsIHN0YXJ0QXQsIGVuZEF0LCBwYWdlUGF0aCkge1xuICAvLyBVbWFtaSBzZWxmLWhvc3RlZCBnYXJkZSBzb3V2ZW50IGxhIHF1ZXJ5IHN0cmluZyBkYW5zIGxlcyBVUkxzLlxuICAvLyBPbiByXHUwMEU5Y3VwXHUwMEU4cmUgbGEgZGlzdHJpYnV0aW9uIGRlcyBVUkxzIHB1aXMgb24gZmlsdHJlIGVuIHN0YXJ0c1dpdGggY1x1MDBGNHRcdTAwRTkgc2VydmV1ci5cbiAgY29uc3QgdXJsc1JhdyA9IGF3YWl0IHVtYW1pR2V0KFxuICAgIGJhc2VVcmwsXG4gICAgYXV0aCxcbiAgICBgL2FwaS93ZWJzaXRlcy8ke3dlYnNpdGVJZH0vbWV0cmljc2AsXG4gICAgeyBzdGFydEF0LCBlbmRBdCwgdHlwZTogJ3VybCcsIGxpbWl0OiAxMDAwIH1cbiAgKTtcbiAgY29uc3Qgcm93cyA9IGV4dHJhY3RSb3dzKHVybHNSYXcpO1xuICBjb25zdCB2YXJpYW50cyA9IHJvd3NcbiAgICAubWFwKChyKSA9PiAoeyBwYXRoOiBub3JtYWxpemVQYXRoKHJvd0xhYmVsKHIpKSwgdmFsdWU6IHJvd1ZhbHVlKHIpIH0pKVxuICAgIC5maWx0ZXIoKHIpID0+IHIucGF0aCAmJiByLnBhdGguc3RhcnRzV2l0aChwYWdlUGF0aCkpXG4gICAgLnNvcnQoKGEsIGIpID0+IGIudmFsdWUgLSBhLnZhbHVlKVxuICAgIC5tYXAoKHIpID0+IHIucGF0aCk7XG4gIGlmICh2YXJpYW50cy5sZW5ndGgpIHJldHVybiB2YXJpYW50cztcbiAgcmV0dXJuIFtwYWdlUGF0aF07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoVmFyaWFudERhdGEoYmFzZVVybCwgYXV0aCwgd2Vic2l0ZUlkLCBzdGFydEF0LCBlbmRBdCwgdXJsKSB7XG4gIGNvbnN0IFtzdGF0c1Jhdywgc291cmNlc1JhdywgY291bnRyaWVzUmF3LCBkZXZpY2VzUmF3XSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICB1bWFtaUdldChiYXNlVXJsLCBhdXRoLCBgL2FwaS93ZWJzaXRlcy8ke3dlYnNpdGVJZH0vc3RhdHNgLCB7IHN0YXJ0QXQsIGVuZEF0LCB1cmwgfSksXG4gICAgdW1hbWlHZXQoYmFzZVVybCwgYXV0aCwgYC9hcGkvd2Vic2l0ZXMvJHt3ZWJzaXRlSWR9L21ldHJpY3NgLCB7IHN0YXJ0QXQsIGVuZEF0LCB0eXBlOiAncmVmZXJyZXInLCB1cmwsIGxpbWl0OiA1MCB9KSxcbiAgICB1bWFtaUdldChiYXNlVXJsLCBhdXRoLCBgL2FwaS93ZWJzaXRlcy8ke3dlYnNpdGVJZH0vbWV0cmljc2AsIHsgc3RhcnRBdCwgZW5kQXQsIHR5cGU6ICdjb3VudHJ5JywgdXJsLCBsaW1pdDogNTAgfSksXG4gICAgdW1hbWlHZXQoYmFzZVVybCwgYXV0aCwgYC9hcGkvd2Vic2l0ZXMvJHt3ZWJzaXRlSWR9L21ldHJpY3NgLCB7IHN0YXJ0QXQsIGVuZEF0LCB0eXBlOiAnZGV2aWNlJywgdXJsLCBsaW1pdDogNTAgfSksXG4gIF0pO1xuXG4gIGNvbnN0IHN0YXRzID0ge1xuICAgIHBhZ2V2aWV3czogdG9OdW0oc3RhdHNSYXc/LnBhZ2V2aWV3cyksXG4gICAgdmlzaXRvcnM6IHRvTnVtKHN0YXRzUmF3Py52aXNpdG9ycyksXG4gICAgYm91bmNlczogdG9OdW0oc3RhdHNSYXc/LmJvdW5jZXMpLFxuICAgIHRvdGFsdGltZTogdG9OdW0oc3RhdHNSYXc/LnRvdGFsdGltZSksXG4gIH07XG4gIHJldHVybiB7XG4gICAgc3RhdHMsXG4gICAgc291cmNlczogYWdncmVnYXRlUm93cyhleHRyYWN0Um93cyhzb3VyY2VzUmF3KSksXG4gICAgY291bnRyaWVzOiBhZ2dyZWdhdGVSb3dzKGV4dHJhY3RSb3dzKGNvdW50cmllc1JhdykpLFxuICAgIGRldmljZXM6IGFnZ3JlZ2F0ZVJvd3MoZXh0cmFjdFJvd3MoZGV2aWNlc1JhdykpLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBidWlsZFBhZ2VTdGF0cyhiYXNlVXJsLCBhdXRoLCB3ZWJzaXRlSWQsIHN0YXJ0QXQsIGVuZEF0LCBwYWdlKSB7XG4gIGNvbnN0IHZhcmlhbnRzID0gYXdhaXQgcmVzb2x2ZVVybFZhcmlhbnRzKGJhc2VVcmwsIGF1dGgsIHdlYnNpdGVJZCwgc3RhcnRBdCwgZW5kQXQsIHBhZ2UucGF0aCk7XG4gIGNvbnN0IHZhcmlhbnREYXRhID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgdmFyaWFudHMubWFwKCh1KSA9PiBmZXRjaFZhcmlhbnREYXRhKGJhc2VVcmwsIGF1dGgsIHdlYnNpdGVJZCwgc3RhcnRBdCwgZW5kQXQsIHUpKVxuICApO1xuXG4gIGNvbnN0IHRvdGFscyA9IHtcbiAgICBwYWdldmlld3M6IDAsXG4gICAgdmlzaXRvcnM6IDAsXG4gICAgYm91bmNlczogMCxcbiAgICB0b3RhbHRpbWU6IDAsXG4gICAgc291cmNlczogW10sXG4gICAgY291bnRyaWVzOiBbXSxcbiAgICBkZXZpY2VzOiBbXSxcbiAgfTtcblxuICBmb3IgKGNvbnN0IHYgb2YgdmFyaWFudERhdGEpIHtcbiAgICB0b3RhbHMucGFnZXZpZXdzICs9IHYuc3RhdHMucGFnZXZpZXdzO1xuICAgIHRvdGFscy52aXNpdG9ycyArPSB2LnN0YXRzLnZpc2l0b3JzO1xuICAgIHRvdGFscy5ib3VuY2VzICs9IHYuc3RhdHMuYm91bmNlcztcbiAgICB0b3RhbHMudG90YWx0aW1lICs9IHYuc3RhdHMudG90YWx0aW1lO1xuICAgIHRvdGFscy5zb3VyY2VzLnB1c2goLi4udi5zb3VyY2VzKTtcbiAgICB0b3RhbHMuY291bnRyaWVzLnB1c2goLi4udi5jb3VudHJpZXMpO1xuICAgIHRvdGFscy5kZXZpY2VzLnB1c2goLi4udi5kZXZpY2VzKTtcbiAgfVxuXG4gIGNvbnN0IGF2Z1RpbWUgPSB0b3RhbHMudmlzaXRvcnMgPiAwID8gTWF0aC5yb3VuZCh0b3RhbHMudG90YWx0aW1lIC8gdG90YWxzLnZpc2l0b3JzKSA6IDA7XG4gIGNvbnN0IGJvdW5jZVJhdGUgPSBwY3QodG90YWxzLmJvdW5jZXMsIHRvdGFscy5wYWdldmlld3MpO1xuXG4gIHJldHVybiB7XG4gICAgcGF0aDogcGFnZS5wYXRoLFxuICAgIG5hbWU6IHBhZ2UubmFtZSxcbiAgICBwYWdldmlld3M6IHRvdGFscy5wYWdldmlld3MsXG4gICAgdmlzaXRvcnM6IHRvdGFscy52aXNpdG9ycyxcbiAgICBhdmdUaW1lLFxuICAgIGJvdW5jZVJhdGUsXG4gICAgdG9wU291cmNlczogdG9wU291cmNlcyh0b3RhbHMuc291cmNlcyksXG4gICAgdG9wQ291bnRyaWVzOiB0b3BDb3VudHJpZXModG90YWxzLmNvdW50cmllcyksXG4gICAgZGV2aWNlczogZGV2aWNlU3BsaXQodG90YWxzLmRldmljZXMpLFxuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBhc3luYyAocmVxKSA9PiB7XG4gIGlmIChyZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHJldHVybiBuZXcgUmVzcG9uc2UobnVsbCwgeyBzdGF0dXM6IDIwNCB9KTtcbiAgaWYgKHJlcS5tZXRob2QgIT09ICdHRVQnKSByZXR1cm4ganNvbig0MDUsIHsgZXJyb3I6ICdNZXRob2Qgbm90IGFsbG93ZWQnIH0pO1xuXG4gIC8vIFByb3RlY3Rpb24gY29ja3BpdCA6IGNvb2tpZSBhZG1pbiBvYmxpZ2F0b2lyZVxuICBpZiAocHJvY2Vzcy5lbnYuQURNSU5fREVWX0JZUEFTUyAhPT0gJ3RydWUnKSB7XG4gICAgY29uc3Qgc2Vzc2lvbiA9IGdldFNlc3Npb25Gcm9tUmVxdWVzdChyZXEpO1xuICAgIGlmICghc2Vzc2lvbikgcmV0dXJuIGpzb24oNDAxLCB7IGVycm9yOiAnVW5hdXRob3JpemVkJyB9KTtcbiAgfVxuXG4gIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxLnVybCk7XG4gIGNvbnN0IHN0YXJ0QXQgPSB0b051bSh1cmwuc2VhcmNoUGFyYW1zLmdldCgnc3RhcnRBdCcpKTtcbiAgY29uc3QgZW5kQXQgPSB0b051bSh1cmwuc2VhcmNoUGFyYW1zLmdldCgnZW5kQXQnKSk7XG4gIGlmICghc3RhcnRBdCB8fCAhZW5kQXQgfHwgc3RhcnRBdCA+PSBlbmRBdCkge1xuICAgIHJldHVybiBqc29uKDQwMCwgeyBlcnJvcjogJ3N0YXJ0QXQvZW5kQXQgaW52YWxpZGVzJyB9KTtcbiAgfVxuXG4gIGNvbnN0IGlzRGV2QnlwYXNzID0gcHJvY2Vzcy5lbnYuQURNSU5fREVWX0JZUEFTUyA9PT0gJ3RydWUnO1xuICBjb25zdCBiYXNlVXJsID0gKHByb2Nlc3MuZW52LlVNQU1JX0JBU0VfVVJMIHx8ICcnKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgY29uc3Qgd2Vic2l0ZUlkID0gcHJvY2Vzcy5lbnYuVU1BTUlfV0VCU0lURV9JRCB8fCAnJztcbiAgY29uc3QgYXBpS2V5ID0gcHJvY2Vzcy5lbnYuVU1BTUlfQVBJX0tFWSB8fCAnJztcbiAgY29uc3QgdXNlcm5hbWUgPSBwcm9jZXNzLmVudi5VTUFNSV9VU0VSTkFNRSB8fCAnJztcbiAgY29uc3QgcGFzc3dvcmQgPSBwcm9jZXNzLmVudi5VTUFNSV9QQVNTV09SRCB8fCAnJztcblxuICBpZiAoIWJhc2VVcmwgfHwgIXdlYnNpdGVJZCB8fCAoIWFwaUtleSAmJiAoIXVzZXJuYW1lIHx8ICFwYXNzd29yZCkpKSB7XG4gICAgaWYgKGlzRGV2QnlwYXNzKSB7XG4gICAgICBjb25zdCBtb2NrVmlzaXRvcnMgPSBbMTIwMCwgOTgwLCA3NjAsIDUxMCwgMTQwXTtcbiAgICAgIGNvbnN0IG1vY2tQYWdlcyA9IEZVTk5FTF9QQUdFUy5tYXAoKHAsIGkpID0+ICh7XG4gICAgICAgIHBhdGg6IHAucGF0aCxcbiAgICAgICAgbmFtZTogYCR7cC5uYW1lfSAobW9jaylgLFxuICAgICAgICBwYWdldmlld3M6IG1vY2tWaXNpdG9yc1tpXSArIDIwMCxcbiAgICAgICAgdmlzaXRvcnM6IG1vY2tWaXNpdG9yc1tpXSxcbiAgICAgICAgYXZnVGltZTogNDUgKyBpICogMTgsXG4gICAgICAgIGJvdW5jZVJhdGU6IDI1ICsgaSAqIDgsXG4gICAgICAgIHRvcFNvdXJjZXM6IFtcbiAgICAgICAgICB7IG5hbWU6ICdJbnN0YWdyYW0nLCB2YWx1ZTogNDIwIC0gaSAqIDMwIH0sXG4gICAgICAgICAgeyBuYW1lOiAnRGlyZWN0JywgdmFsdWU6IDI4MCAtIGkgKiAyMCB9LFxuICAgICAgICAgIHsgbmFtZTogJ1lvdVR1YmUnLCB2YWx1ZTogMTkwIC0gaSAqIDEyIH0sXG4gICAgICAgIF0sXG4gICAgICAgIHRvcENvdW50cmllczogW1xuICAgICAgICAgIHsgbmFtZTogJ0ZSJywgdmFsdWU6IDcwMCAtIGkgKiAzNSB9LFxuICAgICAgICAgIHsgbmFtZTogJ0JFJywgdmFsdWU6IDEyMCAtIGkgKiA2IH0sXG4gICAgICAgICAgeyBuYW1lOiAnQ0gnLCB2YWx1ZTogOTAgLSBpICogNSB9LFxuICAgICAgICBdLFxuICAgICAgICBkZXZpY2VzOiB7IG1vYmlsZTogNzQsIGRlc2t0b3A6IDIzLCB0YWJsZXQ6IDMgfSxcbiAgICAgIH0pKTtcbiAgICAgIHJldHVybiBqc29uKDIwMCwge1xuICAgICAgICBwZXJpb2Q6IHsgc3RhcnRBdCwgZW5kQXQgfSxcbiAgICAgICAgcGFnZXM6IG1vY2tQYWdlcyxcbiAgICAgICAgbW9jazogdHJ1ZSxcbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4ganNvbig1MDAsIHtcbiAgICAgIGVycm9yOlxuICAgICAgICAnVW1hbWkgZW52IHZhcnMgbWFucXVhbnRlczogVU1BTUlfQkFTRV9VUkwsIFVNQU1JX1dFQlNJVEVfSUQsIGV0IChVTUFNSV9BUElfS0VZIG91IFVNQU1JX1VTRVJOQU1FICsgVU1BTUlfUEFTU1dPUkQpJyxcbiAgICB9KTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgYXV0aCA9IGFwaUtleVxuICAgICAgPyB7IHR5cGU6ICdhcGkta2V5JywgdmFsdWU6IGFwaUtleSB9XG4gICAgICA6IHsgdHlwZTogJ2JlYXJlcicsIHZhbHVlOiBhd2FpdCB1bWFtaUxvZ2luKGJhc2VVcmwsIHVzZXJuYW1lLCBwYXNzd29yZCkgfTtcbiAgICBjb25zdCBwYWdlcyA9IGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgRlVOTkVMX1BBR0VTLm1hcCgocCkgPT4gYnVpbGRQYWdlU3RhdHMoYmFzZVVybCwgYXV0aCwgd2Vic2l0ZUlkLCBzdGFydEF0LCBlbmRBdCwgcCkpXG4gICAgKTtcbiAgICByZXR1cm4ganNvbigyMDAsIHtcbiAgICAgIHBlcmlvZDogeyBzdGFydEF0LCBlbmRBdCB9LFxuICAgICAgcGFnZXMsXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHJldHVybiBqc29uKDUwMywge1xuICAgICAgZXJyb3I6ICdVbWFtaSBpbmRpc3BvbmlibGUnLFxuICAgICAgZGV0YWlsOiBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogJ0VycmV1ciBpbmNvbm51ZScsXG4gICAgfSk7XG4gIH1cbn07XG5cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7QUFBQSxPQUFPLFlBQVk7QUFFbkIsSUFBTSxjQUFjO0FBVXBCLFNBQVMsYUFBYSxLQUFLO0FBQ3pCLFFBQU0sTUFBTSxJQUFLLElBQUksU0FBUztBQUM5QixRQUFNLElBQUksSUFBSSxRQUFRLE1BQU0sR0FBRyxFQUFFLFFBQVEsTUFBTSxHQUFHLEtBQUssTUFBTSxJQUFJLElBQUksT0FBTyxHQUFHLElBQUk7QUFDbkYsU0FBTyxPQUFPLEtBQUssR0FBRyxRQUFRO0FBQ2hDO0FBbUJPLFNBQVMsbUJBQW1CLE9BQU8sUUFBUTtBQUNoRCxNQUFJLENBQUMsU0FBUyxPQUFPLFVBQVUsU0FBVSxRQUFPO0FBQ2hELFFBQU0sTUFBTSxNQUFNLFlBQVksR0FBRztBQUNqQyxNQUFJ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
