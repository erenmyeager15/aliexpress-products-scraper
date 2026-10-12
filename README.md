# AliExpress Product Analysis & US Sourcing Reports

Turn your **authorized product CSV/JSON export** into a sourcing report for US
e-commerce operators, purchasing teams and agencies. Compare supplied quotes,
audit shipping-cost gaps and offer conditions, model hypothetical unit economics,
and review changes between observations you provide.

**This is an export-analysis tool, not a live AliExpress scraper.** It does not
search AliExpress, fetch product links, log in, solve challenges, call a marketplace
API, use a proxy or obtain new product data. You provide your own or properly
licensed observations. No API key is needed for analysis; that does not grant access
or rights to AliExpress data.

The three demo presets contain **invented, clearly labeled values**. They save no
dataset products and create no product-result fees. Actor Start and Apify platform
usage still apply, including to demo or invalid-input runs.

## Start with a labeled preview

```json
{
  "mode": "demo",
  "demoPreset": "us-cost-comparison"
}
```

Open **Output → Run status**, then the JSON report, flat comparison CSV, findings
CSV, cost/context quality CSV or readable Markdown report. The dataset is empty
in demo by design. Every preview report identifies its synthetic source; invented
product IDs and prices must not be used as real offers.

The other presets are `us-margin-scenario` and `us-price-change-review`.
For the contribution preview, supply explicit hypothetical assumptions:

```json
{
  "mode": "demo",
  "demoPreset": "us-margin-scenario",
  "retailPriceUsd": 20,
  "marketplaceFeePercent": 10,
  "paymentFeePercent": 5,
  "returnsReservePercent": 5,
  "fixedFeeUsd": 0.5,
  "fulfillmentCostUsd": 1.5,
  "adCostUsd": 2,
  "targetContributionMarginPercent": 25
}
```

These are made-up scenario assumptions, **not current platform rates**.

## Analyze an authorized export

1. Confirm your rights to process the observations through this paid service.
   Public visibility, another scraper's output or an API account alone is not
   proof of redistribution or commercial-use permission.
2. Select `import`, identify your provider in `importSource`, and paste exactly
   one of `importJson` (a JSON array encoded as text) or `importCsv` (CSV text).
3. Set `authorizedData` to `true` **only after confirming those rights**. It is
   false by default. The Actor does not verify or grant a license.
4. Start with `maxResults: 1`. One product analysis contains all supplied
   observations/variants for that product ID; months and findings are not extra
   product fees.
5. Check completeness and provenance in `RUN_STATUS`, then use `COMPARISON.csv`
   for spreadsheet-ready rows. The dataset contains nested per-product evidence
   and single-product analysis, not one billed row per observation.

This deliberately unconfirmed example shows the input format with fictitious data.
It will reject imports until you make your own rights confirmation:

```json
{
  "mode": "import",
  "importSource": "YOUR_AUTHORIZED_EXPORT_PROVIDER",
  "authorizedData": false,
  "maxResults": 1,
  "importCsv": "productId,title,variant,observedAt,currency,shipToCountry,priceBasis,taxBasis,quantityBasis,price,shippingCost,taxCost,dutyCost\n00000001,SYNTHETIC cable A,1 m black,2026-10-10,USD,US,standard,excluded,per-unit,4,2,0.5,0"
}
```

The JSON and CSV text fields use Apify secret-input storage. Do not submit tokens,
private seller/customer identities or credentials anyway. Unsupported columns are
dropped from outputs, sensitive email/phone/credential patterns in supported text
are redacted, and source links lose tracking parameters. This is a guard, not a
guarantee that arbitrary private text is anonymized. Links and images are stored
only when valid for supported AliExpress hosts; the Actor never fetches them.

## Accepted observation columns

