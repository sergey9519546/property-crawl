import os
import re
import unittest
from collections import Counter

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
        self.page = self.browser.new_page(viewport={"width": 1440, "height": 1000})
        self.page.set_default_timeout(5_000)
        self.page.goto(BASE_URL, wait_until="domcontentloaded")
        listings_response = self.page.request.get(f"{BASE_URL}/api/listings")
        self.assertTrue(listings_response.ok, "the Next UI must be connected to its listings API")
        self.listings = listings_response.json()["listings"]
        self.assertGreater(len(self.listings), 0)
        self.live_count = len(self.listings)
        self.primary_listing = self.listings[0]

    def tearDown(self):
        self.page.close()

    def wait_for_live_feed(self):
        self.page.get_by_role(
            "button", name=f"Deal Grid ({self.live_count})"
        ).wait_for(state="visible")

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

    def test_map_view_tracks_filtered_results_and_opens_the_listing_workflow(self):
        self.wait_for_live_feed()
        self.page.get_by_role("button", name=f"Map ({self.live_count})").click()
        market_map = self.page.get_by_test_id("market-map")
        market_map.wait_for(state="visible")
        self.assertEqual(self.page.get_by_test_id("map-marker").count(), self.live_count)

        self.page.get_by_role("button", name="Zoom map in").click()
        self.assertEqual(market_map.locator("[data-map-zoom]").get_attribute("data-map-zoom"), "1.25")

        primary = self.primary_listing
        self.page.get_by_role("button", name=f"Show {primary['address']} on map").click()
        preview = self.page.get_by_test_id("map-listing-preview")
        self.assertIn(primary["address"], preview.inner_text())
        preview.get_by_role("button", name="Underwrite").click()
        self.page.get_by_role("dialog", name=primary["address"]).wait_for(state="visible")

        self.page.get_by_role("button", name="Close drawer").click()
        state = Counter(listing["state"] for listing in self.listings).most_common(1)[0][0]
        self.page.get_by_role("combobox", name="State filter").select_option(state)
        expected = sum(listing["state"] == state for listing in self.listings)
        self.assertEqual(self.page.get_by_test_id("map-marker").count(), expected)

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
        city = self.primary_listing["city"]
        state = self.primary_listing["state"]
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
        county = self.primary_listing["county"]
        state = self.primary_listing["state"]
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
        hero_input = self.page.get_by_role("combobox", name="Market or address")
        state_counts = Counter(listing["state"] for listing in self.listings)
        state, state_result_count = state_counts.most_common(1)[0]
        state_name = STATE_NAMES.get(state, state)
        address = self.primary_listing["address"]
        city = self.primary_listing["city"]
        zip_code = self.primary_listing["zip"]

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

        self.assertIsNotNone(header_box)
        self.assertIsNotNone(brand_box)
        self.assertIsNotNone(signup_box)
        self.assertIsNotNone(navigation_box)
        self.assertGreater(header_box["width"], 2100)
        self.assertLess(brand_box["x"], 100)
        self.assertGreater(signup_box["x"] + signup_box["width"], 2220)
        self.assertAlmostEqual(
            navigation_box["x"] + navigation_box["width"] / 2,
            header_box["x"] + header_box["width"] / 2,
            delta=2,
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
            "normal",
        )
        self.assertEqual(
            blueprint.evaluate("element => getComputedStyle(element).pointerEvents"),
            "none",
        )
        self.assertEqual(
            blueprint.locator("img").evaluate("element => element.naturalWidth"),
            1672,
        )
        self.assertGreaterEqual(
            float(blueprint.evaluate("element => getComputedStyle(element).opacity")),
            0.9,
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

        city = self.primary_listing["city"]
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

    def test_storyteller_and_team_tabs_render_each_feature_state(self):
        self.page.locator("#product").evaluate("element => element.scrollIntoView({block: 'center'})")
        self.page.get_by_role("button", name="Prophecy").click()
        self.assertTrue(self.page.get_by_text("~38 days").is_visible())
        self.page.get_by_role("button", name="Visuals").click()
        self.assertTrue(self.page.get_by_text("ARV Model", exact=True).is_visible())

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
        self.assertTrue(self.page.get_by_text("Connected to live data API").is_visible())
        self.assertEqual(self.page.get_by_text("Live Ingestion Engine Active").count(), 0)

        self.page.get_by_role("button", name="Refresh live feed").click()
        self.page.get_by_text(f"{self.live_count} properties loaded").wait_for(state="visible")
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
            if message.type == "error" and "ERR_NETWORK_ACCESS_DENIED" not in message.text:
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
        city = self.primary_listing["city"]
        self.wait_for_live_feed()
        self.page.get_by_placeholder("Search address, county, court docket...").fill(city)
        self.page.get_by_role("button", name="Underwrite Deal").click()

        self.assertTrue(self.page.get_by_role("heading", name=address, level=2).is_visible())
        self.page.get_by_role("button", name="Analyze Deal").click()
        self.page.get_by_text(re.compile(r"Opening bid .* below mid-range estimated value")).wait_for(state="visible")

        self.page.get_by_role("button", name="3D Lot & Elevation").click()
        self.assertTrue(self.page.get_by_text("3D Terrain & Contour Insights:").is_visible())
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
        self.page.get_by_role("button", name="Parse Notice").click()

        self.page.get_by_text(re.compile(r"fields extracted .* Deal Score"), exact=False).wait_for(state="visible")
        self.assertTrue(self.page.get_by_text(address, exact=True).is_visible())
        self.page.get_by_role("button", name="Add to Watchlist").click()

        self.assertTrue(self.page.get_by_role("dialog", name=address).is_visible())
        self.page.get_by_role("button", name="Close drawer").click()
        self.page.get_by_role("button", name="Watchlist (1)").click()
        watchlist = self.page.get_by_role("dialog", name="Saved Watchlist (1)")
        self.assertTrue(watchlist.get_by_text(address, exact=True).is_visible())

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
        bids = self.page.locator("[data-testid='listing-opening-bid']").all_inner_texts()
        bid_values = [int(re.sub(r"[^0-9]", "", bid)) for bid in bids]
        self.assertEqual(bid_values, sorted(bid_values))

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
        dialog = self.page.get_by_role("dialog")
        dialog.wait_for(state="visible")
        self.page.keyboard.press("Escape")
        self.assertEqual(dialog.count(), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
