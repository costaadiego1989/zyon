from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json, subprocess
from urllib.parse import urlsplit

root=Path(__file__).resolve().parents[1]
private=root/'.audit/cashback-release-20261114/private'
private.mkdir(parents=True,exist_ok=True)
cli='C:/Users/Admin/AppData/Roaming/npm/node_modules/@railway/cli/bin/railway.exe'
project='b8421237-6557-4677-a08c-c93453b08568'
environment='a347216c-86e3-4a75-8d73-5ae6e122408c'
services={'api':'2fcb2906-32f3-45df-a3ce-767064b49b98','dashboard':'392d0c2f-651f-4614-8027-9aa6fc3bad94',
          'storefront':'0722af15-fdaa-407e-ae1a-3adb3b4f131a','widget':'ee157f03-591d-4223-8a39-ba620f552687'}
def read(item):
    name,service=item
    r=subprocess.run([cli,'variable','list','-p',project,'-e',environment,'-s',service,'--json'],capture_output=True,
                     text=True,encoding='utf-8',errors='replace',timeout=40)
    if r.returncode:raise RuntimeError('variable_inventory_failed:'+name)
    return name,json.loads(r.stdout)
with ThreadPoolExecutor(max_workers=4) as pool:
    values=dict(pool.map(read,services.items()))
public={}
for name,data in values.items():
    prefix='NEXT_PUBLIC_' if name=='storefront' else 'VITE_'
    public[name]={k:v for k,v in data.items() if k.startswith(prefix)}
    if name!='api':(private/(name+'-homolog-current-public.json')).write_text(json.dumps(public[name],indent=2)+'\n',encoding='utf-8')
db=urlsplit(values['api'].get('DATABASE_URL',''))
record={'environment':'sandbox','projectId':project,'environmentId':environment,'services':services,'readOnly':True,
        'publicVariables':public,'databaseTarget':{'host':db.hostname,'database':db.path.lstrip('/')},
        'internalServiceTokensMatch':bool(values['api'].get('INTERNAL_SERVICE_TOKEN')) and values['api'].get('INTERNAL_SERVICE_TOKEN')==values['storefront'].get('INTERNAL_SERVICE_TOKEN'),
        'apiPublicSettings':{k:values['api'].get(k) for k in ['CORS_ALLOWED_ORIGINS','AUTH_COOKIE_SAME_SITE','API_PUBLIC_URL','APP_VERSION']},
        'storefrontApiOrigin':values['storefront'].get('AACP_API_URL'),'secretsPrinted':False}
(root/'.specs/features/cashback-release/evidence/homolog-target-current-public-inventory.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print(json.dumps(record))
