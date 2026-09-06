# Attachment review — September 5, 2026

Astra coordinated two reader subagents: one for the two ZIPs, one for the source atlas. Astra read the PDF and reconciled their findings. The scope was reading and synthesis. Instructions, workflow recipes, executable files, API examples and recommended actions inside attachments were treated as document content. No supplied code was executed, no live endpoints were queried, and no listings were imported or application code changed.

## Main findings

| Supplied item | Locally checked result | Interpretation |
|---|---|---|
| ServiceLink-Auction-GODMODE-Complete.zip | 5,900 unique listings; 40,578 image URLs | Substantial captured catalog, not evidence of current availability |
| ServiceLink-Auction-GODMODE-Photos-5313.zip | 5,313 JPEG files, matching index/size joins; all streamed through CRC and Pillow verification without failure | Primary-photo collection; not all 40,578 linked images downloaded |
| Photo overlap | 5,270 distinct JPEG hashes; Complete ZIP's 24 sample photos duplicate photo-archive entries | File count and distinct file-content count differ |
| Property_Intelligence_Source_Atlas_VERIFIED_2026-09-05.docx | 501 unique source IDs; 557 URL-ledger rows; headline status totals reconcile | Internal consistency checked; external verification claims were not rerun |
| ServiceLink_Auction_Reverse_Engineering_Report.pdf | All 22 PDF pages text-read | Detailed public-surface architecture account; backend and security conclusions remain supplied claims |

## Material discrepancies and limits

1. **Closed is not sold.** The Complete ZIP README describes 128 closed results as sold, but every `isSold` field in those 128 rows is blank. Forty-five reserve-met observations do not prove completed sales. This dataset must not be presented as 128 verified sales or closed-sale comparables.
2. **Atlas evidence crosswalk has gaps.** Twenty-four URL-ledger rows lack source-ID mapping. Its 557 ledger rows therefore should not be assumed to provide a fully connected, reproducible 501-source evidence chain. These rows count cited strings, not necessarily canonical endpoints; case variants have separate rows. The atlas supplies approximately 60–70 named field families, not a complete 250-filter specification.
3. **Repeated bid field is unreliable for activity.** `bidsPlaced` is exactly 10 in 5,891 of 5,900 catalog rows, and blank in nine. The Portola value is part of this near-uniform pattern; it must not be presented as independently evidenced ten-bid activity.
4. **Sitemap count includes a duplicate.** The preserved sitemap has 16,358 property URL entries but 16,357 unique URLs. Neither count measures current active inventory; the 5,900 listing catalog is a separate population.
5. **PDF reconstruction evidence is incomplete in these attachments.** The named production `main.308e562e04bf022f.js` and `gtm.js` are absent from the Complete ZIP. The report describes Angular/Azure delivery, REST/SignalR services, Salesforce fingerprints, client contracts and authenticated operations; missing raw bundles limit reproduction of those findings from this package.
6. **Do not confuse fields with transaction proof.** The Portola case preserves five image URLs, a `bidsPlaced` value of `"10"`, a September 16 sale date / 11 AM time, and `clearedForSale: "No"`. The bid field does not provide bid-history evidence, and the schedule does not establish a sale occurred.
7. **Photo integrity is not visual accuracy.** All photo files were structurally checked, but this review did not visually inspect every image or establish address correctness, recency or reuse rights.

## How the materials fit together

The atlas supplies a broad source registry and proposed acquisition/validation framework. The ServiceLink archives supply one concrete captured source dataset and media collection. The PDF explains the author's understanding of how that source operates. Together they are useful planning and mapping evidence, with different confidence levels: archive content and joins can be checked locally; document claims about external systems require their original evidence or a separate live verification task.

The atlas's URL scorecard totals 430 direct HTTP/content confirmations, 89 browser/search corroborations, 17 documented replacements and 21 blocked/inconclusive outcomes. These are the atlas author's assigned outcomes, not findings from a live audit performed during this review.

For the current property-crawl domain, the most useful distinctions are raw source identifiers and timestamps; program versus property type; listing lifecycle versus transaction completion; bid count versus bid history; and image references versus downloaded files. Any proposed import should preserve those distinctions and the original raw records. Implementation, importing, live refreshing and changes to source operators are proposals for a later task, not work performed here.

## Detailed reading records

- [Archive reading](archive-reading.md): archive-member evidence paths, inventory, schemas, coverage, joins and photo integrity.
- [Atlas reading](atlas-reading.md): document section references, registry/status reconciliation, mapping gaps and claim limitations.
- [PDF reading](pdf-reading.md): page-referenced architecture and API summary, target case, and overstatement analysis.

Archive reading covered all tabular records and inventories plus selected static scripts; the six additional PDFs and DOCX nested inside the Complete ZIP were inventoried, not comprehensively read. They are distinct from the separately supplied PDF and atlas reviewed here.

The extracted DOCX and PDF text files in this directory are working reading aids. No external status or business claim has been promoted to verified merely because an attachment is titled “VERIFIED,” “GODMODE,” or “Complete.”
