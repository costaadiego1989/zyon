"""Export one frontend's immutable committed source; never deploy or read secrets."""
from pathlib import Path, PurePosixPath
import hashlib, io, json, re, subprocess, sys, zipfile

root = Path(__file__).resolve().parents[1]
candidate = Path('C:/tmp/zyon-cashback-release-20261114')
component, revision = sys.argv[1:]
projects = {
    'dashboard': ('prj_ExtCipEsyn65zIa2cg6FbUbugR3E', 'zyon-dashboard', 'apps/dashboard'),
    'storefront': ('prj_csFg0cpDw5MIgpcAQhkVm1hpzhBX', 'zyon-storefront', 'apps/storefront'),
    'widget': ('prj_0OMJv9DqWDvXx9Yiw6RTxrimQEsH', 'zyon-widget-v2', 'apps/widget_v2'),
}
assert component in projects and re.fullmatch(r'[a-f0-9]{40}', revision), 'explicit_component_and_full_revision_required'
def git(*args):
    return subprocess.check_output(['git', '-C', str(candidate), *args])
assert git('rev-parse', 'HEAD').decode().strip() == revision, 'candidate_revision_changed'
assert not git('status', '--porcelain'), 'candidate_must_be_clean_before_export'
project_id, project_name, app = projects[component]
target = Path('C:/tmp') / ('zyon-cashback-front-' + revision[:12] + '-' + component)
assert not target.exists(), 'fresh_frontend_export_required_no_overwrite'
selected = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json',
            'packages/shared-types', 'packages/contracts', 'packages/checkout-ui', 'packages/platform-support-ui',
            'apps/dashboard', 'apps/storefront', 'apps/widget_v2',
            'scripts/lib/dashboard-auth-build-policy.cjs', 'scripts/vercel-deploy-guard.mjs']
archive = git('archive', '--format=zip', revision, '--', *selected)
sources = {}
excluded_nonruntime_docs = []
with zipfile.ZipFile(io.BytesIO(archive)) as z:
    for info in z.infolist():
        if info.is_dir():
            continue
        name = PurePosixPath(info.filename)
        assert not name.is_absolute() and '..' not in name.parts, 'unsafe_source_archive_path'
        if '.specs' in name.parts:
            excluded_nonruntime_docs.append(info.filename)
            continue
        assert not any(part in {'.git', '.audit', '.specs', '.vercel', '.next', 'node_modules', 'dist', 'dist-app'} for part in name.parts), 'generated_or_private_source_refused'
        assert not any(part.startswith('.env') and part != '.env.example' for part in name.parts), 'private_env_source_refused'
        assert '.claude' not in info.filename.lower() and not info.filename.endswith('.private.json'), 'private_artifact_source_refused'
        content = z.read(info)
        sources[info.filename] = hashlib.sha256(content).hexdigest()
    assert app + '/vercel.json' in sources and len(sources) > 1000
    target.mkdir()
    for info in z.infolist():
        if info.is_dir() or info.filename not in sources:
            continue
        output = target / info.filename
        assert output.resolve().is_relative_to(target.resolve())
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(z.read(info))
link = target / '.vercel/project.json'
link.parent.mkdir()
link.write_text(json.dumps({'projectId': project_id, 'orgId': 'team_580RxQPCo0VLxu9vdZdJgb1S',
                            'projectName': project_name}, indent=2) + '\n', encoding='utf-8')
record = {'component': component, 'revision': revision, 'target': str(target), 'sourceRepository': str(candidate),
          'appRoot': app, 'projectId': project_id, 'projectName': project_name,
          'teamId': 'team_580RxQPCo0VLxu9vdZdJgb1S', 'teamSlug': 'diegos-projects-b6fd2a25',
          'sourceFiles': sources, 'sourceArchiveSha256': hashlib.sha256(archive).hexdigest(),
          'excludedNonRuntimeDocuments': excluded_nonruntime_docs,
          'operatorLinkMetadataOnly': '.vercel/project.json', 'deployed': False}
evidence = root / '.specs/features/cashback-release/evidence'
manifest = evidence / ('frontend-export-' + component + '-' + revision[:12] + '.json')
manifest.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: record[key] for key in ['component', 'revision', 'target', 'projectId', 'sourceArchiveSha256', 'deployed']} | {'sourceFiles': len(sources), 'manifest': str(manifest)}))
