// Netlify: exit 0 from an ignore command means “cancel this Git build”.
// Production is published only by scripts/safe-deploy.mjs.
console.log(
  'Déploiement Git automatique bloqué : utilise npm run deploy:preview ou npm run deploy:production.',
);
process.exit(0);
