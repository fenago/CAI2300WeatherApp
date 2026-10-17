// Default location: Miami, FL
const MIAMI = { name: "Miami", admin1: "Florida", latitude: 25.7617, longitude: -80.1918 };

// WMO weather codes -> [description, day icon, night icon]
const WEATHER_CODES = {
  0: ["Clear", "☀️", "🌙"],
  1: ["Mostly Clear", "🌤️", "🌙"],
  2: ["Partly Cloudy", "⛅", "☁️"],
  3: ["Cloudy", "☁️", "☁️"],
  45: ["Fog", "🌫️", "🌫️"],
  48: ["Freezing Fog", "🌫️", "🌫️"],
  51: ["Light Drizzle", "🌦️", "🌧️"],
  53: ["Drizzle", "🌦️", "🌧️"],
  55: ["Heavy Drizzle", "🌧️", "🌧️"],
  56: ["Freezing Drizzle", "🌧️", "🌧️"],
  57: ["Freezing Drizzle", "🌧️", "🌧️"],
  61: ["Light Rain", "🌦️", "🌧️"],
  63: ["Rain", "🌧️", "🌧️"],
  65: ["Heavy Rain", "🌧️", "🌧️"],
  66: ["Freezing Rain", "🌧️", "🌧️"],
  67: ["Freezing Rain", "🌧️", "🌧️"],
  71: ["Light Snow", "🌨️", "🌨️"],
  73: ["Snow", "🌨️", "🌨️"],
  75: ["Heavy Snow", "❄️", "❄️"],
  77: ["Snow Grains", "🌨️", "🌨️"],
  80: ["Showers", "🌦️", "🌧️"],
  81: ["Showers", "🌧️", "🌧️"],
  82: ["Heavy Showers", "⛈️", "⛈️"],
  85: ["Snow Showers", "🌨️", "🌨️"],
  86: ["Snow Showers", "❄️", "❄️"],
  95: ["Thunderstorms", "⛈️", "⛈️"],
  96: ["Thunderstorms & Hail", "⛈️", "⛈️"],
  99: ["Thunderstorms & Hail", "⛈️", "⛈️"],
};

const $ = (id) => document.getElementById(id);
const deg = (n) => `${Math.round(n)}°`;
const describe = (code) => WEATHER_CODES[code] || ["Unknown", "❓", "❓"];
const iconFor = (code, isDay = 1) => describe(code)[isDay ? 1 : 2];

// Open-Meteo returns local times like "2026-10-17T14:00" (already in the city's timezone),
// so format from the string itself instead of letting the browser shift it.
function formatHour(iso) {
  const h = Number(iso.slice(11, 13));
  return `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
}
function formatClock(iso) {
  const h = Number(iso.slice(11, 13));
  return `${h % 12 || 12}:${iso.slice(14, 16)} ${h < 12 ? "AM" : "PM"}`;
}
function weekday(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}
function compass(degrees) {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(degrees / 45) % 8];
}
function uvLabel(uv) {
  if (uv < 3) return "Low";
  if (uv < 6) return "Moderate";
  if (uv < 8) return "High";
  if (uv < 11) return "Very High";
  return "Extreme";
}

/* ---------- Theme ---------- */
const themeControl = $("theme");

function setTheme(value) {
  if (value === "light" || value === "dark") {
    document.documentElement.dataset.theme = value;
  } else {
    value = "system";
    delete document.documentElement.dataset.theme;
  }
  try { localStorage.setItem("theme", value); } catch (e) {}
  themeControl.querySelectorAll("button").forEach((b, i) => {
    const on = b.dataset.value === value;
    b.setAttribute("aria-checked", String(on));
    if (on) themeControl.style.setProperty("--i", i);
  });
}

themeControl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-value]");
  if (btn) setTheme(btn.dataset.value);
});

setTheme(document.documentElement.dataset.theme || "system");

/* ---------- Tabs (Weather / Classifier) ---------- */
const tabs = $("tabs");
const VIEW_TITLES = { weather: null, classifier: "Pre-Flight Checklist · Classifier" };
let weatherTitle = document.title;

function showView() {
  const view = location.hash === "#classifier" ? "classifier" : "weather";
  document.documentElement.dataset.view = view;
  tabs.querySelectorAll("a").forEach((a, i) => {
    const on = a.dataset.value === view;
    if (on) { a.setAttribute("aria-current", "page"); tabs.style.setProperty("--i", i); }
    else a.removeAttribute("aria-current");
  });
  document.title = VIEW_TITLES[view] || weatherTitle;
  document.dispatchEvent(new CustomEvent("viewchange", { detail: view }));
}

window.addEventListener("hashchange", showView);
showView();

/* ---------- Data ---------- */
async function getWeather(place) {
  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,is_day,pressure_msl",
    hourly: "temperature_2m,weather_code,precipitation_probability,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "auto",
    forecast_days: 10,
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
  if (!data.results || data.results.length === 0) throw new Error(`Couldn't find “${name}”.`);
  return data.results[0];
}

/* ---------- Render ---------- */
function renderHero(place, c, d) {
  $("updated").textContent = place.admin1 || place.country || "Current location";
  $("place").textContent = place.name;
  $("temp").textContent = deg(c.temperature_2m);
  $("desc").textContent = describe(c.weather_code)[0];
  $("hilo").textContent = `H:${deg(d.temperature_2m_max[0])}  L:${deg(d.temperature_2m_min[0])}`;
  weatherTitle = `${deg(c.temperature_2m)} ${place.name} · Weather`;
  if (document.documentElement.dataset.view === "weather") document.title = weatherTitle;
}