| Field | Meaning |
| --- | --- |
| `productId` | Required 8–24 digit **string**. Numeric JSON IDs are rejected to prevent precision loss. Keep CSV cells as text in your spreadsheet. |
| `title` | Required product label, maximum 500 characters. |
| `observedAt` | Required actual observation time: `YYYY-MM-DD` or UTC ISO timestamp ending in `Z`. Impossible/future times are rejected. |
| `price` | Required nonnegative numeric price. No `$` labels, decimal commas, ranges, formulae or `K/M` abbreviations. |
| `variant` | Explicit variant/SKU label for valid repeat comparisons; no default variant is invented. |
| `currency`, `shipToCountry` | Explicit three/two-letter source codes. Missing values are unknown, never assumed USD/US. Codes are supplied labels, not geographic/source verification. |
| `priceBasis` | `standard`, `new-customer`, `conditional` or `unknown`. New-customer/conditional prices are not treated as repeatable sourcing margins or comparable standard prices. |
| `taxBasis` | `included`, `excluded` or `unknown`. With `included`, any supplied additional `taxCost` must be exactly zero to prevent double counting. |
| `quantityBasis` | `per-unit`, `per-order` or `unknown`. Unit economics and numeric comparisons need an explicit per-unit basis. |
| `shippingCost`, `taxCost`, `dutyCost` | Supplied **additional per-unit** amounts in the same currency. All three must be explicitly known, including explicit zeroes if applicable. No tax/tariff rates are fetched or estimated. |
| `comparisonGroup` | Your declared group of quotes to compare. This label does not prove the products/variants are substitutes. |
| `mrp`, `discountPercent` | Optional supplied reference price and claimed discount. Their arithmetic is audited, not their authenticity. |
| `rating`, `ratingCount` | Optional numeric aggregate rating (0–5) and whole-number count. No reviewer identities. |
| `soldCount`, `soldCountBasis` | Optional integer and `exact`, `lower-bound` or `unknown` declaration. This is not sales growth, verified demand or actual sales income. |
| `deliveryDaysMin`, `deliveryDaysMax` | Optional supplied delivery-day estimates, 0–3650. No delivery promise. |
| `inStock` | Explicit true/false/unknown. Absence of an observation is never inferred to mean out of stock. |
| `productUrl`, `imageUrl` | Optional valid supported source links, never fetched. Product URL must match `productId`. |
| `brand`, `category` | Optional source text. Missing values remain null, not guessed. |

Common normalized aliases include `id`, `name`, `scrapedAt`, `salePrice`,
`priceCurrent`, `originalPrice`, `priceOriginal`, `priceDiscount`, `shippingFee`
and `ordersCount`. Aliases do **not** infer currency, units or missing context.
Duplicate/ambiguous headers are rejected. Identical observations are deduplicated;
conflicts at the same product/time/context reject the whole export before billing.

Limits: **2 MiB**, **1,000 supplied observations**, **60 columns**, and
`maxResults` between **1 and 500 unique products**. First-seen products are selected.
All input rows are validated before saving, including rows beyond the result cap.
No remote CSV URL, XLSX, ZIP, file path or formula is opened/evaluated.

## Sourcing features beyond a simple price dump

### Cost gaps and offer-basis review

The report keeps a $3 headline offer with unknown shipping separate from a quote
with known components. It never silently fills missing shipping, tax, duty,
currency, variant or destination with a favorable assumption. It flags
new-customer/conditional offers, unknown stock and delivery, discount arithmetic
inconsistencies, reference prices below sale price and non-exact sold-count labels.

`enteredLandedCost = price + shippingCost + additional taxCost + dutyCost`

This is the sum of **supplied components**, not a verified checkout total or a
guaranteed landed quote. Do not double-count costs already included in a price.

### Hypothetical US contribution and ad-budget scenarios

Scenarios run only for explicit **US / USD / standard / per-unit** quotes with
known cost components and tax basis. Other countries/currencies remain visible;
the tool does not convert them or relabel them as US data.

Enter a hypothetical `retailPriceUsd`, fee percentages, returns reserve,
fixed/fulfillment/ad costs and `targetContributionMarginPercent`. The same entered
retail and fee assumptions apply to every selected quote.

```
contribution = resale price
             - entered landed cost
             - resale price × (marketplace + payment + returns reserve) / 100
             - fixed fee - fulfillment - advertising
```

Outputs include contribution dollars/percentage, break-even resale price and the
maximum modeled ad spend that meets your target. Negative values remain negative.
Target decisions use unrounded arithmetic; display values use up to six decimals.

**Contribution is not net profit or proof a product will sell.** Unspecified
fee/cost options default to zero as transparent assumptions, not verified absent
costs. Business overhead, income taxes and unmodeled expenses are excluded. There
is no legal tax/tariff guidance, rate lookup, demand forecast or profitability
guarantee.

### Evidence-linked change findings from your supplied observations

Default review thresholds are 5% price change (up or down), 10% entered-cost rise,
and 3 days increase in maximum delivery estimate. They are configurable. The
report also flags explicitly supplied true → false stock changes and offer/tax
basis drift.

Numerical comparisons require matching **product, variant, currency, destination,
standard offer, tax basis and per-unit basis**. Changed context is not a price
change. Zero baselines have unknown percentage changes. Time gaps greater than
`comparisonWindowDays` (default 30) remain explicit but trigger no numerical
findings. Raw values decide thresholds before display rounding.

