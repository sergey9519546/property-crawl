import base64
import os
import re
import unittest
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import Route, sync_playwright


BASE_URL = os.environ.get("NEXT_UI_URL", "http://localhost:3103").rstrip("/")
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M/wn4GBgYGJAQoAHgQCAftBaxkAAAAASUVORK5CYII="
)


def listing(listing_id="fixture-one", address="125 Fixture Avenue, Los Angeles, CA 90049"):
    return {
        "id": listing_id,
        "source": "servicelink",
        "state": "CA",
        "county": "Los Angeles",
        "city": "Los Angeles",
        "zip": "90049",
        "address": address,
        "lat": 34.0522,
        "lng": -118.2437,
        "beds": 3,
        "baths": 2,
        "sqft": 1600,
        "year": 1950,
        "propType": "Single Family",
        "openingBid": 500000,
        "saleDate": "2026-10-05",
        "photo": None,
        "sourceUrl": "https://example.test/publisher/fixture-one",
        "sourceObservedAt": "2026-09-07T12:00:00.000Z",
        "program": "Foreclosure",
        "lifecycle": "active",
        "hasDocuments": False,
        "provenance": {
            "origin": "live",
            "observed": True,
            "recordKind": "source_record",
            "publisher": "Fixture publisher",
            "recordId": listing_id,
            "observedAt": "2026-09-07T12:00:00.000Z",
        },
    }


def listing_payload(items=None, facets=None):
    items = [listing()] if items is None else items
    return {
        "listings": items,
        "total": len(items),
        "revision": "fixture-revision",
        "page": {"nextCursor": None, "hasMore": False},
        "facets": facets
        or {
            "state": [{"value": "CA", "count": len(items)}],
            "county": [{"value": "Los Angeles", "count": len(items)}],
            "source": [{"value": "servicelink", "count": len(items)}],
            "type": [{"value": "Single Family", "count": len(items)}],
            "program": [{"value": "Foreclosure", "count": len(items)}],
            "lifecycle": [{"value": "active", "count": len(items)}],
            "occupancy": [],
            "freshness": [],
        },
    }


class DiscoveryUiRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def make_page(self, viewport):
        context = self.browser.new_context(viewport=viewport)
        context.route(
            "**/*",
            lambda route: route.continue_()
            if route.request.url.startswith(BASE_URL)
            else route.abort(),
        )
        context.route(
            "**/api/workspace/session",
            lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                json={
                    "authenticated": False,
                    "configured": True,
                    "expiresAt": None,
                },
            ),
        )
        page = context.new_page()
        page.set_default_timeout(8_000)
        return context, page

    def test_thumbnail_is_on_demand_retriable_and_responsive(self):
        for width in (1440, 390):
            with self.subTest(width=width):
                context, page = self.make_page({"width": width, "height": 900})
                image_requests = []
                metadata_attempts = 0

                def listings_route(route: Route):
                    route.fulfill(json=listing_payload())

                def property_image_route(route: Route):
                    nonlocal metadata_attempts
                    query = parse_qs(urlparse(route.request.url).query)
                    mode = query.get("mode", [""])[0]
                    image_requests.append(mode)
                    if mode == "metadata":
                        metadata_attempts += 1
                        if metadata_attempts == 1:
                            route.fulfill(
                                status=503,
                                json={
                                    "available": False,
                                    "reason": "Coverage is temporarily unavailable.",
                                },
                            )
                        else:
                            route.fulfill(
                                json={
                                    "available": True,
                                    "provider": "Google Maps",
                                    "attribution": "Google Street View",
                                    "captureDate": "2025-04",
                                    "distanceMeters": 12.4,
                                    "panoramaId": "fixture-panorama",
                                    "panoramaLocation": {"lat": 34.0521, "lng": -118.2436},
                                    "targetHeading": 92,
                                    "coverage": "nearby_street",
                                }
                            )
                    elif mode == "image":
                        route.fulfill(status=200, headers={"Content-Type": "image/png"}, body=PNG)
                    else:
                        route.fulfill(status=404, json={"error": "Unexpected fixture request"})

                page.route("**/api/listings?**", listings_route)
                page.route("**/api/property-image?**", property_image_route)
                page.goto(f"{BASE_URL}/listings", wait_until="domcontentloaded")
                page.get_by_role("heading", name="125 Fixture Avenue").wait_for()
                self.assertEqual(image_requests, [], "thumbnail fetched Street View before user action")

                check = page.get_by_role(
                    "button", name="Load Street View for 125 Fixture Avenue, Los Angeles, CA 90049"
                )
                check.click()
                page.get_by_text("Coverage is temporarily unavailable.", exact=True).wait_for()
                self.assertEqual(image_requests, ["metadata"])

                page.get_by_role(
                    "button", name="Load Street View for 125 Fixture Avenue, Los Angeles, CA 90049"
                ).click()
                street = page.get_by_test_id("listing-thumbnail-streetview")
                street.wait_for()
                image = street.locator("img")
                page.wait_for_function("img => img.complete && img.naturalWidth > 0", arg=image.element_handle())
                self.assertEqual(image_requests, ["metadata", "metadata", "image"])
                self.assertIn("Google Maps", street.inner_text())
                self.assertIn("Captured April 2025", street.inner_text())
                self.assertIn("12 m from matched location", street.inner_text())
                self.assertIn("Street context only", street.inner_text())
                self.assertEqual(image.get_attribute("class").split().count("object-contain"), 1)

                frame = street.locator(":scope > div").first
                box = frame.bounding_box()
                self.assertIsNotNone(box)
                self.assertAlmostEqual(box["width"] / box["height"], 4 / 3, delta=0.03)
                overflow = page.evaluate(
                    "() => ({scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth})"
                )
                self.assertLessEqual(overflow["scroll"], overflow["client"])
                context.close()

    def test_refresh_failure_retains_only_same_query_results(self):
        context, page = self.make_page({"width": 1440, "height": 900})
        fail_requests = False

        def listings_route(route: Route):
            if fail_requests:
                route.fulfill(status=503, json={"error": "Fixture search failure"})
            else:
                route.fulfill(json=listing_payload())

        page.route("**/api/listings?**", listings_route)
        page.goto(f"{BASE_URL}/listings", wait_until="domcontentloaded")
        card = page.get_by_role("heading", name="125 Fixture Avenue")
        card.wait_for()

        fail_requests = True
        page.get_by_role("button", name="Refresh", exact=True).click()
        page.get_by_text("Showing previously loaded results. Refresh to check for updates.", exact=True).wait_for()
        self.assertTrue(card.is_visible())

        page.get_by_placeholder("Address, parcel, court case, or keyword").fill("different parcel")
        page.get_by_role("button", name="Search", exact=True).click()
        page.wait_for_url(re.compile(r"[?&]q=different(?:\+|%20)parcel(?:&|$)"))
        page.get_by_role("alert").filter(
            has_text=re.compile(r"Fixture search failure|Property search could not be reached")
        ).wait_for()
        self.assertEqual(card.count(), 0, "a failed changed query left stale cards visible")
        self.assertEqual(
            page.get_by_text("Showing previously loaded results. Refresh to check for updates.", exact=True).count(),
            0,
        )
        context.close()

    def test_empty_results_keep_selected_state_option(self):
        context, page = self.make_page({"width": 1280, "height": 800})
        page.route(
            "**/api/listings?**",
            lambda route: route.fulfill(
                json=listing_payload([], facets={
                    "state": [], "county": [], "source": [], "type": [], "program": [],
                    "lifecycle": [], "occupancy": [], "freshness": [],
                })
            ),
        )
        page.goto(f"{BASE_URL}/listings?state=CA", wait_until="domcontentloaded")
        page.get_by_role("heading", name="No listings match your filters.").wait_for()
        # Next's development router can retain an inert previous route briefly.
        # Scope to the exposed main landmark, and still fail if two State
        # controls are accessible in the active page.
        labeled_states = page.get_by_label("State")
        visible_states = [
            index for index in range(labeled_states.count())
            if labeled_states.nth(index).is_visible()
        ]
        self.assertEqual(len(visible_states), 1, "expected exactly one visible labeled State filter")
        main = page.get_by_role("main")
        self.assertEqual(main.count(), 1, "more than one main landmark is exposed")
        state = main.get_by_role("combobox", name="State", exact=True)
        self.assertEqual(state.count(), 1, "more than one State filter is exposed in the active page")
        self.assertEqual(state.input_value(), "CA")
        self.assertIn("CA (0)", state.locator("option:checked").inner_text())
        context.close()

    def test_watchlist_unlock_focus_and_escape_restore_opener(self):
        context, page = self.make_page({"width": 1280, "height": 800})
        page.route("**/api/listings?**", lambda route: route.fulfill(json=listing_payload()))
        page.goto(f"{BASE_URL}/listings", wait_until="domcontentloaded")
        opener = page.get_by_role(
            "button", name="Add to watchlist: 125 Fixture Avenue, Los Angeles, CA 90049"
        )
        opener.wait_for()
        opener.click()
        dialog = page.get_by_role("dialog", name="Unlock operator tools")
        dialog.wait_for()
        password = page.get_by_label("Workspace access key")
        self.assertTrue(password.evaluate("element => document.activeElement === element"))
        page.keyboard.press("Escape")
        dialog.wait_for(state="hidden")
        self.assertTrue(opener.evaluate("element => document.activeElement === element"))
        context.close()

    def test_source_null_coverage_renders_plain_fallback(self):
        context, page = self.make_page({"width": 1280, "height": 800})
        fixture = {
            "sources": [{
                "id": "null-coverage", "label": "Fixture County Records", "category": "county",
                "role": "evidence", "coverage": None, "organization": "Fixture County",
                "propertyLookup": True, "discoveryUrl": "https://example.test/records",
                "access": "public", "adapterKey": None, "discoveryStatus": "manual",
                "workflow": {"primary": "Check the public record.", "fallback": "Review manually.",
                             "cadenceHours": 24, "steps": ["Open the record."]},
                "requiredEvidence": ["Parcel record"], "notes": "Fixture only", "automated": False,
                "status": "manual", "observedRecords": 0, "observedStates": [],
                "latestObservation": None, "automatedEvidence": False, "evidencePackets": 0,
                "dueAt": None, "nextAction": "Review", "lastRun": None,
            }],
            "signals": [], "collectionRunning": False, "inventoryTruncated": False,
            "evidenceQueueError": False, "historyUnavailable": False,
            "summary": {"catalogSources": 1, "automatedCollectors": 0, "collected": 0,
                        "needsAttention": 0, "importSources": 0, "observedRecords": 0,
                        "trackedRecords": 0},
            "storageMode": "fixture",
        }
        page.route("**/api/source-network", lambda route: route.fulfill(json=fixture))
        page.goto(f"{BASE_URL}/sources", wait_until="domcontentloaded")
        page.get_by_role("heading", name="Fixture County Records").wait_for()
        self.assertTrue(page.get_by_text("No operational collection coverage recorded.", exact=True).is_visible())
        context.close()


if __name__ == "__main__":
    unittest.main()
