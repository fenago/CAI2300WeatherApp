// Runs the 18-step Pre-Flight Checklist off the main thread and reports each step as it finishes.
/* global importScripts */
const IN_WORKER = typeof importScripts === "function";
const Core = IN_WORKER ? (importScripts("classifier-core.js"), self.Core) : require("./classifier-core.js");

class StepError extends Error {
  constructor(step, message, hint) {
    super(message);
    this.step = step;
    this.hint = hint;
  }
}

const textCache = new Map(); // url -> downloaded text, so re-runs skip the download
const trunc = (s, n = 180) => (s == null ? s : s.length > n ? s.slice(0, n) + "…" : s);
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

async function loadText(source, progress) {
  if (source.text != null) return source.text;
  if (textCache.has(source.url)) return textCache.get(source.url);
  let res;
  try {
    res = await fetch(source.url);
  } catch (e) {
    throw new Error(`Couldn't download the file (${e.message}). Check the URL, and that the server allows cross-origin requests.`);
  }
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  let text;
  if (res.body && res.body.getReader) {
    const total = Number(res.headers.get("content-length")) || 0;
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const parts = [];
    let got = 0, lastReport = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      parts.push(decoder.decode(value, { stream: true }));
      if (progress && got - lastReport > 1.5e6) {
        lastReport = got;
        progress(`Downloading ${(got / 1e6).toFixed(1)} MB${total ? ` of ${(total / 1e6).toFixed(1)} MB` : ""}…`);
      }
    }
    parts.push(decoder.decode());
    text = parts.join("");
  } else {
    text = await res.text();
  }
  textCache.set(source.url, text);
  return text;
}

function readTable(text, ds) {
  const sep = !ds.sep || ds.sep === "auto" ? Core.detectSep(text) : ds.sep;
  const rows = Core.parseDelimited(text, sep, !ds.ignoreQuotes);
  const table = Core.toTable(rows, ds.header !== false, ds.names);
  table.sep = sep;
  return table;
}

function tidyLabel(v, labelMap) {
  if (v === null) return null;
  const s = String(v).trim().toLowerCase();
  if (!labelMap) return s;
  return Object.prototype.hasOwnProperty.call(labelMap, s) ? labelMap[s] : null; // unmapped -> NaN, like pandas .map
}

function topFeatures(vec, clf, classes, n) {
  const terms = vec.terms;
  const pick = (w, sign) => {
    const ix = Array.from(w.keys());
    ix.sort((a, b) => sign * (w[b] - w[a]));
    return ix.slice(0, n).map((j) => [terms[j], Math.round(w[j] * 1000) / 1000]);
  };
  if (classes.length === 2) {
    return [
      { label: classes[1], terms: pick(clf.coef[0], 1) },
      { label: classes[0], terms: pick(clf.coef[0], -1) },
    ];
  }
  return classes.map((label, c) => ({ label, terms: pick(clf.coef[c], 1) }));
}

function balanceRows(rows, rand) {
  const counts = Core.valueCounts(rows.map((r) => r.label));
  const smallest = Math.min(...counts.map((c) => c[1]));
  let out = [];
  for (const label of counts.map((c) => c[0]).sort()) {
    out = out.concat(Core.sample(rows.filter((r) => r.label === label), smallest, rand));
  }
  return { rows: Core.shuffle(out, rand), smallest };
}

