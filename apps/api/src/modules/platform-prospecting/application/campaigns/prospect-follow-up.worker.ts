import type {ProspectDispatchWorker} from "./prospect-dispatch.worker.js";
interface FollowUpCandidates {
 followUpCandidates(now:Date,after:string|undefined,limit:number):Promise<{id:string;recipientId:string}[]>;
}
export class ProspectFollowUpWorker {
 constructor(private readonly store:FollowUpCandidates,private readonly dispatch:Pick<ProspectDispatchWorker,"processRecipient">,private readonly clock=()=>new Date()){}
 async poll(after?:string,limit=25){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error("invalid_follow_up_limit");
  const rows=await this.store.followUpCandidates(this.clock(),after,limit);
  for(const row of rows)await this.dispatch.processRecipient(row.recipientId,1);
  return {visited:rows.length,nextCursor:rows.length===limit?rows[rows.length-1].id:null};
 }
}
