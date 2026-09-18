# Crawler tools and source onboarding

The canonical Node service owns collection policy, PostgreSQL jobs, source runs,
snapshots, listing identity, and hunt evaluation. Additional tools feed that
pipeline; they do not establish new sources as operational merely by finding links.

## Extraction lanes

| Source shape | Preferred lane | Acceptance requirement |
| --- | --- | --- |
| Documented or verified publisher JSON | Existing native Node adapter | Declared pagination scope, validated records, complete sweep |
| Server-rendered HTML | Guarded Node requests plus optional Scrapling parser | Deterministic selectors, exact record identity, page hash |
| Unfamiliar publisher | Bounded onboarding spider / reviewed Unbrowse route candidate | Public URL and method, coverage definition, recorded evidence, adapter tests |
| Challenge page, login-only record, unsupported application | Explicit blocked/manual workflow | No automatic alternate transport to circumvent the source's challenge |

Scrapling is an optional structural parser, initially integrated with GSA's index
and detail pages. Card-scoped bid extraction avoids borrowing a neighboring
property's amount. Hidden address inputs are read by their names, independent of
attribute order or quote style. Current bids remain current bids in publisher
evidence; they do not become opening amounts. Each parsed record retains the
parser version, extraction profile, exact source URL, and SHA-256 of the input.
Adaptive relocation is disabled for identity and factual fields. An explicitly
enabled parser failure is an error, not permission to use fixture inventory.

Node still performs HTTP validation, circuit breaking, timeouts and jitter before
HTML reaches Python. The bridge bounds input, output and subprocess time, and
does not invoke a shell. This keeps a second Python scheduler from competing with
the database-backed collection worker.

## Install the optional parser

Windows:

```powershell
python -m venv .cache/crawler-tools/venv
.cache/crawler-tools/venv/Scripts/python.exe -m pip install -r scripts/crawlers/requirements.txt
```

Linux/macOS:

```sh
python3 -m venv .cache/crawler-tools/venv
.cache/crawler-tools/venv/bin/python -m pip install -r scripts/crawlers/requirements.txt
```

Set `SCRAPLING_SOURCES` to a CSV allowlist of sources that should use the
optional structural parser. Supported source keys and their profiles:

| Source key | Profiles used |
| --- | --- |
| `gsa` | `gsa-index`, `gsa-detail` |
| `hud` | `hud-cards` |
| `treasury` | `treasury-detail` |
| `irs` | `irs-detail` |
| `ca-controller-tax-sale` | `table-extract` |
| `fannie` / `freddie` / `va` / `marshals` / `sheriff` | env-gated; native parse remains default |
| `usda` | `usda-table` (when enabled) |
| `civilview` | `civilview-sales` discovery parse (when enabled) |

Example: `SCRAPLING_SOURCES=hud,treasury,irs,gsa,usda,civilview`.
`SCRAPLING_PYTHON` optionally names a dedicated interpreter; otherwise the bridge
finds the project virtual environment. Python dependencies and state stay outside
the UI bundle. Native collection remains the default when the feature is unset.
Browser, stealth, proxy-rotation and challenge-solving modes are not enabled by
this integration. The official Scrapling skill is installed separately in Codex;
the skill itself is guidance, not the production Python dependency.

Protocol contract (2026-09-14): the JS bridge now validates **every** profile
shape (`hud-cards`, `treasury-detail`, `irs-detail`, `usda-table`,
`civilview-sales`, plus the original GSA/page-links/table profiles). Python
`page-links` emits only credential-free HTTPS targets so mixed HTTP/HTTPS pages
no longer fail the whole extraction. IPv4-mapped IPv6 SSRF targets
(`::ffff:127.0.0.1`) are rejected before the parser starts.

## Onboarding spider

