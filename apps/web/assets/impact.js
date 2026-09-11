(function () {
  'use strict';
  var root = document.documentElement;
  function motionAllowed() { return root.dataset.motion !== 'paused' && !document.hidden; }
  function visibility() { root.dataset.pageVisible = String(!document.hidden); }
  document.addEventListener('visibilitychange', visibility); visibility();
  var scenes = document.querySelectorAll('.hero,.signal-strip,.trial-invitation,.knowledge-scene,.voice-section,.engine-art');
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { entry.target.dataset.sceneVisible = String(entry.isIntersecting); });
    });
    scenes.forEach(function (scene) { scene.dataset.sceneVisible = 'false'; observer.observe(scene); });
  }
  var signal = document.querySelector('.signal-list');
  if (signal) {
    var track = document.createElement('div'), cycle = document.createElement('div');
    track.className = 'signal-track'; cycle.className = 'signal-cycle';
    while (signal.firstChild) cycle.appendChild(signal.firstChild);
    var duplicate = cycle.cloneNode(true); duplicate.setAttribute('aria-hidden','true');
    track.appendChild(cycle); track.appendChild(duplicate); signal.appendChild(track); signal.dataset.enhanced = 'true';
  }

  // The gallery advances only while visible; focus or manual interaction pauses it.
  var tour = document.querySelector('.product-tour'), tourStage = document.querySelector('.tour-stage');
  var tabs = Array.from(document.querySelectorAll('[data-tour]')), play = document.querySelector('.tour-autoplay');
  if (tour && play && tabs.length > 1) {
    var progressRail = document.createElement('span');
    progressRail.className = 'tour-progress'; progressRail.setAttribute('aria-hidden','true'); tourStage.appendChild(progressRail);
    var visible = false, stopped = false, hovering = false, focused = false, automated = false;
    var timer = 0, started = 0, elapsed = 0, progressAnimation;
    var period = 6500;
    function canPlay() { var explicitPlay = document.activeElement === play; return visible && !stopped && (!hovering || explicitPlay) && (!focused || explicitPlay) && motionAllowed(); }
    function syncTour() {
      clearTimeout(timer);
      if (started) { elapsed += performance.now()-started; started = 0; }
      if (progressAnimation) { progressAnimation.kill(); progressAnimation = null; }
      play.hidden = root.dataset.motion === 'paused'; play.setAttribute('aria-pressed', String(stopped));
      play.textContent = stopped ? 'Reproduzir apresentação' : 'Pausar apresentação';
      progressRail.style.transform = 'scaleX('+Math.min(elapsed/period,1)+')';
      if (!canPlay()) return;
      var remaining = Math.max(0,period-elapsed);
      started = performance.now();
      // Animate a small isolated rail; the content stays in normal flow.
      if (window.gsap) progressAnimation = window.gsap.fromTo(progressRail,
        {scaleX:Math.min(elapsed/period,1)}, {scaleX:1,duration:remaining/1000,ease:'none'});
      timer = setTimeout(function () {
        started = 0; elapsed = 0;
        var current = tabs.findIndex(function (tab) { return tab.getAttribute('aria-selected') === 'true'; });
        automated = true; tabs[(current+1)%tabs.length].click(); automated = false; syncTour();
      }, remaining);
    }
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { if (!automated) { stopped = true; elapsed = 0; syncTour(); } });
      tab.addEventListener('keydown', function () { stopped = true; elapsed = 0; syncTour(); });
    });
    play.addEventListener('click', function () { stopped = !stopped; elapsed = 0; syncTour(); });
    tour.addEventListener('pointerenter', function (event) { if(event.pointerType === 'mouse') { hovering = true; syncTour(); } });
    tour.addEventListener('pointerleave', function () { hovering = false; syncTour(); });
    tour.addEventListener('focusin', function () { focused = true; syncTour(); });
    tour.addEventListener('focusout', function (event) { focused = tour.contains(event.relatedTarget); syncTour(); });
    document.addEventListener('visibilitychange', syncTour);
    document.addEventListener('zyon:motion-change', syncTour);
    if ('IntersectionObserver' in window) new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; syncTour(); }, {threshold:.28}).observe(tourStage);
    syncTour();
  }

  var voiceTabs = Array.from(document.querySelectorAll('[data-voice]'));
  var voicePanel = document.getElementById('voice-preview');
  var examples = ['“Me mostra uma opção que combine comigo.”','“Quero explicar o que preciso com a minha voz.”','“Gostei dessa opção. Pode colocar no carrinho.”','“Tudo certo. Vou conferir e concluir minha compra.”'];

  function selectVoice(index, focus) {
    voiceTabs.forEach(function (tab,i) { tab.setAttribute('aria-selected',String(i===index)); tab.tabIndex=i===index?0:-1; });
    voicePanel.textContent = examples[index]; voicePanel.setAttribute('aria-labelledby',voiceTabs[index].id);
    if (window.ZyonMotion) window.ZyonMotion.transition(voicePanel,{opacity:.2,y:5},{opacity:1,y:0},.24);
    if (focus) voiceTabs[index].focus();
  }
  voiceTabs.forEach(function (tab,i) {
    tab.addEventListener('click',function () { selectVoice(i,false); });
    tab.addEventListener('keydown',function (event) {
      var next;
      if(event.key==='ArrowRight')next=(i+1)%voiceTabs.length;
      else if(event.key==='ArrowLeft')next=(i+voiceTabs.length-1)%voiceTabs.length;
      else if(event.key==='Home')next=0;
      else if(event.key==='End')next=voiceTabs.length-1;
      else return;
      event.preventDefault();selectVoice(next,true);
    });
  });
}());
