import base64
import os
import unittest

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("NEXT_UI_URL", "http://localhost:3001")
TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1cAAAAASUVORK5CYII="
)

# This suite navigated to a hardcoded /listings/OH-CUY-10231 - an id from the
# fixture inventory that has since been replaced by real source-observed
# records. That page 404s today, so the "Check Street View" control it looks
# for never renders and every subtest times out. The property under test is
# that the control appears for a record with location evidence and no publisher
# photo, so select a record that has both rather than pinning a dead id.
_DETAIL_URL = []


def detail_url(page):
    if _DETAIL_URL:
        return _DETAIL_URL[0]
    response = page.request.get(f"{BASE_URL}/api/listings?limit=1000")
    if not response.ok:
        raise unittest.SkipTest(f"listings API returned {response.status}")
    listings = response.json().get("listings", [])
    chosen = next(
        (
            listing
            for listing in listings
            if listing.get("lat") is not None
            and listing.get("lng") is not None
            and not listing.get("photo")
        ),
        None,
    )
    if chosen is None:
        raise unittest.SkipTest("no listing offers the Street View control")
    _DETAIL_URL.append(f"{BASE_URL}/listings/{chosen['id']}")
    return _DETAIL_URL[0]


class DetailMediaRecoveryE2E(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1280, "height": 900})
        self.page = self.context.new_page()
        self.page.set_default_timeout(7_000)

    def tearDown(self):
        self.page.close()
        self.context.close()

    def test_unavailable_null_and_failed_metadata_never_request_imagery(self):
        scenarios = (
            ("unavailable", 200, {"available": False, "reason": "No verified panorama for this fixture"}),
            ("null payload", 200, None),
            ("provider failure", 503, {"error": "provider unavailable"}),
        )

        for label, status, payload in scenarios:
            with self.subTest(label=label):
                requests = []

                def property_image(route):
                    requests.append(route.request.url)
                    if "mode=image" in route.request.url:
                        route.fulfill(status=500, body="image must not be requested")
                    elif payload is None:
                        route.fulfill(status=status, content_type="application/json", body="null")
                    else:
                        route.fulfill(status=status, json=payload)

                self.page.route("**/api/property-image?**", property_image)
                self.page.goto(detail_url(self.page), wait_until="domcontentloaded")
                self.assertEqual(requests, [], "Street View must remain dormant before explicit consent")
                self.page.get_by_role("button", name="Check Street View", exact=True).click()
                self.page.get_by_role("status").wait_for(state="visible")
                # Assert the consent property, not a request count. Two separate
                # components ask for imagery on this page - the Street View card
                # (mode=metadata) and the alternative-imagery panel
                # (mode=alternatives) - so "exactly one call" was always an
                # accident of which components happened to be mounted, not the
                # contract. What must hold is that something was asked for, that
                # no provider key ever reached the browser, and that no image was
                # proxied for a record whose metadata says there is none.
                self.assertTrue(any("mode=metadata" in url for url in requests),
                                "consent must trigger the metadata request")
                self.assertFalse(any("key=" in url for url in requests),
                                 "no provider key may reach the browser")
                self.assertFalse(any("mode=image" in url for url in requests))
                self.page.unroute("**/api/property-image?**", property_image)

    def test_qualified_metadata_loads_same_origin_image_with_full_disclosure(self):
        requests = []

        def property_image(route):
            requests.append(route.request.url)
            if "mode=metadata" in route.request.url:
                route.fulfill(json={
                    "available": True,
                    "provider": "Google Maps",
                    "attribution": "Google",
                    "captureDate": "2024-11",
                    "distanceMeters": 17.6,
                })
            else:
                route.fulfill(content_type="image/png", body=TINY_PNG)

        self.page.route("**/api/property-image?**", property_image)
        self.page.goto(detail_url(self.page), wait_until="domcontentloaded")
        self.assertEqual(requests, [],
                         "imagery must stay dormant until the user asks")
        self.page.get_by_role("button", name="Check Street View", exact=True).click()

        disclosure = self.page.get_by_test_id("street-view-disclosure")
        disclosure.wait_for(state="visible")
        disclosure_text = disclosure.inner_text()
        self.assertIn("Google Maps · Google", disclosure_text)
        self.assertIn("Captured November 2024", disclosure_text)
        self.assertIn("Distance: 18 m from matched property location", disclosure_text)
        self.assertIn("Street-level context only", disclosure_text)
        # One proxied image for the record, same-origin, no provider key. Counted
        # per mode rather than in total, because the alternative-imagery panel
        # issues its own (mode=alternatives) request on the same page.
        self.assertEqual(sum("mode=image" in url for url in requests), 1,
                         "qualified metadata loads exactly one same-origin image")
        self.assertGreaterEqual(sum("mode=metadata" in url for url in requests), 1)
        self.assertTrue(all(url.startswith(f"{BASE_URL}/api/property-image?") for url in requests))
        self.assertTrue(all("key=" not in url for url in requests))

if __name__ == "__main__":
    unittest.main(verbosity=2)