The onboarding command explores a bounded same-origin frontier on a configured
publisher host. It obeys robots.txt, rejects redirects and credential-bearing
URLs, stops on challenge pages, and writes an atomic checkpoint under
`.cache/crawler-tools/crawls`. A page budget produces an incomplete checkpoint;
rerunning resumes pending work. PDFs are identified as document candidates and
are not downloaded. Candidate links and page hashes are research output, not
verified listings, sale outcomes or completed source gates.

Security properties enforced by the spider:

- **SSRF protection**: URLs must use HTTPS on a configured publisher host.
  Private IPv4 ranges, IPv6 link-local/unique-local ranges, IPv4-mapped IPv6
  addresses (`::ffff:x.x.x.x` and the hex form `::ffff:7f00:1`), and
  `localhost` are all rejected before any request.
- **Redirect rejection**: 3xx responses are never followed; the page is
  recorded as halted and left pending.
- **Content-type gating**: Only `text/html` and `application/xhtml+xml`
  responses are accepted. Non-HTML content (JSON, binary, etc.) halts the crawl.
- **Payload bounding**: Responses exceeding 4 MB are rejected before parsing.
- **Content-hash validation**: The parser must return a valid 64-character hex
  SHA-256; missing or malformed hashes halt the crawl.
- **Accept header**: Requests send `Accept: text/html,application/xhtml+xml`
  to signal expected content type to the publisher.
- **Credential stripping**: Query parameters matching secret-like patterns
  (token, key, auth, etc.) cause URL rejection.

```sh
npm run crawler:spider -- --source irs --url https://www.irsauctions.gov/auction/items --max-pages 3 --max-depth 0
npm run test:crawler-tools
```

An incomplete crawl exits with code 2. Completion describes the configured
origin and depth only, never national inventory coverage. Rerun the same source,
start URL and depth to resume its page-budget checkpoint. Checkpoints are local
research state; the production collector continues to use PostgreSQL job leases.
The parser virtual environment is required for the spider. Container deployments
must install the pinned Python requirements before enabling this optional lane.

## Unbrowse boundary

Unbrowse 11.4.1 is an optional local developer tool. Its installed CLI uses Node
22.5 or later and an in-process runtime; a port-6969 daemon is not required. Its
hosted route graph, account services and marketplace remain separate from that
local runtime. Do not infer offline execution from the phrase "local CLI".

The integration must not import browser sessions, private listing snapshots,
workspace keys or database credentials into Unbrowse. Route metadata is reviewed
before it becomes a native collector. Account, terms, publishing and payment
configuration are separate setup steps; installation does not authorize accepting
new terms or funding a wallet. No Unbrowse output is ingested into listings
automatically. Runtime/setup status is reported separately from package presence.

The wrapper provides a local installation check and prepares a route-inspection
plan for operator review. It does not execute hosted route resolution. Imported
GET route candidates must use a configured publisher host and contain only the
allowed review fields; credentials and arbitrary response metadata are rejected.
The doctor command detects global npm installations across common paths including
`APPDATA` (Windows), `/usr/local/lib`, `/usr/lib`, NVM paths, and
`~/.npm-global`. Set `UNBROWSE_PACKAGE_ROOT` to override auto-detection.

```sh
npm run crawler:unbrowse -- doctor
npm run crawler:unbrowse -- prepare --source gsa --url https://realestatesales.gov/
npm run crawler:unbrowse -- import-candidate --file .cache/crawler-tools/unbrowse/gsa-candidate.json
```

Candidate import rejects: files over 1 MiB, nonexistent paths, directories,
malformed JSON, unknown top-level fields, non-GET methods, non-pending review
status, wrong schema versions, non-unbrowse providers, invalid timestamps,
secret-like query parameters, credential-like content in notes (including
`ubr_` tokens), and missing or non-object evidence blocks.

On September 12, Unbrowse 11.4.1 was installed with lifecycle scripts disabled.
Inspection of that installed version confirmed that setup accepts hosted terms
and creates an agent identity. Setup, browser capture, route resolution, publishing
and wallet operations were not executed. `UNBROWSE_LOCAL_ONLY` is not treated as
proof that every command stays offline. The redacted `--url*****` example from
the request is not a usable target URL.

