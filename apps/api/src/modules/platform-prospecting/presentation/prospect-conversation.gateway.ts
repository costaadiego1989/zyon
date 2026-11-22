import {Inject,type OnModuleInit,type OnModuleDestroy} from "@nestjs/common";
import {ConnectedSocket,MessageBody,SubscribeMessage,WebSocketGateway,type OnGatewayConnection,type OnGatewayDisconnect} from "@nestjs/websockets";
import type {Socket} from "socket.io";
import {randomUUID} from "node:crypto";
import {resolveCorsConfig} from "../../../shared/config/cors-config.js";
import {isRealtimeOriginAllowed} from "../../../shared/auth/realtime-capability.js";
import {PlatformJwtService} from "../../platform-control/domain/services/platform-jwt.service.js";
import {hasPlatformPermission} from "../../platform-control/domain/platform-operator.js";
import {ProspectConversationService} from "../application/conversations/prospect-conversation.service.js";
import {requestCommand,requestKeys} from "./prospecting-http-error.js";

interface Connection{token:string;timer:ReturnType<typeof setTimeout>;watch?:{id:string;cursor:number}}
function conversationId(value:unknown){
 if(typeof value!=="string"||!value.trim()||value.length>200)throw Error("invalid_command:conversationId");return value;
}
@WebSocketGateway({namespace:"/platform-prospecting",cors:resolveCorsConfig(),maxHttpBufferSize:16384,transports:["websocket"]})
export class ProspectConversationGateway implements OnGatewayConnection,OnGatewayDisconnect,OnModuleInit,OnModuleDestroy{
 private readonly clients=new Map<Socket,Connection>();
 private interval?:ReturnType<typeof setInterval>;
 private flushing?:Promise<void>;
 constructor(@Inject(PlatformJwtService)private readonly jwt:PlatformJwtService,@Inject(ProspectConversationService)private readonly service:ProspectConversationService){}
 onModuleInit(){this.interval=setInterval(()=>{void this.flush();},1000);this.interval.unref();}
 async onModuleDestroy(){clearInterval(this.interval);for(const s of this.clients.keys())s.disconnect(true);await this.flushing;}
 private async principal(token:string){
  const principal=await this.jwt.authenticate(token);
  if(!hasPlatformPermission(principal.role,"platform:prospecting:read"))throw Error("forbidden");
  return principal;
 }
 async handleConnection(socket:Socket){
  try{
   const token=socket.handshake.auth?.accessToken,origin=socket.handshake.headers.origin;
   if(this.clients.size>=2000||typeof token!=="string"||origin!==undefined&&!isRealtimeOriginAllowed(origin))throw Error("unauthorized");
   await this.principal(token);
   const exp=JSON.parse(Buffer.from(token.split(".")[1],"base64url").toString()).exp;
   const ttl=exp*1000-Date.now();if(!socket.connected||!Number.isSafeInteger(exp)||ttl<=0||ttl>2147483647)throw Error("unauthorized");
   const timer=setTimeout(()=>socket.disconnect(true),ttl);timer.unref();
   this.clients.set(socket,{token,timer});socket.emit("authenticated",{kind:"operator"});
  }catch{socket.disconnect(true);}
 }
 handleDisconnect(socket:Socket){const state=this.clients.get(socket);if(state)clearTimeout(state.timer);this.clients.delete(socket);}
 private async authorize(socket:Socket){
  try{const state=this.clients.get(socket);if(!state)throw Error("unauthorized");return await this.principal(state.token);}
  catch{socket.disconnect(true);throw Error("unauthorized");}
 }
 @SubscribeMessage("watch")
 async watch(@ConnectedSocket() socket:Socket,@MessageBody() data:Record<string,unknown>){
  try{
   await this.authorize(socket);requestKeys(data,["conversationId","after"]);
   const id=conversationId(data.conversationId),cursor=data.after??0;if(typeof cursor!=="number"||!Number.isSafeInteger(cursor)||cursor<0)throw Error("invalid_cursor");
   await this.service.repository.changes(id,cursor,1);
   const state=this.clients.get(socket);if(!state)throw Error("unauthorized");state.watch={id,cursor};
   return {success:true};
  }catch{return {success:false};}
 }
 @SubscribeMessage("mark_read")
 async markRead(@ConnectedSocket() socket:Socket,@MessageBody() data:unknown){
  try{
   const principal=await this.authorize(socket);
   const cmd=requestCommand<{conversationId:string;clientRequestId:string;sequence:number}>(data,undefined,["conversationId","sequence"]);
   const result=await this.service.markRead(conversationId(cmd.conversationId),{clientRequestId:cmd.clientRequestId,sequence:cmd.sequence},{operatorId:principal.operatorId,correlationId:randomUUID()});
   return {success:true,...result};
  }catch{return {success:false};}
 }
 flush(){
  if(!this.flushing)this.flushing=this.notify().finally(()=>{this.flushing=undefined;});
  return this.flushing;
 }
 private async notify(){
  const pages=new Map<string,ReturnType<ProspectConversationService["repository"]["changes"]>>();
  await Promise.allSettled([...this.clients].map(async([socket,state])=>{
   const watch=state.watch;if(!watch)return;
   const key=JSON.stringify([watch.id,watch.cursor]);
   let page=pages.get(key);if(!page){page=this.service.repository.changes(watch.id,watch.cursor,50);pages.set(key,page);}
   const events=await page;if(!events.items.length)return;
   for(const event of events.items){
    await this.authorize(socket);
    if(!socket.connected||state.watch!==watch)return;
    socket.emit("prospect_changed",event);watch.cursor=Number(event.cursor);
   }
  }));
 }
}
