type SocialProofSurface = 'sales' | 'checkout';
type SocialProofTrigger = 'sales_scroll_30' | 'sales_pricing' | 'checkout_initial' | 'checkout_followup';

type SocialProofElements = {
  toast: HTMLElement | null;
  flag: HTMLElement | null;
  text: HTMLElement | null;
};

type SocialProofOptions = SocialProofElements & {
  token?: string;
  surface: SocialProofSurface;
  enabled: boolean;
  canShow?: () => boolean;
};

type SocialProofMemory = {
  recentNames: string[];
  totalShown: number;
};

const MEMORY_VERSION = 1;
const MEMORY_PREFIX = 'es2_social_proof_memory_v1_';
const DISPLAY_MS = 4_000;
const QUEUE_GAP_MS = 1_000;

// Activation volontairement séparée du mécanisme : production OFF par défaut.
// Le rendu peut être contrôlé avec ?preview=dev&social_proof=1.
export const ES2_SOCIAL_PROOF_PRODUCTION_ENABLED = true;

const FRENCH_PREVIEW_NAMES = [
  'Pauline',
  'Camille',
  'Julien',
  'Sophie',
  'Nicolas',
  'Élodie',
  'Thomas',
  'Manon',
  'Claire',
  'Antoine',
  'Léa',
  'Maxime',
  'Charlotte',
  'Romain',
  'Amélie',
  'Lucas',
];

function randomInt(min: number, max: number): number {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return low + Math.floor(Math.random() * (high - low + 1));
}

