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
    cache_dir = ROOT / ".cache"
    cache_dir.mkdir(exist_ok=True)
    artifact_dir = Path(tempfile.mkdtemp(prefix="perfectproperty-walkthrough-", dir=str(cache_dir)))
    env = os.environ.copy()
    env.update({
        "DATABASE_URL": "", "DISCOVERY_MODE": "", "NODE_ENV": "production",
        "SCRAPER_BACKGROUND_ENABLED": "0", "ALLOW_REAL_SCRAPERS": "0",
        "SCRAPER_ADMIN_TOKEN": secrets.token_urlsafe(32),
        "WORKSPACE_SESSION_SECRET": secrets.token_urlsafe(32),
        "WORKSPACE_BOOT_ID": secrets.token_hex(16),
        "NEXT_DISCOVERY_PREVIEW": "", "NEXT_VERIFY_BUILD": "",
        "PROPERTY_API_RATE_LIMIT": "10000",
        "PROPERTY_INVENTORY_BACKEND": "memory",
    })
    for name in ("RESEARCH_WORKSPACE", "SOURCE_INTAKE", "HUNTS", "OBSERVATIONS", "COLLECTION_JOBS", "LIVE_CACHE"):
        env[f"PROPERTY_{name}_PATH"] = str(artifact_dir / f"{name.lower()}.json")
    env["PROPERTY_DOCUMENT_REVIEW_STORE_PATH"] = str(artifact_dir / "document-review-store.json")
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


