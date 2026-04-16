
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


// netlify/functions/register-webinaire.js
import crypto from "crypto";

// netlify/functions/lib/webinaire-session-paris.mjs
function parseParisParts(date) {
  const formatter = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    numberingSystem: "latn",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(date);
  const value = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  const weekRaw = parts.find((p) => p.type === "weekday")?.value || "";
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
    weekdayText: weekRaw.toLowerCase()
  };
}
function getParisWeekdayNumber(parts) {
  const dayMap = { lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6, dim: 7 };
  for (const [key, val] of Object.entries(dayMap)) {
    if (parts.weekdayText.startsWith(key)) return val;
  }
  return 1;
}
function addDaysParisCalendar(year, month, day, deltaDays) {
  const d = new Date(Date.UTC(year, month - 1, day + deltaDays, 12, 0, 0));
  const p = parseParisParts(d);
  return { year: p.year, month: p.month, day: p.day };
}
function findParisInstantUtc(parisYear, parisMonth, parisDay, parisHour) {
  let candidate = new Date(Date.UTC(parisYear, parisMonth - 1, parisDay, parisHour - 1, 0, 0));
  for (let i = 0; i < 4e3; i++) {
    const p = parseParisParts(candidate);
    if (p.year === parisYear && p.month === parisMonth && p.day === parisDay && p.hour === parisHour) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() + 60 * 1e3);
  }
  const broadStart = Date.UTC(parisYear, parisMonth - 1, parisDay, 0, 0, 0);
  const broadEnd = broadStart + 48 * 60 * 60 * 1e3;
  for (let t = broadStart; t < broadEnd; t += 60 * 1e3) {
    const p = parseParisParts(new Date(t));
    if (p.year === parisYear && p.month === parisMonth && p.day === parisDay && p.hour === parisHour) {
      return new Date(t);
    }
  }
  return null;
}
function getMarketingThursdayDateParts(now = /* @__PURE__ */ new Date()) {
  const parisNow = parseParisParts(now);
  const dow = getParisWeekdayNumber(parisNow);
  const daysFromMonday = dow - 1;
  const mon = addDaysParisCalendar(parisNow.year, parisNow.month, parisNow.day, -daysFromMonday);
  const thu = addDaysParisCalendar(mon.year, mon.month, mon.day, 3);
  const thu19 = findParisInstantUtc(thu.year, thu.month, thu.day, 19);
  if (!thu19) return thu;
  if (now.getTime() < thu19.getTime()) {
    return thu;
  }
  return addDaysParisCalendar(thu.year, thu.month, thu.day, 7);
}
function getRegistrationSessionInstantUtc(now, _creneau) {
  const thu = getMarketingThursdayDateParts(now);
  return findParisInstantUtc(thu.year, thu.month, thu.day, 20);
}
var SESSION_MS = 45 * 60 * 1e3;
function getSessionEndsAtUtc(sessionStartUtc) {
  if (!sessionStartUtc) return null;
  return new Date(new Date(sessionStartUtc).getTime() + SESSION_MS);
}
function getOffreExpiresAtUtc(sessionStartUtc) {
  if (!sessionStartUtc) return null;
  const p = parseParisParts(new Date(sessionStartUtc));
  const sun = addDaysParisCalendar(p.year, p.month, p.day, 3);
  return findParisInstantUtc(sun.year, sun.month, sun.day, 23);
}
function formatParisOptinTimestamp(date = /* @__PURE__ */ new Date()) {
  const d = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = d.formatToParts(date);
  const get = (type) => parts.find((x) => x.type === type)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

// netlify/functions/lib/mailerlite-webinaire.mjs
var MAILERLITE_API_BASE = "https://connect.mailerlite.com/api";
async function getMailerLiteSubscriberId(email, apiKey) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json"
  };
  try {
    const res = await fetch(`${MAILERLITE_API_BASE}/subscribers/${encodeURIComponent(email)}`, {
      method: "GET",
      headers
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.id || null;
  } catch {
    return null;
  }
}
async function addSubscriberToGroup(subscriberId, groupId, apiKey) {
  if (!subscriberId || !groupId) {
    return { assigned: false, alreadyInGroup: false };
  }
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json"
  };
  const res = await fetch(`${MAILERLITE_API_BASE}/subscribers/${subscriberId}/groups/${groupId}`, {
    method: "POST",
    headers
  });
  if (!res.ok && res.status !== 422) {
    const err = await res.json().catch(() => ({}));
    console.error("MailerLite add group error:", err);
    return { assigned: false, alreadyInGroup: false };
  }
  if (res.status === 422) {
    return { assigned: false, alreadyInGroup: true };
  }
  return { assigned: true, alreadyInGroup: false };
}
async function upsertWebinaireSubscriber({
  email,
  prenom,
  telephone,
  pays,
  token,
  dateOptinMasterclass,
  dateWebinaire,
  groupId,
  apiKey
}) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  const fields = {
    first_name: prenom,
    name: prenom,
    phone: telephone,
    location: pays,
    unique_token_webinaire: token,
    ...dateOptinMasterclass ? { date_optin_masterclass: dateOptinMasterclass } : {},
    ...dateWebinaire ? {
      es_2_0_date_webinaire: dateWebinaire,
      date_webinaire: dateWebinaire,
      es2_date_webinaire: dateWebinaire
    } : {}
  };
  let subscriberId = await getMailerLiteSubscriberId(email, apiKey);
  if (subscriberId) {
    await fetch(`${MAILERLITE_API_BASE}/subscribers/${subscriberId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ status: "active", fields })
    });
  } else {
    const createResponse = await fetch(`${MAILERLITE_API_BASE}/subscribers`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, status: "active", fields })
    });
    const createJson = await createResponse.json();
    if (!createResponse.ok) {
      throw new Error(createJson?.message || "MailerLite create error");
    }
    subscriberId = createJson?.data?.id || null;
  }
  let groupAssignedAt = null;
  if (subscriberId && groupId) {
    const groupResult = await addSubscriberToGroup(subscriberId, groupId, apiKey);
    if (groupResult.assigned || groupResult.alreadyInGroup) {
      groupAssignedAt = (/* @__PURE__ */ new Date()).toISOString();
      const groupDateFields = {
        sajoute_dans_le_groupe_le: groupAssignedAt,
        es2_ajoute_dans_le_groupe_le: groupAssignedAt,
        date_ajout_groupe_webinaire: groupAssignedAt
      };
      await fetch(`${MAILERLITE_API_BASE}/subscribers/${subscriberId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          status: "active",
          fields: groupDateFields
        })
      }).catch(() => {
      });
    }
  }
  return { subscriberId, groupAssignedAt };
}
function getWebinaireGroupEnv() {
  return {
    inscrits: process.env.MAILERLITE_GROUP_WEBINAIRE_INSCRITS || process.env.MAILERLITE_GROUP_WEBINAIRE_ES2_INSCRITS || process.env.MAILERLITE_GROUP_WEBINAIRE_ES2 || process.env.MAILERLITE_GROUP_WEBINAR_ES2,
    presents: process.env.MAILERLITE_GROUP_WEBINAIRE_PRESENTS || process.env.MAILERLITE_GROUP_WEBINAIRE_ES2_PRESENTS,
    acheteurs: process.env.MAILERLITE_GROUP_WEBINAIRE_ACHETEURS || process.env.MAILERLITE_GROUP_WEBINAIRE_ES2_ACHETEURS,
    nonAcheteurs: process.env.MAILERLITE_GROUP_WEBINAIRE_NON_ACHETEURS || process.env.MAILERLITE_GROUP_WEBINAIRE_ES2_NON_ACHETEURS
  };
}

// netlify/functions/lib/supabase-rest.mjs
function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, key };
}
function supabaseHeaders(extra = {}) {
  const { key } = getSupabaseConfig();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra
  };
}
async function supabaseGet(path) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return { ok: false, status: 500, data: null, error: "Supabase non configur\xE9" };
  }
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: supabaseHeaders()
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data, error: res.ok ? null : data };
}
async function supabasePost(table, body, { prefer = "return=representation" } = {}) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return { ok: false, status: 500, data: null, error: "Supabase non configur\xE9" };
  }
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: supabaseHeaders({ Prefer: prefer }),
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data, error: res.ok ? null : data };
}
async function supabasePatch(table, query, body) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return { ok: false, status: 500, data: null, error: "Supabase non configur\xE9" };
  }
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: supabaseHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data, error: res.ok ? null : data };
}

