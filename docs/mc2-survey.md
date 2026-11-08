# Questionnaire d'attente MC2 — v1

## Périmètre

Affiché sous le guide diagnostic dans `/mc2/session/`, jusqu'à l'heure annoncée
de la session + 5 minutes (pas l'heure de démarrage de la vidéo, qui contient
15 minutes de compte à rebours). Ne bloque ni la participation ni la vidéo.
Aucun événement ou réponse transmis à Meta. Bloc masqué dans Clarity.

## Persistance

SQL : `sql/mc2_survey_responses.sql`, exécuté par Sonny le 8 novembre 2026.
Une ligne par `(registration_id, session_generation, survey_version)`.
La clé étrangère permet de joindre les réponses aux inscrits et à leurs achats,
sans recopier l'email ou le téléphone. Une réinscription crée une autre génération.
Les réponses partielles sont conservées ; `completed_at` est calculé côté base.

API privée de fait par possession du token personnel MC2 :
`POST /.netlify/functions/mc2-survey`, JSON `{token, sessionGeneration,
surveyVersion: 1, action: 'load' | 'save', answers?}`.
Le serveur retrouve l'identité et la session ; aucun ID d'inscrit fourni par
le client n'est accepté comme autorité. Une requête save contient uniquement
les choix modifiés. L'upsert ne doit pas envoyer de null pour les autres champs.
Le token est un secret d'accès : ne pas le journaliser.

| Champ | Valeurs stables dans l'ordre des choix |
| --- | --- |
| priority | finances_work, relationships, confidence_action, stress_balance |
| familiarity | new, some_videos, follower |
| profession | employee, self_employed, transition, student |
| urgency | exploring, urgent |

La situation professionnelle ne représente pas un revenu ou une capacité d'achat.
Conserver ces clés si les textes changent sans modifier le sens.

## Fiabilité et séparation des environnements

- Chaque choix est envoyé immédiatement ; les écritures sont sérialisées.
- Rechargement : restauration côté serveur avant de rendre les choix actifs.
- Réseau : délai de 8 secondes, 3 réessais, puis bouton Réessayer.
- Pas de cache local persistant de réponses ou de données personnelles.
- Les erreurs restent dans le quiz, sans bloquer le lecteur vidéo.
- Inscrits de test, inscription non finalisée et paiement d'entrée requis mais
  absent : rejet sans écriture.
- Génération différente : 409. Après session + 5 minutes : save rejeté 410.
- En preview visuelle : aucune requête quiz. API désactivée hors
  `CONTEXT=production`, même si une requête est forgée.
- En cas de changement de génération entre lecture serveur et écriture,
  la clé de l'ancienne génération isole cette réponse de la nouvelle session.

## Vérification

`npm run test:mc2-survey` utilise exclusivement des appels HTTP simulés et une
base PostgreSQL locale éphémère. Aucune écriture Supabase ou événement Meta.
Le parcours visuel a été testé en preview jusqu'à la confirmation finale.
L'enregistrement réel de bout en bout en production n'a pas été exécuté.

Build et tests participation, tracking v2, Meta, replay et pay-router : OK.
Les tests checkout Spiffy passent jusqu'au test du webhook d'achat, bloqué
par la dépendance locale manquante `libphonenumber-js` (déjà absente avant ce travail).

Ce travail est local et non déployé. Publication via le sas habituel uniquement,
après validation de Sonny et fusion sur main propre synchronisé avec origin/main.
