# AliExpress Products Scraper - Prices & Catalog Data

Collect structured public AliExpress product catalog and pricing data for market research and price monitoring. Export to JSON, CSV, Excel, or HTML, or pull results through the Apify API. No AliExpress login or API key is required.

## What It Extracts

- Search query and result position
- Product ID and title
- Current and original price
- Discount percentage and currency
- Aggregate rating and sold count
- Business store name when exposed on the search card
- Product image and canonical URL
- Scrape timestamp

The Actor excludes individual seller identities, personal profiles, reviewer identities, emails, and phone numbers. Free-text values are passed through a sensitive-text redaction guard before storage.

## Input

| Field | Type | Required | Default | Description |
|---|---|---:|---|---|
| `searchQueries` | string[] | yes | `["wireless earbuds"]` | Product searches to process |
| `maxResults` | integer | no | `50` | Maximum unique products, up to 500 |
| `maxPagesPerQuery` | integer | no | `2` | Result pages opened per query, up to 10 |
| `proxyConfiguration` | object | no | Residential US | Apify proxy settings |

## Sample Output

```json
{
  "searchQuery": "wireless earbuds",
  "position": 1,
  "productId": "3256812072210872",
  "title": "Xiaomi Airdots 2 Wireless Earphones Bluetooth Headset",
  "price": 7.58,
  "originalPrice": 15.16,
  "discountPercent": 50,
  "currency": "USD",
  "rating": 4.9,
  "ordersCount": 500,
  "storeName": null,
  "imageUrl": "https://ae-pic-a1.aliexpress-media.com/kf/example.jpg",
  "productUrl": "https://www.aliexpress.com/item/3256812072210872.html",
  "scrapedAt": "2026-06-13T06:43:16.000Z"
}
```

## Use Cases

- Monitor AliExpress prices and discounts over time
- Compare products and aggregate demand signals across keywords
- Research marketplace assortment and category trends
- Build non-personal product catalog datasets
- Track rating and sold-count changes for public listings

## Pricing

| Event | Price | 1,000 products | 10,000 products |
|---|---:|---:|---:|
| `product-scraped` | $0.002/product | $2.00 | $20.00 |

The event is charged only after a clean, unique product record is saved. Blocked, duplicate, empty, and failed pages are not billed as product events.

## How to Scrape AliExpress Products

1. Add one or more product terms to `searchQueries`.
2. Choose the maximum number of products and pages per query.
3. Keep the recommended residential proxy configuration.
4. Run the Actor and wait for the dataset to populate.
5. Export the dataset or retrieve it through the Apify API.

## How It Works

The Actor opens AliExpress search pages in a real Chrome browser through rotating residential sessions. It waits for rendered product cards, scrolls the result page, extracts public catalog facts, removes duplicate product IDs, saves each clean record, and charges the PPE event only after storage succeeds.

## Known Limits

- AliExpress blocks direct and datacenter traffic; residential proxies are strongly recommended.
- Prices and availability can vary by delivery country, account state, promotions, and time.
- `storeName` is `null` when AliExpress does not expose a business store name on the search card.
- AliExpress can change generated CSS classes. The Actor combines semantic attributes and content patterns, but future site changes may require maintenance.
- Large runs are browser-intensive. Start with a small test before requesting hundreds of products.

## Responsible Use

This Actor is intended for lawful collection of publicly available information only. Users are responsible for ensuring their use complies with the source website's terms, robots.txt, applicable privacy laws, including India's DPDP Act, and all local regulations.

Do not use this Actor to collect, store, sell, or misuse personal data without a lawful basis. The Actor author is not responsible for misuse by end users.

## License

Apache-2.0
