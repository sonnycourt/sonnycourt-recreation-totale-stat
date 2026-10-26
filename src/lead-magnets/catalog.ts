import type { LeadMagnet } from './types';
import papa from './entries/papa';

// Importer explicitement ici les futures entrées validées, sans auto-publication.
export const leadMagnets: readonly LeadMagnet[] = [papa];
