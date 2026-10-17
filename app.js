// Default location: Miami, FL
const MIAMI = { name: "Miami", admin1: "Florida", latitude: 25.7617, longitude: -80.1918 };

// WMO weather codes -> description + emoji
const WEATHER_CODES = {
  0: ["Clear sky", "☀️"],
  1: ["Mainly clear", "🌤️"],
  2: ["Partly cloudy", "⛅"],
  3: ["Overcast", "☁️"],
  45: ["Fog", "🌫️"],
  48: ["Rime fog", "🌫️"],
  51: ["Light drizzle", "🌦️"],
  53: ["Drizzle", "🌦️"],
  55: ["Heavy drizzle", "🌧️"],
  56: ["Freezing drizzle", "🌧️"],
  57: ["Freezing drizzle", "🌧️"],
  61: ["Light rain", "🌦️"],
  63: ["Rain", "🌧️"],
  65: ["Heavy rain", "🌧️"],
  66: ["Freezing rain", "🌧️"],
  67: ["Freezing rain", "🌧️"],
  71: ["Light snow", "🌨️"],
  73: ["Snow", "🌨️"],
  75: ["Heavy snow", "❄️"],
  77: ["Snow grains", "🌨️"],
  80: ["Rain showers", "🌦️"],
  81: ["Rain showers", "🌧️"],
  82: ["Violent rain showers", "⛈️"],
  85: ["Snow showers", "🌨️"],
  86: ["Snow showers", "❄️"],
  95: ["Thunderstorm", "⛈️"],
  96: ["Thunderstorm with hail", "⛈️"],
  99: ["Thunderstorm with hail", "⛈️"],
};

const $ = (id) => document.getElementById(id);
const describe = (code) => WEATHER_CODES[code] || ["Unknown", "❓"];

async function getWeather(place) {
  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "auto",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Weather request failed (${res.status})`);
  return res.json();
}

async function findCity(name) {
  const params = new URLSearchParams({ name, count: 1, language: "en", format: "json" });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  if (!res.ok) throw new Error(`City search failed (${res.status})`);
  const data = await res.json();
  if (!data.results || data.results.length === 0) throw new Error(`Couldn't find "${name}"`);
  return data.results[0];
}

function render(place, data) {
  const c = data.current;
  const [desc, icon] = describe(c.weather_code);

  $("place").textContent = [place.name, place.admin1 || place.country].filter(Boolean).join(", ");
  $("icon").textContent = icon;
  $("temp").textContent = `${Math.round(c.temperature_2m)}°`;
  $("desc").textContent = desc;
  $("feels").textContent = `${Math.round(c.apparent_temperature)}°`;
  $("humidity").textContent = `${c.relative_humidity_2m}%`;
  $("wind").textContent = `${Math.round(c.wind_speed_10m)} mph`;

  const d = data.daily;
  $("forecast").innerHTML = d.time
    .map((date, i) => {
      // Parse as local date so the weekday doesn't shift by timezone
      const day = i === 0 ? "Today" : new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
      const [fDesc, fIcon] = describe(d.weather_code[i]);
      return `<li>
        <span>${day}</span>
        <span class="f-icon" title="${fDesc}">${fIcon}</span>
        <span class="f-temps"><strong>${Math.round(d.temperature_2m_max[i])}°</strong><span class="lo">${Math.round(d.temperature_2m_min[i])}°</span></span>
      </li>`;
    })
    .join("");
}

async function load(place) {
  $("desc").textContent = "Loading…";
  try {
    render(place, await getWeather(place));
  } catch (err) {
    $("desc").textContent = err.message;
  }
}

$("search").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("city").value.trim();
  if (!name) return load(MIAMI);
  try {
    load(await findCity(name));
  } catch (err) {
    $("desc").textContent = err.message;
  }
});

load(MIAMI);
