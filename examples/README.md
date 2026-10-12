# Clearly labeled US synthetic previews

All three input files use `mode: demo`. The values are developer-authored fiction,
not AliExpress product data, current offers or customer history. They generate no
dataset rows or product-result fees. Start/platform usage still apply.

- `us-cost-comparison.json`: known cost components, unknown components and a
  new-customer offer, without replacing unknown costs with zero.
- `us-margin-scenario.json`: explicit hypothetical retail/fee/cost assumptions;
  compares contribution, break-even and target ad budgets, not net profit.
- `us-price-change-review.json`: supplied change thresholds and offer-basis drift;
  no live monitoring, schedule, persistent history or notification.

The public example manifest is in `release/us-examples.json`. Mode must remain
fixed to demo on these landing pages; real imports use the full Actor input with
secret JSON/CSV text and explicit rights confirmation. These files/manifest are
local release preparation, not evidence that pages have been published.