function trainAndGrade(rows, cfg, rand, step) {
  const labels = rows.map((r) => r.label);
  const counts = Core.valueCounts(labels);
  const tooSmall = counts.filter((c) => c[1] < 2);
  if (tooSmall.length) {
    throw new StepError(step, `The class "${tooSmall[0][0]}" has only ${tooSmall[0][1]} row, so it can't be split into train and test.`,
      "Every label needs at least 2 rows. Drop or merge the rare labels in Step 11.");
  }
  const { train, test } = Core.stratifiedSplit(labels, cfg.testSize, rand);
  const classes = counts.map((c) => c[0]).sort();
  const cIndex = new Map(classes.map((c, i) => [c, i]));
  const Xtr = train.map((i) => rows[i].clean), ytr = train.map((i) => cIndex.get(rows[i].label));
  const Xte = test.map((i) => rows[i].clean), yte = test.map((i) => cIndex.get(rows[i].label));

  const t0 = now();
  const vec = new Core.TfidfVectorizer({ ngramMax: cfg.ngramMax, minDf: cfg.minDf }).fit(Xtr);
  if (!vec.terms.length) {
    throw new StepError(step, "The vocabulary is empty: no word appears in at least min_df training texts.",
      "Lower min_df, or use a dataset with more rows.");
  }
  const clf = new Core.LogisticRegression({ C: cfg.C, maxIter: cfg.maxIter }).fit(vec.transform(Xtr), ytr, classes.length);
  const trainMs = now() - t0;

  const pred = clf.predict(vec.transform(Xte));
  const cm = Core.confusionMatrix(yte, pred, classes.length);
  const report = Core.classificationReport(cm, classes);
  const testCounts = Core.valueCounts(yte.map((y) => classes[y]));
  const mistakes = [];
  for (let i = 0; i < test.length && mistakes.length < 6; i++) {
    if (pred[i] !== yte[i]) mistakes.push({ text: trunc(rows[test[i]].text, 200), truth: classes[yte[i]], guess: classes[pred[i]] });
  }
  return { vec, clf, classes, train, test, testCounts, cm, report, trainMs, mistakes };
}

function predictWith(model, sentence) {
  const cleaned = model.cleaner(sentence);
  const probs = model.clf.predictProba(model.vec.transform([cleaned]))[0];
  return { sentence, cleaned, probs: model.classes.map((label, i) => [label, Math.round(probs[i] * 1000) / 1000]) };
}

