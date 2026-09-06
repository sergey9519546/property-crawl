"""Record the private discovery -> evidence -> decision -> export acceptance journey.

The script reads the operator credential locally, records a browser video, saves
screenshots and both packet formats, and writes machine-readable timing metrics.
It never prints or stores the credential.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = os.environ.get("NEXT_UI_URL", "http://localhost:3001").rstrip("/")


def env_value(name: str) -> str:
    value = os.environ.get(name)
    if value:
        return value
    env_file = ROOT / ".env.local"
    if not env_file.exists():
        raise RuntimeError(f"{name} is required in the environment or .env.local")
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, candidate = line.split("=", 1)
        if key.strip() == name:
            return candidate.strip().strip('"').strip("'")
    raise RuntimeError(f"{name} is required in the environment or .env.local")


def expect_ok(response, purpose: str) -> dict:
    if not response.ok:
        raise RuntimeError(f"{purpose} failed with HTTP {response.status}: {response.text()[:300]}")
    return response.json()


def main() -> None:
    credential = env_value("SCRAPER_ADMIN_TOKEN")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    artifact_dir = ROOT / "artifacts" / "workspace-walkthrough" / stamp
    video_dir = artifact_dir / "video"
    artifact_dir.mkdir(parents=True, exist_ok=False)
    video_dir.mkdir()
    metrics = {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "baseUrl": BASE_URL,
        "journey": ["discovery", "evidence", "decision", "second_look", "export"],
        "usefulReconsiderationEvents": 0,
        "consoleErrors": [],
        "pageErrors": [],
        "serverErrors": [],
    }
    started = perf_counter()
    video_path = None

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1440, "height": 1000},
            record_video_dir=str(video_dir),
            record_video_size={"width": 1440, "height": 1000},
            accept_downloads=True,
        )
        page = context.new_page()
        page.set_default_timeout(15_000)
        page.on("console", lambda message: metrics["consoleErrors"].append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: metrics["pageErrors"].append(str(error)))
        page.on(
            "response",
            lambda response: metrics["serverErrors"].append({"status": response.status, "url": response.url})
            if response.url.startswith(BASE_URL) and response.status >= 500
            else None,
        )
        try:
            page.goto(f"{BASE_URL}/listings", wait_until="domcontentloaded")
            page.get_by_role("heading", name="Distressed property records, without hidden assumptions").wait_for()
            page.get_by_role("button", name=re.compile(r"Unlock|Checking")).click()
            page.get_by_label("Operator credential").fill(credential)
            page.get_by_role("button", name="Unlock workspace").click()
            page.get_by_role("button", name="Lock", exact=True).wait_for()

            inventory = expect_ok(context.request.get(f"{BASE_URL}/api/listings?limit=1000"), "listing inventory")
            cases = expect_ok(context.request.get(f"{BASE_URL}/api/workspace/cases?limit=200"), "research cases")
            network = expect_ok(context.request.get(f"{BASE_URL}/api/source-network"), "source catalog")
            catalog_source_ids = {item["id"] for item in network.get("sources", [])}
            used_aliases = {alias for item in cases.get("items", []) for alias in item.get("listingAliases", [item.get("listingId")]) if alias}
            candidates = [
                item for item in inventory.get("listings", [])
                if item.get("id") not in used_aliases
                and item.get("source") != "servicelink"
                and item.get("source") in catalog_source_ids
                and item.get("provenance", {}).get("origin") == "live"
                and item.get("provenance", {}).get("observed") is True
            ]
            if not candidates:
                candidates = [
                    item for item in inventory.get("listings", [])
                    if item.get("source") != "servicelink"
                    and item.get("source") in catalog_source_ids
                    and item.get("provenance", {}).get("origin") == "live"
                    and item.get("provenance", {}).get("observed") is True
                ]
            if not candidates:
                raise RuntimeError("No source-observed listing is available for the browser journey")
            listing = candidates[0]

            page.get_by_label("Search listings").fill(listing["address"])
            page.get_by_role("button", name=re.compile(r"Deal Grid \(1 records?\)")).wait_for()
            page.screenshot(path=str(artifact_dir / "01-discovery.png"), full_page=True)
            page.get_by_role("button", name="Research", exact=True).first.click()
            page.wait_for_url(re.compile(r"/research/rcase_[a-f0-9]{24}"))
            page.get_by_role("heading", name="Evidence comparison").wait_for()
            case_id = re.search(r"/research/(rcase_[a-f0-9]{24})", page.url).group(1)
            metrics["caseId"] = case_id
            metrics["listingId"] = listing["id"]
            page.screenshot(path=str(artifact_dir / "02-evidence.png"), full_page=True)

            page.get_by_role("button", name="pass", exact=True).click()
            page.get_by_label("Title risk unresolved").check()
            page.get_by_label("Decision note").fill("Passed while title evidence is unresolved. Bring this property back when reviewed title research becomes available.")
            page.get_by_label("Reconsideration field").select_option("requiredEvidence")
            page.get_by_label("Required evidence type").select_option("title_research")
            page.get_by_role("button", name="Save decision").click()
            page.get_by_text("Pass saved. The case returns only when a supported condition is met.", exact=True).wait_for()
            page.screenshot(path=str(artifact_dir / "03-decision.png"), full_page=True)

            captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            evidence_payload = {
                "sourceId": listing["source"],
                "sourceUrl": listing["sourceUrl"],
                "capturedAt": captured_at,
                "kind": "text",
                "body": f"Walkthrough-reviewed title research reference for exact listing {listing['id']}; source claims remain subject to document-level verification. Captured {captured_at}.",
            }
            intake = expect_ok(
                context.request.post(f"{BASE_URL}/api/source-network/intake", data=evidence_payload),
                "evidence intake",
            )
            review = expect_ok(
                context.request.post(
                    f"{BASE_URL}/api/source-network/review",
                    data={"id": intake["record"]["id"], "decision": "approve", "note": "Reviewed during recorded workspace acceptance journey."},
                ),
                "evidence review",
            )
            metrics["evidenceIntakeId"] = review["record"]["id"]

            page.get_by_role("button", name="Load review queue").click()
            page.get_by_text(re.compile(r"reviewed evidence packet.*available", re.I)).wait_for()
            page.get_by_label("Reviewed evidence packet").select_option(review["record"]["id"])
            page.get_by_label("Evidence relationship").select_option("title_research")
            page.get_by_role("button", name="Link", exact=True).click()
            page.get_by_text("Relevant evidence changed. Your saved pass remains intact until you review and save a new decision.", exact=True).wait_for()
            page.get_by_text("Second Look", exact=True).wait_for()
            metrics["usefulReconsiderationEvents"] = 1
            page.screenshot(path=str(artifact_dir / "04-second-look.png"), full_page=True)

            with page.expect_download() as download_info:
                page.get_by_role("button", name="JSON", exact=True).click()
            download_info.value.save_as(str(artifact_dir / "decision-packet.json"))
            with page.expect_download() as download_info:
                page.get_by_role("button", name="Print-ready report", exact=True).click()
            download_info.value.save_as(str(artifact_dir / "decision-packet.md"))

            page.get_by_role("link", name="Research", exact=True).click()
            page.get_by_text("Second Look", exact=True).first.wait_for()
            page.screenshot(path=str(artifact_dir / "05-inbox.png"), full_page=True)
            visible_text = page.locator("body").inner_text().lower()
            if "servicelink" in visible_text:
                raise RuntimeError("Prohibited publisher branding appeared in customer-visible text")
            if metrics["pageErrors"] or metrics["serverErrors"]:
                raise RuntimeError(f"Browser journey reported runtime errors: {metrics['pageErrors'] or metrics['serverErrors']}")
            metrics["completed"] = True
        except Exception as error:
            metrics["completed"] = False
            metrics["error"] = str(error)
            page.screenshot(path=str(artifact_dir / "failure.png"), full_page=True)
            raise
        finally:
            metrics["completedAt"] = datetime.now(timezone.utc).isoformat()
            metrics["completionMs"] = round((perf_counter() - started) * 1000)
            if page.video:
                video_path = page.video.path()
            page.close()
            context.close()
            browser.close()
            if video_path and Path(video_path).exists():
                final_video = artifact_dir / "workspace-walkthrough.webm"
                Path(video_path).replace(final_video)
                metrics["video"] = final_video.name
            (artifact_dir / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    print(json.dumps({"completed": metrics.get("completed", False), "artifactDir": str(artifact_dir), "completionMs": metrics["completionMs"], "usefulReconsiderationEvents": metrics["usefulReconsiderationEvents"]}))


if __name__ == "__main__":
    main()
