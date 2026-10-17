// Classifier tab: dataset picker, the "# <-- CHANGE THIS" settings, the 18 step cards,
// Python/notebook export, and the add-your-own-dataset dialog.
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Number(n).toLocaleString("en-US");
  const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /* ---------- Datasets ---------- */
  const BIN = { 0: "negative", 1: "positive" };
  const GH = "https://raw.githubusercontent.com/YahuiZhou3275/Text-Sentiment-Analysis-in-NLP/main/";
  const DEFAULT_TEST = "I didn't love it, and the <br /> food wasn't great https://t.co/abc";

  const PRESETS = [
    {
      id: "imdb", kind: "preset", badge: "A", name: "IMDB Movie Reviews", meta: "50,000 full reviews · positive / negative",
      note: "Already balanced. A 66 MB download, so Step 2 samples 10,000 reviews to keep it quick.", expectedRows: 50000,
      url: "https://raw.githubusercontent.com/Ankit152/IMDB-sentiment-analysis/master/IMDB-Dataset.csv",
      sep: ",", header: true, textCol: "review", labelCol: "sentiment", keep: ["negative", "positive"], sample: 10000,
      sentences: [
        ["An absolute masterpiece with brilliant acting and a moving story", "positive"],
        ["A boring, predictable waste of two hours", "negative"],
        ["This movie was not good at all", "negative"],
        ["I expected to hate it, but honestly it was not bad", "positive"],
      ],
    },
    {
      id: "sms", kind: "preset", badge: "B", name: "SMS Spam Collection", meta: "5,572 text messages · ham / spam",
      note: "Not sentiment at all: spam detection. Same machine, different labels.", expectedRows: 5572,
      url: "https://raw.githubusercontent.com/justmarkham/pycon-2016-tutorial/master/data/sms.tsv",
      sep: "\t", header: false, names: ["label", "message"], textCol: "message", labelCol: "label", keep: ["ham", "spam"],
      sentences: [
        ["Hey, are we still meeting for lunch tomorrow?", "ham"],
        ["WINNER!! Claim your FREE prize now, text WIN to 80086", "spam"],
        ["I'm not free tonight, I'll call you later", "ham"],
        ["Congrats on the new job! Your prize is a free dinner on me", "ham"],
      ],
    },
    {
      id: "yelp", kind: "preset", badge: "C", name: "Yelp Restaurant Reviews", meta: "1,000 sentences · 1 positive / 0 negative",
      note: "Only 1,000 sentences, so accuracy jumps around more than with a big dataset.", expectedRows: 1000,
      url: GH + "yelp_labelled.txt", sep: "\t", header: false, names: ["sentence", "label"], ignoreQuotes: true,
      textCol: "sentence", labelCol: "label", labelMap: BIN, keep: ["negative", "positive"],
      sentences: [
        ["The food was delicious and the staff were so friendly", "positive"],
        ["Cold food and terrible service", "negative"],
        ["The pasta was not good", "negative"],
        ["I wanted to love this place, but no", "negative"],
      ],
    },
    {
      id: "amazon", kind: "preset", badge: "D", name: "Amazon Cell Phone Reviews", meta: "1,000 sentences · 1 positive / 0 negative",
      note: "Same format as Yelp; only the URL differs.", expectedRows: 1000,
      url: GH + "amazon_cells_labelled.txt", sep: "\t", header: false, names: ["sentence", "label"], ignoreQuotes: true,
      textCol: "sentence", labelCol: "label", labelMap: BIN, keep: ["negative", "positive"],
      sentences: [
        ["Great phone, the battery lasts all day", "positive"],
        ["Broke after a week, total junk", "negative"],
        ["The sound quality is not great", "negative"],
        ["Works great... for about five minutes", "negative"],
      ],
    },
    {
      id: "airline", kind: "demo", badge: "✈", name: "Twitter US Airline Sentiment", meta: "14,640 tweets · negative / neutral / positive",
      note: "The class demo. It has three labels, so Step 18 runs too.", expectedRows: 14640,
      url: "https://raw.githubusercontent.com/satyajeetkrjha/kaggle-Twitter-US-Airline-Sentiment-/master/Tweets.csv",
      sep: ",", header: true, textCol: "text", labelCol: "airline_sentiment", keep: ["negative", "positive"],
      sentences: [
        ["@united thanks for the smooth flight and the friendly crew", "positive"],
        ["My flight was delayed 3 hours and now my bag is lost", "negative"],
        ["The service was not good", "negative"],
        ["Great, another cancelled flight. Just perfect.", "negative"],
      ],
    },
    {
      id: "imdbs", kind: "bonus", badge: "★", name: "IMDB Review Sentences", meta: "1,000 sentences · 1 positive / 0 negative",
      note: "Bonus dataset, same format as Yelp and Amazon.", expectedRows: 1000,
      url: GH + "imdb_labelled.txt", sep: "\t", header: false, names: ["sentence", "label"], ignoreQuotes: true,
      textCol: "sentence", labelCol: "label", labelMap: BIN, keep: ["negative", "positive"],
      sentences: [
        ["One of the best films I have ever seen", "positive"],
        ["The plot made no sense and the acting was awful", "negative"],
        ["The ending was not satisfying", "negative"],
        ["So bad it's actually good", "positive"],
      ],
    },
  ];

  const genericSentences = (keep) => [
    ["Write a sentence that fits your dataset", keep[0] || ""],
    ["Write one that should clearly be the other label", keep[1] || ""],
    ["Write one with the word not in it", ""],
    ["Write one that tries to trick the model", ""],
  ];

  /* ---------- Persistence ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } },
  };

  // Uploaded files can be large, so their text lives in IndexedDB rather than localStorage
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open("preflight", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("files");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function idb(mode, fn) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("files", mode);
      const req = fn(tx.objectStore("files"));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  }
  const idbGet = (id) => idb("readonly", (s) => s.get(id));
  const idbPut = (id, v) => idb("readwrite", (s) => s.put(v, id));
  const idbDel = (id) => idb("readwrite", (s) => s.delete(id));

  let customs = store.get("clf.datasets", []);
  let overrides = store.get("clf.overrides", {});
  let selectedId = store.get("clf.selected", "yelp");

  const allDatasets = () => PRESETS.concat(customs);
  const getDs = (id) => allDatasets().find((d) => d.id === id) || PRESETS[2];

  function defaults(ds) {
    return {
      textCol: ds.textCol, labelCol: ds.labelCol, labelMap: ds.labelMap || null, keep: ds.keep.slice(), sample: ds.sample || null,
      testSize: 0.3, seed: 42, ngramMax: 2, minDf: 2, C: 1, maxIter: 1000, balance: true, keepNegations: true,
      testSentence: DEFAULT_TEST, sentences: (ds.sentences || genericSentences(ds.keep)).map((x) => x.slice()),
    };
  }
  const settingsFor = (ds) => ({ ...defaults(ds), ...(overrides[ds.id] || {}) });
  let settings = settingsFor(getDs(selectedId));

  function saveSettings() {
    overrides[selectedId] = settings;
    store.set("clf.overrides", overrides);
  }

  /* ---------- Settings form ---------- */
  const mapToText = (m) => (m ? Object.entries(m).map(([k, v]) => `${k}=${v}`).join(", ") : "");
  function textToMap(t) {
    const out = {};
    for (const part of t.split(",")) {
      const m = part.split(/[=:]/);
      if (m.length === 2 && m[0].trim() && m[1].trim()) out[m[0].trim().toLowerCase()] = m[1].trim();
    }
    return Object.keys(out).length ? out : null;
  }
  const splitList = (t) => t.split(",").map((x) => x.trim()).filter(Boolean);
  const numOr = (v, d) => (v === "" || !Number.isFinite(Number(v)) ? d : Number(v));

  function fillForm() {
    const s = settings;
    $("set-text").value = s.textCol;
    $("set-label").value = s.labelCol;
    $("set-map").value = mapToText(s.labelMap);
    $("set-keep").value = s.keep.join(", ");
    $("set-sample").value = s.sample || "";
    $("set-test").value = String(s.testSize);
    $("set-seed").value = s.seed;
    $("set-ngram").value = String(s.ngramMax);
    $("set-mindf").value = s.minDf;
    $("set-c").value = s.C;
    $("set-iter").value = s.maxIter;
    $("set-balance").checked = s.balance;
    $("set-neg").checked = s.keepNegations;
  }

  function readForm() {
    Object.assign(settings, {
      textCol: $("set-text").value.trim(),
      labelCol: $("set-label").value.trim(),
      labelMap: textToMap($("set-map").value),
      keep: splitList($("set-keep").value).map((k) => k.toLowerCase()),
      sample: $("set-sample").value ? Math.max(1, Math.floor(Number($("set-sample").value))) : null,
      testSize: Number($("set-test").value),
      seed: Math.floor(numOr($("set-seed").value, 42)),
      ngramMax: Number($("set-ngram").value),
      minDf: Math.max(1, Math.floor(numOr($("set-mindf").value, 2))),
      C: Math.max(0.0001, numOr($("set-c").value, 1)),
      maxIter: Math.max(1, Math.floor(numOr($("set-iter").value, 1000))),
      balance: $("set-balance").checked,
      keepNegations: $("set-neg").checked,
    });
  }

  /* ---------- Python code for each cell ---------- */
  const pq = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  const pdq = (s) => JSON.stringify(String(s));
  const pyList = (a) => `[${a.map(pq).join(", ")}]`;
  const pyDict = (o) => `{${Object.entries(o).map(([k, v]) => `${pq(k)}: ${pq(v)}`).join(", ")}}`;
  const CHG = "# <-- CHANGE THIS";

  function readCsvCall(ds) {
    const args = ["url"];
    const sep = ds.sep && ds.sep !== "auto" ? ds.sep : ",";
    if (sep !== ",") args.push(`sep=${sep === "\t" ? "'\\t'" : pq(sep)}`);
    if (ds.header === false) {
      args.push("header=None");
      if (ds.names && ds.names.length) args.push(`names=${pyList(ds.names)}`);
    }
    if (ds.ignoreQuotes) args.push("quoting=3");
    return `pd.read_csv(${args.join(", ")})`;
  }

  const STEPS = [
    {
      n: 1, title: "Lay out the tools", check: "No errors? If Colab restarts later, rerun this cell first.",
      code: () => `# ===== STEP 1: LAY OUT THE TOOLS =====
import re                                                    # regular expressions: find-and-replace patterns in text
import pandas as pd                                          # pandas: tables of data (DataFrames)
import nltk                                                  # NLTK: the Natural Language Toolkit
nltk.download('stopwords')                                   # download the stopword list (once per Colab session)
from nltk.corpus import stopwords                            # the list of filler words ("the", "is", "and"...)
from nltk.stem.porter import PorterStemmer                   # chops words down to their roots
from sklearn.model_selection import train_test_split         # splits data into practice (train) and final exam (test)
from sklearn.pipeline import Pipeline                        # the assembly line: vectorizer + model in one object
from sklearn.feature_extraction.text import TfidfVectorizer  # turns text into TF-IDF numbers
from sklearn.linear_model import LogisticRegression          # our classifier: the tug-of-war
from sklearn import metrics                                  # the report card: confusion matrix, precision, recall`,
      render: (d) => table(["Python", "In this browser"], d.tools.map(([a, b]) => [`<code>${esc(a)}</code>`, esc(b)]), { raw: true }),
      answer: () => "No errors. Every tool loaded.",
    },
    {
      n: 2, title: "Load the data", check: "Does the row count look right for your dataset?",
      code: (s, ds) => {
        const urlLine = ds.source === "file"
          ? `url = ${pdq(ds.fileName || "your_file.csv")}     ${CHG} (uploaded through Colab's Files panel)`
          : `url = ${pdq(ds.url)}     ${CHG} (copy from your dataset's settings above)`;
        const lines = ["# ===== STEP 2: LOAD THE DATA =====", urlLine,
          `raw = ${readCsvCall(ds)}                    ${CHG} (add sep / header / names / quoting if your dataset needs them)`];
        if (s.sample) lines.push(`raw = raw.sample(n=${s.sample}, random_state=42)   ${CHG}: a random sample, to keep cleaning fast`);
        lines.push('print("Rows, columns:", raw.shape)        # (number of rows, number of columns)');
        return lines.join("\n");
      },
      sub: (d) => `${fmt(d.rows)} rows × ${d.cols} columns`,
      render: (d) => kv([
        ["Rows", fmt(d.rows)], ["Columns", d.cols],
        ...(d.sampled ? [["Sampled from", fmt(d.originalRows)]] : []),
        ["Separator", d.sep === "\t" ? "tab" : d.sep === "," ? "comma" : `"${esc(d.sep)}"`],
        ["File size", `${d.mb.toFixed(d.mb < 1 ? 2 : 1)} MB`],
      ]),
      answer: (d, s, ds) => {
        let a = `pandas read ${fmt(d.originalRows)} rows`;
        if (ds.expectedRows) a += d.originalRows === ds.expectedRows ? `, which matches the expected ${fmt(ds.expectedRows)}.` : `, but this dataset should have ${fmt(ds.expectedRows)}. Check the separator and quoting settings.`;
        else a += ".";
        if (d.sampled) a += ` Then it took a random sample of ${fmt(d.sampled)} rows. Say so in a text cell.`;
        return a;
      },
    },
    {
      n: 3, title: "Look before you touch", check: "Which column holds the text? Which holds the answer?",
      code: () => `# ===== STEP 3: LOOK BEFORE YOU TOUCH =====
print(raw.columns.tolist())       # every column name, so you can spot the text column and the label column
raw.head(3)                       # the first 3 rows: read them with your own eyes`,
      sub: (d) => d.columns.length > 4 ? `${d.columns.length} columns` : d.columns.join(", "),
      render: (d) => `<div class="chips">${d.columns.map((c) => `<span class="chip mono">${esc(c)}</span>`).join("")}</div>${table(d.columns, d.head)}`,
      answer: (d, s) => {
        const okT = d.columns.includes(s.textCol), okL = d.columns.includes(s.labelCol);
        if (okT && okL) return `The words are in <code>${esc(s.textCol)}</code>; the answer key is <code>${esc(s.labelCol)}</code>.`;
        return `Your Step 4 settings name a column that isn't here. Pick from: ${d.columns.map((c) => `<code>${esc(c)}</code>`).join(", ")}.`;
      },
    },
    {
      n: 4, title: "Name your two columns", check: "Two columns, named text and label?",
      code: (s) => `# ===== STEP 4: NAME YOUR TWO COLUMNS =====
TEXT_COL  = ${pq(s.textCol)}                ${CHG}: the column that holds the words
LABEL_COL = ${pq(s.labelCol)}               ${CHG}: the column that holds the answer key

df = raw[[TEXT_COL, LABEL_COL]].copy()   # keep just those two columns; .copy() makes an independent table
df.columns = ['text', 'label']           # rename them, so every step below works for ANY dataset
df.head()`,
      render: (d) => table(["text", "label"], d.head),
      answer: () => "Yes: <code>text</code> and <code>label</code>. Every step below works the same for any dataset.",
    },
    {
      n: 5, title: "Remove missing values", check: "How many rows were missing something?",
      code: () => `# ===== STEP 5: REMOVE MISSING VALUES =====
print("Missing values per column:")
print(df.isnull().sum())          # count the empty cells in each column

df = df.dropna()                  # drop every row where the text OR the label is missing
print("Rows now:", len(df))`,
      sub: (d) => `${fmt(d.rows)} rows`,
      render: (d) => kv([["Missing text", fmt(d.missing.text)], ["Missing label", fmt(d.missing.label)], ["Rows now", fmt(d.rows)]]),
      answer: (d) => d.dropped ? `${fmt(d.dropped)} row${d.dropped === 1 ? " was" : "s were"} missing a text or a label, and dropna() removed ${d.dropped === 1 ? "it" : "them"}.` : "None. Every row has both a text and a label.",
    },
    {
      n: 6, title: "Make sure the text is text, and not blank",
      note: "Blank texts give the model nothing to learn from, so they go.",
      code: () => `# ===== STEP 6: MAKE SURE THE TEXT IS TEXT, AND NOT BLANK =====
df['text'] = df['text'].astype(str)          # force every value to be a string
df = df[df['text'].str.strip() != '']        # drop rows that are only spaces
print("Rows now:", len(df))`,
      sub: (d) => `${fmt(d.rows)} rows`,
      render: (d) => kv([["Blank rows dropped", fmt(d.dropped)], ["Rows now", fmt(d.rows)]]),
    },
    {
      n: 7, title: "Remove duplicate texts", check: "How many duplicates did your dataset have? Any surprise?",
      code: () => `# ===== STEP 7: REMOVE DUPLICATE TEXTS =====
# A duplicate can land in BOTH the practice set and the final exam: that's peeking at the answers.
print("Duplicate texts found:", df.duplicated(subset='text').sum())

df = df.drop_duplicates(subset='text')       # keep the first copy of each identical text, drop the rest
print("Rows now:", len(df))`,
      sub: (d) => `${fmt(d.dupes)} duplicates`,
      render: (d) => kv([["Duplicates found", fmt(d.dupes)], ["Rows now", fmt(d.rows)]]) +
        (d.examples.length ? `<div class="muted" style="font-size:13px">Examples of repeated texts:</div><ul class="mistakes">${d.examples.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""),
      answer: (d) => {
        const share = d.dupes / (d.rows + d.dupes);
        if (!d.dupes) return "No duplicates at all.";
        return `${fmt(d.dupes)} duplicates (${pct(share)} of rows). ${share > 0.03 ? "That's a lot. The same message gets sent over and over (spam blasts, retweets, copy-pasted reviews), and each copy could leak from practice into the exam." : "A handful, but each one could have leaked an answer from practice into the exam."}`;
      },
    },
    {
      n: 8, title: "Tidy the labels", check: "Which label is the biggest? Is the data balanced already?",
      code: (s) => `# ===== STEP 8: TIDY THE LABELS =====
df['label'] = (df['label'].astype(str)       # labels as strings (0/1 labels become '0'/'1')
                          .str.strip()       # remove stray spaces
                          .str.lower())      # one spelling: 'Positive' and 'positive' become the same label
${s.labelMap ? `df['label'] = df['label'].map(${pyDict(s.labelMap)})  ${CHG}: turn the number labels into words` : `# Yelp or Amazon only: paste the .map line from your dataset's settings here  ${CHG} if needed`}
print(df['label'].value_counts())            # how many rows of each answer?`,
      sub: (d) => d.counts.map(([l, c]) => `${l} ${fmt(c)}`).join(" · "),
      render: (d) => bars(d.counts) + (d.unmapped ? `<div class="err-box"><strong>${fmt(d.unmapped)} labels didn't match the map</strong> and became NaN. They'll be dropped in Step 11.</div>` : ""),
      answer: (d) => {
        if (!d.counts.length) return "No labels survived. Check the label map.";
        const [big, bigN] = d.counts[0];
        const small = d.counts[d.counts.length - 1][1];
        const ratio = bigN / small;
        return `<code>${esc(big)}</code> is the biggest with ${fmt(bigN)} rows. ${ratio <= 1.1 ? "The classes are already about even." : `It's ${ratio.toFixed(1)}× the smallest class, so not balanced yet. Step 12 fixes that.`}`;
      },
    },
    {
      n: 9, title: "Build one cleaning function", check: "Did the link and the HTML tag disappear? Did \"not\" survive?",
      code: (s) => `# ===== STEP 9: BUILD ONE CLEANING FUNCTION =====
ps = PorterStemmer()                              # the stemmer: "cancelled" -> "cancel"
stop_words = set(stopwords.words('english'))      # build the stopword set ONCE, outside the function (fast)
${s.keepNegations ? "stop_words -= {'not', 'no', 'nor'}                # ...but KEEP the negations: \"not good\" must stay \"not good\"" : "# stop_words -= {'not', 'no', 'nor'}              # <-- changed: negations are removed in this experiment"}

def clean_text(text):
    text = text.replace('’', "'")            # 1. curly apostrophe (’) -> straight apostrophe (')
    text = re.sub(r'http\\S+|www\\.\\S+', ' ', text) # 2. remove web links
    text = re.sub(r'@\\w+', ' ', text)             # 3. remove @mentions (like @united)
    text = re.sub(r'<[^>]+>', ' ', text)          # 4. remove HTML tags (like <br />)
    text = re.sub(r"n't\\b", ' not', text)         # 5. "didn't" -> "did not", so the negation survives
    text = re.sub(r'[^a-zA-Z]', ' ', text)        # 6. keep letters only; everything else becomes a space
    words = text.lower().split()                  # 7. lowercase, then split into a list of words
    words = [ps.stem(w) for w in words if w not in stop_words]  # 8. drop stopwords, stem the rest
    return ' '.join(words)                        # 9. glue the words back into one string

# Test it on a sentence YOU write, where you know what should happen
print(clean_text(${pdq(s.testSentence)}))   ${CHG}`,
      interactive: true,
    },
    {
      n: 10, title: "Clean every row",
      note: "Cleaning can empty a text completely (one made only of stopwords, numbers, or emoji). Those rows are dropped.",
      code: () => `# ===== STEP 10: CLEAN EVERY ROW =====
df['clean'] = df['text'].apply(clean_text)   # run clean_text on every row; results go in a new column
df = df[df['clean'] != '']                    # drop rows that cleaning emptied out completely
print("Rows after cleaning:", len(df))
df[['text', 'clean']].head()                  # before and after, side by side`,
      sub: (d) => `${fmt(d.rows)} rows · ${(d.ms / 1000).toFixed(1)} s`,
      render: (d) => kv([["Rows after cleaning", fmt(d.rows)], ["Emptied & dropped", fmt(d.emptied)], ["Time", `${(d.ms / 1000).toFixed(2)} s`]]) +
        `<div class="table-wrap"><table class="tbl"><thead><tr><th>text</th><th>clean</th></tr></thead><tbody>${d.head.map(([t, c]) => `<tr><td class="txt">${esc(t)}</td><td class="txt clean">${esc(c)}</td></tr>`).join("")}</tbody></table></div>`,
    },
    {
      n: 11, title: "Decide how many answers", check: "Two labels, both with rows? If one shows 0, your KEEP spelling doesn't match Step 8.",
      code: (s) => `# ===== STEP 11: DECIDE HOW MANY ANSWERS =====
# Classic logistic regression is a two-way tug-of-war, so we keep TWO answers.
KEEP = ${pyList(s.keep)}                  ${CHG}: your dataset's two labels, spelled exactly as in Step 8
df2 = df[df['label'].isin(KEEP)].copy()          # keep only rows whose label is in KEEP
print(df2['label'].value_counts())`,
      sub: (d) => d.counts.map(([l, c]) => `${l} ${fmt(c)}`).join(" · "),
      render: (d) => bars(d.counts) + (d.dropped ? `<div class="muted" style="font-size:13px">Dropped ${fmt(d.dropped)} rows with other labels: ${d.available.filter(([l]) => !d.keep.includes(l)).map(([l, c]) => `<span class="chip">${esc(l)} <small>${fmt(c)}</small></span>`).join(" ")}</div>` : ""),
      answer: (d) => d.counts.every(([, c]) => c > 0) ? `Yes: ${d.counts.map(([l, c]) => `<code>${esc(l)}</code> has ${fmt(c)}`).join(" and ")}. A clean two-way tug-of-war.` : "",
    },
    {
      n: 12, title: "Balance the classes",
      note: "Balancing stops the model from scoring well by always guessing the bigger class.",
      code: (s) => `# ===== STEP 12: BALANCE THE CLASSES =====
smallest = df2['label'].value_counts().min()         # the size of the smallest class

balanced = (df2.groupby('label')                     # split the table into one group per label
               .sample(n=smallest, random_state=${s.seed})  # take the same number of rows from every group
               .sample(frac=1, random_state=${s.seed})      # shuffle all the rows
               .reset_index(drop=True))              # renumber the rows 0, 1, 2, ...
print(balanced['label'].value_counts())              # every class should now show the same count${s.balance ? "" : "\n# <-- changed: balancing is turned off in this experiment, so use balanced = df2.sample(frac=1, random_state=" + s.seed + ")"}`,
      sub: (d) => d.balanced ? `${fmt(d.smallest)} per class` : "skipped (balancing off)",
      render: (d) => bars(d.counts) + kv([[d.balanced ? "Rows per class" : "Balancing", d.balanced ? fmt(d.smallest) : "off"], ["Rows set aside", fmt(d.dropped)]]),
    },
    {
      n: 13, title: "Hide the final exam",
      note: "The test rows stay hidden until Step 15. They are the final exam.",
      code: (s) => `# ===== STEP 13: HIDE THE FINAL EXAM =====
X = balanced['clean']                    # features: the CLEANED text
y = balanced['label']                    # labels: the answer key

X_train, X_test, y_train, y_test = train_test_split(
    X, y,
    test_size=${s.testSize.toFixed(2)},                      # ${Math.round(s.testSize * 100)}% of rows go to the final exam
    random_state=${s.seed},                     # repeatable shuffle
    stratify=y)                          # same label mix in the practice set and the final exam

print("Training rows:", len(X_train), "  Test rows:", len(X_test))
print(y_test.value_counts())`,
      sub: (d) => `${fmt(d.train)} train · ${fmt(d.test)} test`,
      render: (d) => kv([["Training rows", fmt(d.train)], ["Test rows", fmt(d.test)], ["Test share", pct(d.testSize, 0)]]) + bars(d.testCounts),
    },
    {
      n: 14, title: "Build and train the assembly line",
      note: "The words with the biggest weights are what the model actually learned. Do they make sense?",
      code: (s) => `# ===== STEP 14: BUILD AND TRAIN THE ASSEMBLY LINE =====
model = Pipeline([
    ('tfidf', TfidfVectorizer(ngram_range=(1, ${s.ngramMax}),   # learn single words${s.ngramMax >= 2 ? " AND two-word phrases like \"not good\"" : ""}
                              min_df=${s.minDf})),           # ignore words/phrases that appear in fewer than ${s.minDf} training texts
    ('clf', LogisticRegression(max_iter=${s.maxIter}${s.C !== 1 ? `, C=${s.C}` : ""})),     # allow up to ${fmt(s.maxIter)} training rounds
])
model.fit(X_train, y_train)                         # learn from the training data only
print("Vocabulary size:", len(model.named_steps['tfidf'].vocabulary_))
print("Classes, in order:", model.classes_)        # this order is the column order of predict_proba`,
      sub: (d) => `${fmt(d.vocab)} features · ${(d.ms / 1000).toFixed(1)} s`,
      render: (d) => kv([["Vocabulary size", fmt(d.vocab)], ["Classes, in order", d.classes.map(esc).join(", ")], ["Training rounds", `${d.iterations}${d.converged ? "" : " (hit max_iter)"}`], ["Time", `${(d.ms / 1000).toFixed(2)} s`]]) +
        `<div class="feat-cols">${d.top.map((g) => `<div class="feat-col"><h4>Strongest pull toward <code>${esc(g.label)}</code></h4><div class="chips">${g.terms.map(([t, w]) => `<span class="chip" title="weight ${w}">${esc(t)} <small>${w > 0 ? "+" : ""}${w.toFixed(2)}</small></span>`).join("")}</div></div>`).join("")}</div>`,
    },
    {
      n: 15, title: "Grade the final exam", check: "Which class does the model catch better (higher recall)?",
      code: () => `# ===== STEP 15: GRADE THE FINAL EXAM =====
predictions = model.predict(X_test)                 # the model's guess for every test row

cm = metrics.confusion_matrix(y_test, predictions, labels=model.classes_)
print("Confusion matrix (rows = truth, columns = guess):")
print(pd.DataFrame(cm, index=model.classes_, columns=model.classes_))
print()
print(metrics.classification_report(y_test, predictions))
print("Accuracy:", round(metrics.accuracy_score(y_test, predictions), 4))`,
      sub: (d) => `accuracy ${d.report.accuracy.toFixed(4)}`,
      render: (d) => gradeHtml(d) + (d.mistakes.length ? `<details class="pycell"><summary>A few test rows it got wrong</summary><ul class="mistakes" style="margin-top:8px">${d.mistakes.map((m) => `<li><b>truth: ${esc(m.truth)} · guess: ${esc(m.guess)}</b><br>${esc(m.text)}</li>`).join("")}</ul></details>` : ""),
      answer: (d) => {
        const r = d.report.rows.slice().sort((a, b) => b.recall - a.recall);
        if (r[0].recall === r[r.length - 1].recall) return `Both classes are caught equally well (recall ${r[0].recall.toFixed(2)}).`;
        return `<code>${esc(r[0].label)}</code>: recall ${r[0].recall.toFixed(2)} vs ${r[r.length - 1].recall.toFixed(2)} for <code>${esc(r[r.length - 1].label)}</code>. When it misses, it usually misses a <code>${esc(r[r.length - 1].label)}</code>.`;
      },
    },
    {
      n: 16, title: "Compare with a lazy guess", check: "Does your model clearly beat the lazy guess?",
      code: () => `# ===== STEP 16: COMPARE WITH A LAZY GUESS =====
baseline = y_test.value_counts(normalize=True).max()   # accuracy of always guessing the most common answer
print("Always-guess-one-answer accuracy:", round(baseline, 4))
print("Our model's accuracy:           ", round(metrics.accuracy_score(y_test, predictions), 4))`,
      sub: (d) => `+${((d.accuracy - d.baseline) * 100).toFixed(1)} points`,
      render: (d) => `<div class="bars">
          <div class="bar-row"><span class="lbl">Lazy guess</span><span class="bar alt"><span style="width:${d.baseline * 100}%"></span></span><span class="val">${d.baseline.toFixed(4)}</span></div>
          <div class="bar-row"><span class="lbl">Our model</span><span class="bar win"><span style="width:${d.accuracy * 100}%"></span></span><span class="val">${d.accuracy.toFixed(4)}</span></div>
        </div>`,
      answer: (d) => {
        const lift = (d.accuracy - d.baseline) * 100;
        return lift >= 10 ? `Yes, clearly: ${lift.toFixed(1)} points better than always guessing <code>${esc(d.majority)}</code>.`
          : lift > 2 ? `A little: ${lift.toFixed(1)} points better than always guessing. Not a big win.`
            : `No. It's only ${lift.toFixed(1)} points from the lazy guess, so the model hasn't learned much.`;
      },
    },
    {
      n: 17, title: "Ask the model about new text",
      note: "Pick the label you expect for each sentence. A red ✗ means you fooled the model. Why did that one work?",
      code: (s) => `# ===== STEP 17: ASK THE MODEL ABOUT NEW TEXT =====
def predict_mood(sentence):
    cleaned = clean_text(sentence)                       # SAME cleaning as the training text
    probs = model.predict_proba([cleaned])[0]            # square brackets: the model expects a LIST of texts
    return {label: round(float(p), 3)                    # pair each label with its probability,
            for label, p in zip(model.classes_, probs)}  # rounded to 3 decimals

for s in [${s.sentences.filter((x) => x[0].trim()).map((x, i) => `${i ? "          " : ""}${pdq(x[0])},${i ? "" : `      ${CHG}: write 4 sentences of your own`}`).join("\n")}]:
    print(s, "->", predict_mood(s))`,
      interactive: true,
    },
    {
      n: 18, title: "(Optional) Three or more answers",
      note: "Only for datasets with three or more labels, like the airline tweets. scikit-learn's LogisticRegression handles 3+ classes automatically.",
      code: (s) => `# ===== STEP 18 (OPTIONAL): KEEP ALL THE ANSWERS =====
# scikit-learn's LogisticRegression handles 3+ classes automatically.
smallest3 = df['label'].value_counts().min()
balanced3 = (df.groupby('label')
               .sample(n=smallest3, random_state=${s.seed})
               .sample(frac=1, random_state=${s.seed})
               .reset_index(drop=True))

X3_train, X3_test, y3_train, y3_test = train_test_split(
    balanced3['clean'], balanced3['label'],
    test_size=${s.testSize.toFixed(2)}, random_state=${s.seed}, stratify=balanced3['label'])

model3 = Pipeline([
    ('tfidf', TfidfVectorizer(ngram_range=(1, ${s.ngramMax}), min_df=${s.minDf})),
    ('clf', LogisticRegression(max_iter=${s.maxIter}${s.C !== 1 ? `, C=${s.C}` : ""})),
])
model3.fit(X3_train, y3_train)
predictions3 = model3.predict(X3_test)

cm3 = metrics.confusion_matrix(y3_test, predictions3, labels=model3.classes_)
print(pd.DataFrame(cm3, index=model3.classes_, columns=model3.classes_))
print()
print(metrics.classification_report(y3_test, predictions3))`,
      sub: (d) => d.skipped ? "not needed for this dataset" : `${d.classes.length} classes · accuracy ${d.report.accuracy.toFixed(4)}`,
      render: (d) => d.skipped
        ? `<div class="check-box note">${esc(d.reason)} Skip it for datasets A–D.</div>`
        : kv([["Classes", d.classes.length], ["Rows per class", fmt(d.smallest)], ["Vocabulary", fmt(d.vocab)]]) + gradeHtml(d),
    },
  ];

  /* ---------- Rendering helpers ---------- */
  function table(headers, rows, opts) {
    const cell = (v) => (opts && opts.raw ? v : v === null ? '<span class="muted">NaN</span>' : esc(v));
    return `<div class="table-wrap"><table class="tbl"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
      rows.map((r) => `<tr>${r.map((v) => `<td class="${typeof v === "string" && v.length > 40 ? "txt" : ""}">${cell(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  const kv = (pairs) => `<div class="kv">${pairs.map(([k, v]) => `<div><strong>${v}</strong>${esc(k)}</div>`).join("")}</div>`;
  function bars(counts) {
    const max = Math.max(1, ...counts.map((c) => c[1]));
    return `<div class="bars">${counts.map(([l, c]) => `<div class="bar-row"><span class="lbl" title="${esc(l)}">${esc(l)}</span><span class="bar"><span style="width:${(c / max) * 100}%"></span></span><span class="val">${fmt(c)}</span></div>`).join("")}</div>`;
  }
  function gradeHtml(d) {
    const K = d.classes.length;
    const max = Math.max(1, ...d.cm.flat());
    const cmGrid = `<div class="cm" style="grid-template-columns:auto repeat(${K}, minmax(76px, 1fr))">
        <span></span><span class="hdr axis" style="grid-column:span ${K}">guess →</span>
        <span class="hdr axis">truth ↓</span>${d.classes.map((c) => `<span class="hdr">${esc(c)}</span>`).join("")}
        ${d.cm.map((row, i) => `<span class="hdr">${esc(d.classes[i])}</span>${row.map((v, j) => {
          const a = 0.12 + 0.75 * (v / max);
          const color = i === j ? `rgba(48,209,88,${a})` : `rgba(255,69,58,${v ? a * 0.8 : 0.06})`;
          return `<span class="cell" style="background:${color}">${fmt(v)}</span>`;
        }).join("")}`).join("")}
      </div>`;
    const f = (x) => x.toFixed(2);
    const rep = d.report;
    const reportTbl = `<div class="table-wrap"><table class="tbl"><thead><tr><th></th><th class="num">precision</th><th class="num">recall</th><th class="num">f1-score</th><th class="num">support</th></tr></thead><tbody>
        ${rep.rows.map((r) => `<tr><td><b>${esc(r.label)}</b></td><td class="num">${f(r.precision)}</td><td class="num">${f(r.recall)}</td><td class="num">${f(r.f1)}</td><td class="num">${fmt(r.support)}</td></tr>`).join("")}
        <tr class="sep"><td>accuracy</td><td></td><td></td><td class="num">${f(rep.accuracy)}</td><td class="num">${fmt(rep.total)}</td></tr>
        <tr><td>macro avg</td><td class="num">${f(rep.macro.precision)}</td><td class="num">${f(rep.macro.recall)}</td><td class="num">${f(rep.macro.f1)}</td><td class="num">${fmt(rep.total)}</td></tr>
        <tr><td>weighted avg</td><td class="num">${f(rep.weighted.precision)}</td><td class="num">${f(rep.weighted.recall)}</td><td class="num">${f(rep.weighted.f1)}</td><td class="num">${fmt(rep.total)}</td></tr>
      </tbody></table></div>`;
    return `<div class="cm-wrap"><div class="big-acc"><small>Accuracy</small>${rep.accuracy.toFixed(4)}</div>${cmGrid}</div>${reportTbl}`;
  }

  function highlight(src) {
    const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)/g;
    return src.split("\n").map((line) => {
      let inStr = null, cut = -1;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inStr) { if (c === "\\") i++; else if (c === inStr) inStr = null; }
        else if (c === '"' || c === "'") inStr = c;
        else if (c === "#") { cut = i; break; }
      }
      const code = cut >= 0 ? line.slice(0, cut) : line;
      const comment = cut >= 0 ? line.slice(cut) : "";
      let html = "", last = 0;
      for (const m of code.matchAll(re)) {
        html += esc(code.slice(last, m.index));
        html += m[1] ? `<span class="st">${esc(m[1])}</span>` : `<span class="nu">${esc(m[2])}</span>`;
        last = m.index + m[0].length;
      }
      html += esc(code.slice(last));
      if (comment) html += `<span class="co">${esc(comment)}</span>`;
      const chg = /# <-- (CHANGE THIS|changed)/.test(line);
      return `<span class="ln${chg ? " chg" : ""}">${html || " "}</span>`;
    }).join("");
  }

  /* ---------- Worker ---------- */
  let worker = null;
  let reqId = 0;
  let runId = 0;
  const pending = new Map();

  function getWorker() {
    if (!worker) {
      worker = new Worker("classifier-worker.js");
      worker.onmessage = onWorkerMessage;
      worker.onerror = (e) => {
        e.preventDefault();
        const msg = "The background worker crashed. Large files can run the browser out of memory; try a smaller sample in Step 2.";
        for (const p of pending.values()) p.reject(new Error(msg));
        pending.clear();
        if (running) onRunError({ step: currentStep, message: msg });
        worker.terminate();
        worker = null;
      };
    }
    return worker;
  }

  function request(type, payload) {
    return new Promise((resolve, reject) => {
      const id = ++reqId;
      pending.set(id, { resolve, reject });
      getWorker().postMessage({ type, id, ...payload });
    });
  }

  function onWorkerMessage(e) {
    const m = e.data;
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.type === "error") p.reject(Object.assign(new Error(m.message), { hint: m.hint }));
      else p.resolve(m);
      return;
    }
    if (m.runId !== runId) return;
    if (m.type === "step") onStep(m.step, m.data);
    else if (m.type === "progress") setSub(currentStep, m.text);
    else if (m.type === "done") onRunDone();
    else if (m.type === "error") onRunError(m);
  }

  /* ---------- Steps UI ---------- */
  const stepsEl = $("steps");
  const runBtn = $("run");
  let running = false;
  let currentStep = 0;
  let results = {};
  const STATUS = { idle: "Ready", running: "Running", done: "Done", error: "Stopped", skipped: "Skipped" };
  const stepEl = (n) => $(`step-${n}`);

  function buildSteps() {
    stepsEl.innerHTML = STEPS.map((st) => `
      <li class="glass step" id="step-${st.n}" data-state="idle">
        <div class="step-head">
          <span class="step-num">${st.n}</span>
          <div><h3 class="step-title">${esc(st.title)}</h3><div class="step-sub"></div></div>
          <span class="step-status">Ready</span>
        </div>
        <div class="step-body">
          <div class="out"></div>
          <div class="checkslot"></div>
          <details class="pycell">
            <summary>Python cell <span class="tag"></span></summary>
            <div class="code-wrap"><pre class="code"></pre><button class="copy-btn" type="button" data-step="${st.n}">Copy</button></div>
          </details>
        </div>
      </li>`).join("");
    stepsEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".copy-btn");
      if (btn) copyText(STEPS[Number(btn.dataset.step) - 1].code(settings, getDs(selectedId)), btn);
    });
  }

  function setState(n, state, sub) {
    const el = stepEl(n);
    if (!el) return;
    el.dataset.state = state;
    el.querySelector(".step-status").textContent = STATUS[state];
    if (sub !== undefined) setSub(n, sub);
  }
  function setSub(n, text) {
    const el = stepEl(n);
    if (el) el.querySelector(".step-sub").textContent = text || "";
  }

  function renderCheck(st, d) {
    const slot = stepEl(st.n).querySelector(".checkslot");
    const ds = getDs(selectedId);
    if (st.check) {
      const a = d && st.answer ? st.answer(d, settings, ds) : "";
      slot.innerHTML = `<div class="check-box"><div class="q">✅ Check: ${esc(st.check)}</div>${a ? `<div class="a">${a}</div>` : ""}</div>`;
    } else if (st.note) {
      slot.innerHTML = `<div class="check-box note"><div class="a" style="margin:0">${esc(st.note)}</div></div>`;
    } else slot.innerHTML = "";
  }

  function refreshCode() {
    const ds = getDs(selectedId);
    for (const st of STEPS) {
      const src = st.code(settings, ds);
      const el = stepEl(st.n);
      el.querySelector(".code").innerHTML = highlight(src);
      const changes = (src.match(/# <-- (CHANGE THIS|changed)/g) || []).length;
      el.querySelector(".pycell .tag").textContent = changes ? `· ${changes} line${changes > 1 ? "s" : ""} to change` : "";
    }
  }

  function renderStep(n) {
    const st = STEPS[n - 1];
    const d = results[n];
    const out = stepEl(n).querySelector(".out");
    if (n === 9) render9(out, d);
    else if (n === 17) render17(out, d);
    else out.innerHTML = d ? st.render(d, settings) : "";
    renderCheck(st, n === 9 ? (d ? { ...d } : null) : d);
  }

  /* Step 9: live cleaning playground */
  function render9(out, d) {
    out.innerHTML = `<div class="try">
        <input class="inline-input" id="clean-in" value="${esc(settings.testSentence)}" aria-label="Test sentence for clean_text">
        <div class="clean-out" id="clean-out">${d ? esc(d.output) || "<span class='muted'>(empty)</span>" : "…"}</div>
        <div class="flags" id="clean-flags"></div>
      </div>`;
    const input = $("clean-in");
    const update = async () => {
      settings.testSentence = input.value;
      saveSettings();
      refreshCode();
      try {
        const r = await request("clean", { text: input.value, keepNegations: settings.keepNegations });
        $("clean-out").innerHTML = r.output ? esc(r.output) : "<span class='muted'>(empty: every word was removed)</span>";
        $("clean-flags").innerHTML = cleanFlags(input.value, r.output);
        const slot = stepEl(9).querySelector(".checkslot .a");
        if (slot) slot.innerHTML = cleanAnswer(input.value, r.output);
        else renderCheckWith9(input.value, r.output);
      } catch (e) {
        $("clean-out").textContent = e.message;
      }
    };
    input.addEventListener("input", debounce(update, 200));
    update();
  }
  function cleanChecks(input, output) {
    const words = ` ${output} `;
    const checks = [];
    if (/http\S+|www\.\S+/.test(input)) checks.push([!/\b(http|https|www|co)\b/.test(output), "Link removed", "Link survived"]);
    if (/<[^>]+>/.test(input)) checks.push([!/\bbr\b/.test(output), "HTML tag removed", "HTML tag survived"]);
    if (/@\w+/.test(input)) checks.push([true, "@mention removed", ""]);
    if (/n't\b|\bnot\b/i.test(input)) checks.push([words.includes(" not "), "\"not\" survived", "\"not\" was dropped"]);
    return checks;
  }
  const cleanFlags = (i, o) => cleanChecks(i, o).map(([ok, y, n]) => `<span class="flag ${ok ? "ok" : "bad"}">${ok ? "✓ " + y : "✗ " + n}</span>`).join("");
  function cleanAnswer(i, o) {
    const c = cleanChecks(i, o);
    if (!c.length) return "Your test sentence has no link, tag, or negation to check. Try adding some.";
    return c.every((x) => x[0]) ? "Yes. Everything that should disappear did, and the negation made it through." : `Not quite: ${c.filter((x) => !x[0]).map((x) => x[2].toLowerCase()).join(", ")}.`;
  }
  function renderCheckWith9(i, o) {
    const slot = stepEl(9).querySelector(".checkslot");
    slot.innerHTML = `<div class="check-box"><div class="q">✅ Check: ${esc(STEPS[8].check)}</div><div class="a">${cleanAnswer(i, o)}</div></div>`;
  }

  /* Step 17: ask the model */
  let classes17 = null;
  function render17(out, d) {
    if (d) classes17 = results[14] ? results[14].classes : classes17;
    const opts = classes17 || settings.keep;
    const resultFor = (s) => d && d.results.find((r) => r.sentence === s);
    out.innerHTML = `<div class="sentences" id="sentences">${settings.sentences.map((x, i) => sentenceRow(x, i, opts, resultFor(x[0]))).join("")}</div>
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn ghost small" id="sent-add">+ Add a sentence</button>
        ${classes17 ? "" : '<span class="muted" style="font-size:12.5px;align-self:center">Fly the checklist to train a model, then the probabilities appear here.</span>'}
      </div>`;
    out.querySelectorAll(".sent").forEach(updateVerdict);
    $("sent-add").onclick = () => {
      settings.sentences.push(["", ""]);
      saveSettings();
      render17(out, null);
      out.querySelectorAll(".sent input")[settings.sentences.length - 1].focus();
    };
    const box = $("sentences");
    const ask = debounce(predictAll, 300);
    box.addEventListener("input", (e) => {
      const row = e.target.closest(".sent");
      if (!row) return;
      const i = Number(row.dataset.i);
      settings.sentences[i][0] = row.querySelector("input").value;
      saveSettings();
      refreshCode();
      ask();
    });
    box.addEventListener("change", (e) => {
      if (e.target.tagName !== "SELECT") return;
      const row = e.target.closest(".sent");
      settings.sentences[Number(row.dataset.i)][1] = e.target.value;
      saveSettings();
      updateVerdict(row);
    });
    box.addEventListener("click", (e) => {
      const del = e.target.closest(".sent-del");
      if (!del) return;
      settings.sentences.splice(Number(del.closest(".sent").dataset.i), 1);
      saveSettings();
      refreshCode();
      render17(out, results[17] || null);
      predictAll();
    });
  }
  function sentenceRow([text, expected], i, opts, res) {
    return `<div class="sent" data-i="${i}">
        <div class="sent-top">
          <input class="inline-input" value="${esc(text)}" placeholder="Type a sentence…" aria-label="Sentence ${i + 1}">
          <select aria-label="Expected label"><option value="">I expect…</option>${opts.map((o) => `<option value="${esc(o)}"${o === expected ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>
          <button type="button" class="icon-btn sent-del" aria-label="Remove sentence"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </div>
        <div class="probs">${res ? probsHtml(res) : ""}</div>
        <div class="verdict"></div>
      </div>`;
  }
  function probsHtml(res) {
    const top = Math.max(...res.probs.map((p) => p[1]));
    return res.probs.map(([l, p]) => `<div class="prob-row${p === top ? " top" : ""}" data-label="${esc(l)}"><span class="lbl">${esc(l)}</span><span class="bar"><span style="width:${p * 100}%"></span></span><span class="val">${p.toFixed(3)}</span></div>`).join("") +
      `<div class="cleaned-as">cleaned: ${esc(res.cleaned) || "(empty, so the model only sees its intercept)"}</div>`;
  }
  function updateVerdict(row) {
    const expected = row.querySelector("select").value;
    const top = row.querySelector(".prob-row.top");
    const v = row.querySelector(".verdict");
    if (!expected || !top) { v.className = "verdict"; v.textContent = ""; return; }
    const ok = top.dataset.label === expected;
    v.className = `verdict ${ok ? "ok" : "bad"}`;
    v.textContent = ok ? `✓ The model agrees: ${expected}` : `✗ Fooled it: you expected ${expected}, it said ${top.dataset.label}`;
  }
  async function predictAll() {
    if (!results[14]) return;
    const rows = Array.from(document.querySelectorAll("#sentences .sent"));
    const texts = rows.map((r) => r.querySelector("input").value);
    try {
      const r = await request("predict", { sentences: texts.map((t) => t || " ") });
      rows.forEach((row, i) => {
        row.querySelector(".probs").innerHTML = texts[i].trim() ? probsHtml(r.results[i]) : "";
        updateVerdict(row);
      });
    } catch (e) { /* model not ready yet */ }
  }

  /* ---------- Running ---------- */
  function resetRun(keepHasRun) {
    results = {};
    classes17 = null;
    STEPS.forEach((st) => { setState(st.n, "idle", ""); renderStep(st.n); });
    stepsEl.classList.toggle("has-run", !!keepHasRun);
    $("summary").hidden = true;
  }

  function setRunButton(text) {
    runBtn.querySelector("span").textContent = text || "Fly the checklist";
    runBtn.classList.toggle("running", !!text);
    runBtn.disabled = !!text;
  }

  async function buildConfig() {
    const ds = getDs(selectedId);
    const s = settings;
    const dataset = { sep: ds.sep || "auto", header: ds.header !== false, names: ds.names || null, ignoreQuotes: !!ds.ignoreQuotes, sample: s.sample };
    if (ds.source === "file") {
      const text = await idbGet(ds.id).catch(() => null);
      if (text == null) throw new Error(`The uploaded file for "${ds.name}" isn't stored in this browser any more. Edit the dataset and upload it again.`);
      dataset.text = text;
    } else {
      dataset.url = ds.url;
    }
    return {
      dataset, textCol: s.textCol, labelCol: s.labelCol, labelMap: s.labelMap, keep: s.keep,
      testSentence: s.testSentence, sentences: s.sentences.map((x) => x[0]),
      testSize: s.testSize, seed: s.seed, ngramMax: s.ngramMax, minDf: s.minDf, C: s.C, maxIter: s.maxIter,
      balance: s.balance, keepNegations: s.keepNegations,
    };
  }

  async function run() {
    if (running) return;
    readForm();
    saveSettings();
    refreshCode();
    resetRun(true);
    running = true;
    runId++;
    currentStep = 1;
    setState(1, "running");
    setRunButton("Flying… step 1 of 18");
    let cfg;
    try {
      cfg = await buildConfig();
    } catch (e) {
      onRunError({ step: 2, message: e.message });
      return;
    }
    getWorker().postMessage({ type: "run", runId, config: cfg });
  }

  function onStep(n, d) {
    results[n] = d;
    const st = STEPS[n - 1];
    renderStep(n);
    setState(n, d.skipped ? "skipped" : "done", st.sub ? st.sub(d) : "");
    if (n === 3) $("col-list").innerHTML = d.columns.map((c) => `<option value="${esc(c)}">`).join("");
    if (n === 8 || n === 11) renderKeepChips(n === 11 ? d.available : d.counts);
    if (n < 18) {
      currentStep = n + 1;
      if (stepEl(n + 1).dataset.state === "idle") setState(n + 1, "running", "");
      setRunButton(`Flying… step ${n + 1} of 18`);
    }
  }

  function onRunDone() {
    running = false;
    setRunButton(null);
    renderSummary();
  }

  function onRunError(m) {
    running = false;
    setRunButton(null);
    const n = m.step || currentStep || 1;
    setState(n, "error", "Fix this, then fly again");
    for (let k = n + 1; k <= 18; k++) setState(k, "idle", "");
    const out = stepEl(n).querySelector(".out");
    out.insertAdjacentHTML("beforeend", `<div class="err-box"><strong>${esc(m.message)}</strong>${m.hint ? `<br>${esc(m.hint)}` : ""}</div>`);
    stepEl(n).scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function renderSummary() {
    const r12 = results[12], r13 = results[13], r14 = results[14], r16 = results[16];
    if (!r16) return;
    const lift = (r16.accuracy - r16.baseline) * 100;
    $("summary").innerHTML = `
      <div class="glass stat"><div class="k">Dataset</div><div class="v" style="font-size:18px;margin-top:8px">${esc(getDs(selectedId).name)}</div><div class="s">${fmt(r13.train + r13.test)} rows after cleaning &amp; balancing</div></div>
      <div class="glass stat hero-stat"><div class="k">Accuracy</div><div class="v">${pct(r16.accuracy)}</div><div class="s">on ${fmt(r13.test)} hidden test rows</div></div>
      <div class="glass stat"><div class="k">Lazy guess</div><div class="v">${pct(r16.baseline)}</div><div class="s">model is ${lift >= 0 ? "+" : ""}${lift.toFixed(1)} points better</div></div>
      <div class="glass stat"><div class="k">Vocabulary</div><div class="v">${fmt(r14.vocab)}</div><div class="s">${r12.balanced ? `${fmt(r12.smallest)} rows per class` : "unbalanced run"}</div></div>`;
    $("summary").hidden = false;
  }

  function renderKeepChips(counts) {
    const box = $("keep-chips");
    if (!counts || !counts.length) { box.hidden = true; return; }
    box.innerHTML = counts.map(([l, c]) => `<button type="button" class="chip" data-label="${esc(l)}" aria-pressed="${settings.keep.includes(l)}">${esc(l)} <small>${fmt(c)}</small></button>`).join("");
    box.hidden = false;
  }
  $("keep-chips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const l = chip.dataset.label;
    const keep = splitList($("set-keep").value);
    const i = keep.indexOf(l);
    if (i >= 0) keep.splice(i, 1); else keep.push(l);
    $("set-keep").value = keep.join(", ");
    onSettingsChange();
    chip.setAttribute("aria-pressed", String(i < 0));
  });

  function onSettingsChange() {
    readForm();
    saveSettings();
    refreshCode();
    $("keep-chips").querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(settings.keep.includes(c.dataset.label))));
    if (results[16] && !$("summary").querySelector(".stale")) {
      $("summary").insertAdjacentHTML("beforeend", '<div class="glass stat stale" style="grid-column:1/-1;padding:10px 16px"><div class="s">Settings changed since this run. Fly the checklist again to see the effect.</div></div>');
    }
  }

  /* ---------- Dataset list ---------- */
  function renderDatasets() {
    $("ds-list").innerHTML = allDatasets().map((ds) => `
      <div class="ds" role="radio" tabindex="0" aria-checked="${ds.id === selectedId}" data-id="${esc(ds.id)}" data-kind="${ds.kind || "custom"}" title="${esc(ds.note || "")}">
        <span class="ds-badge">${esc(ds.badge || "★")}</span>
        <span><div class="ds-name">${esc(ds.name)}</div><div class="ds-meta">${esc(ds.meta || "")}</div></span>
        ${ds.kind === "custom" ? `<span class="ds-edit" role="button" tabindex="0" aria-label="Edit ${esc(ds.name)}" data-edit="${esc(ds.id)}"><svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg></span>`
          : `<span class="ds-tag">${ds.kind === "demo" ? "demo" : ds.kind === "bonus" ? "bonus" : ""}</span>`}
      </div>`).join("");
  }

  function selectDataset(id) {
    if (running) return;
    selectedId = id;
    store.set("clf.selected", id);
    const ds = getDs(id);
    settings = settingsFor(ds);
    fillForm();
    renderDatasets();
    $("col-list").innerHTML = (ds.columns || ds.names || [ds.textCol, ds.labelCol]).map((c) => `<option value="${esc(c)}">`).join("");
    $("keep-chips").hidden = true;
    refreshCode();
    resetRun(false);
  }

  $("ds-list").addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit]");
    if (edit) { e.stopPropagation(); openDialog(getDs(edit.dataset.edit)); return; }
    const card = e.target.closest(".ds");
    if (card) selectDataset(card.dataset.id);
  });
  $("ds-list").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.target.click();
  });

  /* ---------- Add / edit dataset dialog ---------- */
  const dlg = $("ds-dialog");
  let editing = null, preview = null, fileText = null, src = "url";

  function setSrc(v) {
    src = v;
    const toggle = $("dsf-src");
    toggle.querySelectorAll("button").forEach((b, i) => {
      const on = b.dataset.value === v;
      b.setAttribute("aria-checked", String(on));
      if (on) toggle.style.setProperty("--i", i);
    });
    $("dsf-url-wrap").hidden = v !== "url";
    $("dsf-file-wrap").hidden = v !== "file";
    invalidatePreview();
  }
  function invalidatePreview() {
    preview = null;
    $("dsf-after").hidden = true;
    $("dsf-save").disabled = true;
  }
  function showDsfError(msg) {
    $("dsf-error").textContent = msg || "";
    $("dsf-error").hidden = !msg;
  }

  function openDialog(ds) {
    editing = ds || null;
    $("ds-dialog-title").textContent = ds ? "Edit dataset" : "Add a dataset";
    $("dsf-delete").hidden = !ds;
    $("dsf-name").value = ds ? ds.name : "";
    $("dsf-url").value = ds && ds.url ? ds.url : "";
    $("dsf-file").value = "";
    $("dsf-sep").value = ds ? (ds.sepChoice || ds.sep || "auto") : "auto";
    $("dsf-header").checked = ds ? ds.header !== false : true;
    $("dsf-names").value = ds && ds.names ? ds.names.join(", ") : "";
    $("dsf-names").disabled = $("dsf-header").checked;
    $("dsf-quotes").checked = !!(ds && ds.ignoreQuotes);
    $("dsf-map").value = ds ? mapToText(ds.labelMap) : "";
    $("dsf-keep").value = ds ? ds.keep.join(", ") : "";
    $("dsf-sample").value = ds && ds.sample ? ds.sample : "";
    fileText = null;
    showDsfError("");
    setSrc(ds && ds.source === "file" ? "file" : "url");
    dlg.showModal();
    if (ds) loadPreview(ds);
  }

  async function loadPreview(existing) {
    showDsfError("");
    const source = {
      sep: $("dsf-sep").value, header: $("dsf-header").checked, ignoreQuotes: $("dsf-quotes").checked,
      names: $("dsf-header").checked ? null : splitList($("dsf-names").value),
    };
    try {
      if (src === "file") {
        const f = $("dsf-file").files[0];
        if (f) fileText = await f.text();
        else if (existing && existing.source === "file" && fileText == null) fileText = await idbGet(existing.id).catch(() => null);
        if (fileText == null) throw new Error("Choose a file to upload.");
        source.text = fileText;
      } else {
        const url = $("dsf-url").value.trim();
        if (!/^https?:\/\//i.test(url)) throw new Error("Enter a full URL starting with https://");
        source.url = url;
      }
      if (!source.header && !source.names.length) throw new Error("This file has no header row, so name its columns (e.g. label, message).");
      $("dsf-preview").disabled = true;
      $("dsf-preview").lastChild.textContent = " Loading…";
      const r = await request("preview", { source });
      preview = r.preview;
      renderPreview(existing);
    } catch (e) {
      invalidatePreview();
      showDsfError(e.message + (e.hint ? ` ${e.hint}` : ""));
    } finally {
      $("dsf-preview").disabled = false;
      $("dsf-preview").lastChild.textContent = " Load preview";
    }
  }

  function renderPreview(existing) {
    const p = preview;
    const sepName = { "\t": "tab", ",": "comma", ";": "semicolon", "|": "pipe" }[p.sep] || p.sep;
    $("dsf-summary").innerHTML = `<b>${fmt(p.rowCount)}</b> rows · <b>${p.columns.length}</b> columns · ${sepName}-separated${p.rowCount < 1000 ? ". Under 1,000 rows, so expect accuracy to jump around." : ""}`;
    $("dsf-head").innerHTML = `<thead><tr>${p.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${p.head.map((r) => `<tr>${r.map((v) => `<td>${v === null ? '<span class="muted">NaN</span>' : esc(v)}</td>`).join("")}</tr>`).join("")}</tbody>`;
    const opts = p.columns.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    $("dsf-text").innerHTML = opts;
    $("dsf-label").innerHTML = opts;
    // Guess: the text column has the longest values; the label column has the fewest distinct values
    const byLen = p.stats.slice().sort((a, b) => b.avgLen - a.avgLen);
    const textGuess = existing && p.columns.includes(existing.textCol) ? existing.textCol : byLen[0].name;
    const labelCands = p.stats.filter((s) => s.name !== textGuess && s.unique !== "50+" && s.unique >= 2).sort((a, b) => a.unique - b.unique);
    const labelGuess = existing && p.columns.includes(existing.labelCol) ? existing.labelCol : (labelCands[0] || p.stats.find((s) => s.name !== textGuess) || byLen[0]).name;
    $("dsf-text").value = textGuess;
    $("dsf-label").value = labelGuess;
    $("dsf-after").hidden = false;
    renderLabelChips(!existing);
    $("dsf-save").disabled = false;
  }

  function labelValues() {
    const stat = preview.stats.find((s) => s.name === $("dsf-label").value);
    const map = textToMap($("dsf-map").value);
    const counts = new Map();
    for (const [raw, c] of stat.top) {
      let v = String(raw).trim().toLowerCase();
      if (map) v = Object.prototype.hasOwnProperty.call(map, v) ? map[v] : null;
      if (v !== null) counts.set(v, (counts.get(v) || 0) + c);
    }
    return { stat, list: Array.from(counts.entries()).sort((a, b) => b[1] - a[1]) };
  }

  function renderLabelChips(autoKeep) {
    const { stat, list } = labelValues();
    if (stat.unique === "50+") {
      $("dsf-labels").innerHTML = '<span class="muted" style="font-size:13px">This column has 50+ different values, so it\'s probably not a label column.</span>';
      return;
    }
    if (autoKeep || !$("dsf-keep").value.trim()) $("dsf-keep").value = list.slice(0, 2).map((x) => x[0]).sort().join(", ");
    const keep = splitList($("dsf-keep").value);
    const numeric = list.length && list.every(([v]) => /^\d+$/.test(v));
    $("dsf-labels").innerHTML = list.map(([v, c]) => `<button type="button" class="chip" data-v="${esc(v)}" aria-pressed="${keep.includes(v)}">${esc(v)} <small>${fmt(c)}</small></button>`).join("") +
      (numeric && !$("dsf-map").value ? '<span class="muted" style="font-size:12.5px;width:100%">Number labels? Add a label map like <code>0=negative, 1=positive</code> to turn them into words.</span>' : "");
  }

  $("dsf-src").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setSrc(b.dataset.value); });
  $("dsf-header").addEventListener("change", () => { $("dsf-names").disabled = $("dsf-header").checked; invalidatePreview(); });
  ["dsf-url", "dsf-file", "dsf-sep", "dsf-names", "dsf-quotes"].forEach((id) => $(id).addEventListener("change", invalidatePreview));
  $("dsf-preview").addEventListener("click", () => loadPreview(editing));
  $("dsf-label").addEventListener("change", () => renderLabelChips(true));
  $("dsf-map").addEventListener("input", () => renderLabelChips(true));
  $("dsf-keep").addEventListener("input", () => {
    const keep = splitList($("dsf-keep").value);
    $("dsf-labels").querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(keep.includes(c.dataset.v))));
  });
  $("dsf-labels").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const keep = splitList($("dsf-keep").value);
    const i = keep.indexOf(chip.dataset.v);
    if (i >= 0) keep.splice(i, 1); else keep.push(chip.dataset.v);
    $("dsf-keep").value = keep.join(", ");
    chip.setAttribute("aria-pressed", String(i < 0));
  });
  $("ds-add").addEventListener("click", () => openDialog(null));
  $("ds-close").addEventListener("click", () => dlg.close());
  $("dsf-cancel").addEventListener("click", () => dlg.close());

  $("dsf-delete").addEventListener("click", async () => {
    if (!editing || !confirm(`Delete "${editing.name}" from this browser?`)) return;
    customs = customs.filter((d) => d.id !== editing.id);
    delete overrides[editing.id];
    store.set("clf.datasets", customs);
    store.set("clf.overrides", overrides);
    idbDel(editing.id).catch(() => {});
    dlg.close();
    selectDataset(selectedId === editing.id ? "yelp" : selectedId);
  });

  $("ds-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!preview) return;
    const name = $("dsf-name").value.trim();
    const keep = splitList($("dsf-keep").value).map((k) => k.toLowerCase());
    if (!name) { showDsfError("Give the dataset a name."); return; }
    if (keep.length < 2) { showDsfError("Pick at least two labels to KEEP."); return; }
    const id = editing ? editing.id : `custom-${Date.now().toString(36)}`;
    const fileInput = $("dsf-file").files[0];
    const sepChoice = $("dsf-sep").value;
    const ds = {
      id, kind: "custom", badge: name.trim()[0].toUpperCase(), name,
      meta: `${fmt(preview.rowCount)} rows · ${keep.join(" / ")}`,
      note: src === "file" ? "Uploaded file, stored in this browser." : "Loaded from your URL.",
      source: src, url: src === "url" ? $("dsf-url").value.trim() : null,
      fileName: src === "file" ? (fileInput ? fileInput.name : editing && editing.fileName) : null,
      sep: preview.sep, sepChoice, header: $("dsf-header").checked, ignoreQuotes: $("dsf-quotes").checked,
      names: $("dsf-header").checked ? null : splitList($("dsf-names").value),
      columns: preview.columns, textCol: $("dsf-text").value, labelCol: $("dsf-label").value,
      labelMap: textToMap($("dsf-map").value), keep,
      sample: $("dsf-sample").value ? Math.floor(Number($("dsf-sample").value)) : null,
      expectedRows: preview.rowCount,
    };
    ds.sentences = editing && editing.sentences ? editing.sentences : genericSentences(keep);
    try {
      if (src === "file") await idbPut(id, fileText);
    } catch (err) {
      showDsfError(`Couldn't store the file in this browser: ${err.message}`);
      return;
    }
    const i = customs.findIndex((d) => d.id === id);
    if (i >= 0) customs[i] = ds; else customs.push(ds);
    store.set("clf.datasets", customs);
    delete overrides[id]; // the dataset's own settings are the new defaults
    store.set("clf.overrides", overrides);
    dlg.close();
    selectDataset(id);
  });

  /* ---------- Export ---------- */
  function copyText(text, btn) {
    const done = () => { if (btn) { const old = btn.textContent; btn.textContent = "Copied"; setTimeout(() => { btn.textContent = old; }, 1400); } };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { /* ignore */ }
    ta.remove();
  }

  function allCode() {
    const ds = getDs(selectedId);
    return STEPS.map((st) => st.code(settings, ds)).join("\n\n\n");
  }

  function downloadNotebook() {
    readForm();
    const ds = getDs(selectedId);
    const s = settings;
    const lines = (src) => src.split("\n").map((l, i, a) => (i < a.length - 1 ? l + "\n" : l));
    const md = (src) => ({ cell_type: "markdown", metadata: {}, source: lines(src) });
    const code = (src) => ({ cell_type: "code", execution_count: null, metadata: {}, outputs: [], source: lines(src) });
    const link = ds.source === "file" ? ` (uploaded file \`${ds.fileName || "your_file.csv"}\`)` : ` ([link](${ds.url}))`;
    const cells = [md(`# Pre-Flight Checklist: ${ds.name}

**Natural Language Processing · Chapter 3, Part 2**

- **Dataset:** ${ds.name}${link}
- **Name:** _your name_
- **Worked with:** _classmates, if any_${s.sample ? `\n\n> To speed things up, Step 2 takes a random sample of ${fmt(s.sample)} rows with \`raw.sample(n=${s.sample}, random_state=42)\`.` : ""}${ds.source === "file" ? "\n\n> Upload the data file through Colab's Files panel (the folder icon on the left) before running Step 2." : ""}`)];
    for (const st of STEPS) {
      cells.push(md(`### Step ${st.n}: ${st.title}`));
      cells.push(code(st.code(s, ds)));
      if (st.check) cells.push(md(`✅ **Check:** ${st.check}`));
    }
    cells.push(md(`## Reflection

**1. What did you change in the 18 steps, and why?**

_Your answer here._

**2. How did your accuracy compare with the lazy guess?**

_Your answer here._

**3. Which of your Step 17 sentences fooled the model, and why do you think it did?**

_Your answer here._`));
    const nb = {
      cells,
      metadata: { colab: { name: "PreFlight_YourName.ipynb", provenance: [] }, kernelspec: { display_name: "Python 3", name: "python3" }, language_info: { name: "python" } },
      nbformat: 4, nbformat_minor: 0,
    };
    const blob = new Blob([JSON.stringify(nb, null, 1)], { type: "application/x-ipynb+json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "PreFlight_YourName.ipynb";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- Wire up ---------- */
  buildSteps();
  const settingsForm = $("settings");
  settingsForm.insertAdjacentHTML("beforeend", '<button type="button" class="btn ghost small" id="set-reset" style="justify-self:start">Reset to dataset defaults</button>');
  settingsForm.addEventListener("input", debounce(onSettingsChange, 150));
  settingsForm.addEventListener("change", onSettingsChange);
  settingsForm.addEventListener("submit", (e) => { e.preventDefault(); run(); });
  $("set-reset").addEventListener("click", () => {
    delete overrides[selectedId];
    store.set("clf.overrides", overrides);
    selectDataset(selectedId);
  });
  runBtn.addEventListener("click", run);
  $("download-nb").addEventListener("click", downloadNotebook);
  $("copy-all").addEventListener("click", (e) => { copyText(allCode()); flash(e.currentTarget); });
  function flash(btn) {
    const label = btn.lastChild;
    const old = label.textContent;
    label.textContent = " Copied!";
    setTimeout(() => { label.textContent = old; }, 1400);
  }

  selectDataset(getDs(selectedId).id);
})();
