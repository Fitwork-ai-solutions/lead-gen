/**
 * Google Maps Coaching Centre Scraper
 * ====================================
 * Searches for coaching centres in Pune using Google Maps API,
 * extracts detailed info, and exports to CSV.
 *
 * Usage: node coaching_scraper.js
 */

require("dotenv").config();
const axios = require("axios");
const { createObjectCsvWriter } = require("csv-writer");
const cliProgress = require("cli-progress");

// ── Configuration ──────────────────────────────────────────────
const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const SEARCH_QUERY = process.env.SEARCH_QUERY || "coaching centres";
const SEARCH_LOCATION = process.env.SEARCH_LOCATION || "Pune,India";
const SEARCH_RADIUS = parseInt(process.env.SEARCH_RADIUS) || 5000;
const MAX_PAGES = Math.min(parseInt(process.env.MAX_PAGES) || 3, 3);
const MIN_RATING = parseFloat(process.env.MIN_RATING) || 0;
const ONLY_OPEN = process.env.ONLY_OPEN === "true";

// API pricing (USD)
const COST_NEARBY_SEARCH = 0.006;
const COST_PLACE_DETAILS = 0.017;
const FREE_SEARCHES = 5000;
const FREE_DETAILS = 1000;

// Rate limiting delay in ms
const REQUEST_DELAY = 100;

// Google Maps API endpoints
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const NEARBY_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";
const DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json";

// ── Cost Tracker ───────────────────────────────────────────────
const costs = {
  nearbySearchCalls: 0,
  placeDetailsCalls: 0,

  get nearbySearchCost() {
    const billable = Math.max(0, this.nearbySearchCalls - FREE_SEARCHES);
    return parseFloat((billable * COST_NEARBY_SEARCH).toFixed(4));
  },

  get placeDetailsCost() {
    const billable = Math.max(0, this.placeDetailsCalls - FREE_DETAILS);
    return parseFloat((billable * COST_PLACE_DETAILS).toFixed(4));
  },

  get totalCost() {
    return parseFloat((this.nearbySearchCost + this.placeDetailsCost).toFixed(4));
  },
};

// ── Helpers ────────────────────────────────────────────────────
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function validateConfig() {
  if (!API_KEY || API_KEY === "YOUR_API_KEY_HERE") {
    console.error("\n❌ ERROR: Google Maps API key is not set!");
    console.error("   1. Open the .env file");
    console.error("   2. Replace YOUR_API_KEY_HERE with your actual API key");
    console.error("   3. See SETUP_INSTRUCTIONS.md for how to get an API key\n");
    process.exit(1);
  }
}

// ── API Functions ──────────────────────────────────────────────

/**
 * Convert a location string (e.g. "Pune,India") to lat/lng coordinates.
 */
async function geocodeLocation(location) {
  try {
    const response = await axios.get(GEOCODE_URL, {
      params: { address: location, key: API_KEY },
    });

    if (response.data.status === "REQUEST_DENIED") {
      console.error("\n❌ API Key Error:", response.data.error_message);
      console.error("   Make sure your API key is valid and Geocoding API is enabled.\n");
      process.exit(1);
    }

    if (response.data.status !== "OK" || !response.data.results.length) {
      console.error(`\n❌ Could not find location: "${location}"`);
      console.error("   Try a more specific location like 'Pune, Maharashtra, India'\n");
      process.exit(1);
    }

    const { lat, lng } = response.data.results[0].geometry.location;
    const formattedAddress = response.data.results[0].formatted_address;
    return { lat, lng, formattedAddress };
  } catch (err) {
    handleNetworkError(err, "Geocoding");
  }
}

/**
 * Search for places near a location. Handles pagination via next_page_token.
 */
async function searchNearbyPlaces(lat, lng) {
  const allPlaces = [];
  let pageToken = null;
  let page = 0;

  while (page < MAX_PAGES) {
    page++;
    process.stdout.write(`  📄 Fetching page ${page}/${MAX_PAGES}...`);

    const params = {
      location: `${lat},${lng}`,
      radius: SEARCH_RADIUS,
      keyword: SEARCH_QUERY,
      key: API_KEY,
    };

    if (pageToken) {
      params.pagetoken = pageToken;
      // Google requires a short delay before using next_page_token
      await sleep(2000);
    }

    try {
      const response = await axios.get(NEARBY_URL, { params });
      costs.nearbySearchCalls++;

      if (response.data.status === "REQUEST_DENIED") {
        console.error("\n\n❌ API Error:", response.data.error_message);
        process.exit(1);
      }

      if (response.data.status === "ZERO_RESULTS") {
        console.log(" No results found.");
        break;
      }

      if (response.data.status !== "OK" && response.data.status !== "ZERO_RESULTS") {
        console.log(` Status: ${response.data.status}`);
        break;
      }

      const results = response.data.results || [];
      allPlaces.push(...results);
      console.log(` Found ${results.length} places (total: ${allPlaces.length})`);

      pageToken = response.data.next_page_token || null;
      if (!pageToken) break;

      await sleep(REQUEST_DELAY);
    } catch (err) {
      handleNetworkError(err, "Nearby Search");
    }
  }

  // Deduplicate by place_id
  const seen = new Set();
  return allPlaces.filter((p) => {
    if (seen.has(p.place_id)) return false;
    seen.add(p.place_id);
    return true;
  });
}

