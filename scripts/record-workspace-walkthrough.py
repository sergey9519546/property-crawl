"""Record the private discovery -> evidence -> decision -> export acceptance journey.

The script starts isolated application processes with a temporary access key,
records the journey, and retains screenshots, packets and timing metrics in a
temporary artifact directory. Synthetic evidence never enters operator stores.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter, sleep
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = ""


def utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@contextmanager
def isolated_workspace():
    """Run real application processes with disposable credentials and isolated stores.

    Existing inventory is copied for read-only discovery. Decisions and synthetic
    evidence can never reach the operator's stores or configured PostgreSQL.
    """
    global BASE_URL
    if not (ROOT / ".next" / "BUILD_ID").exists():
        raise RuntimeError("Run npm run build before the isolated walkthrough")
    artifact_dir = Path(tempfile.mkdtemp(prefix="perfectproperty-walkthrough-"))
    env = os.environ.copy()
    env.update({
        "DATABASE_URL": "", "DISCOVERY_MODE": "", "NODE_ENV": "production",
        "SCRAPER_BACKGROUND_ENABLED": "0", "ALLOW_REAL_SCRAPERS": "0",
        "SCRAPER_ADMIN_TOKEN": secrets.token_urlsafe(32),
        "WORKSPACE_SESSION_SECRET": secrets.token_urlsafe(32),
        "WORKSPACE_BOOT_ID": secrets.token_hex(16),
        "NEXT_DISCOVERY_PREVIEW": "", "NEXT_VERIFY_BUILD": "",
        "PROPERTY_API_RATE_LIMIT": "10000",
    })
    for name in ("RESEARCH_WORKSPACE", "SOURCE_INTAKE", "HUNTS", "OBSERVATIONS", "COLLECTION_JOBS", "LIVE_CACHE"):
        env[f"PROPERTY_{name}_PATH"] = str(artifact_dir / f"{name.lower()}.json")
    inventory = ROOT / ".cache" / "live-listings.json"
    if inventory.exists():
        shutil.copyfile(inventory, env["PROPERTY_LIVE_CACHE_PATH"])
    reservations = [socket.socket(), socket.socket()]
    for reservation in reservations:
        reservation.bind(("127.0.0.1", 0))
    api_port, ui_port = [reservation.getsockname()[1] for reservation in reservations]
    for reservation in reservations:
        reservation.close()
    env["PORT"] = str(api_port)
    env["PROPERTY_API_URL"] = f"http://localhost:{api_port}"
    BASE_URL = f"http://localhost:{ui_port}"
    processes = []
    logs = []

    def start(name, args):
        log = (artifact_dir / f"{name}.log").open("ab")
        logs.append(log)
        process = subprocess.Popen(args, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
                                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        processes.append(process)
        return process

    def wait_ready(url):
        deadline = perf_counter() + 45
        while perf_counter() < deadline:
            if any(process.poll() is not None for process in processes):
                raise RuntimeError(f"Isolated process exited; inspect logs in {artifact_dir}")
            try:
                with urlopen(url, timeout=2) as response:
                    if json.load(response).get("workspaceBootId") == env["WORKSPACE_BOOT_ID"]:
                        return
            except (OSError, ValueError):
                pass
            sleep(0.25)
        raise RuntimeError(f"Isolated workspace not ready; inspect logs in {artifact_dir}")

    def restart_api():
        api = processes.pop(0)
        api.terminate()
        api.wait(timeout=10)
        process = start("api", ["node", "-e", f"require('./server/server').listen({api_port}, '127.0.0.1')"])
        processes.remove(process)
        processes.insert(0, process)
        wait_ready(f"{env['PROPERTY_API_URL']}/api/health")

    try:
        start("api", ["node", "-e", f"require('./server/server').listen({api_port}, '127.0.0.1')"])
        start("ui", ["node", "node_modules/next/dist/bin/next", "start", "-p", str(ui_port), "-H", "127.0.0.1"])
        wait_ready(f"{env['PROPERTY_API_URL']}/api/health")
        wait_ready(f"{BASE_URL}/api/health")
        yield artifact_dir, env["SCRAPER_ADMIN_TOKEN"], restart_api
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        for log in logs:
            log.close()


def expect_ok(response, purpose: str) -> dict:
    if not response.ok:
        raise RuntimeError(f"{purpose} failed with HTTP {response.status}: {response.text()[:300]}")
    return response.json()


def catalog_source_aliases(network: dict) -> tuple[set[str], dict[str, str]]:
    known = set()
    aliases = {}
    for item in network.get("sources", []):
        source_id = item.get("id")
        adapter_key = item.get("adapterKey")
        if source_id:
            known.add(source_id)
            aliases[source_id] = source_id
        if adapter_key:
            known.add(adapter_key)
            aliases[adapter_key] = source_id or adapter_key
    return known, aliases


def record_journey(artifact_dir, credential, restart_api) -> None:
    from playwright.sync_api import sync_playwright

    video_dir = artifact_dir / "video"
    video_dir.mkdir()
    metrics = {
        "startedAt": utc_iso(),
        "baseUrl": BASE_URL,
        "journey": ["discovery", "evidence", "decision", "second_look", "export"],
        "syntheticReconsiderationEvents": 0,
        "isolated": True,
        "customerUsefulnessMeasured": False,
        "consoleErrors": [],
        "pageErrors": [],
        "serverErrors": [],
        "failedRequests": [],
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
        page.on("requestfailed", lambda request: metrics["failedRequests"].append({
            "url": request.url, "reason": request.failure,
            "applicationRequest": request.url.startswith(BASE_URL),
        }))
        page.on(
            "response",
            lambda response: metrics["serverErrors"].append({"status": response.status, "url": response.url})
            if response.url.startswith(BASE_URL) and response.status >= 500
            else None,
        )
        try:
            page.goto(f"{BASE_URL}/listings", wait_until="domcontentloaded")
            page.get_by_role("heading", name="Find properties", exact=True).wait_for()
            page.get_by_role("button", name=re.compile(r"Unlock|Checking")).click()
            page.get_by_label("Workspace access key").fill(credential)
            page.get_by_role("button", name="Unlock workspace").click()
            page.get_by_role("button", name="Lock", exact=True).wait_for()

            inventory = expect_ok(context.request.get(f"{BASE_URL}/api/listings?limit=1000"), "listing inventory")
            cases = expect_ok(context.request.get(f"{BASE_URL}/api/workspace/cases?limit=200"), "research cases")
            network = expect_ok(context.request.get(f"{BASE_URL}/api/source-network"), "source catalog")
            known_sources, source_aliases = catalog_source_aliases(network)
            used_aliases = {alias for item in cases.get("items", []) for alias in item.get("listingAliases", [item.get("listingId")]) if alias}
            candidates = [
                item for item in inventory.get("listings", [])
                if item.get("id") not in used_aliases
                and item.get("source") != "servicelink"
                and item.get("source") in known_sources
                and item.get("provenance", {}).get("origin") == "live"
                and item.get("provenance", {}).get("observed") is True
            ]
            if not candidates:
                candidates = [
                    item for item in inventory.get("listings", [])
                    if item.get("source") != "servicelink"
                    and item.get("source") in known_sources
                    and item.get("provenance", {}).get("origin") == "live"
                    and item.get("provenance", {}).get("observed") is True
                ]
            if not candidates:
                raise RuntimeError("No source-observed listing is available for the browser journey")
            listing = candidates[0]
            catalog_source_id = source_aliases.get(listing["source"], listing["source"])

            page.get_by_label("Search properties").fill(listing["id"])
            page.get_by_role("button", name="Search", exact=True).click()
            page.get_by_text("1 property", exact=True).wait_for()
            page.screenshot(path=str(artifact_dir / "01-discovery.png"), full_page=True)
            page.get_by_role("button", name="Research", exact=True).first.click()
            page.wait_for_url(re.compile(r"/research/rcase_[a-f0-9]{24}"))
            page.get_by_role("heading", name="Evidence comparison").wait_for()
            case_id = re.search(r"/research/(rcase_[a-f0-9]{24})", page.url).group(1)
            metrics["caseId"] = case_id
            metrics["listingId"] = listing["id"]
            metrics["catalogSourceId"] = catalog_source_id
            page.screenshot(path=str(artifact_dir / "02-evidence.png"), full_page=True)

            page.get_by_role("button", name="pass", exact=True).click()
            page.get_by_label("Title risk unresolved").check()
            page.get_by_label("Decision note").fill("Passed while title evidence is unresolved. Bring this property back when reviewed title research becomes available.")
            page.get_by_label("Reconsideration field").select_option("requiredEvidence")
            page.get_by_label("Required evidence type").select_option("title_research")
            page.get_by_role("button", name="Save decision").click()
            page.get_by_text("Pass saved. The case returns only when a supported condition is met.", exact=True).wait_for()
            page.screenshot(path=str(artifact_dir / "03-decision.png"), full_page=True)

            captured_at = utc_iso()
            evidence_payload = {
                "sourceId": catalog_source_id,
                "sourceUrl": listing["sourceUrl"],
                "capturedAt": captured_at,
                "kind": "text",
                "body": f"Walkthrough-reviewed title research reference for exact listing {listing['id']}; source claims remain subject to document-level verification. Captured {captured_at}.",
            }
            intake = expect_ok(
                context.request.post(f"{BASE_URL}/api/source-network/intake", json=evidence_payload),
                "evidence intake",
            )
            review = expect_ok(
                context.request.post(
                    f"{BASE_URL}/api/source-network/review",
                    json={"id": intake["record"]["id"], "decision": "approve", "note": "Reviewed during recorded workspace acceptance journey."},
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
            metrics["syntheticReconsiderationEvents"] = 1
            page.screenshot(path=str(artifact_dir / "04-second-look.png"), full_page=True)

            with page.expect_download() as download_info:
                page.get_by_role("button", name="JSON", exact=True).click()
            download_info.value.save_as(str(artifact_dir / "decision-packet.json"))
            with page.expect_download() as download_info:
                page.get_by_role("button", name="Print-ready report", exact=True).click()
            download_info.value.save_as(str(artifact_dir / "decision-packet.md"))

            packet_url = f"{BASE_URL}/api/workspace/cases/{case_id}/packet?format=json"
            before_restart = expect_ok(context.request.get(packet_url), "packet before restart")
            restart_api()
            after_restart = expect_ok(context.request.get(packet_url), "packet after restart")
            if before_restart != after_restart:
                raise RuntimeError("Stored packet changed across API restart")
            metrics["packetSurvivesRestart"] = True
            retained = expect_ok(context.request.get(f"{BASE_URL}/api/workspace/cases/{case_id}"), "retained case")
            if retained["case"]["state"] != "pass" or not retained["case"]["reconsiderationRequired"]:
                raise RuntimeError("Second Look did not preserve the pass decision across restart")
            duplicate = expect_ok(context.request.post(
                f"{BASE_URL}/api/workspace/cases",
                json={"listingId": listing["id"], "origin": {"type": "manual"}},
            ), "duplicate case request")
            if duplicate["case"]["id"] != case_id:
                raise RuntimeError("A repeated case request created a duplicate")
            anonymous = browser.new_context()
            try:
                if anonymous.request.get(f"{BASE_URL}/api/workspace/cases/{case_id}").status != 401:
                    raise RuntimeError("Anonymous browser could read a private case")
            finally:
                anonymous.close()
            metrics["privateAccessAndDeduplication"] = True

            page.get_by_role("link", name="Research", exact=True).click()
            page.get_by_text("Second Look", exact=True).first.wait_for()
            page.screenshot(path=str(artifact_dir / "05-inbox.png"), full_page=True)
            visible_text = page.locator("body").inner_text().lower()
            if "servicelink" in visible_text:
                raise RuntimeError("Prohibited publisher branding appeared in customer-visible text")
            page.set_viewport_size({"width": 390, "height": 844})
            for route, heading in [("activity", "Collection activity"),
                                   ("research/alachua", "Second chance review")]:
                page.goto(f"{BASE_URL}/{route}", wait_until="domcontentloaded")
                page.get_by_role("heading", name=heading, exact=True).wait_for()
                if page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth"):
                    raise RuntimeError(f"Horizontal overflow on mobile {route}")
                page.screenshot(path=str(artifact_dir / (route.replace("/", "-") + "-mobile.png")), full_page=True)
            metrics["mobileViewport"] = {"width": 390, "height": 844}
            if metrics["pageErrors"] or metrics["serverErrors"]:
                raise RuntimeError(f"Browser journey reported runtime errors: {metrics['pageErrors'] or metrics['serverErrors']}")
            metrics["completed"] = True
        except Exception as error:
            metrics["completed"] = False
            metrics["error"] = str(error)
            page.screenshot(path=str(artifact_dir / "failure.png"), full_page=True)
            raise
        finally:
            metrics["completedAt"] = utc_iso()
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

    print(json.dumps({"completed": metrics.get("completed", False), "artifactDir": str(artifact_dir), "completionMs": metrics["completionMs"], "syntheticReconsiderationEvents": metrics["syntheticReconsiderationEvents"]}))


if __name__ == "__main__":
    argparse.ArgumentParser(description=__doc__).parse_args()
    with isolated_workspace() as workspace:
        record_journey(*workspace)
