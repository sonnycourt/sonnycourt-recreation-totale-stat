/*
 * ES2 / MC2 — adaptation fonctionnelle du checkout Spiffy intégré.
 * À placer dans le Custom Tracking / Custom Code des DEUX copies MC2.
 * Le plan est transmis par la page hôte avec ?es2_plan=monthly|once.
 */
(function () {
  'use strict';

  var plan = new URLSearchParams(window.location.search).get('es2_plan') === 'once'
    ? 'once'
    : 'monthly';

  var REQUIRED_FIELDS_MESSAGE = "Make sure you've filled in all required fields correctly";

  function validationMessage(cardInvalid, termsInvalid) {
    if (cardInvalid) return 'Renseigne ta carte bancaire.';
    if (termsInvalid) return 'Accepte les CGV pour continuer.';
    return '';
  }

  function bindTermsToggle(root, termsInput) {
    var control = termsInput ? termsInput.closest('.custom-control') : null;
    if (!control || control.getAttribute('data-es2-toggle-bound') === 'true') return;
    control.setAttribute('data-es2-toggle-bound', 'true');
    control.setAttribute('data-es2-checked-state', termsInput.checked ? 'true' : 'false');
    control.addEventListener('click', function (event) {
      var link = event.target && event.target.closest ? event.target.closest('a') : null;
      if (link) return;
      var nextChecked = control.getAttribute('data-es2-checked-state') !== 'true';
      event.preventDefault();
      window.setTimeout(function () {
        termsInput.checked = nextChecked;
        control.setAttribute('data-es2-checked-state', nextChecked ? 'true' : 'false');
        termsInput.dispatchEvent(new Event('input', { bubbles: true }));
        termsInput.dispatchEvent(new Event('change', { bubbles: true }));
      }, 0);
    }, true);
  }

  function syncValidationFeedback(root, shouldScroll) {
    var stripeMethod = root.querySelector('.payment-type--stripe.payment-type--selected');
    var stripeField = root.querySelector('.StripeElement');
    var termsInput = root.querySelector('.terms .custom-control-input');
    var termsSection = termsInput ? termsInput.closest('.section.block') : null;
    var feedback = root.querySelector('[data-es2-validation-feedback="true"]');
    var validationActive = root.getAttribute('data-es2-validation-active') === 'true';

    if (!feedback && stripeField) {
      feedback = document.createElement('p');
      feedback.className = 'es2-inline-validation-feedback';
      feedback.setAttribute('data-es2-validation-feedback', 'true');
      feedback.setAttribute('role', 'alert');
      feedback.setAttribute('aria-live', 'polite');
      stripeField.insertAdjacentElement('afterend', feedback);
    }

    var cardInvalid = Boolean(
      validationActive
      && stripeMethod
      && stripeField
      && !stripeField.classList.contains('StripeElement--complete')
    );
    var termsInvalid = Boolean(validationActive && termsInput && !termsInput.checked);
    var message = validationMessage(cardInvalid, termsInvalid);

    if (stripeField) {
      if (cardInvalid) stripeField.setAttribute('data-es2-attention', 'true');
      else stripeField.removeAttribute('data-es2-attention');
    }
    if (termsSection) {
      if (termsInvalid) termsSection.setAttribute('data-es2-attention', 'true');
      else termsSection.removeAttribute('data-es2-attention');
    }
    if (feedback && feedback.textContent !== message) feedback.textContent = message;

    if (!message) root.removeAttribute('data-es2-validation-active');

    if (shouldScroll && message) {
      var target = cardInvalid ? stripeField : termsSection;
      if (target) {
        window.setTimeout(function () {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          window.parent.postMessage({ type: 'es2:spiffy-validation-focus' }, '*');
        }, 20);
      }
    }
  }

  function translateNativeValidation(root) {
    Array.prototype.forEach.call(document.querySelectorAll('[role="alert"]'), function (alert) {
      var text = (alert.textContent || '').replace(/×/g, '').trim();
      if (text !== REQUIRED_FIELDS_MESSAGE) return;
      var messageNode = Array.prototype.slice.call(alert.querySelectorAll('span')).find(function (node) {
        return (node.textContent || '').trim() === REQUIRED_FIELDS_MESSAGE;
      });
      if (messageNode) messageNode.textContent = 'Vérifie les informations demandées pour continuer.';
      alert.setAttribute('data-es2-native-validation', 'true');
      root.setAttribute('data-es2-validation-active', 'true');
      syncValidationFeedback(root, false);
    });
  }

  function bindValidationExperience(root) {
    var checkoutButton = root.querySelector('.btn--checkout');
    if (checkoutButton && checkoutButton.getAttribute('data-es2-validation-bound') !== 'true') {
      checkoutButton.setAttribute('data-es2-validation-bound', 'true');
      checkoutButton.addEventListener('click', function () {
        root.setAttribute('data-es2-validation-active', 'true');
        window.setTimeout(function () {
          syncValidationFeedback(root, true);
          translateNativeValidation(root);
        }, 40);
      });
    }

    var termsInput = root.querySelector('.terms .custom-control-input');
    if (termsInput && termsInput.getAttribute('data-es2-validation-bound') !== 'true') {
      termsInput.setAttribute('data-es2-validation-bound', 'true');
      termsInput.addEventListener('change', function () {
        syncValidationFeedback(root, false);
      });
    }
    bindTermsToggle(root, termsInput);

    translateNativeValidation(root);
    if (root.getAttribute('data-es2-validation-active') === 'true') {
      syncValidationFeedback(root, false);
    }
  }

  function applyInlineExperience() {
    var root = document.querySelector('.checkout');
    if (!root) return false;
    root.setAttribute('data-es2-inline', 'true');
    document.documentElement.setAttribute('data-es2-inline', 'true');

    var checkoutForm = root.querySelector('.checkout-form');
    var checkoutRow = checkoutForm ? checkoutForm.parentElement : null;
    if (checkoutRow) {
      checkoutRow.style.setProperty('width', '100%', 'important');
      checkoutRow.style.setProperty('max-width', '100%', 'important');
      checkoutRow.style.setProperty('margin-left', '0', 'important');
      checkoutRow.style.setProperty('margin-right', '0', 'important');
    }

    var cardLabel = root.querySelector('.payment-type--stripe .payment-type__label');
    if (cardLabel && cardLabel.textContent.trim() !== 'Carte bancaire') {
      cardLabel.textContent = 'Carte bancaire';
    }

    var andMore = root.querySelector('.payment-type__and-more');
    if (andMore) andMore.setAttribute('data-es2-hide', 'true');

    Array.prototype.forEach.call(root.querySelectorAll('p, span'), function (node) {
      var text = (node.textContent || '').trim();
      if (text === 'Accès immédiat · Garantie 30 jours · Paiement sécurisé') {
        node.setAttribute('data-es2-hide', 'true');
      }
    });

    var termsSections = Array.prototype.slice.call(root.querySelectorAll('.section.block:has(.terms)'));
    var termsSection = termsSections.length ? termsSections[termsSections.length - 1] : null;
    termsSections.forEach(function (section) {
      if (section === termsSection) section.removeAttribute('data-es2-duplicate-terms');
      else section.setAttribute('data-es2-duplicate-terms', 'true');
    });

    var terms = termsSection ? termsSection.querySelector('.terms .rendered-content') : null;
    if (terms && !terms.querySelector('[data-es2-terms="true"]')) {
      terms.innerHTML = '<p data-es2-terms="true">J’accepte les <a href="https://sonnycourt.com/cgv/" target="_blank" rel="noopener noreferrer nofollow"><u>CGV</u></a> et l’échéancier mentionné ci-dessus.</p>';
    }

    Array.prototype.forEach.call(root.querySelectorAll('[data-es2-schedule]'), function (schedule) {
      schedule.remove();
    });

    var buttonSection = root.querySelector('.section.block:has(.btn--checkout)');
    var paymentSection = root.querySelector('.section.block:has(.payment-gateway)');
    var inlinePlan = root.querySelector('[data-es2-inline-plan="true"]');
    if (!inlinePlan) {
      inlinePlan = document.createElement('div');
      inlinePlan.className = 'es2-inline-plan';
      inlinePlan.setAttribute('data-es2-inline-plan', 'true');
      inlinePlan.innerHTML = plan === 'once'
        ? '<div class="es2-inline-plan__row"><strong>Paiement unique de 1 997 €</strong></div>'
        : '<div class="es2-inline-plan__row"><strong>12 mensualités de 197 €</strong><span>≈ 6 € par jour</span></div>';
    }
    if (paymentSection && paymentSection.nextElementSibling !== inlinePlan) {
      paymentSection.insertAdjacentElement('afterend', inlinePlan);
    }

    var paypal = root.querySelector('.payment-type--paypal');
    if (buttonSection && paypal) {
      paypal.setAttribute('data-es2-paypal-source', 'true');
      var separator = root.querySelector('[data-es2-paypal-separator="true"]');
      if (!separator) {
        separator = document.createElement('p');
        separator.className = 'es2-inline-payment-separator';
        separator.setAttribute('data-es2-paypal-separator', 'true');
        separator.textContent = 'Ou choisir PayPal';
      }
      var paypalProxy = root.querySelector('[data-es2-paypal-proxy="true"]');
      if (!paypalProxy) {
        paypalProxy = document.createElement('button');
        paypalProxy.type = 'button';
        paypalProxy.className = 'es2-inline-paypal-proxy';
        paypalProxy.setAttribute('data-es2-paypal-proxy', 'true');
        paypalProxy.setAttribute('aria-label', 'Payer avec PayPal');
        paypalProxy.innerHTML = '<span><strong>Pay</strong><em>Pal</em></span>';
        paypalProxy.addEventListener('click', function () {
          var source = root.querySelector('[data-es2-paypal-source="true"]');
          if (source) source.click();
          window.setTimeout(function () {
            var checkoutButton = root.querySelector('.btn--checkout');
            if (checkoutButton) checkoutButton.click();
          }, 0);
        });
      }
      if (buttonSection.nextElementSibling !== separator) {
        buttonSection.insertAdjacentElement('afterend', separator);
      }
      if (separator.nextElementSibling !== paypalProxy) {
        separator.insertAdjacentElement('afterend', paypalProxy);
      }
    }

    bindValidationExperience(root);

    return true;
  }

  function reportHeight() {
    var root = document.querySelector('.checkout');
    var height = root
      ? Math.ceil(root.getBoundingClientRect().bottom + 2)
      : Math.ceil(document.body ? document.body.scrollHeight : 0);
    window.parent.postMessage({ type: 'es2:spiffy-height', height: height }, '*');
  }

  function boot() {
    if (!applyInlineExperience()) return;
    reportHeight();
    if ('ResizeObserver' in window) {
      new ResizeObserver(reportHeight).observe(document.documentElement);
    }
    new MutationObserver(function () {
      applyInlineExperience();
      reportHeight();
    }).observe(document.querySelector('.checkout'), {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}());
