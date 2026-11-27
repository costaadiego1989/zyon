import { BadRequestException,ConflictException,NotFoundException,ServiceUnavailableException,HttpException } from "@nestjs/common";
export function prospectingHttpError(error:unknown):never {
  if(error instanceof HttpException)throw error;
  const code=error instanceof Error?error.message:"prospecting_unavailable";
  if(/^(invalid_|manifest_invalid|manifest_incomplete|source_not_allowed|parser_version_unsupported)/.test(code))throw new BadRequestException(code);
  if(/^(conversation_not_found|import_not_found|company_not_found|manifest_not_found|prospect_not_found|endpoint_not_found|segment_not_found|selection_not_found|campaign_not_found|command_not_found)/.test(code))throw new NotFoundException(code);
  if(code.startsWith("limits_missing:"))throw new BadRequestException(code);
  if(/^(signup_state_invalid|provider_policy_blocked|no_opt_in|approval_stale|limits_missing|sender_identity_mismatch|template_binding_mismatch|template_unavailable|permission_unavailable|portfolio_limit|quality_restricted|reply_budget_unavailable|cost_unknown|sender_unavailable|suppressed|outside_send_window|workers_disabled|dispatch_disabled|model_disabled|knowledge_unavailable|offer_unavailable)$/.test(code))throw new ConflictException(code);
  if(/conflict|import_busy|ingestion_disabled|snapshot_not_writable|import_not_resumable|import_superseded/.test(code))throw new ConflictException(code);
  throw new ServiceUnavailableException(/^(source_unavailable|directory_unavailable|snapshot_unavailable|config_invalid)/.test(code)?code:"prospecting_unavailable");
}
export function requestText(value:unknown,name:string,maximum=200):string|undefined {
  if(value===undefined)return undefined;if(typeof value!=="string"||!value||value.length>maximum)throw new BadRequestException(`invalid_filter:${name}`);return value;
}
export function requestLimit(value:unknown):number|undefined {if(value===undefined)return undefined;if(typeof value!=="string"||!/^\d{1,3}$/.test(value))throw new BadRequestException("invalid_filter:limit");return Number(value);}
export function requestKeys(value:Record<string,unknown>,keys:string[]){if(Object.keys(value).some(key=>!keys.includes(key)))throw new BadRequestException("invalid_filter:unknown_parameter");}
export function requestCommand<T>(body:unknown,key:string|undefined,keys:string[]):T {
  if(!body||typeof body!=="object"||Array.isArray(body))throw new BadRequestException("invalid_command");
  const input=body as Record<string,unknown>;requestKeys(input,["clientRequestId",...keys]);
  if(key!==undefined&&input.clientRequestId!==undefined&&key!==input.clientRequestId)throw new BadRequestException("invalid_command:clientRequestId");
  const clientRequestId=input.clientRequestId??key;
  if(typeof clientRequestId!=="string"||!/^[-A-Za-z0-9_.:]{1,160}$/.test(clientRequestId))throw new BadRequestException("invalid_command:clientRequestId");
  return {...input,clientRequestId} as T;
}
