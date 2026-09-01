export function estimateMargin(cart, subsidy = 0, paymentFeeRate = 0.04) {
    // Cart may arrive with no items (e.g. tracking events fired after checkout
    // completed and the cart was cleared) — default to an empty list.
    const items = cart?.items ?? [];
    const productCost = items.reduce((sum, item) => sum + (item.cost ?? item.price * 0.5) * item.quantity, 0);
    const grossRevenue = Math.max((cart?.total ?? 0) - subsidy, 0);
    const paymentFees = grossRevenue * paymentFeeRate;
    const marginValue = grossRevenue - productCost - paymentFees;
    const marginPercent = grossRevenue > 0 ? marginValue / grossRevenue : 0;
    return { grossRevenue, productCost, paymentFees, subsidy, marginValue, marginPercent };
}
export function evaluateDiscountOffer(cart, rules, requestedPercent, maxReaisCap) {
    const percentCap = Math.min(requestedPercent, rules.maxDiscountPercent);
    const cartTotal = cart.total ?? 0;
    // Guard: cart.total <= 0 → no offer possible (avoids /0 on percent recompute).
    if (cartTotal <= 0) {
        const margin = estimateMargin(cart, 0);
        return {
            approved: false,
            type: "none",
            value: 0,
            reason: "discount_not_requested",
            marginAfterOffer: margin.marginPercent
        };
    }
    const rawValue = cartTotal * (percentCap / 100);
    let effectiveValue = rawValue;
    let effectivePercent = percentCap;
    if (maxReaisCap != null) {
        effectiveValue = Math.min(rawValue, maxReaisCap);
        effectivePercent = (effectiveValue / cartTotal) * 100;
    }
    const margin = estimateMargin(cart, effectiveValue);
    if (effectivePercent <= 0) {
        return {
            approved: false,
            type: "none",
            value: 0,
            reason: "discount_not_requested",
            marginAfterOffer: margin.marginPercent
        };
    }
    if (margin.marginPercent < rules.minimumMarginPercent / 100) {
        return {
            approved: false,
            type: "none",
            value: 0,
            reason: "minimum_margin_violation",
            marginAfterOffer: margin.marginPercent
        };
    }
    const reaisCapBit = maxReaisCap != null && effectiveValue < rawValue;
    const percentCapBit = percentCap < requestedPercent;
    const reason = reaisCapBit
        ? "capped_by_reais_limit"
        : percentCapBit
            ? "capped_by_max_discount_rule"
            : "discount_allowed";
    return {
        approved: true,
        type: "discount_percent",
        value: effectivePercent,
        reason,
        marginAfterOffer: margin.marginPercent
    };
}
