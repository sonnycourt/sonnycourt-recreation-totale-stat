/** Configuration éditoriale uniquement ; aucun envoi ni inscription implicite. */
export interface LeadMagnet {
  slug: string;
  status: 'draft' | 'published';
  title: string;
  description: string;
  benefits: readonly string[];
  ctaLabel: string;
  pdfPath: `/downloads/lead-magnets/${string}.pdf` | null;
  mailerLiteGroupId: string | null;
  deltaVisionFollowUp: {
    // L'activation sera implémentée séparément après validation de Sonny.
    status: 'draft' | 'disabled';
    delayHours: 48;
    /** Référence du message choisi par Sonny pour cette ressource. */
    messageKey: string | null;
  };
}
