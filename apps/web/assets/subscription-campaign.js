(() => {
  "use strict";
  const panels = [...document.querySelectorAll("[data-subscription-campaign]")];
  const bar = document.querySelector(".subscription-promo-top");
  if (!panels.length || !bar) return;
  const plans = { starter179: { name: "Starter", cents: 17900 }, growth: { name: "Growth", cents: 44900 }, scale: { name: "Scale", cents: 74900 } };
  let campaigns = [];
  const money = cents => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const duration = p => p.duration === "once" ? "na primeira mensalidade" : p.duration === "repeating" ? `nos ${p.durationMonths} primeiros meses` : "enquanto a assinatura existir";
  const discount = p => p.discountType === "percent" ? `${p.discountValue / 100}% de desconto` : `${money(p.discountValue)} de desconto`;
  const text = (selector, value) => document.querySelectorAll(selector).forEach(element => { element.textContent = value; });
  const offset = () => document.documentElement.style.setProperty("--subscription-promo-offset", `${bar.hidden ? 0 : Math.ceil(bar.getBoundingClientRect().height)}px`);
  const valid = p => /^[A-Z0-9-]{3,40}$/.test(p.code ?? "") && typeof p.name === "string" && Array.isArray(p.plans) && p.plans.length > 0 && p.plans.every(plan => Object.hasOwn(plans, plan)) && ["percent", "fixed"].includes(p.discountType) && Number.isSafeInteger(p.discountValue) && p.discountValue > 0 && (p.discountType !== "percent" || p.discountValue <= 10000) && ["once", "repeating", "forever"].includes(p.duration) && (p.duration !== "repeating" || Number.isInteger(p.durationMonths) && p.durationMonths > 0) && Number.isFinite(Date.parse(p.startsAt)) && Number.isFinite(Date.parse(p.expiresAt));
  const active = p => Date.parse(p.startsAt) <= Date.now() && Date.parse(p.expiresAt) > Date.now();
  const refresh = () => {
    const eligible = campaigns.filter(active), campaign = eligible[0];
    const monthly = document.querySelector(".billing-switch")?.dataset.cycle !== "annual";
    const visible = !!campaign;
    panels.forEach(panel => { panel.hidden = !visible; });
    document.body.classList.toggle("has-subscription-promo", visible); offset();
    if (campaign) {
      text("[data-subscription-campaign-name]", campaign.name);
      text("[data-subscription-campaign-discount]", `${discount(campaign)} ${duration(campaign)}.`);
      text("[data-subscription-campaign-plans]", `Válido para ${campaign.plans.map(plan => plans[plan].name).join(", ")} no mensal.`);
      text("[data-subscription-campaign-terms]", `Para novas assinaturas mensais.${campaign.firstTimeOnly ? " Apenas para clientes sem pagamentos anteriores." : ""}${campaign.duration !== "forever" ? " Ao terminar o desconto, volta ao valor integral do plano." : ""} As taxas por compra permanecem iguais.`);
      text("[data-subscription-coupon-expiry]", new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.parse(campaign.expiresAt) - 1)));
      const firstPlan = Object.keys(plans).find(plan => campaign.plans.includes(plan));
      document.querySelectorAll("[data-subscription-campaign-link]").forEach(link => { link.href = `https://app.zyon-payments.com.br/?mode=signup&plan=${firstPlan}&cycle=monthly`; });
    }
    for (const [plan, config] of Object.entries(plans)) {
      const card = document.querySelector(`[data-offer="${plan}"]`); if (!card) continue;
      let offer = card.querySelector(".subscription-plan-discount");
      const promotion = monthly ? eligible.find(p => p.plans.includes(plan)) : undefined;
      if (!offer) { offer = document.createElement("div"); offer.className = "subscription-plan-discount"; card.querySelector(".plan-price-accessible").after(offer); }
      offer.hidden = !promotion; card.classList.toggle("has-subscription-campaign", !!promotion);
      if (promotion) {
        const cents = config.cents - (promotion.discountType === "percent" ? Math.round(config.cents * promotion.discountValue / 10000) : promotion.discountValue);
        offer.replaceChildren();
        const price = document.createElement("strong"); price.textContent = `${money(Math.max(0, cents))}/mês`;
        const terms = document.createElement("p"); terms.textContent = `${promotion.name} · ${duration(promotion)}.${promotion.duration !== "forever" ? ` Depois, ${money(config.cents)}/mês.` : ""}`;
        offer.append(price, terms);
      }
    }
  };
  new ResizeObserver(offset).observe(bar);
  const load = async () => {
    try {
      const response = await fetch("https://api.zyon-payments.com.br/v1/billing/promotions/automatic", { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("campaign_unavailable");
      const value = await response.json(), payload = value.data ?? value;
      if (!Array.isArray(payload.campaigns)) throw new Error("campaign_invalid");
      campaigns = payload.campaigns.filter(valid); refresh();
    } catch { campaigns = []; refresh(); }
  };
  void load(); setInterval(() => void load(), 60000); setInterval(refresh, 30000);
  const billingSwitch = document.querySelector(".billing-switch");
  if (billingSwitch) new MutationObserver(refresh).observe(billingSwitch, { attributes: true, attributeFilter: ["data-cycle"] });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void load(); });
})();
