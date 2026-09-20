# WhatsApp après achat

Deux événements internes dans `mc2_funnel_events`, sans nouvelle table :

- `success_whatsapp_button_clicked` : premier clic observé sur le bouton par inscription.
- `success_whatsapp_qr_opened` : première ouverture du lien QR personnalisé par inscription.

Le chargement/affichage du QR ne produit aucun événement. Les répétitions sont dédupliquées par inscription et canal. La date est celle du serveur. Aucun événement Meta, aucun message envoyé, aucune modification du dossier onboarding ou du paiement.

**Ces signaux ne prouvent jamais l'envoi ou la réception du message.** La confirmation manuelle de Romain reste indépendante. Une ouverture de lien QR n'est pas une preuve absolue de scan : les previews connues sont exclues, mais un lien partagé ou un lecteur non identifiable reste possible. L'absence d'événement n'est pas une preuve d'absence d'action (ancien QR, tracking bloqué, identité absente, panne).

La confirmation `/commencer/succes/` transmet le token via le fragment de la redirection, jamais à WhatsApp. Le QR contient une référence chiffrée et authentifiée, valable 30 jours ; elle ne permet que d'enregistrer l'ouverture QR. Rotation de la clé serveur : anciens liens continuent d'ouvrir WhatsApp, sans attribution. Aucun service tiers ne génère les QR.

Le bouton conserve son lien WhatsApp direct. Le QR statique reste visible jusqu'au chargement du QR personnalisé. Le redirecteur QR continue vers WhatsApp même si l'écriture échoue ; attente Supabase bornée à 1,2 seconde. Les pages preview/demo ne font pas d'appels. Les tests ne contactent aucun service réel.

Lecture des élèves concernés (ne pas exposer les tokens dans les exports) :

```sql
select r.email,
  min(e.occurred_at) filter (where e.event_name = 'success_whatsapp_button_clicked') as bouton_clique_le,
  min(e.occurred_at) filter (where e.event_name = 'success_whatsapp_qr_opened') as lien_qr_ouvert_le
from public.mc2_funnel_events e
join public.mc2_registrations r on r.token = e.token
where e.event_name in ('success_whatsapp_button_clicked', 'success_whatsapp_qr_opened')
group by r.email
order by min(e.occurred_at) desc;
```

Vérification : `npm run test:mc2-whatsapp`, `npm run test:mc2-tracking-v2`, `node scripts/mc2-draftx-post-purchase-smoke.mjs`, `npm run build`.