// netlify/functions/register-webinaire.js
function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json"
    }
  });
}
function generateToken() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
var register_webinaire_default = async (req) => {
  if (req.method === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }
  try {
    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();
    const prenom = String(body?.prenom || "").trim();
    const telephone = String(body?.telephone || "").trim();
    const pays = String(body?.pays || "").trim();
    const hasPhonePayload = Boolean(telephone && pays);
    if (!email || !email.includes("@") || !prenom) {
      return jsonResponse(400, { error: "Param\xE8tres manquants" });
    }
    const slotParis = "20h";
    const ex = await supabaseGet(
      `webinaire_exclusions?email=eq.${encodeURIComponent(email)}&select=email,raison`
    );
    if (ex.ok && Array.isArray(ex.data) && ex.data.length > 0) {
      return jsonResponse(403, { error: "excluded", reason: "excluded", raison: ex.data[0].raison });
    }
    const existing = await supabaseGet(
      `webinaire_registrations?email=eq.${encodeURIComponent(email)}&select=token,prenom,telephone,pays,mailerlite_group_added_at,statut,session_date,session_ends_at,offre_expires_at`
    );
    if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) {
      const e = existing.data[0];
      const patchBody = {};
      if (prenom && prenom !== (e.prenom || "")) patchBody.prenom = prenom;
      if (hasPhonePayload) {
        patchBody.telephone = telephone;
        patchBody.pays = pays;
      }
      if (Object.keys(patchBody).length > 0) {
        const upd = await supabasePatch(
          "webinaire_registrations",
          `email=eq.${encodeURIComponent(email)}`,
          patchBody
        );
        if (!upd.ok) {
          console.error("Supabase update webinaire_registrations:", upd.status, upd.error);
        }
      }
      const apiKey2 = process.env.MAILERLITE_API_KEY;
      const groups2 = getWebinaireGroupEnv();
      const groupInscrits2 = groups2.inscrits || process.env.MAILERLITE_GROUP_WEBINAIRE_INSCRITS || process.env.MAILERLITE_GROUP_WEBINAIRE_ES2_INSCRITS || process.env.MAILERLITE_GROUP_WEBINAIRE_ES2 || process.env.MAILERLITE_GROUP_WEBINAR_ES2;
      if (apiKey2 && groupInscrits2) {
        try {
          const ml = await upsertWebinaireSubscriber({
            email,
            prenom: prenom || e.prenom || "",
            telephone: hasPhonePayload ? telephone : e.telephone || "",
            pays: hasPhonePayload ? pays : e.pays || "",
            token: e.token,
            dateOptinMasterclass: formatParisOptinTimestamp(/* @__PURE__ */ new Date()),
            dateWebinaire: e.session_date || null,
            groupId: groupInscrits2,
            apiKey: apiKey2
          });
          if (ml?.groupAssignedAt && !e.mailerlite_group_added_at) {
            const markAddedAt = await supabasePatch(
              "webinaire_registrations",
              `email=eq.${encodeURIComponent(email)}`,
              { mailerlite_group_added_at: ml.groupAssignedAt }
            );
            if (!markAddedAt.ok) {
              console.error(
                "Supabase update mailerlite_group_added_at (existing):",
                markAddedAt.status,
                markAddedAt.error
              );
            }
          }
        } catch (mlErr) {
          console.error("MailerLite register-webinaire existing:", mlErr);
        }
      }
      return jsonResponse(200, {
        success: true,
        alreadyRegistered: true,
        token: e.token,
        statut: e.statut,
        sessionStartsAt: e.session_date,
        sessionEndsAt: e.session_ends_at,
        offreExpiresAt: e.offre_expires_at,
        redirectTo: `/masterclass/confirmation?t=${e.token}`
      });
    }
    const token = generateToken();
    const now = /* @__PURE__ */ new Date();
    const sessionStart = getRegistrationSessionInstantUtc(now, slotParis);
    if (!sessionStart) {
      return jsonResponse(500, { error: "Impossible de calculer la session" });
    }
    const sessionEndsAt = getSessionEndsAtUtc(sessionStart.toISOString());
    const offreExpiresAt = getOffreExpiresAtUtc(sessionStart.toISOString());
    if (!sessionEndsAt || !offreExpiresAt) {
      return jsonResponse(500, { error: "Impossible de calculer les dates" });
    }
    const row = {
      token,
      email,
      prenom,
      telephone: telephone || null,
      pays: pays || null,
      creneau: slotParis,
      session_date: sessionStart.toISOString(),
      session_ends_at: sessionEndsAt.toISOString(),
      offre_expires_at: offreExpiresAt.toISOString(),
      statut: "inscrit"
    };
    const ins = await supabasePost("webinaire_registrations", row, { prefer: "return=minimal" });
    if (!ins.ok) {
      console.error("Supabase insert webinaire_registrations:", ins.status, ins.error);
      return jsonResponse(500, {
        error: "Erreur enregistrement",
        details: process.env.NETLIFY_DEV ? ins.error : void 0
      });
    }
    const apiKey = process.env.MAILERLITE_API_KEY;
    const groups = getWebinaireGroupEnv();
    const groupInscrits = groups.inscrits || process.env.MAILERLITE_GROUP_WEBINAIRE_INSCRITS || process.env.MAILERLITE_GROUP_WEBINAIRE_ES2_INSCRITS || process.env.MAILERLITE_GROUP_WEBINAIRE_ES2 || process.env.MAILERLITE_GROUP_WEBINAR_ES2;
    if (apiKey && groupInscrits) {
      try {
        const ml = await upsertWebinaireSubscriber({
          email,
          prenom,
          telephone,
          pays,
          token,
          dateOptinMasterclass: formatParisOptinTimestamp(/* @__PURE__ */ new Date()),
          dateWebinaire: sessionStart.toISOString(),
          groupId: groupInscrits,
          apiKey
        });
        if (ml?.groupAssignedAt) {
          const markAddedAt = await supabasePatch(
            "webinaire_registrations",
            `email=eq.${encodeURIComponent(email)}`,
            { mailerlite_group_added_at: ml.groupAssignedAt }
          );
          if (!markAddedAt.ok) {
            console.error(
              "Supabase update mailerlite_group_added_at (new):",
              markAddedAt.status,
              markAddedAt.error
            );
          }
        }
      } catch (mlErr) {
        console.error("MailerLite register-webinaire:", mlErr);
      }
    }
    return jsonResponse(200, {
      success: true,
      token,
      redirectTo: `/masterclass/confirmation?t=${token}`
    });
  } catch (error) {
    console.error("register-webinaire error:", error);
    return jsonResponse(500, {
      error: "Erreur serveur",
      details: process.env.NETLIFY_DEV ? error.message : void 0
    });
  }
};
export {
  register_webinaire_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9mdW5jdGlvbnMvcmVnaXN0ZXItd2ViaW5haXJlLmpzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL2xpYi93ZWJpbmFpcmUtc2Vzc2lvbi1wYXJpcy5tanMiLCAibmV0bGlmeS9mdW5jdGlvbnMvbGliL21haWxlcmxpdGUtd2ViaW5haXJlLm1qcyIsICJuZXRsaWZ5L2Z1bmN0aW9ucy9saWIvc3VwYWJhc2UtcmVzdC5tanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCBjcnlwdG8gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7XG4gIGdldFJlZ2lzdHJhdGlvblNlc3Npb25JbnN0YW50VXRjLFxuICBnZXRTZXNzaW9uRW5kc0F0VXRjLFxuICBnZXRPZmZyZUV4cGlyZXNBdFV0YyxcbiAgZm9ybWF0UGFyaXNPcHRpblRpbWVzdGFtcCxcbn0gZnJvbSAnLi9saWIvd2ViaW5haXJlLXNlc3Npb24tcGFyaXMubWpzJztcbmltcG9ydCB7IHVwc2VydFdlYmluYWlyZVN1YnNjcmliZXIsIGdldFdlYmluYWlyZUdyb3VwRW52IH0gZnJvbSAnLi9saWIvbWFpbGVybGl0ZS13ZWJpbmFpcmUubWpzJztcbmltcG9ydCB7IHN1cGFiYXNlR2V0LCBzdXBhYmFzZVBvc3QsIHN1cGFiYXNlUGF0Y2ggfSBmcm9tICcuL2xpYi9zdXBhYmFzZS1yZXN0Lm1qcyc7XG5cbmZ1bmN0aW9uIGpzb25SZXNwb25zZShzdGF0dXMsIHBheWxvYWQpIHtcbiAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeShwYXlsb2FkKSwge1xuICAgIHN0YXR1cyxcbiAgICBoZWFkZXJzOiB7XG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnQ29udGVudC1UeXBlJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ1BPU1QsIE9QVElPTlMnLFxuICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICB9LFxuICB9KTtcbn1cblxuZnVuY3Rpb24gZ2VuZXJhdGVUb2tlbigpIHtcbiAgaWYgKHR5cGVvZiBjcnlwdG8ucmFuZG9tVVVJRCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBjcnlwdG8ucmFuZG9tVVVJRCgpO1xuICB9XG4gIHJldHVybiBgJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX0tJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyLCAxMil9YDtcbn1cblxuZXhwb3J0IGRlZmF1bHQgYXN5bmMgKHJlcSkgPT4ge1xuICBpZiAocmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgcmV0dXJuIGpzb25SZXNwb25zZSgyMDAsIHsgb2s6IHRydWUgfSk7XG4gIH1cblxuICBpZiAocmVxLm1ldGhvZCAhPT0gJ1BPU1QnKSB7XG4gICAgcmV0dXJuIGpzb25SZXNwb25zZSg0MDUsIHsgZXJyb3I6ICdNZXRob2Qgbm90IGFsbG93ZWQnIH0pO1xuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVxLmpzb24oKTtcbiAgICBjb25zdCBlbWFpbCA9IFN0cmluZyhib2R5Py5lbWFpbCB8fCAnJylcbiAgICAgIC50cmltKClcbiAgICAgIC50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IHByZW5vbSA9IFN0cmluZyhib2R5Py5wcmVub20gfHwgJycpLnRyaW0oKTtcbiAgICBjb25zdCB0ZWxlcGhvbmUgPSBTdHJpbmcoYm9keT8udGVsZXBob25lIHx8ICcnKS50cmltKCk7XG4gICAgY29uc3QgcGF5cyA9IFN0cmluZyhib2R5Py5wYXlzIHx8ICcnKS50cmltKCk7XG4gICAgY29uc3QgaGFzUGhvbmVQYXlsb2FkID0gQm9vbGVhbih0ZWxlcGhvbmUgJiYgcGF5cyk7XG5cbiAgICBpZiAoIWVtYWlsIHx8ICFlbWFpbC5pbmNsdWRlcygnQCcpIHx8ICFwcmVub20pIHtcbiAgICAgIHJldHVybiBqc29uUmVzcG9uc2UoNDAwLCB7IGVycm9yOiAnUGFyYW1cdTAwRTh0cmVzIG1hbnF1YW50cycgfSk7XG4gICAgfVxuXG4gICAgY29uc3Qgc2xvdFBhcmlzID0gJzIwaCc7XG5cbiAgICBjb25zdCBleCA9IGF3YWl0IHN1cGFiYXNlR2V0KFxuICAgICAgYHdlYmluYWlyZV9leGNsdXNpb25zP2VtYWlsPWVxLiR7ZW5jb2RlVVJJQ29tcG9uZW50KGVtYWlsKX0mc2VsZWN0PWVtYWlsLHJhaXNvbmAsXG4gICAgKTtcbiAgICBpZiAoZXgub2sgJiYgQXJyYXkuaXNBcnJheShleC5kYXRhKSAmJiBleC5kYXRhLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBqc29uUmVzcG9uc2UoNDAzLCB7IGVycm9yOiAnZXhjbHVkZWQnLCByZWFzb246ICdleGNsdWRlZCcsIHJhaXNvbjogZXguZGF0YVswXS5yYWlzb24gfSk7XG4gICAgfVxuXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBzdXBhYmFzZUdldChcbiAgICAgIGB3ZWJpbmFpcmVfcmVnaXN0cmF0aW9ucz9lbWFpbD1lcS4ke2VuY29kZVVSSUNvbXBvbmVudChlbWFpbCl9JnNlbGVjdD10b2tlbixwcmVub20sdGVsZXBob25lLHBheXMsbWFpbGVybGl0ZV9ncm91cF9hZGRlZF9hdCxzdGF0dXQsc2Vzc2lvbl9kYXRlLHNlc3Npb25fZW5kc19hdCxvZmZyZV9leHBpcmVzX2F0YCxcbiAgICApO1xuICAgIGlmIChleGlzdGluZy5vayAmJiBBcnJheS5pc0FycmF5KGV4aXN0aW5nLmRhdGEpICYmIGV4aXN0aW5nLmRhdGEubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgZSA9IGV4aXN0aW5nLmRhdGFbMF07XG4gICAgICBjb25zdCBwYXRjaEJvZHkgPSB7fTtcbiAgICAgIGlmIChwcmVub20gJiYgcHJlbm9tICE9PSAoZS5wcmVub20gfHwgJycpKSBwYXRjaEJvZHkucHJlbm9tID0gcHJlbm9tO1xuICAgICAgaWYgKGhhc1Bob25lUGF5bG9hZCkge1xuICAgICAgICBwYXRjaEJvZHkudGVsZXBob25lID0gdGVsZXBob25lO1xuICAgICAgICBwYXRjaEJvZHkucGF5cyA9IHBheXM7XG4gICAgICB9XG4gICAgICBpZiAoT2JqZWN0LmtleXMocGF0Y2hCb2R5KS5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IHVwZCA9IGF3YWl0IHN1cGFiYXNlUGF0Y2goXG4gICAgICAgICAgJ3dlYmluYWlyZV9yZWdpc3RyYXRpb25zJyxcbiAgICAgICAgICBgZW1haWw9ZXEuJHtlbmNvZGVVUklDb21wb25lbnQoZW1haWwpfWAsXG4gICAgICAgICAgcGF0Y2hCb2R5LFxuICAgICAgICApO1xuICAgICAgICBpZiAoIXVwZC5vaykge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1N1cGFiYXNlIHVwZGF0ZSB3ZWJpbmFpcmVfcmVnaXN0cmF0aW9uczonLCB1cGQuc3RhdHVzLCB1cGQuZXJyb3IpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGFwaUtleSA9IHByb2Nlc3MuZW52Lk1BSUxFUkxJVEVfQVBJX0tFWTtcbiAgICAgIGNvbnN0IGdyb3VwcyA9IGdldFdlYmluYWlyZUdyb3VwRW52KCk7XG4gICAgICBjb25zdCBncm91cEluc2NyaXRzID1cbiAgICAgICAgZ3JvdXBzLmluc2NyaXRzIHx8XG4gICAgICAgIHByb2Nlc3MuZW52Lk1BSUxFUkxJVEVfR1JPVVBfV0VCSU5BSVJFX0lOU0NSSVRTIHx8XG4gICAgICAgIHByb2Nlc3MuZW52Lk1BSUxFUkxJVEVfR1JPVVBfV0VCSU5BSVJFX0VTMl9JTlNDUklUUyB8fFxuICAgICAgICBwcm9jZXNzLmVudi5NQUlMRVJMSVRFX0dST1VQX1dFQklOQUlSRV9FUzIgfHxcbiAgICAgICAgcHJvY2Vzcy5lbnYuTUFJTEVSTElURV9HUk9VUF9XRUJJTkFSX0VTMjtcblxuICAgICAgaWYgKGFwaUtleSAmJiBncm91cEluc2NyaXRzKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgbWwgPSBhd2FpdCB1cHNlcnRXZWJpbmFpcmVTdWJzY3JpYmVyKHtcbiAgICAgICAgICAgIGVtYWlsLFxuICAgICAgICAgICAgcHJlbm9tOiBwcmVub20gfHwgZS5wcmVub20gfHwgJycsXG4gICAgICAgICAgICB0ZWxlcGhvbmU6IGhhc1Bob25lUGF5bG9hZCA/IHRlbGVwaG9uZSA6IGUudGVsZXBob25lIHx8ICcnLFxuICAgICAgICAgICAgcGF5czogaGFzUGhvbmVQYXlsb2FkID8gcGF5cyA6IGUucGF5cyB8fCAnJyxcbiAgICAgICAgICAgIHRva2VuOiBlLnRva2VuLFxuICAgICAgICAgICAgZGF0ZU9wdGluTWFzdGVyY2xhc3M6IGZvcm1hdFBhcmlzT3B0aW5UaW1lc3RhbXAobmV3IERhdGUoKSksXG4gICAgICAgICAgICBkYXRlV2ViaW5haXJlOiBlLnNlc3Npb25fZGF0ZSB8fCBudWxsLFxuICAgICAgICAgICAgZ3JvdXBJZDogZ3JvdXBJbnNjcml0cyxcbiAgICAgICAgICAgIGFwaUtleSxcbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIGlmIChtbD8uZ3JvdXBBc3NpZ25lZEF0ICYmICFlLm1haWxlcmxpdGVfZ3JvdXBfYWRkZWRfYXQpIHtcbiAgICAgICAgICAgIGNvbnN0IG1hcmtBZGRlZEF0ID0gYXdhaXQgc3VwYWJhc2VQYXRjaChcbiAgICAgICAgICAgICAgJ3dlYmluYWlyZV9yZWdpc3RyYXRpb25zJyxcbiAgICAgICAgICAgICAgYGVtYWlsPWVxLiR7ZW5jb2RlVVJJQ29tcG9uZW50KGVtYWlsKX1gLFxuICAgICAgICAgICAgICB7IG1haWxlcmxpdGVfZ3JvdXBfYWRkZWRfYXQ6IG1sLmdyb3VwQXNzaWduZWRBdCB9LFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGlmICghbWFya0FkZGVkQXQub2spIHtcbiAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcbiAgICAgICAgICAgICAgICAnU3VwYWJhc2UgdXBkYXRlIG1haWxlcmxpdGVfZ3JvdXBfYWRkZWRfYXQgKGV4aXN0aW5nKTonLFxuICAgICAgICAgICAgICAgIG1hcmtBZGRlZEF0LnN0YXR1cyxcbiAgICAgICAgICAgICAgICBtYXJrQWRkZWRBdC5lcnJvcixcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKG1sRXJyKSB7XG4gICAgICAgICAgY29uc29sZS5lcnJvcignTWFpbGVyTGl0ZSByZWdpc3Rlci13ZWJpbmFpcmUgZXhpc3Rpbmc6JywgbWxFcnIpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBqc29uUmVzcG9uc2UoMjAwLCB7XG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgIGFscmVhZHlSZWdpc3RlcmVkOiB0cnVlLFxuICAgICAgICB0b2tlbjogZS50b2tlbixcbiAgICAgICAgc3RhdHV0OiBlLnN0YXR1dCxcbiAgICAgICAgc2Vzc2lvblN0YXJ0c0F0OiBlLnNlc3Npb25fZGF0ZSxcbiAgICAgICAgc2Vzc2lvbkVuZHNBdDogZS5zZXNzaW9uX2VuZHNfYXQsXG4gICAgICAgIG9mZnJlRXhwaXJlc0F0OiBlLm9mZnJlX2V4cGlyZXNfYXQsXG4gICAgICAgIHJlZGlyZWN0VG86IGAvbWFzdGVyY2xhc3MvY29uZmlybWF0aW9uP3Q9JHtlLnRva2VufWAsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCB0b2tlbiA9IGdlbmVyYXRlVG9rZW4oKTtcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuICAgIGNvbnN0IHNlc3Npb25TdGFydCA9IGdldFJlZ2lzdHJhdGlvblNlc3Npb25JbnN0YW50VXRjKG5vdywgc2xvdFBhcmlzKTtcbiAgICBpZiAoIXNlc3Npb25TdGFydCkge1xuICAgICAgcmV0dXJuIGpzb25SZXNwb25zZSg1MDAsIHsgZXJyb3I6ICdJbXBvc3NpYmxlIGRlIGNhbGN1bGVyIGxhIHNlc3Npb24nIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IHNlc3Npb25FbmRzQXQgPSBnZXRTZXNzaW9uRW5kc0F0VXRjKHNlc3Npb25TdGFydC50b0lTT1N0cmluZygpKTtcbiAgICBjb25zdCBvZmZyZUV4cGlyZXNBdCA9IGdldE9mZnJlRXhwaXJlc0F0VXRjKHNlc3Npb25TdGFydC50b0lTT1N0cmluZygpKTtcbiAgICBpZiAoIXNlc3Npb25FbmRzQXQgfHwgIW9mZnJlRXhwaXJlc0F0KSB7XG4gICAgICByZXR1cm4ganNvblJlc3BvbnNlKDUwMCwgeyBlcnJvcjogJ0ltcG9zc2libGUgZGUgY2FsY3VsZXIgbGVzIGRhdGVzJyB9KTtcbiAgICB9XG5cbiAgICBjb25zdCByb3cgPSB7XG4gICAgICB0b2tlbixcbiAgICAgIGVtYWlsLFxuICAgICAgcHJlbm9tLFxuICAgICAgdGVsZXBob25lOiB0ZWxlcGhvbmUgfHwgbnVsbCxcbiAgICAgIHBheXM6IHBheXMgfHwgbnVsbCxcbiAgICAgIGNyZW5lYXU6IHNsb3RQYXJpcyxcbiAgICAgIHNlc3Npb25fZGF0ZTogc2Vzc2lvblN0YXJ0LnRvSVNPU3RyaW5nKCksXG4gICAgICBzZXNzaW9uX2VuZHNfYXQ6IHNlc3Npb25FbmRzQXQudG9JU09TdHJpbmcoKSxcbiAgICAgIG9mZnJlX2V4cGlyZXNfYXQ6IG9mZnJlRXhwaXJlc0F0LnRvSVNPU3RyaW5nKCksXG4gICAgICBzdGF0dXQ6ICdpbnNjcml0JyxcbiAgICB9O1xuXG4gICAgY29uc3QgaW5zID0gYXdhaXQgc3VwYWJhc2VQb3N0KCd3ZWJpbmFpcmVfcmVnaXN0cmF0aW9ucycsIHJvdywgeyBwcmVmZXI6ICdyZXR1cm49bWluaW1hbCcgfSk7XG4gICAgaWYgKCFpbnMub2spIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1N1cGFiYXNlIGluc2VydCB3ZWJpbmFpcmVfcmVnaXN0cmF0aW9uczonLCBpbnMuc3RhdHVzLCBpbnMuZXJyb3IpO1xuICAgICAgcmV0dXJuIGpzb25SZXNwb25zZSg1MDAsIHtcbiAgICAgICAgZXJyb3I6ICdFcnJldXIgZW5yZWdpc3RyZW1lbnQnLFxuICAgICAgICBkZXRhaWxzOiBwcm9jZXNzLmVudi5ORVRMSUZZX0RFViA/IGlucy5lcnJvciA6IHVuZGVmaW5lZCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGFwaUtleSA9IHByb2Nlc3MuZW52Lk1BSUxFUkxJVEVfQVBJX0tFWTtcbiAgICBjb25zdCBncm91cHMgPSBnZXRXZWJpbmFpcmVHcm91cEVudigpO1xuICAgIGNvbnN0IGdyb3VwSW5zY3JpdHMgPVxuICAgICAgZ3JvdXBzLmluc2NyaXRzIHx8XG4gICAgICBwcm9jZXNzLmVudi5NQUlMRVJMSVRFX0dST1VQX1dFQklOQUlSRV9JTlNDUklUUyB8fFxuICAgICAgcHJvY2Vzcy5lbnYuTUFJTEVSTElURV9HUk9VUF9XRUJJTkFJUkVfRVMyX0lOU0NSSVRTIHx8XG4gICAgICBwcm9jZXNzLmVudi5NQUlMRVJMSVRFX0dST1VQX1dFQklOQUlSRV9FUzIgfHxcbiAgICAgIHByb2Nlc3MuZW52Lk1BSUxFUkxJVEVfR1JPVVBfV0VCSU5BUl9FUzI7XG5cbiAgICBpZiAoYXBpS2V5ICYmIGdyb3VwSW5zY3JpdHMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG1sID0gYXdhaXQgdXBzZXJ0V2ViaW5haXJlU3Vic2NyaWJlcih7XG4gICAgICAgICAgZW1haWwsXG4gICAgICAgICAgcHJlbm9tLFxuICAgICAgICAgIHRlbGVwaG9uZSxcbiAgICAgICAgICBwYXlzLFxuICAgICAgICAgIHRva2VuLFxuICAgICAgICAgIGRhdGVPcHRpbk1hc3RlcmNsYXNzOiBmb3JtYXRQYXJpc09wdGluVGltZXN0YW1wKG5ldyBEYXRlKCkpLFxuICAgICAgICAgIGRhdGVXZWJpbmFpcmU6IHNlc3Npb25TdGFydC50b0lTT1N0cmluZygpLFxuICAgICAgICAgIGdyb3VwSWQ6IGdyb3VwSW5zY3JpdHMsXG4gICAgICAgICAgYXBpS2V5LFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAobWw/Lmdyb3VwQXNzaWduZWRBdCkge1xuICAgICAgICAgIGNvbnN0IG1hcmtBZGRlZEF0ID0gYXdhaXQgc3VwYWJhc2VQYXRjaChcbiAgICAgICAgICAgICd3ZWJpbmFpcmVfcmVnaXN0cmF0aW9ucycsXG4gICAgICAgICAgICBgZW1haWw9ZXEuJHtlbmNvZGVVUklDb21wb25lbnQoZW1haWwpfWAsXG4gICAgICAgICAgICB7IG1haWxlcmxpdGVfZ3JvdXBfYWRkZWRfYXQ6IG1sLmdyb3VwQXNzaWduZWRBdCB9LFxuICAgICAgICAgICk7XG4gICAgICAgICAgaWYgKCFtYXJrQWRkZWRBdC5vaykge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcihcbiAgICAgICAgICAgICAgJ1N1cGFiYXNlIHVwZGF0ZSBtYWlsZXJsaXRlX2dyb3VwX2FkZGVkX2F0IChuZXcpOicsXG4gICAgICAgICAgICAgIG1hcmtBZGRlZEF0LnN0YXR1cyxcbiAgICAgICAgICAgICAgbWFya0FkZGVkQXQuZXJyb3IsXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAobWxFcnIpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignTWFpbGVyTGl0ZSByZWdpc3Rlci13ZWJpbmFpcmU6JywgbWxFcnIpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBqc29uUmVzcG9uc2UoMjAwLCB7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgdG9rZW4sXG4gICAgICByZWRpcmVjdFRvOiBgL21hc3RlcmNsYXNzL2NvbmZpcm1hdGlvbj90PSR7dG9rZW59YCxcbiAgICB9KTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKCdyZWdpc3Rlci13ZWJpbmFpcmUgZXJyb3I6JywgZXJyb3IpO1xuICAgIHJldHVybiBqc29uUmVzcG9uc2UoNTAwLCB7XG4gICAgICBlcnJvcjogJ0VycmV1ciBzZXJ2ZXVyJyxcbiAgICAgIGRldGFpbHM6IHByb2Nlc3MuZW52Lk5FVExJRllfREVWID8gZXJyb3IubWVzc2FnZSA6IHVuZGVmaW5lZCxcbiAgICB9KTtcbiAgfVxufTtcbiIsICIvKipcbiAqIERhdGVzIC8gc2Vzc2lvbnMgd2ViaW5haXJlIEVTIDIuMCBcdTIwMTQgZnVzZWF1IEV1cm9wZS9QYXJpcy5cbiAqIEN1dG9mZiBpbnNjcmlwdGlvbnMgOiBhdmFudCBqZXVkaSAxOWggKFBhcmlzKSBcdTIxOTIgQ0UgamV1ZGkgMjBoIDsgXHUwMEUwIHBhcnRpciBkZSBqZXVkaSAxOWggXHUyMTkyIGpldWRpIFNVSVZBTlQgMjBoLlxuICovXG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVBhcmlzUGFydHMoZGF0ZSkge1xuICBjb25zdCBmb3JtYXR0ZXIgPSBuZXcgSW50bC5EYXRlVGltZUZvcm1hdCgnZnItRlInLCB7XG4gICAgdGltZVpvbmU6ICdFdXJvcGUvUGFyaXMnLFxuICAgIG51bWJlcmluZ1N5c3RlbTogJ2xhdG4nLFxuICAgIHllYXI6ICdudW1lcmljJyxcbiAgICBtb250aDogJ251bWVyaWMnLFxuICAgIGRheTogJ251bWVyaWMnLFxuICAgIHdlZWtkYXk6ICdzaG9ydCcsXG4gICAgaG91cjogJ251bWVyaWMnLFxuICAgIG1pbnV0ZTogJ251bWVyaWMnLFxuICAgIHNlY29uZDogJ251bWVyaWMnLFxuICAgIGhvdXJDeWNsZTogJ2gyMycsXG4gIH0pO1xuICBjb25zdCBwYXJ0cyA9IGZvcm1hdHRlci5mb3JtYXRUb1BhcnRzKGRhdGUpO1xuICBjb25zdCB2YWx1ZSA9ICh0eXBlKSA9PiBOdW1iZXIocGFydHMuZmluZCgocCkgPT4gcC50eXBlID09PSB0eXBlKT8udmFsdWUgfHwgMCk7XG4gIGNvbnN0IHdlZWtSYXcgPSBwYXJ0cy5maW5kKChwKSA9PiBwLnR5cGUgPT09ICd3ZWVrZGF5Jyk/LnZhbHVlIHx8ICcnO1xuICByZXR1cm4ge1xuICAgIHllYXI6IHZhbHVlKCd5ZWFyJyksXG4gICAgbW9udGg6IHZhbHVlKCdtb250aCcpLFxuICAgIGRheTogdmFsdWUoJ2RheScpLFxuICAgIGhvdXI6IHZhbHVlKCdob3VyJyksXG4gICAgbWludXRlOiB2YWx1ZSgnbWludXRlJyksXG4gICAgc2Vjb25kOiB2YWx1ZSgnc2Vjb25kJyksXG4gICAgd2Vla2RheVRleHQ6IHdlZWtSYXcudG9Mb3dlckNhc2UoKSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZ2V0UGFyaXNXZWVrZGF5TnVtYmVyKHBhcnRzKSB7XG4gIGNvbnN0IGRheU1hcCA9IHsgbHVuOiAxLCBtYXI6IDIsIG1lcjogMywgamV1OiA0LCB2ZW46IDUsIHNhbTogNiwgZGltOiA3IH07XG4gIGZvciAoY29uc3QgW2tleSwgdmFsXSBvZiBPYmplY3QuZW50cmllcyhkYXlNYXApKSB7XG4gICAgaWYgKHBhcnRzLndlZWtkYXlUZXh0LnN0YXJ0c1dpdGgoa2V5KSkgcmV0dXJuIHZhbDtcbiAgfVxuICByZXR1cm4gMTtcbn1cblxuLyoqIEFqb3V0ZSBkZXMgam91cnMgYXUgY2FsZW5kcmllciBlbiBwYXNzYW50IHBhciB1bmUgZGF0ZSBVVEMgbWlkaSAoXHUwMEU5dml0ZSBkXHUwMEU5cml2ZXMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkZERheXNQYXJpc0NhbGVuZGFyKHllYXIsIG1vbnRoLCBkYXksIGRlbHRhRGF5cykge1xuICBjb25zdCBkID0gbmV3IERhdGUoRGF0ZS5VVEMoeWVhciwgbW9udGggLSAxLCBkYXkgKyBkZWx0YURheXMsIDEyLCAwLCAwKSk7XG4gIGNvbnN0IHAgPSBwYXJzZVBhcmlzUGFydHMoZCk7XG4gIHJldHVybiB7IHllYXI6IHAueWVhciwgbW9udGg6IHAubW9udGgsIGRheTogcC5kYXkgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZpbmRQYXJpc0luc3RhbnRVdGMocGFyaXNZZWFyLCBwYXJpc01vbnRoLCBwYXJpc0RheSwgcGFyaXNIb3VyKSB7XG4gIGxldCBjYW5kaWRhdGUgPSBuZXcgRGF0ZShEYXRlLlVUQyhwYXJpc1llYXIsIHBhcmlzTW9udGggLSAxLCBwYXJpc0RheSwgcGFyaXNIb3VyIC0gMSwgMCwgMCkpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDQwMDA7IGkrKykge1xuICAgIGNvbnN0IHAgPSBwYXJzZVBhcmlzUGFydHMoY2FuZGlkYXRlKTtcbiAgICBpZiAocC55ZWFyID09PSBwYXJpc1llYXIgJiYgcC5tb250aCA9PT0gcGFyaXNNb250aCAmJiBwLmRheSA9PT0gcGFyaXNEYXkgJiYgcC5ob3VyID09PSBwYXJpc0hvdXIpIHtcbiAgICAgIHJldHVybiBjYW5kaWRhdGU7XG4gICAgfVxuICAgIGNhbmRpZGF0ZSA9IG5ldyBEYXRlKGNhbmRpZGF0ZS5nZXRUaW1lKCkgKyA2MCAqIDEwMDApO1xuICB9XG5cbiAgLy8gRmFsbGJhY2sgcm9idXN0ZSA6IG9uIGJhbGFpZSA0OGggYXV0b3VyIGRlIGxhIGRhdGUgY2libGUuXG4gIC8vIFV0aWxlIHNpIGwnZW52aXJvbm5lbWVudCBydW50aW1lIGEgdW4gY29tcG9ydGVtZW50IEludGwgaW5hdHRlbmR1LlxuICBjb25zdCBicm9hZFN0YXJ0ID0gRGF0ZS5VVEMocGFyaXNZZWFyLCBwYXJpc01vbnRoIC0gMSwgcGFyaXNEYXksIDAsIDAsIDApO1xuICBjb25zdCBicm9hZEVuZCA9IGJyb2FkU3RhcnQgKyA0OCAqIDYwICogNjAgKiAxMDAwO1xuICBmb3IgKGxldCB0ID0gYnJvYWRTdGFydDsgdCA8IGJyb2FkRW5kOyB0ICs9IDYwICogMTAwMCkge1xuICAgIGNvbnN0IHAgPSBwYXJzZVBhcmlzUGFydHMobmV3IERhdGUodCkpO1xuICAgIGlmIChwLnllYXIgPT09IHBhcmlzWWVhciAmJiBwLm1vbnRoID09PSBwYXJpc01vbnRoICYmIHAuZGF5ID09PSBwYXJpc0RheSAmJiBwLmhvdXIgPT09IHBhcmlzSG91cikge1xuICAgICAgcmV0dXJuIG5ldyBEYXRlKHQpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIEpldWRpIFx1MDBBQiBjaWJsZSBcdTAwQkIgcG91ciBsZXMgaW5zY3JpcHRpb25zIChkYXRlIGNhbGVuZGFpcmUgUGFyaXMgWS9NL0QpLlxuICogU2kgbWFpbnRlbmFudCA8IGpldWRpIDE5aCAoUGFyaXMpIGRlIGNldHRlIHNlbWFpbmUgXHUyMTkyIGNlIGpldWRpIDsgc2lub24gamV1ZGkgZGFucyA3IGpvdXJzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0TWFya2V0aW5nVGh1cnNkYXlEYXRlUGFydHMobm93ID0gbmV3IERhdGUoKSkge1xuICBjb25zdCBwYXJpc05vdyA9IHBhcnNlUGFyaXNQYXJ0cyhub3cpO1xuICBjb25zdCBkb3cgPSBnZXRQYXJpc1dlZWtkYXlOdW1iZXIocGFyaXNOb3cpO1xuICBjb25zdCBkYXlzRnJvbU1vbmRheSA9IGRvdyAtIDE7XG4gIGNvbnN0IG1vbiA9IGFkZERheXNQYXJpc0NhbGVuZGFyKHBhcmlzTm93LnllYXIsIHBhcmlzTm93Lm1vbnRoLCBwYXJpc05vdy5kYXksIC1kYXlzRnJvbU1vbmRheSk7XG4gIGNvbnN0IHRodSA9IGFkZERheXNQYXJpc0NhbGVuZGFyKG1vbi55ZWFyLCBtb24ubW9udGgsIG1vbi5kYXksIDMpO1xuXG4gIGNvbnN0IHRodTE5ID0gZmluZFBhcmlzSW5zdGFudFV0Yyh0aHUueWVhciwgdGh1Lm1vbnRoLCB0aHUuZGF5LCAxOSk7XG4gIGlmICghdGh1MTkpIHJldHVybiB0aHU7XG5cbiAgaWYgKG5vdy5nZXRUaW1lKCkgPCB0aHUxOS5nZXRUaW1lKCkpIHtcbiAgICByZXR1cm4gdGh1O1xuICB9XG4gIHJldHVybiBhZGREYXlzUGFyaXNDYWxlbmRhcih0aHUueWVhciwgdGh1Lm1vbnRoLCB0aHUuZGF5LCA3KTtcbn1cblxuLyoqXG4gKiBJbnN0YW50IFVUQyBkZSBkXHUwMEU5YnV0IGRlIHNlc3Npb24gcG91ciB1bmUgbm91dmVsbGUgaW5zY3JpcHRpb24gKGNyXHUwMEU5bmVhdSB1bmlxdWUgOiBqZXVkaSAyMGggUGFyaXMpLlxuICogQHBhcmFtIHsnMTRoJ3wnMjBoJ30gW19jcmVuZWF1XSBcdTIwMTQgaWdub3JcdTAwRTksIGNvbnNlcnZcdTAwRTkgcG91ciBjb21wYXRpYmlsaXRcdTAwRTkgQVBJXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRSZWdpc3RyYXRpb25TZXNzaW9uSW5zdGFudFV0Yyhub3csIF9jcmVuZWF1KSB7XG4gIGNvbnN0IHRodSA9IGdldE1hcmtldGluZ1RodXJzZGF5RGF0ZVBhcnRzKG5vdyk7XG4gIHJldHVybiBmaW5kUGFyaXNJbnN0YW50VXRjKHRodS55ZWFyLCB0aHUubW9udGgsIHRodS5kYXksIDIwKTtcbn1cblxuY29uc3QgU0VTU0lPTl9NUyA9IDQ1ICogNjAgKiAxMDAwO1xuXG5leHBvcnQgZnVuY3Rpb24gZ2V0U2Vzc2lvbkVuZHNBdFV0YyhzZXNzaW9uU3RhcnRVdGMpIHtcbiAgaWYgKCFzZXNzaW9uU3RhcnRVdGMpIHJldHVybiBudWxsO1xuICByZXR1cm4gbmV3IERhdGUobmV3IERhdGUoc2Vzc2lvblN0YXJ0VXRjKS5nZXRUaW1lKCkgKyBTRVNTSU9OX01TKTtcbn1cblxuLyoqXG4gKiBEaW1hbmNoZSAyM2ggKFBhcmlzKSBkZSBsYSBtXHUwMEVBbWUgc2VtYWluZSBxdWUgbGUgamV1ZGkgZGUgc2Vzc2lvbiAoamV1ZGkgKyAzIGpvdXJzKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldE9mZnJlRXhwaXJlc0F0VXRjKHNlc3Npb25TdGFydFV0Yykge1xuICBpZiAoIXNlc3Npb25TdGFydFV0YykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHAgPSBwYXJzZVBhcmlzUGFydHMobmV3IERhdGUoc2Vzc2lvblN0YXJ0VXRjKSk7XG4gIGNvbnN0IHN1biA9IGFkZERheXNQYXJpc0NhbGVuZGFyKHAueWVhciwgcC5tb250aCwgcC5kYXksIDMpO1xuICByZXR1cm4gZmluZFBhcmlzSW5zdGFudFV0YyhzdW4ueWVhciwgc3VuLm1vbnRoLCBzdW4uZGF5LCAyMyk7XG59XG5cbi8qKlxuICogUHJvY2hhaW4gaW5zdGFudCBcdTAwRTAgYWZmaWNoZXIgcG91ciBjb3VudGRvd24gKGpldWRpIDIwaCBzdXIgbGUgamV1ZGkgbWFya2V0aW5nKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldE1hcmtldGluZ0NvdW50ZG93blRhcmdldFV0Yyhub3cgPSBuZXcgRGF0ZSgpKSB7XG4gIGNvbnN0IHRodSA9IGdldE1hcmtldGluZ1RodXJzZGF5RGF0ZVBhcnRzKG5vdyk7XG4gIGNvbnN0IHQyMCA9IGZpbmRQYXJpc0luc3RhbnRVdGModGh1LnllYXIsIHRodS5tb250aCwgdGh1LmRheSwgMjApO1xuICBpZiAoIXQyMCkgcmV0dXJuIG51bGw7XG4gIGlmIChub3cuZ2V0VGltZSgpIDwgdDIwLmdldFRpbWUoKSkgcmV0dXJuIHQyMDtcbiAgY29uc3QgbmV4dFRodSA9IGFkZERheXNQYXJpc0NhbGVuZGFyKHRodS55ZWFyLCB0aHUubW9udGgsIHRodS5kYXksIDcpO1xuICByZXR1cm4gZmluZFBhcmlzSW5zdGFudFV0YyhuZXh0VGh1LnllYXIsIG5leHRUaHUubW9udGgsIG5leHRUaHUuZGF5LCAyMCk7XG59XG5cbi8qKlxuICogSG9yb2RhdGFnZSBvcHQtaW4gcG91ciBjaGFtcCBNYWlsZXJMaXRlIDogamoubW0uYWFhYSBISDptbTpzcyAoRXVyb3BlL1BhcmlzKS5cbiAqIEV4LiAyMi4wMy4yMDI2IDE3OjQ1OjAzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRQYXJpc09wdGluVGltZXN0YW1wKGRhdGUgPSBuZXcgRGF0ZSgpKSB7XG4gIGNvbnN0IGQgPSBuZXcgSW50bC5EYXRlVGltZUZvcm1hdCgnZnItRlInLCB7XG4gICAgdGltZVpvbmU6ICdFdXJvcGUvUGFyaXMnLFxuICAgIGRheTogJzItZGlnaXQnLFxuICAgIG1vbnRoOiAnMi1kaWdpdCcsXG4gICAgeWVhcjogJ251bWVyaWMnLFxuICAgIGhvdXI6ICcyLWRpZ2l0JyxcbiAgICBtaW51dGU6ICcyLWRpZ2l0JyxcbiAgICBzZWNvbmQ6ICcyLWRpZ2l0JyxcbiAgICBob3VyQ3ljbGU6ICdoMjMnLFxuICB9KTtcbiAgY29uc3QgcGFydHMgPSBkLmZvcm1hdFRvUGFydHMoZGF0ZSk7XG4gIGNvbnN0IGdldCA9ICh0eXBlKSA9PiBwYXJ0cy5maW5kKCh4KSA9PiB4LnR5cGUgPT09IHR5cGUpPy52YWx1ZSA/PyAnJztcbiAgcmV0dXJuIGAke2dldCgnZGF5Jyl9LiR7Z2V0KCdtb250aCcpfS4ke2dldCgneWVhcicpfSAke2dldCgnaG91cicpfToke2dldCgnbWludXRlJyl9OiR7Z2V0KCdzZWNvbmQnKX1gO1xufVxuXG4vKiogQGRlcHJlY2F0ZWQgXHUyMDE0IHByXHUwMEU5Zlx1MDBFOXJlciBnZXRSZWdpc3RyYXRpb25TZXNzaW9uSW5zdGFudFV0YyAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldE5leHRUaHVyc2RheVNsb3RVdGMobm93LCBwYXJpc0hvdXIpIHtcbiAgY29uc3QgY3JlbmVhdSA9IHBhcmlzSG91ciA9PT0gMjAgPyAnMjBoJyA6ICcxNGgnO1xuICByZXR1cm4gZ2V0UmVnaXN0cmF0aW9uU2Vzc2lvbkluc3RhbnRVdGMobm93LCBjcmVuZWF1KTtcbn1cbiIsICJjb25zdCBNQUlMRVJMSVRFX0FQSV9CQVNFID0gJ2h0dHBzOi8vY29ubmVjdC5tYWlsZXJsaXRlLmNvbS9hcGknO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0TWFpbGVyTGl0ZVN1YnNjcmliZXJJZChlbWFpbCwgYXBpS2V5KSB7XG4gIGNvbnN0IGhlYWRlcnMgPSB7XG4gICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke2FwaUtleX1gLFxuICAgIEFjY2VwdDogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICB9O1xuICB0cnkge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKGAke01BSUxFUkxJVEVfQVBJX0JBU0V9L3N1YnNjcmliZXJzLyR7ZW5jb2RlVVJJQ29tcG9uZW50KGVtYWlsKX1gLCB7XG4gICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgaGVhZGVycyxcbiAgICB9KTtcbiAgICBpZiAoIXJlcy5vaykgcmV0dXJuIG51bGw7XG4gICAgY29uc3QganNvbiA9IGF3YWl0IHJlcy5qc29uKCk7XG4gICAgcmV0dXJuIGpzb24/LmRhdGE/LmlkIHx8IG51bGw7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBhZGRTdWJzY3JpYmVyVG9Hcm91cChzdWJzY3JpYmVySWQsIGdyb3VwSWQsIGFwaUtleSkge1xuICBpZiAoIXN1YnNjcmliZXJJZCB8fCAhZ3JvdXBJZCkge1xuICAgIHJldHVybiB7IGFzc2lnbmVkOiBmYWxzZSwgYWxyZWFkeUluR3JvdXA6IGZhbHNlIH07XG4gIH1cbiAgY29uc3QgaGVhZGVycyA9IHtcbiAgICBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7YXBpS2V5fWAsXG4gICAgQWNjZXB0OiAnYXBwbGljYXRpb24vanNvbicsXG4gIH07XG4gIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKGAke01BSUxFUkxJVEVfQVBJX0JBU0V9L3N1YnNjcmliZXJzLyR7c3Vic2NyaWJlcklkfS9ncm91cHMvJHtncm91cElkfWAsIHtcbiAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICBoZWFkZXJzLFxuICB9KTtcbiAgaWYgKCFyZXMub2sgJiYgcmVzLnN0YXR1cyAhPT0gNDIyKSB7XG4gICAgY29uc3QgZXJyID0gYXdhaXQgcmVzLmpzb24oKS5jYXRjaCgoKSA9PiAoe30pKTtcbiAgICBjb25zb2xlLmVycm9yKCdNYWlsZXJMaXRlIGFkZCBncm91cCBlcnJvcjonLCBlcnIpO1xuICAgIHJldHVybiB7IGFzc2lnbmVkOiBmYWxzZSwgYWxyZWFkeUluR3JvdXA6IGZhbHNlIH07XG4gIH1cbiAgaWYgKHJlcy5zdGF0dXMgPT09IDQyMikge1xuICAgIHJldHVybiB7IGFzc2lnbmVkOiBmYWxzZSwgYWxyZWFkeUluR3JvdXA6IHRydWUgfTtcbiAgfVxuICByZXR1cm4geyBhc3NpZ25lZDogdHJ1ZSwgYWxyZWFkeUluR3JvdXA6IGZhbHNlIH07XG59XG5cbi8qKlxuICogQ3JcdTAwRTllIG91IG1ldCBcdTAwRTAgam91ciBsZSBjb250YWN0ICsgY2hhbXBzIHVuaXF1ZV90b2tlbl93ZWJpbmFpcmUsIGRhdGVfb3B0aW5fbWFzdGVyY2xhc3MgKyBncm91cGUgb3B0aW9ubmVsLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdXBzZXJ0V2ViaW5haXJlU3Vic2NyaWJlcih7XG4gIGVtYWlsLFxuICBwcmVub20sXG4gIHRlbGVwaG9uZSxcbiAgcGF5cyxcbiAgdG9rZW4sXG4gIGRhdGVPcHRpbk1hc3RlcmNsYXNzLFxuICBkYXRlV2ViaW5haXJlLFxuICBncm91cElkLFxuICBhcGlLZXksXG59KSB7XG4gIGNvbnN0IGhlYWRlcnMgPSB7XG4gICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke2FwaUtleX1gLFxuICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgQWNjZXB0OiAnYXBwbGljYXRpb24vanNvbicsXG4gIH07XG5cbiAgY29uc3QgZmllbGRzID0ge1xuICAgIGZpcnN0X25hbWU6IHByZW5vbSxcbiAgICBuYW1lOiBwcmVub20sXG4gICAgcGhvbmU6IHRlbGVwaG9uZSxcbiAgICBsb2NhdGlvbjogcGF5cyxcbiAgICB1bmlxdWVfdG9rZW5fd2ViaW5haXJlOiB0b2tlbixcbiAgICAuLi4oZGF0ZU9wdGluTWFzdGVyY2xhc3NcbiAgICAgID8geyBkYXRlX29wdGluX21hc3RlcmNsYXNzOiBkYXRlT3B0aW5NYXN0ZXJjbGFzcyB9XG4gICAgICA6IHt9KSxcbiAgICAuLi4oZGF0ZVdlYmluYWlyZVxuICAgICAgPyB7XG4gICAgICAgICAgZXNfMl8wX2RhdGVfd2ViaW5haXJlOiBkYXRlV2ViaW5haXJlLFxuICAgICAgICAgIGRhdGVfd2ViaW5haXJlOiBkYXRlV2ViaW5haXJlLFxuICAgICAgICAgIGVzMl9kYXRlX3dlYmluYWlyZTogZGF0ZVdlYmluYWlyZSxcbiAgICAgICAgfVxuICAgICAgOiB7fSksXG4gIH07XG5cbiAgbGV0IHN1YnNjcmliZXJJZCA9IGF3YWl0IGdldE1haWxlckxpdGVTdWJzY3JpYmVySWQoZW1haWwsIGFwaUtleSk7XG5cbiAgaWYgKHN1YnNjcmliZXJJZCkge1xuICAgIGF3YWl0IGZldGNoKGAke01BSUxFUkxJVEVfQVBJX0JBU0V9L3N1YnNjcmliZXJzLyR7c3Vic2NyaWJlcklkfWAsIHtcbiAgICAgIG1ldGhvZDogJ1BVVCcsXG4gICAgICBoZWFkZXJzLFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBzdGF0dXM6ICdhY3RpdmUnLCBmaWVsZHMgfSksXG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgY29uc3QgY3JlYXRlUmVzcG9uc2UgPSBhd2FpdCBmZXRjaChgJHtNQUlMRVJMSVRFX0FQSV9CQVNFfS9zdWJzY3JpYmVyc2AsIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgaGVhZGVycyxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZW1haWwsIHN0YXR1czogJ2FjdGl2ZScsIGZpZWxkcyB9KSxcbiAgICB9KTtcbiAgICBjb25zdCBjcmVhdGVKc29uID0gYXdhaXQgY3JlYXRlUmVzcG9uc2UuanNvbigpO1xuICAgIGlmICghY3JlYXRlUmVzcG9uc2Uub2spIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihjcmVhdGVKc29uPy5tZXNzYWdlIHx8ICdNYWlsZXJMaXRlIGNyZWF0ZSBlcnJvcicpO1xuICAgIH1cbiAgICBzdWJzY3JpYmVySWQgPSBjcmVhdGVKc29uPy5kYXRhPy5pZCB8fCBudWxsO1xuICB9XG5cbiAgbGV0IGdyb3VwQXNzaWduZWRBdCA9IG51bGw7XG4gIGlmIChzdWJzY3JpYmVySWQgJiYgZ3JvdXBJZCkge1xuICAgIGNvbnN0IGdyb3VwUmVzdWx0ID0gYXdhaXQgYWRkU3Vic2NyaWJlclRvR3JvdXAoc3Vic2NyaWJlcklkLCBncm91cElkLCBhcGlLZXkpO1xuICAgIGlmIChncm91cFJlc3VsdC5hc3NpZ25lZCB8fCBncm91cFJlc3VsdC5hbHJlYWR5SW5Hcm91cCkge1xuICAgICAgZ3JvdXBBc3NpZ25lZEF0ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgY29uc3QgZ3JvdXBEYXRlRmllbGRzID0ge1xuICAgICAgICBzYWpvdXRlX2RhbnNfbGVfZ3JvdXBlX2xlOiBncm91cEFzc2lnbmVkQXQsXG4gICAgICAgIGVzMl9ham91dGVfZGFuc19sZV9ncm91cGVfbGU6IGdyb3VwQXNzaWduZWRBdCxcbiAgICAgICAgZGF0ZV9ham91dF9ncm91cGVfd2ViaW5haXJlOiBncm91cEFzc2lnbmVkQXQsXG4gICAgICB9O1xuICAgICAgYXdhaXQgZmV0Y2goYCR7TUFJTEVSTElURV9BUElfQkFTRX0vc3Vic2NyaWJlcnMvJHtzdWJzY3JpYmVySWR9YCwge1xuICAgICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgICBoZWFkZXJzLFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgICAgICBmaWVsZHM6IGdyb3VwRGF0ZUZpZWxkcyxcbiAgICAgICAgfSksXG4gICAgICB9KS5jYXRjaCgoKSA9PiB7fSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHsgc3Vic2NyaWJlcklkLCBncm91cEFzc2lnbmVkQXQgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFdlYmluYWlyZUdyb3VwRW52KCkge1xuICByZXR1cm4ge1xuICAgIGluc2NyaXRzOlxuICAgICAgcHJvY2Vzcy5lbnYuTUFJTEVSTElURV9HUk9VUF9XRUJJTkFJUkVfSU5TQ1JJVFMgfHxcbiAgICAgIHByb2Nlc3MuZW52Lk1BSUxFUkxJVEVfR1JPVVBfV0VCSU5BSVJFX0VTMl9JTlNDUklUUyB8fFxuICAgICAgcHJvY2Vzcy5lbnYuTUFJTEVSTElURV9HUk9VUF9XRUJJTkFJUkVfRVMyIHx8XG4gICAgICBwcm9jZXNzLmVudi5NQUlMRVJMSVRFX0dST1VQX1dFQklOQVJfRVMyLFxuICAgIHByZXNlbnRzOlxuICAgICAgcHJvY2Vzcy5lbnYuTUFJTEVSTElURV9HUk9VUF9XRUJJTkFJUkVfUFJFU0VOVFMgfHxcbiAgICAgIHByb2Nlc3MuZW52Lk1BSUxFUkxJVEVfR1JPVVBfV0VCSU5BSVJFX0VTMl9QUkVTRU5UUyxcbiAgICBhY2hldGV1cnM6XG4gICAgICBwcm9jZXNzLmVudi5NQUlMRVJMSVRFX0dST1VQX1dFQklOQUlSRV9BQ0hFVEVVUlMgfHxcbiAgICAgIHByb2Nlc3MuZW52Lk1BSUxFUkxJVEVfR1JPVVBfV0VCSU5BSVJFX0VTMl9BQ0hFVEVVUlMsXG4gICAgbm9uQWNoZXRldXJzOlxuICAgICAgcHJvY2Vzcy5lbnYuTUFJTEVSTElURV9HUk9VUF9XRUJJTkFJUkVfTk9OX0FDSEVURVVSUyB8fFxuICAgICAgcHJvY2Vzcy5lbnYuTUFJTEVSTElURV9HUk9VUF9XRUJJTkFJUkVfRVMyX05PTl9BQ0hFVEVVUlMsXG4gIH07XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIGdldFN1cGFiYXNlQ29uZmlnKCkge1xuICBjb25zdCB1cmwgPSBwcm9jZXNzLmVudi5TVVBBQkFTRV9VUkw7XG4gIGNvbnN0IGtleSA9IHByb2Nlc3MuZW52LlNVUEFCQVNFX1NFUlZJQ0VfUk9MRV9LRVk7XG4gIHJldHVybiB7IHVybCwga2V5IH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzdXBhYmFzZUhlYWRlcnMoZXh0cmEgPSB7fSkge1xuICBjb25zdCB7IGtleSB9ID0gZ2V0U3VwYWJhc2VDb25maWcoKTtcbiAgcmV0dXJuIHtcbiAgICBhcGlrZXk6IGtleSxcbiAgICBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7a2V5fWAsXG4gICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAuLi5leHRyYSxcbiAgfTtcbn1cblxuLyoqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIHF1ZXJ5IGUuZy4gXCJ3ZWJpbmFpcmVfcmVnaXN0cmF0aW9ucz90b2tlbj1lcS54XCIgKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzdXBhYmFzZUdldChwYXRoKSB7XG4gIGNvbnN0IHsgdXJsLCBrZXkgfSA9IGdldFN1cGFiYXNlQ29uZmlnKCk7XG4gIGlmICghdXJsIHx8ICFrZXkpIHtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIHN0YXR1czogNTAwLCBkYXRhOiBudWxsLCBlcnJvcjogJ1N1cGFiYXNlIG5vbiBjb25maWd1clx1MDBFOScgfTtcbiAgfVxuICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaChgJHt1cmx9L3Jlc3QvdjEvJHtwYXRofWAsIHtcbiAgICBoZWFkZXJzOiBzdXBhYmFzZUhlYWRlcnMoKSxcbiAgfSk7XG4gIGNvbnN0IHRleHQgPSBhd2FpdCByZXMudGV4dCgpO1xuICBsZXQgZGF0YSA9IG51bGw7XG4gIHRyeSB7XG4gICAgZGF0YSA9IHRleHQgPyBKU09OLnBhcnNlKHRleHQpIDogbnVsbDtcbiAgfSBjYXRjaCB7XG4gICAgZGF0YSA9IHRleHQ7XG4gIH1cbiAgcmV0dXJuIHsgb2s6IHJlcy5vaywgc3RhdHVzOiByZXMuc3RhdHVzLCBkYXRhLCBlcnJvcjogcmVzLm9rID8gbnVsbCA6IGRhdGEgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHN1cGFiYXNlUG9zdCh0YWJsZSwgYm9keSwgeyBwcmVmZXIgPSAncmV0dXJuPXJlcHJlc2VudGF0aW9uJyB9ID0ge30pIHtcbiAgY29uc3QgeyB1cmwsIGtleSB9ID0gZ2V0U3VwYWJhc2VDb25maWcoKTtcbiAgaWYgKCF1cmwgfHwgIWtleSkge1xuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgc3RhdHVzOiA1MDAsIGRhdGE6IG51bGwsIGVycm9yOiAnU3VwYWJhc2Ugbm9uIGNvbmZpZ3VyXHUwMEU5JyB9O1xuICB9XG4gIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKGAke3VybH0vcmVzdC92MS8ke3RhYmxlfWAsIHtcbiAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICBoZWFkZXJzOiBzdXBhYmFzZUhlYWRlcnMoeyBQcmVmZXI6IHByZWZlciB9KSxcbiAgICBib2R5OiBKU09OLnN0cmluZ2lmeShib2R5KSxcbiAgfSk7XG4gIGNvbnN0IHRleHQgPSBhd2FpdCByZXMudGV4dCgpO1xuICBsZXQgZGF0YSA9IG51bGw7XG4gIHRyeSB7XG4gICAgZGF0YSA9IHRleHQgPyBKU09OLnBhcnNlKHRleHQpIDogbnVsbDtcbiAgfSBjYXRjaCB7XG4gICAgZGF0YSA9IHRleHQ7XG4gIH1cbiAgcmV0dXJuIHsgb2s6IHJlcy5vaywgc3RhdHVzOiByZXMuc3RhdHVzLCBkYXRhLCBlcnJvcjogcmVzLm9rID8gbnVsbCA6IGRhdGEgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHN1cGFiYXNlUGF0Y2godGFibGUsIHF1ZXJ5LCBib2R5KSB7XG4gIGNvbnN0IHsgdXJsLCBrZXkgfSA9IGdldFN1cGFiYXNlQ29uZmlnKCk7XG4gIGlmICghdXJsIHx8ICFrZXkpIHtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIHN0YXR1czogNTAwLCBkYXRhOiBudWxsLCBlcnJvcjogJ1N1cGFiYXNlIG5vbiBjb25maWd1clx1MDBFOScgfTtcbiAgfVxuICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaChgJHt1cmx9L3Jlc3QvdjEvJHt0YWJsZX0/JHtxdWVyeX1gLCB7XG4gICAgbWV0aG9kOiAnUEFUQ0gnLFxuICAgIGhlYWRlcnM6IHN1cGFiYXNlSGVhZGVycyh7IFByZWZlcjogJ3JldHVybj1yZXByZXNlbnRhdGlvbicgfSksXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoYm9keSksXG4gIH0pO1xuICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVzLnRleHQoKTtcbiAgbGV0IGRhdGEgPSBudWxsO1xuICB0cnkge1xuICAgIGRhdGEgPSB0ZXh0ID8gSlNPTi5wYXJzZSh0ZXh0KSA6IG51bGw7XG4gIH0gY2F0Y2gge1xuICAgIGRhdGEgPSB0ZXh0O1xuICB9XG4gIHJldHVybiB7IG9rOiByZXMub2ssIHN0YXR1czogcmVzLnN0YXR1cywgZGF0YSwgZXJyb3I6IHJlcy5vayA/IG51bGwgOiBkYXRhIH07XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7O0FBQUEsT0FBTyxZQUFZOzs7QUNLWixTQUFTLGdCQUFnQixNQUFN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QUs7QUFDL0UsYUFBTyxhQUFhLEtBQUs7QUFBQSxRQUN2QixPQUFPO0FBQUEsUUFDUCxTQUFTLFFBQVEsSUFBSSxjQUFjLElBQUksUUFBUTtBQUFBLE1BQ2pELENBQUM7QUFBQSxJQUNIO0FBRUEsVUFBTSxTQUFTLFFBQVEsSUFBSTtBQUMzQixVQUFNLFNBQVMscUJBQXFCO0FBQ3BDLFVBQU0sZ0JBQ0osT0FBTyxZQUNQLFFBQVEsSUFBSSx1Q0FDWixRQUFRLElBQUksMkNBQ1osUUFBUSxJQUFJLGtDQUNaLFFBQVEsSUFBSTtBQUVkLFFBQUksVUFBVSxlQUFlO0FBQzNCLFVBQUk7QUFDRixjQUFNLEtBQUssTUFBTSwwQkFBMEI7QUFBQSxVQUN6QztBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxVQUNBLHNCQUFzQiwwQkFBMEIsb0JBQUksS0FBSyxDQUFDO0FBQUEsVUFDMUQsZUFBZSxhQUFhLFlBQVk7QUFBQSxVQUN4QyxTQUFTO0FBQUEsVUFDVDtBQUFBLFFBQ0YsQ0FBQztBQUVELFlBQUksSUFBSSxpQkFBaUI7QUFDdkIsZ0JBQU0sY0FBYyxNQUFNO0FBQUEsWUFDeEI7QUFBQSxZQUNBLFlBQVksbUJBQW1CLEtBQUssQ0FBQztBQUFBLFlBQ3JDLEVBQUUsMkJBQTJCLEdBQUcsZ0JBQWdCO0FBQUEsVUFDbEQ7QUFDQSxjQUFJLENBQUMsWUFBWSxJQUFJO0FBQ25CLG9CQUFRO0FBQUEsY0FDTjtBQUFBLGNBQ0EsWUFBWTtBQUFBLGNBQ1osWUFBWTtBQUFBLFlBQ2Q7QUFBQSxVQUNGO0FBQUEsUUFDRjtBQUFBLE1BQ0YsU0FBUyxPQUFPO0FBQ2QsZ0JBQVEsTUFBTSxrQ0FBa0MsS0FBSztBQUFBLE1BQ3ZEO0FBQUEsSUFDRjtBQUVBLFdBQU8sYUFBYSxLQUFLO0FBQUEsTUFDdkIsU0FBUztBQUFBLE1BQ1Q7QUFBQSxNQUNBLFlBQVksK0JBQStCLEtBQUs7QUFBQSxJQUNsRCxDQUFDO0FBQUEsRUFDSCxTQUFTLE9BQU87QUFDZCxZQUFRLE1BQU0sNkJBQTZCLEtBQUs7QUFDaEQsV0FBTyxhQUFhLEtBQUs7QUFBQSxNQUN2QixPQUFPO0FBQUEsTUFDUCxTQUFTLFFBQVEsSUFBSSxjQUFjLE1BQU0sVUFBVTtBQUFBLElBQ3JELENBQUM7QUFBQSxFQUNIO0FBQ0Y7IiwKICAibmFtZXMiOiBbImFwaUtleSIsICJncm91cHMiLCAiZ3JvdXBJbnNjcml0cyJdCn0K
