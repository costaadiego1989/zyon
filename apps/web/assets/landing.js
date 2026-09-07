(function () {
  "use strict";
  document.getElementById("year").textContent = String(new Date().getFullYear());
  var frame = document.getElementById("demo-store");
  var state = document.getElementById("demo-state");
  var fallback = document.getElementById("demo-fallback");
  var ready = false;
  var storeOrigin = new URL(frame.src).origin;
  var timer = window.setTimeout(function () {
    if (!ready) {
      fallback.dataset.visible = "true";
      state.querySelector("span").textContent = "Demonstração indisponível";
    }
  }, 14000);
  window.addEventListener("message", function (event) {
    if (event.origin !== storeOrigin || event.source !== frame.contentWindow) return;
    if (!event.data || event.data.type !== "zyon-demo-ready" || event.data.version !== 1) return;
    ready = true;
    clearTimeout(timer);
    frame.closest(".demo-frame").dataset.ready = "true";
    state.dataset.status = "online";
    state.querySelector("span").textContent = "Loja ao vivo";
    fallback.dataset.visible = "false";
  });

  var steps = [
    ["“Gostei. Tem alguma condição melhor?”", "O motor identifica uma objeção de preço e considera o produto e o carrinho antes de propor uma condição.", "“"],
    ["A condição passa pelas regras da loja.", "Desconto máximo, margem mínima, estoque e frete são verificados. Uma sugestão da IA só vira oferta quando os limites permitem.", "✓"],
    ["Uma proposta com o próximo passo claro.", "Com a condição validada, a Zyon apresenta a oferta e conduz o cliente ao checkout. Se não houver margem, explica as opções disponíveis.", "↗"]
  ];
  var tabs = Array.from(document.querySelectorAll("[data-step]"));
  function selectStep(index, focus) {
    tabs.forEach(function (tab, i) { tab.setAttribute("aria-selected", String(i === index)); tab.tabIndex = i === index ? 0 : -1; });
    document.getElementById("decision-panel").setAttribute("aria-labelledby", "decision-tab-" + index);
    document.getElementById("decision-title").textContent = steps[index][0];
    document.getElementById("decision-description").textContent = steps[index][1];
    document.querySelector(".decision-icon").textContent = steps[index][2];
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
    document.querySelector(".margin-discount").style.flexBasis = value + "%";
    document.querySelector(".margin-profit").style.flexBasis = (40 - value) + "%";
    document.getElementById("margin-result").textContent = margin >= 25
      ? "Condição permitida: margem de " + margin.toFixed(1).replace(".", ",") + "%, respeitando o mínimo de 25%."
      : "Condição bloqueada: margem de " + margin.toFixed(1).replace(".", ",") + "%, abaixo do mínimo de 25%.";
  });

  // Dense flowing lines echo the dashboard signup waves. Pointer movement bends
  // the field; offscreen and hidden tabs pause work, reduced motion stays static.
  var canvas = document.getElementById("wave-field");
  var context = canvas && canvas.getContext("2d");
  if (!context) return;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
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
    context.strokeStyle = "rgba(173,226,193,.24)";
    context.lineWidth = .7;
    var fieldHeight = Math.min(height, 1050);
    for (var x = -80; x <= width + 80; x += 14) {
      context.beginPath();
      for (var y = -20; y <= fieldHeight + 20; y += 12) {
        var wave = Math.sin(x * .004 + y * .006 + time * .00016) * 21
          + Math.cos(y * .008 - time * .0001 + x * .002) * 16;
        var distance = Math.hypot(x - pointer.x, y - pointer.y);
        var bend = reduced.matches ? 0 : Math.max(0, 1 - distance / 190) * 26;
        if (y === -20) context.moveTo(x + wave + bend, y);
        else context.lineTo(x + wave + bend, y);
      }
      context.stroke();
    }
  }
  function tick(time) { draw(time); raf = requestAnimationFrame(tick); }
  function sync() {
    cancelAnimationFrame(raf);
    if (!reduced.matches && visible && !document.hidden) raf = requestAnimationFrame(tick);
    else if (reduced.matches) draw(0);
  }
  canvas.parentElement.addEventListener("pointermove", function (event) {
    var rect = canvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left; pointer.y = event.clientY - rect.top;
  }, { passive: true });
  canvas.parentElement.addEventListener("pointerleave", function () { pointer.x = -1000; });
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; sync(); }).observe(canvas);
  reduced.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
  resize(); sync();
})();
