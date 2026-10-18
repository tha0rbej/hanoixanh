(function () {
  function closeMenu(header) {
    const toggle = header.querySelector('.site-menu-toggle');
    header.classList.remove('menu-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function initializeHeader(header, index) {
    const toggle = header.querySelector('.site-menu-toggle');
    const nav = header.querySelector('nav, .nav-links');
    if (!toggle || !nav) return;
    if (!nav.id) nav.id = 'site-navigation-' + index;
    toggle.setAttribute('aria-controls', nav.id);
    toggle.addEventListener('click', function () {
      const open = header.classList.toggle('menu-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('click', function (event) {
      const trigger = event.target.closest('.nav-dropdown-trigger');
      if (trigger) {
        const dropdown = trigger.closest('.nav-dropdown');
        const open = dropdown.classList.toggle('is-open');
        trigger.setAttribute('aria-expanded', String(open));
        event.preventDefault();
        return;
      }
      if (event.target.closest('a')) closeMenu(header);
    });
    document.addEventListener('click', function (event) {
      if (!header.contains(event.target)) {
        closeMenu(header);
        header.querySelectorAll('.nav-dropdown.is-open').forEach(function (dropdown) {
          dropdown.classList.remove('is-open');
          const trigger = dropdown.querySelector('.nav-dropdown-trigger');
          if (trigger) trigger.setAttribute('aria-expanded', 'false');
        });
      }
    });
  }

  function initialize() {
    document.querySelectorAll('.site-header').forEach(initializeHeader);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})();
