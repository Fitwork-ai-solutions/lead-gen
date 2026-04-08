# Setup Instructions - Google Maps Coaching Centre Scraper

## Prerequisites

- **Node.js** (v16 or later) - [Download here](https://nodejs.org/)
- **Google Cloud account** with billing enabled
- **Google Maps API key**

---

## Step 1: Get a Google Maps API Key

### 1.1 Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **Select a Project** (top bar) → **New Project**
3. Name it something like `maps-scraper`
4. Click **Create**

### 1.2 Enable Billing

1. Go to [Billing](https://console.cloud.google.com/billing)
2. Click **Link a billing account** or **Create account**
3. Add a payment method (credit/debit card)
4. **Note:** Google gives $200 free credit for new accounts, and the Places API has a generous free tier

### 1.3 Enable Required APIs

You need to enable **3 APIs**. Go to each link and click **Enable**:

1. **Geocoding API** → [Enable here](https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com)
2. **Places API** → [Enable here](https://console.cloud.google.com/apis/library/places-backend.googleapis.com)
3. **Places API (New)** — only if prompted; the legacy Places API is what we use

> Make sure the correct project is selected at the top before enabling.

### 1.4 Create an API Key

1. Go to [Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **+ CREATE CREDENTIALS** → **API key**
3. Copy the generated key
4. (Optional but recommended) Click **Restrict Key**:
   - Under **API restrictions**, select **Restrict key**
   - Check: Geocoding API, Places API
   - Save

### 1.5 Add Your API Key

1. Open the `.env` file in this project folder
2. Replace `YOUR_API_KEY_HERE` with your actual API key:
   ```
   GOOGLE_MAPS_API_KEY=AIzaSyB1234567890abcdefg
   ```
3. Save the file

---

## Step 2: Install Dependencies

Open a terminal in the project folder and run:

```bash
npm install
```

This installs: axios, csv-writer, dotenv, cli-progress

---

## Step 3: Configure Your Search (Optional)

Edit the `.env` file to customize:

| Variable         | Default             | Description                          |
|-----------------|---------------------|--------------------------------------|
| SEARCH_QUERY    | coaching centres    | What to search for                   |
| SEARCH_LOCATION | Pune,India          | Where to search                      |
| SEARCH_RADIUS   | 5000                | Radius in meters (5000 = 5km)        |
| MAX_PAGES       | 3                   | Pages per search (max 3, 20 per page)|
| MIN_RATING      | 0                   | Minimum star rating (0 = all)        |
| ONLY_OPEN       | false               | Only include currently open places   |

---

## Step 4: Run the Scraper

```bash
npm run scrape
```

Or:

```bash
node coaching_scraper.js
```

---

## Estimated Costs

| What               | Free Tier          | Cost After Free Tier |
|--------------------|--------------------|----------------------|
| Nearby Search      | 5,000/month        | $0.006 per call      |
| Place Details      | 1,000/month        | $0.017 per call      |

**Example:** Scraping 60 coaching centres = ~3 search calls + 60 detail calls.
- Within free tier: **$0.00**
- After free tier: ~$0.018 + ~$1.02 = **~$1.04**

---

## Troubleshooting

### "API key is not set"
→ Make sure you edited `.env` and replaced `YOUR_API_KEY_HERE`

### "REQUEST_DENIED"
→ Your API key may be invalid or the required APIs are not enabled.
→ Go to Google Cloud Console and verify all 3 APIs are enabled.

### "ZERO_RESULTS"
→ No places match your query in that area. Try:
- A broader search query (e.g., "tutoring" instead of "coaching centres")
- A larger radius (e.g., 10000 instead of 5000)

### "OVER_QUERY_LIMIT"
→ You've hit rate limits. Wait a minute and try again, or check your billing is active.

### Network errors
→ Check your internet connection and try again.