Every finding retains the previous/current supplied time and values, threshold,
unit and provenance. These are **export review findings**, not live alerts.
There is no persistent watchlist/history, auto-refresh, schedule, email or Slack
notification. To analyze a later period, supply a new authorized export containing
the observations you want to compare; duplicate products across separate runs are
normal new analyses and billed again.

### Comparison-set ranks and quality reports

Entered-cost rank covers only complete-cost standard quotes from the **same exact
supplied timestamp, declared group, currency, destination, tax and quantity basis**
among saved products. Multiple variants can be separate quotes; single-product
variants are not invented competitors. Unknown or non-standard offers are excluded.
This is not a whole-market cheapest-price claim or proof of product equivalence.

US/other/unknown destination counts are a scope audit of **supplied labels**, not
proof of customer geography. The quality CSV exposes missing fields, non-standard
offer flags, time gaps and arithmetic issues; it does not certify accuracy,
freshness, licensing, supplier trust or product safety.

## Outputs and spreadsheet workflow

| Output | Contents |
| --- | --- |
| `RUN_STATUS` | Mode/provenance, complete/partial outcome, saved and unsaved counts, exact SDK result-event acknowledgment, no-source-request flags. |
| `REPORT` | Saved products (or clearly synthetic previews), quote/cost/scenario comparisons, findings and explicit assumptions/warnings. |
| `COMPARISON.csv` | Flat observation rows with source label, costs, scenario, delta and matched-peer context. Use this for Excel/Sheets comparison work. |
| `FINDINGS.csv` | Evidence-linked supplied price/cost/delivery/stock/context findings. |
| `QUALITY.csv` | Missing cost components, context gaps and review flags. |
| `REPORT.md` | Readable agency/purchasing-team summary with assumptions and caveats. |
| Dataset | One import analysis per saved product ID, nested supplied observations and single-product analysis. Empty in demo. Cross-product ranks are in the aggregate report/CSV. |

The same output links work for either mode; **check the source/isSynthetic columns**.
CSV cells beginning with formula markers are neutralized; Markdown escapes source
text. Only confirmed saved products enter real reports. Unsaved products are not
exposed just because their import was valid.

## Pricing and transparent cost control

Numeric event prices are unchanged:

| Event | Price | Scope |
| --- | ---: | --- |
| `product-scraped` (Product analyzed) | **$0.003/product — $3/1,000** | One successfully saved product ID analysis per run, including supplied variants/times and reports. |
| `apify-actor-start` | **$0.001 per GB, minimum one event** | Apify run start. At a 256 MB run, the minimum one event still applies. |

**Apify platform usage is paid separately by the user** under the retained pricing
policy. This is not an all-inclusive price. Demo, invalid input and spending-limit
stops may still incur start/platform usage costs. Demos, duplicates within the same
run, invalid inputs and unsaved products create no product-result fee.

The SDK checks the customer's result budget before each save. A complete final
product at an exact charge cap is successful with an honest spending-limit flag;
an unaffordable remaining product is explicitly partial. Failed/uncertain saves
are not retried automatically. The SDK's combined event acknowledgment is normalized
to its custom product counter delta; unpriced internal dataset acknowledgments are
not extra product fees. On an unconfirmed delivery, inspect the actual dataset and
platform billing because a failed acknowledgment may follow a saved/charged row.
A report-upload failure can occur after successful
product saves; those saved products retain their normal charges.

No proxy/browser/source network is needed, but storage/compute are not free. Start
small and set both result and run-spending limits. No guaranteed cost, margin,
ranking, traffic or customer-conversion promise is made.

## Migration from the old live scraper

This redesign intentionally replaces the old browser/residential search path with
authorized export analysis and synthetic demos. Legacy search/URL/proxy/page inputs
receive `LEGACY_INPUT_RETIRED` before product results, with a migration message.
They are never silently converted to invented search results. Start/usage costs
can still apply to that rejected run.

The Actor keeps its AliExpress product-analysis purpose and technical identity.
There is no live lookup fallback or unverified official-API mode. Future live
collection would require a separately verified source agreement and release.

## Responsible use and limitations

Use only your own or properly licensed observations whose terms permit processing
through this monetized service. A user confirmation is not a license. Do not submit
private seller/customer information, credentials or sensitive records. AliExpress
content rights and third-party export agreements remain your responsibility.

The Actor does not verify source data, authorization, supplier reliability, stock,
delivery, safety, checkout prices or current marketplace rates. Its purpose is
transparent arithmetic and comparison of supplied product evidence, not guaranteed
sourcing profit, fake demand, fabricated reviews or automatic business decisions.

## License

Apache-2.0 for the code. This does not grant rights to third-party marketplace data.
