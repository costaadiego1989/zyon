"""Check release receipt consistency. Selftests are not production evidence."""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
from pathlib import Path
import re
import sys
import unittest
from urllib.parse import urlsplit

REQUIRED_MIGRATION = "20261123230000_prospect_campaign_setup"


def require(condition: object, reason: str) -> None:
    if not condition:
        raise ValueError(reason)


def origin(value: str) -> str:
    parsed = urlsplit(value)
    require(parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password, "production_https_origin_required")
    require(not parsed.query and not parsed.fragment and parsed.path in ("", "/"), "origin_must_not_contain_path")
    require(parsed.hostname not in ("127.0.0.1", "localhost", "::1"), "production_loopback_forbidden")
    return f"https://{parsed.netloc.lower()}"


def validate(receipt: dict, revision: str, api_origin: str, control_origin: str, preserve: tuple[str, ...] = ()) -> None:
    require(re.fullmatch(r"[a-f0-9]{40}", revision), "full_expected_revision_required")
    expected = {"api": origin(api_origin), "control": origin(control_origin)}
    require(receipt.get("evidenceMode") == "production", "actual_production_receipt_required")
    require(receipt.get("revision") == revision, "receipt_revision_mismatch")
    observed = dt.datetime.fromisoformat(receipt["observedAt"].replace("Z", "+00:00"))
    require(observed.tzinfo is not None, "observation_timezone_required")
    age = dt.datetime.now(dt.timezone.utc) - observed
    require(-dt.timedelta(minutes=5) <= age <= dt.timedelta(hours=24), "fresh_release_observation_required")
    for name, settled_status in (("api", "SUCCESS"), ("control", "READY")):
        service = receipt["services"][name]
        require(service.get("status") == settled_status and service.get("settled") is True, f"{name}_deployment_not_settled")
        require(bool(service.get("deploymentId")), f"{name}_deployment_identity_required")
        require(service.get("sourceRevision") == revision and service.get("servedRevision") == revision, f"{name}_revision_mismatch")
        require(origin(service["origin"]) == expected[name], f"{name}_domain_mismatch")
    for endpoint in ("health", "ready"):
        probe = receipt["health"][endpoint]
        url = urlsplit(probe["url"])
        require(probe.get("status") == 200 and f"{url.scheme}://{url.netloc.lower()}" == expected["api"] and url.path in ("/" + endpoint, "/v1/" + endpoint) and not url.query and not url.fragment, f"{endpoint}_probe_mismatch")
    assets = receipt.get("controlAssets", [])
    require(bool(assets), "served_control_assets_required")
    require(any(urlsplit(asset["url"]).path.endswith(".js") for asset in assets), "served_control_javascript_required")
    for asset in assets:
        parsed = urlsplit(asset["url"])
        require(f"{parsed.scheme}://{parsed.netloc.lower()}" == expected["control"], "asset_domain_mismatch")
        require(parsed.path.startswith("/assets/") and asset.get("status") == 200, "served_asset_response_required")
        require(re.fullmatch(r"[a-f0-9]{64}", asset.get("sha256", "")), "asset_digest_required")
    migrations = receipt["migrations"]
    require(migrations.get("status") == "applied" and REQUIRED_MIGRATION in migrations.get("applied", []), "campaign_schema_not_observed")
    require(set(preserve).issubset(set(receipt.get("preservedRevisions", []))), "concurrent_revision_not_preserved")
    browser = receipt["browser"]
    require(browser.get("kind") == "real_admin_browser" and browser.get("controlled") is False, "genuine_admin_browser_required")
    require(browser.get("role") == "platform_admin" and origin(browser["origin"]) == expected["control"], "admin_origin_or_role_mismatch")
    draft = browser["draft"]
    require(bool(draft.get("id")) and draft.get("setupVersion") == 2, "actual_v2_draft_required")
    context = browser["context"]
    require(context.get("mode") == "rules" and bool(context.get("snapshotId")) and type(context.get("companyCount")) is int and context["companyCount"] > 0, "actual_context_scope_required")
    require(context.get("criteria") == {"mainCnaes": ["4781400"], "ufs": ["SP"]}, "intended_scope_mismatch")
    require(set((1440, 1280, 1024, 390, 320)).issubset(set(browser.get("viewports", []))), "responsive_admin_gestures_required")
    require(browser.get("reloaded") is True and browser.get("selectedCompaniesAppended") is True, "persisted_admin_gestures_required")
    preview = browser["messagePreview"]
    require(bool(preview.get("body")) and bool(preview.get("registryId")), "actual_message_preview_required")
    provider = receipt["provider"]
    require(all(type(provider.get(key)) is bool for key in ("submitted", "approved", "delivered")), "explicit_provider_claim_booleans_required")
    claimed = [key for key in ("submitted", "approved", "delivered") if provider.get(key) is True]
    if claimed:
        require(provider.get("evidenceKind") == "real_provider", "controlled_provider_claimed_as_real")
        for key in claimed:
            observation = provider.get("observations", {}).get(key, {})
            require(observation.get("synthetic") is False and bool(observation.get("reference")) and bool(observation.get("providerObjectId")), f"real_{key}_evidence_required")
            require(observation.get("source") in ("graph_http", "signed_meta_webhook", "buyer_gesture"), f"real_{key}_source_required")
    else:
        require(preview.get("state") == "draft" and preview.get("submittedToMeta") is False, "unobserved_message_must_remain_draft")
    require(not provider.get("approved") or provider.get("submitted") is True, "approval_without_submission_evidence")
    require(not provider.get("delivered") or provider.get("approved") is True, "delivery_without_approved_template_evidence")
    safety = receipt["dataSafety"]
    require(safety.get("cleanupScope") == "run_owned_only" and safety.get("retainedDraftId") == draft["id"], "protected_cleanup_scope_required")
    require(isinstance(safety.get("removedSyntheticIds"), list), "explicit_cleanup_identity_required")
    require(draft["id"] not in safety["removedSyntheticIds"], "retained_draft_was_removed")
    require(type(receipt.get("arbitraryCompanySends")) is int and receipt["arbitraryCompanySends"] == 0, "arbitrary_company_send_forbidden")


