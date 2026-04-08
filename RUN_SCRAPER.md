# How to Run the Scraper

## Quick Start (3 commands)

```bash
# 1. Install dependencies (one time only)
npm install

# 2. Add your API key to .env
# Open .env and replace YOUR_API_KEY_HERE with your actual key

# 3. Run it!
npm run scrape
```

---

## What Happens When You Run It

1. **Locates Pune** — converts "Pune,India" to GPS coordinates
2. **Searches** — finds coaching centres within the specified radius
3. **Fetches details** — gets phone, website, rating for each centre
4. **Exports CSV** — saves everything to `coaching_centres_pune.csv`
5. **Shows summary** — displays cost breakdown and statistics

---

## Reading the Output

### During Execution
```
🏫 Google Maps Coaching Centre Scraper
══════════════════════════════════════

📍 Locating: Pune,India
   Found: Pune, Maharashtra, India
   Coordinates: 18.5204, 73.8567

🔍 Searching for "coaching centres" within 5km radius...

  📄 Fetching page 1/3... Found 20 places (total: 20)
  📄 Fetching page 2/3... Found 20 places (total: 40)
  📄 Fetching page 3/3... Found 15 places (total: 55)

✅ Found 55 unique places. Fetching details...

   Fetching details |████████████████████| 100% | 55/55 places
```

### CSV Output Columns

| Column          | Example                                    |
|-----------------|--------------------------------------------|
| Centre Name     | Chate Classes                              |
| Phone Number    | 020 1234 5678                              |
| Address         | 123, FC Road, Shivajinagar, Pune 411005    |
| Website         | https://www.chateclasses.com               |
| Email           | N/A (not available via Google Maps API)    |
| Rating          | 4.2                                        |
| Reviews Count   | 156                                        |
| Currently Open  | Yes / No / Unknown                         |
| Status          | OPERATIONAL / CLOSED_TEMPORARILY           |

---

## Customizing Your Search

### Search for different types
```env
SEARCH_QUERY=IIT coaching classes
SEARCH_QUERY=UPSC coaching
SEARCH_QUERY=music classes
SEARCH_QUERY=dance academy
```

### Search in different cities
```env
SEARCH_LOCATION=Mumbai,India
SEARCH_LOCATION=Bangalore,India
SEARCH_LOCATION=Delhi,India
```

### Larger area
```env
SEARCH_RADIUS=10000    # 10km
SEARCH_RADIUS=20000    # 20km
```

### Filter by quality
```env
MIN_RATING=4.0         # Only 4+ star rated
ONLY_OPEN=true         # Only currently open
```

---

## Scaling to More Leads

Google's Nearby Search returns **max 60 results** per location (3 pages x 20). To get more:

1. **Change the search query** — run multiple queries:
   - "coaching centres", "coaching classes", "tutoring", "tuition classes"

2. **Change the location** — target different areas of Pune:
   - "Kothrud, Pune", "Hinjewadi, Pune", "Wakad, Pune", etc.

3. **Increase radius** — but may get duplicates from overlapping areas

---

## Cost Optimization Tips

- Start with `MAX_PAGES=1` to test (fetches max 20 results)
- Use the free tier wisely — 5000 searches + 1000 details per month
- Run large batches at the start of each billing month
- The scraper deduplicates automatically, so overlapping areas won't cost extra for details

---

## Scheduling Regular Runs

### Using cron (Mac/Linux)
```bash
# Run every Monday at 9 AM
crontab -e
0 9 * * 1 cd /path/to/Maps-scrapper && node coaching_scraper.js
```

### Using Task Scheduler (Windows)
Create a scheduled task that runs `node coaching_scraper.js` in this folder.

---

## Integrating with Other Tools

### Open in Excel/Google Sheets
Simply double-click `coaching_centres_pune.csv` or import it.

### Import to Google Sheets automatically
Upload the CSV to Google Drive, then open with Sheets.

### Use with CRM tools
Most CRM tools (HubSpot, Zoho, Salesforce) can import CSV files directly.
