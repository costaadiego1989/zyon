import type {MetaAdsBudget,MetaAdsBudgetAssessment} from '@zyon/shared-types';

export interface BudgetAccountContext {accountId:string;currency?:string|null;minimumDailyBudgetCents?:number|null;}
export type CampaignBudgetAssessmentPort=(merchantId:string,budget:MetaAdsBudget|null)=>Promise<MetaAdsBudgetAssessment|null>;
/** Account floor is authoritative for daily budgets. The period equivalent is only an estimate. */
export function assessBudget(budget:Pick<MetaAdsBudget,'amountCents'|'cadence'|'currency'>&Partial<Pick<MetaAdsBudget,'startsAt'|'endsAt'>>,context:BudgetAccountContext,checkedAt:string):MetaAdsBudgetAssessment{
 const minimum=context.currency===budget.currency&&Number.isSafeInteger(context.minimumDailyBudgetCents)&&context.minimumDailyBudgetCents!>0?context.minimumDailyBudgetCents!:null;
 const days=budget.cadence==='daily'?1:budget.endsAt&&budget.startsAt?(Date.parse(budget.endsAt)-Date.parse(budget.startsAt))/86400000:null;
 const equivalent=days!==null&&days>0?budget.amountCents/days:null;
 const status=minimum===null?'minimum_unavailable':equivalent===null?'period_unavailable':equivalent<minimum?budget.cadence==='daily'?'below_account_minimum':'below_estimated_period_minimum':'account_floor_met';
 return{accountId:context.accountId,currency:budget.currency,minimumDailyBudgetCents:minimum,checkedAt,status,dailyEquivalentCents:equivalent===null?null:Math.round(equivalent),estimatedMinimumTotalCents:minimum!==null&&days!==null&&days>0?Math.ceil(minimum*days):null,periodDays:days,finalMetaValidationRequired:true,performanceGuaranteed:false};
}

export const needsBudgetRevision=(value:MetaAdsBudgetAssessment)=>value.status==='below_account_minimum'||value.status==='below_estimated_period_minimum';
export const budgetBlocker=(value:MetaAdsBudgetAssessment|null|undefined)=>value?.status==='below_account_minimum'?'campaign_budget_below_daily_minimum':value?.status==='below_estimated_period_minimum'?'campaign_budget_below_period_minimum':value?.status==='minimum_unavailable'?'campaign_budget_check_unavailable':null;