def fixture() -> dict:
    revision = "a" * 40
    return {
        "evidenceMode": "production", "revision": revision,
        "observedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "services": {name: {"status": status, "settled": True, "deploymentId": "fixture-only", "sourceRevision": revision, "servedRevision": revision, "origin": url} for name, status, url in (("api", "SUCCESS", "https://api.example.invalid"), ("control", "READY", "https://control.example.invalid"))},
        "health": {name: {"status": 200, "url": "https://api.example.invalid/" + name} for name in ("health", "ready")},
        "controlAssets": [{"url": "https://control.example.invalid/assets/main.js", "status": 200, "sha256": "b" * 64}],
        "migrations": {"status": "applied", "applied": [REQUIRED_MIGRATION]}, "preservedRevisions": ["c" * 40],
        "browser": {"kind": "real_admin_browser", "controlled": False, "role": "platform_admin", "origin": "https://control.example.invalid", "draft": {"id": "fixture-only", "setupVersion": 2}, "context": {"mode": "rules", "snapshotId": "fixture-only", "companyCount": 25, "criteria": {"mainCnaes": ["4781400"], "ufs": ["SP"]}}, "viewports": [1440, 1280, 1024, 390, 320], "reloaded": True, "selectedCompaniesAppended": True, "messagePreview": {"registryId": "fixture-only", "body": "Fixture-only draft", "state": "draft", "submittedToMeta": False}},
        "provider": {"evidenceKind": "unobserved", "submitted": False, "approved": False, "delivered": False},
        "dataSafety": {"cleanupScope": "run_owned_only", "retainedDraftId": "fixture-only", "removedSyntheticIds": []}, "arbitraryCompanySends": 0,
    }


class DeliveryEvidenceSelfTests(unittest.TestCase):
    def check(self, value: dict) -> None:
        validate(value, "a" * 40, "https://api.example.invalid", "https://control.example.invalid", ("c" * 40,))

    def rejected(self, mutate) -> None:
        value = copy.deepcopy(fixture())
        mutate(value)
        with self.assertRaises(ValueError):
            self.check(value)

    def test_complete_consistent_fixture(self):
        self.check(fixture())

    def test_receipt_template_is_not_production_evidence(self):
        self.rejected(lambda value: value.update(evidenceMode="template"))

    def test_unsettled_deployment(self):
        self.rejected(lambda value: value["services"]["api"].update(status="DEPLOYING", settled=False))

    def test_wrong_served_revision(self):
        self.rejected(lambda value: value["services"]["control"].update(servedRevision="d" * 40))

    def test_wrong_domain(self):
        self.rejected(lambda value: value["services"]["control"].update(origin="https://wrong.example.invalid"))

    def test_simulated_provider_claimed_as_real(self):
        self.rejected(lambda value: value["provider"].update(evidenceKind="controlled", submitted=True, approved=True))

    def test_simulated_admin_browser(self):
        self.rejected(lambda value: value["browser"].update(controlled=True))

    def test_synthetic_observation_with_real_provider_label(self):
        self.rejected(lambda value: value["provider"].update(evidenceKind="real_provider", submitted=True, observations={"submitted": {"synthetic": True, "reference": "fixture-only", "providerObjectId": "fixture-only", "source": "graph_http"}}))

    def test_missing_schema(self):
        self.rejected(lambda value: value["migrations"].update(applied=[]))

    def test_retained_user_draft_cannot_be_a_cleanup_target(self):
        self.rejected(lambda value: value["dataSafety"].update(removedSyntheticIds=[value["browser"]["draft"]["id"]]))

    def test_wrong_asset_domain(self):
        self.rejected(lambda value: value["controlAssets"][0].update(url="https://wrong.example.invalid/assets/main.js"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("receipt", nargs="?", type=Path)
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--expected-revision")
    parser.add_argument("--api-origin")
    parser.add_argument("--control-origin")
    parser.add_argument("--preserve-revision", action="append", default=[])
    args = parser.parse_args()
    if args.selftest:
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(DeliveryEvidenceSelfTests))
        print("Offline selftests only. Actual production receipt remains a separate required gate.")
        return 0 if result.wasSuccessful() else 1
    if not all((args.receipt, args.expected_revision, args.api_origin, args.control_origin)):
        parser.error("receipt, --expected-revision, --api-origin and --control-origin are required")
    try:
        validate(json.loads(args.receipt.read_text(encoding="utf-8-sig")), args.expected_revision, args.api_origin, args.control_origin, tuple(args.preserve_revision))
    except (ValueError, KeyError, TypeError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print("PASS: supplied production receipt is consistent with the required release boundaries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
