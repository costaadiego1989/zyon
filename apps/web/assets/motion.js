(function () {
  'use strict';
  var root = document.documentElement;
  var reduced = matchMedia('(prefers-reduced-motion: reduce)');
  var fine = matchMedia('(hover: hover) and (pointer: fine) and (min-width: 701px)');
  var ease = 'cubic-bezier(.22,1,.36,1)';
  var active = new Set();
  var byElement = new WeakMap();
  var pause = document.querySelector('.motion-toggle');
  var paused = false;
  try { paused = sessionStorage.getItem('zyon_motion_paused') === 'true'; } catch (_) {}
  function enabled() { return !reduced.matches && !paused && !document.hidden; }
  function animate(element, frames, options) {
    if (!element || !enabled() || !element.animate) return;
    var previous = byElement.get(element);
    if (previous) previous.cancel();
    var animation = element.animate(frames, Object.assign({ duration:480, easing:ease }, options));
    active.add(animation); byElement.set(element, animation);
    function clear() { active.delete(animation); if (byElement.get(element) === animation) byElement.delete(element); }
    animation.onfinish = clear; animation.oncancel = clear;
    return animation;
  }
  var mobile = matchMedia('(max-width:700px)');
  var entrances = {
    header: function () { return [{opacity:0,translate:'0 -8px'},{opacity:1,translate:'0 0'}]; },
    rise: function (d) { return [{opacity:0,translate:'0 '+d+'px'},{opacity:1,translate:'0 0'}]; },
    left: function (d) { return [{opacity:0,translate:-d+'px 0'},{opacity:1,translate:'0 0'}]; },
    right: function (d) { return [{opacity:0,translate:d+'px 0'},{opacity:1,translate:'0 0'}]; },
    heading: function (d) { return [{opacity:.15,translate:'0 '+d+'px',clipPath:'inset(0 0 90% 0)'},{opacity:1,translate:'0 0',clipPath:'inset(-8% -2% -8% -2%)'}]; },
    focus: function (d) { return [{opacity:0,translate:'0 '+d+'px',scale:'.955'},{opacity:1,translate:'0 0',scale:'1'}]; },
    unfold: function (d) { return [{opacity:0,translate:'0 '+d+'px',rotate:'x 7deg',scale:'.98'},{opacity:1,translate:'0 0',rotate:'x 0deg',scale:'1'}]; },
    signature: function (d) { return [{opacity:.1,translate:'0 '+d+'px',clipPath:'inset(0 0 85% 0)'},{opacity:1,translate:'0 0',clipPath:'inset(-2%)'}]; }
  };
  function enter(element, kind, delay) {
    if (!element) return;
    element.dataset.motionEntry = kind;
    element.dataset.motionEntered = 'true';
    var frames = entrances[kind](mobile.matches ? 20 : 38);
    // A flutuação existente do painel continua durante a aproximação, sem salto no final.
    if (element.matches('.hero-dashboard')) frames.forEach(function (frame) { delete frame.translate; });
    animate(element, frames, {
      duration:kind === 'header' ? 320 : mobile.matches ? 600 : (kind === 'heading' || kind === 'signature' ? 850 : 720),
      delay:mobile.matches ? Math.min(delay || 0,120) : delay || 0, fill:'backwards'
    });
  }
  function syncMotion() {
    root.dataset.motion = paused || reduced.matches ? 'paused' : 'running';
    if (pause) {
      pause.hidden = reduced.matches;
      pause.setAttribute('aria-pressed', String(paused));
      pause.textContent = paused ? 'Ativar animações' : 'Pausar animações';
    }
    if (!enabled()) active.forEach(function (animation) { animation.cancel(); });
    document.dispatchEvent(new CustomEvent('zyon:motion-change'));
  }
  if (pause) pause.addEventListener('click', function () {
    paused = !paused;
    try { sessionStorage.setItem('zyon_motion_paused', String(paused)); } catch (_) {}
    syncMotion();
  });
  reduced.addEventListener('change', syncMotion);
  document.addEventListener('visibilitychange', syncMotion);
  syncMotion();

  // A abertura apresenta marca, mensagem, ação e produto, sem bloquear a leitura.
  if (!location.hash && scrollY < 80) {
    [
      ['.header-inner','header',0], ['.hero-copy .eyebrow','left',40],
      ['.hero h1','heading',100], ['.hero-lead','rise',210],
      ['.hero-cta .button:first-child','rise',300], ['.hero-cta .button:last-child','rise',370],
      ['.hero-offer','left',410], ['.hero-assurance','rise',450],
      ['.hero-dashboard','focus',280], ['.demo-column','right',420]
    ].forEach(function (item) {
      enter(document.querySelector(item[0]),item[1],item[2]);
    });
  }

  // Cada família acompanha o conteúdo. Entradas executam uma vez; voltar o scroll não as reinicia.
  // O estado base permanece visível sem JS, com movimento reduzido ou durante uma interrupção.
  if ('IntersectionObserver' in window) {
    var recipes = new WeakMap();
    var reveal = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        reveal.unobserve(entry.target);
        var recipe = recipes.get(entry.target);
        enter(entry.target,recipe.kind,recipe.delay);
      });
    }, { threshold:.12, rootMargin:'0px 0px -6% 0px' });
    function register(selector,kind,gap,delay) {
      document.querySelectorAll(selector).forEach(function (element,i) {
        recipes.set(element,{kind:kind,delay:(delay || 0)+i*(gap || 0)});
        element.dataset.motionEntry = kind;
        reveal.observe(element);
      });
    }
    register('.tour-heading h2','heading');
    register('.tour-heading > p','right',0,100);
    register('.tour-tab','left',100);
    register('.tour-stage','focus',0,100);
    register('.tour-bottom > *','rise',90);
    register('.trial-seal','focus');
    register('.trial-copy h2','heading',0,80);
    register('.trial-copy > p','rise',0,160);
    register('.trial-action','right',0,200);
    register('.engine-copy h2','heading');
    register('.engine-copy > p','rise',0,100);
    register('.engine-legend-item','left',120);
    register('.engine-art','unfold',0,100);
    register('.engine-scenario','rise');
    register('.outcome','rise',130);
    register('.operation .section-heading > div','heading');
    register('.operation .section-heading > p','right',0,140);
    register('.sequence-step','left',150);
    register('.technology-intro h2','heading');
    register('.technology-intro > p','rise',0,120);
    register('.buyer-quote','left');
    register('.context-trail > span','focus',90,100);
    register('.catalog-match','rise',0,240);
    register('.technology-copy article','right',130);
    register('.technology-copy > a','rise');
    // O símbolo de voz permanece completamente estático, inclusive na entrada.
    register('.voice-copy h2','heading');
    register('.voice-copy > p','left',0,100);
    register('.voice-copy > a','rise',0,160);
    register('.voice-modes button','rise',65);
    register('.performance-copy h2','heading');
    register('.performance-copy > p','rise',0,120);
    register('.performance-points > p','left',110);
    register('.performance-chart figcaption','rise');
    register('.chart-principle','focus');
    register('.protocol-header h2','heading');
    register('.protocol-header > p','right',0,120);
    register('.protocol','left',100);
    register('.protocol-cta > *','rise',90);
    register('.command-copy h2','heading');
    register('.command-copy > p','rise',0,100);
    register('.control-line','right',100);
    register('.margin-demo','focus');
    register('.pricing-head h2','heading');
    register('.pricing-head > p','right',0,100);
    register('.signup-path li','left',100);
    register('.plan','unfold',120);
    register('.faq-layout h2','heading');
    register('.faq-layout > div:first-child > p','rise');
    register('.faq-list details','right',45);
    register('.closing h2','heading');
    register('.closing-inner > div > p','rise',0,100);
    register('.closing-actions > *','right',110);
    register('.investor-layout h2','heading');
    register('.investor-action','left',0,160);
    register('.footer-main > *','rise',100);
    register('.footer-signature','signature');
    register('.footer-bottom','rise');

    var chart = document.querySelector('.performance-chart > svg');
    if (chart) {
      chart.dataset.motionEntry = 'draw';
      var drawChart = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        drawChart.disconnect(); chart.dataset.motionEntered = 'true';
        var line = chart.querySelector('.performance-line');
        var area = chart.querySelector('path[fill^="url"]');
        var length = line.getTotalLength();
        animate(line,[{strokeDasharray:length+' '+length,strokeDashoffset:length},{strokeDasharray:length+' '+length,strokeDashoffset:0}],{duration:mobile.matches ? 800 : 1150,fill:'backwards'});
        animate(area,[{opacity:0,clipPath:'inset(0 100% 0 0)'},{opacity:1,clipPath:'inset(0)'}],{duration:1000,delay:80,fill:'backwards'});
        animate(chart.querySelector('circle'),[{opacity:0,scale:'.5'},{opacity:1,scale:'1'}],{duration:300,delay:500,fill:'backwards'});
      },{threshold:.3});
      drawChart.observe(chart);
    }
  }

  // Pointer depth is bounded and only runs after pointer input on desktop.
  function depth(host, surface, amount) {
    if (!host || !surface) return;
    surface.setAttribute('data-depth','');
    var frame = 0, x = 0, y = 0;
    function reset() {
      cancelAnimationFrame(frame); frame = 0;
      surface.style.removeProperty('--tilt-x'); surface.style.removeProperty('--tilt-y');
      host.style.removeProperty('--light-x'); host.style.removeProperty('--light-y');
    }
    host.addEventListener('pointermove', function (event) {
      if (!enabled() || !fine.matches || event.pointerType === 'touch') return;
      x = event.clientX; y = event.clientY;
      if (frame) return;
      frame = requestAnimationFrame(function () {
        frame = 0;
        var box = host.getBoundingClientRect();
        var nx = Math.max(-1, Math.min(1, (x - box.left) / box.width * 2 - 1));
        var ny = Math.max(-1, Math.min(1, (y - box.top) / box.height * 2 - 1));
        surface.style.setProperty('--tilt-x', (-ny * amount).toFixed(2) + 'deg');
        surface.style.setProperty('--tilt-y', (nx * amount).toFixed(2) + 'deg');
        host.style.setProperty('--light-x', (nx * 32).toFixed(1) + 'px');
        host.style.setProperty('--light-y', (ny * 20).toFixed(1) + 'px');
      });
    }, { passive:true });
    host.addEventListener('pointerleave', reset);
    document.addEventListener('zyon:motion-change', reset);
    fine.addEventListener('change', reset);
  }
  depth(document.querySelector('.hero-product-stage'), document.querySelector('.hero-dashboard'), 4);
  depth(document.querySelector('.engine-experience'), document.querySelector('.engine-art'), 3);

  document.addEventListener('zyon:tour-change', function (event) {
    var panel = document.getElementById(event.detail.panel);
    animate(panel, [{ opacity:.15, translate:'24px 0', scale:'.96' }, { opacity:1, translate:'0 0', scale:'1' }], { duration:520 });
  });
  document.addEventListener('zyon:decision-change', function () {
    animate(document.getElementById('decision-panel'), [{ opacity:.2, translate:'0 10px' }, { opacity:1, translate:'0 0' }], { duration:280 });
  });
  var decisionTabs = document.querySelector('.scenario-tabs');
  if (decisionTabs) {
    var marker = document.createElement('span');
    marker.className = 'decision-tab-marker'; marker.setAttribute('aria-hidden','true');
    decisionTabs.appendChild(marker);
    function updateMarker() {
      var selected = decisionTabs.querySelector('[aria-selected="true"]');
      var box = selected.getBoundingClientRect(), parent = decisionTabs.getBoundingClientRect();
      marker.style.transform = 'translateX('+(box.left-parent.left)+'px) scaleX('+box.width+')';
    }
    document.addEventListener('zyon:decision-change',updateMarker);
    if ('ResizeObserver' in window) new ResizeObserver(updateMarker).observe(decisionTabs);
    updateMarker();
  }
  // O details conserva a semântica nativa. A resposta sai antes do fechamento;
  // o deslocamento dos itens seguintes usa FLIP, sem animar height/width.
  var faqItems = Array.from(document.querySelectorAll('.faq-list details'));
  faqItems.forEach(function (detail,index) {
    var closing = null;
    detail.querySelector('summary').addEventListener('click',function (event) {
      if (!enabled()) return;
      event.preventDefault();
      if (closing) { closing.cancel(); closing = null; return; }
      function change(open) {
        var siblings = faqItems.slice(index+1);
        var positions = siblings.map(function (item) { return item.getBoundingClientRect().top; });
        detail.open = open;
        siblings.forEach(function (item,i) {
          var offset = positions[i]-item.getBoundingClientRect().top;
          animate(item,[{translate:'0 '+offset+'px'},{translate:'0 0'}],{duration:320});
        });
      }
      if (!detail.open) { change(true); return; }
      closing = animate(detail.querySelector('p'),[{opacity:1,translate:'0 0'},{opacity:0,translate:'0 -8px'}],{duration:140});
      if (closing) closing.finished.then(function () { closing = null; change(false); },function () { closing = null; });
      else change(false);
    });
    detail.addEventListener('toggle', function () {
      if (detail.open) animate(detail.querySelector('p'), [{ opacity:0, translate:'0 -6px' }, { opacity:1, translate:'0 0' }], { duration:260 });
    });
  });

  var navigation = document.querySelector('.main-nav');
  var menuHeader = document.querySelector('.site-header');
  if (navigation && menuHeader && 'MutationObserver' in window) {
    new MutationObserver(function () {
      if (menuHeader.dataset.menuOpen !== 'true') return;
      animate(navigation,[{opacity:0,translate:'0 -12px',clipPath:'inset(0 0 65% 0)'},{opacity:1,translate:'0 0',clipPath:'inset(-4%)'}],{duration:300});
      navigation.querySelectorAll('a').forEach(function (link,i) {
        animate(link,[{opacity:0,translate:'-10px 0'},{opacity:1,translate:'0 0'}],{duration:260,delay:i*40,fill:'backwards'});
      });
    }).observe(menuHeader,{attributes:true,attributeFilter:['data-menu-open']});
  }

  // A visitor can play the existing example; manual tab selection always wins.
  var scenario = document.querySelector('.engine-scenario');
  if (scenario) {
    var play = document.createElement('button');
    play.type = 'button'; play.className = 'scenario-play'; play.textContent = 'Ver decisão em sequência';
    scenario.appendChild(play);
    var timer = 0, running = false, automated = false;
    var steps = Array.from(scenario.querySelectorAll('[data-step]'));
    function stop() {
      clearTimeout(timer); running = false; play.dataset.playing = 'false'; play.textContent = 'Ver decisão em sequência';
    }
    function show(index) {
      automated = true; steps[index].click(); automated = false;
      if (index < steps.length - 1) timer = setTimeout(function () { show(index + 1); }, 1700);
      else { stop(); play.textContent = 'Repetir decisão'; }
    }
    play.addEventListener('click', function () {
      if (running) { stop(); return; }
      running = true; play.dataset.playing = 'true'; play.textContent = 'Pausar sequência'; show(0);
    });
    steps.forEach(function (step) {
      step.addEventListener('click', function () { if (!automated) stop(); });
      step.addEventListener('keydown', stop);
    });
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); });
    document.addEventListener('zyon:motion-change', function () { if (!enabled()) stop(); });
    if ('IntersectionObserver' in window) new IntersectionObserver(function (entries) { if (!entries[0].isIntersecting) stop(); }).observe(scenario);
  }

  var header = document.querySelector('.site-header');
  var links = Array.from(document.querySelectorAll('.main-nav a[href^="#"]'));
  var sections = links.map(function (link) { return document.querySelector(link.getAttribute('href')); });
  var pending = 0;
  function updateScroll() {
    pending = 0;
    var max = root.scrollHeight - innerHeight;
    if (header) {
      header.style.setProperty('--page-progress', max > 0 ? String(Math.min(1, scrollY / max)) : '0');
      header.dataset.scrolled = String(scrollY > 12);
    }
    var current = -1;
    sections.forEach(function (section, i) { if (section && section.getBoundingClientRect().top <= 180) current = i; });
    links.forEach(function (link, i) {
      if (i === current) link.setAttribute('aria-current','location');
      else link.removeAttribute('aria-current');
    });
  }
  function scheduleScroll() { if (!pending) pending = requestAnimationFrame(updateScroll); }
  addEventListener('scroll', scheduleScroll, { passive:true });
  addEventListener('resize', scheduleScroll, { passive:true });
  updateScroll();
}());