// Runs every step; `emit(step, data)` reports results, `progress(step, text)` reports status
async function runPipeline(cfg, emit, progress) {
  const ds = cfg.dataset;
  const seed = Number.isFinite(cfg.seed) ? cfg.seed : 42;

  // 1
  emit(1, {
    tools: [
      ["re", "JavaScript regular expressions"],
      ["pandas.read_csv", "built-in CSV/TSV reader (same NaN rules)"],
      ["nltk stopwords", `${Core.STOPWORDS.length} English stopwords`],
      ["PorterStemmer", "NLTK-compatible Porter stemmer"],
      ["TfidfVectorizer", "TF-IDF with sklearn's smoothing + L2 norm"],
      ["LogisticRegression", "L-BFGS, L2 penalty, same objective as sklearn"],
      ["metrics", "confusion matrix + classification report"],
    ],
  });

  // 2
  let t0 = now();
  let text;
  try {
    text = await loadText(ds, (msg) => progress(2, msg));
  } catch (e) {
    throw new StepError(2, e.message, "Double-check the URL in Step 2. It must point at the raw file (on GitHub, use the Raw link).");
  }
  progress(2, "Parsing…");
  const table = readTable(text, ds);
  const originalRows = table.rows.length;
  let rows = table.rows;
  let sampled = null;
  if (ds.sample && ds.sample < rows.length) {
    rows = Core.sample(rows, ds.sample, Core.makeRng(seed));
    sampled = ds.sample;
  }
  emit(2, { rows: rows.length, cols: table.columns.length, originalRows, sampled, sep: table.sep, mb: text.length / 1e6, ms: now() - t0 });

  // 3
  emit(3, { columns: table.columns, head: rows.slice(0, 3).map((r) => r.map((v) => trunc(v, 120))) });

  // 4
  const ti = table.columns.indexOf(cfg.textCol);
  const li = table.columns.indexOf(cfg.labelCol);
  if (ti === -1 || li === -1) {
    const bad = ti === -1 ? cfg.textCol : cfg.labelCol;
    throw new StepError(4, `KeyError: "${bad}" is not a column in this dataset.`,
      `The columns are: ${table.columns.map((c) => `'${c}'`).join(", ")}. Copy the name exactly; capitals and spaces count.`);
  }
  let df = rows.map((r) => ({ text: r[ti], label: r[li] }));
  emit(4, { head: df.slice(0, 5).map((d) => [trunc(d.text, 140), d.label]) });

  // 5
  const missing = { text: df.filter((d) => d.text === null).length, label: df.filter((d) => d.label === null).length };
  const before5 = df.length;
  df = df.filter((d) => d.text !== null && d.label !== null);
  emit(5, { missing, dropped: before5 - df.length, rows: df.length });

  // 6
  const before6 = df.length;
  df.forEach((d) => { d.text = String(d.text); });
  df = df.filter((d) => d.text.trim() !== "");
  emit(6, { dropped: before6 - df.length, rows: df.length });

  // 7
  const seen = new Set();
  const dupeExamples = [];
  const before7 = df.length;
  df = df.filter((d) => {
    if (seen.has(d.text)) {
      if (dupeExamples.length < 3 && !dupeExamples.includes(trunc(d.text, 140))) dupeExamples.push(trunc(d.text, 140));
      return false;
    }
    seen.add(d.text);
    return true;
  });
  emit(7, { dupes: before7 - df.length, rows: df.length, examples: dupeExamples });

  // 8
  df.forEach((d) => { d.label = tidyLabel(d.label, cfg.labelMap); });
  const labelCounts = Core.valueCounts(df.map((d) => d.label));
  emit(8, { counts: labelCounts, unmapped: df.filter((d) => d.label === null).length, mapped: !!cfg.labelMap });

  // 9
  const cleaner = Core.makeCleaner({ keepNegations: cfg.keepNegations });
  emit(9, { input: cfg.testSentence, output: cleaner(cfg.testSentence || "") });

  // 10
  t0 = now();
  for (let i = 0; i < df.length; i++) {
    df[i].clean = cleaner(df[i].text);
    if (i % 2000 === 1999) progress(10, `Cleaning ${(i + 1).toLocaleString()} of ${df.length.toLocaleString()} rows…`);
  }
  const before10 = df.length;
  df = df.filter((d) => d.clean !== "");
  emit(10, { emptied: before10 - df.length, rows: df.length, ms: now() - t0, head: df.slice(0, 5).map((d) => [trunc(d.text, 140), trunc(d.clean, 140)]) });

  // 11
  const keep = cfg.keep;
  const df2 = df.filter((d) => keep.includes(d.label));
  const keepCounts = keep.map((k) => [k, df2.filter((d) => d.label === k).length]);
  const available = Core.valueCounts(df.map((d) => d.label));
  const zero = keepCounts.filter((c) => c[1] === 0);
  if (keep.length < 2) {
    throw new StepError(11, `KEEP has ${keep.length} label${keep.length === 1 ? "" : "s"}; a classifier needs at least two.`,
      `Labels available after Step 8: ${available.map((c) => `'${c[0]}'`).join(", ")}.`);
  }
  if (zero.length) {
    emit(11, { counts: keepCounts, keep, available, dropped: df.length - df2.length });
    throw new StepError(11, `No rows have the label ${zero.map((c) => `'${c[0]}'`).join(", ")}.`,
      `Your KEEP spelling doesn't match Step 8. Labels available: ${available.map((c) => `'${c[0]}'`).join(", ")}.`);
  }
  emit(11, { counts: keepCounts, keep, available, dropped: df.length - df2.length });

  // 12
  let balanced;
  if (cfg.balance) {
    const b = balanceRows(df2, Core.makeRng(seed));
    balanced = b.rows;
    emit(12, { smallest: b.smallest, counts: Core.valueCounts(balanced.map((d) => d.label)), dropped: df2.length - balanced.length, balanced: true });
  } else {
    balanced = Core.shuffle(df2, Core.makeRng(seed));
    emit(12, { counts: Core.valueCounts(balanced.map((d) => d.label)), dropped: 0, balanced: false });
  }

  // 13 + 14
  progress(14, "Training…");
  const r = trainAndGrade(balanced, cfg, Core.makeRng(seed + 1), 13);
  emit(13, { train: r.train.length, test: r.test.length, testCounts: r.testCounts, testSize: cfg.testSize });
  emit(14, {
    vocab: r.vec.terms.length, classes: r.classes, iterations: r.clf.iterations, converged: r.clf.converged,
    ms: r.trainMs, top: topFeatures(r.vec, r.clf, r.classes, 10),
  });
  const model = { vec: r.vec, clf: r.clf, classes: r.classes, cleaner };

  // 15
  emit(15, { classes: r.classes, cm: r.cm, report: r.report, mistakes: r.mistakes });

  // 16
  const baseline = Math.max(...r.testCounts.map((c) => c[1])) / r.test.length;
  emit(16, { baseline, accuracy: r.report.accuracy, majority: r.testCounts[0][0] });

  // 17
  emit(17, { results: (cfg.sentences || []).filter((s) => s.trim()).map((s) => predictWith(model, s)) });

  // 18
  const allLabels = Core.valueCounts(df.filter((d) => d.label !== null).map((d) => d.label));
  if (allLabels.length < 3) {
    emit(18, { skipped: true, reason: `This dataset has ${allLabels.length} labels after cleaning, so Step 18 doesn't apply.`, labels: allLabels });
  } else {
    progress(18, "Training the multi-class model…");
    const withLabel = df.filter((d) => d.label !== null);
    const b3 = balanceRows(withLabel, Core.makeRng(seed));
    const r3 = trainAndGrade(b3.rows, cfg, Core.makeRng(seed + 1), 18);
    emit(18, { skipped: false, labels: allLabels, smallest: b3.smallest, classes: r3.classes, cm: r3.cm, report: r3.report, vocab: r3.vec.terms.length });
  }

  return model;
}

