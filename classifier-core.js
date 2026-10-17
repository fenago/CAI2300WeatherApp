// Text-classification engine: a faithful JavaScript port of the Pre-Flight Checklist pipeline
// (pandas read_csv -> NLTK stopwords + PorterStemmer -> sklearn TfidfVectorizer + LogisticRegression).
// Runs in a Web Worker (classifier-worker.js) and in Node for testing.
(function (root) {
  "use strict";

  /* ---------- Seeded random numbers (stand-in for random_state) ---------- */
  function makeRng(seed) {
    let a = (Number(seed) || 0) >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function sample(arr, n, rand) {
    return shuffle(arr, rand).slice(0, n);
  }

  /* ---------- Reading delimited files (like pd.read_csv) ---------- */
  // pandas turns these strings into NaN by default
  const NA_VALUES = new Set(["", "#N/A", "#N/A N/A", "#NA", "-1.#IND", "-1.#QNAN", "-NaN", "-nan", "1.#IND",
    "1.#QNAN", "<NA>", "N/A", "NA", "NULL", "NaN", "None", "n/a", "nan", "null"]);

  function detectSep(text) {
    const end = text.indexOf("\n");
    const line = end === -1 ? text : text.slice(0, end);
    const counts = { "\t": 0, ",": 0, ";": 0, "|": 0 };
    for (const ch of line) if (ch in counts) counts[ch]++;
    let best = ",";
    for (const k in counts) if (counts[k] > counts[best]) best = k;
    return best;
  }

  // quotes=false is pandas' quoting=3: quote marks are ordinary characters
  function parseDelimited(text, sep, quotes) {
    const rows = [];
    const n = text.length;
    const S = sep.charCodeAt(0), Q = 34, NL = 10;
    let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    let row = [];

    const scanToBoundary = (k) => {
      while (k < n) {
        const d = text.charCodeAt(k);
        if (d === S || d === NL) break;
        k++;
      }
      return k;
    };

    while (i < n) {
      let value;
      if (quotes && text.charCodeAt(i) === Q) {
        let parts = "";
        let start = i + 1, j = start;
        for (;;) {
          const q = text.indexOf('"', j);
          if (q === -1) { parts += text.slice(start); j = n; break; }
          if (text.charCodeAt(q + 1) === Q) { parts += text.slice(start, q + 1); j = q + 2; start = j; continue; }
          parts += text.slice(start, q); j = q + 1; break;
        }
        const k = scanToBoundary(j);
        value = parts + text.slice(j, k);
        i = k;
      } else {
        const k = scanToBoundary(i);
        value = text.slice(i, k);
        i = k;
      }
      if (value.charCodeAt(value.length - 1) === 13) value = value.slice(0, -1);
      row.push(value);

      if (i >= n) break;
      if (text.charCodeAt(i) === S) {
        i++;
        if (i === n) row.push("");
        continue;
      }
      rows.push(row); // newline
      row = [];
      i++;
    }
    if (row.length) rows.push(row);
    // pandas skips blank lines
    return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
  }

  function toTable(rows, header, names) {
    let columns;
    let data = rows;
    if (header) {
      columns = (rows[0] || []).map((c, i) => (c === "" ? `Unnamed: ${i}` : c));
      data = rows.slice(1);
    } else {
      const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
      columns = (names && names.length ? names.slice() : []);
      for (let i = columns.length; i < width; i++) columns.push(String(i));
    }
    const w = columns.length;
    const out = new Array(data.length);
    for (let r = 0; r < data.length; r++) {
      const src = data[r];
      const row = new Array(w);
      for (let c = 0; c < w; c++) {
        const v = src[c];
        row[c] = v === undefined || NA_VALUES.has(v) ? null : v;
      }
      out[r] = row;
    }
    return { columns, rows: out };
  }

  /* ---------- NLTK English stopwords (letters-only entries; cleaning strips apostrophes) ---------- */
  const STOPWORDS = ("a about above after again against ain all am an and any are aren as at be because been before " +
    "being below between both but by can couldn d did didn do does doesn doing don down during each few for from " +
    "further had hadn has hasn have haven having he her here hers herself him himself his how i if in into is isn it " +
    "its itself just ll m ma me mightn more most mustn my myself needn no nor not now o of off on once only or other " +
    "our ours ourselves out over own re s same shan she should shouldn so some such t than that the their theirs them " +
    "themselves then there these they this those through to too under until up ve very was wasn we were weren what " +
    "when where which while who whom why will with won wouldn y you your yours yourself yourselves").split(" ");

  /* ---------- Porter stemmer (NLTK_EXTENSIONS mode, as used by nltk.stem.porter.PorterStemmer) ---------- */
  const IRREGULAR = {
    skies: "sky", sky: "sky", dying: "die", lying: "lie", tying: "tie", news: "news",
    innings: "inning", inning: "inning", outings: "outing", outing: "outing",
    cannings: "canning", canning: "canning", howe: "howe", proceed: "proceed", exceed: "exceed", succeed: "succeed",
  };

  function isCons(w, i) {
    const c = w[i];
    if (c === "a" || c === "e" || c === "i" || c === "o" || c === "u") return false;
    if (c === "y") return i === 0 ? true : !isCons(w, i - 1);
    return true;
  }
  function measure(s) {
    let m = 0;
    for (let i = 1; i < s.length; i++) if (isCons(s, i) && !isCons(s, i - 1)) m++;
    return m;
  }
  function containsVowel(s) {
    for (let i = 0; i < s.length; i++) if (!isCons(s, i)) return true;
    return false;
  }
  function endsDouble(w) {
    const l = w.length;
    return l >= 2 && w[l - 1] === w[l - 2] && isCons(w, l - 1);
  }
  function endsCVC(w) {
    const l = w.length;
    return (l >= 3 && isCons(w, l - 3) && !isCons(w, l - 2) && isCons(w, l - 1) && "wxy".indexOf(w[l - 1]) === -1) ||
      (l === 2 && !isCons(w, 0) && isCons(w, 1));
  }
  const positive = (s) => measure(s) > 0;
  const gt1 = (s) => measure(s) > 1;

  function applyRules(word, rules) {
    for (const [suffix, rep, cond] of rules) {
      if (suffix === "*d" && endsDouble(word)) {
        const stem = word.slice(0, -2);
        return !cond || cond(stem) ? stem + rep : word;
      }
      if (word.endsWith(suffix)) {
        const stem = suffix ? word.slice(0, -suffix.length) : word;
        return !cond || cond(stem) ? stem + rep : word;
      }
    }
    return word;
  }

  function step1a(w) {
    if (w.endsWith("ies") && w.length === 4) return w.slice(0, -3) + "ie";
    return applyRules(w, [["sses", "ss"], ["ies", "i"], ["ss", "ss"], ["s", ""]]);
  }
  function step1b(w) {
    if (w.endsWith("ied")) return w.length === 4 ? w.slice(0, -3) + "ie" : w.slice(0, -3) + "i";
    if (w.endsWith("eed")) {
      const stem = w.slice(0, -3);
      return measure(stem) > 0 ? stem + "ee" : w;
    }
    let mid = null;
    for (const suf of ["ed", "ing"]) {
      if (w.endsWith(suf)) {
        const s = w.slice(0, -suf.length);
        if (containsVowel(s)) { mid = s; break; }
      }
    }
    if (mid === null) return w;
    const last = mid[mid.length - 1];
    return applyRules(mid, [
      ["at", "ate"], ["bl", "ble"], ["iz", "ize"],
      ["*d", last, () => last !== "l" && last !== "s" && last !== "z"],
      ["", "e", (s) => measure(s) === 1 && endsCVC(s)],
    ]);
  }
  function step1c(w) {
    return applyRules(w, [["y", "i", (s) => s.length > 1 && isCons(s, s.length - 1)]]);
  }
  function step2(w) {
    if (w.endsWith("alli") && positive(w.slice(0, -4))) return step2(w.slice(0, -4) + "al");
    return applyRules(w, [
      ["ational", "ate", positive], ["tional", "tion", positive], ["enci", "ence", positive], ["anci", "ance", positive],
      ["izer", "ize", positive], ["bli", "ble", positive], ["alli", "al", positive], ["entli", "ent", positive],
      ["eli", "e", positive], ["ousli", "ous", positive], ["ization", "ize", positive], ["ation", "ate", positive],
      ["ator", "ate", positive], ["alism", "al", positive], ["iveness", "ive", positive], ["fulness", "ful", positive],
      ["ousness", "ous", positive], ["aliti", "al", positive], ["iviti", "ive", positive], ["biliti", "ble", positive],
      ["fulli", "ful", positive], ["logi", "log", () => positive(w.slice(0, -3))],
    ]);
  }
  function step3(w) {
    return applyRules(w, [
      ["icate", "ic", positive], ["ative", "", positive], ["alize", "al", positive], ["iciti", "ic", positive],
      ["ical", "ic", positive], ["ful", "", positive], ["ness", "", positive],
    ]);
  }
  function step4(w) {
    return applyRules(w, [
      ["al", "", gt1], ["ance", "", gt1], ["ence", "", gt1], ["er", "", gt1], ["ic", "", gt1], ["able", "", gt1],
      ["ible", "", gt1], ["ant", "", gt1], ["ement", "", gt1], ["ment", "", gt1], ["ent", "", gt1],
      ["ion", "", (s) => measure(s) > 1 && (s.endsWith("s") || s.endsWith("t"))],
      ["ou", "", gt1], ["ism", "", gt1], ["ate", "", gt1], ["iti", "", gt1], ["ous", "", gt1], ["ive", "", gt1],
      ["ize", "", gt1],
    ]);
  }
  function step5a(w) {
    if (w.endsWith("e")) {
      const s = w.slice(0, -1);
      const m = measure(s);
      if (m > 1) return s;
      if (m === 1 && !endsCVC(s)) return s;
    }
    return w;
  }
  function step5b(w) {
    return w.endsWith("ll") && measure(w.slice(0, -1)) > 1 ? w.slice(0, -1) : w;
  }

  function stem(word) {
    const w = word.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(IRREGULAR, w)) return IRREGULAR[w];
    if (w.length <= 2) return w;
    return step5b(step5a(step4(step3(step2(step1c(step1b(step1a(w))))))));
  }

  /* ---------- Step 9: the cleaning function ---------- */
  function makeCleaner(opts) {
    const keepNegations = !opts || opts.keepNegations !== false;
    const stops = new Set(STOPWORDS);
    if (keepNegations) ["not", "no", "nor"].forEach((w) => stops.delete(w));
    const cache = new Map();
    return function clean(text) {
      text = String(text)
        .replace(/’/g, "'")
        .replace(/http\S+|www\.\S+/g, " ")
        .replace(/@\w+/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/n't\b/g, " not")
        .replace(/[^a-zA-Z]/g, " ");
      const words = text.toLowerCase().split(" ");
      const out = [];
      for (const w of words) {
        if (!w || stops.has(w)) continue;
        let s = cache.get(w);
        if (s === undefined) { s = stem(w); cache.set(w, s); }
        out.push(s);
      }
      return out.join(" ");
    };
  }

  /* ---------- TfidfVectorizer(ngram_range=(1, n), min_df=k) ---------- */
  // sklearn's default token_pattern keeps tokens of 2+ word characters, then builds n-grams from them
  function analyze(doc, ngramMax) {
    const toks = doc.split(" ").filter((t) => t.length >= 2);
    if (ngramMax <= 1) return toks;
    const grams = toks.slice();
    for (let n = 2; n <= ngramMax; n++) {
      for (let i = 0; i + n <= toks.length; i++) grams.push(toks.slice(i, i + n).join(" "));
    }
    return grams;
  }

  function TfidfVectorizer(opts) {
    this.ngramMax = (opts && opts.ngramMax) || 2;
    this.minDf = (opts && opts.minDf) || 1;
  }
  TfidfVectorizer.prototype.fit = function (docs) {
    const df = new Map();
    for (const d of docs) {
      for (const t of new Set(analyze(d, this.ngramMax))) df.set(t, (df.get(t) || 0) + 1);
    }
    const terms = [];
    for (const [t, c] of df) if (c >= this.minDf) terms.push(t);
    terms.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const n = docs.length;
    this.terms = terms;
    this.vocab = new Map(terms.map((t, i) => [t, i]));
    this.idf = new Float64Array(terms.length);
    terms.forEach((t, i) => { this.idf[i] = Math.log((1 + n) / (1 + df.get(t))) + 1; });
    return this;
  };
  // Returns a CSR sparse matrix: rows are documents, l2-normalized TF-IDF weights
  TfidfVectorizer.prototype.transform = function (docs) {
    const indptr = new Int32Array(docs.length + 1);
    const idx = [];
    const val = [];
    for (let r = 0; r < docs.length; r++) {
      const counts = new Map();
      for (const t of analyze(docs[r], this.ngramMax)) {
        const j = this.vocab.get(t);
        if (j !== undefined) counts.set(j, (counts.get(j) || 0) + 1);
      }
      const cols = Array.from(counts.keys()).sort((a, b) => a - b);
      let norm = 0;
      const start = val.length;
      for (const j of cols) {
        const v = counts.get(j) * this.idf[j];
        idx.push(j); val.push(v); norm += v * v;
      }
      norm = Math.sqrt(norm);
      if (norm > 0) for (let k = start; k < val.length; k++) val[k] /= norm;
      indptr[r + 1] = val.length;
    }
    return { rows: docs.length, cols: this.terms.length, indptr, indices: Int32Array.from(idx), data: Float64Array.from(val) };
  };

  /* ---------- L-BFGS minimizer ---------- */
  function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

  function lbfgs(fg, x0, opts) {
    const maxIter = opts.maxIter || 100, m = 10, gtol = opts.gtol || 1e-6, ftol = 1e-12;
    const dim = x0.length;
    let x = x0;
    let [f, g] = fg(x);
    const S = [], Y = [], R = [];
    let iter = 0, converged = false;
    for (; iter < maxIter; iter++) {
      let gmax = 0;
      for (let i = 0; i < dim; i++) gmax = Math.max(gmax, Math.abs(g[i]));
      if (gmax <= gtol) { converged = true; break; }

      // Two-loop recursion: d = -H * g
      const q = Float64Array.from(g);
      const alpha = new Array(S.length);
      for (let k = S.length - 1; k >= 0; k--) {
        alpha[k] = R[k] * dot(S[k], q);
        const y = Y[k];
        for (let i = 0; i < dim; i++) q[i] -= alpha[k] * y[i];
      }
      const gamma = S.length ? dot(S[S.length - 1], Y[Y.length - 1]) / dot(Y[Y.length - 1], Y[Y.length - 1]) : 1;
      for (let i = 0; i < dim; i++) q[i] *= gamma;
      for (let k = 0; k < S.length; k++) {
        const b = R[k] * dot(Y[k], q);
        const s = S[k];
        for (let i = 0; i < dim; i++) q[i] += s[i] * (alpha[k] - b);
      }
      for (let i = 0; i < dim; i++) q[i] = -q[i];
      let gd = dot(g, q);
      if (!(gd < 0)) { // not a descent direction: restart with steepest descent
        S.length = Y.length = R.length = 0;
        for (let i = 0; i < dim; i++) q[i] = -g[i];
        gd = dot(g, q);
      }

      // Backtracking line search (Armijo)
      let step = S.length ? 1 : Math.min(1, 1 / Math.sqrt(-gd));
      let xn, fn, gn, ok = false;
      for (let ls = 0; ls < 40; ls++) {
        xn = new Float64Array(dim);
        for (let i = 0; i < dim; i++) xn[i] = x[i] + step * q[i];
        [fn, gn] = fg(xn);
        if (fn <= f + 1e-4 * step * gd) { ok = true; break; }
        step *= 0.5;
      }
      if (!ok) { converged = true; break; }

      const s = new Float64Array(dim), y = new Float64Array(dim);
      for (let i = 0; i < dim; i++) { s[i] = xn[i] - x[i]; y[i] = gn[i] - g[i]; }
      const sy = dot(s, y);
      if (sy > 1e-10) {
        S.push(s); Y.push(y); R.push(1 / sy);
        if (S.length > m) { S.shift(); Y.shift(); R.shift(); }
      }
      const fOld = f;
      x = xn; f = fn; g = gn;
      if ((fOld - f) / Math.max(Math.abs(fOld), Math.abs(f), 1) <= ftol) { iter++; converged = true; break; }
    }
    return { x, f, iterations: iter, converged };
  }

  /* ---------- LogisticRegression(C=1.0, lbfgs, L2) ---------- */
  // Objective matches modern scikit-learn: mean log-loss + ||w||^2 / (2 * C * n); intercepts are not penalized.
  function LogisticRegression(opts) {
    this.C = (opts && opts.C) || 1.0;
    this.maxIter = (opts && opts.maxIter) || 1000;
  }

  LogisticRegression.prototype.fit = function (X, y, nClasses) {
    const n = X.rows, D = X.cols, C = this.C;
    const { indptr, indices, data } = X;
    this.nClasses = nClasses;
    this.D = D;
    const reg = 1 / (C * n);

    if (nClasses === 2) {
      const fg = (p) => {
        const b = p[D];
        const g = new Float64Array(D + 1);
        let loss = 0;
        for (let r = 0; r < n; r++) {
          let z = b;
          for (let k = indptr[r]; k < indptr[r + 1]; k++) z += p[indices[k]] * data[k];
          // softplus(z) - y*z, computed stably
          loss += (z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z))) - y[r] * z;
          const resid = 1 / (1 + Math.exp(-z)) - y[r];
          for (let k = indptr[r]; k < indptr[r + 1]; k++) g[indices[k]] += resid * data[k];
          g[D] += resid;
        }
        let wsq = 0;
        for (let j = 0; j < D; j++) { wsq += p[j] * p[j]; g[j] = g[j] / n + reg * p[j]; }
        g[D] /= n;
        return [loss / n + 0.5 * reg * wsq, g];
      };
      const res = lbfgs(fg, new Float64Array(D + 1), { maxIter: this.maxIter });
      this.coef = [res.x.subarray(0, D)];
      this.intercept = [res.x[D]];
      this.iterations = res.iterations;
      this.converged = res.converged;
      return this;
    }

    // Multinomial (softmax) for 3+ classes
    const K = nClasses;
    const fg = (p) => {
      const g = new Float64Array(K * D + K);
      const z = new Float64Array(K);
      let loss = 0;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < K; c++) {
          let s = p[K * D + c];
          const off = c * D;
          for (let k = indptr[r]; k < indptr[r + 1]; k++) s += p[off + indices[k]] * data[k];
          z[c] = s;
        }
        let mx = -Infinity;
        for (let c = 0; c < K; c++) mx = Math.max(mx, z[c]);
        let se = 0;
        for (let c = 0; c < K; c++) se += Math.exp(z[c] - mx);
        loss += mx + Math.log(se) - z[y[r]];
        for (let c = 0; c < K; c++) {
          const resid = Math.exp(z[c] - mx) / se - (c === y[r] ? 1 : 0);
          const off = c * D;
          for (let k = indptr[r]; k < indptr[r + 1]; k++) g[off + indices[k]] += resid * data[k];
          g[K * D + c] += resid;
        }
      }
      let wsq = 0;
      for (let j = 0; j < K * D; j++) { wsq += p[j] * p[j]; g[j] = g[j] / n + reg * p[j]; }
      for (let c = 0; c < K; c++) g[K * D + c] /= n;
      return [loss / n + 0.5 * reg * wsq, g];
    };
    const res = lbfgs(fg, new Float64Array(K * D + K), { maxIter: this.maxIter });
    this.coef = [];
    this.intercept = [];
    for (let c = 0; c < K; c++) {
      this.coef.push(res.x.subarray(c * D, (c + 1) * D));
      this.intercept.push(res.x[K * D + c]);
    }
    this.iterations = res.iterations;
    this.converged = res.converged;
    return this;
  };

  LogisticRegression.prototype.predictProba = function (X) {
    const out = [];
    const { indptr, indices, data } = X;
    for (let r = 0; r < X.rows; r++) {
      if (this.nClasses === 2) {
        let z = this.intercept[0];
        for (let k = indptr[r]; k < indptr[r + 1]; k++) z += this.coef[0][indices[k]] * data[k];
        const p = 1 / (1 + Math.exp(-z));
        out.push([1 - p, p]);
      } else {
        const z = this.coef.map((w, c) => {
          let s = this.intercept[c];
          for (let k = indptr[r]; k < indptr[r + 1]; k++) s += w[indices[k]] * data[k];
          return s;
        });
        const mx = Math.max(...z);
        const e = z.map((v) => Math.exp(v - mx));
        const se = e.reduce((a, b) => a + b, 0);
        out.push(e.map((v) => v / se));
      }
    }
    return out;
  };

  LogisticRegression.prototype.predict = function (X) {
    return this.predictProba(X).map((p) => p.indexOf(Math.max(...p)));
  };

  /* ---------- Metrics ---------- */
  function valueCounts(values) {
    const m = new Map();
    for (const v of values) if (v !== null && v !== undefined) m.set(v, (m.get(v) || 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  }

  function stratifiedSplit(labels, testSize, rand) {
    const n = labels.length;
    const nTest = Math.ceil(testSize * n);
    const classes = Array.from(new Set(labels)).sort();
    const byClass = classes.map((c) => labels.map((l, i) => (l === c ? i : -1)).filter((i) => i >= 0));
    const exact = byClass.map((ix) => (ix.length * nTest) / n);
    const alloc = exact.map(Math.floor);
    let left = nTest - alloc.reduce((a, b) => a + b, 0);
    const order = exact.map((e, k) => [e - Math.floor(e), k]).sort((a, b) => b[0] - a[0]);
    for (let t = 0; left > 0; t++, left--) alloc[order[t % order.length][1]]++;
    let train = [], test = [];
    byClass.forEach((ix, k) => {
      const s = shuffle(ix, rand);
      test = test.concat(s.slice(0, alloc[k]));
      train = train.concat(s.slice(alloc[k]));
    });
    return { train: shuffle(train, rand), test: shuffle(test, rand) };
  }

  function confusionMatrix(yTrue, yPred, K) {
    const cm = Array.from({ length: K }, () => new Array(K).fill(0));
    for (let i = 0; i < yTrue.length; i++) cm[yTrue[i]][yPred[i]]++;
    return cm;
  }

  function classificationReport(cm, classes) {
    const K = classes.length;
    const total = cm.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0);
    const rows = classes.map((label, k) => {
      const tp = cm[k][k];
      const support = cm[k].reduce((a, b) => a + b, 0);
      const predicted = cm.reduce((s, r) => s + r[k], 0);
      const precision = predicted ? tp / predicted : 0;
      const recall = support ? tp / support : 0;
      const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
      return { label, precision, recall, f1, support };
    });
    const correct = classes.reduce((s, _, k) => s + cm[k][k], 0);
    const avg = (key, weighted) => rows.reduce((s, r) => s + r[key] * (weighted ? r.support / total : 1 / K), 0);
    return {
      rows,
      accuracy: total ? correct / total : 0,
      total,
      macro: { precision: avg("precision"), recall: avg("recall"), f1: avg("f1"), support: total },
      weighted: { precision: avg("precision", true), recall: avg("recall", true), f1: avg("f1", true), support: total },
    };
  }

  const Core = {
    makeRng, shuffle, sample, detectSep, parseDelimited, toTable, STOPWORDS, stem, makeCleaner, analyze,
    TfidfVectorizer, LogisticRegression, lbfgs, valueCounts, stratifiedSplit, confusionMatrix, classificationReport,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof self !== "undefined" ? self : this);