def api_post(context, path: str, body: dict) -> dict:
    headers = {
        "Origin": BASE_URL,
        "Content-Type": "application/json",
        "x-workspace-request": "1",
    }
    response = context.request.post(
        f"{BASE_URL}{path}",
        headers=headers,
        data=json.dumps(body),
    )
    return expect_ok(response, path)


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
        "journey": [
            "discovery", "evidence", "decision", "second_look", "export",
            "document_review", "saved_hunts", "watchlist", "keyboard_a11y", "mobile_responsive"
        ],
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
            page.get_by_label(re.compile(r"Operator key|Workspace access key")).fill(credential)
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
            page.locator("[data-testid='inventory-page-count']").wait_for()
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
            intake = api_post(context, "/api/source-network/intake", evidence_payload)
            review = api_post(
                context,
                "/api/source-network/review",
                {"id": intake["record"]["id"], "decision": "approve", "note": "Reviewed during recorded workspace acceptance journey."},
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
            duplicate = api_post(
                context,
                "/api/workspace/cases",
                {"listingId": listing["id"], "origin": {"type": "manual"}},
            )
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
            # Document review queue journey
            api_post(
                context,
                "/api/document-review",
                {
                    "listingId": listing["id"],
                    "documentIndex": 0,
                    "documentUrl": "https://example.test/evidence-docket.pdf",
                    "status": "pending",
                    "notes": "Pending operator verification against county docket.",
                },
            )
            page.goto(f"{BASE_URL}/workspace/documents-review", wait_until="domcontentloaded")
            page.get_by_role("heading", name="Document review queue", exact=True).wait_for()
            page.get_by_label("Reviewer identifier").fill("operator-beta")
            review_row = page.locator('[data-testid="document-review-row"]').first
            review_row.wait_for()
            review_row.locator("textarea").fill("Verified title docket matches county clerk index.")
            review_row.locator('[data-action="approve"]').click()
            page.get_by_text(re.compile(r"Recorded Approved", re.I)).wait_for()
            page.screenshot(path=str(artifact_dir / "06-document-review.png"), full_page=True)
            metrics["documentReviewJourney"] = True

            # Saved hunts journey
            page.goto(f"{BASE_URL}/hunts", wait_until="domcontentloaded")
            page.get_by_role("heading", name=re.compile(r"Your criteria", re.I)).wait_for()
            page.locator('section[aria-label="Hunt change inbox"]').wait_for()
            page.get_by_label("Describe a hunt").fill("Vacant land in Alachua County under $150k within 30 days")
            page.get_by_role("button", name="Draft criteria", exact=True).click()
            page.get_by_text(re.compile(r"compiled into visible criteria", re.I)).wait_for()
            page.screenshot(path=str(artifact_dir / "07-saved-hunts.png"), full_page=True)
            metrics["savedHuntsJourney"] = True

            # Watchlist exploration journey
            page.goto(f"{BASE_URL}/listings", wait_until="domcontentloaded")
            page.get_by_role("heading", name="Find properties", exact=True).wait_for()
            watchlist_btn = page.locator('button[aria-label*="watchlist:"]').first
            watchlist_btn.wait_for()
            initial_saved = watchlist_btn.get_attribute("aria-pressed") == "true"
            watchlist_btn.click()
            page.wait_for_timeout(300)
            toggled_saved = watchlist_btn.get_attribute("aria-pressed") == "true"
            if initial_saved == toggled_saved:
                raise RuntimeError("Watchlist toggle failed to update state")
            page.screenshot(path=str(artifact_dir / "08-watchlist.png"), full_page=True)
            metrics["watchlistJourney"] = True

            # Keyboard focus and Escape modal trap
            page.get_by_role("button", name="Lock", exact=True).click()
            page.wait_for_timeout(300)
            unlock_btn = page.get_by_role("button", name=re.compile(r"Unlock|Checking")).first
            unlock_btn.wait_for()
            unlock_btn.click()
            dialog = page.get_by_role("dialog", name="Unlock operator tools")
            dialog.wait_for()
            cred_input = page.locator("#workspace-credential")
            if not cred_input.evaluate("el => document.activeElement === el"):
                raise RuntimeError("Unlock dialog did not autofocus credential input")
            page.keyboard.press("Escape")
            dialog.wait_for(state="hidden")
            if not unlock_btn.evaluate("el => document.activeElement === el"):
                raise RuntimeError("Closing dialog via Escape did not restore focus to opener")
            metrics["keyboardA11y"] = True

            # Re-authenticate for mobile checks
            unlock_btn.click()
            dialog.wait_for()
            cred_input.fill(credential)
            page.get_by_role("button", name="Unlock workspace").click()
            page.get_by_role("button", name="Lock", exact=True).wait_for()

            # Mobile viewport, responsive overflow, and CLS checks
            page.set_viewport_size({"width": 390, "height": 844})
            metrics["mobileRoutesChecked"] = []
            metrics["clsScores"] = {}
            for route, heading in [
                ("activity", "Collection activity"),
                ("research/alachua", "Second chance review"),
                ("listings", "Find properties"),
                ("hunts", re.compile(r"Your criteria", re.I)),
                ("workspace/documents-review", "Document review queue"),
            ]:
                page.goto(f"{BASE_URL}/{route}", wait_until="domcontentloaded")
                if isinstance(heading, str):
                    page.get_by_role("heading", name=heading, exact=True).wait_for()
                else:
                    page.get_by_role("heading", name=heading).wait_for()
                if page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth"):
                    raise RuntimeError(f"Horizontal overflow on mobile {route}")
                cls = page.evaluate("""() => {
                    return new Promise((resolve) => {
                        let shift = 0;
                        try {
                            const observer = new PerformanceObserver((list) => {
                                for (const entry of list.getEntries()) {
                                    if (!entry.hadRecentInput) shift += entry.value;
                                }
                            });
                            observer.observe({ type: 'layout-shift', buffered: true });
                            setTimeout(() => { observer.disconnect(); resolve(shift); }, 400);
                        } catch { resolve(0); }
                    });
                }""")
                metrics["clsScores"][route] = round(cls, 4)
                if cls > 0.25:
                    raise RuntimeError(f"CLS on {route} exceeded budget: {cls}")
                clean_name = route.replace("/", "-")
                page.screenshot(path=str(artifact_dir / f"{clean_name}-mobile.png"), full_page=True)
                metrics["mobileRoutesChecked"].append(route)
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
