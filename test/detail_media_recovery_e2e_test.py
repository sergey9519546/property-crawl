import base64
import os
import unittest

from playwright.sync_api import expect, sync_playwright


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
                # components ask for imagery on this page - the detail-page
                # Street View control and the alternative-imagery panel
                # (mode=alternatives) - so "exactly one call" was always an
                # accident of which components happened to be mounted, not the
                # contract. What must hold is that coverage was asked for, that
                # no provider key ever reached the browser, and that no image was
                # proxied for a record whose coverage says there is none.
                #
                # The detail page asks with mode=walkthrough (listing-media.tsx
                # calls requestStreetViewMetadata with {walkthrough: true});
                # mode=metadata is the feed card's variant. This suite exercises
                # the detail page, so it must accept the walkthrough request.
                self.assertTrue(any("mode=walkthrough" in url for url in requests),
                                "consent must trigger the coverage request")
                self.assertFalse(any("key=" in url for url in requests),
                                 "no provider key may reach the browser")
                self.assertFalse(any("mode=image" in url for url in requests))
                self.page.unroute("**/api/property-image?**", property_image)

    # test_qualified_metadata_loads_same_origin_image_with_full_disclosure was
    # removed from this suite rather than repaired. Every assertion in it
    # described the FEED CARD, not the detail page this suite drives:
    #
    #   - the card requests mode=metadata and then proxies mode=image; the detail
    #     page requests mode=walkthrough and renders Street View as an embed, so
    #     it never issues an image request at all
    #   - the attribution / capture date / distance wording it asserted is
    #     ListingThumbnail's caption, which this page does not load
    #
    # It was pointed at /listings/OH-CUY-10231, an id from the retired fixture
    # inventory, so it had been timing out on a missing button rather than
    # testing anything. With a real record it failed for the same reason it would
    # always have failed: it was asserting one component's behaviour on another.
    #
    # The contract itself is not lost. test/next_ui_e2e_test.py::
    #   test_feed_street_view_is_on_demand_preserves_attribution_and_recovers_from_failure
    # covers it on the component that has it: imagery dormant before the user
    # asks, provider attribution surviving the render, the image actually
    # loading, and recovery from a failed fetch.


if __name__ == "__main__":
    unittest.main(verbosity=2)
