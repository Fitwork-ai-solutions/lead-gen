# 🗺️ Lead Gen — Google Maps Scraper

A web-based Google Maps scraper with a sleek UI. Extract business data (phone, website, rating, address) from Google Maps and export as CSV.

## ✨ Features

- **Up to 300 results** per search using grid-based multi-area scanning
- **Real-time progress** via Server-Sent Events (SSE)
- **CSV export** — download results instantly
- **Cost estimation** — see estimated API costs per scrape
- **Beautiful dark UI** — responsive, modern design

## 🚀 Quick Start (Local)

```bash
# 1. Clone
git clone https://github.com/Fitwork-ai-solutions/lead-gen.git
cd lead-gen

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# Edit .env and add your Google Maps API key

# 4. Run
npm run dev
# Open http://localhost:3000
```

## 🔑 API Key Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a project and enable these APIs:
   - **Geocoding API**
   - **Places API**
3. Create an API Key and paste it in your `.env` file

## ☁️ Deploy on Render (Free)

1. Fork/push this repo to GitHub
2. Go to [render.com](https://render.com) → **New → Web Service**
3. Connect your GitHub repo
4. Configure:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Environment Variable**: `GOOGLE_MAPS_API_KEY` = `your_key`
5. Deploy! 🎉

## 📁 Project Structure

```
├── server.js           # Express server + SSE endpoint
├── scraper-engine.js   # Core scraping logic (grid search + dedup)
├── public/
│   └── index.html      # Frontend UI
├── exports/            # Generated CSV files
├── .env.example        # Environment template
└── package.json
```

## ⚠️ Notes

- Google Places API returns max 60 results per single area search
- For >60 results, the scraper automatically splits into a grid of sub-areas
- Free tier on Render sleeps after 15 min inactivity (first request takes ~30s to wake)
- API costs are within Google's free tier for moderate usage ($200/mo free credit)
