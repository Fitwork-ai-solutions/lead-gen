/**
 * Scraper Engine (reusable module)
 * =================================
 * Core scraping logic extracted into a module that can be used
 * by both the CLI (coaching_scraper.js) and the web server (server.js).
 *
 * Supports up to 300 results via grid-based multi-area searching.
 * Google Places Nearby Search returns max 60 results per location,
 * so we split larger requests into a grid of sub-areas and deduplicate.
 *
 * Emits progress events so the caller can track status in real time.
 */

require("dotenv").config();
const axios = require("axios");
const { createObjectCsvWriter } = require("csv-writer");
const path = require("path");

// ── Constants ──────────────────────────────────────────────────
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const NEARBY_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";
const DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json";

const COST_NEARBY_SEARCH = 0.006;
const COST_PLACE_DETAILS = 0.017;
const FREE_SEARCHES = 5000;
const FREE_DETAILS = 1000;
const REQUEST_DELAY = 100;

const EARTH_RADIUS_M = 6_371_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Grid helpers ───────────────────────────────────────────────

/**
 * Generate a grid of {lat, lng} centres that tile the search area.
 *
 * @param {number} centerLat   - Centre latitude
 * @param {number} centerLng   - Centre longitude
 * @param {number} radiusM     - Total search radius in metres
 * @param {number} gridSize    - Number of cells per side (e.g. 3 → 3×3 = 9 cells)
 * @returns {{ lat: number, lng: number }[]}
 */
function generateGridCenters(centerLat, centerLng, radiusM, gridSize) {
  const centers = [];
  const latDegPerM = 180 / (Math.PI * EARTH_RADIUS_M);
  const lngDegPerM =
    180 / (Math.PI * EARTH_RADIUS_M * Math.cos((centerLat * Math.PI) / 180));

  // Step between cell centres: we cover 2*radius across gridSize cells
  const stepM = (2 * radiusM) / gridSize;
  const halfGrid = (gridSize - 1) / 2;

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      centers.push({
        lat: centerLat + (row - halfGrid) * stepM * latDegPerM,
        lng: centerLng + (col - halfGrid) * stepM * lngDegPerM,
      });
    }
  }
  return centers;
}

/**
 * Decide how many grid cells and what sub-radius to use.
 *
 * @param {number} maxResults  - User-requested max
 * @param {number} radiusM     - Original radius in metres
 * @returns {{ gridSize: number, subRadius: number }}
 */
function planGrid(maxResults, radiusM) {
  if (maxResults <= 60) {
    // Single search is enough
    return { gridSize: 1, subRadius: radiusM };
  }

  // Each cell yields up to ~60 unique results, but overlap reduces effective yield.
  // Use ~35 effective unique results per cell to be conservative.
  const cellsNeeded = Math.ceil(maxResults / 35);
  const gridSize = Math.min(Math.ceil(Math.sqrt(cellsNeeded)), 4); // cap at 4×4 = 16 cells
  // Sub-radius: slightly larger than cell step for overlap (ensures no gaps)
  const stepM = (2 * radiusM) / gridSize;
  const subRadius = Math.round(stepM * 0.75); // overlap factor

  return { gridSize, subRadius };
}

// ── Nearby search for a single coordinate ──────────────────────

/**
 * Run paginated nearby search for one {lat,lng} point.
 * Returns up to 60 results (3 pages × 20).
 */
async function nearbySearchAt({ lat, lng, subRadius, query, apiKey, costs }) {
  const places = [];
  let pageToken = null;
  const maxPages = 3;

  for (let page = 1; page <= maxPages; page++) {
    const params = {
      location: `${lat},${lng}`,
      radius: subRadius,
      keyword: query,
      key: apiKey,
    };
    if (pageToken) {
      params.pagetoken = pageToken;
      await sleep(2000); // Google requires delay before using next_page_token
    }

    const res = await axios.get(NEARBY_URL, { params });
    costs.nearbySearchCalls++;

    if (res.data.status === "REQUEST_DENIED") {
      throw new Error(`API Error: ${res.data.error_message || "Request denied."}`);
    }
    if (res.data.status === "ZERO_RESULTS") break;
    if (res.data.status !== "OK") break;

    places.push(...(res.data.results || []));

    pageToken = res.data.next_page_token || null;
    if (!pageToken) break;
    await sleep(REQUEST_DELAY);
  }
  return places;
}

