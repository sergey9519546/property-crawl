#!/usr/bin/env python3
"""Parse already-fetched HTML with Scrapling. This process never performs I/O beyond stdin/stdout."""

import hashlib
import json
import re
import sys
from urllib.parse import urljoin

import scrapling
from scrapling.parser import Selector

PROFILES = {"gsa-index", "gsa-detail", "page-links", "table-extract", "hud-cards", "treasury-detail", "irs-detail"}
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


def hud_cards(page, base_url):
    """HUD HomeStore list page: <tr class="property-row">...</tr> cards.

    Returns one record per row that has both a case number and a street
    address. Address is the prop-address cell, price is the first $N,NNN
    token in the row. The case number drives the listing id so the
    downstream detail parser can join on it.
    """
    items = []
    seen = set()
    for row in page.xpath('//tr[contains(concat(" ",normalize-space(@class)," ")," property-row ")]'):
        case_match = re.search(r"Case\s*#?\s*:?\s*([0-9-]+)", " ".join(row.xpath('.//text()').getall()))
        if not case_match:
            continue
        case_num = case_match.group(1)
        if case_num in seen:
            continue
        # Address: any element with a prop-address class, or the first
        # leading <a> whose text starts with a street number.
        address_node = row.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," prop-address ")]').get()
        address = ""
        if address_node:
            address = clean(" ".join(row.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," prop-address ")]//text()').getall()))
        if not address:
            anchor = row.xpath('.//a[normalize-space(string(.))][1]')
            if anchor:
                address = clean(" ".join(anchor.xpath('.//text()').getall()))
        if not address:
            continue
        text = clean(" ".join(row.xpath('.//text()').getall()))
        price_match = re.search(r"\$([0-9,]+)", text)
        price = int(price_match.group(1).replace(",", "")) if price_match else None
        seen.add(case_num)
        items.append({
            "caseNumber": case_num,
            "address": address,
            "currentBid": price,
        })
    return {"items": items}


def treasury_detail(page, _base_url):
    """Treasury Forfeiture real-property detail page.

    The detail page renders the canonical property data as labeled prose:
    "Starting Bid: $N,NNN", "Living Area: N,NNN sq ft", "Year Built: YYYY",
    "Site Area: N.NN acres", "Deposit: ...", "Auction Date and Time: ...",
    "Parcel No: ...", "Sale Number: ...", and "N bedrooms", "N baths".
    Extract each into a structured dict; the Node side maps the dict back
    to the listing shape.
    """
    body = clean(" ".join(page.xpath('//text()').getall()))
    record = {
        "startingBid": None,
        "livingArea": None,
        "yearBuilt": None,
        "siteAcres": None,
        "deposit": None,
        "auctionDate": None,
        "parcelNumber": None,
        "saleNumber": None,
        "beds": None,
        "baths": None,
    }

    def first(pattern, cast=None, allow_zero=False):
        m = re.search(pattern, body)
        if not m:
            return None
        value = m.group(1)
        if cast is None:
            return value
        try:
            return cast(value)
        except (TypeError, ValueError):
            return None

    def to_money(token):
        if not token:
            return None
        return int(token.replace(",", "")) if token.replace(",", "").isdigit() else None

    def to_int(token):
        if not token:
            return None
        try:
            return int(token.replace(",", ""))
        except (TypeError, ValueError):
            return None

    bid = first(r"Starting Bid:\s*\$([\d,]+)")
    record["startingBid"] = to_money(bid)
    record["livingArea"] = to_int(first(r"Living Area:\s*([\d,]+)"))
    record["yearBuilt"] = to_int(first(r"Year Built:\s*(\d{4})"))
    site = first(r"Site Area:\s*([\d.]+)")
    record["siteAcres"] = float(site) if site and re.match(r"^\d+(?:\.\d+)?$", site) else None
    record["deposit"] = first(r"Deposit:\s*([^.]+?)(?:\.|Inspection|$)")
    record["auctionDate"] = first(r"Auction Date and Time:\s*([^I]+?)(?=Inspection|$)")
    record["parcelNumber"] = first(r"Parcel No:\s*(\S+)")
    record["saleNumber"] = first(r"Sale Number:\s*([\w-]+)")
    record["beds"] = to_int(first(r"(\d+)\s*bedrooms?"))
    record["baths"] = to_int(first(r"(\d+)\s*baths?"))
    return {"property": record}


