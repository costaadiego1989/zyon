(() => {
  const root = document.querySelector(".pricing-cycle");
  if (!root) return;
  const money = cents => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const notice = document.querySelector(".pricing-availability");
  const annualButton = root.querySelector('[data-cycle="annual"]');
  const volume = document.querySelector("#billing-volume");
  const ticket = document.querySelector("#billing-ticket");
  let plans = [], cycle = "monthly";
  const offerFor = plan => plan.billing_options?.find(o => o.cycle === (plan.plan_id === "starter" ? "monthly" : cycle));
  function estimate() {
    const rows = document.querySelector("#billing-estimates");
    rows.replaceChildren();
    const orders = Number(volume.value), average = Number(ticket.value);
    if (!volume.value || !ticket.value || !volume.checkValidity() || !ticket.checkValidity() || !Number.isSafeInteger(orders) || !Number.isFinite(average)) {
      document.querySelector("#billing-simulation-note").textContent = "Informe valores válidos: compras inteiras e ticket maior ou igual a zero.";
      return;
    }
    document.querySelector("#billing-simulation-note").textContent = "Estimativa após o período gratuito, sem taxas do provedor, serviço do comprador ou implantação. No anual, a assinatura aparece como equivalente mensal, mas é paga de uma vez.";
    for (const plan of plans) {
      const offer = offerFor(plan);
      const cost = offer ? offer.amountCents / (offer.cycle === "annual" ? 12 : 1) + orders * plan.transaction_fee_cents : null;
      const limit = plan.limits?.ordersPerMonth;
      const row = document.createElement("tr");
      for (const value of [plan.name, cost === null ? "Indisponível" : money(Math.round(cost)), cost !== null && orders * average > 0 ? (cost / (orders * average)).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%" : "—", limit == null || limit < 0 || orders <= limit ? "Atende ao volume" : "Acima do limite"]) {
        const cell = document.createElement("td"); cell.textContent = value; row.append(cell);
      }
      rows.append(row);
    }
  }
  function render() {
    root.querySelectorAll("button").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.cycle === cycle)));
    for (const plan of plans) {
      const card = document.querySelector('[data-plan="' + plan.plan_id + '"]');
      if (!card) continue;
      const offer = offerFor(plan);
      const price = card.querySelector(".plan-price");
      const annual = card.querySelector(".plan-annual");
      const link = card.querySelector("a.button");
      price.replaceChildren(document.createTextNode(offer ? money(offer.equivalentMonthlyCents) + " " : "Indisponível "));
      const unit = document.createElement("small"); unit.textContent = "/mês"; price.append(unit);
      annual.hidden = plan.plan_id === "starter" || cycle !== "annual";
      annual.textContent = offer ? "Total anual: " + money(offer.amountCents) + ". Economia de " + money(offer.savingsCents) + " (" + offer.discountPercent + "%)." : "Anual indisponível.";
      if (plan.plan_id !== "starter") card.querySelector(".plan-fee").textContent = money(plan.transaction_fee_cents) + " por compra confirmada.";
      const url = new URL(link.href); url.searchParams.set("cycle", plan.plan_id === "starter" ? "monthly" : cycle); link.href = url.href;
      link.setAttribute("aria-disabled", String(!offer));
      link.onclick = event => { if (!offer) event.preventDefault(); };
    }
    estimate();
  }
  root.addEventListener("click", event => {
    const button = event.target.closest("button[data-cycle]");
    if (!button || button.disabled) return;
    cycle = button.dataset.cycle; render();
  });
  volume.addEventListener("input", estimate); ticket.addEventListener("input", estimate);
  fetch(root.dataset.catalogUrl, { credentials: "omit" }).then(response => {
    if (!response.ok) throw Error("catalog");
    return response.json();
  }).then(payload => {
    plans = Array.isArray(payload) ? payload : payload.data;
    if (!Array.isArray(plans) || !["starter", "growth", "scale"].every(key => plans.some(p => p.plan_id === key && p.billing_options?.some(o => o.cycle === "monthly")))) throw Error("catalog");
    const paid = plans.filter(p => p.plan_id !== "starter");
    const available = paid.every(p => p.annual_checkout_available && p.billing_options?.some(o => o.cycle === "annual"));
    annualButton.disabled = !available;
    const discount = paid[0]?.billing_options?.find(o => o.cycle === "annual")?.discountPercent;
    annualButton.textContent = "Anual" + (available && discount > 0 ? " · " + discount + "% de desconto" : "");
    notice.textContent = available ? "Anual com pagamento único. As cotas de compras continuam mensais." : "Contratação anual em breve. Os planos mensais estão disponíveis.";
    document.querySelector(".pricing-simulator").hidden = false;
    render();
  }).catch(() => { notice.textContent = "Confira a disponibilidade do anual e os valores atualizados no cadastro."; });
})();
