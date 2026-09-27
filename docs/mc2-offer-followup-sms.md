# Rappel SMS H+2 après exposition à l'offre

État : préparé localement, désactivé par défaut. Aucun envoi réel ni déploiement effectué pour ce changement.

## Texte à relire et valider par Sonny

```text
Es-tu prêt à commencer ta transformation ?
Si oui, rejoins Esprit Subconscient 2.0 ici :
[lien personnel vers l'offre]
```

Le lien utilise exactement le mécanisme du SMS H-4 : `/offre/{code}`, puis
redirection vers `/mc2/session/?t={token_unique}`. Aucun nouveau token n'est créé.
Un acheteur qui utilise le lien est redirigé vers sa confirmation d'achat existante.

## Déclenchement et exclusions

- Première trace `offer_visible` dans `mc2_tracking_events_v2`, live ou replay.
  Le tracker exige au moins une seconde de visibilité réelle, onglet au premier
  plan, offre affichée et checkout fermé. `offer_available` et `cta_reached`
  ne suffisent pas. Aucun nouveau tracking n'est ajouté.
- Échéance : réception serveur de cette première trace + 2 heures. Le worker
  existant passe chaque minute. Revoir l'offre ne décale pas cette échéance.
- Une seule relance H+2 par inscrit, y compris en cas de nouvelle visite ou de
  reprise du worker. Les jobs envoyés ou abandonnés ne sont pas recréés.
- Consentement SMS, numéro valide, offre non expirée, filtre pays existant
  lorsqu'il est activé, exclusion des tests explicitement marqués.
- Absence d'achat au moment de la mise en file, puis nouvelle vérification
  immédiatement avant l'appel SMS. Le webhook d'achat annule les relances H+2
  et H-4 en attente. Si les preuves nécessaires sont indisponibles : pas d'envoi.
- Fenêtre de retard maximale de 10 minutes. Pas de rattrapage des anciennes
  cohortes. À l'activation, les échéances des 10 dernières minutes restent
  éligibles, même si leur première exposition précède l'activation.
- Une tentative fournisseur déjà commencée n'est pas rejouée, même si son
  résultat est incertain : priorité à l'absence de doublon.

Les textes et horaires des rappels LIVE et H-4 restent inchangés. Aucun changement
aux pages, aux délais d'accès, aux compteurs ou aux séquences email.

## Mise en service, dans cet ordre

1. Sonny exécute `sql/mc2_offer_followup_sms.sql` dans Supabase. SQL réexécutable,
   sans suppression de données ni envoi. Prérequis : schémas SMS et tracking v2.
2. Sonny relit et valide le texte ci-dessus.
3. Fusion explicite sur `main`, tests, synchronisation avec `origin/main`, puis
   déploiement autorisé uniquement via `npm run deploy:production`.
4. Activer explicitement `MC2_OFFER_FOLLOWUP_SMS_ENABLED=true` dans l'environnement
   de production. Le commutateur global `MC2_SMS_ENABLED=true` reste nécessaire.
   Ne pas modifier les autres commutateurs SMS ou le filtre pays.

Pour arrêter uniquement ce rappel, désactiver `MC2_OFFER_FOLLOWUP_SMS_ENABLED`.
Les jobs déjà dus et traités pendant la désactivation sont abandonnés, pas reportés.

## Vérification locale, aucun SMS réel

```bash
npm run test:mc2-sms-followup
npm run test:mc2-sms-h1
npm run test:mc2-sms-country-filter
npm run test:scheduled-responses
npm run test:mc2-tracking-v2
```

Les tests H+2 utilisent des réponses HTTP simulées et PostgreSQL en mémoire.
Ils vérifient notamment l'achat concurrent, l'annulation concurrente, l'absence
d'exposition, les tests, le consentement, le lien personnalisé, la reprise sans
double envoi et l'absence d'impact d'une migration manquante sur l'ancien worker.
