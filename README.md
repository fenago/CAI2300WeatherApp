# CAI2300WeatherApp

Dead-simple weather app. Defaults to Miami, FL. Uses the free [Open-Meteo](https://open-meteo.com/) API — no API key, no signup.

- Apple-style glass UI with System / Light / Dark theme switcher (choice is remembered)
- Current conditions, 24-hour forecast, 10-day forecast with temperature range bars
- Detail tiles: feels like, humidity, wind, UV index, sunrise/sunset, pressure (°F / mph)
- Search any city (Open-Meteo geocoding); empty search goes back to Miami

## Run locally

Plain HTML/CSS/JS, no build step. Open `index.html` in a browser, or:

```
python3 -m http.server 8000
```

## Deploy to Netlify

1. In Netlify: **Add new site → Import an existing project → GitHub** and pick this repo.
2. Branch: `main`. Build command: leave empty. Publish directory: `.` (already set in `netlify.toml`).
3. Deploy. Every push to `main` redeploys automatically.
