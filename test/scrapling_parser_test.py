import json
import pathlib
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "crawlers" / "scrapling_extract.py"
FIXTURES = ROOT / "test" / "fixtures" / "crawler-tools"


class ScraplingParserTests(unittest.TestCase):
    def parse(self, profile, html, url="https://realestatesales.gov/our-listing"):
        request = {"version": 1, "profile": profile, "url": url, "html": html}
        process = subprocess.run(
            [sys.executable, str(SCRIPT)],
            input=json.dumps(request),
            text=True,
            capture_output=True,
            timeout=5,
            check=True,
        )
        return json.loads(process.stdout)

    def parse_fixture(self, profile, fixture):
        html = (FIXTURES / fixture).read_text()
        return self.parse(profile, html)

    def test_gsa_index(self):
        result = self.parse_fixture("gsa-index", "gsa-index.html")
        self.assertEqual([item["propertyId"] for item in result["items"]], ["41", "72"])
        self.assertEqual([item["currentBid"] for item in result["items"]], [125000, 87500])

    def test_reordered_detail_attributes(self):
        result = self.parse_fixture("gsa-detail", "gsa-detail.html")
        self.assertEqual(result["property"]["address"], "2731 Chestnut Street")
        self.assertEqual(result["property"]["zipcode"], "70130")

    def test_page_links(self):
        result = self.parse_fixture("page-links", "page-links.html")
        self.assertEqual(len(result["links"]), 2)
        self.assertEqual(result["links"][0]["href"], "https://realestatesales.gov/asset-details/?property_id=41")
        self.assertFalse(result["links"][0]["document"])
        self.assertTrue(result["links"][1]["document"])

    def test_page_links_filters_non_http_schemes(self):
        html = (
            '<a href="mailto:x@y.test">mail</a>'
            '<a href="tel:+1">tel</a>'
            '<a href="#top">anchor</a>'
            '<a href="javascript:void(0)">js</a>'
            '<a href="/real">real</a>'
        )
        result = self.parse("page-links", html)
        self.assertEqual(len(result["links"]), 1)
        self.assertEqual(result["links"][0]["href"], "https://realestatesales.gov/real")

    def test_table_extract(self):
        html = (
            "<table><thead><tr><th>Name</th><th>Value</th></tr></thead>"
            "<tbody><tr><td>A</td><td>1</td></tr><tr><td>B</td><td>2</td></tr></tbody></table>"
        )
        result = self.parse("table-extract", html)
        self.assertEqual(result["headers"], ["Name", "Value"])
        self.assertEqual(result["rows"], [["A", "1"], ["B", "2"]])

    def test_table_extract_no_table(self):
        result = self.parse("table-extract", "<p>nothing</p>")
        self.assertEqual(result["headers"], [])
        self.assertEqual(result["rows"], [])

    def test_protocol_response_fields(self):
        result = self.parse_fixture("gsa-index", "gsa-index.html")
        self.assertEqual(result["version"], 1)
        self.assertEqual(result["engine"], "scrapling")
        self.assertEqual(result["engineVersion"], "0.4.15")
        self.assertEqual(len(result["contentSha256"]), 64)
        self.assertEqual(result["profile"], "gsa-index")
        self.assertEqual(result["sourceUrl"], "https://realestatesales.gov/our-listing")

    def test_rejects_unknown_profile(self):
        request = {"version": 1, "profile": "nonexistent", "url": "https://x.test", "html": "<p>x</p>"}
        process = subprocess.run(
            [sys.executable, str(SCRIPT)],
            input=json.dumps(request),
            text=True,
            capture_output=True,
            timeout=5,
        )
        self.assertNotEqual(process.returncode, 0)
        self.assertIn("invalid request protocol or profile", process.stderr)

    def test_rejects_wrong_version(self):
        request = {"version": 2, "profile": "page-links", "url": "https://x.test", "html": "<a href='/x'>x</a>"}
        process = subprocess.run(
            [sys.executable, str(SCRIPT)],
            input=json.dumps(request),
            text=True,
            capture_output=True,
            timeout=5,
        )
        self.assertNotEqual(process.returncode, 0)

    def test_rejects_non_string_html(self):
        request = {"version": 1, "profile": "page-links", "url": "https://x.test", "html": 123}
        process = subprocess.run(
            [sys.executable, str(SCRIPT)],
            input=json.dumps(request),
            text=True,
            capture_output=True,
            timeout=5,
        )
        self.assertNotEqual(process.returncode, 0)
        self.assertIn("html and url must be strings", process.stderr)


if __name__ == "__main__":
    unittest.main()
