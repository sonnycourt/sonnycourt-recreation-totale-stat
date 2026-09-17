import { timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { supabaseGet } from './supabase-rest.mjs';

export const ROMAIN_CREDENTIAL_MARKER='managed-readable:romain:22';
export function isRomainAccount(row) {
  return Number(row?.id)===22 && String(row?.email||'').toLowerCase()==='2romainorfila@gmail.com';
}

// Exception nominative choisie par le propriétaire. Aucun autre compte ne change.
// Ne jamais retourner la ligne / le mot de passe au navigateur ni dans un log.
export async function verifyCloserPassword(row,password,get=supabaseGet) {
  if(typeof password!=='string' || password.length>256) return false;
  if(isRomainAccount(row)) {
    const result=await get('closer_readable_credentials?closer_id=eq.22&select=closer_id,email,password_plaintext,active');
    if(!result.ok) {
      // Déploiement avant migration : seule l'absence connue de table permet l'ancien accès.
      const missing=['PGRST205','42P01'].includes(result.error?.code);
      if(!missing || row.password_hash===ROMAIN_CREDENTIAL_MARKER) throw new Error('credentials_unavailable');
    } else {
      const credential=result.data?.[0];
      if(credential?.active) {
        if(!isRomainAccount({id:credential.closer_id,email:credential.email}) || typeof credential.password_plaintext!=='string' || credential.password_plaintext.length<20) throw new Error('credentials_unavailable');
        const expected=Buffer.from(credential.password_plaintext,'utf8');
        const candidate=Buffer.from(password,'utf8');
        return expected.length===candidate.length && timingSafeEqual(expected,candidate);
      }
      if(row.password_hash===ROMAIN_CREDENTIAL_MARKER) throw new Error('credentials_unavailable');
    }
  }
  // Aucun basculement en clair pour les autres comptes ; parcours existant inchangé.
  const hash=row?.password_hash || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  return Boolean(await bcrypt.compare(password,hash));
}
