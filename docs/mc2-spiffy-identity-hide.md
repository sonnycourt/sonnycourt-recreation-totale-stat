# Spiffy 40006 / 40007 — identité préremplie

Correctif appliqué le 26 septembre 2026 dans le Custom Tracking Code des deux
checkouts, dans `mc2-current-checkout-bridge`, après vérification de l'égalité
entre le prénom/email natifs et les paramètres transmis par MC2.

Le masquage inline de la section était perdu lors du rendu Spiffy. Il est
remplacé par une feuille de style persistante ajoutée uniquement si `ok` :

```js
if (ok) {
  var css = document.createElement('style');
  css.id = 'mc2-prefilled-identity-hidden';
  css.textContent = [first, email].map(function (el) {
    var section = el.closest('.section.block');
    return section && /^[a-zA-Z0-9_-]+$/.test(section.id)
      ? '#' + section.id + '#' + section.id + '{display:none!important}' : '';
  }).join('');
  document.head.appendChild(css);
}
```

Les champs natifs ne sont ni supprimés ni désactivés. Le pont existant limite
l'exécution au checkout intégré MC2 avec origine parent autorisée. Le checkout
autonome et un préremplissage manquant conservent les champs visibles.
Aucun paiement de test effectué, aucun déploiement du site.
