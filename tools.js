/**
 * The two things the agent can actually do.
 *
 * Both hit free, keyless, CORS-enabled APIs so the whole thing runs from the
 * browser with nothing but an OpenAI key. The previous versions returned
 * hardcoded "New York City" and "72F sunny", which made the loop impossible to
 * judge: a wrong answer and a right answer looked identical.
 *
 * Every function here returns a JSON *string*, because that is what the
 * `tool` role expects as `content`. And every one of them reports its failures
 * as `{ error }` rather than throwing — see the note in agent.js. A thrown
 * error kills the run; a returned one is something the model can read and work
 * around.
 */

/**
 * Open-Meteo reports conditions as WMO codes, which are integers. The model
 * would happily invent a meaning for `3`, so the number never reaches it.
 * https://open-meteo.com/en/docs
 */
const WMO_CODES = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'depositing rime fog',
  51: 'light drizzle',
  53: 'moderate drizzle',
  55: 'dense drizzle',
  56: 'light freezing drizzle',
  57: 'dense freezing drizzle',
  61: 'slight rain',
  63: 'moderate rain',
  65: 'heavy rain',
  66: 'light freezing rain',
  67: 'heavy freezing rain',
  71: 'slight snowfall',
  73: 'moderate snowfall',
  75: 'heavy snowfall',
  77: 'snow grains',
  80: 'slight rain showers',
  81: 'moderate rain showers',
  82: 'violent rain showers',
  85: 'slight snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with slight hail',
  99: 'thunderstorm with heavy hail',
};

/**
 * IP geolocation providers, tried in order.
 *
 * There are three because the free tiers rate-limit by IP and a shared or
 * datacentre address burns through them fast — ipapi.co starts returning 429
 * after a handful of calls from one. One provider means the agent's first step
 * fails and the whole run is wasted; the model retries `getLocation`, gets the
 * same 429, and gives up. Falling through to the next service costs one extra
 * request on a bad day and nothing on a good one.
 *
 * Each `parse` returns null when the payload is not usable, which is treated
 * the same as a failed request: move on to the next provider. All three send
 * `Access-Control-Allow-Origin: *`, so they work from the browser.
 */
const LOCATION_PROVIDERS = [
  {
    name: 'ipwho.is',
    url: 'https://ipwho.is/',
    parse: (data) =>
      data.success === false
        ? null
        : {
            city: data.city,
            region: data.region,
            country: data.country,
            latitude: data.latitude,
            longitude: data.longitude,
            timezone: data.timezone?.id,
          },
  },
  {
    name: 'geojs.io',
    // Reports coordinates as strings, hence the Number() below.
    url: 'https://get.geojs.io/v1/ip/geo.json',
    parse: (data) => ({
      city: data.city,
      region: data.region,
      country: data.country,
      latitude: Number(data.latitude),
      longitude: Number(data.longitude),
      timezone: data.timezone,
    }),
  },
  {
    name: 'ipapi.co',
    url: 'https://ipapi.co/json/',
    // Signals rate limits with HTTP 200 and an `error` field, so a status
    // check alone would let a failure through as a location.
    parse: (data) =>
      data.error
        ? null
        : {
            city: data.city,
            region: data.region,
            country: data.country_name,
            latitude: data.latitude,
            longitude: data.longitude,
            timezone: data.timezone,
          },
  },
];

/**
 * Where the user is, by IP.
 *
 * Returns coordinates as well as the city name, and that is the whole point of
 * the pairing: `getCurrentWeather` needs a latitude and longitude, and this is
 * where the model is meant to get them. Returning only "New York City, NY"
 * would force the model to guess the coordinates from memory.
 *
 * IP geolocation lands on the exit node — a VPN or a hosted runtime will place
 * you wherever that machine is, not where you are.
 */
