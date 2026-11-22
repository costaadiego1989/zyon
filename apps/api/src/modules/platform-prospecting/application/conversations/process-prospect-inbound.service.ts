export interface ProspectInboundWork{
  event(id:string):Promise<{eventKind:string;state:string}>;
  due(limit:number):Promise<{id:string}[]>;
  awaitCorrelation(id:string):Promise<void>;
  processStatus(id:string):Promise<string>;
  processInbound(id:string):Promise<string>;
}
export class ProcessProspectInbound{
 constructor(private readonly repository:ProspectInboundWork){}
 async process(id:string){
  const row=await this.repository.event(id);
  if(row.state==="processed")return "processed";
  return row.eventKind==="status"?this.repository.processStatus(id):this.repository.processInbound(id);
 }
 async processNext(limit=25){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error("invalid_command:limit");
  const rows=await this.repository.due(limit);
  for(const row of rows){
   const state=await this.process(row.id);
   if(state==="unmatched")await this.repository.awaitCorrelation(row.id);
  }
  return rows.length;
 }
}
