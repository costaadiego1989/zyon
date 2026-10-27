(function () {
  'use strict';
  var root = document.documentElement, gsap = window.gsap, ScrollTrigger = window.ScrollTrigger;
  var reduced = matchMedia('(prefers-reduced-motion: reduce)'), narrow = matchMedia('(max-width:700px)');
  var toggle = document.querySelector('.motion-toggle'), paused = false;
  try { paused = sessionStorage.getItem('zyon_motion_paused') === 'true'; } catch (_) {}
  var available = !!(gsap && ScrollTrigger), active = new Set(), entries = [], triggers = [], seen = new WeakSet();
  function enabled() { return available && !paused && !reduced.matches && !document.hidden; }
  function remember(tween) {
    active.add(tween);
    tween.eventCallback('onComplete',function () { active.delete(tween); });
    tween.eventCallback('onInterrupt',function () { active.delete(tween); });
    return tween;
  }
  function transition(element,from,to,duration) {
    if (!element || !enabled()) return;
    gsap.killTweensOf(element);
    return remember(gsap.fromTo(element,from,Object.assign({duration:duration || .28,ease:'power3.out',overwrite:'auto',clearProps:'opacity,transform,willChange'},to)));
  }
  window.ZyonMotion = { enabled:enabled, transition:transition };
  if (available) { gsap.registerPlugin(ScrollTrigger); ScrollTrigger.config({ignoreMobileResize:true}); root.dataset.motionEngine = 'gsap-3.15.0'; }

  // GSAP é o único responsável pelos transforms de entrada. Não há tilt,
  // translate CSS ou animações nativas competindo na mesma superfície.
  function register(selector,kind,stagger) {
    document.querySelectorAll(selector).forEach(function (element,index) {
      element.dataset.motionEntry = kind;
      entries.push({element:element,kind:kind,delay:Math.min(index*(stagger || 0),.18)});
    });
  }
  register('.tour-heading h2,.engine-copy h2,.technology-intro h2,.performance-copy h2,.pricing-head h2,.faq-layout h2','rise');
  register('.tour-heading > p,.trial-action,.operation .section-heading > p,.protocol-header > p','side');
  register('.tour-tab','side',.09); register('.tour-stage','focus'); register('.tour-bottom > *','rise',.08);
  register('.trial-seal','focus'); register('.trial-copy h2,.trial-copy > p','rise',.08);
  register('.engine-copy > p,.engine-scenario','rise'); register('.engine-legend-item','side',.08); register('.engine-art','focus');
  register('.outcome','rise',.1); register('.operation .section-heading > div','rise'); register('.sequence-step','side',.1);
  register('.technology-intro > p,.catalog-match','rise'); register('.buyer-quote','side'); register('.context-trail > span','focus',.06);
  register('.technology-copy article','side',.09); register('.technology-copy > a','rise');
  register('.voice-copy h2,.voice-copy > p,.voice-copy > a','rise',.06);
  register('.performance-copy > p,.performance-points > p','rise',.05);
  register('.performance-chart','chart'); register('.protocol-header h2','rise'); register('.protocol','side',.1);
  register('.protocol-cta > *,.command-copy h2,.command-copy > p','rise',.07);
  register('.control-line','side',.08); register('.margin-demo','focus'); register('.pricing-head > p','side');
  register('.signup-path li','side',.06); register('.plan','rise',.1);
  register('.faq-layout > div:first-child > p','rise'); register('.faq-list details','fade',.04);
  register('.closing h2,.closing-inner > div > p','rise',.07); register('.closing-actions > *','side',.07);
  register('.investor-layout h2','rise'); register('.investor-action','side');
  register('.footer-main > *','rise',.07); register('.footer-signature','fade'); register('.footer-bottom','fade');

  function stopEntries() {
    triggers.forEach(function (trigger) { trigger.kill(); }); triggers = [];
    Array.from(active).forEach(function (tween) { tween.progress(1).kill(); }); active.clear();
    if (available) entries.forEach(function (entry) { gsap.set(entry.element,{clearProps:'opacity,transform,willChange'}); });
  }
  function prepareEntries() {
    if (!enabled()) return;
    entries.forEach(function (entry) {
      var element = entry.element;
      if (seen.has(element)) return;
      if (element.getBoundingClientRect().bottom < 0) { seen.add(element); return; }
      var distance = narrow.matches ? 14 : 24;
      var from = {opacity:0,willChange:'transform,opacity'};
      if (entry.kind === 'side') from.x = narrow.matches ? 0 : -18;
      else if (entry.kind !== 'fade') from.y = distance;
      if (entry.kind === 'focus') from.scale = .985;
      // Inicialização antes da entrada, sem o salto visível -> invisível do observer anterior.
      var tween = gsap.from(element,Object.assign(from,{
        paused:true,duration:entry.kind === 'fade' ? .5 : .72,ease:'power3.out',delay:narrow.matches ? 0 : entry.delay,
        clearProps:'opacity,transform,willChange',
        onComplete:function () { active.delete(tween); },onInterrupt:function () { active.delete(tween); }
      }));
      active.add(tween);
      var trigger = ScrollTrigger.create({
        trigger:element,start:'top 94%',once:true,
        onEnter:function () {
          seen.add(element); element.dataset.motionEntered = 'true'; tween.play();
          if (entry.kind === 'chart') drawChart(element);
        }
      });
      triggers.push(trigger);
    });
  }
  function drawChart(chart) {
    if (!enabled()) return;
    var line = chart.querySelector('.performance-line');
    if (!line) return;
    var length = line.getTotalLength();
    remember(gsap.fromTo(line,{strokeDasharray:length,strokeDashoffset:length},{strokeDashoffset:0,duration:1.1,ease:'power2.out',clearProps:'strokeDasharray,strokeDashoffset'}));
  }
  function sync() {
    root.dataset.motion = !available || paused || reduced.matches ? 'paused' : 'running';
    root.dataset.pageVisible = String(!document.hidden);
    if (toggle) { toggle.hidden = !available || reduced.matches; toggle.setAttribute('aria-pressed',String(paused)); toggle.textContent = paused ? 'Ativar animações' : 'Pausar animações'; }
    if (!available) { document.dispatchEvent(new CustomEvent('zyon:motion-change')); return; }
    stopEntries();
    if (enabled()) prepareEntries();
    document.dispatchEvent(new CustomEvent('zyon:motion-change'));
  }
  if (toggle) toggle.addEventListener('click',function () { paused = !paused; try { sessionStorage.setItem('zyon_motion_paused',String(paused)); } catch (_) {} sync(); });
  reduced.addEventListener('change',sync);
  narrow.addEventListener('change',sync);
  document.addEventListener('visibilitychange',sync);
  sync();

  if (enabled() && !location.hash && scrollY < 80) {
    var hero = gsap.timeline({defaults:{ease:'power3.out',duration:.72}});
    hero.from('.header-inner',{opacity:0,y:-5,duration:.35,clearProps:'opacity,transform'},0)
      .from('.hero-copy .eyebrow',{opacity:0,y:8,clearProps:'opacity,transform'},.04)
      .from('.hero h1',{opacity:0,y:22,clearProps:'opacity,transform'},.10)
      .from('.hero-lead',{opacity:0,y:16,clearProps:'opacity,transform'},.22)
      .from('.hero-cta > a',{opacity:0,y:12,stagger:.06,clearProps:'opacity,transform'},.30)
      .from('.hero-offer,.hero-assurance',{opacity:0,stagger:.04,clearProps:'opacity'},.40)
      .from('.hero-dashboard',{opacity:0,scale:.99,clearProps:'opacity,transform'},.24)
      .from('.demo-column',{opacity:0,clearProps:'opacity'},.36);
    remember(hero);
  }
  // Ao navegar pelo teclado, revelar imediatamente o item que recebeu foco.
  document.addEventListener('focusin',function (event) {
    if (!available) return;
    var entry = entries.find(function (item) { return item.element.contains(event.target); });
    if (!entry) return;
    gsap.getTweensOf(entry.element).forEach(function (tween) { tween.progress(1); });
    seen.add(entry.element);
  });
  document.addEventListener('zyon:tour-change',function (event) { transition(document.getElementById(event.detail.panel),{opacity:.15,x:8},{opacity:1,x:0},.36); });
  document.addEventListener('zyon:decision-change',function () { transition(document.getElementById('decision-panel'),{opacity:.25,y:5},{opacity:1,y:0},.24); });
  document.querySelectorAll('.faq-list details,.plan details').forEach(function (detail) {
    detail.addEventListener('toggle',function () {
      if (detail.open) transition(detail.querySelector('p,ul'),{opacity:0,y:4},{opacity:1,y:0},.24);
      if (available) ScrollTrigger.refresh();
    });
  });
  var header = document.querySelector('.site-header'), nav = document.querySelector('.main-nav');
  if (header && nav) new MutationObserver(function () {
    if (header.dataset.menuOpen === 'true') transition(nav,{opacity:0,y:-6},{opacity:1,y:0},.24);
  }).observe(header,{attributes:true,attributeFilter:['data-menu-open']});
  var links = Array.from(document.querySelectorAll('.main-nav a[href^="#"]'));
  var sections = links.map(function (link) { return document.querySelector(link.getAttribute('href')); }), frame = 0;
  function updateScroll() {
    frame = 0;
    if (header) { header.dataset.scrolled=String(scrollY>12); header.style.setProperty('--page-progress',String(scrollY/Math.max(1,root.scrollHeight-innerHeight))); }
    var current = -1;
    sections.forEach(function (section,i) { if (section && section.getBoundingClientRect().top <= 180) current = i; });
    links.forEach(function (link,i) { if (i===current) link.setAttribute('aria-current','location'); else link.removeAttribute('aria-current'); });
  }
  addEventListener('scroll',function () { if (!frame) frame = requestAnimationFrame(updateScroll); },{passive:true});
  updateScroll();
  if (available) {
    document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
    addEventListener('load',function () { ScrollTrigger.refresh(); },{once:true});
  }
}());
