/* Lucide-style inline SVG icons. Add new icons to ICONS, then call icon('name'). */
(function () {
  const ICONS = {
    search: '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>',
    home: '<path d="m3 11 9-8 9 8"></path><path d="M5 10v10h14V10"></path><path d="M9 20v-6h6v6"></path>',
    building: '<rect width="16" height="20" x="4" y="2" rx="2" ry="2"></rect><path d="M9 22v-4h6v4"></path><path d="M8 6h.01"></path><path d="M16 6h.01"></path><path d="M12 6h.01"></path><path d="M12 10h.01"></path><path d="M12 14h.01"></path><path d="M16 10h.01"></path><path d="M16 14h.01"></path><path d="M8 10h.01"></path><path d="M8 14h.01"></path>',
    landmark: '<line x1="3" x2="21" y1="22" y2="22"></line><line x1="6" x2="6" y1="18" y2="11"></line><line x1="10" x2="10" y1="18" y2="11"></line><line x1="14" x2="14" y1="18" y2="11"></line><line x1="18" x2="18" y1="18" y2="11"></line><polygon points="12 2 20 7 4 7"></polygon>',
    banknote: '<rect width="20" height="12" x="2" y="6" rx="2"></rect><circle cx="12" cy="12" r="2"></circle><path d="M6 12h.01"></path><path d="M18 12h.01"></path>',
    coffee: '<path d="M10 2v2"></path><path d="M14 2v2"></path><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h12Z"></path><path d="M17 9h1a3 3 0 0 1 0 6h-1"></path><path d="M6 2v2"></path>',
    creditCard: '<rect width="20" height="14" x="2" y="5" rx="2"></rect><line x1="2" x2="22" y1="10" y2="10"></line>',
    keyRound: '<path d="M2 18v3h3l9.6-9.6"></path><circle cx="16.5" cy="7.5" r="5.5"></circle>',
    smile: '<circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" x2="9.01" y1="9" y2="9"></line><line x1="15" x2="15.01" y1="9" y2="9"></line>',
    baby: '<path d="M9 12h.01"></path><path d="M15 12h.01"></path><path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5"></path><path d="M19 6.3a9 9 0 1 1-14 0"></path><path d="M12 2v4"></path><path d="M9 4h6"></path>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"></path><path d="M5 3v4"></path><path d="M3 5h4"></path><path d="M19 17v4"></path><path d="M17 19h4"></path>',
    calculator: '<rect width="16" height="20" x="4" y="2" rx="2"></rect><line x1="8" x2="16" y1="6" y2="6"></line><line x1="16" x2="16" y1="14" y2="18"></line><path d="M16 10h.01"></path><path d="M12 10h.01"></path><path d="M8 10h.01"></path><path d="M12 14h.01"></path><path d="M8 14h.01"></path><path d="M12 18h.01"></path><path d="M8 18h.01"></path>',
    chartLine: '<path d="M3 3v18h18"></path><path d="m19 9-5 5-4-4-3 3"></path>',
    mapPin: '<path d="M20 10c0 4.99-5.54 10.19-7.4 11.79a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle>',
    school: '<path d="m4 6 8-4 8 4"></path><path d="m18 10 4 2v8H2v-8l4-2"></path><path d="M6 8v12"></path><path d="M18 8v12"></path><path d="M10 20v-6h4v6"></path>',
    trainFront: '<path d="M4 15.5V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-1l2 3"></path><path d="m5 20.5 2-3H6a2 2 0 0 1-2-2"></path><path d="M8 11h8"></path><path d="M8 7h8"></path><path d="M8 15h.01"></path><path d="M16 15h.01"></path>',
    check: '<path d="M20 6 9 17l-5-5"></path>',
    x: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
    alertTriangle: '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
    chevronDown: '<path d="m6 9 6 6 6-6"></path>',
    chevronRight: '<path d="m9 18 6-6-6-6"></path>',
    arrowLeft: '<path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path>',
    rotateCcw: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path>',
  };

  function normalizeName(name) {
    return String(name || '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  function icon(name, size = 20, extraClass = '') {
    const key = normalizeName(name);
    const body = ICONS[key];
    if (!body) return '';
    const className = ['ui-icon', extraClass].filter(Boolean).join(' ');
    return `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  window.AppIcons = {
    icons: ICONS,
    render: icon,
    hydrate(root = document) {
      root.querySelectorAll('[data-icon]').forEach(el => {
        const name = el.dataset.icon;
        const size = Number(el.dataset.iconSize || 20);
        const extraClass = el.dataset.iconClass || '';
        el.innerHTML = icon(name, size, extraClass);
      });
    },
    add(name, svgBody) {
      ICONS[normalizeName(name)] = svgBody;
    },
  };
  window.icon = icon;
  window.renderIcons = window.AppIcons.hydrate;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.AppIcons.hydrate());
  } else {
    window.AppIcons.hydrate();
  }
})();
