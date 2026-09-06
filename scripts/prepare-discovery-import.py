"""Read supplied ZIP/DOCX data without executing any attached code.

Only explicit members are read; photo extraction uses content hashes as names.
The output is a replayable staging directory, never a live inventory claim.
"""
import argparse
import csv
import hashlib
import io
import json
import re
import shutil
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}


def digest(path):
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def member(archive, suffix):
    matches = [name for name in archive.namelist() if name.endswith("/" + suffix) or name == suffix]
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one {suffix}; found {len(matches)}")
    return matches[0]


def csv_rows(archive, suffix):
    with archive.open(member(archive, suffix)) as stream:
        yield from csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig"))


def write_jsonl(path, records):
    with open(path, "w", encoding="utf-8") as output:
        for record in records:
            output.write(json.dumps(record, ensure_ascii=False) + "\n")


def cell_text(cell):
    return "\n".join("".join(t.text or "" for t in p.findall(".//w:t", NS))
                     for p in cell.findall("w:p", NS)).strip()


def read_atlas(path):
    with zipfile.ZipFile(path) as archive:
        doc = ET.fromstring(archive.read("word/document.xml"))
        rels = {r.attrib["Id"]: r.attrib.get("Target", "")
                for r in ET.fromstring(archive.read("word/_rels/document.xml.rels"))}
        sources, ledger = [], []
        for table_index, table in enumerate(doc.findall(".//w:tbl", NS)):
            rows = table.findall("w:tr", NS)
            heading = [cell_text(c) for c in rows[0].findall("w:tc", NS)]
            for row in rows[1:]:
                cells = row.findall("w:tc", NS)
                values = [cell_text(c) for c in cells]
                if len(values) != 4:
                    continue
                links = [[rels.get(h.get("{" + NS["r"] + "}id"), "")
                          for h in c.findall(".//w:hyperlink", NS)] for c in cells]
                if heading[0].startswith("ID"):
                    match = re.match(r"^(\d+)\.\s*(.+)", values[0], re.S)
                    if not match:
                        raise ValueError("Unrecognized atlas source: " + values[0])
                    source_id = int(match[1])
                    urls = list(dict.fromkeys(u for u in links[1] if u.startswith(("https://", "http://"))))
                    status = values[3].split("\n", 1)[0]
                    sources.append({"id": f"atlas-{source_id}", "atlasId": source_id,
                                    "label": match[2].strip(), "urls": urls, "routeText": values[1],
                                    "capabilityClaim": values[2], "authorStatus": status,
                                    "limitations": values[3], "tableIndex": table_index,
                                    "access": "manual", "automationStatus": "backlog",
                                    "evidenceClass": "document_claim", "verifiedAt": None,
                                    "urlNeedsReview": not urls or any("..." in u for u in urls)})
                elif heading[0] == "Cited URL":
                    ids = [int(v) for v in re.findall(r"\d+", values[3])]
                    ledger.append({"citedUrl": values[0], "authorOutcome": values[1],
                                   "resolvedUrls": links[2], "routeText": values[2], "sourceIds": ids,
                                   "evidenceClass": "document_claim"})
        ids = [s["atlasId"] for s in sources]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate atlas IDs")
        return {"sources": sources, "ledger": ledger, "unmappedLedgerRows": sum(not r["sourceIds"] for r in ledger)}


def prepare(args):
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    summary = {"version": 1, "observedAt": args.observed_at,
               "observedAtBasis": "attachment author snapshot time", "liveVerified": False,
               "inputs": {name: {"name": Path(value).name, "sha256": digest(value)}
                          for name, value in [("catalog", args.catalog), ("photos", args.photos), ("atlas", args.atlas)]}}
    with zipfile.ZipFile(args.catalog) as archive:
        record_ids = set()
        raw_path = output / "catalog.jsonl"
        with archive.open(member(archive, "catalog.jsonl")) as raw, raw_path.open("w", encoding="utf-8") as target:
            for line in io.TextIOWrapper(raw, encoding="utf-8-sig"):
                record = json.loads(line)
                identifier = record.get("listingId")
                if not identifier or identifier in record_ids:
                    raise ValueError("Missing or duplicate listing ID")
                record_ids.add(identifier)
                target.write(json.dumps(record, ensure_ascii=False) + "\n")
        manifest = list(csv_rows(archive, "images_manifest.csv"))
        index = list(csv_rows(archive, "images_index.csv"))
        closed = list(csv_rows(archive, "closed_results.csv"))
        for name, rows in [("image-references", manifest), ("photo-index", index), ("closed-results", closed)]:
            if any(r["listingId"] not in record_ids for r in rows):
                raise ValueError(name + " contains an orphan listing reference")
            write_jsonl(output / (name + ".jsonl"), rows)
        summary.update(listings=len(record_ids), imageReferences=len(manifest), closedResults=len(closed))
    asset_hashes = set()
    with zipfile.ZipFile(args.photos) as photos, (output / "assets.jsonl").open("w", encoding="utf-8") as assets:
        names = set(photos.namelist())
        photo_index = list(csv_rows(photos, "images_index.csv"))
        if photo_index != index:
            raise ValueError("Photo indexes disagree between archives")
        for entry in index:
            candidates = [n for n in names if n.endswith("/" + entry["file"]) or n == entry["file"]]
            if len(candidates) != 1:
                raise ValueError("Missing/ambiguous photo: " + entry["file"])
            info = photos.getinfo(candidates[0])
            if info.file_size != int(entry["bytes"]):
                raise ValueError("Photo size mismatch: " + entry["file"])
            with photos.open(info) as stream:
                file_hash = hashlib.file_digest(stream, "sha256").hexdigest()
            asset_hashes.add(file_hash)
            local_path = None
            if args.media_dir:
                media = Path(args.media_dir).resolve()
                media.mkdir(parents=True, exist_ok=True)
                target = media / (file_hash + ".jpg")
                if not target.exists():
                    temporary = target.with_suffix(".part")
                    with photos.open(info) as source, temporary.open("wb") as dest:
                        shutil.copyfileobj(source, dest)
                    temporary.replace(target)
                if target.stat().st_size != info.file_size or digest(target) != file_hash:
                    raise ValueError("Stored asset hash mismatch")
                local_path = str(target)
            assets.write(json.dumps({"listingId": entry["listingId"], "sourceUrl": entry["primaryImageUrl"],
                                     "archiveMember": candidates[0], "sha256": file_hash, "bytes": info.file_size,
                                     "localPath": local_path, "integrity": "zip_crc_and_sha256",
                                     "displayStatus": "policy_review_required", "rights": "not_established"}) + "\n")
    summary.update(photoFiles=len(index), distinctPhotoContents=len(asset_hashes))
    atlas = read_atlas(args.atlas)
    (output / "atlas.json").write_text(json.dumps(atlas, ensure_ascii=False), encoding="utf-8")
    summary.update(atlasSources=len(atlas["sources"]), atlasLedgerRows=len(atlas["ledger"]), atlasUnmappedRows=atlas["unmappedLedgerRows"])
    (output / "manifest.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for option in ["catalog", "photos", "atlas", "output", "observed-at"]:
        parser.add_argument("--" + option, required=True)
    parser.add_argument("--media-dir")
    prepare(parser.parse_args())
