import base64
import os
import unittest

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("NEXT_UI_URL", "http://localhost:3001")
DETAIL_URL = f"{BASE_URL}/listings/OH-CUY-10231"
TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1cAAAAASUVORK5CYII="
)


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
                self.page.goto(DETAIL_URL, wait_until="domcontentloaded")
                self.assertEqual(requests, [], "Street View must remain dormant before explicit consent")
                self.page.get_by_role("button", name="Check Street View", exact=True).click()
                self.page.get_by_role("status").wait_for(state="visible")
                self.assertEqual(len(requests), 1)
                self.assertIn("mode=metadata", requests[0])
                self.assertNotIn("key=", requests[0])
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
        self.page.goto(DETAIL_URL, wait_until="domcontentloaded")
        self.assertEqual(requests, [])
        self.page.get_by_role("button", name="Check Street View", exact=True).click()

        disclosure = self.page.get_by_test_id("street-view-disclosure")
        disclosure.wait_for(state="visible")
        disclosure_text = disclosure.inner_text()
        self.assertIn("Google Maps · Google", disclosure_text)
        self.assertIn("Captured November 2024", disclosure_text)
        self.assertIn("Distance: 18 m from matched property location", disclosure_text)
        self.assertIn("Street-level context only", disclosure_text)
        self.assertEqual(len(requests), 2)
        self.assertTrue(all(url.startswith(f"{BASE_URL}/api/property-image?") for url in requests))
        self.assertTrue(all("key=" not in url for url in requests))

if __name__ == "__main__":
    unittest.main(verbosity=2)
