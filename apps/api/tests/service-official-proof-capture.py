"""T95 local companion. Source-only until Root explicitly runs it AFTER LAST.
The official skill files/commands are never changed. Captures are NOT release approval.
"""
from pathlib import Path
import argparse, hashlib, importlib, json, re, subprocess, sys
sys.dont_write_bytecode = True
SKILL_NAMES = ("check_proofs.py", "validate_verification.py", "runners.py", "lean_config.py")
SKILL_HASHES = {
    "check_proofs.py": "da845e7dd40a5434c842b7f313605eb1dce91ce1b5c2b5a568fa33929d7155a7",
    "validate_verification.py": "ce8288ff102c28948eb09aa9d3b7d9eece89784470ffea6a9637ad8e9f84eb04",
    "runners.py": "df8574f6fdecef4ed731a1435bf09ccb5eb9fb2fdd036dbbf02a18b228bf9ab9",
    "lean_config.py": "df03024500280a9aa5aa3922b4548ce3564021a4f82dc9383fdf4a424ba11154",
}
def digest(data): return hashlib.sha256(data).hexdigest()
def write_json(path, value): path.write_bytes((json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
def within(root, path):
    path = path.resolve()
    if not path.is_relative_to(root.resolve()): raise ValueError("capture_path_escape")
    return path
class CommandObserver:
    """Delegates exactly once and returns the IDENTICAL CompletedProcess.
    Capture errors never alter the official call's result or exception.
    """
    def __init__(self, original, plan, directory, root):
        self.original, self.plan, self.directory, self.root = original, plan, directory, root
        self.entries, self.errors = [], []
    def __call__(self, *args, **kwargs):
        command = args[0] if args else kwargs.get("args")
        eligible = (isinstance(command, str) and kwargs.get("shell") is True
                    and kwargs.get("capture_output") is True and kwargs.get("text") is True
                    and Path(kwargs.get("cwd", ".")).resolve() == self.root.resolve())
        result = self.original(*args, **kwargs)
        if eligible:
            try:
                index = len(self.entries)
                if index >= len(self.plan) or command != self.plan[index]["command"]:
                    raise ValueError("unexpected_official_command")
                row = dict(self.plan[index])
                row["phase"] = "official-positive-proof" if row["kind"] == "proof" else "official-build"
                if not isinstance(result.stdout, str) or not isinstance(result.stderr, str):
                    raise ValueError("official_text_output_required")
                row.update(ordinal=index + 1, cwd=str(self.root), returnCode=result.returncode)
                for stream in ("stdout", "stderr"):
                    raw = getattr(result, stream).encode("utf-8")
                    name = "logs/" + str(index + 1).zfill(4) + "." + stream + ".txt"
                    path = self.directory / name
                    path.write_bytes(raw)
                    row[stream] = {"path": name, "sha256": digest(raw), "bytes": len(raw)}
                self.entries.append(row)
            except Exception as error:
                self.errors.append(type(error).__name__)
        return result
def plan_of(official, checks_path):
    checks = official.checks_of(str(checks_path))
    if len(checks) != 84 or len({cid for cid, _ in checks}) != 84:
        raise ValueError("current_84_criteria_required")
    plan = []
    for cid, proofs in checks:
        if not proofs: raise ValueError("proof_missing")
        for index, command in enumerate(proofs):
            if chr(96) in command or official.runners.parse(command)[0] is not None:
                raise ValueError("independent_original_command_required")
            if not command.startswith("pnpm --dir "): raise ValueError("unsupported_original_command_shape")
            plan.append({"kind": "proof", "cid": cid, "proofIndex": index + 1, "command": command})
    builds = official.build_commands(str(checks_path))
    if len(builds) != 9: raise ValueError("current_9_build_commands_required")
    for index, command in enumerate(builds):
        plan.append({"kind": "build", "buildIndex": index + 1, "command": command})
    return plan
def revision(original, root):
    result = original(["git", "rev-parse", "HEAD"], cwd=str(root), capture_output=True, text=True)
    if result.returncode != 0: raise ValueError("revision_unavailable")
    value = result.stdout.strip()
    if len(value) != 40 or any(c not in "0123456789abcdef" for c in value):
        raise ValueError("full_revision_required")
    return value
def source_snapshot(skill, checks, project_files):
    result = {}
    for path in [*(skill / name for name in SKILL_NAMES), checks, *project_files]:
        if path.is_symlink() or not path.is_file(): raise ValueError("real_source_file_required")
        result[str(path.resolve())] = digest(path.read_bytes())
    return result
def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", required=True)
    p.add_argument("--feature", default="whatsapp-service-booking-business-rag")
    p.add_argument("--skill-scripts", default="C:/Users/Admin/.codex/skills/tlc-spec-driven/scripts")
    p.add_argument("--output", required=True)
    p.add_argument("--mutations", required=True)
    p.add_argument("--execute-official-after-last", action="store_true")
    a = p.parse_args(argv)
    if not a.execute_official_after_last: raise ValueError("after_last_execution_required")
    root, skill = Path(a.root).resolve(), Path(a.skill_scripts).resolve()
    if re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", a.feature) is None:
        raise ValueError("feature_slug_required")
    output = within(root / ".cache", Path(a.output))
    if output.exists(): raise ValueError("fresh_owned_capture_required")
    output.mkdir(parents=True)
    (output / "logs").mkdir()
    original = subprocess.run
    sys.path.insert(0, str(skill))
    official = importlib.import_module("check_proofs")
    for name in ("check_proofs", "runners", "lean_config"):
        if Path(sys.modules[name].__file__).resolve() != (skill / (name + ".py")).resolve():
            raise ValueError("official_module_identity_mismatch")
    checks = Path(official.checks_file(str(root / ".specs" / "features" / a.feature))).resolve()
    within(root, checks)
    mutation_path = within(root, Path(a.mutations))
    if not mutation_path.is_file(): raise ValueError("real_mutation_spec_required")
    plan = plan_of(official, checks)
    auditor = root / "apps/api/tests/service-official-proof-raw-audit.mjs"
    project_files = [Path(__file__).resolve(), auditor, root / "apps/api/tests/service-acceptance-report.mjs",
                     root / "apps/api/tests/service-activation-release-producer.mjs", mutation_path]
    before = source_snapshot(skill, checks, project_files)
    for name, expected in SKILL_HASHES.items():
        if before[str((skill / name).resolve())] != expected:
            raise ValueError("official_skill_source_not_reviewed")
    head_before = revision(original, root)
    observer = CommandObserver(original, plan, output, root)
    capture = {"version": 1, "scope": "OFFICIAL_SAME_EXECUTION_RAW_CAPTURE_NOT_RELEASE_APPROVAL",
               "workspaceRoot": str(root), "feature": a.feature, "plan": plan, "entries": observer.entries,
               "captureErrors": observer.errors, "sourceBefore": before, "headBefore": head_before,
               "environmentRecorded": False, "commandsReexecuted": False,
               "mutationCommandsCountedAsPositive": False,
               "providerAccepted": False, "featureComplete": False, "productionReady": False}
    code = 1
    try:
        subprocess.run = observer
        code = official.main([a.feature, "--root", str(root), "--mutations", str(mutation_path)])
    except BaseException as error:
        capture["officialExceptionType"] = type(error).__name__
        code = 1
    finally:
        subprocess.run = original
        capture["officialExitCode"] = code
        try:
            capture["sourceAfter"] = source_snapshot(skill, checks, project_files)
            capture["headAfter"] = revision(original, root)
        except Exception as error:
            capture["snapshotErrorType"] = type(error).__name__
        write_json(output / "capture-manifest.json", capture)
    if code != 0: return code if isinstance(code, int) and code > 0 else 1
    # A metadata-only auditor, not a second execution of any test/build command.
    audited = original(["node", str(auditor), "--root", str(root), "--capture", str(output)],
                       cwd=str(root), capture_output=True, text=True)
    (output / "audit.stdout.txt").write_bytes(audited.stdout.encode("utf-8"))
    (output / "audit.stderr.txt").write_bytes(audited.stderr.encode("utf-8"))
    return audited.returncode
if __name__ == "__main__":
    raise SystemExit(main())

