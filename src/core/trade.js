'use strict';

// Builds official PoE2 trade-site searches from an item + the stats you choose.
// Pure functions only; the network calls live in src/features (search, results, budget, worth).
// The functions themselves are in src/core/trade/; this file gathers them.
//
// Trade data endpoints (public, no login):
//   GET  https://www.pathofexile.com/api/trade2/data/stats
//   GET  https://www.pathofexile.com/api/trade2/data/filters
//   GET  https://www.pathofexile.com/api/trade2/data/leagues
//   POST https://www.pathofexile.com/api/trade2/search/poe2/<league>  -> { id }
//   results page: https://www.pathofexile.com/trade2/search/poe2/<league>/<id>

const { norm } = require('./statnorm');
const { BASE, STATUSES, statusOpt, EQUIPMENT_FILTERS, buildStatIndex, matchStat, localFor, LOWER_BETTER, categoryFor } = require('./trade/stats');
const { buildQuery, buildUpgradeQuery, buildGearQuery, GEAR_SEARCH_SIZES } = require('./trade/queries');
const { CURRENCIES, statSources, baseWithoutSockets, RELAX, buildSimilarQuery, buildCraftQuery } = require('./trade/similar');
const { priceFilter, applyBudget, budgetLabel } = require('./trade/budget');
const { apiUrl, pageUrl, searchUrl, fetchUrl, resultsUrl, prefilledUrl, isTradePage, adaptQuery } = require('./trade/urls');
module.exports = {
  BASE, EQUIPMENT_FILTERS, localFor, LOWER_BETTER, CURRENCIES, priceFilter, applyBudget, budgetLabel, norm, buildStatIndex, matchStat, categoryFor, buildQuery, buildUpgradeQuery, buildGearQuery, GEAR_SEARCH_SIZES, buildSimilarQuery, buildCraftQuery, statSources, baseWithoutSockets, RELAX, STATUSES, statusOpt,
  searchUrl, resultsUrl, prefilledUrl, fetchUrl, apiUrl, pageUrl, isTradePage, adaptQuery,
};
