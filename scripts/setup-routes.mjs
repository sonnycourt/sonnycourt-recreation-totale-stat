import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

// Structure de routage souhaitée
const routeMapping = {
  // Pages principales (depuis Page-site/)
  'src/pages/Page-site/index.astro': 'src/pages/index.astro',
  'src/pages/Page-site/formations.astro': 'src/pages/formations.astro',
  'src/pages/Page-site/contact.astro': 'src/pages/contact.astro',
  'src/pages/Page-site/blog.astro': 'src/pages/blog.astro',
  'src/pages/Page-site/ressources-gratuites.astro': 'src/pages/ressources-gratuites.astro',
  'src/pages/Page-site/conditions-utilisation.astro': 'src/pages/conditions-utilisation.astro',
  'src/pages/Page-site/confidentialite.astro': 'src/pages/confidentialite.astro',
  'src/pages/Page-site/mentions-legales.astro': 'src/pages/mentions-legales.astro',
  'src/pages/Page-site/404.astro': 'src/pages/404.astro',
  
  // Formations (depuis les dossiers spécialisés)
  'src/pages/ChallengeT-formation/challenge-transformation.astro': 'src/pages/challenge-transformation.astro',
  'src/pages/Manifest-formation/manifest.astro': 'src/pages/manifest.astro',
  'src/pages/Manifest-formation/access-manifest.astro': 'src/pages/access-ssr.astro',
  'src/pages/Manifest-formation/video-gratuite-manifest.astro': 'src/pages/video-gratuite-manifest.astro',
  'src/pages/NeuroIA-formation/neuro-ia.astro': 'src/pages/neuro-ia.astro',
  'src/pages/SSR-formation/ssr.astro': 'src/pages/ssr.astro',
  'src/pages/SSR-formation/ssr-offre-flash.astro': 'src/pages/ssr-offre-flash.astro',
  'src/pages/SSR-formation/systeme-souhaits-realises-video.astro': 'src/pages/systeme-souhaits-realises-video.astro',
  'src/pages/SSR-formation/systeme-souhaits-realises.astro': 'src/pages/systeme-souhaits-realises.astro',
};

console.log('🚀 Configuration des routes Astro...\n');

// Créer les liens symboliques (ou copier les fichiers)
for (const [source, destination] of Object.entries(routeMapping)) {
  const sourcePath = path.join(projectRoot, source);
  const destPath = path.join(projectRoot, destination);
  
  // Créer le dossier de destination si nécessaire
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  
  if (fs.existsSync(sourcePath)) {
    // Supprimer la destination si elle existe déjà
    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
    }
    
    // Créer un lien symbolique (ou copier selon le système)
    try {
      fs.symlinkSync(path.relative(path.dirname(destPath), sourcePath), destPath);
      console.log(`✅ ${source} → ${destination}`);
    } catch (error) {
      // Si les liens symboliques ne marchent pas, copier le fichier
      fs.copyFileSync(sourcePath, destPath);
      console.log(`📋 ${source} → ${destination} (copié)`);
    }
  } else {
    console.log(`❌ Fichier source non trouvé: ${source}`);
  }
}

console.log('\n🎉 Configuration terminée !');
console.log('💡 Vos fichiers restent organisés dans leurs dossiers d\'origine');
console.log('🌐 Astro peut maintenant les trouver pour le routage');