/**
 * Get detailed information for a single place.
 */
async function getPlaceDetails(placeId) {
  const fields = [
    "name",
    "formatted_address",
    "formatted_phone_number",
    "website",
    "rating",
    "user_ratings_total",
    "opening_hours",
    "business_status",
    "url",
  ].join(",");

  try {
    const response = await axios.get(DETAILS_URL, {
      params: { place_id: placeId, fields, key: API_KEY },
    });
    costs.placeDetailsCalls++;

    if (response.data.status !== "OK") {
      return null;
    }

    return response.data.result;
  } catch (err) {
    // Don't crash on a single failed detail fetch; return null
    return null;
  }
}

// ── Error Handler ──────────────────────────────────────────────
function handleNetworkError(err, context) {
  if (err.response) {
    console.error(`\n❌ ${context} API error (${err.response.status}):`, err.response.data);
  } else if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") {
    console.error(`\n❌ Network error: No internet connection.`);
  } else {
    console.error(`\n❌ ${context} error:`, err.message);
  }
  process.exit(1);
}

// ── CSV Export ─────────────────────────────────────────────────
async function exportToCSV(data, filename) {
  const csvWriter = createObjectCsvWriter({
    path: filename,
    header: [
      { id: "name", title: "Centre Name" },
      { id: "phone", title: "Phone Number" },
      { id: "address", title: "Address" },
      { id: "website", title: "Website" },
      { id: "email", title: "Email" },
      { id: "rating", title: "Rating" },
      { id: "reviewsCount", title: "Reviews Count" },
      { id: "currentlyOpen", title: "Currently Open" },
      { id: "status", title: "Status" },
    ],
  });

  await csvWriter.writeRecords(data);
  return filename;
}