function renderHourly(c, h) {
  // Start at the current hour
  const nowHour = c.time.slice(0, 13);
  let start = h.time.findIndex((t) => t.slice(0, 13) === nowHour);
  if (start < 0) start = 0;

  const items = [];
  for (let i = start; i < Math.min(start + 24, h.time.length); i++) {
    const pop = h.precipitation_probability?.[i];
    items.push(`<li>
      <span class="h-time">${i === start ? "Now" : formatHour(h.time[i])}</span>
      <span class="h-icon">${iconFor(h.weather_code[i], h.is_day[i])}${pop >= 30 ? `<span class="h-pop">${pop}%</span>` : ""}</span>
      <span>${deg(i === start ? c.temperature_2m : h.temperature_2m[i])}</span>
    </li>`);
  }
  $("hourly").innerHTML = items.join("");
}

function renderDaily(d) {
  const lo = Math.min(...d.temperature_2m_min);
  const hi = Math.max(...d.temperature_2m_max);
  const span = hi - lo || 1;

  $("daily").innerHTML = d.time
    .map((date, i) => {
      const left = ((d.temperature_2m_min[i] - lo) / span) * 100;
      const width = Math.max(((d.temperature_2m_max[i] - d.temperature_2m_min[i]) / span) * 100, 4);
      // Size the gradient to the full track so each bar shows its slice of the week's range
      const bgSize = (100 / width) * 100;
      const bgPos = width >= 100 ? 0 : (left / (100 - width)) * 100;
      const pop = d.precipitation_probability_max?.[i];
      return `<li>
        <span>${i === 0 ? "Today" : weekday(date)}</span>
        <span class="d-icon" title="${describe(d.weather_code[i])[0]}">${iconFor(d.weather_code[i])}${pop >= 30 ? `<span class="d-pop">${pop}%</span>` : ""}</span>
        <span class="d-lo">${deg(d.temperature_2m_min[i])}</span>
        <span class="range"><span style="left:${left}%;width:${width}%;background-size:${bgSize}% 100%;background-position:${bgPos}% 0"></span></span>
        <span class="d-hi">${deg(d.temperature_2m_max[i])}</span>
      </li>`;
    })
    .join("");
}

function tile(icon, title, value, note) {
  return `<article class="glass tile">
    <h3 class="card-title">${icon}${title}</h3>
    <div class="value">${value}</div>
    <p class="note">${note}</p>
  </article>`;
}

const ICONS = {
  feels: '<svg viewBox="0 0 24 24"><path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0Z"/></svg>',
  humidity: '<svg viewBox="0 0 24 24"><path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z"/></svg>',
  wind: '<svg viewBox="0 0 24 24"><path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/></svg>',
  uv: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  sunrise: '<svg viewBox="0 0 24 24"><path d="M17 18a5 5 0 0 0-10 0M12 2v7M4.2 10.2l1.4 1.4M1 18h2M21 18h2M18.4 11.6l1.4-1.4M23 22H1M8 6l4-4 4 4"/></svg>',
  pressure: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m12 12 4-4M12 7v1M7 12h1M16 12h1"/></svg>',
};

function renderTiles(c, d) {
  const feelsDiff = Math.round(c.apparent_temperature - c.temperature_2m);
  const feelsNote =
    feelsDiff >= 3 ? "Humidity is making it feel warmer." :
    feelsDiff <= -3 ? "Wind is making it feel cooler." :
    "Similar to the actual temperature.";
  const uv = Math.round(d.uv_index_max[0]);
  const pressureInHg = (c.pressure_msl * 0.02953).toFixed(2);

  $("tiles").innerHTML = [
    tile(ICONS.feels, "Feels Like", deg(c.apparent_temperature), feelsNote),
    tile(ICONS.humidity, "Humidity", `${c.relative_humidity_2m}%`, `Chance of rain today: ${d.precipitation_probability_max[0] ?? 0}%.`),
    tile(ICONS.wind, "Wind", `${Math.round(c.wind_speed_10m)}<small style="font-size:16px"> mph</small>`, `From the ${compass(c.wind_direction_10m)}.`),
    tile(ICONS.uv, "UV Index", uv, `${uvLabel(uv)} today.`),
    tile(ICONS.sunrise, "Sunrise", formatClock(d.sunrise[0]).replace(/ (AM|PM)/, '<small style="font-size:16px"> $1</small>'), `Sunset: ${formatClock(d.sunset[0])}`),
    tile(ICONS.pressure, "Pressure", `${pressureInHg}<small style="font-size:16px"> inHg</small>`, `${Math.round(c.pressure_msl)} hPa`),
  ].join("");
}

function render(place, data) {
  renderHero(place, data.current, data.daily);
  renderHourly(data.current, data.hourly);
  renderDaily(data.daily);
  renderTiles(data.current, data.daily);
}

/* ---------- Flow ---------- */
function showError(msg) {
  const el = $("error");
  el.textContent = msg || "";
  el.hidden = !msg;
}

async function load(place) {
  document.body.classList.add("loading");
  showError("");
  try {
    render(place, await getWeather(place));
  } catch (err) {
    showError(err.message);
    if ($("temp").textContent === "--°") $("desc").textContent = "Unavailable";
  } finally {
    document.body.classList.remove("loading");
  }
}

$("search").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("city");
  const name = input.value.trim();
  input.blur();
  if (!name) return load(MIAMI);
  try {
    await load(await findCity(name));
    input.value = "";
  } catch (err) {
    showError(err.message);
  }
});

load(MIAMI);
