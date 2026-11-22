import type {PrismaProspectConversationRepository} from "../../infrastructure/conversations/prisma-prospect-conversation.repository.js";
export class ProcessProspectInbound{
 constructor(private readonly repository:PrismaProspectConversationRepository){}
 async process(id:string){
  const row=await this.repository.db.prospectInboxEvent.findUniqueOrThrow({where:{id},select:{eventKind:true,state:true}});
  if(row.state==="processed")return "processed";
  return row.eventKind==="status"?this.repository.processStatus(id):this.repository.processInbound(id);
 }
 async processNext(limit=25){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error("invalid_command:limit");
  const rows=await this.repository.db.prospectInboxEvent.findMany({where:{state:{in:["pending","awaiting_correlation"]},nextAttemptAt:{lte:new Date()}},orderBy:[{nextAttemptAt:"asc"},{id:"asc"}],take:limit});
  for(const row of rows){
   const state=await this.process(row.id);
   if(state==="unmatched")await this.repository.db.prospectInboxEvent.updateMany({where:{id:row.id,state:{in:["pending","awaiting_correlation"]}},data:{state:"awaiting_correlation",nextAttemptAt:new Date(Date.now()+60_000)}});
  }
  return rows.length;
 }
}
