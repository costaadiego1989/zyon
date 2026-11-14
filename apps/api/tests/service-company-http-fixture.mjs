import assert from 'node:assert/strict';

export const sqlText=value=>"'"+String(value).replaceAll("'","''")+"'";
export function companyHttpFixture(runtime){
  const request=async(path,body,token,method='PUT',extraHeaders={})=>{
    const response=await fetch(runtime.apiOrigin+path,{method,redirect:'error',signal:AbortSignal.timeout(15_000),
      headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...extraHeaders},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const text=await response.text();return {status:response.status,body:text?JSON.parse(text):null,headers:response.headers};
  };
  const register=async(email,mode='services')=>{
    const response=await request('/auth/register',{merchant_name:'Empresa Sintética',email,password:'SyntheticPassword123!',business_mode:mode},undefined,'POST');
    assert.equal(response.status,201,JSON.stringify(response.body));return response.body;
  };
  const json=async sql=>JSON.parse(await runtime.db.sql(sql));
  return{request,register,json};
}
