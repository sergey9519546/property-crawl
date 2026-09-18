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

    def test_hud_cards(self):
        html = (FIXTURES / "hud-cards.html").read_text()
        result = self.parse(
            "hud-cards",
            html,
            url="https://www.hudhomestore.gov/Home/Index?state=CA",
        )
        self.assertEqual(result["profile"], "hud-cards")
        self.assertEqual(len(result["items"]), 2)
        self.assertEqual(result["items"][0]["caseNumber"], "123-456789")
        self.assertEqual(result["items"][0]["address"], "100 Main Street")
        self.assertEqual(result["items"][0]["currentBid"], 250000)
        self.assertEqual(result["items"][1]["caseNumber"], "222-333444")
        self.assertEqual(result["items"][1]["currentBid"], 180000)

    def test_treasury_detail(self):
        html = (FIXTURES / "treasury-detail.html").read_text()
        result = self.parse(
            "treasury-detail",
            html,
            url="https://www.treasury.gov/auctions/treasury/rp/1234.shtml",
        )
        prop = result["property"]
        self.assertEqual(prop["startingBid"], 175000)
        self.assertEqual(prop["livingArea"], 2200)
        self.assertEqual(prop["yearBuilt"], 1985)
        self.assertEqual(prop["siteAcres"], 0.6)
        self.assertEqual(prop["parcelNumber"], "555-PQR")
        self.assertEqual(prop["saleNumber"], "TRSY-DELTA")
        self.assertEqual(prop["beds"], 4)
        self.assertEqual(prop["baths"], 3)

    def test_irs_detail(self):
        html = (FIXTURES / "irs-detail.html").read_text()
        result = self.parse(
            "irs-detail",
            html,
            url="https://www.irsauctions.gov/auction/item/99",
        )
        prop = result["property"]
        self.assertEqual(prop["address"], "424 Override Avenue")
        self.assertEqual(prop["city"], "Overrideville")
        self.assertEqual(prop["state"], "PA")
        self.assertEqual(prop["zip"], "19111")
        self.assertEqual(prop["minimumBid"], 222000.0)
        self.assertEqual(prop["saleDate"], "2027-03-01")
        self.assertEqual(prop["beds"], 3)
        self.assertEqual(prop["baths"], 2)
        self.assertEqual(prop["sqft"], 2500)
        self.assertEqual(prop["yearBuilt"], 1990)

    def test_usda_table(self):
        html = """
        <table id="propertySummariesTable">
          <tr><th>Address</th><th>Price</th></tr>
          <tr>
            <td>12 Farm Road, Des Moines, IA 50309</td>
            <td>$85,000</td>
            <td><a href="/resales/public/property/1">Detail</a></td>
          </tr>
        </table>
        """
        result = self.parse("usda-table", html, url="https://www.resales.usda.gov/resales/public/searchSFH")
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(result["items"][0]["price"], 85000)
        self.assertTrue(result["items"][0]["detailUrl"].startswith("https://www.resales.usda.gov/"))

    def test_civilview_sales(self):
        html = """
        <table>
          <tr>
            <td>CV-2026-1234</td>
            <td>Aug 15, 2026</td>
            <td>100 Court St</td>
            <td><a href="/Sales/SaleDetails?PropertyId=99">Details</a></td>
          </tr>
        </table>
        """
        result = self.parse("civilview-sales", html, url="https://salesweb.civilview.com/Sales/SalesSearch")
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(result["items"][0]["detailUrl"], "https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=99")
        self.assertEqual(result["items"][0]["caseNumber"], "2026-1234")

    def test_page_links_drops_insecure_http(self):
        html = (
            '<a href="https://example.test/ok">OK</a>'
            '<a href="http://example.test/insecure">HTTP</a>'
        )
        result = self.parse("page-links", html)
        self.assertEqual(len(result["links"]), 1)
        self.assertEqual(result["links"][0]["href"], "https://example.test/ok")

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
