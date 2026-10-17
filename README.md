# CAI2300WeatherApp

Two tabs, one static site: a Miami-first weather app and an in-browser text classifier for NLP Chapter 3. No build step, no API keys, no server.

## Weather tab

Defaults to Miami, FL. Uses the free [Open-Meteo](https://open-meteo.com/) API (no API key, no signup).

- Apple-style glass UI with System / Light / Dark theme switcher (choice is remembered)
- Current conditions, 24-hour forecast, 10-day forecast with temperature range bars
- Detail tiles: feels like, humidity, wind, UV index, sunrise/sunset, pressure (°F / mph)
- Search any city (Open-Meteo geocoding); empty search goes back to Miami

## Classifier tab: Pre-Flight Checklist (`#classifier`)

The 18-step exercise from *NLP Chapter 3, Part 2*, from a raw CSV to a trained, graded TF-IDF + logistic regression classifier, running entirely in the browser.

- **Built-in datasets:** A IMDB reviews, B SMS spam, C Yelp, D Amazon, the airline-tweets class demo, and the bonus IMDB sentences, each with its `# <-- CHANGE THIS` settings filled in.
- **Bring your own:** add any CSV/TSV/TXT by URL or file upload. Preview it, pick the text and label columns, map number labels to words, and choose the two labels to KEEP. Saved in your browser (uploads go in IndexedDB).
- **Every step shows its output** plus the exercise's ✅ Check question with an auto-read answer: label counts, duplicates, before/after cleaning, the confusion matrix, the classification report, the lazy-guess baseline, top weighted words, and misclassified examples.
- **Live playgrounds:** Step 9 cleans whatever you type; Step 17 lets you write sentences, mark the label you expect, and see which ones fool the model.
- **Step 18** runs automatically for datasets with 3+ labels.
- **Export:** each step's Python cell (with your changes highlighted), "Copy code", or download a ready-to-run Colab notebook, `PreFlight_YourName.ipynb`.
- **Teachable errors:** a misspelled KEEP label or wrong column name stops at the right step and explains the fix.

### How faithful is it to the Python version?

Checked against pandas 3, NLTK 3.10 and scikit-learn 1.9 on the course datasets:

- Steps 2–11 match pandas row for row (same NaN rules, duplicates, label counts).
- The cleaning function and Porter stemmer match NLTK on all 58,582 distinct words in the datasets.
- TF-IDF vocabulary and IDF weights match `TfidfVectorizer` exactly. Logistic regression uses the same objective as sklearn (L2, C=1) and converges at least as tightly.
- Steps 12–13 shuffle with a different random generator than NumPy, so accuracy can differ from Colab by a point or two.

Files: `classifier-core.js` (engine), `classifier-worker.js` (runs the pipeline in a Web Worker), `classifier.js` + `classifier.css` (UI).

## Run locally

Plain HTML/CSS/JS. The classifier uses a Web Worker, so serve the folder rather than opening the file directly:

```
python3 -m http.server 8000
```

Then open http://localhost:8000 (or http://localhost:8000/#classifier).

## Deploy to Netlify

1. In Netlify: **Add new site → Import an existing project → GitHub** and pick this repo.
2. Branch: `main`. Build command: leave empty. Publish directory: `.` (already set in `netlify.toml`).
3. Deploy. Every push to `main` redeploys automatically.
