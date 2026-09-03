/* ReefWatch AR — live marine data

   Sea surface temperature from the Open-Meteo Marine API.
   Free, no API key, no sign-up.

   Data is licensed CC BY 4.0 and must be credited to Open-Meteo
   and the German Weather Service (DWD). That attribution appears
   in the app's credits panel, in CREDITS.md and in the report. */

(function (global) {
  'use strict';

  const ENDPOINT = 'https://marine-api.open-meteo.com/v1/marine';

  /* Sri Lankan reef sites. Pigeon Island is the default because it
     is a marine national park with documented bleaching history. */
  const SITES = {
    pigeon: {
      name: 'Pigeon Island, Trincomalee',
      lat: 8.72,
      lon: 81.21,
      fallback: 28.4        // long-term August mean, used when offline
    },
    hikkaduwa: {
      name: 'Hikkaduwa',
      lat: 6.14,
      lon: 80.10,
      fallback: 28.1
    },
    kalpitiya: {
      name: 'Bar Reef, Kalpitiya',
      lat: 8.20,
      lon: 79.70,
      fallback: 28.6
    }
  };

  const CACHE_KEY = 'reefwatch:sst';
  const CACHE_MAX_AGE = 3 * 60 * 60 * 1000;   // three hours
  const TIMEOUT = 8000;

  /* A reading is kept so the app still shows something sensible
     when the network is unavailable — during a demo on a weak
     connection, for instance. */

  function readCache (key) {
    try {
      const raw = global.localStorage.getItem(CACHE_KEY + ':' + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.at > CACHE_MAX_AGE) return null;
      return entry;
    } catch (err) {
      return null;   // private browsing, quota, or corrupt entry
    }
  }

  function writeCache (key, celsius) {
    try {
      global.localStorage.setItem(
        CACHE_KEY + ':' + key,
        JSON.stringify({ celsius: celsius, at: Date.now() })
      );
    } catch (err) {
      /* Non-fatal: the app works fine without a cache. */
    }
  }

  function buildUrl (site) {
    const params = new URLSearchParams({
      latitude: site.lat,
      longitude: site.lon,
      current: 'sea_surface_temperature',
      // Coastal coordinates can land on a land cell; this asks the
      // API to prefer a sea cell instead.
      cell_selection: 'sea'
    });
    return ENDPOINT + '?' + params.toString();
  }

  function fetchWithTimeout (url) {
    // AbortController so a hanging request cannot stall the UI.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);

    return fetch(url, { signal: controller.signal })
      .then((res) => {
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .catch((err) => {
        clearTimeout(timer);
        throw err;
      });
  }

  function load (siteKey) {
    const key  = siteKey && SITES[siteKey] ? siteKey : 'pigeon';
    const site = SITES[key];

    return fetchWithTimeout(buildUrl(site))
      .then((data) => {
        const celsius = data && data.current && data.current.sea_surface_temperature;

        if (typeof celsius !== 'number' || isNaN(celsius)) {
          throw new Error('No sea_surface_temperature in response');
        }

        writeCache(key, celsius);

        return {
          site: site.name,
          key: key,
          celsius: celsius,
          observed: data.current.time || null,
          cached: false,
          offline: false
        };
      })
      .catch((err) => {
        // Degrade in two steps: a recent cached reading first, then
        // the site's climatological mean. The app never breaks and
        // always says which it is using.
        const cached = readCache(key);

        return {
          site: site.name,
          key: key,
          celsius: cached ? cached.celsius : site.fallback,
          observed: null,
          cached: !!cached,
          offline: true,
          reason: (err && err.message) || 'request failed'
        };
      });
  }

  global.ReefAPI = {
    load: load,
    sites: SITES,
    attribution: 'Marine data from Open-Meteo, generated using data from ' +
                 'the German Weather Service (DWD), CC BY 4.0.'
  };

})(window);