// ── Main scrape function ───────────────────────────────────────
/**
 * Run a full scrape with the given options.
 *
 * @param {Object} opts
 * @param {string} opts.query       - Search keyword (e.g. "coaching centres")
 * @param {string} opts.location    - Location string (e.g. "Pune,India")
 * @param {number} opts.radius      - Search radius in metres
 * @param {number} opts.maxResults  - Max rows the user wants (up to 300)
 * @param {function} opts.onProgress - Callback: ({ stage, message, percent, data? })
 *
 * @returns {Promise<Object>} { results, summary, csvPath }
 */
async function runScrape({ query, location, radius, maxResults, onProgress }) {
  const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  const emit = onProgress || (() => {});

  const costs = { nearbySearchCalls: 0, placeDetailsCalls: 0 };

  // ── Step 1: Geocode ────────────────────────────────────────
  emit({ stage: "geocoding", message: `Locating "${location}"...`, percent: 0 });

  const geoRes = await axios.get(GEOCODE_URL, {
    params: { address: location, key: API_KEY },
  });

  if (geoRes.data.status === "REQUEST_DENIED") {
    throw new Error(`API Key Error: ${geoRes.data.error_message || "Request denied. Check your key and enabled APIs."}`);
  }
  if (geoRes.data.status !== "OK" || !geoRes.data.results.length) {
    throw new Error(`Could not find location: "${location}". Try a more specific name.`);
  }

  const { lat, lng } = geoRes.data.results[0].geometry.location;
  const formattedAddress = geoRes.data.results[0].formatted_address;

  emit({
    stage: "geocoding",
    message: `Found: ${formattedAddress} (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
    percent: 5,
  });

  // ── Step 2: Nearby Search (grid-based) ─────────────────────
  const { gridSize, subRadius } = planGrid(maxResults, radius);
  const totalCells = gridSize * gridSize;
  const isMultiArea = totalCells > 1;

  if (isMultiArea) {
    emit({
      stage: "searching",
      message: `Splitting into ${totalCells} sub-areas (${gridSize}×${gridSize} grid, ${subRadius}m sub-radius) for up to ${maxResults} results...`,
      percent: 8,
    });
  } else {
    emit({
      stage: "searching",
      message: `Searching for "${query}" within ${radius / 1000}km...`,
      percent: 10,
    });
  }

  const gridCenters = generateGridCenters(lat, lng, radius, gridSize);
  const allPlaces = [];

  for (let cellIdx = 0; cellIdx < gridCenters.length; cellIdx++) {
    const center = gridCenters[cellIdx];

    if (isMultiArea) {
      emit({
        stage: "searching",
        message: `Searching sub-area ${cellIdx + 1}/${totalCells}...`,
        percent: 8 + Math.round(((cellIdx) / totalCells) * 17),
      });
    }

    const cellPlaces = await nearbySearchAt({
      lat: center.lat,
      lng: center.lng,
      subRadius,
      query,
      apiKey: API_KEY,
      costs,
    });

    allPlaces.push(...cellPlaces);

    const searchPercent = isMultiArea
      ? 8 + Math.round(((cellIdx + 1) / totalCells) * 17)
      : 10 + Math.round(((cellIdx + 1) / totalCells) * 15);

    emit({
      stage: "searching",
      message: isMultiArea
        ? `Sub-area ${cellIdx + 1}/${totalCells} — ${cellPlaces.length} places (running total: ${allPlaces.length})`
        : `Found ${allPlaces.length} places`,
      percent: searchPercent,
    });

    // Small delay between cells to avoid rate-limiting
    if (cellIdx < gridCenters.length - 1) {
      await sleep(REQUEST_DELAY);
    }
  }

  // Deduplicate by place_id
  const seen = new Set();
  const uniquePlaces = allPlaces.filter((p) => {
    if (seen.has(p.place_id)) return false;
    seen.add(p.place_id);
    return true;
  });

  // Cap to the user-requested max
  const placesToFetch = uniquePlaces.slice(0, maxResults);

  if (placesToFetch.length === 0) {
    throw new Error("No results found. Try a different query, larger radius, or different location.");
  }

  emit({
    stage: "searching",
    message: `Found ${uniquePlaces.length} unique places (from ${allPlaces.length} raw). Fetching details for ${placesToFetch.length}...`,
    percent: 25,
  });

  // ── Step 3: Fetch Place Details ────────────────────────────
  const detailedData = [];
  const detailFields = [
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

  for (let i = 0; i < placesToFetch.length; i++) {
    const place = placesToFetch[i];

    try {
      const res = await axios.get(DETAILS_URL, {
        params: { place_id: place.place_id, fields: detailFields, key: API_KEY },
      });
      costs.placeDetailsCalls++;

      if (res.data.status === "OK" && res.data.result) {
        const d = res.data.result;
        detailedData.push({
          name: d.name || "N/A",
          phone: d.formatted_phone_number || "N/A",
          address: d.formatted_address || "N/A",
          website: d.website || "N/A",
          email: "N/A",
          rating: d.rating != null ? d.rating.toFixed(1) : "N/A",
          reviewsCount: d.user_ratings_total != null ? d.user_ratings_total : "N/A",
          currentlyOpen:
            d.opening_hours != null ? (d.opening_hours.open_now ? "Yes" : "No") : "Unknown",
          status: d.business_status || "N/A",
        });
      }
    } catch {
      // skip failed detail fetches silently
    }

    const detailPercent = 25 + Math.round(((i + 1) / placesToFetch.length) * 65);
    emit({
      stage: "details",
      message: `Fetched ${i + 1} / ${placesToFetch.length} place details (${detailedData.length} valid)`,
      percent: detailPercent,
    });

    await sleep(REQUEST_DELAY);
  }

  if (detailedData.length === 0) {
    throw new Error("All detail requests failed. Check your API key and billing status.");
  }

  // ── Step 4: Export CSV ─────────────────────────────────────
  emit({ stage: "exporting", message: "Writing CSV file...", percent: 92 });

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const csvFilename = `scrape_${timestamp}.csv`;
  const csvPath = path.join(__dirname, "exports", csvFilename);

  // Ensure exports dir exists
  const fs = require("fs");
  const exportsDir = path.join(__dirname, "exports");
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

  const csvWriter = createObjectCsvWriter({
    path: csvPath,
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
  await csvWriter.writeRecords(detailedData);

  // ── Step 5: Build summary ─────────────────────────────────
  const billableSearches = Math.max(0, costs.nearbySearchCalls - FREE_SEARCHES);
  const billableDetails = Math.max(0, costs.placeDetailsCalls - FREE_DETAILS);
  const nearbySearchCost = parseFloat((billableSearches * COST_NEARBY_SEARCH).toFixed(4));
  const placeDetailsCost = parseFloat((billableDetails * COST_PLACE_DETAILS).toFixed(4));
  const totalCost = parseFloat((nearbySearchCost + placeDetailsCost).toFixed(4));

  const summary = {
    totalFound: detailedData.length,
    withPhone: detailedData.filter((d) => d.phone !== "N/A").length,
    withWebsite: detailedData.filter((d) => d.website !== "N/A").length,
    avgRating:
      detailedData.length > 0
        ? (detailedData.reduce((s, d) => s + (parseFloat(d.rating) || 0), 0) / detailedData.length).toFixed(2)
        : "0",
    nearbySearchCalls: costs.nearbySearchCalls,
    placeDetailsCalls: costs.placeDetailsCalls,
    nearbySearchCost,
    placeDetailsCost,
    totalCost,
    costPerLead: detailedData.length > 0 ? parseFloat((totalCost / detailedData.length).toFixed(4)) : 0,
    csvFilename,
    gridCells: totalCells,
    rawResults: allPlaces.length,
    uniqueResults: uniquePlaces.length,
  };

  emit({ stage: "done", message: "Scrape complete!", percent: 100, data: summary });

  return { results: detailedData, summary, csvPath, csvFilename };
}

module.exports = { runScrape };
