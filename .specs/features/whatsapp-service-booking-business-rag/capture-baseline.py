"""Capture only Git-tracked frontend source from the clean, frozen baseline."""
from pathlib import Path, PurePosixPath
import hashlib
import io
import json
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]
SOURCE = Path('C:/tmp/zyon-whatsapp-checkout-widget-20261105')
FEATURE = Path(__file__).resolve().parent
SCOPES = ['apps/dashboard', 'apps/storefront', 'apps/widget_v2']
API_BASE = '7229739c7b0da6bbe8da9a7746090e48ae81a7e7'
FRONTEND_BASE = 'f1037635e38cb4d2e606b29eb73e5a74786a645b'
DENY = {'node_modules', '.next', 'dist', '.vercel', '.git', '.audit', 'coverage', 'test-results', 'playwright-report'}

def git(repo, *args):
    return subprocess.check_output(['git', *args], cwd=repo)

assert git(SOURCE, 'rev-parse', 'HEAD').decode().strip() == FRONTEND_BASE
assert not git(SOURCE, 'status', '--porcelain'), 'frozen_frontend_must_be_clean'
archive = git(SOURCE, 'archive', '--format=tar', FRONTEND_BASE, *SCOPES)
files, excluded = [], []
with tarfile.open(fileobj=io.BytesIO(archive), mode='r:') as source_tar:
    for member in source_tar:
        rel = PurePosixPath(member.name)
        if member.isdir():
            continue
        assert member.isfile(), 'non_regular_frontend_source_forbidden'
        assert not rel.is_absolute() and '..' not in rel.parts
        assert any(str(rel).startswith(scope+'/') for scope in SCOPES)
        if any(part in DENY or part.startswith('.env') for part in rel.parts) or '.claudeprojects' in str(rel) or 'memoryMEMORY.md' in str(rel):
            excluded.append(str(rel))
            continue
        data = source_tar.extractfile(member).read()
        target = ROOT / Path(*rel.parts)
        assert ROOT.resolve() in target.resolve().parents
        if target.exists():
            assert target.read_bytes() == data, 'existing_frontend_would_be_overwritten: '+str(rel)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        assert target.read_bytes() == data
        files.append({'path': str(rel), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})

shared = {}
for path in ['packages/checkout-ui', 'packages/platform-support-ui']:
    before = git(ROOT, 'ls-tree', API_BASE, path).decode().split()[2]
    frozen = git(SOURCE, 'ls-tree', FRONTEND_BASE, path).decode().split()[2]
    assert before == frozen, 'shared_frontend_package_requires_explicit_reconciliation'
    shared[path] = {'gitTree': before, 'copied': False}

unchanged = ['apps/api', 'packages', 'pnpm-lock.yaml', 'package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json']
assert not git(ROOT, 'diff', '--name-only', API_BASE, '--', *unchanged), 'api_or_dependency_baseline_changed'
manifest = {'apiBase': API_BASE, 'frontendBase': FRONTEND_BASE, 'implementationRoot': str(ROOT),
            'source': str(SOURCE), 'sourceClean': True, 'scopes': SCOPES,
            'sourcePolicy': 'Git archive only; no workspace dirt, env, dependencies or deployment state',
            'sharedPackages': shared, 'excluded': excluded, 'files': files}
(FEATURE/'baseline-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
print(json.dumps({'files':len(files), 'bytes':sum(f['bytes'] for f in files), 'excluded':len(excluded), 'apiPreserved':True}))
