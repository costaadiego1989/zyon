(function () {
  "use strict";
  var language = document.documentElement.lang.toLowerCase().slice(0, 2);
  var copy = {
    pt: {
      demoReady: "Athom conectada",
      demoError: "Conexão indisponível",
      demoLoading: "Conectando à loja",
      marginAllowed: "Condição permitida: margem de {margin}%, respeitando o mínimo de 25%.",
      marginBlocked: "Condição bloqueada: margem de {margin}%, abaixo do mínimo de 25%.",
      decisionSteps: [
        ["“Gostei. Tem alguma condição melhor?”", "O motor identifica uma objeção de preço e considera o produto e o carrinho antes de propor uma condição.", "“"],
        ["A condição passa pelas regras da loja.", "Desconto máximo, margem mínima, estoque e frete são verificados. Uma sugestão da IA só vira oferta quando os limites permitem.", "✓"],
        ["Uma proposta com o próximo passo claro.", "Com a condição validada, a Zyon apresenta a oferta e conduz o cliente ao checkout. Se não houver margem, explica as opções disponíveis.", "↗"]
      ]
    },
    es: {
      demoReady: "Athom conectada",
      demoError: "Conexión no disponible",
      demoLoading: "Conectando la tienda",
      marginAllowed: "Condición permitida: margen de {margin}%, por encima del mínimo de 25%.",
      marginBlocked: "Condición bloqueada: margen de {margin}%, por debajo del mínimo de 25%.",
      decisionSteps: [
        ["“Me gusta. ¿Hay alguna condición mejor?”", "El motor identifica una objeción de precio y considera el producto y el carrito antes de proponer una condición.", "“"],
        ["La condición pasa por las reglas de la tienda.", "Se verifican el descuento máximo, el margen mínimo, el inventario y el envío. Una sugerencia de IA solo se convierte en oferta cuando los límites lo permiten.", "✓"],
        ["Una propuesta con un siguiente paso claro.", "Con la condición validada, Zyon presenta la oferta y guía al cliente al checkout. Si no hay margen, explica las opciones disponibles.", "↗"]
      ]
    },
    en: {
      demoReady: "Athom connected",
      demoError: "Connection unavailable",
      demoLoading: "Connecting the store",
      marginAllowed: "Condition allowed: {margin}% margin, above the 25% minimum.",
      marginBlocked: "Condition blocked: {margin}% margin, below the 25% minimum.",
      decisionSteps: [
        ["“I like it. Is there a better offer?”", "The engine identifies a price objection and considers the product and cart before proposing a condition.", "“"],
        ["The condition passes through the store rules.", "Maximum discount, minimum margin, inventory, and shipping are checked. An AI suggestion only becomes an offer when the limits allow it.", "✓"],
        ["A proposal with a clear next step.", "With the condition validated, Zyon presents the offer and guides the customer to checkout. If there is no margin, it explains the available options.", "↗"]
      ]
    }
  }[language] || null;
  if (!copy) copy = {
    demoReady: "Athom conectada",
    demoError: "Conexão indisponível",
    demoLoading: "Conectando à loja",
    marginAllowed: "Condição permitida: margem de {margin}%, respeitando o mínimo de 25%.",
    marginBlocked: "Condição bloqueada: margem de {margin}%, abaixo do mínimo de 25%.",
    decisionSteps: []
  };
  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  // O menu usa controles nativos, foco previsível e fecha ao seguir uma âncora.
  var menu = document.querySelector(".menu-toggle");
  var nav = document.getElementById("main-navigation");
  var header = document.querySelector(".site-header");
  if (menu && nav && header) {
    menu.hidden = false;
    header.dataset.enhanced = "true";
    function closeMenu(restoreFocus) {
      menu.setAttribute("aria-expanded", "false");
      header.dataset.menuOpen = "false";
      if (restoreFocus) menu.focus();
    }
    menu.addEventListener("click", function () {
      var open = menu.getAttribute("aria-expanded") !== "true";
      menu.setAttribute("aria-expanded", String(open));
      header.dataset.menuOpen = String(open);
    });
    nav.addEventListener("click", function (event) {
      var link = event.target.closest("a");
      if (!link) return;
      closeMenu(false);
      var target = document.querySelector(link.getAttribute("href"));
      if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && menu.getAttribute("aria-expanded") === "true") closeMenu(true);
    });
    document.addEventListener("click", function (event) {
      if (!header.contains(event.target)) closeMenu(false);
    });
    header.addEventListener("focusout", function (event) {
      if (!header.contains(event.relatedTarget)) closeMenu(false);
    });
    window.matchMedia("(min-width: 1051px)").addEventListener("change", function () { closeMenu(false); });
  }

  var languagePicker = document.querySelector(".language-picker");
  var languageTrigger = languagePicker && languagePicker.querySelector(".language-picker__trigger");
  var languageMenu = languagePicker && languagePicker.querySelector(".language-picker__menu");
  if (languagePicker && languageTrigger && languageMenu) {
    function closeLanguagePicker(restoreFocus) {
      languageTrigger.setAttribute("aria-expanded", "false");
      languageMenu.hidden = true;
      if (restoreFocus) languageTrigger.focus();
    }
    languageTrigger.addEventListener("click", function () {
      var isOpen = languageTrigger.getAttribute("aria-expanded") === "true";
      languageTrigger.setAttribute("aria-expanded", String(!isOpen));
      languageMenu.hidden = isOpen;
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !languageMenu.hidden) closeLanguagePicker(true);
    });
    document.addEventListener("click", function (event) {
      if (!languagePicker.contains(event.target) && !languageMenu.hidden) closeLanguagePicker(false);
    });
    languagePicker.addEventListener("focusout", function (event) {
      if (!languagePicker.contains(event.relatedTarget)) closeLanguagePicker(false);
    });
  }

  // Instalar o listener antes de navegar evita perder o handshake de uma página em cache.
  var frame = document.getElementById("demo-store");
  var state = document.getElementById("demo-state");
  var fallback = document.getElementById("demo-fallback");
  var retry = document.getElementById("demo-retry");
  if (frame && state && fallback && retry) {
    var container = frame.closest(".demo-frame");
    var source = frame.dataset.src;
    var storeOrigin = new URL(source).origin;
    var ready = false;
    var timer;
    function setDemoState(status) {
      container.dataset.state = status;
      container.dataset.ready = String(status === "ready");
      container.setAttribute("aria-busy", String(status === "loading"));
      state.dataset.status = status;
      state.querySelector("span").textContent = status === "ready" ? copy.demoReady : status === "error" ? copy.demoError : copy.demoLoading;
      fallback.dataset.visible = String(status === "error");
      frame.tabIndex = status === "ready" ? 0 : -1;
      if (status !== "loading") clearTimeout(timer);
    }
    function connectDemo() {
      ready = false;
      clearTimeout(timer);
      setDemoState("loading");
      timer = window.setTimeout(function () { if (!ready) setDemoState("error"); }, 18000);
      frame.src = source;
    }
    window.addEventListener("message", function (event) {
      if (event.origin !== storeOrigin || event.source !== frame.contentWindow) return;
      if (!event.data || event.data.type !== "zyon-demo-ready" || event.data.version !== 1) return;
      ready = true;
      setDemoState("ready");
    });
    frame.addEventListener("load", function () {
      if (frame.contentWindow) frame.contentWindow.postMessage({ type: "zyon-demo-ping", version: 1 }, storeOrigin);
    });
    frame.addEventListener("error", function () { setDemoState("error"); });
    retry.addEventListener("click", function () {
      state.tabIndex = -1;
      state.focus({ preventScroll: true });
      connectDemo();
    });
    connectDemo();
  }

  var steps = copy.decisionSteps;
  var tabs = Array.from(document.querySelectorAll("[data-step]"));
  function selectStep(index, focus) {
    tabs.forEach(function (tab, i) { tab.setAttribute("aria-selected", String(i === index)); tab.tabIndex = i === index ? 0 : -1; });
    document.getElementById("decision-panel").setAttribute("aria-labelledby", "decision-tab-" + index);
    document.getElementById("decision-title").textContent = steps[index][0];
    document.getElementById("decision-description").textContent = steps[index][1];
    document.querySelector(".decision-icon").textContent = steps[index][2];
    document.dispatchEvent(new CustomEvent("zyon:decision-change"));
    if (focus) tabs[index].focus();
  }
  tabs.forEach(function (tab, index) {
    tab.addEventListener("click", function () { selectStep(index, false); });
    tab.addEventListener("keydown", function (event) {
      var next = index;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault(); selectStep(next, true);
    });
  });

  var discount = document.getElementById("margin-discount");
  if (discount) discount.addEventListener("input", function () {
    var value = Number(discount.value);
    var margin = (40 - value) / (100 - value) * 100;
    document.getElementById("discount-value").value = value + "%";
    document.querySelector(".margin-discount").style.transform = "scaleX(" + value / 100 + ")";
    document.querySelector(".margin-profit").style.transform = "scaleX(" + (40 - value) / 100 + ")";
    discount.closest(".margin-demo").dataset.allowed = String(margin >= 25);
    var formattedMargin = margin.toFixed(1).replace(".", language === "en" ? "." : ",");
    document.getElementById("margin-result").textContent = (margin >= 25 ? copy.marginAllowed : copy.marginBlocked).replace("{margin}", formattedMargin);
  });

  // As linhas acompanham a identidade da marca e pausam fora da tela.
  var canvas = document.getElementById("wave-field");
  var context = canvas && canvas.getContext("2d");
  if (!context) return;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  function motionDisabled() { return reduced.matches || document.documentElement.dataset.motion === "paused"; }
  var width = 0, height = 0, raf = 0, visible = true;
  var pointer = { x: -1000, y: -1000 };
  function resize() {
    var ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    width = canvas.clientWidth; height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw(0);
  }
  function draw(time) {
    context.clearRect(0, 0, width, height);
    context.strokeStyle = "rgba(173,226,193,.34)";
    context.lineWidth = .7;
    var fieldHeight = Math.min(height, 1050);
    for (var x = -80; x <= width + 80; x += width < 721 ? 24 : 18) {
      context.beginPath();
      for (var y = -20; y <= fieldHeight + 20; y += 12) {
        var wave = Math.sin(x * .004 + y * .006 + time * .00016) * 21
          + Math.cos(y * .008 - time * .0001 + x * .002) * 16;
        var distance = Math.hypot(x - pointer.x, y - pointer.y);
        var bend = motionDisabled() ? 0 : Math.max(0, 1 - distance / 190) * 26;
        if (y === -20) context.moveTo(x + wave + bend, y);
        else context.lineTo(x + wave + bend, y);
      }
      context.stroke();
    }
  }
  var lastDraw = 0;
  function tick(time) { if (time - lastDraw >= 32) { draw(time); lastDraw = time; } raf = requestAnimationFrame(tick); }
  function sync() {
    cancelAnimationFrame(raf);
    if (!motionDisabled() && visible && !document.hidden) raf = requestAnimationFrame(tick);
    else if (motionDisabled()) draw(0);
  }
  canvas.parentElement.addEventListener("pointermove", function (event) {
    var rect = canvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left; pointer.y = event.clientY - rect.top;
  }, { passive: true });
  canvas.parentElement.addEventListener("pointerleave", function () { pointer.x = -1000; });
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; sync(); }).observe(canvas);
  reduced.addEventListener("change", sync);
  document.addEventListener("zyon:motion-change", sync);
  document.addEventListener("visibilitychange", sync);
  var voice = document.querySelector(".voice-section");
  var voiceVisible = false;
  function syncVoice() { if (voice) voice.dataset.visible = String(voiceVisible && !document.hidden); }
  if (voice) new IntersectionObserver(function (entries) { voiceVisible = entries[0].isIntersecting; syncVoice(); }).observe(voice);
  document.addEventListener("visibilitychange", syncVoice);
  resize(); sync();
})();
