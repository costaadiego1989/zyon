window.FB={
  init(){},
  login(callback){
    callback({authResponse:{code:"local-sdk-authorization"}});
    window.dispatchEvent(new MessageEvent("message",{origin:"https://www.facebook.com",data:{
      type:"WA_EMBEDDED_SIGNUP",event:"FINISH",data:{is_on_biz_app:false,business_id:"100003",phone_number_id:"100004",messaging_account_ids:["100005","100006"]}
    }}));
  }
};
