const fs=require('node:fs'),path=require('node:path');

function writeWorkerStatus(folder,state,files=fs){
 const temporary=path.join(folder,'status.'+process.pid+'.pending');
 try{
  files.writeFileSync(temporary,JSON.stringify(state,null,2));
  files.renameSync(temporary,path.join(folder,'status.json'));
  return true;
 }catch(error){
  // Windows readers can briefly deny replacement. Keep the last complete status
  // and retry on the next update; telemetry contention must not abort a DB batch.
  if(['EPERM','EBUSY','EACCES'].includes(error.code))return false;
  throw error;
 }
}
module.exports={writeWorkerStatus};