def irs_detail(page, _base_url):
    """IRS Seized real-property detail page.

    The asset-address block is <address>...</address> with one street line
    and a second "City, ZIP ST" line. Minimum bid is in
    <div content="110665.00" class="field__item">110,665.00</div> and the
    sale date is in <time datetime="...">. The asset description prose
    carries bedrooms / bathrooms / sq ft / year built.
    """
    out = {
        "address": None,
        "city": None,
        "state": None,
        "zip": None,
        "minimumBid": None,
        "saleDate": None,
        "beds": None,
        "baths": None,
        "sqft": None,
        "yearBuilt": None,
        "description": None,
    }
    address_block = page.xpath('//address').get()
    if address_block:
        # Resolve each <br> into a newline, then split on newline so the
        # structure of the address block is preserved (some auctions have
        # a "Parcel ID" leading line that must be skipped for land sales).
        raw_html = page.xpath('//address').get()
        lines = re.split(r"<br\s*/?>", raw_html, flags=re.I)
        cleaned = [clean(re.sub(r"<[^>]+>", " ", line)) for line in lines]
        cleaned = [line for line in cleaned if line]
        if cleaned:
            first_line = cleaned[0]
            positive_land = bool(re.search(
                r"(?:agricultural\s+land|vacant\s+land|vacant\s+lot|land\s+(?:is\s+)?for\s+sale|\d+(?:\.\d+)?\s+acres?)",
                " ".join(page.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," field--name-field-asset-description ")]//text()').getall()),
                re.I,
            ))
            parcel_prefixed_land = positive_land and re.match(r"parcel\s+id\b", first_line, re.I) and len(cleaned) >= 3
            out["address"] = cleaned[1] if parcel_prefixed_land else cleaned[0]
            city_line = cleaned[2] if parcel_prefixed_land else cleaned[1] if len(cleaned) >= 2 else ""
            city_match = re.search(r"^(.+?),\s*(\d{5})\s+([A-Z]{2})$", city_line)
            if city_match:
                out["city"] = city_match.group(1).strip()
                out["zip"] = city_match.group(2)
                out["state"] = city_match.group(3)

    # Minimum bid is in the content attribute of a div.field__item.
    bid_content = page.xpath('//div[contains(concat(" ",normalize-space(@class)," ")," field__item ")][1]/@content').get()
    if not bid_content:
        bid_content = page.xpath('//*[@content and contains(concat(" ",normalize-space(@class)," ")," field__item ")][1]/@content').get()
    if bid_content:
        try:
            out["minimumBid"] = float(bid_content.replace(",", ""))
        except (TypeError, ValueError):
            out["minimumBid"] = None

    time_attr = page.xpath('//time/@datetime').get()
    if time_attr:
        out["saleDate"] = time_attr[:10]

    desc_node = page.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," field--name-field-asset-description ")]').get()
    if desc_node:
        desc = clean(" ".join(page.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," field--name-field-asset-description ")]//text()').getall()))
        out["description"] = desc

    body = clean(" ".join(page.xpath('//text()').getall()))

    def first_int(pattern):
        m = re.search(pattern, body)
        if not m:
            return None
        try:
            return int(m.group(1).replace(",", ""))
        except (TypeError, ValueError):
            return None

    out["beds"] = first_int(r"(\d+)\s*bedrooms?")
    out["baths"] = first_int(r"(\d+)\s*bathrooms?")
    out["sqft"] = first_int(r"([\d,]+)\s*sq\s*ft")
    out["yearBuilt"] = first_int(r"built in (\d{4})")
    return {"property": out}


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
    "hud-cards": hud_cards,
    "treasury-detail": treasury_detail,
    "irs-detail": irs_detail,
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
