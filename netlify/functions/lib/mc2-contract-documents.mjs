import crypto from 'node:crypto';
import {
  MC2_CONTRACT_TOTAL_CENTS,
  MC2_ENTRY_PAYMENT_CENTS,
  MC2_INSTALLMENT_CENTS,
  MC2_INSTALLMENT_OFFSETS_DAYS,
  MC2_PAYMENT_PLAN,
  MC2_SESSION_MONTHLY_PAYMENT_CENTS,
  MC2_SESSION_MONTHLY_PLAN,
  MC2_SESSION_MONTHLY_TOTAL_CENTS,
  MC2_SESSION_ONE_TIME_CENTS,
  MC2_SESSION_ONE_TIME_PLAN,
  MC2_SESSION_REMAINING_PAYMENT_COUNT,
} from './mc2-stripe.mjs';
import { mc2ContractVersion } from './mc2-collection-case.mjs';
import { supabaseGet, supabasePost } from './supabase-rest.mjs';

const MC2_SYSTEM = 'es2_mc2';
const MC2_PRODUCT_KEY = 'esprit-subconscient-2';
const DAY_MS = 24 * 60 * 60 * 1_000;
const clean = (value, max = 500) => String(value == null ? '' : value).trim().slice(0, max);
const encode = (value) => encodeURIComponent(clean(value, 1_000));

function validDate(value) {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? date : null;
}

