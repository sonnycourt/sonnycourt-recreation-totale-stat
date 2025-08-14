/*
  Cookie Consent Controller
  - Persiste le consentement dans un cookie `cookieConsent` (12 mois)
  - Active les scripts différés ayant `type="text/plain"` et `data-cookie-category`
  - Catégories supportées: statistics, marketing (necessary est implicite)
*/
(function () {
  function init() {
  const COOKIE_NAME = 'cookieConsent';
  const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 12 mois en secondes

  const banner = document.getElementById('cookieBanner');
  const modal = document.getElementById('cookieModal');
  if (!banner) return;

  // Vérifier si l'utilisateur a déjà donné son consentement
  const existingConsent = getCookie(COOKIE_NAME);
  if (existingConsent) {
    try {
      const consent = parseConsent(existingConsent);
      if (consent && consent.timestamp) {
        // Appliquer le consentement existant et ne pas afficher la bannière
        applyConsent(consent);
        // Appeler les hooks Consent Mode si nécessaire
        if (consent.statistics && window.__consent && typeof window.__consent.accept === 'function') {
          window.__consent.accept();
        } else if (!consent.statistics && window.__consent && typeof window.__consent.refuse === 'function') {
          window.__consent.refuse();
        }
        // Masquer la bannière et sortir
        hideBanner();
        return; // Sortir de la fonction, ne pas afficher la bannière
      }
    } catch (e) {
      // En cas d'erreur de parsing, continuer et afficher la bannière
      console.warn('Erreur parsing consentement existant:', e);
    }
  }

  const acceptAllBtn = document.getElementById('acceptAllCookies');
  const openPrefsBtn = document.getElementById('openPreferences');
  const closePrefsBtn = document.getElementById('closePreferences');
  const modalOverlay = document.getElementById('cookieModalOverlay');
  const toggleStatistics = document.getElementById('toggleStatistics');
  const toggleMarketing = document.getElementById('toggleMarketing');
  const declineBtn = document.getElementById('declineNonEssential');
  const saveBtn = document.getElementById('savePreferences');
  const acceptAllInModalBtn = document.getElementById('acceptAllInModal');

  function setCookie(name, value, maxAgeSeconds) {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
  }

  function getCookie(name) {
    return document.cookie
      .split('; ')
      .find((row) => row.startsWith(name + '='))
      ?.split('=')[1];
  }

  function parseConsent(value) {
    try {
      return JSON.parse(decodeURIComponent(value));
    } catch {
      return null;
    }
  }

  function storeConsent(consent) {
    setCookie(COOKIE_NAME, JSON.stringify(consent), COOKIE_MAX_AGE);
  }

  function sendAnalyticsEvent(eventName, params = {}) {
    try {
      // gtag direct (si GA4 est injecté directement)
      if (typeof window.gtag === 'function') {
        window.gtag('event', eventName, params);
        return true;
      }
      // GTM / dataLayer (si GTM est injecté)
      if (Array.isArray(window.dataLayer)) {
        window.dataLayer.push({ event: eventName, ...params });
        return true;
      }
    } catch (_) {
      // ignore
    }
    return false;
  }

  function applyConsent(consent) {
    // Débloquer les scripts différés compatibles
    const scripts = document.querySelectorAll('script[type="text/plain"][data-cookie-category]');
    scripts.forEach((script) => {
      const category = script.getAttribute('data-cookie-category');
      const allowed = category === 'necessary' || !!consent[category];
      if (allowed) {
        const el = document.createElement('script');
        // Copie des attributs utiles
        Array.from(script.attributes).forEach((attr) => {
          if (attr.name === 'type') return;
          if (attr.name === 'data-cookie-category') return;
          el.setAttribute(attr.name, attr.value);
        });
        el.type = 'text/javascript';
        if (script.textContent) el.textContent = script.textContent;
        script.replaceWith(el);
      }
    });
  }

  function showBanner() {
    banner.hidden = false;
    banner.setAttribute('aria-hidden', 'false');
    banner.style.display = '';
  }

  function hideBanner() {
    banner.hidden = true;
    banner.setAttribute('aria-hidden', 'true');
    banner.style.display = 'none';
  }

  function openModal() {
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  // Si on arrive ici, c'est qu'aucun consentement existant valide n'a été trouvé
  // On montre la bannière pour obtenir un choix
  showBanner();

  // Listeners
  if (acceptAllBtn) {
    acceptAllBtn.addEventListener('click', () => {
      const consent = { necessary: true, statistics: true, marketing: true, timestamp: Date.now() };
      storeConsent(consent);
      applyConsent(consent);
      // Consent Mode hooks
      if (window.__consent && typeof window.__consent.accept === 'function') {
        window.__consent.accept();
      }
      // Notifier GA4 (après consentement)
      // dataLayer existe dès l'init GTM, donc on peut pousser immédiatement
      sendAnalyticsEvent('cookie_accept', { method: 'accept_all' });
      hideBanner();
      closeModal();
    });
  }
  // Fallback: délégation d'événement au cas où le bouton serait recréé
  banner.addEventListener('click', (e) => {
    const target = e.target;
    if (target && target.id === 'acceptAllCookies') {
      const consent = { necessary: true, statistics: true, marketing: true, timestamp: Date.now() };
      storeConsent(consent);
      applyConsent(consent);
      sendAnalyticsEvent('cookie_accept', { method: 'accept_all_delegate' });
      hideBanner();
      closeModal();
    }
  });

  if (openPrefsBtn) openPrefsBtn.addEventListener('click', openModal);
  if (closePrefsBtn) closePrefsBtn.addEventListener('click', closeModal);
  if (modalOverlay) modalOverlay.addEventListener('click', closeModal);

  if (declineBtn) {
    declineBtn.addEventListener('click', () => {
      const consent = { necessary: true, statistics: false, marketing: false, timestamp: Date.now() };
      storeConsent(consent);
      applyConsent(consent);
      if (window.__consent && typeof window.__consent.refuse === 'function') {
        window.__consent.refuse();
      }
      // Pas de GA avant consentement: on tente uniquement si un conteneur existe déjà (ne s'enverra pas sinon)
      sendAnalyticsEvent('cookie_refuse', { method: 'decline_all' });
      hideBanner();
      closeModal();
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const consent = {
        necessary: true,
        statistics: !!(toggleStatistics && toggleStatistics.checked),
        marketing: !!(toggleMarketing && toggleMarketing.checked),
        timestamp: Date.now(),
      };
      storeConsent(consent);
      applyConsent(consent);
      if (consent.statistics) {
        window.__consent && typeof window.__consent.accept === 'function' && window.__consent.accept();
      } else {
        window.__consent && typeof window.__consent.refuse === 'function' && window.__consent.refuse();
      }
      // Evénements selon la case Statistiques
      if (consent.statistics) {
        sendAnalyticsEvent('cookie_accept', { method: 'preferences' });
      } else {
        sendAnalyticsEvent('cookie_refuse', { method: 'preferences' });
      }
      hideBanner();
      closeModal();
    });
  }

  if (acceptAllInModalBtn) {
    acceptAllInModalBtn.addEventListener('click', () => {
      const consent = { necessary: true, statistics: true, marketing: true, timestamp: Date.now() };
      storeConsent(consent);
      applyConsent(consent);
      if (window.__consent && typeof window.__consent.accept === 'function') {
        window.__consent.accept();
      }
      sendAnalyticsEvent('cookie_accept', { method: 'accept_all_modal' });
      hideBanner();
      closeModal();
    });
  }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();


