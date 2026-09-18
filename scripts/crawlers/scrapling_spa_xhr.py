#!/usr/bin/env python3
"""SPA XHR capture via Scrapling DynamicFetcher (opt-in fetchers lane).

Fails closed when scrapling[fetchers] or browsers are missing.
Never used for CAPTCHA bypass — only for operator-enabled REO SPA APIs.
"""

import json
import re
import sys

MAX_BODY = 2_000_000


def extract_items(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("properties", "listings", "content", "results", "items", "data"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
            if isinstance(value, dict):
                nested = extract_items(value)
                if nested:
                    return nested
    return []


def main():
    url = sys.argv[1]
    pattern = sys.argv[2] if len(sys.argv) > 2 else "*property*"
    try:
        from scrapling.fetchers import DynamicFetcher
    except Exception as exc:  # pragma: no cover
        print(json.dumps({"ok": False, "error": f"scrapling_fetchers_unavailable: {exc}"}))
        raise SystemExit(0)

    try:
        page = DynamicFetcher.fetch(
            url,
            headless=True,
            network_idle=True,
            capture_xhr=pattern,
        )
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"dynamic_fetch_failed: {exc}"[:400]}))
        raise SystemExit(0)

    captured = getattr(page, "captured_xhr", None) or []
    items = []
    urls = []
    for response in captured:
        response_url = getattr(response, "url", None) or getattr(response, "request_url", None) or ""
        urls.append(str(response_url)[:500])
        try:
            body = getattr(response, "json", None)
            if callable(body):
                parsed = body()
            else:
                raw = getattr(response, "text", None)
                if callable(raw):
                    raw = raw()
                elif raw is None:
                    raw = getattr(response, "body", None)
                    if hasattr(raw, "decode"):
                        raw = raw.decode("utf-8", "replace")
                if not isinstance(raw, str):
                    raw = ""
                raw = raw[:MAX_BODY]
                parsed = json.loads(raw) if raw.strip()[:1] in "[{" else None
        except Exception:
            parsed = None
        for item in extract_items(parsed):
            if isinstance(item, (dict, list)):
                items.append(item)
            if len(items) >= 200:
                break
        if len(items) >= 200:
            break

    print(json.dumps({
        "ok": True,
        "url": url,
        "pattern": pattern,
        "capturedCount": len(captured),
        "itemCount": len(items),
        "capturedUrls": urls[:20],
        "items": items[:200],
    }, ensure_ascii=False)[:4_000_000])


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # pragma: no cover
        print(json.dumps({"ok": False, "error": str(exc)[:400]}))
