import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
export type ToolAuthorizer = (input:{tool:string;merchantId?:string})=>Promise<void>;
export const rejectUnauthenticated: ToolAuthorizer = async()=>{throw new McpError(ErrorCode.InvalidRequest,"mcp_authenticated_access_required");};
/** The API derives identity and tenant from the credential, never tool arguments. */
export function remoteToolAuthorizer(options:{baseUrl?:string;apiKey?:string;bearerToken?:string;fetchFn?:typeof fetch}={}):ToolAuthorizer {
  const base=options.baseUrl??process.env.AACP_API_URL??"http://localhost:3000";
  const key=options.apiKey??process.env.AACP_API_KEY;
  const bearer=options.bearerToken??process.env.AACP_API_TOKEN;
  if(!key&&!bearer)return rejectUnauthenticated;
  const url=new URL("/v1/ai-governance/tools/authorize",base);
  if(url.protocol!=="https:"&&!["localhost","127.0.0.1","[::1]"].includes(url.hostname))throw new Error("mcp_authorization_requires_https");
  return async input=>{
    let response:Response;
    try { response=await(options.fetchFn??fetch)(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(10000),
      headers:{"Content-Type":"application/json",...(key?{"x-aacp-api-key":key}:{Authorization:"Bearer "+bearer})},body:JSON.stringify(input)}); }
    catch {throw new McpError(ErrorCode.InvalidRequest,"mcp_authorization_unavailable");}
    if(!response.ok)throw new McpError(ErrorCode.InvalidRequest,"mcp_access_denied");
    const result=await response.json() as {allowed?:boolean;merchantId?:string};
    if(result.allowed!==true||typeof result.merchantId!=="string"||(input.merchantId&&input.merchantId!==result.merchantId))
      throw new McpError(ErrorCode.InvalidRequest,"mcp_tenant_scope_invalid");
  };
}
