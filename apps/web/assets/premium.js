(function () {
  'use strict';
  var tabs = Array.from(document.querySelectorAll('[data-tour]'));
  function select(index, focus) {
    tabs.forEach(function (tab, i) {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = i !== index;
    });
    document.dispatchEvent(new CustomEvent("zyon:tour-change", { detail: { panel: tabs[index].getAttribute("aria-controls") } }));
    if (focus) tabs[index].focus();
  }
  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () { select(i, false); });
    tab.addEventListener('keydown', function (event) {
      var next;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (i + 1) % tabs.length;
      else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault(); select(next, true);
    });
  });
  var narrow = window.matchMedia('(max-width: 700px)');
  function orientation() { var nav = document.querySelector('.tour-nav'); if (nav) nav.setAttribute('aria-orientation', narrow.matches ? 'horizontal' : 'vertical'); }
  orientation(); narrow.addEventListener('change', orientation);
}());