function stableKey(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function memoryKey(token?: string): string {
  return MEMORY_PREFIX + stableKey(String(token || 'anonymous'));
}

function readMemory(token?: string): SocialProofMemory {
  try {
    const raw = localStorage.getItem(memoryKey(token));
    if (!raw) return { recentNames: [], totalShown: 0 };
    const parsed = JSON.parse(raw);
    return {
      recentNames: Array.isArray(parsed?.recentNames)
        ? parsed.recentNames.map(String).filter(Boolean).slice(-12)
        : [],
      totalShown: Math.max(0, Number(parsed?.totalShown) || 0),
    };
  } catch {
    return { recentNames: [], totalShown: 0 };
  }
}

function writeMemory(token: string | undefined, memory: SocialProofMemory): void {
  try {
    localStorage.setItem(memoryKey(token), JSON.stringify({
      version: MEMORY_VERSION,
      recentNames: memory.recentNames.slice(-12),
      totalShown: memory.totalShown,
    }));
  } catch {
    // La preuve sociale reste non bloquante si le stockage est indisponible.
  }
}

function pickName(memory: SocialProofMemory): string {
  const unseen = FRENCH_PREVIEW_NAMES.filter((name) => !memory.recentNames.includes(name));
  const pool = unseen.length ? unseen : FRENCH_PREVIEW_NAMES.filter((name) => name !== memory.recentNames.at(-1));
  const picked = pool[randomInt(0, Math.max(0, pool.length - 1))] || FRENCH_PREVIEW_NAMES[0];
  memory.recentNames.push(picked);
  memory.recentNames = memory.recentNames.slice(-12);
  memory.totalShown += 1;
  return picked;
}

function relativeLabel(trigger: SocialProofTrigger): string {
  if (trigger === 'sales_pricing' || trigger === 'checkout_followup') {
    const minutes = randomInt(1, 3);
    return `il y a ${minutes} minute${minutes > 1 ? 's' : ''}`;
  }
  return `il y a ${randomInt(18, 54)} secondes`;
}

function renderToast(elements: SocialProofElements, name: string, relative: string): void {
  const { toast, flag, text } = elements;
  if (!toast || !flag || !text) return;

  flag.textContent = '🇫🇷';
  text.textContent = '';

  const nameEl = document.createElement('span');
  nameEl.className = 'purchase-toast__name';
  nameEl.textContent = name;

  const actionEl = document.createElement('span');
  actionEl.className = 'purchase-toast__action';
  actionEl.textContent = ' vient de rejoindre ES2';

  const relativeEl = document.createElement('span');
  relativeEl.className = 'purchase-toast__course';
  relativeEl.textContent = relative;

  text.append(nameEl, actionEl, document.createElement('br'), relativeEl);
  toast.style.display = '';
  toast.removeAttribute('hidden');
  toast.setAttribute('aria-hidden', 'false');
  toast.classList.add('show');
}

function createController(options: SocialProofOptions) {
  const elements: SocialProofElements = { toast: options.toast, flag: options.flag, text: options.text };
  const memory = readMemory(options.token);
  const seenTriggers = new Set<SocialProofTrigger>();
  const queue: SocialProofTrigger[] = [];
  const timers = new Set<number>();
  let busy = false;
  let destroyed = false;

  function setTimer(callback: () => void, delayMs: number): number {
    const id = window.setTimeout(() => {
      timers.delete(id);
      callback();
    }, delayMs);
    timers.add(id);
    return id;
  }

  function flush(): void {
    if (destroyed || busy) return;
    const trigger = queue.shift();
    if (!trigger) return;
    if (options.canShow && !options.canShow()) {
      setTimer(flush, 1_000);
      queue.unshift(trigger);
      return;
    }

    busy = true;
    const name = pickName(memory);
    writeMemory(options.token, memory);
    renderToast(elements, name, relativeLabel(trigger));

    setTimer(() => {
      elements.toast?.classList.remove('show');
      elements.toast?.setAttribute('aria-hidden', 'true');
      setTimer(() => {
        busy = false;
        flush();
      }, QUEUE_GAP_MS);
    }, DISPLAY_MS);
  }

  function trigger(triggerName: SocialProofTrigger): void {
    if (destroyed || !options.enabled || seenTriggers.has(triggerName)) return;
    seenTriggers.add(triggerName);
    queue.push(triggerName);
    flush();
  }

  function schedule(triggerName: SocialProofTrigger, delayMs: number): void {
    if (!options.enabled) return;
    setTimer(() => trigger(triggerName), delayMs);
  }

  function destroy(): void {
    destroyed = true;
    timers.forEach((id) => window.clearTimeout(id));
    timers.clear();
    queue.length = 0;
    elements.toast?.classList.remove('show');
  }

  return { trigger, schedule, destroy };
}

export function shouldEnableEs2SocialProof(params: URLSearchParams, isPreviewDev: boolean): boolean {
  return ES2_SOCIAL_PROOF_PRODUCTION_ENABLED || (isPreviewDev && params.get('social_proof') === '1');
}

export function mountSalesSocialProof(options: Omit<SocialProofOptions, 'surface'> & { pricingTarget?: Element | null }) {
  const controller = createController({ ...options, surface: 'sales' });
  if (!options.enabled) return controller;

  let scrollTriggered = false;
  const onScroll = () => {
    if (scrollTriggered) return;
    const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    if (window.scrollY / scrollable >= 0.30) {
      scrollTriggered = true;
      controller.trigger('sales_scroll_30');
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  let observer: IntersectionObserver | null = null;
  if (options.pricingTarget && 'IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.18)) {
        controller.trigger('sales_pricing');
        observer?.disconnect();
      }
    }, { threshold: [0.18] });
    observer.observe(options.pricingTarget);
  }

  const baseDestroy = controller.destroy;
  controller.destroy = () => {
    window.removeEventListener('scroll', onScroll);
    observer?.disconnect();
    baseDestroy();
  };
  window.addEventListener('beforeunload', controller.destroy, { once: true });
  return controller;
}

export function mountCheckoutSocialProof(options: Omit<SocialProofOptions, 'surface'>) {
  const controller = createController({ ...options, surface: 'checkout' });
  if (!options.enabled) return controller;

  controller.schedule('checkout_initial', randomInt(5_000, 9_000));
  controller.schedule('checkout_followup', randomInt(28_000, 36_000));
  window.addEventListener('beforeunload', controller.destroy, { once: true });
  return controller;
}
