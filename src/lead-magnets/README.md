# Lead magnets — base Astro

Chaque reel peut avoir son propre PDF et sa propre page de capture, avec
uniquement prénom et email. Les contenus seront définis à réception du reel.

## Organisation

- `src/lead-magnets/entries/` : une configuration par ressource (`<slug>.ts`).
- `src/lead-magnets/types.ts` : format commun de ces configurations.
- `src/lead-magnets/catalog.ts` : catalogue explicite des ressources.
- `src/components/lead-magnets/` : futurs composants partagés (opt-in, confirmation).
- `src/pages/ressources/` : futures pages Astro ; URL proposée `/ressources/<slug>/`.
- `public/downloads/lead-magnets/` : uniquement les PDF finaux validés.

Le dossier public est accessible sans authentification une fois déployé : les
sources et PDF en brouillon doivent rester hors de ce dossier.

## Ajouter une ressource

1. Choisir un slug stable en minuscules, avec tirets.
2. Créer une entrée typée `LeadMagnet` dans `entries/`, en statut `draft`.
3. Préparer le PDF et les textes à partir du reel, puis faire valider l'ensemble.
4. Construire la page mobile-first : prénom, email, information claire sur
   l'inscription à la liste et lien de confidentialité ; pas de téléphone.
5. Brancher l'inscription côté serveur à **MailerLite uniquement**, en conservant
   l'identifiant de la ressource et l'origine du trafic. Ne pas exposer de clé
   ni réabonner automatiquement un contact désinscrit.
6. Préparer, sans l'activer, le suivi Delta Vision à **J+2 (48 h)**. Sonny choisit
   le message pour chaque ressource et valide chaque email avant activation.
   Prévoir la déduplication des inscriptions/envois et le respect des désinscriptions.
7. Tester le parcours avant toute publication via le sas habituel du projet.

## État actuel

Première page : `/ressources/papa/`, configuration dans `entries/papa.ts`.
Groupe MailerLite créé : `Lead Magnet — Papa, raconte-moi`, ID `202390291667223625`.
PDF final fourni par Sonny et hébergé sans modification le 26 octobre 2026 :
`/downloads/lead-magnets/10-questions-a-poser-a-ton-pere.pdf`.

Publication de la capture autorisée par Sonny le 26 octobre 2026, avant la mise
en place de la livraison : Sonny prépare lui-même le PDF, l'email et l'automation
MailerLite. Aucun email ni suivi J+2 activé par le code ; aucune modification Supabase.
Le message de confirmation « PDF envoyé » est le texte final validé par Sonny,
pas un accusé technique d'envoi : l'API confirme uniquement l'inscription au groupe.

Le formulaire utilise `/.netlify/functions/lead-magnet-register`. La fonction
reste fermée tant que `LEAD_MAGNET_PAPA_ENABLED=true` n'est pas défini côté serveur,
avec `MAILERLITE_API_KEY` et `MAILERLITE_GROUP_LEAD_MAGNET_PAPA`.
Elle ajoute le contact au groupe sans remplacer ses groupes ni le réabonner.

Prévisualisation : Astro sur 4463, puis `node scripts/preview-lead-magnet.mjs --live`
pour servir la page sur 4474 avec capture MailerLite réelle (clé en mémoire).
Sans `--live`, la capture reste désactivée en l'absence des variables ci-dessus.
Ne pas soumettre un contact réel pour tester sans autorisation. Tests simulés :
`node scripts/lead-magnet-smoke.mjs`.

Production : configurer `LEAD_MAGNET_PAPA_ENABLED=true` et
`MAILERLITE_GROUP_LEAD_MAGNET_PAPA=202390291667223625` dans le contexte production,
scope functions, puis déployer par le sas habituel. La clé MailerLite est existante.
Sonny active séparément la livraison sur l'entrée dans ce groupe. Aucun envoi J+2 implicite.

Exemple de future entrée (ne pas publier ce texte d'exemple) :

```ts
import type { LeadMagnet } from '../types';

export default {
  slug: 'a-definir',
  status: 'draft',
  title: 'À définir avec le reel',
  description: '',
  benefits: [],
  ctaLabel: 'Je reçois le guide',
  pdfPath: null,
  mailerLiteGroupId: null,
  deltaVisionFollowUp: {
    status: 'draft',
    delayHours: 48,
    messageKey: null,
  },
} satisfies LeadMagnet;
```
