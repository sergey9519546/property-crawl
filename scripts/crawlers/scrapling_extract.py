#!/usr/bin/env python3
"""Parse already-fetched HTML with Scrapling. This process never performs I/O beyond stdin/stdout."""

import hashlib
import json
import re
import sys
from urllib.parse import urljoin

import scrapling
from scrapling.parser import Selector

PROFILES = {"gsa-index", "gsa-detail", "page-links", "table-extract"}
MAX_INPUT_BYTES = 4 * 1024 * 1024  # 4 MB — mirrors the JS bridge guard


def clean(value):
    return re.sub(r"\s+", " ", value or "").strip()


def one(values):
    return clean(values[0]) if values else ""


def gsa_index(page, base_url):
    cards = page.xpath('//a[contains(@href,"/asset-details/")]/ancestor::article[1] | //a[contains(@href,"/asset-details/")]/ancestor::*[contains(concat(" ",normalize-space(@class)," ")," property-item ") or contains(concat(" ",normalize-space(@class)," ")," listing-card ")][1]')
    if not cards:
        cards = page.xpath('//a[contains(@href,"/asset-details/")]')
    seen, items = set(), []
    for card in cards:
        href = one(card.xpath('.//a[contains(@href,"/asset-details/")]/@href').getall()) or one(card.xpath('./@href').getall())
        match = re.search(r"[?&]property_id=(\d+)", href)
        if not match or match.group(1) in seen:
            continue
        seen.add(match.group(1))
        text = clean(" ".join(card.xpath('.//text()').getall()))
        bid_match = re.search(r"Current\s+Bid[^$]{0,100}\$\s*([\d,]+)", text, re.I)
        if not bid_match:
            bid_match = re.search(r"\$\s*([\d,]+)[^$]{0,100}Current\s+Bid", text, re.I)
        items.append({"propertyId": match.group(1), "url": urljoin(base_url, href), "currentBid": int(bid_match.group(1).replace(",", "")) if bid_match else None})
    return {"items": items}


def gsa_detail(page, _base_url):
    fields = {}
    for key in ("address", "city", "state", "zipcode"):
        values = page.xpath(f'//input[@name="tour_property_{key}"]/@value').getall()
        fields[key] = one(values) or None
    return {"property": fields}


def page_links(page, base_url):
    links = []
    for node in page.css('a[href]'):
        href = one(node.xpath('./@href').getall())
        # Skip non-navigable and non-HTTP(S) schemes
        if not href or href.lower().startswith(("javascript:", "data:", "mailto:", "tel:", "about:")):
            continue
        if href.startswith("#"):
            continue  # in-page anchors
        text = clean(" ".join(node.xpath('.//text()').getall()))
        absolute = urljoin(base_url, href)
        # Only include http(s) URLs after resolution
        if not absolute.lower().startswith(("http://", "https://")):
            continue
        document = bool(re.search(r"\.(?:pdf|docx?|xlsx?|csv|zip)(?:[?#]|$)", absolute, re.I))
        links.append({"href": absolute, "text": text or None, "document": document})
    return {"links": links}


def table_extract(page, _base_url):
    """Extract the first HTML table as structured headers + rows."""
    tables = page.css('table')
    if not tables:
        return {"headers": [], "rows": []}
    table = tables[0]
    headers = [clean(" ".join(th.xpath('.//text()').getall())) for th in table.css('th')]
    rows = []
    for tr in table.css('tbody tr, tr'):
        cells = [clean(" ".join(td.xpath('.//text()').getall())) for td in tr.css('td')]
        if cells:
            rows.append(cells)
    # If no thead/th found, treat first row as header
    if not headers and rows:
        headers = rows.pop(0)
    return {"headers": headers, "rows": rows}


HANDLERS = {
    "gsa-index": gsa_index,
    "gsa-detail": gsa_detail,
    "page-links": page_links,
    "table-extract": table_extract,
}


def main():
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        raise ValueError(f"input exceeds {MAX_INPUT_BYTES} bytes")
    request = json.loads(raw.decode("utf-8"))
    if request.get("version") != 1 or request.get("profile") not in PROFILES:
        raise ValueError("invalid request protocol or profile")
    html, source_url = request.get("html"), request.get("url")
    if not isinstance(html, str) or not isinstance(source_url, str):
        raise ValueError("html and url must be strings")
    page = Selector(content=html, url=source_url)
    extracted = HANDLERS[request["profile"]](page, source_url)
    version = getattr(scrapling, "__version__", None)
    response = {"version": 1, "profile": request["profile"], "sourceUrl": source_url,
                "engine": "scrapling", "engineVersion": str(version or "unknown"),
                "contentSha256": hashlib.sha256(html.encode("utf-8")).hexdigest(), **extracted}
    json.dump(response, sys.stdout, separators=(",", ":"), ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"scrapling extraction error: {exc}", file=sys.stderr)
        raise SystemExit(1)
