
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
function formatParisSessionDateYyyyMmDd(isoString) {
  if (!isoString) return void 0;
  const d = new Date(isoString);
  if (!Number.isFinite(d.getTime())) return void 0;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);
}
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
  const esSessionDate = formatParisSessionDateYyyyMmDd(dateWebinaire);
  const fields = {
    first_name: prenom,
    name: prenom,
    phone: telephone,
    location: pays,
    es_country: pays || "",
    ...esSessionDate ? { es_session_date: esSessionDate } : {},
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
          fields: { ...fields, ...groupDateFields }
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9mdW5jdGlvbnMvcmVnaXN0ZXItd2ViaW5haXJlLmpzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL2xpYi93ZWJpbmFpcmUtc2Vzc2lvbi1wYXJpcy5tanMiLCAibmV0bGlmeS9mdW5jdGlvbnMvbGliL21haWxlcmxpdGUtd2ViaW5haXJlLm1qcyIsICJuZXRsaWZ5L2Z1bmN0aW9ucy9saWIvc3VwYWJhc2UtcmVzdC5tanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCBjcnlwdG8gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7XG4gIGdldFJlZ2lzdHJhdGlvblNlc3Npb25JbnN0YW50VXRjLFxuICBnZXRTZXNzaW9uRW5kc0F0VXRjLFxuICBnZXRPZmZyZUV4cGlyZXNBdFV0YyxcbiAgZm9ybWF0UGFyaXNPcHRpblRpbWVzdGFtcCxcbn0gZnJvbSAnLi9saWIvd2ViaW5haXJlLXNlc3Npb24tcGFyaXMubWpzJztcbmltcG9ydCB7IHVwc2VydFdlYmluYWlyZVN1YnNjcmliZXIsIGdldFdlYmluYWlyZUdyb3VwRW52IH0gZnJvbSAnLi9saWIvbWFpbGVybGl0ZS13ZWJpbmFpcmUubWpzJztcbmltcG9ydCB7IHN1cGFiYXNlR2V0LCBzdXBhYmFzZVBvc3QsIHN1cGFiYXNlUGF0Y2ggfSBmcm9tICcuL2xpYi9zdXBhYmFzZS1yZXN0Lm1qcyc7XG5cbmZ1bmN0aW9uIGpzb25SZXNwb25zZShzdGF0dXMsIHBheWxvYWQpIHtcbiAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeShwYXlsb2FkKSwge1xuICAgIHN0YXR1cyxcbiAgICBoZWFkZXJzOiB7XG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnQ29udGVudC1UeXBlJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ1BPU1QsIE9QVElPTlMnLFxuICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICB9LFxuICB9KTtcbn1cblxuZnVuY3Rpb24gZ2VuZXJhdGVUb2tlbigpIHtcbiAgaWYgKHR5cGVvZiBjcnlwdG8ucmFuZG9tVVVJRCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBjcnlwdG8ucmFuZG9tVVVJRCgpO1xuICB9XG4gIHJldHVybiBgJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX0tJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyLCAxMil9YDtcbn1cblxuZXhwb3J0IGRlZmF1bHQgYXN5bmMgKHJlcSkgPT4ge1xuICBpZiAocmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgcmV0dXJuIGpzb25SZXNwb25zZSgyMDAsIHsgb2s6IHRydWUgfSk7XG4gIH1cblxuICBpZiAocmVxLm1ldGhvZCAhPT0gJ1BPU1QnKSB7XG4gICAgcmV0dXJuIGpzb25SZXNwb25zZSg0MDUsIHsgZXJyb3I6ICdNZXRob2Qgbm90IGFsbG93ZWQnIH0pO1xuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVxLmpzb24oKTtcbiAgICBjb25zdCBlbWFpbCA9IFN0cmluZyhib2R5Py5lbWFpbCB8fCAnJylcbiAgICAgIC50cmltKClcbiAgICAgIC50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IHByZW5vbSA9IFN0cmluZyhib2R5Py5wcmVub20gfHwgJycpLnRyaW0oKTtcbiAgICBjb25zdCB0ZWxlcGhvbmUgPSBTdHJpbmcoYm9keT8udGVsZXBob25lIHx8ICcnKS50cmltKCk7XG4gICAgY29uc3QgcGF5cyA9IFN0cmluZyhib2R5Py5wYXlzIHx8ICcnKS50cmltKCk7XG4gICAgY29uc3QgaGFzUGhvbmVQYXlsb2FkID0gQm9vbGVhbih0ZWxlcGhvbmUgJiYgcGF5cyk7XG5cbiAgICBpZiAoIWVtYWlsIHx8ICFlbWFpbC5pbmNsdWRlcygnQCcpIHx8ICFwcmVub20pIHtcbiAgICAgIHJldHVybiBqc29uUmVzcG9uc2UoNDAwLCB7IGVycm9yOiAnUGFyYW1cdTAwRTh0cmVzIG1hbnF1YW50cycgfSk7XG4gICAgfVxuXG4gICAgY29uc3Qgc2xvdFBhcmlzID0gJzIwaCc7XG5cbiAgICBjb25zdCBleCA9IGF3YWl0IHN1cGFiYXNlR2V0KFxuICAgICAgYHdlYmluYWlyZV9leGNsdXNpb25zP2VtYWlsPWVxLiR7ZW5jb2RlVVJJQ29tcG9uZW50KGVtYWlsKX0mc2VsZWN0PWVtYWlsLHJhaXNvbmAsXG4gICAgKTtcbiAgICBpZiAoZXgub2sgJiYgQXJyYXkuaXNBcnJheShleC5kYXRhKSAmJiBleC5kYXRhLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBqc29uUmVzcG9uc2UoNDAzLCB7IGVycm9yOiAnZXhjbHVkZWQnLCByZWFzb246ICdleGNsdWRlZCcsIHJhaXNvbjogZXguZGF0YVswXS5yYWlzb24gfSk7XG4gICAgfVxuXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBzdXBhYmFzZUdldChcbiAgICAgIGB3ZWJpbmFpcmVfcmVnaXN0cmF0aW9ucz9lbWFpbD1lcS4ke2VuY29kZVVSSUNvbXBvbmVudChlbWFpbCl9JnNlbGVjdD10b2tlbixwcmVub20sdGVsZXBob25lLHBheXMsbWFpbGVybGl0ZV9ncm91cF9hZGRlZF9hdCxzdGF0dXQsc2Vzc2lvbl9kYXRlLHNlc3Npb25fZW5kc19hdCxvZmZyZV9leHBpcmVzX2F0YCxcbiAgICApO1xuICAgIGlmIChleGlzdGluZy5vayAmJiBBcnJheS5pc0FycmF5KGV4aXN0aW5nLmRhdGEpICYmIGV4aXN0aW5nLmRhdGEubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgZSA9IGV4aXN0aW5nLmRhdGFbMF07XG4gICAgICBjb25zdCBwYXRjaEJvZHkgPSB7fTtcbiAgICAgIGlmIChwcmVub20gJiYgcHJlbm9tICE9PSAoZS5wcmVub20gfHwgJycpKSBwYXRjaEJvZHkucHJlbm9tID0gcHJlbm9tO1xuICAgICAgaWYgKGhhc1Bob25lUGF5bG9hZCkge1xuICAgICAgICBwYXRjaEJvZHkudGVsZXBob25lID0gdGVsZXBob25lO1xuICAgICAgICBwYXRjaEJvZHkucGF5cyA9IHBheXM7XG4gICAgICB9XG4gICAgICBpZiAoT2JqZWN0LmtleXMocGF0Y2hCb2R5KS5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IHVwZCA9IGF3YWl0IHN1cGFiYXNlUGF0Y2goXG4gICAgICAgICAgJ3dlYmluYWlyZV9yZWdpc3RyYXRpb25zJyxcbiAgICAgICAgICBgZW1haWw9ZXEuJHtlbmNvZGVVUklDb21wb25lbnQoZW1haWwpfWAsXG4gICAgICAgICAgcGF0Y2hCb2R5LFxuICAgICAgICApO1xuICAgICAgICBpZiAoIXVwZC5vaykge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1N1cGFiYXNlIHVwZGF0ZSB3ZWJpbmFpcmVfcmVnaXN0cmF0aW9uczonLCB1cGQuc3RhdHVzLCB1cGQuZXJyb3IpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGFwaUtleSA9IHByb2Nlc3MuZW52Lk1BSUxFUkxJVEVfQVBJX0tFWTtcbiAgICAgIGNvbnN0IGdyb3VwcyA9IGdldFdlYmluYWlyZUdyb3VwRW52KCk7XG4gICAgICBjb25zdCBncm91cEluc2NyaXRzID1cbiAgICAgICAgZ3JvdXBzLmluc2NyaXRzIHx8XG4gICAgICAgIHByb2Nlc3MuZW52Lk1BSUxFUkxJVEVfR1JPVVBfV0VCSU5BSVJFX0lOU0NSSVRTIHx8XG4gICAgICAgIHByb2Nlc3MuZW52Lk1BSUxFUkxJVEVfR1JPVVBfV0VCSU5BSVJFX0VTMl9JTlNDUklUUyB8fFxuICAgICAgICBwcm9jZXNzLmVudi5NQUlMRVJMSVRFX0dST1VQX1dFQklOQUlSRV9FUzIgfHxcbiAgICAgICAgcHJvY2Vzcy5lbnYuTUFJTEVSTElURV9HUk9VUF9XRUJJTkFSX0VTMjtcblxuICAgICAgLy8gTWFpbGVyTGl0ZSA6IHVuaXF1ZV90b2tlbl93ZWJpbmFpcmUsIGVzX3Nlc3Npb25fZGF0ZSAoWVlZWS1NTS1ERCBQYXJpcyksIGVzX2NvdW50cnksIGRhdGVzIHdlYmluYWlyZSBcdTIwMTQgdm9pciB1cHNlcnRXZWJpbmFpcmVTdWJzY3JpYmVyLlxuICAgICAgaWYgKGFwaUtleSAmJiBncm91cEluc2NyaXRzKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgbWwgPSBhd2FpdCB1cHNlcnRXZWJpbmFpcmVTdWJzY3JpYmVyKHtcbiAgICAgICAgICAgIGVtYWlsLFxuICAgICAgICAgICAgcHJlbm9tOiBwcmVub20gfHwgZS5wcmVub20gfHwgJycsXG4gICAgICAgICAgICB0ZWxlcGhvbmU6IGhhc1Bob25lUGF5bG9hZCA/IHRlbGVwaG9uZSA6IGUudGVsZXBob25lIHx8ICcnLFxuICAgICAgICAgICAgcGF5czogaGFzUGhvbmVQYXlsb2FkID8gcGF5cyA6IGUucGF5cyB8fCAnJyxcbiAgICAgICAgICAgIHRva2VuOiBlLnRva2VuLFxuICAgICAgICAgICAgZGF0ZU9wdGluTWFzdGVyY2xhc3M6IGZvcm1hdFBhcmlzT3B0aW5UaW1lc3RhbXAobmV3IERhdGUoKSksXG4gICAgICAgICAgICBkYXRlV2ViaW5haXJlOiBlLnNlc3Npb25fZGF0ZSB8fCBudWxsLFxuICAgICAgICAgICAgZ3JvdXBJZDogZ3JvdXBJbnNjcml0cyxcbiAgICAgICAgICAgIGFwaUtleSxcbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIGlmIChtbD8uZ3JvdXBBc3NpZ25lZEF0ICYmICFlLm1haWxlcmxpdGVfZ3JvdXBfYWRkZWRfYXQpIHtcbiAgICAgICAgICAgIGNvbnN0IG1hcmtBZGRlZEF0ID0gYXdhaXQgc3VwYWJhc2VQYXRjaChcbiAgICAgICAgICAgICAgJ3dlYmluYWlyZV9yZWdpc3RyYXRpb25zJyxcbiAgICAgICAgICAgICAgYGVtYWlsPWVxLiR7ZW5jb2RlVVJJQ29tcG9uZW50KGVtYWlsKX1gLFxuICAgICAgICAgICAgICB7IG1haWxlcmxpdGVfZ3JvdXBfYWRkZWRfYXQ6IG1sLmdyb3VwQXNzaWduZWRBdCB9LFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGlmICghbWFya0FkZGVkQXQub2spIHtcbiAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcbiAgICAgICAgICAgICAgICAnU3VwYWJhc2UgdXBkYXRlIG1haWxlcmxpdGVfZ3JvdXBfYWRkZWRfYXQgKGV4aXN0aW5nKTonLFxuICAgICAgICAgICAgICAgIG1hcmtBZGRlZEF0LnN0YXR1cyxcbiAgICAgICAgICAgICAgICBtYXJrQWRkZWRBdC5lcnJvcixcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKG1sRXJyKSB7XG4gICAgICAgICAgY29uc29sZS5lcnJvcignTWFpbGVyTGl0ZSByZWdpc3Rlci13ZWJpbmFpcmUgZXhpc3Rpbmc6JywgbWxFcnIpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBqc29uUmVzcG9uc2UoMjAwLCB7XG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgIGFscmVhZHlSZWdpc3RlcmVkOiB0cnVlLFxuICAgICAgICB0b2tlbjogZS50b2tlbixcbiAgICAgICAgc3RhdHV0OiBlLnN0YXR1dCxcbiAgICAgICAgc2Vzc2lvblN0YXJ0c0F0OiBlLnNlc3Npb25fZGF0ZSxcbiAgICAgICAgc2Vzc2lvbkVuZHNBdDogZS5zZXNzaW9uX2VuZHNfYXQsXG4gICAgICAgIG9mZnJlRXhwaXJlc0F0OiBlLm9mZnJlX2V4cGlyZXNfYXQsXG4gICAgICAgIHJlZGlyZWN0VG86IGAvbWFzdGVyY2xhc3MvY29uZmlybWF0aW9uP3Q9JHtlLnRva2VufWAsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCB0b2tlbiA9IGdlbmVyYXRlVG9rZW4oKTtcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuICAgIGNvbnN0IHNlc3Npb25TdGFydCA9IGdldFJlZ2lzdHJhdGlvblNlc3Npb25JbnN0YW50VXRjKG5vdywgc2xvdFBhcmlzKTtcbiAgICBpZiAoIXNlc3Npb25TdGFydCkge1xuICAgICAgcmV0dXJuIGpzb25SZXNwb25zZSg1MDAsIHsgZXJyb3I6ICdJbXBvc3NpYmxlIGRlIGNhbGN1bGVyIGxhIHNlc3Npb24nIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IHNlc3Npb25FbmRzQXQgPSBnZXRTZXNzaW9uRW5kc0F0VXRjKHNlc3Npb25TdGFydC50b0lTT1N0cmluZygpKTtcbiAgICBjb25zdCBvZmZyZUV4cGlyZXNBdCA9IGdldE9mZnJlRXhwaXJlc0F0VXRjKHNlc3Npb25TdGFydC50b0lTT1N0cmluZygpKTtcbiAgICBpZiAoIXNlc3Npb25FbmRzQXQgfHwgIW9mZnJlRXhwaXJlc0F0KSB7XG4gICAgICByZXR1cm4ganNvblJlc3BvbnNlKDUwMCwgeyBlcnJvcjogJ0ltcG9zc2libGUgZGUgY2FsY3VsZXIgbGVzIGRhdGVzJyB9KTtcbiAgICB9XG5cbiAgICBjb25zdCByb3cgPSB7XG4gICAgICB0b2tlbixcbiAgICAgIGVtYWlsLFxuICAgICAgcHJlbm9tLFxuICAgICAgdGVsZXBob25lOiB0ZWxlcGhvbmUgfHwgbnVsbCxcbiAgICAgIHBheXM6IHBheXMgfHwgbnVsbCxcbiAgICAgIGNyZW5lYXU6IHNsb3RQYXJpcyxcbiAgICAgIHNlc3Npb25fZGF0ZTogc2Vzc2lvblN0YXJ0LnRvSVNPU3RyaW5nKCksXG4gICAgICBzZXNzaW9uX2VuZHNfYXQ6IHNlc3Npb25FbmRzQXQudG9JU09TdHJpbmcoKSxcbiAgICAgIG9mZnJlX2V4cGlyZXNfYXQ6IG9mZnJlRXhwaXJlc0F0LnRvSVNPU3RyaW5nKCksXG4gICAgICBzdGF0dXQ6ICdpbnNjcml0JyxcbiAgICB9O1xuXG4gICAgY29uc3QgaW5zID0gYXdhaXQgc3VwYWJhc2VQb3N0KCd3ZWJpbmFpcmVfcmVnaXN0cmF0aW9ucycsIHJvdywgeyBwcmVmZXI6ICdyZXR1cm49bWluaW1hbCcgfSk7XG4gICAgaWYgKCFpbnMub2spIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1N1cGFiYXNlIGluc2VydCB3ZWJpbmFpcmVfcmVnaXN0cmF0aW9uczonLCBpbnMuc3RhdHVzLCBpbnMuZXJyb3IpO1xuICAgICAgcmV0dXJuIGpzb25SZXNwb25zZSg1MDAsIHtcbiAgICAgICAgZXJyb3I6ICdFcnJldXIgZW5yZWdpc3RyZW1lbnQnLFxuICAgICAgICBkZXRhaWxzOiBwcm9jZXNzLmVudi5ORVRMSUZZX0RFViA/IGlucy5lcnJvciA6IHVuZGVmaW5lZCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGFwaUtleSA9IHByb2Nlc3MuZW52Lk1BSUxFUkxJVEVfQVBJX0tFWTtcbiAgICBjb25zdCBncm91cHMgPSBnZXRXZWJpbmFpcmVHcm91cEVudigpO1xuICAgIGNvbnN0IGdyb3VwSW5zY3JpdHMgPVxuICAgICAgZ3JvdXBzLmluc2NyaXRzIHx8XG4gICAgICBwcm9jZXNzLmVudi5NQUlMRVJMSVRFX0dST1VQX1dFQklOQUlSRV9JTlNDUklUUyB8fFxuICAgICAgcHJvY2Vzcy5lbnYuTUFJTEVSTElURV9HUk9VUF9XRUJJTkFJUkVfRVMyX0lOU0NSSVRTIHx8XG4gICAgICBwcm9jZXNzLmVudi5NQUlMRVJMSVRFX0dST1VQX1dFQklOQUlSRV9FUzIgfHxcbiAgICAgIHByb2Nlc3MuZW52Lk1BSUxFUkxJVEVfR1JPVVBfV0VCSU5BUl9FUzI7XG5cbiAgICAvLyBNYWlsZXJMaXRlIDogdW5pcXVlX3Rva2VuX3dlYmluYWlyZSwgZXNfc2Vzc2lvbl9kYXRlIChZWVlZLU1NLUREIFBhcmlzKSwgZXNfY291bnRyeSwgZGF0ZXMgd2ViaW5haXJlIFx1MjAxNCB2b2lyIHVwc2VydFdlYmluYWlyZVN1YnNjcmliZXIuXG4gICAgaWYgKGFwaUtleSAmJiBncm91cEluc2NyaXRzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBtbCA9IGF3YWl0IHVwc2VydFdlYmluYWlyZVN1YnNjcmliZXIoe1xuICAgICAgICAgIGVtYWlsLFxuICAgICAgICAgIHByZW5vbSxcbiAgICAgICAgICB0ZWxlcGhvbmUsXG4gICAgICAgICAgcGF5cyxcbiAgICAgICAgICB0b2tlbixcbiAgICAgICAgICBkYXRlT3B0aW5NYXN0ZXJjbGFzczogZm9ybWF0UGFyaXNPcHRpblRpbWVzdGFtcChuZXcgRGF0ZSgpKSxcbiAgICAgICAgICBkYXRlV2ViaW5haXJlOiBzZXNzaW9uU3RhcnQudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICBncm91cElkOiBncm91cEluc2NyaXRzLFxuICAgICAgICAgIGFwaUtleSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKG1sPy5ncm91cEFzc2lnbmVkQXQpIHtcbiAgICAgICAgICBjb25zdCBtYXJrQWRkZWRBdCA9IGF3YWl0IHN1cGFiYXNlUGF0Y2goXG4gICAgICAgICAgICAnd2ViaW5haXJlX3JlZ2lzdHJhdGlvbnMnLFxuICAgICAgICAgICAgYGVtYWlsPWVxLiR7ZW5jb2RlVVJJQ29tcG9uZW50KGVtYWlsKX1gLFxuICAgICAgICAgICAgeyBtYWlsZXJsaXRlX2dyb3VwX2FkZGVkX2F0OiBtbC5ncm91cEFzc2lnbmVkQXQgfSxcbiAgICAgICAgICApO1xuICAgICAgICAgIGlmICghbWFya0FkZGVkQXQub2spIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXG4gICAgICAgICAgICAgICdTdXBhYmFzZSB1cGRhdGUgbWFpbGVybGl0ZV9ncm91cF9hZGRlZF9hdCAobmV3KTonLFxuICAgICAgICAgICAgICBtYXJrQWRkZWRBdC5zdGF0dXMsXG4gICAgICAgICAgICAgIG1hcmtBZGRlZEF0LmVycm9yLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKG1sRXJyKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ01haWxlckxpdGUgcmVnaXN0ZXItd2ViaW5haXJlOicsIG1sRXJyKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4ganNvblJlc3BvbnNlKDIwMCwge1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHRva2VuLFxuICAgICAgcmVkaXJlY3RUbzogYC9tYXN0ZXJjbGFzcy9jb25maXJtYXRpb24/dD0ke3Rva2VufWAsXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcigncmVnaXN0ZXItd2ViaW5haXJlIGVycm9yOicsIGVycm9yKTtcbiAgICByZXR1cm4ganNvblJlc3BvbnNlKDUwMCwge1xuICAgICAgZXJyb3I6ICdFcnJldXIgc2VydmV1cicsXG4gICAgICBkZXRhaWxzOiBwcm9jZXNzLmVudi5ORVRMSUZZX0RFViA/IGVycm9yLm1lc3NhZ2UgOiB1bmRlZmluZWQsXG4gICAgfSk7XG4gIH1cbn07XG4iLCAiLyoqXG4gKiBEYXRlcyAvIHNlc3Npb25zIHdlYmluYWlyZSBFUyAyLjAgXHUyMDE0IGZ1c2VhdSBFdXJvcGUvUGFyaXMuXG4gKiBDdXRvZmYgaW5zY3JpcHRpb25zIDogYXZhbnQgamV1ZGkgMTloIChQYXJpcykgXHUyMTkyIENFIGpldWRpIDIwaCA7IFx1MDBFMCBwYXJ0aXIgZGUgamV1ZGkgMTloIFx1MjE5MiBqZXVkaSBTVUlWQU5UIDIwaC5cbiAqL1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQYXJpc1BhcnRzKGRhdGUpIHtcbiAgY29uc3QgZm9ybWF0dGVyID0gbmV3IEludGwuRGF0ZVRpbWVGb3JtYXQoJ2ZyLUZSJywge1xuICAgIHRpbWVab25lOiAnRXVyb3BlL1BhcmlzJyxcbiAgICBudW1iZXJpbmdTeXN0ZW06ICdsYXRuJyxcbiAgICB5ZWFyOiAnbnVtZXJpYycsXG4gICAgbW9udGg6ICdudW1lcmljJyxcbiAgICBkYXk6ICdudW1lcmljJyxcbiAgICB3ZWVrZGF5OiAnc2hvcnQnLFxuICAgIGhvdXI6ICdudW1lcmljJyxcbiAgICBtaW51dGU6ICdudW1lcmljJyxcbiAgICBzZWNvbmQ6ICdudW1lcmljJyxcbiAgICBob3VyQ3ljbGU6ICdoMjMnLFxuICB9KTtcbiAgY29uc3QgcGFydHMgPSBmb3JtYXR0ZXIuZm9ybWF0VG9QYXJ0cyhkYXRlKTtcbiAgY29uc3QgdmFsdWUgPSAodHlwZSkgPT4gTnVtYmVyKHBhcnRzLmZpbmQoKHApID0+IHAudHlwZSA9PT0gdHlwZSk/LnZhbHVlIHx8IDApO1xuICBjb25zdCB3ZWVrUmF3ID0gcGFydHMuZmluZCgocCkgPT4gcC50eXBlID09PSAnd2Vla2RheScpPy52YWx1ZSB8fCAnJztcbiAgcmV0dXJuIHtcbiAgICB5ZWFyOiB2YWx1ZSgneWVhcicpLFxuICAgIG1vbnRoOiB2YWx1ZSgnbW9udGgnKSxcbiAgICBkYXk6IHZhbHVlKCdkYXknKSxcbiAgICBob3VyOiB2YWx1ZSgnaG91cicpLFxuICAgIG1pbnV0ZTogdmFsdWUoJ21pbnV0ZScpLFxuICAgIHNlY29uZDogdmFsdWUoJ3NlY29uZCcpLFxuICAgIHdlZWtkYXlUZXh0OiB3ZWVrUmF3LnRvTG93ZXJDYXNlKCksXG4gIH07XG59XG5cbmZ1bmN0aW9uIGdldFBhcmlzV2Vla2RheU51bWJlcihwYXJ0cykge1xuICBjb25zdCBkYXlNYXAgPSB7IGx1bjogMSwgbWFyOiAyLCBtZXI6IDMsIGpldTogNCwgdmVuOiA1LCBzYW06IDYsIGRpbTogNyB9O1xuICBmb3IgKGNvbnN0IFtrZXksIHZhbF0gb2YgT2JqZWN0LmVudHJpZXMoZGF5TWFwKSkge1xuICAgIGlmIChwYXJ0cy53ZWVrZGF5VGV4dC5zdGFydHNXaXRoKGtleSkpIHJldHVybiB2YWw7XG4gIH1cbiAgcmV0dXJuIDE7XG59XG5cbi8qKiBBam91dGUgZGVzIGpvdXJzIGF1IGNhbGVuZHJpZXIgZW4gcGFzc2FudCBwYXIgdW5lIGRhdGUgVVRDIG1pZGkgKFx1MDBFOXZpdGUgZFx1MDBFOXJpdmVzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhZGREYXlzUGFyaXNDYWxlbmRhcih5ZWFyLCBtb250aCwgZGF5LCBkZWx0YURheXMpIHtcbiAgY29uc3QgZCA9IG5ldyBEYXRlKERhdGUuVVRDKHllYXIsIG1vbnRoIC0gMSwgZGF5ICsgZGVsdGFEYXlzLCAxMiwgMCwgMCkpO1xuICBjb25zdCBwID0gcGFyc2VQYXJpc1BhcnRzKGQpO1xuICByZXR1cm4geyB5ZWFyOiBwLnllYXIsIG1vbnRoOiBwLm1vbnRoLCBkYXk6IHAuZGF5IH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmaW5kUGFyaXNJbnN0YW50VXRjKHBhcmlzWWVhciwgcGFyaXNNb250aCwgcGFyaXNEYXksIHBhcmlzSG91cikge1xuICBsZXQgY2FuZGlkYXRlID0gbmV3IERhdGUoRGF0ZS5VVEMocGFyaXNZZWFyLCBwYXJpc01vbnRoIC0gMSwgcGFyaXNEYXksIHBhcmlzSG91ciAtIDEsIDAsIDApKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCA0MDAwOyBpKyspIHtcbiAgICBjb25zdCBwID0gcGFyc2VQYXJpc1BhcnRzKGNhbmRpZGF0ZSk7XG4gICAgaWYgKHAueWVhciA9PT0gcGFyaXNZZWFyICYmIHAubW9udGggPT09IHBhcmlzTW9udGggJiYgcC5kYXkgPT09IHBhcmlzRGF5ICYmIHAuaG91ciA9PT0gcGFyaXNIb3VyKSB7XG4gICAgICByZXR1cm4gY2FuZGlkYXRlO1xuICAgIH1cbiAgICBjYW5kaWRhdGUgPSBuZXcgRGF0ZShjYW5kaWRhdGUuZ2V0VGltZSgpICsgNjAgKiAxMDAwKTtcbiAgfVxuXG4gIC8vIEZhbGxiYWNrIHJvYnVzdGUgOiBvbiBiYWxhaWUgNDhoIGF1dG91ciBkZSBsYSBkYXRlIGNpYmxlLlxuICAvLyBVdGlsZSBzaSBsJ2Vudmlyb25uZW1lbnQgcnVudGltZSBhIHVuIGNvbXBvcnRlbWVudCBJbnRsIGluYXR0ZW5kdS5cbiAgY29uc3QgYnJvYWRTdGFydCA9IERhdGUuVVRDKHBhcmlzWWVhciwgcGFyaXNNb250aCAtIDEsIHBhcmlzRGF5LCAwLCAwLCAwKTtcbiAgY29uc3QgYnJvYWRFbmQgPSBicm9hZFN0YXJ0ICsgNDggKiA2MCAqIDYwICogMTAwMDtcbiAgZm9yIChsZXQgdCA9IGJyb2FkU3RhcnQ7IHQgPCBicm9hZEVuZDsgdCArPSA2MCAqIDEwMDApIHtcbiAgICBjb25zdCBwID0gcGFyc2VQYXJpc1BhcnRzKG5ldyBEYXRlKHQpKTtcbiAgICBpZiAocC55ZWFyID09PSBwYXJpc1llYXIgJiYgcC5tb250aCA9PT0gcGFyaXNNb250aCAmJiBwLmRheSA9PT0gcGFyaXNEYXkgJiYgcC5ob3VyID09PSBwYXJpc0hvdXIpIHtcbiAgICAgIHJldHVybiBuZXcgRGF0ZSh0KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBKZXVkaSBcdTAwQUIgY2libGUgXHUwMEJCIHBvdXIgbGVzIGluc2NyaXB0aW9ucyAoZGF0ZSBjYWxlbmRhaXJlIFBhcmlzIFkvTS9EKS5cbiAqIFNpIG1haW50ZW5hbnQgPCBqZXVkaSAxOWggKFBhcmlzKSBkZSBjZXR0ZSBzZW1haW5lIFx1MjE5MiBjZSBqZXVkaSA7IHNpbm9uIGpldWRpIGRhbnMgNyBqb3Vycy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldE1hcmtldGluZ1RodXJzZGF5RGF0ZVBhcnRzKG5vdyA9IG5ldyBEYXRlKCkpIHtcbiAgY29uc3QgcGFyaXNOb3cgPSBwYXJzZVBhcmlzUGFydHMobm93KTtcbiAgY29uc3QgZG93ID0gZ2V0UGFyaXNXZWVrZGF5TnVtYmVyKHBhcmlzTm93KTtcbiAgY29uc3QgZGF5c0Zyb21Nb25kYXkgPSBkb3cgLSAxO1xuICBjb25zdCBtb24gPSBhZGREYXlzUGFyaXNDYWxlbmRhcihwYXJpc05vdy55ZWFyLCBwYXJpc05vdy5tb250aCwgcGFyaXNOb3cuZGF5LCAtZGF5c0Zyb21Nb25kYXkpO1xuICBjb25zdCB0aHUgPSBhZGREYXlzUGFyaXNDYWxlbmRhcihtb24ueWVhciwgbW9uLm1vbnRoLCBtb24uZGF5LCAzKTtcblxuICBjb25zdCB0aHUxOSA9IGZpbmRQYXJpc0luc3RhbnRVdGModGh1LnllYXIsIHRodS5tb250aCwgdGh1LmRheSwgMTkpO1xuICBpZiAoIXRodTE5KSByZXR1cm4gdGh1O1xuXG4gIGlmIChub3cuZ2V0VGltZSgpIDwgdGh1MTkuZ2V0VGltZSgpKSB7XG4gICAgcmV0dXJuIHRodTtcbiAgfVxuICByZXR1cm4gYWRkRGF5c1BhcmlzQ2FsZW5kYXIodGh1LnllYXIsIHRodS5tb250aCwgdGh1LmRheSwgNyk7XG59XG5cbi8qKlxuICogSW5zdGFudCBVVEMgZGUgZFx1MDBFOWJ1dCBkZSBzZXNzaW9uIHBvdXIgdW5lIG5vdXZlbGxlIGluc2NyaXB0aW9uIChjclx1MDBFOW5lYXUgdW5pcXVlIDogamV1ZGkgMjBoIFBhcmlzKS5cbiAqIEBwYXJhbSB7JzE0aCd8JzIwaCd9IFtfY3JlbmVhdV0gXHUyMDE0IGlnbm9yXHUwMEU5LCBjb25zZXJ2XHUwMEU5IHBvdXIgY29tcGF0aWJpbGl0XHUwMEU5IEFQSVxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0UmVnaXN0cmF0aW9uU2Vzc2lvbkluc3RhbnRVdGMobm93LCBfY3JlbmVhdSkge1xuICBjb25zdCB0aHUgPSBnZXRNYXJrZXRpbmdUaHVyc2RheURhdGVQYXJ0cyhub3cpO1xuICByZXR1cm4gZmluZFBhcmlzSW5zdGFudFV0Yyh0aHUueWVhciwgdGh1Lm1vbnRoLCB0aHUuZGF5LCAyMCk7XG59XG5cbmNvbnN0IFNFU1NJT05fTVMgPSA0NSAqIDYwICogMTAwMDtcblxuZXhwb3J0IGZ1bmN0aW9uIGdldFNlc3Npb25FbmRzQXRVdGMoc2Vzc2lvblN0YXJ0VXRjKSB7XG4gIGlmICghc2Vzc2lvblN0YXJ0VXRjKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIG5ldyBEYXRlKG5ldyBEYXRlKHNlc3Npb25TdGFydFV0YykuZ2V0VGltZSgpICsgU0VTU0lPTl9NUyk7XG59XG5cbi8qKlxuICogRGltYW5jaGUgMjNoIChQYXJpcykgZGUgbGEgbVx1MDBFQW1lIHNlbWFpbmUgcXVlIGxlIGpldWRpIGRlIHNlc3Npb24gKGpldWRpICsgMyBqb3VycykuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRPZmZyZUV4cGlyZXNBdFV0YyhzZXNzaW9uU3RhcnRVdGMpIHtcbiAgaWYgKCFzZXNzaW9uU3RhcnRVdGMpIHJldHVybiBudWxsO1xuICBjb25zdCBwID0gcGFyc2VQYXJpc1BhcnRzKG5ldyBEYXRlKHNlc3Npb25TdGFydFV0YykpO1xuICBjb25zdCBzdW4gPSBhZGREYXlzUGFyaXNDYWxlbmRhcihwLnllYXIsIHAubW9udGgsIHAuZGF5LCAzKTtcbiAgcmV0dXJuIGZpbmRQYXJpc0luc3RhbnRVdGMoc3VuLnllYXIsIHN1bi5tb250aCwgc3VuLmRheSwgMjMpO1xufVxuXG4vKipcbiAqIFByb2NoYWluIGluc3RhbnQgXHUwMEUwIGFmZmljaGVyIHBvdXIgY291bnRkb3duIChqZXVkaSAyMGggc3VyIGxlIGpldWRpIG1hcmtldGluZykuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRNYXJrZXRpbmdDb3VudGRvd25UYXJnZXRVdGMobm93ID0gbmV3IERhdGUoKSkge1xuICBjb25zdCB0aHUgPSBnZXRNYXJrZXRpbmdUaHVyc2RheURhdGVQYXJ0cyhub3cpO1xuICBjb25zdCB0MjAgPSBmaW5kUGFyaXNJbnN0YW50VXRjKHRodS55ZWFyLCB0aHUubW9udGgsIHRodS5kYXksIDIwKTtcbiAgaWYgKCF0MjApIHJldHVybiBudWxsO1xuICBpZiAobm93LmdldFRpbWUoKSA8IHQyMC5nZXRUaW1lKCkpIHJldHVybiB0MjA7XG4gIGNvbnN0IG5leHRUaHUgPSBhZGREYXlzUGFyaXNDYWxlbmRhcih0aHUueWVhciwgdGh1Lm1vbnRoLCB0aHUuZGF5LCA3KTtcbiAgcmV0dXJuIGZpbmRQYXJpc0luc3RhbnRVdGMobmV4dFRodS55ZWFyLCBuZXh0VGh1Lm1vbnRoLCBuZXh0VGh1LmRheSwgMjApO1xufVxuXG4vKipcbiAqIEhvcm9kYXRhZ2Ugb3B0LWluIHBvdXIgY2hhbXAgTWFpbGVyTGl0ZSA6IGpqLm1tLmFhYWEgSEg6bW06c3MgKEV1cm9wZS9QYXJpcykuXG4gKiBFeC4gMjIuMDMuMjAyNiAxNzo0NTowM1xuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0UGFyaXNPcHRpblRpbWVzdGFtcChkYXRlID0gbmV3IERhdGUoKSkge1xuICBjb25zdCBkID0gbmV3IEludGwuRGF0ZVRpbWVGb3JtYXQoJ2ZyLUZSJywge1xuICAgIHRpbWVab25lOiAnRXVyb3BlL1BhcmlzJyxcbiAgICBkYXk6ICcyLWRpZ2l0JyxcbiAgICBtb250aDogJzItZGlnaXQnLFxuICAgIHllYXI6ICdudW1lcmljJyxcbiAgICBob3VyOiAnMi1kaWdpdCcsXG4gICAgbWludXRlOiAnMi1kaWdpdCcsXG4gICAgc2Vjb25kOiAnMi1kaWdpdCcsXG4gICAgaG91ckN5Y2xlOiAnaDIzJyxcbiAgfSk7XG4gIGNvbnN0IHBhcnRzID0gZC5mb3JtYXRUb1BhcnRzKGRhdGUpO1xuICBjb25zdCBnZXQgPSAodHlwZSkgPT4gcGFydHMuZmluZCgoeCkgPT4geC50eXBlID09PSB0eXBlKT8udmFsdWUgPz8gJyc7XG4gIHJldHVybiBgJHtnZXQoJ2RheScpfS4ke2dldCgnbW9udGgnKX0uJHtnZXQoJ3llYXInKX0gJHtnZXQoJ2hvdXInKX06JHtnZXQoJ21pbnV0ZScpfToke2dldCgnc2Vjb25kJyl9YDtcbn1cblxuLyoqIEBkZXByZWNhdGVkIFx1MjAxNCBwclx1MDBFOWZcdTAwRTlyZXIgZ2V0UmVnaXN0cmF0aW9uU2Vzc2lvbkluc3RhbnRVdGMgKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXROZXh0VGh1cnNkYXlTbG90VXRjKG5vdywgcGFyaXNIb3VyKSB7XG4gIGNvbnN0IGNyZW5lYXUgPSBwYXJpc0hvdXIgPT09IDIwID8gJzIwaCcgOiAnMTRoJztcbiAgcmV0dXJuIGdldFJlZ2lzdHJhdGlvblNlc3Npb25JbnN0YW50VXRjKG5vdywgY3JlbmVhdSk7XG59XG4iLCAiY29uc3QgTUFJTEVSTElURV9BUElfQkFTRSA9ICdodHRwczovL2Nvbm5lY3QubWFpbGVybGl0ZS5jb20vYXBpJztcblxuLyoqIHNlc3Npb25fZGF0ZSBJU08gXHUyMTkyIGpvdXIgZGUgc2Vzc2lvbiBlbiBFdXJvcGUvUGFyaXMgKFlZWVktTU0tREQpIHBvdXIgY2hhbXAgTWFpbGVyTGl0ZSBlc19zZXNzaW9uX2RhdGUgKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRQYXJpc1Nlc3Npb25EYXRlWXl5eU1tRGQoaXNvU3RyaW5nKSB7XG4gIGlmICghaXNvU3RyaW5nKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBkID0gbmV3IERhdGUoaXNvU3RyaW5nKTtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoZC5nZXRUaW1lKCkpKSByZXR1cm4gdW5kZWZpbmVkO1xuICByZXR1cm4gbmV3IEludGwuRGF0ZVRpbWVGb3JtYXQoJ2VuLUNBJywge1xuICAgIHRpbWVab25lOiAnRXVyb3BlL1BhcmlzJyxcbiAgICB5ZWFyOiAnbnVtZXJpYycsXG4gICAgbW9udGg6ICcyLWRpZ2l0JyxcbiAgICBkYXk6ICcyLWRpZ2l0JyxcbiAgfSkuZm9ybWF0KGQpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0TWFpbGVyTGl0ZVN1YnNjcmliZXJJZChlbWFpbCwgYXBpS2V5KSB7XG4gIGNvbnN0IGhlYWRlcnMgPSB7XG4gICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke2FwaUtleX1gLFxuICAgIEFjY2VwdDogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICB9O1xuICB0cnkge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKGAke01BSUxFUkxJVEVfQVBJX0JBU0V9L3N1YnNjcmliZXJzLyR7ZW5jb2RlVVJJQ29tcG9uZW50KGVtYWlsKX1gLCB7XG4gICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgaGVhZGVycyxcbiAgICB9KTtcbiAgICBpZiAoIXJlcy5vaykgcmV0dXJuIG51bGw7XG4gICAgY29uc3QganNvbiA9IGF3YWl0IHJlcy5qc29uKCk7XG4gICAgcmV0dXJuIGpzb24/LmRhdGE/LmlkIHx8IG51bGw7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBhZGRTdWJzY3JpYmVyVG9Hcm91cChzdWJzY3JpYmVySWQsIGdyb3VwSWQsIGFwaUtleSkge1xuICBpZiAoIXN1YnNjcmliZXJJZCB8fCAhZ3JvdXBJZCkge1xuICAgIHJldHVybiB7IGFzc2lnbmVkOiBmYWxzZSwgYWxyZWFkeUluR3JvdXA6IGZhbHNlIH07XG4gIH1cbiAgY29uc3QgaGVhZGVycyA9IHtcbiAgICBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7YXBpS2V5fWAsXG4gICAgQWNjZXB0OiAnYXBwbGljYXRpb24vanNvbicsXG4gIH07XG4gIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKGAke01BSUxFUkxJVEVfQVBJX0JBU0V9L3N1YnNjcmliZXJzLyR7c3Vic2NyaWJlcklkfS9ncm91cHMvJHtncm91cElkfWAsIHtcbiAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICBoZWFkZXJzLFxuICB9KTtcbiAgaWYgKCFyZXMub2sgJiYgcmVzLnN0YXR1cyAhPT0gNDIyKSB7XG4gICAgY29uc3QgZXJyID0gYXdhaXQgcmVzLmpzb24oKS5jYXRjaCgoKSA9PiAoe30pKTtcbiAgICBjb25zb2xlLmVycm9yKCdNYWlsZXJMaXRlIGFkZCBncm91cCBlcnJvcjonLCBlcnIpO1xuICAgIHJldHVybiB7IGFzc2lnbmVkOiBmYWxzZSwgYWxyZWFkeUluR3JvdXA6IGZhbHNlIH07XG4gIH1cbiAgaWYgKHJlcy5zdGF0dXMgPT09IDQyMikge1xuICAgIHJldHVybiB7IGFzc2lnbmVkOiBmYWxzZSwgYWxyZWFkeUluR3JvdXA6IHRydWUgfTtcbiAgfVxuICByZXR1cm4geyBhc3NpZ25lZDogdHJ1ZSwgYWxyZWFkeUluR3JvdXA6IGZhbHNlIH07XG59XG5cbi8qKlxuICogQ3JcdTAwRTllIG91IG1ldCBcdTAwRTAgam91ciBsZSBjb250YWN0ICsgY2hhbXBzIHVuaXF1ZV90b2tlbl93ZWJpbmFpcmUsIGRhdGVfb3B0aW5fbWFzdGVyY2xhc3MgKyBncm91cGUgb3B0aW9ubmVsLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdXBzZXJ0V2ViaW5haXJlU3Vic2NyaWJlcih7XG4gIGVtYWlsLFxuICBwcmVub20sXG4gIHRlbGVwaG9uZSxcbiAgcGF5cyxcbiAgdG9rZW4sXG4gIGRhdGVPcHRpbk1hc3RlcmNsYXNzLFxuICBkYXRlV2ViaW5haXJlLFxuICBncm91cElkLFxuICBhcGlLZXksXG59KSB7XG4gIGNvbnN0IGhlYWRlcnMgPSB7XG4gICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke2FwaUtleX1gLFxuICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgQWNjZXB0OiAnYXBwbGljYXRpb24vanNvbicsXG4gIH07XG5cbiAgY29uc3QgZXNTZXNzaW9uRGF0ZSA9IGZvcm1hdFBhcmlzU2Vzc2lvbkRhdGVZeXl5TW1EZChkYXRlV2ViaW5haXJlKTtcblxuICBjb25zdCBmaWVsZHMgPSB7XG4gICAgZmlyc3RfbmFtZTogcHJlbm9tLFxuICAgIG5hbWU6IHByZW5vbSxcbiAgICBwaG9uZTogdGVsZXBob25lLFxuICAgIGxvY2F0aW9uOiBwYXlzLFxuICAgIGVzX2NvdW50cnk6IHBheXMgfHwgJycsXG4gICAgLi4uKGVzU2Vzc2lvbkRhdGUgPyB7IGVzX3Nlc3Npb25fZGF0ZTogZXNTZXNzaW9uRGF0ZSB9IDoge30pLFxuICAgIHVuaXF1ZV90b2tlbl93ZWJpbmFpcmU6IHRva2VuLFxuICAgIC4uLihkYXRlT3B0aW5NYXN0ZXJjbGFzc1xuICAgICAgPyB7IGRhdGVfb3B0aW5fbWFzdGVyY2xhc3M6IGRhdGVPcHRpbk1hc3RlcmNsYXNzIH1cbiAgICAgIDoge30pLFxuICAgIC4uLihkYXRlV2ViaW5haXJlXG4gICAgICA/IHtcbiAgICAgICAgICBlc18yXzBfZGF0ZV93ZWJpbmFpcmU6IGRhdGVXZWJpbmFpcmUsXG4gICAgICAgICAgZGF0ZV93ZWJpbmFpcmU6IGRhdGVXZWJpbmFpcmUsXG4gICAgICAgICAgZXMyX2RhdGVfd2ViaW5haXJlOiBkYXRlV2ViaW5haXJlLFxuICAgICAgICB9XG4gICAgICA6IHt9KSxcbiAgfTtcblxuICBsZXQgc3Vic2NyaWJlcklkID0gYXdhaXQgZ2V0TWFpbGVyTGl0ZVN1YnNjcmliZXJJZChlbWFpbCwgYXBpS2V5KTtcblxuICBpZiAoc3Vic2NyaWJlcklkKSB7XG4gICAgYXdhaXQgZmV0Y2goYCR7TUFJTEVSTElURV9BUElfQkFTRX0vc3Vic2NyaWJlcnMvJHtzdWJzY3JpYmVySWR9YCwge1xuICAgICAgbWV0aG9kOiAnUFVUJyxcbiAgICAgIGhlYWRlcnMsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IHN0YXR1czogJ2FjdGl2ZScsIGZpZWxkcyB9KSxcbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICBjb25zdCBjcmVhdGVSZXNwb25zZSA9IGF3YWl0IGZldGNoKGAke01BSUxFUkxJVEVfQVBJX0JBU0V9L3N1YnNjcmliZXJzYCwge1xuICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICBoZWFkZXJzLFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlbWFpbCwgc3RhdHVzOiAnYWN0aXZlJywgZmllbGRzIH0pLFxuICAgIH0pO1xuICAgIGNvbnN0IGNyZWF0ZUpzb24gPSBhd2FpdCBjcmVhdGVSZXNwb25zZS5qc29uKCk7XG4gICAgaWYgKCFjcmVhdGVSZXNwb25zZS5vaykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGNyZWF0ZUpzb24/Lm1lc3NhZ2UgfHwgJ01haWxlckxpdGUgY3JlYXRlIGVycm9yJyk7XG4gICAgfVxuICAgIHN1YnNjcmliZXJJZCA9IGNyZWF0ZUpzb24/LmRhdGE/LmlkIHx8IG51bGw7XG4gIH1cblxuICBsZXQgZ3JvdXBBc3NpZ25lZEF0ID0gbnVsbDtcbiAgaWYgKHN1YnNjcmliZXJJZCAmJiBncm91cElkKSB7XG4gICAgY29uc3QgZ3JvdXBSZXN1bHQgPSBhd2FpdCBhZGRTdWJzY3JpYmVyVG9Hcm91cChzdWJzY3JpYmVySWQsIGdyb3VwSWQsIGFwaUtleSk7XG4gICAgaWYgKGdyb3VwUmVzdWx0LmFzc2lnbmVkIHx8IGdyb3VwUmVzdWx0LmFscmVhZHlJbkdyb3VwKSB7XG4gICAgICBncm91cEFzc2lnbmVkQXQgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgICBjb25zdCBncm91cERhdGVGaWVsZHMgPSB7XG4gICAgICAgIHNham91dGVfZGFuc19sZV9ncm91cGVfbGU6IGdyb3VwQXNzaWduZWRBdCxcbiAgICAgICAgZXMyX2Fqb3V0ZV9kYW5zX2xlX2dyb3VwZV9sZTogZ3JvdXBBc3NpZ25lZEF0LFxuICAgICAgICBkYXRlX2Fqb3V0X2dyb3VwZV93ZWJpbmFpcmU6IGdyb3VwQXNzaWduZWRBdCxcbiAgICAgIH07XG4gICAgICAvLyBSXHUwMEU5LWVudm95ZXIgbGVzIGNoYW1wcyBtXHUwMEU5dGllciArIGRhdGVzIGdyb3VwZSBwb3VyIFx1MDBFOXZpdGVyIGRcdTIwMTlcdTAwRTljcmFzZXJcbiAgICAgIC8vIHVuaXF1ZV90b2tlbl93ZWJpbmFpcmUgLyBlc19zZXNzaW9uX2RhdGUgLyBlc19jb3VudHJ5IHNpIGxcdTIwMTlBUEkgZnVzaW9ubmUgbWFsLlxuICAgICAgYXdhaXQgZmV0Y2goYCR7TUFJTEVSTElURV9BUElfQkFTRX0vc3Vic2NyaWJlcnMvJHtzdWJzY3JpYmVySWR9YCwge1xuICAgICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgICBoZWFkZXJzLFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgICAgICBmaWVsZHM6IHsgLi4uZmllbGRzLCAuLi5ncm91cERhdGVGaWVsZHMgfSxcbiAgICAgICAgfSksXG4gICAgICB9KS5jYXRjaCgoKSA9PiB7fSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHsgc3Vic2NyaWJlcklkLCBncm91cEFzc2lnbmVkQXQgfTtcbn1cblxuLyoqXG4gKiBNZXQgXHUwMEUwIGpvdXIgdW5pcXVlbWVudCBsZXMgY2hhbXBzIEVTMiB1dGlsZXMgYXUgZGFzaGJvYXJkIC8gc2VnbWVudHMgKGJhY2tmaWxsIG9uZS1zaG90KS5cbiAqIE5lIG1vZGlmaWUgcGFzIGxlcyBncm91cGVzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcGF0Y2hNYWlsZXJMaXRlV2ViaW5haXJlQ29yZUZpZWxkcyh7IGVtYWlsLCB0b2tlbiwgcGF5cywgc2Vzc2lvbkRhdGVJc28sIGFwaUtleSB9KSB7XG4gIGNvbnN0IGhlYWRlcnMgPSB7XG4gICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke2FwaUtleX1gLFxuICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgQWNjZXB0OiAnYXBwbGljYXRpb24vanNvbicsXG4gIH07XG4gIGNvbnN0IHN1YnNjcmliZXJJZCA9IGF3YWl0IGdldE1haWxlckxpdGVTdWJzY3JpYmVySWQoZW1haWwsIGFwaUtleSk7XG4gIGlmICghc3Vic2NyaWJlcklkKSB7XG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCByZWFzb246ICdzdWJzY3JpYmVyX25vdF9mb3VuZCcgfTtcbiAgfVxuICBjb25zdCBlc1Nlc3Npb25EYXRlID0gZm9ybWF0UGFyaXNTZXNzaW9uRGF0ZVl5eXlNbURkKHNlc3Npb25EYXRlSXNvKTtcbiAgY29uc3QgZmllbGRzID0ge1xuICAgIHVuaXF1ZV90b2tlbl93ZWJpbmFpcmU6IHRva2VuLFxuICAgIGVzX2NvdW50cnk6IHBheXMgfHwgJycsXG4gICAgLi4uKGVzU2Vzc2lvbkRhdGUgPyB7IGVzX3Nlc3Npb25fZGF0ZTogZXNTZXNzaW9uRGF0ZSB9IDoge30pLFxuICB9O1xuICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaChgJHtNQUlMRVJMSVRFX0FQSV9CQVNFfS9zdWJzY3JpYmVycy8ke3N1YnNjcmliZXJJZH1gLCB7XG4gICAgbWV0aG9kOiAnUFVUJyxcbiAgICBoZWFkZXJzLFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgc3RhdHVzOiAnYWN0aXZlJywgZmllbGRzIH0pLFxuICB9KTtcbiAgY29uc3QganNvbiA9IGF3YWl0IHJlcy5qc29uKCkuY2F0Y2goKCkgPT4gKHt9KSk7XG4gIGlmICghcmVzLm9rKSB7XG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCByZWFzb246IGpzb24/Lm1lc3NhZ2UgfHwgYGh0dHBfJHtyZXMuc3RhdHVzfWAsIHN0YXR1czogcmVzLnN0YXR1cyB9O1xuICB9XG4gIHJldHVybiB7IG9rOiB0cnVlLCBzdWJzY3JpYmVySWQgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFdlYmluYWlyZUdyb3VwRW52KCkge1xuICByZXR1cm4ge1xuICAgIGluc2NyaXRzOlxuICAgICAgcHJvY2Vzcy5lbnYuTUFJTEVSTElURV9HUk9VUF9XRUJJTkFJUkVfSU5TQ1JJVFMgfHxcbiAgICAgIHByb2Nlc3MuZW52Lk1BSUxFUkxJVEVfR1JPVVBfV0VCSU5BSVJFX0VTMl9JTlNDUklUUyB8fFxuICAgICAgcHJvY2Vzcy5lbnYuTUFJTEVSTElURV9HUk9VUF9XRUJJTkFJUkVfRVMyIHx8XG4gICAgICBwcm9jZXNzLmVudi5NQUlMRVJMSVRFX0dST1VQX1dFQklOQVJfRVMyLFxuICAgIHByZXNlbnRzOlxuICAgICAgcHJvY2Vzcy5lbnYuTUFJTEVSTElURV9HUk9VUF9XRUJJTkFJUkVfUFJFU0VOVFMgfHxcbiAgICAgIHByb2Nlc3MuZW52Lk1BSUxFUkxJVEVfR1JPVVBfV0VCSU5BSVJFX0VTMl9QUkVTRU5UUyxcbiAgICBhY2hldGV1cnM6XG4gICAgICBwcm9jZXNzLmVudi5NQUlMRVJMSVRFX0dST1VQX1dFQklOQUlSRV9BQ0hFVEVVUlMgfHxcbiAgICAgIHByb2Nlc3MuZW52Lk1BSUxFUkxJVEVfR1JPVVBfV0VCSU5BSVJFX0VTMl9BQ0hFVEVVUlMsXG4gICAgbm9uQWNoZXRldXJzOlxuICAgICAgcHJvY2Vzcy5lbnYuTUFJTEVSTElURV9HUk9VUF9XRUJJTkFJUkVfTk9OX0FDSEVURVVSUyB8fFxuICAgICAgcHJvY2Vzcy5lbnYuTUFJTEVSTElURV9HUk9VUF9XRUJJTkFJUkVfRVMyX05PTl9BQ0hFVEVVUlMsXG4gIH07XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIGdldFN1cGFiYXNlQ29uZmlnKCkge1xuICBjb25zdCB1cmwgPSBwcm9jZXNzLmVudi5TVVBBQkFTRV9VUkw7XG4gIGNvbnN0IGtleSA9IHByb2Nlc3MuZW52LlNVUEFCQVNFX1NFUlZJQ0VfUk9MRV9LRVk7XG4gIHJldHVybiB7IHVybCwga2V5IH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzdXBhYmFzZUhlYWRlcnMoZXh0cmEgPSB7fSkge1xuICBjb25zdCB7IGtleSB9ID0gZ2V0U3VwYWJhc2VDb25maWcoKTtcbiAgcmV0dXJuIHtcbiAgICBhcGlrZXk6IGtleSxcbiAgICBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7a2V5fWAsXG4gICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAuLi5leHRyYSxcbiAgfTtcbn1cblxuLyoqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIHF1ZXJ5IGUuZy4gXCJ3ZWJpbmFpcmVfcmVnaXN0cmF0aW9ucz90b2tlbj1lcS54XCIgKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzdXBhYmFzZUdldChwYXRoKSB7XG4gIGNvbnN0IHsgdXJsLCBrZXkgfSA9IGdldFN1cGFiYXNlQ29uZmlnKCk7XG4gIGlmICghdXJsIHx8ICFrZXkpIHtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIHN0YXR1czogNTAwLCBkYXRhOiBudWxsLCBlcnJvcjogJ1N1cGFiYXNlIG5vbiBjb25maWd1clx1MDBFOScgfTtcbiAgfVxuICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaChgJHt1cmx9L3Jlc3QvdjEvJHtwYXRofWAsIHtcbiAgICBoZWFkZXJzOiBzdXBhYmFzZUhlYWRlcnMoKSxcbiAgfSk7XG4gIGNvbnN0IHRleHQgPSBhd2FpdCByZXMudGV4dCgpO1xuICBsZXQgZGF0YSA9IG51bGw7XG4gIHRyeSB7XG4gICAgZGF0YSA9IHRleHQgPyBKU09OLnBhcnNlKHRleHQpIDogbnVsbDtcbiAgfSBjYXRjaCB7XG4gICAgZGF0YSA9IHRleHQ7XG4gIH1cbiAgcmV0dXJuIHsgb2s6IHJlcy5vaywgc3RhdHVzOiByZXMuc3RhdHVzLCBkYXRhLCBlcnJvcjogcmVzLm9rID8gbnVsbCA6IGRhdGEgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHN1cGFiYXNlUG9zdCh0YWJsZSwgYm9keSwgeyBwcmVmZXIgPSAncmV0dXJuPXJlcHJlc2VudGF0aW9uJyB9ID0ge30pIHtcbiAgY29uc3QgeyB1cmwsIGtleSB9ID0gZ2V0U3VwYWJhc2VDb25maWcoKTtcbiAgaWYgKCF1cmwgfHwgIWtleSkge1xuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgc3RhdHVzOiA1MDAsIGRhdGE6IG51bGwsIGVycm9yOiAnU3VwYWJhc2Ugbm9uIGNvbmZpZ3VyXHUwMEU5JyB9O1xuICB9XG4gIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKGAke3VybH0vcmVzdC92MS8ke3RhYmxlfWAsIHtcbiAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICBoZWFkZXJzOiBzdXBhYmFzZUhlYWRlcnMoeyBQcmVmZXI6IHByZWZlciB9KSxcbiAgICBib2R5OiBKU09OLnN0cmluZ2lmeShib2R5KSxcbiAgfSk7XG4gIGNvbnN0IHRleHQgPSBhd2FpdCByZXMudGV4dCgpO1xuICBsZXQgZGF0YSA9IG51bGw7XG4gIHRyeSB7XG4gICAgZGF0YSA9IHRleHQgPyBKU09OLnBhcnNlKHRleHQpIDogbnVsbDtcbiAgfSBjYXRjaCB7XG4gICAgZGF0YSA9IHRleHQ7XG4gIH1cbiAgcmV0dXJuIHsgb2s6IHJlcy5vaywgc3RhdHVzOiByZXMuc3RhdHVzLCBkYXRhLCBlcnJvcjogcmVzLm9rID8gbnVsbCA6IGRhdGEgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHN1cGFiYXNlUGF0Y2godGFibGUsIHF1ZXJ5LCBib2R5KSB7XG4gIGNvbnN0IHsgdXJsLCBrZXkgfSA9IGdldFN1cGFiYXNlQ29uZmlnKCk7XG4gIGlmICghdXJsIHx8ICFrZXkpIHtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIHN0YXR1czogNTAwLCBkYXRhOiBudWxsLCBlcnJvcjogJ1N1cGFiYXNlIG5vbiBjb25maWd1clx1MDBFOScgfTtcbiAgfVxuICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaChgJHt1cmx9L3Jlc3QvdjEvJHt0YWJsZX0/JHtxdWVyeX1gLCB7XG4gICAgbWV0aG9kOiAnUEFUQ0gnLFxuICAgIGhlYWRlcnM6IHN1cGFiYXNlSGVhZGVycyh7IFByZWZlcjogJ3JldHVybj1yZXByZXNlbnRhdGlvbicgfSksXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoYm9keSksXG4gIH0pO1xuICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVzLnRleHQoKTtcbiAgbGV0IGRhdGEgPSBudWxsO1xuICB0cnkge1xuICAgIGRhdGEgPSB0ZXh0ID8gSlNPTi5wYXJzZSh0ZXh0KSA6IG51bGw7XG4gIH0gY2F0Y2gge1xuICAgIGRhdGEgPSB0ZXh0O1xuICB9XG4gIHJldHVybiB7IG9rOiByZXMub2ssIHN0YXR1czogcmVzLnN0YXR1cywgZGF0YSwgZXJyb3I6IHJlcy5vayA/IG51bGwgOiBkYXRhIH07XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7O0FBQUEsT0FBTyxZQUFZOzs7QUNLWixTQUFTLGdCQUFnQixNQUFNO0FBQ3BDLFFBQU0sWUFBWSxJQUFJLEtBQUssZUFBZSxTQUFTO0FBQUEsSUFDakQsVUFBVTtBQUFBLElBQ1YsaUJBQWlCO0FBQUEsSUFDakIsTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsU0FBUztBQUFBLElBQ1QsTUFBTTtBQUFBLElBQ04sUUFBUTtBQUFBLElBQ1IsUUFBUTtBQUFBLElBQ1IsV0FBVztBQUFBLEVBQ2IsQ0FBQztBQUNELFFBQU0sUUFBUSxVQUFVLGNBQWMsSUFBSTtBQUMxQyxRQUFNLFFBQVEsQ0FBQyxTQUFTLE9BQU8sTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLFNBQVMsSUFBSSxHQUFHLFNBQVMsQ0FBQztBQUM3RSxRQUFNLFVBQVUsTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLFNBQVMsU0FBUyxHQUFHLFNBQVM7QUFD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QUFJLEtBQUs7QUFDL0UsYUFBTyxhQUFhLEtBQUs7QUFBQSxRQUN2QixPQUFPO0FBQUEsUUFDUCxTQUFTLFFBQVEsSUFBSSxjQUFjLElBQUksUUFBUTtBQUFBLE1BQ2pELENBQUM7QUFBQSxJQUNIO0FBRUEsVUFBTSxTQUFTLFFBQVEsSUFBSTtBQUMzQixVQUFNLFNBQVMscUJBQXFCO0FBQ3BDLFVBQU0sZ0JBQ0osT0FBTyxZQUNQLFFBQVEsSUFBSSx1Q0FDWixRQUFRLElBQUksMkNBQ1osUUFBUSxJQUFJLGtDQUNaLFFBQVEsSUFBSTtBQUdkLFFBQUksVUFBVSxlQUFlO0FBQzNCLFVBQUk7QUFDRixjQUFNLEtBQUssTUFBTSwwQkFBMEI7QUFBQSxVQUN6QztBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxVQUNBLHNCQUFzQiwwQkFBMEIsb0JBQUksS0FBSyxDQUFDO0FBQUEsVUFDMUQsZUFBZSxhQUFhLFlBQVk7QUFBQSxVQUN4QyxTQUFTO0FBQUEsVUFDVDtBQUFBLFFBQ0YsQ0FBQztBQUVELFlBQUksSUFBSSxpQkFBaUI7QUFDdkIsZ0JBQU0sY0FBYyxNQUFNO0FBQUEsWUFDeEI7QUFBQSxZQUNBLFlBQVksbUJBQW1CLEtBQUssQ0FBQztBQUFBLFlBQ3JDLEVBQUUsMkJBQTJCLEdBQUcsZ0JBQWdCO0FBQUEsVUFDbEQ7QUFDQSxjQUFJLENBQUMsWUFBWSxJQUFJO0FBQ25CLG9CQUFRO0FBQUEsY0FDTjtBQUFBLGNBQ0EsWUFBWTtBQUFBLGNBQ1osWUFBWTtBQUFBLFlBQ2Q7QUFBQSxVQUNGO0FBQUEsUUFDRjtBQUFBLE1BQ0YsU0FBUyxPQUFPO0FBQ2QsZ0JBQVEsTUFBTSxrQ0FBa0MsS0FBSztBQUFBLE1BQ3ZEO0FBQUEsSUFDRjtBQUVBLFdBQU8sYUFBYSxLQUFLO0FBQUEsTUFDdkIsU0FBUztBQUFBLE1BQ1Q7QUFBQSxNQUNBLFlBQVksK0JBQStCLEtBQUs7QUFBQSxJQUNsRCxDQUFDO0FBQUEsRUFDSCxTQUFTLE9BQU87QUFDZCxZQUFRLE1BQU0sNkJBQTZCLEtBQUs7QUFDaEQsV0FBTyxhQUFhLEtBQUs7QUFBQSxNQUN2QixPQUFPO0FBQUEsTUFDUCxTQUFTLFFBQVEsSUFBSSxjQUFjLE1BQU0sVUFBVTtBQUFBLElBQ3JELENBQUM7QUFBQSxFQUNIO0FBQ0Y7IiwKICAibmFtZXMiOiBbImFwaUtleSIsICJncm91cHMiLCAiZ3JvdXBJbnNjcml0cyJdCn0K