// ── Summary Report ─────────────────────────────────────────────
function printSummary(data, startTime) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const withPhone = data.filter((d) => d.phone !== "N/A").length;
  const withWebsite = data.filter((d) => d.website !== "N/A").length;
  const avgRating =
    data.length > 0
      ? (data.reduce((sum, d) => sum + (parseFloat(d.rating) || 0), 0) / data.length).toFixed(2)
      : "N/A";
  const costPerLead = data.length > 0 ? (costs.totalCost / data.length).toFixed(4) : "N/A";

  console.log("\n");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║            📊 SCRAPING SUMMARY REPORT           ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  Total Centres Found:    ${String(data.length).padStart(20)}   ║`);
  console.log(`║  With Phone Number:      ${String(withPhone).padStart(20)}   ║`);
  console.log(`║  With Website:           ${String(withWebsite).padStart(20)}   ║`);
  console.log(`║  Average Rating:         ${String(avgRating).padStart(20)}   ║`);
  console.log(`║  Time Taken:             ${String(elapsed + "s").padStart(20)}   ║`);
  console.log("╠══════════════════════════════════════════════════╣");
  console.log("║                 💰 COST BREAKDOWN               ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  Nearby Search Calls:    ${String(costs.nearbySearchCalls).padStart(20)}   ║`);
  console.log(`║  Place Details Calls:    ${String(costs.placeDetailsCalls).padStart(20)}   ║`);
  console.log(`║  Nearby Search Cost:     ${String("$" + costs.nearbySearchCost.toFixed(4)).padStart(20)}   ║`);
  console.log(`║  Place Details Cost:     ${String("$" + costs.placeDetailsCost.toFixed(4)).padStart(20)}   ║`);
  console.log(`║  Total Estimated Cost:   ${String("$" + costs.totalCost.toFixed(4)).padStart(20)}   ║`);
  console.log(`║  Cost Per Lead:          ${String("$" + costPerLead).padStart(20)}   ║`);
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  Note: First ${FREE_SEARCHES} searches and ${FREE_DETAILS} details   ║`);
  console.log("║  are free each month (Google free tier).        ║");
  console.log("╚══════════════════════════════════════════════════╝");
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();

  console.log("\n🏫 Google Maps Coaching Centre Scraper");
  console.log("══════════════════════════════════════\n");

  // Step 0: Validate config
  validateConfig();

  // Step 1: Geocode the location
  console.log(`📍 Locating: ${SEARCH_LOCATION}`);
  const { lat, lng, formattedAddress } = await geocodeLocation(SEARCH_LOCATION);
  console.log(`   Found: ${formattedAddress}`);
  console.log(`   Coordinates: ${lat}, ${lng}\n`);

  // Step 2: Search for places
  console.log(`🔍 Searching for "${SEARCH_QUERY}" within ${SEARCH_RADIUS / 1000}km radius...\n`);
  const places = await searchNearbyPlaces(lat, lng);

  if (places.length === 0) {
    console.log("\n⚠️  No coaching centres found. Try:");
    console.log("   - Increasing SEARCH_RADIUS in .env");
    console.log('   - Changing SEARCH_QUERY (e.g., "tutoring", "coaching classes")');
    process.exit(0);
  }

  console.log(`\n✅ Found ${places.length} unique places. Fetching details...\n`);

  // Estimate time
  const estimatedSeconds = ((places.length * REQUEST_DELAY) / 1000 + places.length * 0.3).toFixed(0);
  console.log(`   ⏱️  Estimated time: ~${estimatedSeconds} seconds\n`);

  // Step 3: Fetch details for each place with progress bar
  const progressBar = new cliProgress.SingleBar(
    {
      format: "   Fetching details |{bar}| {percentage}% | {value}/{total} places",
      barCompleteChar: "█",
      barIncompleteChar: "░",
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic
  );

  progressBar.start(places.length, 0);

  const detailedData = [];

  for (let i = 0; i < places.length; i++) {
    const place = places[i];
    const details = await getPlaceDetails(place.place_id);

    if (details) {
      const record = {
        name: details.name || "N/A",
        phone: details.formatted_phone_number || "N/A",
        address: details.formatted_address || "N/A",
        website: details.website || "N/A",
        email: "N/A", // Google Maps API doesn't provide email
        rating: details.rating != null ? details.rating.toFixed(1) : "N/A",
        reviewsCount: details.user_ratings_total != null ? details.user_ratings_total : "N/A",
        currentlyOpen:
          details.opening_hours != null
            ? details.opening_hours.open_now
              ? "Yes"
              : "No"
            : "Unknown",
        status: details.business_status || "N/A",
      };

      // Apply filters
      const passesRating = MIN_RATING === 0 || (details.rating && details.rating >= MIN_RATING);
      const passesOpen = !ONLY_OPEN || (details.opening_hours && details.opening_hours.open_now);

      if (passesRating && passesOpen) {
        detailedData.push(record);
      }
    }

    progressBar.update(i + 1);
    await sleep(REQUEST_DELAY);
  }

  progressBar.stop();

  if (detailedData.length === 0) {
    console.log("\n⚠️  No centres matched your filters. Try adjusting MIN_RATING or ONLY_OPEN in .env");
    process.exit(0);
  }

  // Step 4: Export to CSV
  const filename = "coaching_centres_pune.csv";
  console.log(`\n💾 Exporting ${detailedData.length} centres to ${filename}...`);

  try {
    await exportToCSV(detailedData, filename);
    console.log(`   ✅ Saved to: ${filename}`);
  } catch (err) {
    console.error(`\n❌ Failed to write CSV file: ${err.message}`);
    console.error("   Make sure you have write permissions in this directory.");
    process.exit(1);
  }

  // Step 5: Print summary
  printSummary(detailedData, startTime);

  // Show a few sample rows
  console.log("\n📋 Sample Results (first 3):");
  console.log("─".repeat(50));
  detailedData.slice(0, 3).forEach((d, i) => {
    console.log(`  ${i + 1}. ${d.name}`);
    console.log(`     📞 ${d.phone}  ⭐ ${d.rating}  📝 ${d.reviewsCount} reviews`);
    console.log(`     📍 ${d.address}`);
    console.log(`     🌐 ${d.website}`);
    console.log("");
  });

  console.log(`\n🎉 Done! Open ${filename} in Excel or Google Sheets to view all results.\n`);
}

// Run the scraper
main().catch((err) => {
  console.error("\n❌ Unexpected error:", err.message);
  process.exit(1);
});