export async function getLocation() {
  const attempts = [];

  for (const provider of LOCATION_PROVIDERS) {
    try {
      const response = await fetch(provider.url);
      if (!response.ok) {
        attempts.push(`${provider.name}: HTTP ${response.status}`);
        continue;
      }

      const parsed = provider.parse(await response.json());
      // A provider that answers without coordinates is useless here, since the
      // only consumer is a weather lookup that needs them.
      if (!parsed || !Number.isFinite(parsed.latitude) || !Number.isFinite(parsed.longitude)) {
        attempts.push(`${provider.name}: no usable coordinates`);
        continue;
      }

      return JSON.stringify({ ...parsed, source: provider.name });
    } catch (err) {
      attempts.push(`${provider.name}: ${err.message}`);
    }
  }

  return JSON.stringify({ error: `All location providers failed — ${attempts.join('; ')}` });
}

/**
 * Current conditions at a coordinate.
 *
 * Takes latitude and longitude rather than a place name because that is what
 * Open-Meteo's forecast endpoint takes, and because it forces the interesting
 * half of the loop: the model has to call `getLocation` first and feed its
 * result in here. A tool that took no arguments at all — as this one used to —
 * never exercises argument passing, which is the part of function calling that
 * actually breaks.
 */
export async function getCurrentWeather({ latitude, longitude, unit = 'fahrenheit' }) {
  const lat = Number(latitude);
  const lon = Number(longitude);

  // The model supplies these, so they are untrusted input. Handing
  // `latitude=undefined` to Open-Meteo returns a 400 whose body says nothing
  // useful; this says exactly what to do about it instead.
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return JSON.stringify({
      error: 'latitude and longitude must be numbers. Call getLocation first to obtain them.',
    });
  }

  const temperatureUnit = unit === 'celsius' ? 'celsius' : 'fahrenheit';

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('current', 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation');
  url.searchParams.set('temperature_unit', temperatureUnit);
  url.searchParams.set('wind_speed_unit', temperatureUnit === 'celsius' ? 'kmh' : 'mph');
  url.searchParams.set('timezone', 'auto');

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return JSON.stringify({ error: `open-meteo.com returned HTTP ${response.status}` });
    }

    const data = await response.json();
    const current = data.current;
    if (!current) {
      return JSON.stringify({ error: 'open-meteo.com returned no current conditions' });
    }

    return JSON.stringify({
      temperature: current.temperature_2m,
      feelsLike: current.apparent_temperature,
      unit: temperatureUnit === 'celsius' ? 'C' : 'F',
      forecast: WMO_CODES[current.weather_code] ?? `unknown conditions (WMO code ${current.weather_code})`,
      windSpeed: current.wind_speed_10m,
      windUnit: temperatureUnit === 'celsius' ? 'km/h' : 'mph',
      precipitation: current.precipitation,
      localTime: current.time,
    });
  } catch (err) {
    return JSON.stringify({ error: `Weather lookup failed: ${err.message}` });
  }
}

/**
 * What the model is shown.
 *
 * This is the `tools` shape — `{ type, function }` — and it belongs to the
 * `tools` request parameter. It was previously being passed as `functions`,
 * the deprecated parameter, which expects the bare `{ name, description,
 * parameters }` object instead. The API accepted the request and silently
 * exposed nothing, so the model answered every question from memory.
 */
export const tools = [
  {
    type: 'function',
    function: {
      name: 'getLocation',
      description:
        "Get the user's current city, region, country and coordinates, based on their IP address. Takes no arguments.",
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getCurrentWeather',
      description:
        'Get the current weather at a coordinate. Requires latitude and longitude — call getLocation first if you do not have them.',
      parameters: {
        type: 'object',
        properties: {
          latitude: {
            type: 'number',
            description: 'Latitude in decimal degrees, e.g. 40.7128',
          },
          longitude: {
            type: 'number',
            description: 'Longitude in decimal degrees, e.g. -74.0060',
          },
          unit: {
            type: 'string',
            enum: ['fahrenheit', 'celsius'],
            description: 'Temperature unit. Defaults to fahrenheit.',
          },
        },
        required: ['latitude', 'longitude'],
        additionalProperties: false,
      },
    },
  },
];

/**
 * Name -> implementation. The lookup the loop uses to turn a `tool_call` back
 * into a real function. Keys must match `tools[].function.name` exactly.
 */
export const availableFunctions = {
  getLocation,
  getCurrentWeather,
};