## Verification on September 12

The optional GSA parser passed a real read-only collection: three detail
candidates, two valid property records, one rejected record, and no request
failures in 7.7 seconds. The two records retained Scrapling 0.4.15 extraction
hashes; neither acquired an invented opening amount. This probe did not replace
stored inventory or promote a source. Native parsing remains the operating
default; Python installation is required wherever this optional lane is enabled.

A subsequent canonical PostgreSQL canary completed as
`job_51a6b8f0e5e5deb3d641a4fd` with two accepted records and zero ingestion
rejections. Both immutable snapshots in source run
`4b7bb2ef-97e7-43a3-8b7d-fdb029bf79e9` retained Scrapling 0.4.15, exact detail
URLs and SHA-256 hashes. The compact job report omits extraction metadata, so
verification read the persisted snapshots directly. The source was already
promoted previously; this test did not change source promotion settings.

The broader onboarding spider's separate GSA probe observed robots exclusion for
`/our-listing`. It made no listing-page request and returned `complete: false`,
`blockedCount: 1`, exit code 2. This discovery lane therefore remains blocked for
that path. The existing adapter canary above preceded this robots observation.

The IRS onboarding probe completed its depth-zero index scope: one fetched HTML
page, eight exact record-link candidates, no blocks or truncation, with timestamp
and page hash retained. Candidate discovery did not ingest those eight records or
assert they were newly listed. Its scope hash is
`72dfeb27fe8f78fadfc02f909dc9930e22806c652000fe6708f61c7349e4ebfe`.

The expanded crawler-tool Node suite passed all 49 tests after the reliability
follow-up, and the direct Python parser passed two tests. Existing collection reliability, transport-error,
publisher-media, source-coverage and canonical-runtime checks also passed.
These are targeted checks for this integration, not a new full-platform release
certification.

Primary references reviewed:

- [Scrapling official skill](https://github.com/D4Vinci/Scrapling/tree/main/agent-skill)
- [Scrapling documentation](https://scrapling.readthedocs.io/en/latest/index.html)
- [Unbrowse package](https://www.npmjs.com/package/unbrowse)
- [Unbrowse public source and configuration](https://github.com/unbrowse-ai/unbrowse)

## Remaining work from the original platform request

These additions do not close the full release gate. September 12 follow-up
canaries completed ServiceLink's resumed sweep (5,611 accepted in the final
segment) and HUD's 52-jurisdiction sweep (1,992 accepted across 56 pages), with
terminal checkpoints cleared. Continuous collection still needs its operating
soak after disk recovery. Wave 2 sources need jurisdiction-specific canaries.
Panoramax metadata lookup and a direct web-component fallback are now integrated;
the application helper rendered and navigated directional imagery in a browser
control. See [the later verification](../reports/discovery-followup-2026-09-12.md).
The document contract now includes observed labels,
counts, access states and timestamps, with actual ServiceLink document ingestion.
Publisher market panels, related properties and sharing remain follow-on work.
The production container stack and a continuous-worker soak remain unverified.
The local preview now serves a fresh production build on port 3103. See
[the property experience verification](../reports/property-experience-2026-09-12.md)
for subsequent canary, browser, document and worker-check evidence.

The GSA identifier parser now rejects prose such as `Sale Number: Block` and
retains it as a rejected candidate while using the publisher property ID. Valid
existing sale IDs stay compatible. The historical `GSA-Block` row has not been
rekeyed; deliberate alias/reconciliation work is required before a future corrected
`GSA-43` observation can be assumed to share its saved-state links and timeline.

The archive, photos manifest and atlas were imported, not merely staged: prior
acceptance recorded 5,900 catalog snapshots, 128 closed-result snapshots, 40,578
media references, 5,313 media links, 5,270 distinct assets and 501 atlas entries.
Most archive listings now have newer live projections; that does not remove the
dated snapshots. Photo ingestion does not override display/reuse policy.
