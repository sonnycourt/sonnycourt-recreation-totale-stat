// Decorative count-up to the supplied totals, not a live subscriber feed.
export function formatSocialCount(value) {
    // Full-width non-breaking spaces remain clearly visible with the page font.
    return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
}

export function renderSocialCount(el, value, animate = false) {
    const text = formatSocialCount(value);
    if (el.children.length !== text.length) {
        el.replaceChildren(...Array.from(text, (char) => {
            const slot = document.createElement('span');
            slot.className = char === '\u00a0' ? 'social-count-space' : 'social-count-digit';
            slot.setAttribute('aria-hidden', 'true');
            const glyph = document.createElement('span');
            glyph.textContent = char;
            slot.append(glyph);
            return slot;
        }));
        return;
    }
    Array.from(el.children).forEach((slot, index) => {
        const old = slot.firstElementChild;
        if (old.textContent === text[index]) return;
        const next = document.createElement('span');
        next.textContent = text[index];
        if (!animate || typeof next.animate !== 'function'
            || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            slot.replaceChildren(next);
            return;
        }
        slot.append(next);
        const options = { duration: 480, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'forwards' };
        old.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-110%)' }], options);
        const animation = next.animate([{ transform: 'translateY(110%)' }, { transform: 'translateY(0)' }], options);
        animation.onfinish = () => {
            slot.replaceChildren(next);
            animation.cancel();
        };
    });
}

export function initSocialCountAnimation() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches
        || !('IntersectionObserver' in window)) return;

    const formatter = { format: formatSocialCount };
    const timers = new Set();
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const el = entry.target;
            observer.unobserve(el);
            const target = Number(el.dataset.socialCount);
            const steps = 10 + Number(el.dataset.socialCountIndex) * 2;
            let current = target - steps;
            // Keep the real total stable for assistive technologies.
            el.setAttribute('aria-label', formatter.format(target));
            renderSocialCount(el, current);
            const timer = window.setInterval(() => {
                if (document.hidden) return;
                current += 1;
                renderSocialCount(el, current, true);
                if (current >= target) {
                    window.clearInterval(timer);
                    timers.delete(timer);
                }
            }, 60000 / steps);
            timers.add(timer);
        }
    }, { threshold: 0.5 });

    document.querySelectorAll('[data-social-count]').forEach((el, index) => {
        el.dataset.socialCountIndex = String(index);
        observer.observe(el);
    });
    window.addEventListener('pagehide', () => {
        observer.disconnect();
        timers.forEach((timer) => window.clearInterval(timer));
        document.querySelectorAll('[data-social-count]').forEach((el) => {
            el.textContent = formatter.format(Number(el.dataset.socialCount));
        });
    }, { once: true });
}
