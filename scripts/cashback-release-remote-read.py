from pathlib import Path
import base64,gzip,json,re,subprocess,sys

root=Path(__file__).resolve().parents[1]
evidence=root/'.specs/features/cashback-release/evidence'
phase, deployment, source, name=sys.argv[1:]
assert phase in ('homolog','production') and re.fullmatch(r'[a-f0-9-]{36}',deployment)
assert re.fullmatch(r'[a-z0-9-]+',name)
env='a347216c-86e3-4a75-8d73-5ae6e122408c' if phase=='homolog' else '604c900d-afcd-4e98-b5b5-d3a1a428997c'
project='b8421237-6557-4677-a08c-c93453b08568'; service='2fcb2906-32f3-45df-a3ce-767064b49b98'
cli='C:/Users/Admin/AppData/Roaming/npm/node_modules/@railway/cli/bin/railway.exe'
key='C:/Users/Admin/.ssh/zyon_revenue_notice_20261005'
r=subprocess.run([cli,'ssh','config','-p',project,'-s',service,'-e',env,'-i',key,'--alias','cashback-release','--dry-run'],
                 capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=30,check=True)
assert re.search(r'^\s*HostName ssh\.railway\.com\s*$',r.stdout,re.M)
user=re.search(r'^\s*User ([a-f0-9-]{36})\s*$',r.stdout,re.M).group(1)
guard=f"if(process.env.RAILWAY_PROJECT_ID!=={json.dumps(project)}||process.env.RAILWAY_ENVIRONMENT_ID!=={json.dumps(env)}||process.env.RAILWAY_SERVICE_ID!=={json.dumps(service)}||process.env.RAILWAY_DEPLOYMENT_ID!=={json.dumps(deployment)})throw Error('remote_target_identity_mismatch');\n"
code=guard+Path(source).read_text(encoding='utf-8-sig')
encoded=base64.b64encode(gzip.compress(code.encode())).decode()
bootstrap="eval(process.getBuiltinModule('zlib').gunzipSync(Buffer.from(process.argv[1],'base64')).toString())"
# Double-quoted command text contains only a fixed bootstrap and base64 alphabet.
command='node -e '+json.dumps(bootstrap)+' '+encoded
args=['ssh','-4','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','-o','IdentitiesOnly=yes',
      '-i',key,user+'@ssh.railway.com',command]
r=subprocess.run(args,stdin=subprocess.DEVNULL,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=55)
records=[]
for line in r.stdout.splitlines():
    try:records.append(json.loads(line.lstrip('\ufeff')))
    except ValueError:pass
if r.returncode or not records:
    record={'phase':phase,'deploymentId':deployment,'readCompleted':False,'exitCode':r.returncode,'recordCount':len(records),
            'errorCode':'remote_read_failed_details_redacted'}
else:record=records[-1]
(evidence/(name+'.json')).write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'phase':phase,'deploymentId':deployment,'readCompleted':r.returncode==0 and bool(records),'output':str(evidence/(name+'.json'))}))
sys.exit(0 if r.returncode==0 and records else 1)
