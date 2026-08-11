export interface EssaiFormat {
  name: string;
  label: string;
}

export interface EssaiFaq {
  question: string;
  answer: string;
}

export interface Essai {
  slug: string;
  title: string;
  shortTitle: string;
  subtitle: string;
  libraryDescription: string;
  salesDescription: string;
  cover: string;
  price: number;
  year: number;
  pageCount: number;
  chapterCount: number;
  readingTime: string;
  status: 'available' | 'coming-soon';
  formats: EssaiFormat[];
  themes: string[];
  quote: string;
  checkoutUrl: string;
  journey: Array<{
    number: string;
    title: string;
    text: string;
  }>;
  insights: Array<{
    title: string;
    text: string;
  }>;
  faq: EssaiFaq[];
}

export const essais: Essai[] = [
  {
    slug: 'sombre-lumiere',
    title: 'Sombre lumière éclaire mon chemin',
    shortTitle: 'Sombre lumière',
    subtitle: 'Les vérités interdites pour accroître sa puissance par-delà le bien et le mal.',
    libraryDescription:
      'Un essai bref et tranchant sur la puissance, la prédation et les récits moraux qui rendent le monde habitable.',
    salesDescription:
      'Et si le bien et le mal n’étaient pas des lois de l’univers, mais des technologies inventées par les vivants pour organiser leurs puissances ?',
    cover: '/media/essais/sombre-lumiere-cover.webp',
    price: 47,
    year: 2026,
    pageCount: 24,
    chapterCount: 8,
    readingTime: '35 min',
    status: 'available',
    formats: [
      { name: 'PDF', label: 'La mise en page originale' },
      { name: 'EPUB', label: 'Lecture fluide sur liseuse' },
      { name: 'AUDIO', label: 'Le texte à écouter' },
    ],
    themes: ['Puissance', 'Morale', 'Prédation', 'Marketing'],
    quote:
      'Ce texte n’est pas une morale nouvelle. C’est l’anatomie de ce qui précède toute morale.',
    checkoutUrl:
      'mailto:support@sonnycourt.com?subject=Je%20souhaite%20commander%20Sombre%20lumi%C3%A8re&body=Bonjour%2C%0A%0AJe%20souhaite%20commander%20le%20coffret%20num%C3%A9rique%20Sombre%20lumi%C3%A8re%20%C3%A0%2047%20%E2%82%AC.%0A',
    journey: [
      {
        number: '01',
        title: 'La nature sans tribunal',
        text: 'Retirer au réel nos catégories humaines et observer ce qui subsiste lorsqu’aucun juge ne commente la scène.',
      },
      {
        number: '02',
        title: 'La puissance avant la morale',
        text: 'Comprendre la puissance comme la capacité d’élargir le champ du possible — par la force, le récit, l’alliance ou le système.',
      },
      {
        number: '03',
        title: 'La toile et la prédation',
        text: 'Voir comment les architectures invisibles remplacent la contrainte et organisent les choix, jusque dans le marketing.',
      },
      {
        number: '04',
        title: 'La lucidité fonctionnelle',
        text: 'Transformer cette vision en grille de lecture pour les relations, l’entreprise, les valeurs et les flux de pouvoir.',
      },
    ],
    insights: [
      {
        title: 'Voir les architectures',
        text: 'Repérer moins le visage du maître que la toile qui détermine les options entre lesquelles chacun croit choisir.',
      },
      {
        title: 'Séparer mission et métabolisme',
        text: 'Distinguer le récit qui rend une entreprise désirable du mécanisme qui lui permet réellement de survivre.',
      },
      {
        title: 'Comprendre la symbiose',
        text: 'Saisir pourquoi l’alliance et la valeur partagée peuvent être les formes les plus sophistiquées de la puissance.',
      },
      {
        title: 'Donner une force à ses valeurs',
        text: 'Admettre qu’une valeur incapable de se protéger reste une préférence fragile face à ce qui peut effectivement agir.',
      },
    ],
    faq: [
      {
        question: 'Est-ce un livre de développement personnel ?',
        answer:
          'Non. C’est un essai philosophique court et dense. Il ne te donne pas une morale à suivre : il propose une grille pour observer la puissance, les récits et les systèmes avec davantage de lucidité.',
      },
      {
        question: 'Que contient exactement l’édition numérique ?',
        answer:
          'Le coffret réunit le PDF dans sa mise en page originale, une version EPUB adaptée aux liseuses et une version audio intégrale. Tu peux ainsi lire, annoter ou écouter le texte selon le moment.',
      },
      {
        question: 'Le propos fait-il l’éloge de la violence ?',
        answer:
          'Non. L’essai distingue explicitement l’observation du réel de l’approbation morale. Il aborde frontalement la violence, la coercition et la prédation afin d’étudier les puissances qui les rendent possibles ou les empêchent.',
      },
      {
        question: 'À qui s’adresse cet essai ?',
        answer:
          'Aux lecteurs attirés par la philosophie, la psychologie sociale et les rapports de pouvoir — mais aussi aux entrepreneurs et marketeurs qui veulent regarder leur propre pratique sans récit confortable.',
      },
    ],
  },
];

export const availableEssais = essais.filter((essai) => essai.status === 'available');

