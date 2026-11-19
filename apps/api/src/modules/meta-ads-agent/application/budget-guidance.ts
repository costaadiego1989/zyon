import type {MetaAdsBudget} from '@zyon/shared-types';

export interface BudgetAccountContext {accountId:string;currency?:string|null;minimumDailyBudgetCents?:number|null;}
/** Account floor is authoritative for daily budgets. The period equivalent is only an estimate. */
export function assessBudget(budget:Pick<MetaAdsBudget,'amountCents'|'cadence'|'currency'>&Partial<Pick<MetaAdsBudget,'startsAt'|'endsAt'>>,context:BudgetAccountContext,checkedAt:string){
 const minimum=context.currency===budget.currency&&Number.isSafeInteger(context.minimumDailyBudgetCents)&&context.minimumDailyBudgetCents!>0?context.minimumDailyBudgetCents!:null;
 const days=budget.cadence==='daily'?1:budget.endsAt&&budget.startsAt?(Date.parse(budget.endsAt)-Date.parse(budget.startsAt))/86400000:null;
 const equivalent=days!==null&&days>0?budget.amountCents/days:null;
 const status=minimum===null?'minimum_unavailable':equivalent===null?'period_unavailable':equivalent<minimum?budget.cadence==='daily'?'below_account_minimum':'below_estimated_period_minimum':'account_floor_met';
 return{accountId:context.accountId,currency:budget.currency,minimumDailyBudgetCents:minimum,checkedAt,status,dailyEquivalentCents:equivalent===null?null:Math.round(equivalent),estimatedMinimumTotalCents:minimum!==null&&days!==null&&days>0?Math.ceil(minimum*days):null,finalMetaValidationRequired:true,performanceGuaranteed:false};
}