function previewSource(text, ds) {
  const table = readTable(text, ds);
  const stats = table.columns.map((name, c) => {
    const counts = new Map();
    let totalLen = 0, nonNull = 0;
    for (const row of table.rows) {
      const v = row[c];
      if (v === null) continue;
      nonNull++;
      totalLen += v.length;
      if (counts.size <= 50) counts.set(v, (counts.get(v) || 0) + 1);
      else if (counts.has(v)) counts.set(v, counts.get(v) + 1);
    }
    const unique = counts.size > 50 ? "50+" : counts.size;
    const top = counts.size <= 50 ? Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20) : [];
    return { name, unique, avgLen: nonNull ? totalLen / nonNull : 0, top };
  });
  return {
    columns: table.columns, rowCount: table.rows.length, sep: table.sep, stats,
    head: table.rows.slice(0, 5).map((r) => r.map((v) => trunc(v, 90))),
  };
}

if (IN_WORKER) {
  let model = null;
  self.onmessage = async (e) => {
    const msg = e.data;
    try {
      if (msg.type === "run") {
        model = null;
        model = await runPipeline(
          msg.config,
          (step, data) => self.postMessage({ type: "step", runId: msg.runId, step, data }),
          (step, text) => self.postMessage({ type: "progress", runId: msg.runId, step, text }),
        );
        self.postMessage({ type: "done", runId: msg.runId });
      } else if (msg.type === "predict") {
        if (!model) throw new Error("Run the checklist first to train a model.");
        self.postMessage({ type: "predictions", id: msg.id, results: msg.sentences.map((s) => predictWith(model, s)) });
      } else if (msg.type === "clean") {
        const output = Core.makeCleaner({ keepNegations: msg.keepNegations })(msg.text || "");
        self.postMessage({ type: "cleaned", id: msg.id, output });
      } else if (msg.type === "preview") {
        const text = await loadText(msg.source);
        self.postMessage({ type: "preview", id: msg.id, preview: previewSource(text, msg.source) });
      }
    } catch (err) {
      self.postMessage({ type: "error", runId: msg.runId, id: msg.id, step: err.step || null, message: err.message, hint: err.hint || null });
    }
  };
} else {
  module.exports = { runPipeline, previewSource, readTable, predictWith };
}
