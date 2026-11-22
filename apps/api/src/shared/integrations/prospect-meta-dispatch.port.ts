export const PROSPECT_META_DISPATCH=Symbol("ProspectMetaDispatch");
export interface ProspectMetaChange {
  appId:string|undefined;
  wabaId:string|undefined;
  phoneNumberId:string;
  value:{contacts?:unknown[];messages?:unknown[];statuses?:unknown[]};
}
export interface ProspectMetaDispatchPort {
  accept(change:ProspectMetaChange):Promise<boolean>;
}
