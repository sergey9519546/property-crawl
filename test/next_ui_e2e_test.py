import os
import base64
import re
import unittest
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("NEXT_UI_URL", "http://localhost:3001")
STATE_NAMES = {
    "AZ": "Arizona",
    "FL": "Florida",
    "GA": "Georgia",
    "IL": "Illinois",
    "NJ": "New Jersey",
    "NV": "Nevada",
    "OH": "Ohio",
    "PA": "Pennsylvania",
    "TX": "Texas",
}

STORYTELLER_OPPORTUNITIES = [
    "4120 Clark Ave",
    "7604 Detroit Ave",
    "8010 Woodland Ave",
    "11818 Superior Ave",
    "4532 Broadview Rd",
]


class PerfectPropertyNextUiE2E(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 1000})
        self.page = self.context.new_page()
        self.page.set_default_timeout(5_000)
        self.page.goto(BASE_URL, wait_until="domcontentloaded")
        listings_response = self.page.request.get(f"{BASE_URL}/api/listings?limit=1000")
        self.assertTrue(listings_response.ok, f"listing API returned {listings_response.status}: {listings_response.text()[:300]}")
        self.listings = listings_response.json()["listings"]
        self.assertGreater(len(self.listings), 0)
        self.live_count = len(self.listings)
        self.primary_listing = self.listings[0]
        self.market_listing = next(listing for listing in self.listings
            if listing.get("city") and listing["city"].lower() != "unknown"
            and listing.get("zip") and listing["zip"] != "00000"
            and listing.get("county") and listing["county"].lower() != "unknown")

    def tearDown(self):
        self.page.close()
        self.context.close()

    def wait_for_live_feed(self):
        self.page.get_by_role(
            "button", name=f"Deal Grid ({self.live_count} records)"
        ).wait_for(state="visible")

    def geocoded_listings(self, listings=None):
        # Positive map tests declare their qualified fixture records explicitly.
        # Finite coordinates in the application's snapshot data are not evidence.
        candidates = self.listings if listings is None else listings
        return [listing for listing in candidates if listing["id"] in self.verified_map_ids]

    def install_map_fixture(self, page=None, snapshots_only=False, coincident=False, tiles_available=True):
        target = page or self.page
        if tiles_available:
            # A local valid style exercises MapLibre's real camera and markers
            # without depending on third-party tile uptime. The failure test
            # deliberately skips this route and blocks all external requests.
            target.route("https://tiles.openfreemap.org/styles/positron", lambda route: route.fulfill(json={
                "version": 8, "sources": {}, "layers": [{"id": "test-background", "type": "background",
                    "paint": {"background-color": "#eef2f6"}}]}))
        observed_at = datetime.now(timezone.utc).isoformat()
        records = []
        for index, (city, state, zip_code, lat, lng) in enumerate([
            ("Park Ridge", "NJ", "07656", 41.03, -74.04),
            ("Pittsburgh", "PA", "15219", 40.44, -79.99),
            ("Akron", "OH", "44308", 41.08, -81.51),
        ]):
            # Synthetic fixtures are confined to browser interception; no API data
            # or persisted collection evidence is modified by the suite.
            record_id = str(90001 + index)
            source_url = f"https://salesweb.civilview.com/Sales/SaleDetails?PropertyId={record_id}"
            listing = deepcopy(self.primary_listing)
            listing.update(id=f"map-fixture-{record_id}", source="civilview", sourceUrl=source_url,
                address=f"{10 + index} Test Avenue, {city}, {state} {zip_code}",
                city=city, county="Fixture", state=state, zip=zip_code, lat=lat, lng=lng,
                photo=None, sourceObservedAt=observed_at,
                provenance={"origin": "live", "observed": True, "recordKind": "source_record",
                    "publisher": "CivilView test fixture", "recordId": record_id, "observedAt": observed_at,
                    "coordinates": {"lat": lat, "lng": lng, "observedAt": observed_at,
                        "sourceRecordUrl": source_url, "origin": "publisher_record", "verification": "source_extracted"}})
            records.append(listing)
        self.verified_map_ids = {listing["id"] for listing in records}
        snapshot = deepcopy(records[0])
        snapshot.update(id="map-snapshot", address="99 Snapshot Road", provenance={"origin": "snapshot", "observed": False})
        unqualified = deepcopy(records[1])
        unqualified["id"] = "map-unverified-coordinate"
        unqualified["provenance"].pop("coordinates")
        records.extend([snapshot, unqualified])
        if coincident:
            duplicate = deepcopy(records[0])
            duplicate["id"] = "map-coincident-record"
            duplicate["provenance"]["recordId"] = "90004"
            duplicate["sourceUrl"] = "https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=90004"
            duplicate["provenance"]["coordinates"]["sourceRecordUrl"] = duplicate["sourceUrl"]
            self.verified_map_ids.add(duplicate["id"])
            records.append(duplicate)
        if snapshots_only:
            records = [snapshot, unqualified]
            self.verified_map_ids = set()
        self.listings = records
        self.live_count = len(records)
        target.route("**/api/listings?**", lambda route: route.fulfill(json={"listings": records, "total": len(records)}))

    def open_live_market_map(self, page=None, result_count=None):
        target_page = page or self.page
        count = self.live_count if result_count is None else result_count
        target_page.get_by_role("button", name=f"Map ({count} records)").click()
        market_map = target_page.get_by_test_id("market-map")
        market_map.wait_for(state="visible")
        return market_map

    def test_navigation_links_have_real_destinations(self):
        placeholder_links = self.page.locator('a[href="#"]')
        labels = [text.strip() for text in placeholder_links.all_inner_texts() if text.strip()]

        self.assertEqual(
            placeholder_links.count(),
            0,
            f"hash-only links do nothing and must be replaced: {labels}",
        )

    def test_desktop_navigation_menus_reveal_their_feature_links(self):
        menu_expectations = {
            "Product": "Deal Stacks",
            "Solutions": "Acquisitions",
            "Resources": "Blog",
        }
        for menu_name, link_name in menu_expectations.items():
            with self.subTest(menu=menu_name):
                self.page.get_by_role("button", name=menu_name).click()
                panel = self.page.get_by_test_id("desktop-mega-menu")
                panel.get_by_role("link", name=re.compile(f"^{re.escape(link_name)}")).wait_for(state="visible")
                self.assertTrue(panel.get_by_role("link", name=re.compile(f"^{re.escape(link_name)}")).is_visible())
        self.page.get_by_role("button", name="Resources").press("Escape")
        self.page.get_by_test_id("desktop-mega-menu").wait_for(state="hidden")

    def test_navigation_avoids_brand_overlap_at_compact_breakpoints(self):
        for width in (320, 390, 1024, 1200, 1280, 1440):
            with self.subTest(width=width):
                self.page.set_viewport_size({"width": width, "height": 900})
                header = self.page.locator("header").first
                brand = header.get_by_role("link", name="PerfectProperty home").bounding_box()
                self.assertIsNotNone(brand)
                if width < 1280:
                    self.assertFalse(header.locator("nav").is_visible())
                    menu = header.get_by_role("button", name="Open menu").bounding_box()
                    self.assertIsNotNone(menu)
                    self.assertLessEqual(brand["x"] + brand["width"], menu["x"])
                else:
                    nav = header.locator("nav").bounding_box()
                    sign_in = header.get_by_role("link", name="Sign in", exact=True).bounding_box()
                    self.assertIsNotNone(nav)
                    self.assertIsNotNone(sign_in)
                    self.assertLessEqual(brand["x"] + brand["width"], nav["x"])
                    self.assertLessEqual(nav["x"] + nav["width"], sign_in["x"])

    def test_every_feed_card_links_to_its_exact_listing_page(self):
        self.wait_for_live_feed()
        links = self.page.get_by_test_id("listing-detail-link")
        self.assertEqual(links.count(), self.live_count)

        expected = {
            f"/listings/{listing['id']}" for listing in self.listings
        }
        actual = {links.nth(index).get_attribute("href") for index in range(links.count())}
        self.assertEqual(actual, expected)

        primary = self.primary_listing
        self.page.get_by_role(
            "link", name=f"Open listing page for {primary['address']}"
        ).click()
        self.page.get_by_role("heading", level=1, name=primary["address"]).wait_for()
        self.assertEqual(self.page.url, f"{BASE_URL}/listings/{primary['id']}")

        exact_link = self.page.get_by_test_id("exact-source-listing-link")
        unavailable = self.page.get_by_test_id("exact-source-listing-unavailable")
        self.assertEqual(exact_link.count() + unavailable.count(), 1)

    def test_live_map_uses_maplibre_tracks_filters_and_opens_the_listing_workflow(self):
        self.install_map_fixture()
        self.page.reload(wait_until="domcontentloaded")
        self.wait_for_live_feed()
        market_map = self.open_live_market_map()
        geocoded = self.geocoded_listings()
        self.assertGreater(len(geocoded), 0)
        self.assertEqual(market_map.get_attribute("data-map-engine"), "maplibre")

        map_surface = self.page.get_by_test_id("live-market-maplibre")
        map_surface.wait_for(state="visible")
        self.assertTrue(
            map_surface.evaluate(
                "element => element.classList.contains('maplibregl-map') || Boolean(element.querySelector('.maplibregl-map'))"
            )
        )
        map_canvas = map_surface.locator("canvas.maplibregl-canvas")
        map_canvas.wait_for(state="visible")
        self.assertEqual(map_canvas.count(), 1)

        self.page.wait_for_function(
            "expected => document.querySelectorAll('[data-testid=map-marker]').length === expected",
            arg=len(geocoded),
            timeout=10_000,
        )
        self.page.wait_for_function(
            "() => { const map = document.querySelector('[data-testid=market-map]'); return map?.dataset.mapReady === 'true' || map?.dataset.mapUnavailable === 'true'; }",
            timeout=10_000,
        )
        markers = self.page.get_by_test_id("map-marker")
        self.assertEqual(markers.count(), len(geocoded))
        marker_labels = markers.evaluate_all(
            "elements => elements.map(element => element.getAttribute('aria-label'))"
        )
        for listing in geocoded:
            self.assertIn(f"Show {listing['address']} on map", marker_labels)

        primary = geocoded[0]
        primary_marker = self.page.get_by_role(
            "button", name=f"Show {primary['address']} on map"
        )
        if market_map.get_attribute("data-map-unavailable") == "true":
            self.page.get_by_role(
                "button", name=f"Inspect {primary['address']} without map tiles"
            ).click()
        else:
            primary_marker.click()
        preview = self.page.get_by_test_id("map-listing-preview")
        preview.wait_for(state="visible")
        self.assertIn(primary["address"], preview.inner_text())
        self.assertEqual(primary_marker.get_attribute("aria-pressed"), "true")
        listing_link = preview.get_by_role("link", name="Listing page")
        self.assertEqual(
            listing_link.get_attribute("href"),
            f"/listings/{primary['id']}",
        )
        preview.get_by_role("button", name="Underwrite").click()
        self.page.get_by_role("dialog", name=primary["address"]).wait_for(state="visible")

        self.page.get_by_role("button", name="Close drawer").click()
        state = Counter(listing["state"] for listing in geocoded).most_common(1)[0][0]
        self.page.get_by_role("combobox", name="State filter").select_option(state)
        expected = sum(listing["state"] == state for listing in geocoded)
        self.page.wait_for_function(
            "expected => document.querySelectorAll('[data-testid=map-marker]').length === expected",
            arg=expected,
            timeout=10_000,
        )
        self.assertEqual(self.page.get_by_test_id("map-marker").count(), expected)
        self.assertIn(
            f"{expected} records with verified locations",
            market_map.inner_text(),
        )

    def test_live_map_zoom_keyboard_pan_and_reset_controls_update_the_real_camera(self):
        self.install_map_fixture()
        self.page.reload(wait_until="domcontentloaded")
        self.wait_for_live_feed()
        market_map = self.open_live_market_map()
        self.page.get_by_test_id("live-market-maplibre").wait_for(state="visible")
        self.page.wait_for_function(
            "() => { const map = document.querySelector('[data-testid=market-map]'); return map?.dataset.mapReady === 'true' || map?.dataset.mapUnavailable === 'true'; }",
            timeout=10_000,
        )
        self.page.wait_for_timeout(800)

        initial_center = market_map.get_attribute("data-map-center")
        initial_zoom = float(market_map.get_attribute("data-map-zoom"))
        self.assertRegex(initial_center, r"^-?\d+\.\d+,-?\d+\.\d+$")

        zoom_in = self.page.get_by_role("button", name="Zoom map in")
        zoom_out = self.page.get_by_role("button", name="Zoom map out")
        reset = self.page.get_by_role("button", name="Reset map view")
        self.assertTrue(zoom_in.is_enabled())
        self.assertTrue(zoom_out.is_enabled())
        self.assertTrue(reset.is_enabled())

        zoom_in.click()
        self.page.wait_for_function(
            "initial => Number(document.querySelector('[data-testid=market-map]')?.dataset.mapZoom) > initial",
            arg=initial_zoom,
            timeout=5_000,
        )
        zoomed = float(market_map.get_attribute("data-map-zoom"))
        self.assertGreater(zoomed, initial_zoom)

        map_canvas = self.page.get_by_test_id("live-market-maplibre").locator(
            "canvas.maplibregl-canvas"
        )
        did_pan = market_map.get_attribute("data-map-ready") == "true"
        self.assertTrue(did_pan, "the deterministic valid style must enable real keyboard camera interaction")
        if did_pan:
            before_pan = market_map.get_attribute("data-map-center")
            map_canvas.evaluate("element => element.focus()")
            map_canvas.press("ArrowRight")
            self.page.wait_for_function(
                "before => document.querySelector('[data-testid=market-map]')?.dataset.mapCenter !== before",
                arg=before_pan,
                timeout=5_000,
            )
            self.assertNotEqual(market_map.get_attribute("data-map-center"), before_pan)
        else:
            self.assertEqual(market_map.get_attribute("data-map-unavailable"), "true")
            self.assertEqual(map_canvas.get_attribute("tabindex"), "0")
            self.assertIn("map", map_canvas.get_attribute("aria-label").lower())
            self.page.get_by_test_id("map-fallback-list").wait_for(state="visible")

        center_before_reset = market_map.get_attribute("data-map-center")
        reset.click()
        self.page.wait_for_function(
            "zoomed => Number(document.querySelector('[data-testid=market-map]')?.dataset.mapZoom) < zoomed",
            arg=zoomed,
            timeout=5_000,
        )
        if did_pan:
            self.page.wait_for_function(
                "panned => document.querySelector('[data-testid=market-map]')?.dataset.mapCenter !== panned",
                arg=center_before_reset,
                timeout=5_000,
            )
        self.assertLess(
            float(market_map.get_attribute("data-map-zoom")), zoomed
        )

    def test_live_map_stays_within_mobile_bounds_and_respects_reduced_motion(self):
        reduced_page = self.browser.new_page(viewport={"width": 390, "height": 844})
        reduced_page.set_default_timeout(10_000)
        reduced_page.emulate_media(reduced_motion="reduce")
        self.install_map_fixture(reduced_page)
        try:
            reduced_page.goto(BASE_URL, wait_until="domcontentloaded")
            reduced_page.get_by_role(
                "button", name=f"Deal Grid ({self.live_count} records)"
            ).wait_for(state="visible")
            market_map = self.open_live_market_map(reduced_page)
            reduced_page.wait_for_function(
                "document.querySelector('[data-testid=market-map]')?.dataset.mapMotion === 'reduced'"
            )
            reduced_page.wait_for_function(
                "() => { const map = document.querySelector('[data-testid=market-map]'); return map?.dataset.mapReady === 'true' || map?.dataset.mapUnavailable === 'true'; }",
                timeout=10_000,
            )
            self.assertEqual(market_map.get_attribute("data-map-motion"), "reduced")

            map_box = market_map.bounding_box()
            self.assertIsNotNone(map_box)
            self.assertGreaterEqual(map_box["x"], 0)
            self.assertLessEqual(map_box["x"] + map_box["width"], 390)
            self.assertLessEqual(
                market_map.evaluate("element => element.scrollWidth - element.clientWidth"),
                1,
            )
            self.assertLessEqual(
                reduced_page.evaluate("document.documentElement.scrollWidth"), 390
            )

            markers = reduced_page.get_by_test_id("map-marker")
            reduced_page.wait_for_function(
                "expected => document.querySelectorAll('[data-testid=map-marker]').length === expected",
                arg=len(self.geocoded_listings()),
                timeout=10_000,
            )
            self.assertEqual(
                markers.first.evaluate(
                    "element => getComputedStyle(element).animationName"
                ),
                "none",
            )

            listing = self.geocoded_listings()[0]
            if market_map.get_attribute("data-map-unavailable") == "true":
                reduced_page.get_by_role(
                    "button", name=f"Inspect {listing['address']} without map tiles"
                ).click(force=True)
            else:
                reduced_page.get_by_role(
                    "button", name=f"Show {listing['address']} on map"
                ).click(force=True)
            preview = reduced_page.get_by_test_id("map-listing-preview")
            preview.wait_for(state="visible")
            preview_box = preview.bounding_box()
            self.assertIsNotNone(preview_box)
            self.assertGreaterEqual(preview_box["x"], 0)
            self.assertLessEqual(preview_box["x"] + preview_box["width"], 390)
        finally:
            reduced_page.close()

    def test_live_map_keeps_an_accessible_listing_fallback_when_all_external_tiles_fail(self):
        offline_page = self.browser.new_page(viewport={"width": 1440, "height": 1000})
        offline_page.set_default_timeout(12_000)

        def block_external_requests(route):
            url = route.request.url
            if url.startswith(BASE_URL) or url.startswith("data:") or url.startswith("blob:"):
                route.continue_()
            else:
                route.abort()

        offline_page.route("**/*", block_external_requests)
        self.install_map_fixture(offline_page, tiles_available=False)
        try:
            offline_page.goto(BASE_URL, wait_until="domcontentloaded")
            offline_page.get_by_role(
                "button", name=f"Deal Grid ({self.live_count} records)"
            ).wait_for(state="visible")
            market_map = self.open_live_market_map(offline_page)
            self.assertEqual(market_map.get_attribute("data-map-engine"), "maplibre")
            canvas = offline_page.get_by_test_id("live-market-maplibre").locator(
                "canvas.maplibregl-canvas"
            )
            canvas.wait_for(state="visible")

            fallback_status = market_map.get_by_role("status").filter(
                has_text=re.compile(r"tiles .*unavailable", re.I)
            )
            fallback_status.wait_for(state="visible", timeout=12_000)
            self.assertIn("listing coordinates", fallback_status.inner_text())
            zoom_before = float(market_map.get_attribute("data-map-zoom"))
            offline_page.get_by_role("button", name="Zoom map in", exact=True).click()
            self.assertGreater(float(market_map.get_attribute("data-map-zoom")), zoom_before,
                "unavailable styles must not leave a stale claimed camera position")

            geocoded = self.geocoded_listings()
            fallback_list = offline_page.get_by_test_id("map-fallback-list")
            self.assertEqual(fallback_list.get_by_role("button").count(), len(geocoded))
            self.assertEqual(offline_page.get_by_test_id("map-marker").count(), len(geocoded))

            listing = geocoded[0]
            fallback_list.get_by_role(
                "button", name=f"Inspect {listing['address']} without map tiles"
            ).click()
            preview = offline_page.get_by_test_id("map-listing-preview")
            preview.wait_for(state="visible")
            self.assertIn(listing["address"], preview.inner_text())
            self.assertEqual(
                preview.get_by_role("link", name="Listing page").get_attribute("href"),
                f"/listings/{listing['id']}",
            )
        finally:
            offline_page.close()

    def test_live_map_never_plots_snapshot_or_unverified_coordinates(self):
        self.install_map_fixture(snapshots_only=True)
        self.page.reload(wait_until="domcontentloaded")
        self.wait_for_live_feed()
        market_map = self.open_live_market_map()
        market_map.get_by_text("No verified property locations match these filters.", exact=True).wait_for(state="visible")
        self.assertEqual(self.page.get_by_test_id("map-marker").count(), 0)
        self.assertIn("0 records with verified locations", market_map.inner_text())
        self.assertIn("2 records need verified coordinates", market_map.inner_text())
        self.page.get_by_role("button", name="Deal Grid (2 records)", exact=True).click()
        self.assertEqual(self.page.get_by_test_id("listing-detail-link").count(), 2)

    def test_live_map_keeps_coincident_records_selectable_at_one_location(self):
        self.install_map_fixture(coincident=True)
        self.page.reload(wait_until="domcontentloaded")
        self.wait_for_live_feed()
        market_map = self.open_live_market_map()
        self.page.wait_for_function("document.querySelectorAll('[data-testid=map-marker]').length === 3")
        self.assertIn("4 records with verified locations · 3 map locations", market_map.inner_text())
        first = self.listings[0]
        marker = self.page.get_by_role("button", name=f"Show 2 source records at {first['address']}", exact=True)
        self.assertEqual(marker.get_attribute("data-record-count"), "2")
        # Exercise the real marker event even if external map tiles are unavailable.
        marker.dispatch_event("click")
        preview = self.page.get_by_test_id("map-listing-preview")
        preview.wait_for(state="visible")
        preview.get_by_role("button", name="map-coincident-record", exact=True).click()
        self.assertEqual(preview.get_by_role("link", name="Listing page").get_attribute("href"), "/listings/map-coincident-record")
        self.assertEqual(preview.get_by_role("button", name="map-coincident-record", exact=True).get_attribute("aria-pressed"), "true")
        self.assertEqual(marker.get_attribute("aria-pressed"), "true")

    def test_linked_information_pages_resolve(self):
        routes = [
            "/enterprise",
            "/resources",
            "/case-studies",
            "/about",
            "/contact",
            "/terms",
            "/privacy",
            "/security",
        ]

        for route in routes:
            with self.subTest(route=route):
                response = self.page.goto(f"{BASE_URL}{route}", wait_until="domcontentloaded")
                self.assertIsNotNone(response)
                self.assertLess(response.status, 400, f"{route} returned HTTP {response.status}")
                self.assertGreater(self.page.get_by_role("heading", level=1).count(), 0)

    def test_hero_submit_opens_and_filters_live_feed(self):
        city = self.primary_listing["city"]
        hero_input = self.page.get_by_role("combobox", name="Market or address")
        hero_input.fill(city)
        self.page.get_by_role("button", name="Search market").click()

        self.page.wait_for_timeout(200)
        self.assertEqual(self.page.url, f"{BASE_URL}/#live-feed")
        feed_search = self.page.get_by_placeholder("Search address, county, court docket...")
        self.assertEqual(feed_search.input_value(), city)
        self.assertGreater(self.page.get_by_role("button", name="Underwrite Deal").count(), 0)

    def test_hero_suggests_and_selects_real_markets_as_user_types(self):
        self.wait_for_live_feed()
        city = self.market_listing["city"]
        state = self.market_listing["state"]
        city_result_count = sum(listing["city"] == city for listing in self.listings)
        hero_input = self.page.get_by_role("combobox", name="Market or address")
        hero_input.fill(city)

        suggestion = self.page.get_by_role("option", name=f"{city}, {state} City market")
        suggestion.wait_for(state="visible")
        hero_input.press("ArrowDown")
        hero_input.press("Enter")
        self.assertEqual(hero_input.input_value(), f"{city}, {state}")

        self.page.get_by_role("button", name="Search market").click()
        feed_search = self.page.get_by_placeholder("Search address, county, court docket...")
        self.assertEqual(feed_search.input_value(), city)
        self.assertEqual(
            self.page.get_by_role("button", name="Underwrite Deal").count(),
            city_result_count,
        )

    def test_hero_can_launch_a_county_market(self):
        self.wait_for_live_feed()
        county = self.market_listing["county"]
        state = self.market_listing["state"]
        county_result_count = sum(listing["county"] == county for listing in self.listings)
        hero_input = self.page.get_by_role("combobox", name="Market or address")
        hero_input.fill(county)
        self.page.get_by_role(
            "option", name=f"{county} County, {state} County market"
        ).click()
        self.page.get_by_role("button", name="Search market").click()

        feed_search = self.page.get_by_placeholder("Search address, county, court docket...")
        self.assertEqual(feed_search.input_value(), county)
        self.assertEqual(
            self.page.get_by_role("button", name="Underwrite Deal").count(),
            county_result_count,
        )

    def test_hero_supports_state_country_zip_and_address_scopes(self):
        self.wait_for_live_feed()
        hero_input = self.page.get_by_role("combobox", name="Market or address")
        state_counts = Counter(listing["state"] for listing in self.listings)
        state, state_result_count = state_counts.most_common(1)[0]
        state_name = STATE_NAMES.get(state, state)
        address = self.market_listing["address"]
        city = self.market_listing["city"]
        zip_code = self.market_listing["zip"]

        hero_input.fill(state_name)
        self.page.get_by_role("option", name=f"{state_name} State").click()
        self.page.get_by_role("button", name="Search market").click()
        self.assertEqual(
            self.page.get_by_placeholder("Search address, county, court docket...").input_value(),
            state,
        )
        self.assertEqual(
            self.page.get_by_role("button", name="Underwrite Deal").count(),
            state_result_count,
        )

        self.page.evaluate("window.scrollTo(0, 0)")
        hero_input.fill(address.split(",")[0])
        self.page.get_by_role(
            "option", name=f"{address} Address nearby {city}"
        ).click()
        self.page.get_by_role("button", name="Search market").click()
        self.assertEqual(
            self.page.get_by_placeholder("Search address, county, court docket...").input_value(),
            city,
        )

        self.page.evaluate("window.scrollTo(0, 0)")
        hero_input.fill(zip_code)
        self.page.get_by_role(
            "option", name=f"{zip_code} — {city} area ZIP area"
        ).click()
        self.page.get_by_role("button", name="Search market").click()
        self.assertEqual(
            self.page.get_by_placeholder("Search address, county, court docket...").input_value(),
            zip_code,
        )

        self.page.evaluate("window.scrollTo(0, 0)")
        hero_input.fill("United States")
        self.page.get_by_role("option", name="United States Country coverage").click()
        self.page.get_by_role("button", name="Search market").click()
        self.assertEqual(
            self.page.get_by_placeholder("Search address, county, court docket...").input_value(),
            "",
        )
        self.assertEqual(
            self.page.get_by_role("button", name="Underwrite Deal").count(),
            self.live_count,
        )

    def test_first_impression_copy_and_wide_navigation_layout(self):
        self.assertTrue(
            self.page.get_by_role("heading", name="Find the deal before everyone else.", level=1).is_visible()
        )
        self.assertTrue(
            self.page.get_by_text("Search any market or address. See the best opportunities, the catch, and your next move — before you bid.").is_visible()
        )

        self.page.set_viewport_size({"width": 2322, "height": 1272})
        header = self.page.locator("header").first
        brand = self.page.get_by_role("link", name="PerfectProperty home").first
        signup = self.page.get_by_role("link", name="Sign up for free").first
        navigation = header.locator("nav")
        header_box = header.bounding_box()
        brand_box = brand.bounding_box()
        signup_box = signup.bounding_box()
        navigation_box = navigation.bounding_box()
        hero = self.page.locator("#hero")
        hero_heading = self.page.get_by_role(
            "heading", name="Find the deal before everyone else.", level=1
        )
        hero_search = self.page.locator("#hero form").first
        hero_content_stack = self.page.get_by_test_id("hero-content-stack")
        hero_art = self.page.get_by_test_id("hero-property-blueprint").locator("img")
        hero_box = hero.bounding_box()
        hero_heading_box = hero_heading.bounding_box()
        hero_search_box = hero_search.bounding_box()
        hero_content_stack_box = hero_content_stack.bounding_box()
        hero_art_box = hero_art.bounding_box()

        self.assertIsNotNone(header_box)
        self.assertIsNotNone(brand_box)
        self.assertIsNotNone(signup_box)
        self.assertIsNotNone(navigation_box)
        self.assertIsNotNone(hero_box)
        self.assertIsNotNone(hero_heading_box)
        self.assertIsNotNone(hero_search_box)
        self.assertIsNotNone(hero_content_stack_box)
        self.assertIsNotNone(hero_art_box)
        self.assertGreater(header_box["width"], 2100)
        self.assertLess(brand_box["x"], 100)
        self.assertGreater(signup_box["x"] + signup_box["width"], 2220)
        self.assertAlmostEqual(
            navigation_box["x"] + navigation_box["width"] / 2,
            header_box["x"] + header_box["width"] / 2,
            delta=2,
        )
        hero_center = hero_box["x"] + hero_box["width"] / 2
        self.assertAlmostEqual(
            hero_heading_box["x"] + hero_heading_box["width"] / 2,
            hero_center,
            delta=3,
        )
        self.assertAlmostEqual(
            hero_search_box["x"] + hero_search_box["width"] / 2,
            hero_center,
            delta=3,
        )
        self.assertAlmostEqual(
            hero_content_stack_box["x"] + hero_content_stack_box["width"] / 2,
            hero_center,
            delta=3,
        )
        self.assertAlmostEqual(
            hero_content_stack_box["y"] + hero_content_stack_box["height"] / 2,
            hero_box["y"] + hero_box["height"] / 2,
            delta=4,
        )
        self.assertGreaterEqual(hero_art_box["width"], 1160)
        self.assertLessEqual(hero_art_box["width"], 1200)
        self.assertLessEqual(
            hero_art_box["x"] + hero_art_box["width"],
            hero_box["x"] + hero_box["width"] - 8,
            "the villa's transparent right edge should remain visible inside the hero",
        )
        self.assertLessEqual(
            hero_art_box["y"] + hero_art_box["height"],
            hero_box["y"] + hero_box["height"] - 8,
            "the villa's transparent bottom edge should remain visible inside the hero",
        )
        self.assertNotEqual(
            hero_art.evaluate("element => getComputedStyle(element).maskImage"),
            "none",
        )

    def test_hero_hook_and_search_are_fully_visible_within_one_second(self):
        self.page.wait_for_timeout(800)
        heading = self.page.get_by_role("heading", level=1)
        search = self.page.get_by_role("combobox", name="Market or address")
        blueprint = self.page.get_by_test_id("hero-property-blueprint")
        self.assertGreaterEqual(
            float(heading.evaluate("element => getComputedStyle(element).opacity")),
            0.99,
        )
        self.assertGreaterEqual(
            float(search.evaluate("element => getComputedStyle(element.closest('form')).opacity")),
            0.99,
        )
        self.assertTrue(blueprint.is_visible())
        self.assertEqual(
            blueprint.evaluate("element => getComputedStyle(element).mixBlendMode"),
            "multiply",
        )
        self.assertEqual(
            blueprint.evaluate("element => getComputedStyle(element).pointerEvents"),
            "none",
        )
        blueprint_image = blueprint.locator("img")
        blueprint_metrics = blueprint_image.evaluate(
            "element => ({ naturalWidth: element.naturalWidth, clientWidth: element.clientWidth })"
        )
        self.assertGreaterEqual(
            blueprint_metrics["naturalWidth"],
            blueprint_metrics["clientWidth"] - 2,
        )
        self.assertEqual(blueprint_image.get_attribute("width"), "1536")
        self.assertEqual(blueprint_image.get_attribute("height"), "1024")
        self.assertIn("hero-modern-villa.png", blueprint_image.get_attribute("src"))
        self.assertGreaterEqual(
            float(blueprint.evaluate("element => getComputedStyle(element).opacity")),
            0.75,
        )

        self.page.set_viewport_size({"width": 390, "height": 844})
        self.assertLessEqual(
            self.page.evaluate("document.documentElement.scrollWidth"),
            390,
        )
        self.assertGreater(
            float(blueprint.evaluate("element => getComputedStyle(element).opacity")),
            0.1,
        )

    def test_hero_shader_field_tracks_the_pointer(self):
        hero = self.page.locator("#hero")
        shader = self.page.get_by_test_id("hero-shader-field")
        hero_box = hero.bounding_box()
        self.assertIsNotNone(hero_box)
        shader.wait_for(state="visible")

        self.page.mouse.move(
            hero_box["x"] + hero_box["width"] * 0.2,
            hero_box["y"] + hero_box["height"] * 0.25,
        )
        self.page.wait_for_timeout(350)
        first_transform = shader.evaluate("element => getComputedStyle(element).transform")
        self.page.mouse.move(
            hero_box["x"] + hero_box["width"] * 0.82,
            hero_box["y"] + hero_box["height"] * 0.72,
        )
        self.page.wait_for_timeout(350)
        second_transform = shader.evaluate("element => getComputedStyle(element).transform")

        self.assertNotEqual(first_transform, second_transform)

    def test_hero_search_focus_uses_a_soft_halo_without_a_black_outline(self):
        search = self.page.get_by_role("combobox", name="Market or address")
        search.click()

        self.assertEqual(
            search.evaluate("element => getComputedStyle(element).outlineStyle"),
            "none",
        )
        self.assertNotEqual(
            search.evaluate("element => getComputedStyle(element.closest('form')).boxShadow"),
            "none",
        )

        city = self.market_listing["city"]
        search.fill(city)
        self.page.get_by_role("option").first.wait_for(state="visible")
        search.evaluate("element => { element.blur(); element.focus(); }")
        self.page.wait_for_timeout(180)
        self.assertTrue(self.page.get_by_role("listbox").is_visible())

        state_filter = self.page.get_by_role("combobox", name="State filter")
        state_filter.focus()
        self.page.keyboard.press("Tab")
        self.page.keyboard.press("Shift+Tab")
        self.assertEqual(
            state_filter.evaluate("element => getComputedStyle(element).outlineStyle"),
            "none",
        )
        self.assertNotEqual(
            state_filter.evaluate("element => getComputedStyle(element).boxShadow"),
            "none",
        )

    def test_beta_marketing_copy_does_not_present_unverified_claims_as_fact(self):
        self.assertEqual(self.page.get_by_text("Jake Martinez", exact=True).count(), 0)
        self.assertEqual(self.page.get_by_text("Saved searches with instant alerts", exact=True).count(), 0)
        self.assertEqual(self.page.get_by_text("Verified", exact=True).count(), 0)
        self.assertEqual(self.page.get_by_text(re.compile(r"2k flippers", re.I)).count(), 0)
        self.assertTrue(self.page.get_by_text("Beta snapshot", exact=True).first.is_visible())

    def test_storyteller_uses_a_real_map_engine_with_accessible_opportunities(self):
        deal_map = self.page.get_by_test_id("storyteller-deal-map")
        self.page.locator("#product").evaluate("element => element.scrollIntoView({block: 'center'})")
        desktop_box = deal_map.bounding_box()
        self.assertIsNotNone(desktop_box)
        self.assertGreaterEqual(desktop_box["width"], 900)
        self.assertGreaterEqual(desktop_box["height"], 480)

        self.assertEqual(deal_map.get_attribute("data-map-engine"), "maplibre")
        map_container = self.page.get_by_test_id("maplibre-map")
        map_container.wait_for(state="visible")
        self.assertTrue(
            map_container.evaluate(
                "element => element.classList.contains('maplibregl-map') || Boolean(element.querySelector('.maplibregl-map'))"
            )
        )
        map_canvas = map_container.locator("canvas.maplibregl-canvas")
        map_canvas.wait_for(state="visible")
        self.assertEqual(map_canvas.count(), 1)

        markers = self.page.get_by_test_id("storyteller-map-marker")
        markers.first.wait_for(state="visible")
        self.assertEqual(markers.count(), len(STORYTELLER_OPPORTUNITIES))
        opportunity_list = self.page.get_by_test_id("opportunity-list")
        self.assertTrue(opportunity_list.is_visible())
        self.assertEqual(opportunity_list.get_by_role("button").count(), 3)
        marker_labels = markers.evaluate_all(
            "elements => elements.map(element => element.getAttribute('aria-label'))"
        )
        for address in STORYTELLER_OPPORTUNITIES:
            with self.subTest(address=address):
                self.assertIn(f"Show {address} opportunity", marker_labels)
        ranked_labels = opportunity_list.get_by_role("button").evaluate_all(
            "elements => elements.map(element => element.getAttribute('aria-label'))"
        )
        self.assertTrue(
            all(label and label.startswith("Inspect ") for label in ranked_labels)
        )

        self.page.set_viewport_size({"width": 390, "height": 844})
        mobile_box = deal_map.bounding_box()
        self.assertIsNotNone(mobile_box)
        self.assertGreaterEqual(mobile_box["width"], 300)
        self.assertLessEqual(mobile_box["x"] + mobile_box["width"], 390)
        self.assertLessEqual(
            deal_map.evaluate("element => element.scrollWidth - element.clientWidth"),
            1,
        )
        self.assertLessEqual(self.page.evaluate("document.documentElement.scrollWidth"), 390)

    def test_storyteller_map_scan_is_one_shot_and_marker_selection_is_stable(self):
        deal_map = self.page.get_by_test_id("storyteller-deal-map")
        deal_map.wait_for(state="visible")
        preview = self.page.get_by_test_id("storyteller-map-preview")

        self.page.get_by_test_id("storyteller-map-marker").first.wait_for(state="visible")
        initial_deal = deal_map.get_attribute("data-active-deal")
        self.page.wait_for_timeout(1_600)
        self.assertEqual(
            deal_map.get_attribute("data-active-deal"),
            initial_deal,
            "the Opportunity Atlas must not auto-cycle the selected listing",
        )

        replay = self.page.get_by_role("button", name="Replay market discovery")
        replay.click()
        self.page.wait_for_function(
            "document.querySelector('[data-testid=storyteller-deal-map]')?.dataset.scanState === 'playing'"
        )
        self.page.wait_for_function(
            "document.querySelector('[data-testid=storyteller-deal-map]')?.dataset.scanState === 'complete'",
            timeout=12_000,
        )
        replayed_deal = deal_map.get_attribute("data-active-deal")
        self.page.wait_for_timeout(1_200)
        self.assertEqual(deal_map.get_attribute("data-active-deal"), replayed_deal)

        marker_buttons = self.page.get_by_test_id("storyteller-map-marker")
        marker_buttons.evaluate_all(
            "elements => { elements[1].click(); elements[3].click(); elements[2].click(); }"
        )
        preview.get_by_text("8010 Woodland Ave", exact=True).wait_for(state="visible")
        self.assertIn("8010 Woodland Ave", preview.inner_text())
        self.assertEqual(
            self.page.get_by_role(
                "button", name="Show 8010 Woodland Ave opportunity"
            ).get_attribute("aria-pressed"),
            "true",
        )
        selected_deal = deal_map.get_attribute("data-active-deal")
        self.page.wait_for_timeout(1_200)
        self.assertEqual(deal_map.get_attribute("data-active-deal"), selected_deal)

    def test_storyteller_map_has_an_accessible_tile_failure_fallback(self):
        offline_page = self.browser.new_page(viewport={"width": 1440, "height": 1000})
        offline_page.set_default_timeout(10_000)
        offline_page.route(
            "https://tiles.openfreemap.org/**",
            lambda route: route.abort(),
        )
        try:
            offline_page.goto(BASE_URL, wait_until="domcontentloaded")
            deal_map = offline_page.get_by_test_id("storyteller-deal-map")
            deal_map.wait_for(state="visible")
            fallback = offline_page.get_by_role("status").filter(
                has_text="Map tiles are unavailable"
            )
            fallback.wait_for(state="visible", timeout=10_000)
            self.assertIn("ranked list remain active", fallback.inner_text())
            self.assertEqual(
                offline_page.get_by_test_id("opportunity-list").get_by_role("button").count(),
                3,
            )
            self.assertEqual(
                offline_page.get_by_test_id("storyteller-map-marker").count(),
                len(STORYTELLER_OPPORTUNITIES),
            )
        finally:
            offline_page.close()

    def test_storyteller_map_respects_reduced_motion(self):
        self.page.emulate_media(reduced_motion="reduce")
        self.page.reload(wait_until="domcontentloaded")
        deal_map = self.page.get_by_test_id("storyteller-deal-map")
        deal_map.wait_for(state="visible")
        self.page.wait_for_function(
            "document.querySelector('[data-testid=storyteller-deal-map]')?.dataset.scanState === 'complete'"
        )
        self.assertEqual(deal_map.get_attribute("data-scan-state"), "complete")
        self.assertTrue(self.page.get_by_text("Motion reduced", exact=True).is_visible())
        active_deal = deal_map.get_attribute("data-active-deal")
        self.page.wait_for_timeout(1_200)
        self.assertEqual(deal_map.get_attribute("data-active-deal"), active_deal)

        reduced_motion_marker = self.page.get_by_role(
            "button", name="Show 4532 Broadview Rd opportunity"
        )
        reduced_motion_marker.wait_for(state="visible")
        reduced_motion_marker.click()
        self.assertIn(
            "4532 Broadview Rd",
            self.page.get_by_test_id("storyteller-map-preview").inner_text(),
        )

    def test_storyteller_workflow_renders_each_decision_state(self):
        self.page.locator("#product").evaluate("element => element.scrollIntoView({block: 'center'})")
        stage = self.page.get_by_test_id("storyteller-stage")
        expectations = [
            ("Find", "find", "storyteller-deal-map"),
            ("Verify", "verify", "storyteller-verify"),
            ("Underwrite", "underwrite", "storyteller-underwrite"),
            ("Act", "act", "storyteller-act"),
        ]

        for label, stage_name, test_id in expectations:
            with self.subTest(stage=label):
                self.page.get_by_role("tab", name=re.compile(rf"\b{label}\b")).click()
                self.assertEqual(stage.get_attribute("data-stage"), stage_name)
                self.page.get_by_test_id(test_id).wait_for(state="visible")

    def test_storyteller_workflow_uses_keyboard_accessible_tab_semantics(self):
        self.page.locator("#product").evaluate("element => element.scrollIntoView({block: 'center'})")
        tablist = self.page.get_by_role("tablist", name="Property decision workflow")
        tabs = tablist.get_by_role("tab")
        self.assertEqual(tabs.count(), 4)
        self.assertEqual(
            tabs.evaluate_all("elements => elements.filter(tab => tab.getAttribute('aria-selected') === 'true').length"),
            1,
        )

        find_tab = self.page.get_by_role("tab", name=re.compile(r"\bFind\b"))
        verify_tab = self.page.get_by_role("tab", name=re.compile(r"\bVerify\b"))
        find_tab.focus()
        self.page.keyboard.press("ArrowRight")
        self.assertEqual(verify_tab.get_attribute("aria-selected"), "true")
        self.assertTrue(verify_tab.evaluate("element => element === document.activeElement"))
        self.assertEqual(self.page.get_by_test_id("storyteller-stage").get_attribute("data-stage"), "verify")
        self.assertEqual(
            self.page.get_by_role("tabpanel").get_attribute("aria-labelledby"),
            "storyteller-tab-verify",
        )

    def test_team_tabs_render_each_feature_state(self):

        self.page.locator("#solutions").evaluate("element => element.scrollIntoView({block: 'center'})")
        for team in ["Marketing", "Acquisitions", "Disposition", "Underwriting"]:
            with self.subTest(team=team):
                self.page.get_by_role("button", name=team).click()
                self.page.get_by_text(f"PerfectProperty for {team}").wait_for(state="visible")

    def test_footer_uses_open_layout_without_divider_lines(self):
        footer = self.page.locator("footer#resources")
        newsletter = footer.locator("#contact")
        self.assertEqual(footer.evaluate("el => getComputedStyle(el).borderTopWidth"), "0px")
        self.assertEqual(newsletter.evaluate("el => getComputedStyle(el).borderBottomWidth"), "0px")
        self.assertTrue(footer.get_by_text("Subscribe to the PerfectProperty accuracy report").is_visible())

    def test_newsletter_submit_has_an_inline_honest_result(self):
        dialogs = []

        def handle_dialog(dialog):
            dialogs.append(dialog.message)
            dialog.dismiss()

        self.page.on("dialog", handle_dialog)
        self.page.get_by_role("textbox", name="Work email").fill("buyer@example.com")
        self.page.get_by_role("button", name="Subscribe").click()

        self.assertEqual(dialogs, [], "newsletter must not use a blocking browser alert")
        self.assertTrue(
            self.page.get_by_text("Saved on this device. Email delivery will be connected before launch.").is_visible()
        )

    def test_live_feed_loads_backend_data_and_refreshes_honestly(self):
        self.wait_for_live_feed()
        self.assertTrue(self.page.get_by_text("Unverified or demo feed — no source-observed records").is_visible())
        self.assertEqual(self.page.get_by_text("Live Ingestion Engine Active").count(), 0)

        self.page.get_by_role("button", name="Refresh live feed").click()
        self.page.get_by_text(f"0 observed · {self.live_count} demo/unverified").wait_for(state="visible")
        self.assertEqual(
            self.page.get_by_role("button", name="Underwrite Deal").count(),
            self.live_count,
        )

    def test_visible_controls_have_accessible_names(self):
        unnamed = self.page.locator("button, input, select, textarea").evaluate_all(
            """
            elements => elements
              .filter(element => element.getClientRects().length > 0)
              .filter(element => {
                const labels = element.labels ? Array.from(element.labels).map(label => label.textContent || '').join(' ') : '';
                const name = element.getAttribute('aria-label')
                  || element.getAttribute('aria-labelledby')
                  || labels
                  || element.textContent
                  || element.getAttribute('placeholder')
                  || element.getAttribute('title');
                return !name || !name.trim();
              })
              .map(element => element.outerHTML.slice(0, 220))
            """
        )

        self.assertEqual(unnamed, [], f"visible controls without accessible names: {unnamed}")

    def test_homepage_has_no_console_or_uncaught_runtime_errors(self):
        errors = []

        def collect_console(message):
            expected_map_transport_failure = (
                "tiles.openfreemap.org/styles/positron" in message.text
                and "Failed to fetch" in message.text
            )
            if (
                message.type == "error"
                and "ERR_NETWORK_ACCESS_DENIED" not in message.text
                and not expected_map_transport_failure
            ):
                errors.append(f"console: {message.text}")

        self.page.on("console", collect_console)
        self.page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
        self.page.reload(wait_until="domcontentloaded")
        self.page.wait_for_timeout(1_800)

        self.assertEqual(errors, [], f"runtime errors detected: {errors}")

    def test_watchlist_persists_across_reload(self):
        address = self.primary_listing["address"]
        add_button = self.page.get_by_role("button", name=f"Add {address} to watchlist")
        add_button.wait_for(state="visible")
        add_button.click()
        self.assertEqual(
            self.page.get_by_role("button", name=f"Remove {address} from watchlist").count(),
            1,
        )

        self.page.reload(wait_until="domcontentloaded")
        self.wait_for_live_feed()
        self.assertEqual(
            self.page.get_by_role("button", name=f"Remove {address} from watchlist").count(),
            1,
        )

    def test_property_underwrite_watchlist_and_export_journey(self):
        address = self.primary_listing["address"]
        self.wait_for_live_feed()
        self.page.get_by_placeholder("Search address, county, court docket...").fill(address)
        self.page.get_by_role("button", name="Underwrite Deal").first.click()

        self.page.get_by_role("heading", name=address, level=2).wait_for(state="visible")
        self.assertTrue(self.page.get_by_role("button", name="Puter AI").is_visible())
        self.page.get_by_role("button", name="Analyze Deal").click()
        self.page.get_by_text(re.compile(r"Evidence summary.*unverified")).wait_for(state="visible")

        self.page.get_by_role("button", name="3D Lot & Elevation").click()
        self.page.get_by_role("region", name="Parcel geometry reference").wait_for(state="visible")
        self.assertEqual(self.page.get_by_title("Toggle Wireframe Topography").count(), 0)

        # Test Bidding Simulator tab & MAO calculations
        self.page.get_by_role("button", name="Bidding Simulator").click()
        self.assertTrue(self.page.get_by_role("heading", name="Max Allowable Offer (MAO) Simulator").is_visible())
        self.assertEqual(self.page.get_by_text("Win Probability", exact=True).count(), 0)

        # Test Deal Video Teaser generator
        self.page.get_by_role("button", name="Build storyboard preview").click()
        self.page.get_by_text("OPPORTUNITY REVEAL").wait_for(state="visible", timeout=6000)
        self.assertTrue(self.page.get_by_text("Storyboard ready").is_visible())
        self.page.get_by_role("button", name="Re-generate").click()
        self.assertTrue(self.page.get_by_role("button", name="Build storyboard preview").is_visible())

        self.page.get_by_role("button", name="Add to Watchlist").click()
        self.page.get_by_role("button", name="Close drawer").click()

        self.page.get_by_role("button", name="Watchlist (1)").click()
        self.assertTrue(self.page.get_by_role("heading", name="Saved Watchlist (1)").is_visible())
        with self.page.expect_download() as download_info:
            self.page.get_by_role("button", name="Export CSV").click()
        self.assertEqual(download_info.value.suggested_filename, "perfectproperty_watchlist.csv")

        with self.page.expect_download() as json_download_info:
            self.page.get_by_role("button", name="Export JSON").click()
        self.assertEqual(json_download_info.value.suggested_filename, "perfectproperty_watchlist.json")

        self.page.get_by_title("Remove from watchlist").click()
        self.assertTrue(self.page.get_by_text("No saved properties yet").is_visible())

    def test_notice_parser_extracts_a_real_notice_and_adds_it_to_watchlist(self):
        address = "1248 W 76th St, Cleveland, OH 44102"
        self.page.get_by_role("button", name="Notice Parser").click()
        self.page.get_by_role("button", name="Paste sample notice").click()
        self.page.get_by_role("button", name="Extract stated facts").click()

        self.page.get_by_text("Unverified extraction — source review required", exact=True).wait_for(state="visible")
        self.assertTrue(self.page.get_by_text(address, exact=True).is_visible())
        self.page.get_by_role("button", name="Add extraction").click()

        self.assertTrue(self.page.get_by_role("dialog", name=address).is_visible())
        self.page.get_by_role("button", name="Close drawer").click()
        self.page.get_by_role("button", name="Watchlist (1)").click()
        watchlist = self.page.get_by_role("dialog", name="Saved Watchlist (1)")
        self.assertTrue(watchlist.get_by_text(address, exact=True).is_visible())

        self.page.reload(wait_until="domcontentloaded")
        self.page.get_by_role("button", name="Watchlist (1)").click()
        self.assertTrue(self.page.get_by_role("dialog", name="Saved Watchlist (1)").get_by_text(address, exact=True).is_visible())

    def test_saved_search_persists_and_opens_matching_inventory(self):
        self.wait_for_live_feed()
        chosen_state = self.primary_listing["state"]
        expected = sum(item["state"] == chosen_state for item in self.listings)
        self.page.get_by_role("button", name="Open Alerts Manager").click()
        self.page.get_by_label("Search name", exact=True).fill("My acquisition market")
        self.page.get_by_label("State market", exact=True).select_option(chosen_state)
        self.page.get_by_role("button", name="Save search", exact=True).click()
        self.page.get_by_text("Search saved on this browser.").wait_for(state="visible")
        self.page.reload(wait_until="domcontentloaded")
        self.wait_for_live_feed()
        self.page.get_by_role("button", name="Open Alerts Manager").click()
        self.page.get_by_role("heading", name="My acquisition market", exact=True).wait_for(state="visible")
        self.page.get_by_role("button", name=f"View {expected} matches", exact=True).click()
        self.page.get_by_role("button", name=f"Deal Grid ({expected} records)", exact=True).wait_for(state="visible")
        self.assertEqual(self.page.get_by_role("combobox", name="State filter").input_value(), chosen_state)

    def test_account_entry_does_not_collect_credentials_for_a_nonexistent_service(self):
        for path in ["sign-in", "register"]:
            self.page.goto(f"{BASE_URL}/{path}", wait_until="domcontentloaded")
            self.assertEqual(self.page.locator('input[type="password"]').count(), 0)
            self.page.wait_for_url(re.compile(rf"{re.escape(BASE_URL)}/(?:#live-feed|listings)"))

    def test_watchlist_modal_is_escape_closeable(self):
        self.page.get_by_role("button", name="Watchlist (0)").click()
        dialog = self.page.get_by_role("dialog", name="Saved Watchlist (0)")
        dialog.wait_for(state="visible")
        self.page.keyboard.press("Escape")
        self.assertEqual(dialog.count(), 0)

    def test_mobile_navigation_opens_routes_and_closes_cleanly(self):
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.page.reload(wait_until="domcontentloaded")
        self.page.get_by_role("button", name="Open menu").click()
        menu = self.page.get_by_role("dialog")
        menu.wait_for(state="visible")
        menu.get_by_role("button", name="Product").click()
        menu.get_by_role("link", name="Deal Stacks").click()

        self.page.wait_for_url(f"{BASE_URL}/#live-feed")
        self.assertEqual(self.page.url, f"{BASE_URL}/#live-feed")
        self.assertEqual(menu.count(), 0)

    def test_live_feed_filters_and_sort_controls_change_results(self):
        state_counts = Counter(listing["state"] for listing in self.listings)
        state, expected_state_count = state_counts.most_common(1)[0]
        source = next(listing["source"] for listing in self.listings if listing["state"] == state)
        expected_source_count = sum(
            listing["state"] == state and listing["source"] == source
            for listing in self.listings
        )
        self.wait_for_live_feed()
        self.page.get_by_role("combobox", name="State filter").select_option(state)
        self.assertEqual(
            self.page.get_by_role("button", name="Underwrite Deal").count(),
            expected_state_count,
        )
        self.assertLess(expected_state_count, self.live_count)

        self.page.get_by_role("combobox", name="Source filter").select_option(source)
        source_count = self.page.get_by_role("button", name="Underwrite Deal").count()
        self.assertEqual(source_count, expected_source_count)

        self.page.get_by_role("combobox", name="Sort listings").select_option("bid")
        bids = self.page.locator("[data-testid='listing-opening-bid']").all_text_contents()
        bid_values = [int(re.sub(r"[^0-9]", "", bid)) if re.search(r"\d", bid) else None for bid in bids]
        known = [value for value in bid_values if value is not None]
        self.assertEqual(bid_values, sorted(known) + [None] * (len(bid_values) - len(known)))

    def test_source_observed_filter_excludes_demo_and_unverified_records(self):
        self.wait_for_live_feed()
        self.page.get_by_role("button", name="Source-observed only").click()
        self.assertEqual(self.page.get_by_role("button", name="Source-observed only").get_attribute("aria-pressed"), "true")
        self.assertEqual(self.page.get_by_text("Demo / unverified", exact=True).count(), 0)
        self.page.get_by_role("button", name="Reset all filters", exact=True).click()
        self.wait_for_live_feed()

    def test_preview_opens_as_an_accessible_escape_closeable_dialog(self):
        play = self.page.get_by_role("button", name="Play preview")
        play.scroll_into_view_if_needed()
        play.click()

        dialog = self.page.get_by_role("dialog", name="Live Underwriting Walkthrough Demo")
        dialog.wait_for(state="visible")
        self.page.keyboard.press("Escape")
        self.assertEqual(dialog.count(), 0)

    def test_property_drawer_is_an_accessible_escape_closeable_dialog(self):
        self.wait_for_live_feed()
        self.page.get_by_role("button", name="Underwrite Deal").first.click()
        dialog = self.page.get_by_role("dialog").first
        dialog.wait_for(state="visible")
        self.page.keyboard.press("Escape")
        self.assertEqual(dialog.count(), 0)

    def test_listings_directory_route_renders_and_loads_inventory(self):
        self.page.goto(f"{BASE_URL}/listings", wait_until="domcontentloaded")
        heading = self.page.get_by_role("heading", name="Distressed property records, without hidden assumptions")
        heading.wait_for(state="visible")
        self.assertTrue(heading.is_visible())
        self.assertTrue(self.page.get_by_text("Property Evidence Directory").is_visible())
        self.page.get_by_role("button", name=f"Deal Grid ({self.live_count} records)").wait_for(state="visible")

    def test_not_found_page_renders_with_recovery_actions(self):
        self.page.goto(f"{BASE_URL}/non-existent-route-audit-404", wait_until="domcontentloaded")
        heading = self.page.get_by_role("heading", name="Listing or Page Unavailable")
        heading.wait_for(state="visible")
        self.assertTrue(heading.is_visible())
        self.assertTrue(self.page.get_by_text("404 — Not Found").is_visible())
        return_link = self.page.get_by_role("link", name="Return to Terminal")
        self.assertTrue(return_link.is_visible())

    def test_alerts_modal_is_escape_closeable(self):
        self.wait_for_live_feed()
        self.page.get_by_role("button", name="Open Alerts Manager").click()
        dialog = self.page.get_by_role("dialog", name="Deal Alerts Manager")
        dialog.wait_for(state="visible")
        self.assertTrue(dialog.is_visible())
        self.assertTrue(self.page.get_by_role("heading", name="Saved searches", exact=True).is_visible())
        self.page.keyboard.press("Escape")
        self.assertEqual(dialog.count(), 0)

    def test_docket_agent_runs_verification_in_property_drawer(self):
        self.wait_for_live_feed()
        self.page.get_by_role("button", name="Underwrite Deal").first.click()
        dialog = self.page.get_by_role("dialog").first
        dialog.wait_for(state="visible")
        self.assertTrue(self.page.get_by_text("Court-record evidence check").is_visible())
        self.page.get_by_role("button", name="Check official evidence").click()
        unverified_badge = self.page.get_by_text("Not verified from official records")
        unverified_badge.wait_for(state="visible", timeout=5000)
        self.assertTrue(unverified_badge.is_visible())

    def test_custom_address_deep_check_opens_drawer(self):
        self.wait_for_live_feed()
        search_input = self.page.get_by_label("Search listings")
        search_input.fill("9999 Unlisted Blvd, Cleveland, OH")
        verify_prompt = self.page.get_by_text("Address research workspace")
        verify_prompt.wait_for(state="visible", timeout=3000)
        self.assertTrue(verify_prompt.is_visible())
        self.page.get_by_role("button", name="Open evidence checklist for \"9999 Unlisted Blvd, Cleveland, OH\"").click()
        dialog = self.page.get_by_role("dialog").first
        dialog.wait_for(state="visible")
        heading = self.page.get_by_role("heading", name="9999 Unlisted Blvd")
        heading.wait_for(state="visible")
        self.assertTrue(heading.is_visible())

    def test_listing_detail_page_renders_docket_agent_and_can_verify(self):
        self.page.goto(f"{BASE_URL}/listings/{self.primary_listing['id']}", wait_until="domcontentloaded")
        research = self.page.locator("details#modeled-research")
        self.assertIsNone(research.get_attribute("open"), "modeled research should start collapsed")
        research.locator("summary").click()
        agent_heading = self.page.get_by_text("Court-record evidence check")
        agent_heading.wait_for(state="visible", timeout=5000)
        self.assertTrue(agent_heading.is_visible())
        self.page.get_by_role("button", name="Check official evidence").click()
        unverified_badge = self.page.get_by_text("Not verified from official records")
        unverified_badge.wait_for(state="visible", timeout=5000)
        self.assertTrue(unverified_badge.is_visible())
        self.assertEqual(self.page.get_by_text("Docket Verified: Case #").count(), 0)

    def test_detail_mobile_content_and_media_controls_are_not_clipped(self):
        self.page.goto(f"{BASE_URL}/listings/OH-CUY-10231", wait_until="domcontentloaded")
        for width in (375, 390):
            with self.subTest(width=width):
                self.page.set_viewport_size({"width": width, "height": 812})
                for element in [self.page.locator("h1"), self.page.get_by_test_id("listing-media"),
                    self.page.get_by_test_id("demo-listing-disclosure")]:
                    box = element.bounding_box()
                    self.assertGreaterEqual(box["x"], 0)
                    self.assertLessEqual(box["x"] + box["width"], width)
                media_button = self.page.get_by_role("button", name="Check Street View", exact=True).bounding_box()
                tabs = self.page.get_by_role("tablist", name="Property media").bounding_box()
                self.assertLessEqual(media_button["y"] + media_button["height"], tabs["y"])
                auction = self.page.get_by_role("heading", name="Auction details", exact=True).filter(visible=True).bounding_box()
                overview = self.page.get_by_role("heading", name="Property overview", exact=True).bounding_box()
                self.assertLess(auction["y"], overview["y"], "auction actions must precede research on mobile")
        save = self.page.get_by_role("button", name="Save to watchlist", exact=True).filter(visible=True)
        save.click()
        saved = self.page.get_by_role("button", name="Saved to watchlist", exact=True).filter(visible=True)
        self.assertEqual(saved.get_attribute("aria-pressed"), "true")
        saved.click()
        self.assertEqual(save.get_attribute("aria-pressed"), "false")

    def test_street_view_uses_same_origin_images_and_explicit_context_disclosure(self):
        # Deterministic transport fixture: browser tests never spend Google API quota.
        image_requests = []
        tiny_png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1cAAAAASUVORK5CYII=")

        def media_response(route):
            if "mode=metadata" in route.request.url:
                route.fulfill(json={"available": True, "provider": "Google Maps", "attribution": "Google", "captureDate": "2026-05", "distanceMeters": 12})
            else:
                image_requests.append(route.request.url)
                route.fulfill(content_type="image/png", body=tiny_png)

        self.page.route("**/api/property-image?**", media_response)
        self.page.goto(f"{BASE_URL}/listings/OH-CUY-10231", wait_until="domcontentloaded")
        disclosure = self.page.get_by_test_id("street-view-disclosure")
        self.assertEqual(image_requests, [])
        self.page.get_by_role("button", name="Check Street View", exact=True).click()
        disclosure.wait_for(state="visible")
        self.assertIn("Street-level context only", disclosure.inner_text())
        self.assertIn("May 2026", disclosure.inner_text())
        self.assertIn("12 m", disclosure.inner_text())
        self.assertTrue(image_requests)
        self.assertTrue(all(url.startswith(f"{BASE_URL}/api/property-image?") and "key=" not in url for url in image_requests))
        image = self.page.get_by_test_id("street-view-panel").locator("img")
        self.assertEqual(image.evaluate("node => getComputedStyle(node).objectFit"), "contain")
        tab = self.page.get_by_role("tab", name="Street View", exact=True)
        tab.focus()
        tab.press("End")
        # The snapshot fixture has no qualified coordinate evidence. Its last
        # available tab is Street View, not a fabricated property map.
        self.assertEqual(self.page.get_by_role("tab", name="Map", exact=True).count(), 0)
        self.assertEqual(tab.get_attribute("aria-selected"), "true")
        self.page.set_viewport_size({"width": 390, "height": 844})
        tab.click()
        self.assertLessEqual(self.page.evaluate("document.documentElement.scrollWidth"), 390)

    def test_feed_street_view_is_on_demand_preserves_attribution_and_recovers_from_failure(self):
        fixture = dict(self.primary_listing, id="CIV-NJ-7-1234", source="civilview",
            address="19 West Park Avenue, Park Ridge, NJ 07656", photo=None,
            sourceUrl="https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=1234",
            sourceObservedAt="2026-09-04T12:00:00Z",
            provenance={"origin": "live", "observed": True, "recordKind": "source_record", "publisher": "CivilView", "recordId": "1234"})
        self.page.route("**/api/listings?**", lambda route: route.fulfill(json={"listings": [fixture], "total": 1}))
        requests = []
        tiny_png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1cAAAAASUVORK5CYII=")
        def media_response(route):
            requests.append(route.request.url)
            if len(requests) == 1:
                route.fulfill(json={"available": False, "reason": "Coverage temporarily unavailable"})
            elif "mode=metadata" in route.request.url:
                route.fulfill(json={"available": True, "provider": "Google Maps", "attribution": "Test provider attribution", "captureDate": "2012-09", "distanceMeters": 24})
            else:
                route.fulfill(content_type="image/png", body=tiny_png)
        self.page.route("**/api/property-image?**", media_response)
        self.page.reload(wait_until="domcontentloaded")
        self.page.get_by_role("button", name="Deal Grid (1 records)", exact=True).wait_for(state="visible")
        self.assertEqual(requests, [], "feed must not bill for imagery before the user requests it")
        button = self.page.get_by_role("button", name=f"Load Street View for {fixture['address']}")
        button.click()
        self.page.get_by_text("Coverage temporarily unavailable", exact=True).wait_for(state="visible")
        self.assertEqual(self.page.get_by_test_id("listing-thumbnail-streetview").count(), 0)
        button.click()
        preview = self.page.get_by_test_id("listing-thumbnail-streetview")
        preview.wait_for(state="visible")
        self.assertIn("September 2012", preview.inner_text())
        self.assertIn("Test provider attribution", preview.inner_text())
        self.assertIn("Street context only", preview.inner_text())
        self.assertEqual(preview.locator("img").evaluate("el => getComputedStyle(el).objectFit"), "contain")
        self.assertTrue(all(url.startswith(BASE_URL + "/api/property-image?") and "key=" not in url for url in requests))
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.assertLessEqual(self.page.evaluate("document.documentElement.scrollWidth"), 390)

    def test_street_view_image_failure_can_retry_without_substituting_stock_photos(self):
        attempts = []

        def media_response(route):
            if "mode=metadata" in route.request.url:
                route.fulfill(json={"available": True, "provider": "Google Maps", "distanceMeters": 10})
            else:
                attempts.append(route.request.url)
                route.fulfill(status=503, content_type="application/json", body='{"error":"unavailable"}')

        self.page.route("**/api/property-image?**", media_response)
        self.page.goto(f"{BASE_URL}/listings/OH-CUY-10231", wait_until="domcontentloaded")
        self.page.get_by_role("button", name="Check Street View", exact=True).click()
        self.page.get_by_text("Street View image is temporarily unavailable", exact=True).wait_for(state="visible")
        self.page.get_by_role("button", name="Retry image").click()
        self.page.get_by_text("Street View image is temporarily unavailable", exact=True).wait_for(state="visible")
        self.assertEqual(len(attempts), 2)
        self.assertEqual(self.page.get_by_test_id("listing-media").locator('img[src*="unsplash"]').count(), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