function isoFromStripe(value) {
  const numeric = Number(value || 0);
  const date = numeric > 0 ? new Date(numeric * 1_000) : validDate(value);
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function publicDate(value) {
  const date = validDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(date);
}

function money(cents) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Number(cents || 0) / 100);
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(clean(value, 1_000));
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function referenceFor(purchasedAt) {
  const compactDate = purchasedAt.slice(0, 10).replaceAll('-', '');
  return `MC2-${compactDate}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

export function mc2ContractDocumentsEnabled(env = process.env) {
  return clean(env.MC2_CONTRACT_DOCUMENTS_ENABLED, 10).toLowerCase() === 'true';
}

export function mc2ContractDocumentConfig(env = process.env) {
  return {
    termsUrl: safeHttpsUrl(env.MC2_TERMS_URL || 'https://sonnycourt.com/cgv/'),
    termsSnapshotUrl: safeHttpsUrl(env.MC2_TERMS_SNAPSHOT_URL),
    termsSnapshotSha256: clean(env.MC2_TERMS_SNAPSHOT_SHA256, 128).toLowerCase(),
    contractVersion: mc2ContractVersion(env),
  };
}

export function validateMc2ContractDocumentReadiness(env = process.env) {
  const config = mc2ContractDocumentConfig(env);
  const errors = [];
  if (!config.termsUrl) errors.push('terms_url_invalid');
  if (!config.termsSnapshotUrl) errors.push('terms_snapshot_url_invalid');
  if (!/^[a-f0-9]{64}$/.test(config.termsSnapshotSha256)) errors.push('terms_snapshot_sha256_invalid');
  if (!config.contractVersion) errors.push('contract_version_missing');
  return { valid: errors.length === 0, errors };
}

export function mc2PaidSessionIsEligible(session = {}) {
  if (session.mode !== 'payment'
    || session.payment_status !== 'paid'
    || session.metadata?.system !== MC2_SYSTEM) return false;
  if (String(session.currency || '').toLowerCase() !== 'eur') return false;
  const plan = session.metadata?.payment_plan;
  const total = Number(session.metadata?.contractual_total_cents || 0);
  const initial = Number(session.amount_total || 0);
  return (plan === MC2_PAYMENT_PLAN && total === MC2_CONTRACT_TOTAL_CENTS && initial === MC2_ENTRY_PAYMENT_CENTS)
    || (plan === MC2_SESSION_MONTHLY_PLAN && total === MC2_SESSION_MONTHLY_TOTAL_CENTS && initial === MC2_SESSION_MONTHLY_PAYMENT_CENTS)
    || (plan === MC2_SESSION_ONE_TIME_PLAN && total === MC2_SESSION_ONE_TIME_CENTS && initial === MC2_SESSION_ONE_TIME_CENTS);
}

function addMonths(date, months) {
  const next = new Date(date.getTime());
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

function pricingForSession(session, purchasedAt) {
  const paymentPlan = session.metadata.payment_plan;
  const purchaseDate = new Date(purchasedAt);
  if (paymentPlan === MC2_SESSION_ONE_TIME_PLAN) {
    return {
      purchaseType: 'achat unique réglé en une fois',
      totalCents: MC2_SESSION_ONE_TIME_CENTS,
      initialCents: MC2_SESSION_ONE_TIME_CENTS,
      schedule: [{
        sequence: 0, label: 'Paiement unique', due_offset_days: 0, due_at: purchasedAt,
        amount_cents: MC2_SESSION_ONE_TIME_CENTS, status_at_purchase: 'paid',
      }],
    };
  }
  if (paymentPlan === MC2_SESSION_MONTHLY_PLAN) {
    return {
      purchaseType: 'achat unique avec paiement en douze mensualités',
      totalCents: MC2_SESSION_MONTHLY_TOTAL_CENTS,
      initialCents: MC2_SESSION_MONTHLY_PAYMENT_CENTS,
      schedule: [{
        sequence: 0, label: 'Première mensualité', due_offset_months: 0, due_at: purchasedAt,
        amount_cents: MC2_SESSION_MONTHLY_PAYMENT_CENTS, status_at_purchase: 'paid',
      }, ...Array.from({ length: MC2_SESSION_REMAINING_PAYMENT_COUNT }, (_, index) => ({
        sequence: index + 1,
        label: `Mensualité ${index + 2}`,
        due_offset_months: index + 1,
        due_at: addMonths(purchaseDate, index + 1).toISOString(),
        amount_cents: MC2_SESSION_MONTHLY_PAYMENT_CENTS,
        status_at_purchase: 'scheduled',
      }))],
    };
  }
  return {
    purchaseType: 'achat unique avec paiement fractionné',
    totalCents: MC2_CONTRACT_TOTAL_CENTS,
    initialCents: MC2_ENTRY_PAYMENT_CENTS,
    schedule: [{
      sequence: 0, label: 'Paiement initial', due_offset_days: 0, due_at: purchasedAt,
      amount_cents: MC2_ENTRY_PAYMENT_CENTS, status_at_purchase: 'paid',
    }, ...MC2_INSTALLMENT_OFFSETS_DAYS.map((offset, index) => ({
      sequence: index + 1, label: `Échéance ${index + 1}`, due_offset_days: offset,
      due_at: new Date(purchaseDate.getTime() + offset * DAY_MS).toISOString(),
      amount_cents: MC2_INSTALLMENT_CENTS, status_at_purchase: 'scheduled',
    }))],
  };
}

export function buildMc2ContractDocumentSnapshot({ session, event, env = process.env } = {}) {
  if (!mc2PaidSessionIsEligible(session)) return null;
  const readiness = validateMc2ContractDocumentReadiness(env);
  if (!readiness.valid) throw new Error(`mc2_contract_documents_not_ready:${readiness.errors.join(',')}`);
  const config = mc2ContractDocumentConfig(env);
  const purchasedAt = isoFromStripe(event?.created) || isoFromStripe(session.created);
  if (!purchasedAt) throw new Error('mc2_contract_purchase_date_missing');
  const purchaseTime = new Date(purchasedAt).getTime();
  const pricing = pricingForSession(session, purchasedAt);

  return {
    schema_version: session.metadata.payment_plan === MC2_PAYMENT_PLAN
      ? 'mc2-contract-document-v1'
      : 'mc2-contract-document-v2',
    document_reference: referenceFor(purchasedAt),
    issued_at: purchasedAt,
    purchased_at: purchasedAt,
    verified_paid_at_creation: true,
    product: {
      key: MC2_PRODUCT_KEY,
      name: 'Esprit Subconscient 2.0',
      purchase_type: pricing.purchaseType,
      renewal: false,
    },
    pricing: {
      currency: 'eur',
      total_cents: pricing.totalCents,
      paid_at_purchase_cents: pricing.initialCents,
      remaining_scheduled_cents: pricing.totalCents - pricing.initialCents,
      payment_plan: session.metadata.payment_plan,
    },
    schedule: pricing.schedule,
    seller: {
      legal_name: 'ArgEntrepreneur Sàrl',
      address: 'Chemin du Marais 13, 1040 Echallens, Suisse',
      commercial_register_number: 'CH-550.1.182.756-8',
      support_email: 'support@sonnycourt.com',
    },
    terms: {
      version: config.contractVersion,
      current_url: config.termsUrl,
      snapshot_url: config.termsSnapshotUrl,
      snapshot_sha256: config.termsSnapshotSha256,
    },
    commercial_guarantee: {
      name: 'Garantie Manifestation',
      duration_months: 12,
      deadline_at: addMonths(new Date(purchaseTime), 12).toISOString(),
      eligibility: 'complete_core_training',
      contact_email: 'support@sonnycourt.com',
    },
  };
}

function publicSnapshotIsValid(snapshot = {}) {
  const supportedPlan = snapshot.pricing?.payment_plan === MC2_PAYMENT_PLAN
    || snapshot.pricing?.payment_plan === MC2_SESSION_MONTHLY_PLAN
    || snapshot.pricing?.payment_plan === MC2_SESSION_ONE_TIME_PLAN;
  const scheduleTotal = Array.isArray(snapshot.schedule)
    ? snapshot.schedule.reduce((total, row) => total + Number(row?.amount_cents || 0), 0)
    : 0;
  return ['mc2-contract-document-v1', 'mc2-contract-document-v2'].includes(snapshot.schema_version)
    && snapshot.verified_paid_at_creation === true
    && snapshot.product?.key === MC2_PRODUCT_KEY
    && supportedPlan
    && Number(snapshot.pricing?.total_cents || 0) > 0
    && Number(snapshot.pricing?.paid_at_purchase_cents || 0) > 0
    && Array.isArray(snapshot.schedule)
    && snapshot.schedule.length > 0
    && scheduleTotal === Number(snapshot.pricing?.total_cents || 0);
}

async function contractDocumentByRegistrationToken(token) {
  const result = await supabaseGet(
    `mc2_contract_documents?registration_token=eq.${encode(token)}&select=*&limit=1`,
  );
  return result.ok && Array.isArray(result.data) ? result.data[0] || null : null;
}

export async function queueMc2ContractDocument({ registration, session, event, env = process.env } = {}) {
  if (!mc2ContractDocumentsEnabled(env)) return { ok: true, enabled: false, queued: false };
  if (!registration?.token) return { ok: false, error: 'registration_missing' };
  const snapshot = buildMc2ContractDocumentSnapshot({ session, event, env });
  if (!snapshot) return { ok: true, enabled: true, queued: false, skipped: 'not_paid_mc2' };
  const accessToken = crypto.randomBytes(32).toString('base64url');
  const payload = {
    registration_token: clean(registration.token, 128),
    access_token: accessToken,
    access_token_hash: sha256(accessToken),
    document_reference: snapshot.document_reference,
    product_key: snapshot.product.key,
    source_stripe_event_id: clean(event?.id, 255),
    purchased_at: snapshot.purchased_at,
    snapshot,
    rendered_html: renderMc2ContractDocument(snapshot),
    notification_status: 'pending',
  };
  const inserted = await supabasePost(
    'mc2_contract_documents?on_conflict=registration_token',
    payload,
    { prefer: 'resolution=ignore-duplicates,return=representation' },
  );
  if (!inserted.ok) throw new Error(`mc2_contract_document_${inserted.status}`);
  const created = Array.isArray(inserted.data) ? inserted.data[0] || null : null;
  const row = created || await contractDocumentByRegistrationToken(registration.token);
  if (!row?.id) throw new Error('mc2_contract_document_not_persisted');
  return { ok: true, enabled: true, queued: Boolean(created), id: row.id };
}

export async function loadMc2ContractDocumentByAccessToken(token) {
  const safeToken = clean(token, 160);
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(safeToken)) return null;
  const result = await supabaseGet(
    `mc2_contract_documents?access_token_hash=eq.${sha256(safeToken)}`
      + '&product_key=eq.esprit-subconscient-2&select=snapshot,rendered_html&limit=1',
  );
  const row = result.ok && Array.isArray(result.data) ? result.data[0] || null : null;
  return publicSnapshotIsValid(row?.snapshot) && clean(row?.rendered_html, 100_000).startsWith('<!doctype html>')
    ? { snapshot: row.snapshot, html: row.rendered_html }
    : null;
}

export function renderMc2ContractDocument(snapshot) {
  if (!publicSnapshotIsValid(snapshot)) return '';
  const reference = escapeHtml(snapshot.document_reference);
  const termsSnapshotUrl = escapeHtml(safeHttpsUrl(snapshot.terms?.snapshot_url));
  const termsUrl = escapeHtml(safeHttpsUrl(snapshot.terms?.current_url));
  const rows = snapshot.schedule.map((item) => `
          <tr>
            <td>${escapeHtml(item.label)}</td>
            <td>${escapeHtml(publicDate(item.due_at))}</td>
            <td>${escapeHtml(money(item.amount_cents))}</td>
            <td>${item.status_at_purchase === 'paid' ? 'Payé' : 'À payer'}</td>
          </tr>`).join('');
  const scheduleNote = snapshot.pricing.payment_plan === MC2_SESSION_ONE_TIME_PLAN
    ? `Le prix total de ${money(snapshot.pricing.total_cents)} est réglé en une fois à la commande.`
    : snapshot.pricing.payment_plan === MC2_SESSION_MONTHLY_PLAN
      ? `La première mensualité de ${money(MC2_SESSION_MONTHLY_PAYMENT_CENTS)} est réglée à la commande. Les onze mensualités suivantes du même montant sont prélevées mensuellement. Le plan s’arrête automatiquement après la douzième mensualité.`
      : 'Les quatre échéances de 297 € sont prévues à J+14, J+35, J+56 et J+77 à compter du paiement initial. Le plan s’arrête après la quatrième échéance.';
  const guaranteeNote = snapshot.commercial_guarantee?.name === 'Garantie Manifestation'
    ? `Garantie Manifestation valable jusqu’au ${publicDate(snapshot.commercial_guarantee.deadline_at)} et droits légaux applicables : la seule condition d’éligibilité est de terminer l’intégralité de la formation principale. Les modalités complètes figurent dans la copie archivée des CGV applicable à cette commande.`
    : 'Garantie commerciale de 14 jours et droits légaux applicables : les conditions, les modalités et le formulaire figurent dans la copie archivée des CGV applicable à cette commande.';
  const controls = `
      <nav class="actions" aria-label="Actions sur le document">
        <button type="button" onclick="window.print()">Imprimer / enregistrer en PDF</button>
        <a href="?download=1" download>Télécharger une copie HTML</a>
      </nav>`;

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>Confirmation de commande ${reference}</title>
  <style>
    :root { color-scheme: light; font-family: Arial, Helvetica, sans-serif; color: #20242a; background: #f2f3f5; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px 16px; font-size: 14px; line-height: 1.55; }
    main { max-width: 820px; margin: 0 auto; padding: 44px 48px; background: #fff; border: 1px solid #d8dbe0; }
    h1 { margin: 0 0 8px; font-size: 25px; font-weight: 650; }
    h2 { margin: 32px 0 12px; padding-bottom: 7px; border-bottom: 1px solid #d8dbe0; font-size: 16px; }
    h3 { margin: 20px 0 8px; font-size: 14px; }
    p { margin: 8px 0; }
    .meta { color: #5c626b; }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); margin: 18px 0; border: 1px solid #d8dbe0; }
    .summary div { padding: 14px; border-right: 1px solid #d8dbe0; }
    .summary div:last-child { border-right: 0; }
    .summary span { display: block; color: #646a73; font-size: 12px; }
    .summary strong { display: block; margin-top: 3px; font-size: 17px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 8px; border-bottom: 1px solid #dfe1e5; text-align: left; }
    th { background: #f5f6f7; font-size: 12px; }
    .note { padding: 14px 16px; border: 1px solid #d8dbe0; background: #f8f9fa; }
    a { color: #243d64; }
    .actions { display: flex; gap: 10px; margin: 0 auto 18px; max-width: 820px; }
    .actions a, .actions button { appearance: none; padding: 9px 12px; border: 1px solid #aeb3bb; background: #fff; color: #20242a; font: inherit; text-decoration: none; cursor: pointer; }
    footer { margin-top: 34px; color: #5c626b; font-size: 12px; }
    @media (max-width: 640px) { body { padding: 12px; } main { padding: 26px 20px; } .summary { grid-template-columns: 1fr; } .summary div { border-right: 0; border-bottom: 1px solid #d8dbe0; } .summary div:last-child { border-bottom: 0; } .actions { flex-direction: column; } }
    @media print { @page { margin: 16mm; } body { padding: 0; background: #fff; } main { max-width: none; padding: 0; border: 0; } .actions { display: none; } a { color: inherit; text-decoration: none; } }
  </style>
</head>
<body>
  ${controls}
  <main>
    <header>
      <h1>Confirmation de commande</h1>
      <p class="meta">Référence : ${reference}<br>Date de commande : ${escapeHtml(publicDate(snapshot.purchased_at))}</p>
    </header>

    <h2>Récapitulatif</h2>
    <p><strong>${escapeHtml(snapshot.product.name)}</strong><br>${escapeHtml(snapshot.product.purchase_type)}, sans abonnement ni renouvellement.</p>
    <div class="summary">
      <div><span>Prix total TTC</span><strong>${escapeHtml(money(snapshot.pricing.total_cents))}</strong></div>
      <div><span>Payé à la commande</span><strong>${escapeHtml(money(snapshot.pricing.paid_at_purchase_cents))}</strong></div>
      <div><span>Solde selon l’échéancier</span><strong>${escapeHtml(money(snapshot.pricing.remaining_scheduled_cents))}</strong></div>
    </div>

    <h2>Échéancier contractuel</h2>
    <table>
      <thead><tr><th>Opération</th><th>Date</th><th>Montant TTC</th><th>Situation à la commande</th></tr></thead>
      <tbody>${rows}
      </tbody>
    </table>
    <p class="note">${escapeHtml(scheduleNote)}</p>

    <h2>Conditions contractuelles</h2>
    <p>Version applicable : <strong>${escapeHtml(snapshot.terms.version)}</strong></p>
    <p><a href="${termsSnapshotUrl}" rel="noopener noreferrer">Consulter la copie archivée des CGV applicables à cette commande</a><br>
    <a href="${termsUrl}" rel="noopener noreferrer">Consulter les CGV actuellement en vigueur</a></p>
    <p class="meta">Empreinte SHA-256 de la copie archivée : ${escapeHtml(snapshot.terms.snapshot_sha256)}</p>
    <p class="note"><strong>${escapeHtml(guaranteeNote)}</strong></p>

    <h2>Vendeur</h2>
    <p><strong>${escapeHtml(snapshot.seller.legal_name)}</strong><br>
    ${escapeHtml(snapshot.seller.address)}<br>
    Registre du commerce : ${escapeHtml(snapshot.seller.commercial_register_number)}<br>
    Contact : <a href="mailto:${escapeHtml(snapshot.seller.support_email)}">${escapeHtml(snapshot.seller.support_email)}</a></p>

    <footer>Ce document a été figé au moment de la confirmation du paiement initial. Conservez le lien personnel reçu par email ou téléchargez cette copie.</footer>
  </main>
</body>
</html>`;
}
