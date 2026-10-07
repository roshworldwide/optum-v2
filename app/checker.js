/* Sahayak Fraud-Shield, running on the phone: the node's scam check ported to plain JavaScript.
 *
 * A line-for-line port of sahayak/fraud/{normalize,signals,patterns,classifier,verdict,pipeline}.py
 * and parse_upi / rupees / analyse from sahayak/inputs/qr.py, so a phone with no node in reach
 * gives exactly the verdict card the node would. tests/js/parity_fraud.mjs checks every card
 * field against the live Python code (python -m pytest tests/test_js_fraud_parity.py).
 *
 *   const c = SahayakChecker.create({ fraud, patterns, model, fraudSha256 });   // the three packs
 *   const card = c.check(text, { sender: null, inputType: "text" });            // = check_message()
 *   const qr = c.analyseQR(payload);                                            // = qr.analyse()
 *
 * Python and JavaScript read text differently. Each gap is closed here, never papered over:
 *  - Python's \w \W \d \s \b are Unicode-aware; JavaScript's are ASCII. Every regex below is written
 *    exactly as in the Python source and translated by pyRe() into Unicode property classes.
 *  - re.IGNORECASE is expanded by pyRe() into explicit letter sets (Python's 'i' also matches 'ı'
 *    and 'İ'), so \w keeps its Python meaning even in case-insensitive patterns.
 *  - Python indexes strings by code point, JavaScript by UTF-16 unit. Every position, window and
 *    slice here is in code points (PyText), so an emoji never shifts a window.
 *  - str.casefold(), strip(), split(), float(), round() and urllib's query parsing are re-done to
 *    the letter of CPython 3.11.
 *  - The node's Python knows Unicode 14.0; a browser may know a newer version. Characters newer
 *    than Unicode 14 are swapped for private-use stand-ins while checking (Protector), so they stay
 *    the unknown symbols they are to the node.
 *  - scikit-learn's arithmetic (TF-IDF, feature hashing, l2 norms, sparse dot products) is redone
 *    in the same order, including the fused multiply-adds of arm64 builds (option `fused`).
 *
 * Needs lookbehind and \p{...} in regexes: Chrome/Android WebView 64+, Safari/iOS 16.4+, Firefox 78+.
 * This file is UTF-8 (Devanagari is written as is, like the Python).
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SahayakChecker = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ======================================================================= Python string semantics

  // Python's whitespace: str.isspace(), re's \s, str.split() and str.strip() all use this set
  // (JavaScript's \s adds U+FEFF and lacks U+001C-U+001F and U+0085).
  const S = "\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
  // Python's \w: letters (L*), digits and numbers (N*), and "_". Devanagari vowel signs and the
  // virama (Mn/Mc) are not word characters, in Python or here.
  const W = "\\p{L}\\p{N}_";
  // Python's \b, from lookarounds (JavaScript's \b is ASCII-only even with the u flag)
  const B = "(?:(?<=[" + W + "])(?![" + W + "])|(?<![" + W + "])(?=[" + W + "]))";
  const SPACE_RUN = new RegExp("[" + S + "]+", "u");
  const STRIP = new RegExp("^[" + S + "]+|[" + S + "]+$", "gu");
  const IS_SPACE = new RegExp("^[" + S + "]$", "u");
  const HAS_SURROGATE = /[\uD800-\uDFFF]/;

  function pyStrip(s) { return s.replace(STRIP, ""); }
  function pySplit(s) { return s.split(SPACE_RUN).filter(function (w) { return w !== ""; }); }
  function cpLen(s) { return HAS_SURROGATE.test(s) ? Array.from(s).length : s.length; }
  function cpSlice(s, a, b) { return new PyText(s).slice(a, b); }

  /** A string indexed by code point, as Python indexes str. Positions in matches and windows are
   *  code points; u() and c() convert to and from JavaScript's UTF-16 offsets. */
  function PyText(s) {
    this.s = s;
    this.c2u = null; this.u2c = null; this.len = s.length;
    if (!HAS_SURROGATE.test(s)) return;
    const c2u = [], u2c = new Int32Array(s.length + 1);
    let cp = 0;
    for (let u = 0; u < s.length; cp++) {
      c2u.push(u);
      const hi = s.charCodeAt(u);
      const pair = hi >= 0xD800 && hi <= 0xDBFF && u + 1 < s.length && (s.charCodeAt(u + 1) & 0xFC00) === 0xDC00;
      u2c[u] = cp;
      if (pair) u2c[u + 1] = cp;
      u += pair ? 2 : 1;
    }
    c2u.push(s.length); u2c[s.length] = cp;
    this.c2u = c2u; this.u2c = u2c; this.len = cp;
  }
  PyText.prototype.u = function (cp) {  // code point index -> UTF-16 index, clamped as Python clamps
    if (cp < 0) cp = 0; else if (cp > this.len) cp = this.len;
    return this.c2u ? this.c2u[cp] : cp;
  };
  PyText.prototype.c = function (u) { return this.u2c ? this.u2c[u] : u; };
  PyText.prototype.slice = function (a, b) {  // text[a:b]
    const n = this.len;
    if (a === undefined) a = 0; else if (a < 0) a = Math.max(0, n + a);
    if (b === undefined) b = n; else if (b < 0) b = Math.max(0, n + b);
    return a >= b ? "" : this.s.slice(this.u(a), this.u(b));
  };

  // ======================================================================= regexes, read as Python reads them

  const CASE_EXTRA = { i: "I\\u0130\\u0131", k: "K\\u212a", s: "S\\u017f" };
  function caseSet(ch) {  // what re.IGNORECASE lets an ASCII letter match in Python 3.11
    const lo = ch.toLowerCase();
    return lo + (CASE_EXTRA[lo] || lo.toUpperCase());
  }

  /** Translate a Python `re` pattern (str, no flags or IGNORECASE) to an equivalent JavaScript
   *  source for the "u" flag: Unicode \w \W \d \D \s \S \b, Python's "$" (end, or before a final
   *  newline), "." without DOTALL, IGNORECASE as explicit letter sets, and Python's needless escapes
   *  (re.escape writes "\-", "\#", "\&", "\~") as plain characters. */
  function pyRe(src, ignoreCase) {
    let out = "", cls = null;
    const put = function (x) { if (cls) cls.body += x; else out += x; };
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === "\\") {
        const e = src[++i];
        if (e === "w") put(cls ? W : "[" + W + "]");
        else if (e === "s") put(cls ? S : "[" + S + "]");
        else if (e === "d") put("\\p{Nd}");
        else if (!cls && e === "W") put("[^" + W + "]");
        else if (!cls && e === "S") put("[^" + S + "]");
        else if (!cls && e === "D") put("\\P{Nd}");
        else if (!cls && e === "b") put(B);
        else if ("WSDbBAZ".indexOf(e) >= 0) throw new Error("pyRe: unsupported \\" + e + " in " + src);
        else if (/[0-9A-Za-z]/.test(e)) put("\\" + e);  // \n \t \x1c ऀ
        else if ("^$\\.*+?()[]{}|/".indexOf(e) >= 0 || (cls && e === "-")) put("\\" + e);
        else put(e);  // \" \' \- \# \& \~ and the like are plain characters
        continue;
      }
      if (cls) {
        if (c === "]") {
          out += "[" + (cls.neg ? "^" : "") + cls.body + "]";
          cls = null;
        } else if (ignoreCase && /[a-z]/.test(c)) {
          if (src[i + 1] === "-" && /[a-z]/.test(src[i + 2] || "")) {  // a range such as a-z
            const lo = c, hi = src[i + 2];
            cls.body += lo + "-" + hi + lo.toUpperCase() + "-" + hi.toUpperCase();
            for (const k in CASE_EXTRA) if (k >= lo && k <= hi) cls.body += CASE_EXTRA[k].replace(/^[A-Z]/, "");
            i += 2;
          } else cls.body += caseSet(c);
        } else cls.body += c;
        continue;
      }
      if (c === "[") {
        cls = { neg: src[i + 1] === "^", body: "" };
        if (cls.neg) i++;
        continue;
      }
      if (c === "$") out += "(?=\\n?$)";
      else if (c === ".") out += "[^\\n]";
      else if (ignoreCase && /[A-Za-z]/.test(c)) out += "[" + caseSet(c) + "]";
      else out += c;
    }
    if (cls) throw new Error("pyRe: unterminated class in " + src);
    return out;
  }

  /** A compiled Python pattern with search / finditer / match over PyText, honouring Python's
   *  pos and endpos: lookbehinds see text before pos, nothing sees past endpos. */
  function Rx(src, ignoreCase) {
    const js = pyRe(src, !!ignoreCase);
    this.g = new RegExp(js, "gu");
    this.y = new RegExp(js, "yu");
  }
  function clampTo(x, n) { return x < 0 ? 0 : x > n ? n : x; }
  function asText(t) { return t instanceof PyText ? t : new PyText(t); }
  Rx.prototype._window = function (t, pos, endpos) {
    const n = t.len;
    pos = pos === undefined ? 0 : clampTo(pos, n);
    endpos = endpos === undefined ? n : clampTo(endpos, n);
    if (pos > endpos) return null;
    return { s: endpos === n ? t.s : t.s.slice(0, t.u(endpos)), from: t.u(pos) };
  };
  Rx.prototype.search = function (t, pos, endpos) {
    t = asText(t);
    const w = this._window(t, pos, endpos);
    if (!w) return null;
    this.g.lastIndex = w.from;
    const m = this.g.exec(w.s);
    return m ? new Match(t, m) : null;
  };
  Rx.prototype.finditer = function (t, pos, endpos) {
    t = asText(t);
    const w = this._window(t, pos, endpos), out = [];
    if (!w) return out;
    const re = this.g;
    re.lastIndex = w.from;
    let m;
    while ((m = re.exec(w.s)) !== null) {
      out.push(new Match(t, m));
      if (m[0] === "") re.lastIndex += HAS_SURROGATE.test(w.s.charAt(re.lastIndex)) ? 2 : 1;
    }
    return out;
  };
  Rx.prototype.match = function (t, pos) {  // anchored at pos, as Pattern.match(string, pos)
    t = asText(t);
    this.y.lastIndex = t.u(pos || 0);
    const m = this.y.exec(t.s);
    return m ? new Match(t, m) : null;
  };
  Rx.prototype.sub = function (s, repl) { this.g.lastIndex = 0; return s.replace(this.g, repl); };

  function Match(t, m) {
    this.m = m;
    this.start = t.c(m.index);
    this.end = t.c(m.index + m[0].length);
  }
  Match.prototype.group = function (i) {
    const g = this.m[i || 0];
    return g === undefined ? null : g;
  };

  // ======================================================================= numbers, as Python computes them

  /** round(x, nd) for a float: correctly rounded, exact ties to even (toFixed breaks ties upwards). */
  function pyRound(x, nd) {
    if (!isFinite(x) || Math.abs(x) >= 4503599627370496) return x;  // nan, inf, or already an integer
    const scaled = x * Math.pow(2, nd + 1);  // exact
    if (Math.floor(scaled) === scaled && Math.abs(scaled % 2) === 1) {
      // x = odd / 2^(nd+1) is exactly halfway at nd decimals: round half to even
      const y = x * Math.pow(10, nd);  // a half-integer, exact
      let r = Math.floor(y);
      if (r % 2 !== 0) r += 1;
      return r / Math.pow(10, nd);
    }
    return Number(x.toFixed(nd));
  }

  /** round(y) with no digits: the nearest integer, ties to even (y finite). */
  function pyRoundInt(y) {
    if (Math.abs(y) >= 4503599627370496) return y;
    const f = Math.floor(y), d = y - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }

  /** The exact decimal digits of an integer-valued double of any size (str(int(x)) in Python). */
  function intString(x) {
    // below 2^53 String() is exact; above it String() prints the shortest round-trip form, not the integer
    if (Math.abs(x) < 9007199254740992) return String(x === 0 ? 0 : x);
    let neg = x < 0, m = Math.abs(x), e = 0;
    while (m >= 9007199254740992) { m /= 2; e++; }  // exact: m keeps its 53 significant bits
    let digits = String(m).split("").reverse().map(Number);
    for (; e > 0; e--) {  // multiply the decimal digits by 2, e times
      let carry = 0;
      for (let i = 0; i < digits.length; i++) {
        const v = digits[i] * 2 + carry;
        digits[i] = v % 10; carry = v >= 10 ? 1 : 0;
      }
      if (carry) digits.push(carry);
    }
    return (neg ? "-" : "") + digits.reverse().join("");
  }

  // Fused multiply-add, emulated exactly: fma(a, b, c) = a*b + c rounded once. scikit-learn and scipy
  // wheels for arm64 (Apple Silicon, Raspberry Pi) are compiled so that `s += x * y` in their C loops is
  // fused; x86-64 wheels are not. Boldo & Melquiond, "Emulation of FMA and correctly rounded sums:
  // proved algorithms using rounding to odd", IEEE Trans. Computers 57(4), 2008, algorithm 5.4.
  const SPLITTER = 134217729;  // 2^27 + 1
  const F64 = new DataView(new ArrayBuffer(8));
  function fma(a, b, c) {
    const uh = a * b;
    let t = SPLITTER * a;
    const ah = t - (t - a), al = a - ah;
    t = SPLITTER * b;
    const bh = t - (t - b), bl = b - bh;
    const ul = ((ah * bh - uh) + ah * bl + al * bh) + al * bl;  // a*b = uh + ul exactly
    const th = c + uh, bb = th - c;
    const tl = (c - (th - bb)) + (uh - bb);  // c + uh = th + tl exactly
    return th + addRoundToOdd(tl, ul);
  }
  function addRoundToOdd(x, y) {
    const s = x + y, bb = s - x;
    const e = (x - (s - bb)) + (y - bb);  // x + y = s + e exactly
    if (e === 0 || s === 0) return s;
    F64.setFloat64(0, s);
    if (F64.getUint8(7) & 1) return s;  // already odd
    // the other neighbour of x + y, which is odd: one ulp from s toward the exact sum
    let hi = F64.getUint32(0), lo = F64.getUint32(4);
    if ((e > 0) === (s > 0)) { lo = (lo + 1) >>> 0; if (lo === 0) hi = (hi + 1) >>> 0; }
    else { if (lo === 0) hi = (hi - 1) >>> 0; lo = (lo - 1) >>> 0; }
    F64.setUint32(0, hi); F64.setUint32(4, lo);
    return F64.getFloat64(0);
  }

  // Correctly rounded natural log and exp. The node's Python takes them from the C library (macOS libm,
  // glibc), which rounds correctly in all but a handful of cases; V8's Math.log and Math.exp (fdlibm)
  // are off by one unit in the last place for about 2% and 10% of arguments. Computed here in
  // double-double arithmetic (about 106 bits), then rounded once.
  function twoSum(a, b) { const s = a + b, v = s - a; return [s, (a - (s - v)) + (b - v)]; }
  function fastTwoSum(a, b) { const s = a + b; return [s, b - (s - a)]; }
  function twoProd(a, b) {
    const p = a * b;
    let t = SPLITTER * a;
    const ah = t - (t - a), al = a - ah;
    t = SPLITTER * b;
    const bh = t - (t - b), bl = b - bh;
    return [p, ((ah * bh - p) + ah * bl + al * bh) + al * bl];
  }
  function ddAdd(a, b) {
    const s = twoSum(a[0], b[0]), t = twoSum(a[1], b[1]);
    const r = fastTwoSum(s[0], s[1] + t[0]);
    return fastTwoSum(r[0], r[1] + t[1]);
  }
  function ddMul(a, b) { const p = twoProd(a[0], b[0]); return fastTwoSum(p[0], p[1] + (a[0] * b[1] + a[1] * b[0])); }
  function ddMulNum(a, x) { const p = twoProd(a[0], x); return fastTwoSum(p[0], p[1] + a[1] * x); }
  function ddDiv(a, b) {
    const q1 = a[0] / b[0];
    let r = ddAdd(a, ddMulNum(b, -q1));
    const q2 = r[0] / b[0];
    r = ddAdd(r, ddMulNum(b, -q2));
    return ddAdd(fastTwoSum(q1, q2), [r[0] / b[0], 0]);
  }
  const LN2 = [0.6931471805599453, 2.3190468138462996e-17];
  function crLog(x) {
    if (!(x > 0) || x === Infinity) return Math.log(x);  // nan, zero, negative, infinity
    if (x === 1) return 0;
    let e = 0, m = x;
    if (m < 2.2250738585072014e-308) { m *= 18014398509481984; e -= 54; }  // subnormal: scale by 2^54
    F64.setFloat64(0, m);
    const hi = F64.getUint32(0);
    e += ((hi >>> 20) & 0x7ff) - 1023;
    F64.setUint32(0, (hi & 0x800fffff) | 0x3ff00000);  // m in [1, 2)
    m = F64.getFloat64(0);
    if (m > Math.SQRT2) { m /= 2; e += 1; }
    // log(m) = 2 atanh(s) = 2 (s + s^3/3 + s^5/5 + ...), s = (m - 1) / (m + 1), |s| < 0.172
    const s = ddDiv([m - 1, 0], twoSum(m, 1));
    let sum = s;
    if (s[0] !== 0) {
      const s2 = ddMul(s, s);
      let term = s;
      for (let k = 3; k < 99; k += 2) {
        term = ddMul(term, s2);
        const add = ddDiv(term, [k, 0]);
        sum = ddAdd(sum, add);
        if (Math.abs(add[0]) < 1e-36 * Math.abs(sum[0])) break;
      }
    }
    const r = ddAdd(ddMulNum(LN2, e), ddMulNum(sum, 2));
    return r[0] + r[1];
  }
  function crExp(x) {
    if (x !== x) return x;
    if (x > 709.782712893384) return Infinity;
    if (x < -745.1332191019412) return 0;
    if (x === 0) return 1;
    const k = Math.round(x / LN2[0]);
    let r = ddAdd([x, 0], ddMulNum(LN2, -k));  // x - k ln2
    r = [r[0] / 16, r[1] / 16];
    let term = [1, 0], sum = [1, 0];
    for (let n = 1; n < 40; n++) {  // Taylor series of exp(r / 16)
      term = ddDiv(ddMul(term, r), [n, 0]);
      sum = ddAdd(sum, term);
      if (Math.abs(term[0]) < 1e-36) break;
    }
    for (let i = 0; i < 4; i++) sum = ddMul(sum, sum);  // exp(r) = exp(r / 16)^16
    const y = sum[0] + sum[1];
    return k > 1000 ? y * Math.pow(2, k - 1000) * Math.pow(2, 1000) : y * Math.pow(2, k);
  }
  const LOG_INT = [];
  function logCount(n) {  // ln of a small whole number, cached
    if (n < 4096) return LOG_INT[n] === undefined ? (LOG_INT[n] = crLog(n)) : LOG_INT[n];
    return crLog(n);
  }

  /** MurmurHash3 x86_32 of bytes[from:to], seed 0, as a signed 32-bit int (sklearn's
   *  murmurhash3_bytes_s32). */
  function murmur3(bytes, from, to) {
    const c1 = 0xcc9e2d51, c2 = 0x1b873593, len = to - from;
    let h = 0, i = from, k;
    for (const end4 = from + (len & ~3); i < end4; i += 4) {
      k = bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24);
      k = Math.imul(k, c1); k = (k << 15) | (k >>> 17); k = Math.imul(k, c2);
      h ^= k; h = (h << 13) | (h >>> 19); h = (Math.imul(h, 5) + 0xe6546b64) | 0;
    }
    k = 0;
    switch (len & 3) {
      case 3: k ^= bytes[i + 2] << 16; // falls through
      case 2: k ^= bytes[i + 1] << 8; // falls through
      case 1: k ^= bytes[i]; k = Math.imul(k, c1); k = (k << 15) | (k >>> 17); k = Math.imul(k, c2); h ^= k;
    }
    h ^= len;
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h | 0;
  }

  /** UTF-8 bytes of a word, and the byte offset of each of its code points (reused buffers). */
  let UTF8_BYTES = new Uint8Array(256), UTF8_OFFS = new Int32Array(64);
  function utf8(w) {
    if (UTF8_BYTES.length < w.length * 3 + 4) UTF8_BYTES = new Uint8Array(w.length * 6 + 4);
    if (UTF8_OFFS.length < w.length + 2) UTF8_OFFS = new Int32Array(w.length * 2 + 2);
    const bytes = UTF8_BYTES, offs = UTF8_OFFS;
    let nb = 0, nc = 0;
    for (let i = 0; i < w.length; i++) {
      let c = w.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < w.length && (w.charCodeAt(i + 1) & 0xFC00) === 0xDC00) {
        c = 0x10000 + ((c - 0xD800) << 10) + (w.charCodeAt(++i) - 0xDC00);
      }
      offs[nc++] = nb;
      if (c < 0x80) bytes[nb++] = c;
      else if (c < 0x800) { bytes[nb++] = 0xC0 | (c >> 6); bytes[nb++] = 0x80 | (c & 63); }
      else if (c < 0x10000) { bytes[nb++] = 0xE0 | (c >> 12); bytes[nb++] = 0x80 | ((c >> 6) & 63); bytes[nb++] = 0x80 | (c & 63); }
      else {
        bytes[nb++] = 0xF0 | (c >> 18); bytes[nb++] = 0x80 | ((c >> 12) & 63);
        bytes[nb++] = 0x80 | ((c >> 6) & 63); bytes[nb++] = 0x80 | (c & 63);
      }
    }
    offs[nc] = nb;
    return { bytes: bytes, offs: offs };
  }

  // ======================================================================= Unicode 14, as the node's Python knows it

  // <unicode-tables generated by tests/js/gen_unicode_tables.py>
  // Python 3.11, unicodedata 14.0.0
  const UNICODE_VERSION = "14.0.0";
  const UNASSIGNED = "oo.1 6.3 7.0 1.0 k.0 b1.0 12.1 1e.1 3.0 1j.7 r.3 6.a 7i.0 1o.1 2t.d 1n.1 1d.1 f.0 s.1 1.0 b.4 v.0 2.5 6k.0 8.1 2.1 m.0 7.0 1.2 4.1 9.1 2.1 4.7 1.3 2.0 5.1 p.1 3.0 6.3 2.1 m.0 7.0 2.0 2.0 2.1 1.0 5.3 2.1 3.2 1.6 4.0 1.6 h.9 3.0 9.0 3.0 m.0 7.0 2.0 5.1 a.0 3.0 3.1 1.e 4.1 c.6 7.0 3.0 8.1 2.1 m.0 7.0 2.0 5.1 9.1 2.1 3.6 3.3 2.0 5.1 i.9 2.0 6.2 3.0 4.2 2.0 1.0 2.2 2.2 3.2 c.3 5.2 3.0 4.1 1.5 1.d l.4 d.0 3.0 n.0 g.1 9.0 3.0 4.6 2.0 3.1 1.1 4.1 a.6 m.0 3.0 n.0 a.0 5.1 9.0 3.0 4.6 2.5 2.0 4.1 a.0 2.c d.0 3.0 1f.0 3.0 6.3 g.1 q.0 3.0 i.2 o.0 9.0 1.1 7.2 1.3 6.0 1.0 8.5 a.1 3.b 1m.3 t.10 2.0 1.0 5.0 o.0 1.0 n.1 5.0 1.0 6.1 a.1 4.v 20.0 10.3 13.0 10.0 f.0 d.10 5i.0 1.4 1.1 ah.0 4.1 7.0 1.0 4.1 15.0 4.1 x.0 4.1 7.0 1.0 4.1 f.0 1l.0 4.1 1v.1 w.2 q.5 2e.1 6.1 il.2 2h.6 m.8 o.8 k.b d.0 3.0 2.b 2m.1 a.5 a.5 q.5 2h.6 17.4 1y.9 v.0 c.3 c.3 1.2 16.1 5.a 18.3 q.5 b.2 1q.1 1t.0 t.1 b.5 a.5 e.1 v.1c 25.2 1b.0 38.7 1o.2 f.2 1o.6 17.1 b.7 17.4 eu.1 6.1 12.1 6.1 8.0 1.0 1.0 1.0 v.1 1h.0 f.0 e.1 6.0 j.1 3.0 9.0 2t.0 c.1 r.0 d.2 x.e x.e 3w.3 if.o b.k 1ec.1 w.0 9p.4 19.0 1.4 1.1 1k.6 2.d o.8 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 3i.x q.0 2h.b 5y.p c.3 1s.0 2e.1 2v.4 17.0 2m.0 2c.b 1b.0 mlp.2 1j.8 9o.j 54.7 5n.4 2.0 1.0 5.n 1n.2 a.5 1k.7 1y.7 c.5 38.a u.2 26.0 b.3 x.0 1j.8 e.1 a.1 2v.n s.9 6.1 6.1 6.8 7.0 7.0 1o.3 3i.1 a.5 8mc.b n.3 1d.3 6su.1 2y.11 7.b 5.4 q.0 5.0 1.0 2.0 2.0 3h.f cd.1 1i.6 1.v 16.5 1f.0 j.0 4.3 5.0 3r.1 1.0 5a.2 6.1 6.1 6.1 3.2 7.0 7.9 5.1 c.0 q.0 j.0 2.0 f.1 e.x 3f.4 3.3 19.2 2g.0 d.2 1.1a 1a.3l t.2 1d.e s.3 10.8 u.4 17.4 u.0 11.3 e.15 4e.1 a.5 10.3 10.3 14.7 1g.a c.0 f.0 7.0 2.0 b.0 f.0 7.0 2.1u 8n.8 m.9 8.n 6.0 16.0 9.1w 6.1 1.0 18.0 2.2 1.1 n.0 20.7 9.1b j.0 2.4 x.2 r.4 1.1r 1k.3 k.1 1e.0 2.4 8.0 3.0 t.1 3.3 a.6 9.6 1s.v 13.3 c.8 1i.2 t.1 r.4 q.6 4.b 7.27 21.1i 1f.c 1f.6 1a.7 a.85 v.0 16.0 3.1 2.25 14.7 16.l q.11 s.j n.8 26.3 10.8 1w.9 1.1 p.6 a.5 1h.0 i.7 13.8 2o.0 k.a i.0 18.1s 7.0 1.0 4.0 f.0 b.5 1n.4 a.5 4.0 8.1 2.1 m.0 7.0 2.0 5.0 a.1 2.1 3.1 1.5 1.4 7.1 7.2 5.3u 2k.0 5.t 20.7 a.4l 1i.1 12.x 1x.a a.5 d.i 1m.5 a.1h r.1 f.3 n.54 1o.2r 2b.b 8.1 1.1 8.0 2.0 u.0 2.1 c.8 a.1x 8.1 1a.1 b.q 20.7 2b.c 21.7a 9.0 19.0 e.9 t.2 w.1 m.0 e.20 7.0 2.0 18.2 1.0 2.0 9.7 a.5 6.0 2.0 11.0 2.0 6.6 a.8l p.52 1.e 1e.c pn.2t 33.0 5.a 5g.217 2r.c tr.0 9.346 g7.6ns ft.6 v.0 a.3 29.0 a.5 u.1 6.9 1y.9 a.0 7.0 l.4 j.j3 2j.2s 23.3 1l.6 h.1r 5.a 2.d 4qg.7 ye.15 9.6w6 4.0 7.0 2.0 83.18 3.g 4.7 b0.1s3 2z.4 d.2 9.6 a.1 8.3mj 1a.1 n.8 38.1n 6u.9 13.1 5e.k 1y.49 k.b 2f.8 p.3q 2d.0 1z.0 2.1 1.1 2.1 4.0 c.0 1.0 7.0 1t.0 4.1 8.0 7.0 s.0 4.0 5.0 1.2 7.0 9g.1 84.1 ji.e 5.0 f.un v.68 7.0 h.1 7.0 2.0 5.5w 19.2 e.1 a.3 2.8v v.g 1m.4 1.yn 7.0 4.0 2.0 f.0 5h.1 g.14 24.3 a.3 2.ls 1w.23 1p.5d 4.0 r.0 2.0 1.1 1.0 a.0 4.0 1.0 1.5 1.3 1.0 1.0 1.0 3.0 2.0 1.1 1.0 1.0 1.0 1.0 1.0 2.0 1.1 4.0 7.0 4.0 4.0 1.0 a.0 h.4 3.0 5.0 h.1f 2.7h 18.3 2s.b f.1 f.0 f.0 11.9 4u.1j t.c 18.3 9.6 2.d 6.49 rc.4 g.2 d.2 38.b 2h.6 c.3 1.e c.3 1k.7 a.5 14.7 u.1 2.25 9g.b e.1 5.2 5.2 7.8 t.2 b.4 6.9 a.5 8.7 7.8 43.0 1j.10 a.sl wyo.v 37d.6 66.1 4g2.d 5rl.2e6 f2.15t 3t7.fcfp 1.t 2o.3j 6o.1e6n 1eke.1 1eke.1";
  const FOLD = [[0xdf,"\u{73}\u{73}"],[0x1f0,"\u{6a}\u{30c}"],[0x345,1,0x3b9],[0x390,"\u{3b9}\u{308}\u{301}"],[0x3b0,"\u{3c5}\u{308}\u{301}"],[0x3c2,1,0x3c3],[0x13a0,86,0x13a0],[0x13f8,6,0x13f0],[0x1c80,1,0x432],[0x1c81,1,0x434],[0x1c82,1,0x43e],[0x1c83,2,0x441],[0x1c85,1,0x442],[0x1c86,1,0x44a],[0x1c87,1,0x463],[0x1c88,1,0xa64b],[0x1e96,"\u{68}\u{331}"],[0x1e97,"\u{74}\u{308}"],[0x1e98,"\u{77}\u{30a}"],[0x1e99,"\u{79}\u{30a}"],[0x1e9e,"\u{73}\u{73}"],[0x1f50,"\u{3c5}\u{313}"],[0x1f52,"\u{3c5}\u{313}\u{300}"],[0x1f54,"\u{3c5}\u{313}\u{301}"],[0x1f56,"\u{3c5}\u{313}\u{342}"],[0x1f80,"\u{1f00}\u{3b9}"],[0x1f81,"\u{1f01}\u{3b9}"],[0x1f82,"\u{1f02}\u{3b9}"],[0x1f83,"\u{1f03}\u{3b9}"],[0x1f84,"\u{1f04}\u{3b9}"],[0x1f85,"\u{1f05}\u{3b9}"],[0x1f86,"\u{1f06}\u{3b9}"],[0x1f87,"\u{1f07}\u{3b9}"],[0x1f88,"\u{1f00}\u{3b9}"],[0x1f89,"\u{1f01}\u{3b9}"],[0x1f8a,"\u{1f02}\u{3b9}"],[0x1f8b,"\u{1f03}\u{3b9}"],[0x1f8c,"\u{1f04}\u{3b9}"],[0x1f8d,"\u{1f05}\u{3b9}"],[0x1f8e,"\u{1f06}\u{3b9}"],[0x1f8f,"\u{1f07}\u{3b9}"],[0x1f90,"\u{1f20}\u{3b9}"],[0x1f91,"\u{1f21}\u{3b9}"],[0x1f92,"\u{1f22}\u{3b9}"],[0x1f93,"\u{1f23}\u{3b9}"],[0x1f94,"\u{1f24}\u{3b9}"],[0x1f95,"\u{1f25}\u{3b9}"],[0x1f96,"\u{1f26}\u{3b9}"],[0x1f97,"\u{1f27}\u{3b9}"],[0x1f98,"\u{1f20}\u{3b9}"],[0x1f99,"\u{1f21}\u{3b9}"],[0x1f9a,"\u{1f22}\u{3b9}"],[0x1f9b,"\u{1f23}\u{3b9}"],[0x1f9c,"\u{1f24}\u{3b9}"],[0x1f9d,"\u{1f25}\u{3b9}"],[0x1f9e,"\u{1f26}\u{3b9}"],[0x1f9f,"\u{1f27}\u{3b9}"],[0x1fa0,"\u{1f60}\u{3b9}"],[0x1fa1,"\u{1f61}\u{3b9}"],[0x1fa2,"\u{1f62}\u{3b9}"],[0x1fa3,"\u{1f63}\u{3b9}"],[0x1fa4,"\u{1f64}\u{3b9}"],[0x1fa5,"\u{1f65}\u{3b9}"],[0x1fa6,"\u{1f66}\u{3b9}"],[0x1fa7,"\u{1f67}\u{3b9}"],[0x1fa8,"\u{1f60}\u{3b9}"],[0x1fa9,"\u{1f61}\u{3b9}"],[0x1faa,"\u{1f62}\u{3b9}"],[0x1fab,"\u{1f63}\u{3b9}"],[0x1fac,"\u{1f64}\u{3b9}"],[0x1fad,"\u{1f65}\u{3b9}"],[0x1fae,"\u{1f66}\u{3b9}"],[0x1faf,"\u{1f67}\u{3b9}"],[0x1fb2,"\u{1f70}\u{3b9}"],[0x1fb3,"\u{3b1}\u{3b9}"],[0x1fb4,"\u{3ac}\u{3b9}"],[0x1fb6,"\u{3b1}\u{342}"],[0x1fb7,"\u{3b1}\u{342}\u{3b9}"],[0x1fbc,"\u{3b1}\u{3b9}"],[0x1fc2,"\u{1f74}\u{3b9}"],[0x1fc3,"\u{3b7}\u{3b9}"],[0x1fc4,"\u{3ae}\u{3b9}"],[0x1fc6,"\u{3b7}\u{342}"],[0x1fc7,"\u{3b7}\u{342}\u{3b9}"],[0x1fcc,"\u{3b7}\u{3b9}"],[0x1fd2,"\u{3b9}\u{308}\u{300}"],[0x1fd6,"\u{3b9}\u{342}"],[0x1fd7,"\u{3b9}\u{308}\u{342}"],[0x1fe2,"\u{3c5}\u{308}\u{300}"],[0x1fe4,"\u{3c1}\u{313}"],[0x1fe6,"\u{3c5}\u{342}"],[0x1fe7,"\u{3c5}\u{308}\u{342}"],[0x1ff2,"\u{1f7c}\u{3b9}"],[0x1ff3,"\u{3c9}\u{3b9}"],[0x1ff4,"\u{3ce}\u{3b9}"],[0x1ff6,"\u{3c9}\u{342}"],[0x1ff7,"\u{3c9}\u{342}\u{3b9}"],[0x1ffc,"\u{3c9}\u{3b9}"],[0xab70,80,0x13a0]];
  const ZEROS = [0x30,0x660,0x6f0,0x7c0,0x966,0x9e6,0xa66,0xae6,0xb66,0xbe6,0xc66,0xce6,0xd66,0xde6,0xe50,0xed0,0xf20,0x1040,0x1090,0x17e0,0x1810,0x1946,0x19d0,0x1a80,0x1a90,0x1b50,0x1bb0,0x1c40,0x1c50,0xa620,0xa8d0,0xa900,0xa9d0,0xa9f0,0xaa50,0xabf0,0xff10,0x104a0,0x10d30,0x11066,0x110f0,0x11136,0x111d0,0x112f0,0x11450,0x114d0,0x11650,0x116c0,0x11730,0x118e0,0x11950,0x11c50,0x11d50,0x11da0,0x16a60,0x16ac0,0x16b50,0x1d7ce,0x1d7d8,0x1d7e2,0x1d7ec,0x1d7f6,0x1e140,0x1e2f0,0x1e950,0x1fbf0];
  // </unicode-tables>

  let U14 = null;
  function u14() {
    if (U14) return U14;
    const hex = function (cp) { return "\\u{" + cp.toString(16) + "}"; };
    let prev = -1, cls = "";
    UNASSIGNED.split(" ").forEach(function (tok) {
      const p = tok.split(".");
      const a = prev + 1 + parseInt(p[0], 36), b = a + parseInt(p[1], 36);
      cls += a === b ? hex(a) : hex(a) + "-" + hex(b);
      prev = b;
    });
    const fold = new Map();
    FOLD.forEach(function (e) {
      if (typeof e[1] === "string") fold.set(String.fromCodePoint(e[0]), e[1]);
      else for (let k = 0; k < e[1]; k++) fold.set(String.fromCodePoint(e[0] + k), String.fromCodePoint(e[2] + k));
    });
    let foldCls = "";
    fold.forEach(function (v, k) { foldCls += hex(k.codePointAt(0)); });
    U14 = {
      unassigned: new RegExp("[" + cls + "]", "u"),
      unassignedG: new RegExp("[" + cls + "]", "gu"),
      fold: fold,
      foldTest: new RegExp("[" + foldCls + "]", "u"),
    };
    return U14;
  }

  /** str.casefold(): toLowerCase() plus the full case foldings it lacks (ß -> ss, ς -> σ, Cherokee
   *  -> capitals, Greek iota subscripts). Both are per-character except JavaScript's final sigma. */
  function casefold(s) {
    const T = u14();
    if (!T.foldTest.test(s)) return s.toLowerCase().replace(/ς/g, "σ");
    let out = "";
    for (const ch of s) {
      const f = T.fold.get(ch);
      out += f !== undefined ? f : ch.toLowerCase();
    }
    return out;
  }

  /** The value of a Unicode 14 decimal digit (category Nd), or -1. */
  function decimalValue(cp) {
    let lo = 0, hi = ZEROS.length - 1, z = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ZEROS[mid] <= cp) { z = ZEROS[mid]; lo = mid + 1; } else hi = mid - 1;
    }
    return z >= 0 && cp - z <= 9 ? cp - z : -1;
  }
  function asciiDigits(s) {  // what Python's float()/int() read from any decimal digits
    return s.replace(/\p{Nd}/gu, function (d) { return String(decimalValue(d.codePointAt(0))); });
  }

  const PUA_B = /[\u{100000}-\u{10fffd}]/gu;
  const ENGINE_UNASSIGNED = /^\p{Cn}$/u;
  /** Characters assigned after Unicode 14 are unknown to the node's Python: not letters, not
   *  digits, no case, no decomposition. While a message is checked they are replaced by
   *  private-use stand-ins that a browser treats the same way, then put back in the card.
   *  Code points this browser does not know either are left alone: they already behave alike,
   *  and Python's explicit ranges such as [Ͱ-Ͽ] still contain them. */
  function Protector(strings) {
    this.fwd = null;
    const T = u14();
    if (!strings.some(function (s) { return typeof s === "string" && T.unassigned.test(s); })) return;
    this.fwd = new Map(); this.back = new Map(); this.next = 0x100000; this.taken = new Set();
    for (const s of strings) if (typeof s === "string") (s.match(PUA_B) || []).forEach(this.taken.add, this.taken);
  }
  Protector.prototype.wrap = function (s) {
    if (!this.fwd || typeof s !== "string") return s;
    const self = this;
    return s.replace(U14.unassignedG, function (ch) {
      if (ENGINE_UNASSIGNED.test(ch)) return ch;
      let p = self.fwd.get(ch);
      if (p === undefined) {
        do { p = String.fromCodePoint(self.next++); } while (self.taken.has(p));
        self.fwd.set(ch, p); self.back.set(p, ch);
      }
      return p;
    });
  };
  Protector.prototype.unwrap = function (s) {
    if (!this.fwd || typeof s !== "string") return s;
    const back = this.back;
    return s.replace(PUA_B, function (ch) { const o = back.get(ch); return o === undefined ? ch : o; });
  };
  const NO_PROTECTION = new Protector([]);

  // ======================================================================= normalize.py

  const DEVANAGARI = "ऀ-ॿ";

  // Lowercase Cyrillic/Greek letters that render like Latin ones (applied after casefold).
  const HOMOGLYPHS = {
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "к": "k",
    "м": "m", "т": "t", "в": "b", "н": "h", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d",
    "ӏ": "l", "ο": "o", "ν": "v", "α": "a", "ε": "e", "ι": "i", "κ": "k", "ρ": "p",
    "τ": "t", "υ": "u", "χ": "x",
  };
  const HOMOGLYPH_RE = new RegExp("[" + Object.keys(HOMOGLYPHS).join("") + "]", "g");
  const CONFUSABLE_SCRIPTS = /[Ͱ-ϿЀ-ӿ]/;
  const LATIN = /[A-Za-z]/;

  // Devanagari digits (some Hindi SMS, and what OCR returns for Hindi screenshots) read as 0-9,
  // so phone numbers, amounts and codes are found whichever digits a message uses.
  const DEV_DIGITS_RE = /[०-९]/g;

  /** fold(): NFKC, casefolded, look-alike Cyrillic/Greek letters mapped to Latin, Hindi nukta dropped
   *  and chandrabindu written as anusvara, links un-defanged, leetspeak undone. */
  function fold(text) {
    text = casefold(text.normalize("NFKC"));
    text = text.replace(HOMOGLYPH_RE, function (c) { return HOMOGLYPHS[c]; })
      .replace(DEV_DIGITS_RE, function (d) { return String(d.charCodeAt(0) - 0x966); });
    // Hindi: drop nukta (फ़ -> फ), chandrabindu -> anusvara (एँ -> एं)
    text = text.normalize("NFD").split("़").join("");
    text = text.normalize("NFC").split("ँ").join("ं");
    text = text.replace(/’/g, "'").replace(/‘/g, "'").replace(/“/g, '"').replace(/”/g, '"');
    text = text.replace(/[ \t ]+/g, " ");
    text = defang(text);
    text = WORD.sub(text, deleet);
    return pyStrip(text);
  }

  const TLDS = (
    "com|in|net|org|xyz|top|online|site|club|icu|live|shop|info|buzz|click|link|vip|rest|work|me|co|" +
    "io|ly|gl|cc|tk|ml|ga|cf|gq|app|page|biz|ws|to|gd|su|ru|cn|support|help|monster|cyou|sbs|cfd|quest|" +
    "bond|win|loan|cam|today|store|space|website|fun|pw|at|id|gy|ae|be|st|us|uk|sh|sbi|bank|gov|nic|fin"
  );

  // Links written so filters miss them: "hxxp://", "site[.]top", "site (dot) top", "site dot top".
  const HXXP = new Rx(String.raw`\bhxxp(s?)://`);
  const BRACKET_DOT = new Rx(String.raw`\s*[\[({]\s*(?:\.|dot)\s*[\])}]\s*`);
  const WORD_DOT = new Rx(String.raw`(?<=[a-z0-9])\s+dot\s+(?=(?:` + TLDS + String.raw`)\b)`);
  function defang(text) {
    text = HXXP.sub(text, "http$1://");
    text = BRACKET_DOT.sub(text, ".");
    return WORD_DOT.sub(text, ".");
  }

  // Digits written for letters inside words: "0TP", "bl0cked", "upd4te". Only in words that are mostly
  // letters, only for a digit between two letters (or a leading 0), and never inside a link, so codes,
  // masked numbers ("XX4421") and amounts stay as they are.
  const WORD = new Rx(String.raw`(?<![\w/.-])[a-z0-9]{3,}(?![\w/-]|\.\w)`);
  const LEET = { "0": "o", "3": "e", "4": "a", "5": "s" };
  function isAlpha(c) { return c >= "a" && c <= "z"; }  // the words here are [a-z0-9] only
  function deleet(word) {
    let letters = 0;
    for (const c of word) if (isAlpha(c)) letters++;
    if (!letters || letters === word.length || letters <= word.length - letters) return word;
    const out = word.split("");
    for (let i = 0; i < word.length; i++) {
      const c = word[i];
      const nxt = i + 1 < word.length && isAlpha(word[i + 1]);
      if (LEET[c] && nxt && ((i > 0 && isAlpha(word[i - 1])) || (i === 0 && c === "0"))) out[i] = LEET[c];
    }
    return out.join("");
  }

  /** Tokens that mix Latin with Cyrillic/Greek letters, e.g. 'SВI' with a Cyrillic В. */
  const TOKEN = new Rx(String.raw`[^\s.,!?:;()\"'/]+`);
  function mixedScriptTokens(text) {
    return TOKEN.finditer(text.normalize("NFKC")).map(function (m) { return m.group(0); })
      .filter(function (tok) { return LATIN.test(tok) && CONFUSABLE_SCRIPTS.test(tok); });
  }

  // ---------------------------------------------------------------- links

  const URL_RE = new Rx(
    String.raw`(?:https?://|www\.)[^\s<>\"'()]+` +
    String.raw`|\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{2,5})?/[^\s<>\"'()]*` +
    String.raw`|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:` + TLDS + String.raw`)\b(?::\d{2,5})?(?:/[^\s<>\"'()]*)?`,
    true);
  const IPV4 = new Rx(String.raw`^\d{1,3}(?:\.\d{1,3}){3}$`);
  const SCHEME = new Rx(String.raw`^(?:https?://)`, true);
  const URL_TRAIL = ".,;:!?)]}\"'";

  function Url(raw, host, path) {
    this.raw = raw; this.host = host; this.path = path;
    this.isIp = !!IPV4.match(host, 0);
    const dot = host.lastIndexOf(".");
    this.tld = dot >= 0 ? host.slice(dot + 1) : host;
  }

  function extractUrls(t) {
    const urls = [], seen = new Set();
    for (const m of URL_RE.finditer(t)) {
      let raw = m.group(0);
      let end = raw.length;
      while (end > 0 && URL_TRAIL.indexOf(raw[end - 1]) >= 0) end--;  // rstrip(".,;:!?)]}\"'")
      raw = raw.slice(0, end);
      const rest = SCHEME.sub(raw, "");
      const slash = rest.indexOf("/");
      let host = slash >= 0 ? rest.slice(0, slash) : rest;
      const path = slash >= 0 ? rest.slice(slash + 1) : "";
      host = host.split(":")[0].toLowerCase();
      if (host.startsWith("www.")) host = host.slice(4);
      if (!host || seen.has(host)) continue;
      seen.add(host);
      urls.push(new Url(raw, host, path ? "/" + path : ""));
    }
    return urls;
  }

  // ---------------------------------------------------------------- numbers, money, UPI IDs

  const MOBILE_RE = new Rx(String.raw`(?<![\d])(?:\+?91[\s-]?|0)?([6-9]\d{4}[\s-]?\d{5})(?![\d])`);
  const TOLLFREE_RE = new Rx(String.raw`(?<!\d)(18[06]0[\s-]?\d{3}[\s-]?\d{3,4})(?!\d)`);
  const SERIES1600_RE = new Rx(String.raw`(?<!\d)(1600\d{6})(?!\d)`);
  const DLT_SENDER_RE = new Rx(String.raw`^[a-z]{2}-[a-z0-9]{3,9}(?:-[pstg])?$`, true);
  const AMOUNT_RE = new Rx(
    String.raw`(?:₹|\brs\.?|\binr|\brupees?|रु\.?|रुपये|रुपए)\s?(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?` +
    String.raw`(?:\s*(lakh|lac|crore|cr|लाख|करोड़|करोड))?`,
    true);
  const UPI_RE = new Rx(String.raw`(?<![\w.@-])([a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,63})(?![\w@]|\.[a-z])`, true);
  const NON_DIGITS = /\P{Nd}/gu;
  function digitsOnly(s) { return s.replace(NON_DIGITS, ""); }  // re.sub(r"\D", "", s)

  function extractMobiles(t) {
    const found = [];
    for (const m of MOBILE_RE.finditer(t)) {
      const digits = digitsOnly(m.group(1));
      if (found.indexOf(digits) < 0) found.push(digits);
    }
    return found;
  }
  function extractTollfree(t) { return TOLLFREE_RE.finditer(t).map(function (m) { return digitsOnly(m.group(1)); }); }
  function extract1600(t) { return SERIES1600_RE.finditer(t).map(function (m) { return m.group(1); }); }

  function amountValue(m) {
    let value = Number(asciiDigits(m.group(1).split(",").join("") + (m.group(2) ? "." + m.group(2) : "")));
    const unit = (m.group(3) || "").toLowerCase();
    if (unit === "lakh" || unit === "lac" || unit === "लाख") value *= 1e5;
    else if (unit === "crore" || unit === "cr" || unit === "करोड़" || unit === "करोड") value *= 1e7;
    return value;
  }

  function extractAmounts(t) {
    return AMOUNT_RE.finditer(t).map(amountValue);
  }

  // Money at risk is what a message asks the reader to pay or send, not the prize, loan or "case" it names
  // (normalize.py rupees_at_risk): each amount takes the nearest cue word in its sentence; a fee wins a tie.
  const SENTENCE_END = new Rx(String.raw`[.!?।\n]`);
  const PAY_CUE = new Rx(
    String.raw`(?<![a-z])(?:pay|paying|payment|send|transfer|deposit|fees?|charges?|fine|penalty|bhejo|bhejein|bhejiye|bhej|` +
    String.raw`jama|bharo|bharein|bharna|shulk)(?![a-z])|भेज|जमा|भुगतान|शुल्क|फीस|जुर्माना|चार्ज`);
  const BAIT_CUE = new Rx(
    String.raw`(?<![a-z])(?:won|win|winning|winner|prize|lottery|jackpot|reward|cashback|bonus|loan|limit|lucky|inaam|salary|` +
    String.raw`earn|earning|income|profit|returns?)(?![a-z])|इनाम|जीत|लॉटरी|लोन|कमा|मुनाफ`);

  function rupeesAtRisk(t) {
    const demanded = [], plain = [];
    for (const m of AMOUNT_RE.finditer(t)) {
      let start = 0;
      for (const b of SENTENCE_END.finditer(t, 0, m.start)) start = Math.max(start, b.end);
      const after = SENTENCE_END.search(t, m.end);
      const end = after ? after.start : t.len;
      let nearest = null;  // [distance, kind]
      for (const [kind, cue] of [["pay", PAY_CUE], ["bait", BAIT_CUE]]) {
        for (const c of cue.finditer(t, start, end)) {
          const d = c.end <= m.start ? m.start - c.end : Math.max(0, c.start - m.end);
          if (nearest === null || d < nearest[0]) nearest = [d, kind];
        }
      }
      if (nearest === null) plain.push(amountValue(m));
      else if (nearest[1] === "pay") demanded.push(amountValue(m));
    }
    const pool = demanded.length ? demanded : plain.length ? plain : [0.0];
    return Math.max.apply(null, pool);
  }

  function extractUpiIds(t) {
    const out = [];
    for (const m of UPI_RE.finditer(t)) {
      const id = m.group(1).toLowerCase();
      if (out.indexOf(id) < 0) out.push(id);
    }
    return out;
  }

  const FULL_1600 = new RegExp("^1600\\p{Nd}{6}$", "u");
  const FULL_MOBILE = new RegExp("^(?:91|0)?[6-9]\\p{Nd}{9}$", "u");
  const PHONE_CHARS = new RegExp("[\\p{Nd}" + S + "+()-]", "gu");
  /** 'mobile' | 'dlt' (registered business header) | '1600' | 'other' | null. */
  function classifySender(sender) {
    if (!sender) return null;
    const s = pyStrip(sender);
    const digits = digitsOnly(s);
    if (FULL_1600.test(digits)) return "1600";
    if (FULL_MOBILE.test(digits) && s.replace(PHONE_CHARS, "").length === 0) return "mobile";
    if (DLT_SENDER_RE.match(s, 0)) return "dlt";
    return "other";
  }

  // ---------------------------------------------------------------- language

  const HINGLISH_MARKERS = new Set([
    "hai", "hain", "aap", "aapka", "aapke", "aapki", "kar", "karo", "karein", "kare", "ke", "ki", "ka",
    "nahi", "nahin", "mat", "paise", "paisa", "batao", "bhejo", "ho", "gaya", "jayega", "hoga", "kya",
    "se", "ko", "mein", "me", "abhi", "turant", "jaldi", "bhai", "beta", "yeh", "ye", "woh", "aur",
  ]);
  /** 'hi' (Devanagari), 'hinglish' (romanised Hindi) or 'en'. */
  function detectLanguage(text) {
    const dev = (text.match(/[ऀ-ॿ]/g) || []).length;
    const lat = (text.match(/[A-Za-z]/g) || []).length;
    if (dev && dev >= 0.4 * (dev + lat)) return "hi";
    const words = text.toLowerCase().match(/[a-z]+/g) || [];
    const markers = words.filter(function (w) { return HINGLISH_MARKERS.has(w); }).length;
    if (words.length && markers >= Math.max(2, Math.floor(words.length / 8))) return "hinglish";
    return "en";
  }

  // Scripts Sahayak cannot read yet (normalize.py UNREAD_SCRIPTS): a message mostly in one of these gets
  // "could not check", never "no scam signs".
  const UNREAD_RANGES = [
    ["bn", "\\u0980-\\u09ff"], ["pa", "\\u0a00-\\u0a7f"], ["gu", "\\u0a80-\\u0aff"], ["or", "\\u0b00-\\u0b7f"],
    ["ta", "\\u0b80-\\u0bff"], ["te", "\\u0c00-\\u0c7f"], ["kn", "\\u0c80-\\u0cff"], ["ml", "\\u0d00-\\u0d7f"],
    ["ur", "\\u0600-\\u06ff\\u0750-\\u077f\\ufb50-\\ufdff\\ufe70-\\ufeff"],
    ["sat", "\\u1c50-\\u1c7f"], ["mni", "\\uabc0-\\uabff"],
  ];
  const UNREAD_SCRIPTS = UNREAD_RANGES.map(function (e) { return [e[0], new RegExp("^[" + e[1] + "]$", "u")]; });
  // Letters of all of them, and the scripts Sahayak reads (signals.py _UNREAD_LETTER, _WORD_SCRIPT).
  const UNREAD_LETTER = new RegExp("[" + UNREAD_RANGES.map(function (e) { return e[1]; }).join("") + "]", "u");
  const WORD_SCRIPT = /[a-z\u0900-\u097f]/u;
  const LETTER = /^\p{L}$/u;  // Python's str.isalpha(): Lu, Ll, Lt, Lm, Lo

  // Marathi shares Hindi's script but not its everyday words; two of these, and more than Hindi's, mean Marathi.
  const MARATHI_WORDS = new Set(("आहे आहेत नाही तुमचे तुमची तुमच्या तुम्ही आपले आपली आपल्या करा होईल जाईल झाले झाली केले " +
    "आणि मध्ये साठी किंवा येथे लवकर").split(" "));
  const HINDI_WORDS = new Set("है हैं नहीं आपका आपके आपकी करें करो में और का की के को से".split(" "));
  const DEV_WORD = /[ऀ-ॿ]+/g;

  /** The script (or, for Marathi, the language) of a message Sahayak cannot read: at least 8 of its letters,
   *  and a quarter of them, in a script it does not know; or Devanagari that reads as Marathi. */
  function unreadScript(text) {
    const counts = UNREAD_SCRIPTS.map(function (e) { return [e[0], 0]; });
    let letters = 0, unread = 0;
    for (const ch of text) {
      if (!LETTER.test(ch)) continue;
      letters += 1;
      for (let i = 0; i < UNREAD_SCRIPTS.length; i++) {
        if (UNREAD_SCRIPTS[i][1].test(ch)) { counts[i][1] += 1; unread += 1; break; }
      }
    }
    if (unread >= 8 && unread >= 0.25 * letters) {
      let best = counts[0];
      for (const c of counts) if (c[1] > best[1]) best = c;
      return best[0];
    }
    const words = text.match(DEV_WORD) || [];
    const marathi = words.filter(function (w) { return MARATHI_WORDS.has(w); }).length;
    if (marathi >= 2 && marathi > words.filter(function (w) { return HINDI_WORDS.has(w); }).length) return "mr";
    return null;
  }

  // ---------------------------------------------------------------- context

  function buildContext(text, sender, inputType, prot) {
    const raw = prot.wrap(text);
    const norm = fold(raw);
    const t = new PyText(norm);
    const urls = extractUrls(t);
    // wa.me/91XXXXXXXXXX links are contact numbers too
    const mobiles = extractMobiles(t);
    for (const u of urls) {
      if (u.host === "wa.me" || u.host === "api.whatsapp.com") {
        for (const m of WA_DIGITS.finditer(u.path)) {
          const tail = cpSlice(m.group(0), -10);
          if ("6789".indexOf(Array.from(tail)[0]) >= 0 && mobiles.indexOf(tail) < 0) mobiles.push(tail);
        }
      }
    }
    return {
      raw: text,
      norm: norm,
      t: t,
      lang: detectLanguage(raw),
      inputType: inputType,
      sender: sender ? pyStrip(sender) : null,
      senderKind: classifySender(prot.wrap(sender)),
      urls: urls,
      mobiles: mobiles,
      tollfree: extractTollfree(t),
      series1600: extract1600(t),
      amounts: extractAmounts(t),
      upiIds: extractUpiIds(t),
      mixedTokens: mixedScriptTokens(raw),
      unread: unreadScript(raw),
      prot: prot,
    };
  }
  const WA_DIGITS = new Rx(String.raw`\d{10,12}`);

  // ======================================================================= signals.py

  const DEV = new RegExp("[" + DEVANAGARI + "]");
  const CLAUSE_BREAK = new Rx(String.raw`[,;:.!?।\n]`);
  const SENTENCE_BREAK = new Rx(String.raw`[!?।\n]|\.(?:\s|$)`);
  // digits right after a mask ("XX4421", "**4421") are a hidden card or account number, never a code
  const CODE_DIGITS = new Rx(String.raw`(?<![\dxX*•])\d{4,8}(?!\d)`);
  const CALL_BEFORE = new Rx(String.raw`(call|dial|on|कॉल)\W{0,3}$`);
  const HELPLINE_NUMBERS = new Set(["1930", "1800", "1600"]);

  /** A 4-8 digit one-time code, not a helpline number or one the reader is told to call. */
  function hasCode(t) {
    for (const m of CODE_DIGITS.finditer(t)) {
      if (HELPLINE_NUMBERS.has(m.group(0))) continue;
      if (CALL_BEFORE.search(t.slice(Math.max(0, m.start - 8), m.start))) continue;
      return true;
    }
    return false;
  }

  // re.escape() in Python 3.11 puts a backslash before these
  const PY_ESCAPED = "()[]{}?*+-|^$\\.&~# \t\n\r\v\f";
  function pyEscape(w) {
    let out = "";
    for (const c of w) out += PY_ESCAPED.indexOf(c) >= 0 ? "\\" + c : c;
    return out;
  }
  function alt(phrases) {
    // {r"\s+".join(re.escape(w) for w in p.split())}, longest first. Two different phrases of the same
    // length can never match at the same place, so the order among equal lengths does not matter.
    const words = new Set();
    for (const p of phrases) words.add(pySplit(p).map(pyEscape).join("\\s+"));
    return Array.from(words).sort(function (a, b) { return cpLen(b) - cpLen(a); }).join("|");
  }

  /** A phrase list compiled to one regex.
   *
   *  Latin phrases match whole words. Devanagari phrases need a left boundary, and a right
   *  boundary too when short (<= 3 chars, e.g. the negation 'न'), so inflected forms of
   *  longer Hindi words still match. */
  function Lexicon(phrases) {
    const latin = [], devShort = [], devLong = [];
    for (const p of phrases) {
      const fp = fold(p);
      if (!fp) continue;
      if (DEV.test(fp)) (cpLen(fp) <= 3 ? devShort : devLong).push(fp);
      else latin.push(fp);
    }
    const parts = [];
    if (latin.length) parts.push("(?<![a-z0-9])(?:" + alt(latin) + ")(?![a-z0-9])");
    if (devLong.length) parts.push("(?<![" + DEVANAGARI + "])(?:" + alt(devLong) + ")");
    if (devShort.length) parts.push("(?<![" + DEVANAGARI + "])(?:" + alt(devShort) + ")(?![" + DEVANAGARI + "])");
    this.re = parts.length ? new Rx(parts.join("|")) : null;
  }
  Lexicon.prototype.finditer = function (t) { return this.re ? this.re.finditer(t) : []; };
  /** Search a window of `text` while word boundaries still see the full text, so a window that
   *  starts mid-word ('...ना' cut from 'पुराना') is not read as a word. */
  Lexicon.prototype.search = function (t, pos, endpos) { return this.re ? this.re.search(t, pos, endpos) : null; };

  /** Characters between two matches (0 if they overlap). */
  function gap(a, b) {
    if (a.end <= b.start) return b.start - a.end;
    if (b.end <= a.start) return a.start - b.end;
    return 0;
  }
  function near(xs, ys, window) {
    return xs.some(function (x) { return ys.some(function (y) { return gap(x, y) <= window; }); });
  }
  function clauseStart(t, pos) {
    let start = 0;
    for (const m of CLAUSE_BREAK.finditer(t, 0, pos)) start = m.end;
    return start;
  }
  function sentenceStart(t, pos) {
    let s0 = 0;
    for (const m of SENTENCE_BREAK.finditer(t, 0, pos)) s0 = m.end;
    return s0;
  }
  function sentence(t, start, end) {
    const s0 = sentenceStart(t, start);
    const m = SENTENCE_BREAK.search(t, end);
    return t.slice(s0, m ? m.start : t.len);
  }
  /** Half or more of the sentence's words are in a script Sahayak cannot read, so a negation or warning
   *  around an English word in it is invisible (signals.py _unreadable). */
  function unreadable(sent) {
    let unread = 0, readable = 0;
    for (const w of pySplit(sent)) {
      if (UNREAD_LETTER.test(w)) unread += 1;
      else if (WORD_SCRIPT.test(w)) readable += 1;
    }
    return unread > 0 && unread >= readable;
  }

  // Phrases that look like requests but are routine in genuine messages: you hand a code to
  // the delivery agent or the cab driver standing in front of you.
  const OTP_OK_CONTEXT = new Rx(
    String.raw`(?<![a-z])(delivery|deliver|driver|captain|ride|trip|cab|pickup|technician|डिलीवरी|ड्राइवर)`);
  // A call between the handover and the request for the code: it was asked for on a later call, not at the door.
  const CALL_WORD = new Rx(String.raw`(?<![a-z])(?:call|phone|rang(?![a-z]))|फोन|कॉल`);
  // A message that contains the code itself is delivering it; a fraudster does not know your code.
  const CODE_NEXT_TO_TERM = new Rx(
    String.raw`(?:otp|pin|code|ओटीपी|कोड)\D{0,12}(?<![\dx*•])\d{4,8}(?!\d)|(?<![\dx*•])\d{4,8}(?!\d)\D{0,12}(?:otp|pin|code|ओटीपी|कोड)`);
  const PIN_CODE = new Rx(String.raw`\s*(?:-|\s)?code`);
  const UPI_RECEIVE_PATTERNS = [
    String.raw`(?:scan|स्कैन)\W+(?:\w+\W+){0,5}?(?:qr|क्यूआर|code|कोड)\W+(?:\w+\W+){0,8}?(?:receive|get|claim|credit|refund|cashback|paane|pane|lene|milega|पाने|प्राप्त|पाएं|लेने)`,
    String.raw`(?:enter|daal|dal|daalo|dalo|डाल|डालें|डालो)\W+(?:\w+\W+){0,4}?(?:upi\s*pin|pin|पिन)\W+(?:\w+\W+){0,8}?(?:receive|get|claim|credit|refund|cashback|paane|pane|पाने|प्राप्त)`,
    // Hindi word order: "PIN डालो, तब पैसे मिलेंगे" (the verb after PIN, the money after that)
    String.raw`(?:upi\s*pin|pin|पिन)\W+(?:daalo|dalo|daal|dal|daliye|dalna|enter|डालो|डालें|डालिए|डालना)\W+(?:\w+\W+){0,6}?(?:milenge|milega|mil\s+jayenge|mil\s+jayega|aayenge|aa\s+jayenge|मिलेंगे|मिलेगा|मिल\s+जाएंगे|आ\s+जाएंगे|receive|credit)`,
    String.raw`(?:receive|get|claim)\W+(?:\w+\W+){0,6}?(?:money|payment|amount|refund|cashback|rs|₹)\W+(?:\w+\W+){0,6}?(?:enter|scan)\W+(?:\w+\W+){0,3}?(?:upi\s*pin|pin|qr)`,
    String.raw`(?:collect request|payment request|request money|money request)\W+(?:\w+\W+){0,10}?(?:approve|accept|स्वीकार)`,
    String.raw`(?:approve|accept|स्वीकार)\W+(?:\w+\W+){0,5}?(?:request|रिक्वेस्ट)\W+(?:\w+\W+){0,8}?(?:receive|get|refund|cashback|paane|पाने|प्राप्त)`,
    String.raw`(?:पैसे|पैसा|रकम|रुपये)\s+(?:पाने|लेने)\s+के\s+लिए\s+(?:\S+\s+){0,3}?(?:पिन|क्यूआर|qr|स्कैन)`,
    String.raw`(?:paise|paisa)\s+(?:paane|pane|lene)\s+ke\s+liye\s+(?:\S+\s+){0,3}?(?:pin|qr|scan)`,
    String.raw`(?:राशि|पैसे|पैसा|रकम|रुपये)\s+(?:प्राप्त|पाने|लेने)\s+(?:करने\s+)?के\s+लिए\s+(?:\S+\s+){0,6}?(?:पिन|क्यूआर|qr|स्कैन)`,
    // the QR named first, as a person tells it: "he sent a QR code of Re 1 and asked me to scan it and receive money"
    String.raw`(?:qr|क्यूआर)\W+(?:\w+\W+){0,12}?(?:scan|स्कैन)\W+(?:\w+\W+){0,3}?(?:and|to|kar\w*|करके|कर\s+के)\W+(?:\w+\W+){0,2}?(?:receive|get|claim|paane|lene|पाने|लेने)`,
  ].map(function (p) { return new Rx(p); });
  // The collect-request trick: "to reverse it, approve the request we sent you", "I sent Rs 5000 by mistake,
  // accept the request and return it". Approving a UPI request sends money out; it never reverses or refunds
  // anything. Only the instruction counts ("approve", "accept kar do"), never a report ("request accepted").
  const COLLECT_VERB = new Rx(String.raw`(?<![a-z])(?:approve|accept)(?![a-z])|स्वीकार|अप्रूव`);
  const COLLECT_WHY = new Rx(String.raw`reverse|return|refund|mistake|galti|wapas|vapas|गलती|वापस|रिफंड|लौटा`);
  const COLLECT_REQUEST = [
    // instruction, then why: "accept the request on PhonePe and return it"
    [String.raw`(?<![a-z])(?:approve|accept)(?![a-z])\W+(?:\w+\W+){0,4}?(?:requests?|रिक्वेस्ट)(?![a-z])(?:\W+\w+){0,10}?\W+` +
     String.raw`(?:reverse|return|refund|back|wapas|vapas|वापस|mistake|galti|गलती)`, false],
    // why, then instruction: "to reverse it approve the request", "by mistake, please accept the request"
    [String.raw`(?:reverse|return|refund|mistake|galti|wapas|vapas|गलती|वापस)\W+(?:\w+\W+){0,8}?(?<![a-z])(?:approve|accept)(?![a-z])` +
     String.raw`\W+(?:\w+\W+){0,3}?(?:requests?|रिक्वेस्ट)(?![a-z])`, false],
    // Hindi word order: "रिक्वेस्ट स्वीकार करें", "request accept kar do" (with a why anywhere in the message)
    [String.raw`(?:requests?|रिक्वेस्ट|अनुरोध)\W+(?:\S+\s+){0,2}?(?:(?:approve|accept)\s+(?:kar\s*do|karo|karein|karen|kar\s+dein|kijiye)` +
     String.raw`|(?:स्वीकार|अप्रूव)\s+(?:करें|करो|कर\s+दें|कर\s+दो|कीजिए))`, true],
  ].map(function (e) { return [new Rx(e[0]), e[1]]; });
  const WALLET_TERMS = new Rx(String.raw`(?<![a-z])(?:paytm|phonepe|phone pe|google pay|gpay|bhim|wallet|deduct\w*|debit\w*)(?![a-z])`);
  // Sending money, for scheme_fee: "500 रुपये इस नंबर पर भेजें", "is UPI par 299 bhejo", "pay Rs 100 to this number".
  const SEND_MONEY = new Rx(
    String.raw`(?<![a-z])(?:send|pay|transfer|bhejo|bhejein|bhejen|bhej\s+do|bhejiye|jama\s+karo|jama\s+karein|jama\s+kare)(?![a-z])`
    + String.raw`|(?:भेजें|भेजो|भेज\s+दें|भेज\s+दो|भेजिए|जमा\s+करें|जमा\s+करो|भुगतान\s+करें)(?![ऀ-ॿ])`);
  // Pay (or send) money first to receive, release, withdraw or settle something.
  const PAY_FIRST = new Rx(
    String.raw`(?:pay|paying|send|deposit|bharo|bharna|jama)\s+(?:\w+\s+){0,5}?(?:tax|gst|fee|fees|charge|charges|duty|deposit|` +
    String.raw`advance|amount)\b(?:\W+\w+){0,8}?\W+(?:first|to withdraw|to release|to claim|to receive|to activate|to settle|` +
    String.raw`before|to avoid|or face)\b` +
    String.raw`|(?:send|pay)\s+(?:rs\.?|₹|inr)?\s?\d[\d,]*(?:/-)?\s+(?:as\s+)?(?:gst|tax|fee|fees|charges?|deposit|advance)\b` +
    String.raw`|(?:to\s+withdraw|withdrawal)\W+(?:\w+\W+){0,4}?pay\b` +
    String.raw`|(?:security|settlement|verification|clearance)\s+(?:amount|fee|charge|deposit)`);
  const HI_FEE_SEND = new Rx(String.raw`(?:शुल्क|फीस|चार्ज)\s+(?:\S+\s+){0,5}?(?:भेजें|भरें|जमा\s+करें|दें|भेजो|भरो)`);
  const COURIER_FEE = new Rx(String.raw`(?:pay|send)\s+(?:the\s+)?(?:delivery|customs|clearance|courier|shipping)\s+(?:fee|fees|charges?|duty)`);
  const SHARE_TO_CONTACTS = new Rx(
    String.raw`(?:send|sent|share|shared|forward|upload)\w*\s+(?:\w+\s+){0,3}?(?:to\s+)?(?:all\s+)?(?:your\s+)?` +
    String.raw`(?:contacts|relatives|family|friends)`);
  // The same threat in Hindi word order: the people first, a future "I will send / show / post" last ("tumhare
  // saare contacts ko bhej denge", "friends aur family group me daal dungi", "दोस्तों को भेज दूंगी"). It counts only
  // after a "pay, or else" earlier in the same clause (OR_ELSE); mirrors sahayak/fraud/signals.py.
  const SHARE_TO_CONTACTS_HI = new Rx(
    String.raw`(?<![a-z])(?:contacts?|friends|family|relatives|dost(?:o|on)|rishtedaa?r(?:o|on)?|ghar\s*wal(?:e|o|on)|` +
    String.raw`parivar(?:\s+wal(?:e|o|on))?|biwi|wife|husband|sab\s*ko|sabhi\s*ko)(?![a-z])(?:\s+\S+){0,5}?\s+` +
    String.raw`(?:(?:bhej|daal|dal|dikha|forward|share|post|upload|viral|leak)\s*(?:kar\s*)?(?:d(?:u|oo)ng[ai]|d[eu]nge|dege|dega|degi)` +
    String.raw`|(?:bhej|daal|dal|dikha)(?:u|oo|au)ng[ai]|(?:bhej|daal|dal|dikhay)enge` +
    String.raw`|(?:forward|share|post|upload|viral|leak)\s+kar(?:u|oo)ng[ai]|(?:forward|share|post|upload|viral|leak)\s+karenge)(?![a-z])` +
    String.raw`|(?<![ऀ-ॿ])(?:कॉन्टैक्ट्स|कॉन्टैक्ट|कांटेक्ट्स|कॉन्टेक्ट्स|दोस्तों|दोस्तो|परिवार\s+वालों|परिवार\s+वालो|परिवार|` +
    String.raw`रिश्तेदारों|रिश्तेदारो|घर\s*वालों|घर\s*वालो|पत्नी|बीवी|पति|सबको|सब\s+को|सभी\s+को)(?:\s+\S+){0,5}?\s+` +
    String.raw`(?:(?:भेज|डाल|दिखा|फॉरवर्ड|शेयर|पोस्ट|अपलोड|वायरल|लीक)\s*(?:कर\s*)?(?:दूंगा|दूंगी|दुंगा|दुंगी|देंगे|देंगी|देगा|देगी)` +
    String.raw`|(?:भेज|डाल)(?:ूंगा|ूंगी|ुंगा|ुंगी|ेंगे)|दिखाऊंगा|दिखाऊंगी|दिखाएंगे` +
    String.raw`|(?:फॉरवर्ड|शेयर|पोस्ट|अपलोड|वायरल|लीक)\s+(?:करूंगा|करूंगी|करेंगे))`);
  // "Pay, or else": warna, varna, nahi to, "nahi kiya to", otherwise, or else, वरना, नहीं तो, "नहीं भेजे तो".
  const OR_ELSE = new Rx(
    String.raw`(?<![a-z])(?:warna|varna|vrna|otherwise|or\s+else|(?:nahi|nahin|nai)\s+(?:\w+\s+)?toh?)(?![a-z])` +
    String.raw`|वरना|अन्यथा|(?:नहीं|नही)\s+(?:\S+\s+)?तो(?![ऀ-ॿ])`);
  const PRIZE_EXCLUDE = new Rx(String.raw`reward\s+points|loyalty\s+points|earned\s+\d+\s+points|cashback\s+points`);
  const NO_FEE = new Rx(String.raw`(?:\bno|without|zero|free|बिना|कोई)\s+$`);  // "No registration fee", "बिना शुल्क"
  const EARN_RATE = new Rx(String.raw`earn\w*\s+(?:upto\s+|up to\s+)?(?:rs\.?|₹|inr)?\s?\d[\d,]*\s*(?:/-)?\s*(?:per day|daily|/day|a day|per hour|per task|weekly|per week)`);
  const RETURN_PCT = new Rx(String.raw`(?<!\d)\d{2,4}\s?%\s*(?:return|returns|profit|munafa|मुनाफ)`);
  const PAY_TO_GET = new Rx(String.raw`pay\s+(?:only\s+)?(?:rs\.?|₹|inr)?\s?\d[\d,]*(?:/-)?\s+(?:only\s+)?(?:to|for|and)\s+(?:receive|get|claim|release|unlock|activate|process|withdraw)`);
  const HI_FEE_FIRST = new Rx(String.raw`(?:पहले|pehle)\s+(?:\S+\s+){0,4}?(?:फीस|शुल्क|चार्ज|fee|fees|charge)`);
  const APK_TEXT = new Rx(String.raw`\.apk\b|\bapk\s+(?:file|download|link)`);
  // The number a BLOCK keyword is texted to is the bank's SMS line, not a person to call (signals.py _SMS_BLOCK).
  const SMS_BLOCK_MOB = String.raw`(?<!\d)(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)`;
  const SMS_BLOCK = new Rx(
    String.raw`(?<![a-z])(?:sms|text)\W+(?:block|blk)(?!ed|ing)[^,;:.!?।]{0,30}?(?<![a-z])(?:to|on)\s+` + SMS_BLOCK_MOB +
    String.raw`|(?<![a-z])(?:block|blk|ब्लॉक)\S*\s+(?:\S+\s+){0,3}?` + SMS_BLOCK_MOB + String.raw`\s+(?:par|pe|पर)\s+(?:sms|एसएमएस)` +
    "|" + SMS_BLOCK_MOB + String.raw`\s+(?:par|pe|पर)\s+(?:block|blk|ब्लॉक)\S*\s+(?:\S+\s+){0,2}?(?:sms|एसएमएस)`);
  const TOLL_FREE = new Rx(String.raw`(?<!\d)1(?:800|860|600)[\s-]?\d{2,4}(?:[\s-]?\d{2,4})?(?!\d)`);
  const JOIN_GROUP = new Rx(
    String.raw`\bjoin\W+(?:\w+\W+){0,5}?(?:group|channel)\b` +
    String.raw`|\b(?:group|channel)\W+(?:\w+\W+){0,2}?(?:on\s+)?(?:telegram|whatsapp)\b` +
    String.raw`|\b(?:telegram|whatsapp)\W+(?:\w+\W+){0,2}?(?:group|channel)\b`);
  // "my SBI account", "मेरे SBI वाले खाते में": a writer naming their own bank is not claiming to be the bank.
  // Checked just before each bank or office name (one word may sit between). Not for a described call, where
  // "my" is the person who got the call.
  const OWN_ORG = new Rx(String.raw`(?:(?<![a-z])(?:my|mere|mera|meri|his|her|uske|uski|uska)` +
    String.raw`|(?<![ऀ-ॿ])(?:मेरे|मेरा|मेरी|उसके|उसकी|उसका))\s+(?:\S+\s+)?$`);
  // an account or phone number written out (9 to 18 digits): a new place to send money
  const LONG_NUMBER = new Rx(String.raw`(?<!\d)\d{9,18}(?!\d)`);
  // wrong_transfer: a Devanagari letter right after a match means a longer word ("वापस कर दें" inside
  // "वापस कर देंगे"); the danda (। ॥) ends a sentence and does not count. "I will return it" is a promise.
  const DEV_LETTER = new Rx("[\u0900-\u0963\u0966-\u097f]");
  const PROMISE = new Rx(String.raw`(?<![a-z])(?:i|we|he|she|they)(?:'ll|'d|\s+(?:will|shall|would|can|could))\s+(?:\w+\s+){0,2}$`);
  // An amount the reader is told to pay, for job_fee: "pay ₹6,500", "deposit Rs 999", "₹1,200 jama karna hai",
  // "₹500 dena hoga", "₹2,000 भरने होंगे". Salary wording ("we pay ₹15,000 per month", "monthly pay ₹15,000 +
  // incentives") is not a demand.
  const AMT = String.raw`(?:₹|rs\.?|inr|rupees?|रु\.?|रुपये|रुपए)\s?\d[\d,]*(?:\.\d{1,2})?(?:\s?/-)?`;
  const PAY_REQ = String.raw`(?:(?:need|needs|have|has|had)\s+to|must|should|please|kindly|pls|plz|(?:asked|asking|told|telling|wants?|wanted)\s+(?:me\s+|us\s+|you\s+|him\s+|her\s+)?to)`;
  const PAY_FOR = String.raw`(?:for|towards|as|today|now|immediately|within|before|tonight|first|via|through|online|in\s+advance|advance` +
    String.raw`|to\s+(?:confirm|get|book|reserve|block|secure|activate|receive|process|start|complete|join|register|release|claim))`;
  const PAY_AMOUNT = new Rx(
    // English puts the amount after the verb. Asked for ("need to pay ₹6,500", "kindly pay Rs.3,500", "asked me to
    // deposit ₹8,000") or paid for something ("pay ₹2,000 for the uniform"); not salary wording ("pay ₹16,000, duty 8
    // hours", "we will pay ₹1,000 as joining bonus", "monthly pay ₹28,000 + incentives")
    String.raw`(?<!no )` + PAY_REQ + String.raw`\s+(?:pay|deposit|transfer|send)\s+(?:(?:only|just|a|the|of)\s+)?` + AMT +
    String.raw`(?!\s*(?:per\b|/|a\s+month|monthly|pm\b|salary|ctc|stipend))` +
    String.raw`|(?<![a-z])(?<!we )(?<!will )(?<!we'll )(?:pay|deposit|transfer)\s+(?:(?:only|just|a|the|of)\s+)?` + AMT +
    String.raw`\s*` + PAY_FOR + String.raw`(?![a-z])` +
    String.raw`|(?<![a-z])(?<!we )(?<!will )deposit\s+(?:(?:only|just|a|the|of)\s+)?` + AMT +
    String.raw`(?!\s*(?:per\b|/|a\s+month|monthly|pm\b|salary|ctc|stipend|\+|-|to\s+(?:₹|rs)))` +
    // "₹4,500 must be paid", "a fee of ₹35,000 has to be paid"
    String.raw`|` + AMT + String.raw`\s+(?:[^\s.।!?]+\s+){0,3}?(?:must|needs?|has|have)\s+(?:to\s+)?be\s+(?:paid|deposited|transferred)` +
    // Hinglish and Hindi put the verb last: "₹1,200 jama karna hai", "₹12,000 dene honge", "₹4,500 जमा करना होगा";
    // "₹18,000 account mein transfer hogi" is the salary being paid, not a demand
    String.raw`|` + AMT + String.raw`\s+(?:[^\s.।!?]+\s+){0,3}?(?:(?:jama|pay|deposit|transfer)\s+(?:karna|karni|karo|karein|karen|kar\s+do` +
    String.raw`|kar\s+dena|kar\s+dein|kar\s+dijiye|kijiye|karne\s+(?:honge|hain|padenge|hoga|padega))` +
    String.raw`|(?:bharna|bharni|bharne|dena|deni|dene)\s+(?:hai|hain|hoga|hogi|honge|padega|padegi|padenge|pdega)` +
    String.raw`|bharo|bharein|bharen|bhar\s+do|de\s+do|de\s+dijiye)(?![a-z])` +
    String.raw`|` + AMT + String.raw`\s+(?:[^\s.।!?]+\s+){0,3}?(?:(?:जमा|भुगतान)\s+(?:करना|करनी|करें|करो|कर\s+दें|कीजिए|करने\s+(?:होंगे|हैं|पडेंगे))` +
    String.raw`|(?:भरना|भरनी|भरने|देना|देनी|देने)\s+(?:है|हैं|होगा|होगी|होंगे|पडेगा|पडेगी|पडेंगे)|भरें|भरो)`);
  // Signals that may stand next to in_person: a contact mobile and a time word are normal in a genuine appointment.
  const IN_PERSON_OK = new Set(["contact_mobile", "urgency"]);
  const REQUESTS = ["otp_request", "personal_info_request", "upi_receive", "remote_access", "link_apk",
    "advance_fee", "job_fee", "contact_mobile", "kyc_threat", "digital_arrest"];
  // A bank named as the card that gets a shop's discount is a sale, not a message from the bank (signals.py).
  const BANK_OFFER = new Rx(
    String.raw`(?:discount|cashback|off|emi|savings?)\s+(?:on|with|using|via)\s+(?:\S+\s+){0,3}?(?:credit\s+|debit\s+)?cards?\b` +
    String.raw`|(?:\S+\s+){0,2}?(?:cards?|कार्ड\S*)\s+(?:par|pe|पर|से)\s+(?:\S+\s+){0,3}?` +
    String.raw`(?:discount|cashback|off|छूट|डिस्काउंट|कैशबैक)`);
  const YOUR = new Rx(String.raw`(?<![a-z])(?:your|aapke|aapka|aapki)(?![a-z])|आपके|आपका|आपकी`);
  const SOFT = new Set(["urgency", "kyc_mention", "easy_money_weak"]);
  const SOFT_FOR_VISIT = new Set(["urgency", "kyc_mention", "easy_money_weak", "contact_mobile", "prize"]);

  function snippet(t, m, width) {
    width = width || 40;
    return pyStrip(t.slice(Math.max(0, m.start - Math.floor(width / 2)), m.end + Math.floor(width / 2)));
  }

  function SignalEngine(pack) {
    this.defs = pack.signals;
    this.L = {};
    for (const name of Object.keys(pack.lexicons)) this.L[name] = new Lexicon(pack.lexicons[name]);
    const d = pack.domains;
    this.shorteners = new Set(d.shorteners);
    this.suspiciousTlds = new Set(d.suspicious_tlds);
    this.officialSuffixes = d.official_suffixes.slice();
    this.officialDomains = d.official_domains.slice();
    // numbers a bank itself publishes (missed-call banking): calling them is not the scam signal
    this.officialNumbers = new Set(d.official_numbers || []);
    this.brandTokens = d.brand_tokens.slice().sort(function (a, b) { return cpLen(b) - cpLen(a); });
  }

  // ------------------------------------------------------------ helpers

  SignalEngine.prototype.isOfficial = function (host) {
    if (this.officialSuffixes.some(function (s) { return host.endsWith(s); })) return true;
    return this.officialDomains.some(function (d) { return host === d || host.endsWith("." + d); });
  };
  SignalEngine.prototype.brandInHost = function (host) {
    const labels = host.split(".").slice(0, -1);
    for (const label of labels) {
      for (const part of label.split("-")) {
        for (const token of this.brandTokens) {
          if (part === token || part.startsWith(token) || (cpLen(token) >= 4 && part.endsWith(token))) return token;
        }
      }
    }
    return null;
  };
  SignalEngine.prototype.negated = function (t, start, end) {
    const lo = Math.max(start - 28, clauseStart(t, start));
    if (this.L.negations_pre.search(t, lo, start)) return true;
    const cut = CLAUSE_BREAK.search(t, end, end + 14);
    return !!this.L.negations_post.search(t, end, cut ? cut.start : Math.min(t.len, end + 14));
  };
  /** negated(), or the words sit in a sentence written mostly in a script Sahayak cannot read. */
  SignalEngine.prototype.unclear = function (t, start, end) {
    return this.negated(t, start, end) || unreadable(sentence(t, start, end));
  };
  /** A negation anywhere earlier in the same sentence ('Do not install apps like AnyDesk'), or a sentence
   *  Sahayak cannot read. */
  SignalEngine.prototype.negatedInSentence = function (t, m) {
    return !!this.L.negations_pre.search(t, sentenceStart(t, m.start), m.start) || unreadable(sentence(t, m.start, m.end));
  };
  /** True when the match sits in a warning sentence ('police never do digital arrest'). */
  SignalEngine.prototype.advisoryContext = function (t, m) {
    return !!this.L.advisory.search(sentence(t, m.start, m.end)) || this.unclear(t, m.start, m.end);
  };

  // ------------------------------------------------------------ detection

  SignalEngine.prototype.run = function (ctx) {
    const self = this, t = ctx.t, n = t.s, L = this.L;
    const fired = new Map();

    function fire(sid, evidence) {
      if (fired.has(sid)) return;
      const spec = self.defs[sid], ev = {};
      for (const k in evidence || {}) ev[k] = ctx.prot.unwrap(String(evidence[k]));
      fired.set(sid, { id: sid, weight: Number(spec.weight), hard: !!spec.hard, evidence: ev });
    }
    const negated = function (m) { return self.negated(t, m.start, m.end); };
    const unclear = function (m) { return self.unclear(t, m.start, m.end); };
    const advisory = function (m) { return self.advisoryContext(t, m); };

    // a shop's discount on bank cards ("10% off on select bank cards") is a sale, not the bank speaking
    const offers = BANK_OFFER.finditer(t).filter(function (o) { return !YOUR.search(o.group(0)); });
    const claimed = function (lex, skip) {
      return lex.finditer(t).some(function (m) {
        return (ctx.inputType === "call" || !OWN_ORG.search(t, Math.max(0, m.start - 30), m.start))
          && !(skip || []).some(function (o) { return o.start <= m.start && m.end <= o.end; });
      });
    };
    const orgBank = claimed(L.bank_terms, offers);
    const orgClaim = orgBank || claimed(L.authority_terms);
    const links = ctx.urls.filter(function (u) { return u.host !== "wa.me" && u.host !== "api.whatsapp.com"; });
    const nonofficial = links.filter(function (u) { return !self.isOfficial(u.host); });
    const official = links.filter(function (u) { return self.isOfficial(u.host); });
    const shareVerbs = L.share_verbs.finditer(t).filter(function (v) { return !unclear(v); });

    // --- requests for secrets
    let secrets = L.otp_terms.finditer(t).concat(L.code_phrases.finditer(t));
    secrets = secrets.concat(L.pin_terms.finditer(t).filter(function (m) { return !PIN_CODE.match(t, m.end); }));
    // On a call the caller asking for the code is the scam; the code told at the door is how delivery works:
    // asked for after the handover with no call in between, or to be told to the delivery person when the goods
    // arrive (handover_done / handover_when + handover_to / not_in_person). Mirrors signals.py.
    const atDoor = ctx.inputType === "call" && !nonofficial.length && !!OTP_OK_CONTEXT.search(t)
      && !(L.not_in_person && L.not_in_person.search(t));
    const done = atDoor && L.handover_done ? L.handover_done.finditer(t) : [];
    const to = atDoor && L.handover_to && L.handover_when && L.handover_when.search(t) ? L.handover_to.finditer(t) : [];
    let doorstep = false;
    for (const v of shareVerbs) {
      if (!secrets.some(function (s) { return gap(v, s) <= 60; })) continue;
      const sent = sentence(t, v.start, v.end);
      const routine = OTP_OK_CONTEXT.search(sent) || CODE_NEXT_TO_TERM.search(t);
      if (routine && !nonofficial.length && ctx.inputType !== "call") continue;  // "share OTP 4417 with the driver" delivers a code; it does not ask for one
      if (done.some(function (d) { return d.end <= v.start && !CALL_WORD.search(t, d.end, v.start); })
          || to.some(function (r) { return gap(v, r) <= 40; })) {
        doorstep = true;
        continue;
      }
      fire("otp_request", { phrase: snippet(t, v) });
      break;
    }
    const personal = L.personal_info_terms.finditer(t);
    if (shareVerbs.some(function (v) { return personal.some(function (p) { return gap(v, p) <= 50; }); })) {
      fire("personal_info_request");
    }
    for (const pat of UPI_RECEIVE_PATTERNS) {
      const m = pat.search(t);
      // also reject a negation inside the match: "to receive money you never need to enter your PIN",
      // and a warning about the trick: "fraudsters ask you to scan QR codes for refunds"
      if (m && !unclear(m) && !L.negations_pre.search(t, m.start, m.end)
          && !L.advisory.search(sentence(t, m.start, m.end))) {
        fire("upi_receive", { phrase: cpSlice(m.group(0), 0, 60) });
        break;
      }
    }
    if (!fired.has("upi_receive") && (L.money_terms.search(t) || ctx.amounts.length || ctx.upiIds.length || WALLET_TERMS.search(t))) {
      for (const pr of COLLECT_REQUEST) {
        const m = pr[0].search(t);
        if (!m || (pr[1] && !COLLECT_WHY.search(t))) continue;
        const verb = COLLECT_VERB.search(t, m.start, m.end);
        // negation is checked at the verb: "never approve a request" is advice, while "if you did
        // not make this payment, approve the request to reverse it" is still the trick
        if (verb && !advisory(verb)) {
          fire("upi_receive", { phrase: cpSlice(m.group(0), 0, 60) });
          break;
        }
      }
    }

    // --- links
    for (const u of nonofficial) {
      const path = u.path.toLowerCase();
      if (path.endsWith(".apk") || path.indexOf(".apk") >= 0 || u.host.endsWith(".apk")) fire("link_apk", { domain: u.host });
      if (u.isIp) fire("link_ip", { domain: u.host });
      if (this.shorteners.has(u.host)) fire("link_shortener", { domain: u.host });
      if (this.suspiciousTlds.has(u.tld)) fire("link_suspicious_tld", { domain: u.host });
      if (this.brandInHost(u.host)) fire("link_lookalike", { domain: u.host });
      else if (orgBank) fire("link_bank_unofficial", { domain: u.host });
      fire("link_present", { domain: u.host });
    }
    const apk = APK_TEXT.search(t);
    if (apk && !negated(apk)) fire("link_apk", { domain: apk.group(0) });
    if (links.length && !nonofficial.length) fire("official_link", { domain: official[0].host });

    // --- who sent it
    if (ctx.senderKind === "mobile" && orgClaim) {
      fire(ctx.inputType === "call" ? "call_mobile_claims_org" : "sender_mobile_claims_org", { sender: ctx.sender || "" });
    } else if (ctx.senderKind === "dlt") fire("dlt_sender", { sender: ctx.sender || "" });
    else if (ctx.senderKind === "1600") fire("bank_1600_caller", { sender: ctx.sender || "" });

    // --- personal mobile numbers to call
    const numberSpans = MOBILE_RE.finditer(t);
    const calls = L.call_verbs.finditer(t);
    const waLink = ctx.urls.some(function (u) { return u.host === "wa.me" || u.host === "api.whatsapp.com"; });
    const mobiles = ctx.mobiles.filter(function (x) { return !self.officialNumbers.has(x); });
    // a bank's own footer never arrives from a personal mobile number
    const smsLines = ctx.senderKind !== "mobile" && TOLL_FREE.search(t) ? SMS_BLOCK.finditer(t) : [];
    let contact = null;
    for (const m of numberSpans) {
      if (self.officialNumbers.has(digitsOnly(m.group(1)))) continue;
      if (smsLines.some(function (s) { return s.start <= m.start && m.end <= s.end; })) continue;  // the bank's SMS-block line
      if (calls.some(function (c) { return gap(m, c) <= 40; }) || n.indexOf("whatsapp") >= 0) {
        contact = digitsOnly(m.group(1));
        break;
      }
    }
    if (contact === null && waLink && mobiles.length) contact = mobiles[0];
    if (contact) {
      fire("contact_mobile", { number: contact });
      if (orgClaim) fire("org_contact_mobile", { number: contact });
      if (L.debit_credit_terms.search(t)) fire("fake_alert_callback", { number: contact });
    }
    // The 'customer care' words must label the number ("Call customer care 98760 12345"), not a job title
    // or a shop's name elsewhere in the message ("Customer Support Associate role ... call HR on 93104 57286").
    const care = L.customer_care_terms.finditer(t);
    for (const x of numberSpans) {
      const number = digitsOnly(x.group(1));
      if (mobiles.indexOf(number) >= 0 && care.some(function (c) { return gap(x, c) <= 80; })) {
        fire("customer_care_bait", { number: number });
        break;
      }
    }

    // --- pressure and threats
    // "no hurry", "koi jaldi nahi", "jab time mile": a message that says there is no rush is not rushing
    // you, even when it names a date ("fees ki last date 10 tarikh hai ... koi jaldi nahi"). Packs 1.6.0+.
    const calm = L.no_pressure ? L.no_pressure.search(t) : null;
    let m = calm ? null : L.urgency.search(t);
    if (m) fire("urgency", { phrase: m.group(0) });
    for (const x of L.digital_arrest.finditer(t)) if (!advisory(x)) { fire("digital_arrest"); break; }
    for (const x of L.threat_terms.finditer(t)) if (!advisory(x)) { fire("threat_authority", { phrase: x.group(0) }); break; }
    const couriers = L.courier_terms.finditer(t), seized = L.seized_terms.finditer(t);
    if (couriers.length && seized.length && near(couriers, seized, 80) && !advisory(seized[0])) fire("courier_seized");
    if (L.secrecy.search(t)) fire("secrecy");

    // --- money bait
    if (!PRIZE_EXCLUDE.search(t)) {
      for (const x of L.prize.finditer(t)) if (!advisory(x)) { fire("prize"); break; }
    }
    const easy = new Set(L.easy_money.finditer(t).map(function (x) { return x.group(0); }));
    if (easy.size >= 2 || EARN_RATE.search(t)) fire("easy_money");
    else if (easy.size) fire("easy_money_weak");
    if (L.investment.search(t) || RETURN_PCT.search(t)) fire("investment_promise");
    if (L.join_group.search(t) || JOIN_GROUP.search(t)
        || ctx.urls.some(function (u) { return u.host === "t.me" || u.host === "chat.whatsapp.com"; })) {
      fire("join_group");
    }
    const payFirst = PAY_FIRST.search(t);
    const feeTerms = L.advance_fee.finditer(t).filter(function (x) {
      return !unclear(x) && !NO_FEE.search(t.slice(Math.max(0, x.start - 10), x.start));
    });
    if (feeTerms.length || PAY_TO_GET.search(t) || HI_FEE_FIRST.search(t) || HI_FEE_SEND.search(t)
        || (payFirst && !negated(payFirst))
        || (COURIER_FEE.search(t) && (L.courier_terms.search(t) || n.indexOf("gift") >= 0))) {
      fire("advance_fee");
    }
    // A job that asks you to pay: real employers never charge to hire, train, kit out or verify you. A fee paid
    // on the recruiter's own official site, with no number or UPI ID to pay ("pay ₹500 exam fee only on
    // rrbapply.gov.in"), is not this. On once the fraud pack defines job_fee and job_terms; mirrors signals.py.
    const onOfficialSite = official.length && !nonofficial.length && !ctx.mobiles.length && !ctx.upiIds.length;
    if (self.defs.job_fee && L.job_terms && L.job_terms.search(t) && !onOfficialSite) {
      for (const x of PAY_AMOUNT.finditer(t)) {
        // also a negation inside the match: "₹500 maange to mat bharo"
        if (!advisory(x) && !L.negations_pre.search(t, x.start, x.end)) {
          fire("job_fee", { phrase: cpSlice(x.group(0), 0, 60) });
          break;
        }
      }
    }
    if (L.loan.search(t)) fire("loan_offer");

    // --- impersonation stories
    const kyc = L.kyc_terms.finditer(t), kycThreat = L.kyc_threat_terms.finditer(t);
    if (kyc.length && kycThreat.length && near(kyc, kycThreat, 60)) {
      if (nonofficial.length || ctx.mobiles.length) fire("kyc_threat");
      else if (!L.branch_visit.search(t)) fire("kyc_mention");
    }
    const elec = L.electricity_terms.finditer(t), cut = L.disconnect_terms.finditer(t);
    // a cut explained as maintenance work is a notice, not the unpaid-bill threat
    const maintenance = L.maintenance_terms && L.maintenance_terms.search(t);
    if (elec.length && cut.length && near(elec, cut, 60) && (L.tonight_terms.search(t) || ctx.mobiles.length)
        && !maintenance) fire("electricity_cut");
    if (L.family_terms.search(t) && L.emergency_terms.search(t) && L.money_send_terms.search(t)) fire("relative_emergency");
    if (L.new_number.search(t)) fire("new_number");
    if (L.sim_terms.search(t) && L.sim_action.search(t)) fire("sim_swap");
    const refunds = L.refund_terms.finditer(t);
    if (refunds.length) {  // (Python builds `actions` first; it has no side effects)
      // "do not click any link offering a refund" and "never approve a request to get a refund" are advice
      const actions = L.action_terms.finditer(t).concat(calls).filter(function (a) { return !advisory(a); });
      if (actions.length && near(refunds, actions, 60)) fire("refund_bait");
    }
    // "Sent to you by mistake, please send it back": the 'credited' SMS is fake, or real money that only the
    // sender's bank should reverse. Packs from 1.6.0 define wrong_transfer; mirrors sahayak/fraud/signals.py.
    if (self.defs.wrong_transfer && L.mistake_terms.search(t)
        && (L.money_terms.search(t) || ctx.amounts.length || ctx.upiIds.length)) {
      for (const b of L.return_request.finditer(t)) {
        // "वापस कर दें" asks, "वापस कर देंगे" promises; "please return it" asks, "I will return it" promises
        if (DEV_LETTER.match(t, b.end) || PROMISE.search(t, Math.max(0, b.start - 40), b.start) || advisory(b)) continue;
        fire("wrong_transfer");
        break;
      }
    }
    const media = L.sextortion_media.finditer(t);
    const threat = L.sextortion_threat.finditer(t).concat(SHARE_TO_CONTACTS.finditer(t))
      .concat(SHARE_TO_CONTACTS_HI.finditer(t).filter(function (x) {
        return !!OR_ELSE.search(t, Math.max(x.start - 60, clauseStart(t, x.start)), x.start);
      }));
    const money = !!(L.money_terms.search(t) || ctx.amounts.length || ctx.upiIds.length);
    if ((media.length && threat.length && near(media, threat, 80) && money)
        || (L.sextortion_explicit.search(t) && (threat.length || money))) {
      fire("sextortion");
    }
    const install = L.install_terms.finditer(t);
    if (L.scheme_terms.search(t) && (nonofficial.length || install.length || apk)) fire("govt_scheme_bait");
    // Money sent to a phone number, UPI ID or link to get a scheme or card. Ayushman and e-Shram cards are
    // free; a fee paid at the counter has no number or link and is not this. On once the fraud pack defines
    // scheme_fee (pack 1.4.0, scripts/pack_update_1_4.py); mirrors sahayak/fraud/signals.py.
    if (self.defs.scheme_fee && L.scheme_terms.search(t) && (ctx.mobiles.length || ctx.upiIds.length || nonofficial.length)
        && (ctx.amounts.length || L.money_terms.search(t))
        && SEND_MONEY.finditer(t).some(function (x) { return !advisory(x); })) {
      fire("scheme_fee");
    }
    // A donation appeal paid to a personal UPI ID or phone number: the fake medical or relief appeal. On once the
    // fraud pack defines donation_appeal and donation_terms; mirrors sahayak/fraud/signals.py.
    if (self.defs.donation_appeal && (ctx.upiIds.length || mobiles.length)
        && (ctx.amounts.length || ctx.upiIds.length || L.money_terms.search(t) || WALLET_TERMS.search(t))
        && L.donation_terms.finditer(t).some(function (x) { return !advisory(x); })) {
      fire("donation_appeal");
    }
    if (L.challan_terms.search(t) && nonofficial.length) fire("challan_link");
    if (L.tax_refund_terms.search(t) && (nonofficial.length || fired.has("personal_info_request"))) fire("tax_refund_bait");
    for (const x of L.remote_access.finditer(t)) {
      if (!self.negatedInSentence(t, x) && !L.advisory.search(sentence(t, x.start, x.end))) {
        fire("remote_access");
        break;
      }
    }
    if (!fired.has("link_apk") && nonofficial.length && install.some(function (i) { return !negated(i); })) fire("app_install");
    if (ctx.mixedTokens.length) fire("lookalike_text");

    // --- signs of a genuine message (lower the score, never to "safe")
    const asked = REQUESTS.some(function (r) { return fired.has(r); });
    const adv = L.advisory.search(t);
    const negatedShare = L.share_verbs.finditer(t).some(negated);
    if (L.otp_terms.search(t) && hasCode(t) && (adv || negatedShare) && !asked && !nonofficial.length) {
      fire("genuine_otp_delivery");
    }
    // a bank's transaction alert, not a person's story of a call (signals.py)
    if (L.debit_credit_terms.search(t) && L.account_terms.search(t) && ctx.amounts.length
        && !nonofficial.length && !asked && ctx.inputType !== "call") {
      fire("genuine_txn_alert");
    }
    if (doorstep && !asked && self.defs.doorstep_code) fire("doorstep_code");
    if (adv && !asked) fire("advisory");
    // It says there is no hurry, gives no new place to send money (no UPI ID, number, link or account
    // number) and nothing else in it looks like a scam: "mere purane account me bhej dena, koi jaldi nahi".
    // This can outweigh the wording model alone, never a scam sign. Packs from 1.6.0.
    if (calm && self.defs.no_pressure && !Array.from(fired.values()).some(function (f) { return f.weight > 0; })
        && !(ctx.upiIds.length || ctx.mobiles.length || ctx.urls.length || LONG_NUMBER.search(t))) {
      fire("no_pressure", { phrase: calm.group(0) });
    }
    // In person: come to a camp, office, shop or interview, or bring your papers, with no money, unknown link or
    // UPI ID asked (signals.py in_person); and a call the person says asked for nothing (nothing_asked).
    const positives = Array.from(fired.values()).filter(function (f) { return f.weight > 0; }).map(function (f) { return f.id; });
    if (self.defs.in_person && !nonofficial.length && !ctx.upiIds.length) {
      const visits = L.in_person ? L.in_person.finditer(t).filter(function (x) { return !unclear(x); }) : [];
      const amounts = AMOUNT_RE.finditer(t);
      const pay = PAY_CUE.finditer(t).concat(WALLET_TERMS.finditer(t)).filter(function (x) {
        return !negated(x) && !NO_FEE.search(t.slice(Math.max(0, x.start - 10), x.start));
      });
      const money = (amounts.length > 0 && pay.length > 0) || visits.some(function (v) {
        return amounts.some(function (a) { const d = v.start - a.end; return d >= 0 && d <= 25; });
      });
      const visit = visits.length && !money && !positives.some(function (s) { return !SOFT_FOR_VISIT.has(s); }) ? visits[0] : null;
      let bring = null;
      if (L.bring_verbs && L.bring_items && !positives.some(function (s) { return !IN_PERSON_OK.has(s); })) {
        const brings = L.bring_verbs.finditer(t), items = L.bring_items.finditer(t);
        if (brings.length && items.length && near(brings, items, 40)) bring = brings[0];
      }
      if (visit || bring) fire("in_person", { phrase: (visit || bring).group(0) });
    }
    if (self.defs.nothing_asked && L.nothing_asked && ctx.inputType === "call" && L.nothing_asked.search(t)
        && !positives.some(function (s) { return !SOFT.has(s); }) && !nonofficial.length && !ctx.upiIds.length
        && !L.action_terms.search(t) && secrets.every(function (x) { return negated(x); })) {
      fire("nothing_asked");
    }

    return Array.from(fired.values());
  };

  // ======================================================================= patterns.py + classifier.py

  /** sklearn's char_wb analyzer on an already-lowercased document: n-grams inside words, each word
   *  padded with one space each side, a word shorter than n counted once. For each n-gram calls
   *  emit(w, offs, a, b): code points [a, b) of the padded word w, whose UTF-16 offsets are offs
   *  (null when w has no astral characters, so code points and UTF-16 units coincide). */
  function charWb(doc, minN, maxN, emit) {
    const words = pySplit(doc);
    for (let x = 0; x < words.length; x++) {
      const w = " " + words[x] + " ";
      let offs = null, len = w.length;
      if (HAS_SURROGATE.test(w)) { offs = new PyText(w).c2u; len = offs.length - 1; }
      for (let n = minN; n <= maxN; n++) {
        let offset = 0;
        emit(w, offs, 0, n < len ? n : len);
        while (offset + n < len) {
          offset++;
          emit(w, offs, offset, offset + n);
        }
        if (offset === 0) break;  // count a short word (w_len < n) only once
      }
    }
  }
  function gram(w, offs, a, b) { return offs ? w.slice(offs[a], offs[b]) : w.slice(a, b); }
  function cmpCodePoints(a, b) {  // Python orders str by code point; JavaScript's < by UTF-16 unit
    if (HAS_SURROGATE.test(a) || HAS_SURROGATE.test(b)) {
      const x = Array.from(a), y = Array.from(b);
      for (let i = 0; i < Math.min(x.length, y.length); i++) {
        const d = x[i].codePointAt(0) - y[i].codePointAt(0);
        if (d) return d;
      }
      return x.length - y.length;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /** Similarity to known scams: TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5),
   *  sublinear_tf=True) fitted on the folded pattern texts, cosine (linear kernel) to each. */
  function PatternMatcher(patterns, threshold, fused) {
    this.threshold = threshold;
    this.fused = fused;
    this.ids = patterns.map(function (p) { return p.id; });
    this.categories = patterns.map(function (p) { return p.category; });
    // CountVectorizer: vocabulary in first-seen order, counts per document in first-seen order
    const first = new Map(), docs = [];
    for (const p of patterns) {
      const counts = new Map();
      charWb(fold(p.text).toLowerCase(), 3, 5, function (w, offs, a, b) {
        const g = gram(w, offs, a, b);
        if (!first.has(g)) first.set(g, first.size);
        counts.set(g, (counts.get(g) || 0) + 1);
      });
      docs.push(counts);
    }
    // features renumbered in sorted term order; each row stays stored in first-seen order
    const terms = Array.from(first.keys()).sort(cmpCodePoints);
    this.vocab = new Map(terms.map(function (term, i) { return [term, i]; }));
    const nTerms = terms.length, nDocs = docs.length;
    const df = new Float64Array(nTerms);
    for (const counts of docs) counts.forEach(function (c, term) { df[this.vocab.get(term)] += 1; }, this);
    // smooth_idf: ln((1 + n) / (1 + df)) + 1
    this.idf = new Float64Array(nTerms);
    const idfOf = new Map();  // one value per document frequency
    for (let k = 0; k < nTerms; k++) {
      if (!idfOf.has(df[k])) idfOf.set(df[k], crLog((nDocs + 1) / (df[k] + 1)) + 1);
      this.idf[k] = idfOf.get(df[k]);
    }
    // rows: (1 + ln tf) * idf, l2-normalised; kept per term (a CSC matrix) for the dot products
    const postings = [];
    for (let k = 0; k < nTerms; k++) postings.push([]);
    docs.forEach(function (counts, j) {
      const row = Array.from(counts.entries())
        .sort(function (x, y) { return first.get(x[0]) - first.get(y[0]); })
        .map(function (e) { const k = this.vocab.get(e[0]); return [k, (logCount(e[1]) + 1) * this.idf[k]]; }, this);
      let ss = 0;
      for (const e of row) ss = fused ? fma(e[1], e[1], ss) : ss + e[1] * e[1];
      if (ss === 0) return;
      const norm = Math.sqrt(ss);
      for (const e of row) postings[e[0]].push(j, e[1] / norm);
    }, this);
    this.postings = postings;
  }
  PatternMatcher.prototype.best = function (lowered) {
    // CountVectorizer.transform: counts of known terms; then sorted by feature index (sort_indices)
    const vocab = this.vocab, counts = this.counts || (this.counts = new Int32Array(this.idf.length)), ks = [];
    charWb(lowered, 3, 5, function (w, offs, a, b) {
      const k = vocab.get(gram(w, offs, a, b));
      if (k !== undefined && counts[k]++ === 0) ks.push(k);
    });
    ks.sort(function (a, b) { return a - b; });
    const vals = new Float64Array(ks.length);
    let ss = 0;
    for (let i = 0; i < ks.length; i++) {
      const v = (logCount(counts[ks[i]]) + 1) * this.idf[ks[i]];
      counts[ks[i]] = 0;
      vals[i] = v;
      ss = this.fused ? fma(v, v, ss) : ss + v * v;
    }
    const sims = new Float64Array(this.ids.length);
    if (ss !== 0) {
      const norm = Math.sqrt(ss);
      for (let i = 0; i < ks.length; i++) {
        const q = vals[i] / norm, post = this.postings[ks[i]];
        for (let p = 0; p < post.length; p += 2) {
          const j = post[p];
          sims[j] = this.fused ? fma(q, post[p + 1], sims[j]) : sims[j] + q * post[p + 1];
        }
      }
    }
    let best = 0;
    for (let j = 1; j < sims.length; j++) if (sims[j] > sims[best]) best = j;
    return { score: sims[best], category: this.categories[best], pattern_id: this.ids[best] };
  };

  const N_FEATURES = 65536;  // 2 ** 16
  /** Calibrated scam classifier: logistic regression over hashed character 2-5 grams
   *  (HashingVectorizer(analyzer="char_wb", n_features=2**16, alternate_sign=False, norm="l2"))
   *  plus the fired signals. It never decides alone: above its threshold it fires
   *  `classifier_flag`, one more weighted signal in the explainable score. */
  function ScamClassifier(model) {
    this.signalIds = model.signal_ids.slice();
    this.threshold = Number(model.threshold);
    this.intercept = Number(model.intercept);
    this.textCoef = new Float64Array(N_FEATURES);
    for (const k of Object.keys(model.text_coef)) this.textCoef[parseInt(k, 10)] = Number(model.text_coef[k]);
    this.signalCoef = model.signal_coef.map(Number);
  }
  ScamClassifier.prototype.probability = function (lowered, firedIds) {
    // FeatureHasher: murmurhash3_32(UTF-8 bytes, seed 0) -> abs(h) % n_features, +1 per occurrence;
    // then sum_duplicates() sorts the features by index
    const counts = this.counts || (this.counts = new Int32Array(N_FEATURES)), idx = [];
    let enc = null, encFor = null;
    charWb(lowered, 2, 5, function (w, offs, a, b) {
      if (encFor !== w) { enc = utf8(w); encFor = w; }
      const h = murmur3(enc.bytes, enc.offs[a], enc.offs[b]);
      const i = h === -2147483648 ? (2147483647 - (N_FEATURES - 1)) % N_FEATURES : Math.abs(h) % N_FEATURES;
      if (counts[i]++ === 0) idx.push(i);
    });
    idx.sort(function (a, b) { return a - b; });
    let z = this.intercept, ss = 0;
    for (const i of idx) ss += counts[i] * counts[i];  // whole numbers: exact in any order
    if (ss !== 0) {
      const norm = Math.sqrt(ss);
      for (const i of idx) z += this.textCoef[i] * (counts[i] / norm);
    }
    for (const i of idx) counts[i] = 0;
    let dot = 0;  // signal_coef @ signal_vector (numpy may sum in another order: ulp-level only)
    for (let i = 0; i < this.signalIds.length; i++) dot += this.signalCoef[i] * (firedIds.has(this.signalIds[i]) ? 1 : 0);
    z += dot;
    return 1 / (1 + crExp(-z));
  };

  // ======================================================================= verdict.py

  const LANGS = ["en", "hi"];

  function fill(template, evidence) {
    const out = {};
    for (const lang of LANGS) {
      let text = template[lang];
      for (const key of Object.keys(evidence)) text = text.split("{" + key + "}").join(String(evidence[key]));
      out[lang] = text;
    }
    return out;
  }

  function score(fired, pack) {
    const floor = pack.thresholds.negative_floor;
    let positive = 0, negative = 0;
    for (const f of fired) if (f.weight > 0) positive += f.weight;
    for (const f of fired) if (f.weight < 0) negative += f.weight;
    return [pyRound(positive + (negative >= floor ? negative : floor), 3), fired.some(function (f) { return f.hard; })];
  }

  function levelFor(risk, hard, pack) {
    const th = pack.thresholds;
    if (hard || risk >= th.scam) return "scam";
    if (risk >= th.suspicious) return "suspicious";
    return "no_signs";
  }

  function confidenceFor(risk, hard) {
    const p = 1 / (1 + crExp(-1.5 * (risk - 2.25)));
    return pyRound(hard ? Math.max(p, 0.97) : p, 3);
  }

  function pickCategory(fired, pack) {
    const totals = new Map();
    for (const f of fired) {
      // a signal can carry its own category (pattern_match names the scam it resembles)
      const cat = f.evidence._category || pack.signals[f.id].category;
      if (cat && f.weight > 0) totals.set(cat, (totals.get(cat) || 0) + (f.weight + (f.hard ? 10 : 0)));
    }
    if (!totals.size) return "generic";
    const cats = pack.categories;
    let best = null, bestTotal = 0, bestPrio = 0;
    totals.forEach(function (total, c) {  // max(): the first of equal keys wins
      const prio = cats[c].priority;
      if (best === null || total > bestTotal || (total === bestTotal && prio > bestPrio)) {
        best = c; bestTotal = total; bestPrio = prio;
      }
    });
    return best;
  }

  function copy(x) { return JSON.parse(JSON.stringify(x)); }

  function buildCard(fired, pack, unread) {
    const sc = score(fired, pack), risk = sc[0], hard = sc[1];
    let level = levelFor(risk, hard, pack);
    if (level === "no_signs" && unread && pack.verdicts.unreadable) level = "unreadable";
    const category = level !== "no_signs" && level !== "unreadable" ? pickCategory(fired, pack) : null;
    const defs = pack.signals, cats = pack.categories;
    const show = function (f) { return defs[f.id].show === undefined ? true : defs[f.id].show; };
    const language = level === "unreadable" ? pack.unreadable.scripts[unread] || null : null;
    let reasons, actions;

    if (level === "unreadable") {
      reasons = [{ id: "unread_script", text: fill(pack.unreadable.reason, {}), weight: 0.0 }];
      actions = pack.unreadable.actions;
    } else if (level === "no_signs") {
      const shown = fired.filter(function (f) { return f.weight < 0 && show(f); });
      shown.sort(function (a, b) { return a.weight - b.weight; });
      reasons = shown.slice(0, 2).map(function (f) { return { id: f.id, text: fill(defs[f.id].reason, f.evidence), weight: f.weight }; });
      if (!reasons.length) reasons = [{ id: "no_signals", text: copy(pack.no_signs.default_reason), weight: 0.0 }];
      actions = pack.no_signs.actions;
    } else {
      const shown = fired.filter(function (f) { return f.weight > 0 && show(f); });
      shown.sort(function (a, b) { return (Number(!a.hard) - Number(!b.hard)) || (b.weight - a.weight); });
      reasons = shown.slice(0, 3).map(function (f) {
        return { id: f.id, text: fill(defs[f.id].reason, f.evidence), weight: f.weight, hard: f.hard };
      });
      if (!reasons.length) {  // only hidden low-weight signals fired
        const hidden = fired.filter(function (f) { return f.weight > 0; }).sort(function (a, b) { return b.weight - a.weight; }).slice(0, 2);
        reasons = hidden.map(function (f) { return { id: f.id, text: fill(defs[f.id].reason, f.evidence), weight: f.weight }; });
      }
      actions = cats[category].actions;
    }

    const verdictText = pack.verdicts[level];
    const catName = category ? cats[category].name : null;
    const headline = {};
    for (const lang of LANGS) {
      headline[lang] = verdictText.headline[lang].split("{category}").join(catName ? catName[lang] : "")
        .split("{language}").join(language ? language[lang] : "");
    }
    const acts = {};
    for (const lang of LANGS) acts[lang] = actions[lang].slice();
    return {
      verdict: level,
      label: copy(verdictText.label),
      headline: headline,
      category: category ? { id: category, name: copy(catName) } : null,
      risk_score: risk,
      confidence: confidenceFor(risk, hard),
      hard_signal: hard,
      reasons: reasons,
      actions: acts,
      sensitive: fired.some(function (f) { return !!defs[f.id].sensitive; }),
      signals: fired.map(function (f) { return { id: f.id, weight: f.weight, hard: f.hard }; }),
    };
  }

  // ======================================================================= qr.py: parse_upi, rupees, analyse

  // words that claim the scan will bring money in: what a payment QR can never do
  const RECEIVE_CLAIM = new Rx(
    String.raw`receive|refund|cashback|cash\s*back|prize|reward|lottery|winning|won\b|credit(?:ed)?\b|bonus|gift|` +
    String.raw`milega|milenge|paane|पाने|मिलेगा|मिलेंगे|इनाम|कैशबैक|रिफंड|लॉटरी|जीत`, true);
  const OFFICIAL_NAME = new Rx(
    String.raw`\b(?:sbi|hdfc|icici|axis|pnb|bank|rbi|npci|police|cbi|customs|court|government|govt|sarkar|pm[\s-]?kisan|` +
    String.raw`electricity|bijli|kyc|customer\s*care|helpline|income\s*tax|uidai|aadhaar)\b`, true);
  const LINK_START = new Rx(String.raw`https?://|www\.`, true);  // re.match(r"(?i)https?://|www\.", payload)

  function pyError(type, message) {
    const e = new Error(message);
    e.name = type;
    return e;
  }

  /** float(s) as CPython 3.11 reads a str; null where Python raises ValueError. */
  function pyFloat(s) {
    let t = s;
    if (/[^\x00-\x7f]/.test(s)) {  // _PyUnicode_TransformDecimalAndSpaceToASCII
      t = "";
      for (const ch of s) {
        const cp = ch.codePointAt(0);
        if (cp < 127) t += ch;
        else if (IS_SPACE.test(ch)) t += " ";
        else {
          const d = decimalValue(cp);
          if (d < 0) { t += "?"; break; }
          t += String(d);
        }
      }
    }
    if (t.indexOf("_") >= 0) {  // underscores only between digits
      let out = "", prev = "";
      for (const c of t) {
        const isDigit = c >= "0" && c <= "9";
        if (c === "_") { if (!(prev >= "0" && prev <= "9")) return null; }
        else { if (prev === "_" && !isDigit) return null; out += c; }
        prev = c;
      }
      if (prev === "_") return null;
      t = out;
    }
    t = t.replace(/^[ \t\n\v\f\r]+/, "").replace(/[ \t\n\v\f\r]+$/, "");
    const m = /^([+-]?)(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|(inf|infinity)|(nan))$/i.exec(t);
    if (!m) return null;
    if (m[3]) return m[1] === "-" ? -Infinity : Infinity;
    if (m[4]) return NaN;
    return Number(m[1] + m[2]);
  }

  /** UTF-8 bytes to str with errors="replace" (one U+FFFD per maximal ill-formed subsequence). */
  function utf8Decode(bytes) {
    let out = "", i = 0;
    while (i < bytes.length) {
      const b = bytes[i];
      if (b < 0x80) { out += String.fromCharCode(b); i++; continue; }
      let need, cp, lo = 0x80, hi = 0xBF;
      if (b >= 0xC2 && b <= 0xDF) { need = 1; cp = b & 0x1F; }
      else if (b >= 0xE0 && b <= 0xEF) { need = 2; cp = b & 0x0F; if (b === 0xE0) lo = 0xA0; if (b === 0xED) hi = 0x9F; }
      else if (b >= 0xF0 && b <= 0xF4) { need = 3; cp = b & 0x07; if (b === 0xF0) lo = 0x90; if (b === 0xF4) hi = 0x8F; }
      else { out += "�"; i++; continue; }
      let j = i + 1, ok = true;
      for (let k = 0; k < need; k++, j++) {
        const c = bytes[j];
        if (c === undefined || c < lo || c > hi) { ok = false; break; }
        cp = (cp << 6) | (c & 0x3F);
        lo = 0x80; hi = 0xBF;
      }
      if (!ok) { out += "�"; i = j; continue; }
      out += String.fromCodePoint(cp);
      i = j;
    }
    return out;
  }

  const HEX2 = /^[0-9A-Fa-f]{2}/;
  /** urllib.parse.unquote(string) (utf-8, errors="replace"). */
  function unquote(s) {
    if (s.indexOf("%") < 0) return s;
    // percent-escapes are decoded inside each run of ASCII characters
    return s.replace(/[\x00-\x7f]+/g, function (run) {
      const bits = run.split("%"), bytes = [];
      const push = function (str) { for (let i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i)); };
      push(bits[0]);
      for (let i = 1; i < bits.length; i++) {
        const item = bits[i];
        if (HEX2.test(item)) { bytes.push(parseInt(item.slice(0, 2), 16)); push(item.slice(2)); }
        else { bytes.push(0x25); push(item); }
      }
      return utf8Decode(bytes);
    });
  }

  /** parse_qs(qs, keep_blank_values=True): name -> [values], first-seen order. */
  function parseQs(qs) {
    const out = new Map();
    if (!qs) return out;
    for (const nameValue of qs.split("&")) {
      if (!nameValue) continue;
      const eq = nameValue.indexOf("=");
      const name = unquote((eq >= 0 ? nameValue.slice(0, eq) : nameValue).split("+").join(" "));
      const value = unquote((eq >= 0 ? nameValue.slice(eq + 1) : "").split("+").join(" "));
      if (out.has(name)) out.get(name).push(value); else out.set(name, [value]);
    }
    return out;
  }

  function ipv4Int(s) {  // ipaddress.IPv4Address(s)._ip, or null
    if (!s || s.indexOf("/") >= 0) return null;
    const octets = s.split(".");
    if (octets.length !== 4) return null;
    let ip = 0;
    for (const o of octets) {
      if (!o || !/^[0-9]+$/.test(o) || o.length > 3 || (o !== "0" && o[0] === "0")) return null;
      const v = parseInt(o, 10);
      if (v > 255) return null;
      ip = ip * 256 + v;
    }
    return ip;
  }
  function isIpv6(s) {  // ipaddress.IPv6Address(s) succeeds
    if (s.indexOf("/") >= 0) return false;
    const pct = s.indexOf("%");
    if (pct >= 0) {
      const scope = s.slice(pct + 1);
      if (!scope || scope.indexOf("%") >= 0) return false;
      s = s.slice(0, pct);
    }
    if (!s || cpLen(s) > 45) return false;
    // split(':', maxsplit=9)
    let parts = s.split(":");
    if (parts.length > 10) parts = parts.slice(0, 9).concat([parts.slice(9).join(":")]);
    if (parts.length < 3) return false;
    if (parts[parts.length - 1].indexOf(".") >= 0) {
      const v4 = ipv4Int(parts.pop());
      if (v4 === null) return false;
      parts.push(Math.floor(v4 / 65536).toString(16), (v4 % 65536).toString(16));
    }
    if (parts.length > 9) return false;
    let skip = null;
    for (let i = 1; i < parts.length - 1; i++) {
      if (!parts[i]) { if (skip !== null) return false; skip = i; }
    }
    let hi, lo;
    if (skip !== null) {
      hi = skip; lo = parts.length - skip - 1;
      if (!parts[0]) { hi -= 1; if (hi) return false; }
      if (!parts[parts.length - 1]) { lo -= 1; if (lo) return false; }
      if (8 - (hi + lo) < 1) return false;
    } else {
      if (parts.length !== 8 || !parts[0] || !parts[parts.length - 1]) return false;
      hi = parts.length; lo = 0;
    }
    const hextets = parts.slice(0, hi).concat(lo ? parts.slice(parts.length - lo) : []);
    return hextets.every(function (h) { return /^[0-9a-fA-F]{1,4}$/.test(h); });
  }

  /** urllib.parse.urlsplit(url): scheme, netloc, path, query, fragment (Python 3.11.15). */
  function urlsplit(url) {
    url = url.replace(/^[\x00-\x20]+/, "").replace(/[\t\r\n]/g, "");
    let scheme = "", netloc = "", query = "", fragment = "";
    const i = url.indexOf(":");
    if (i > 0 && /^[A-Za-z]/.test(url) && /^[A-Za-z0-9+\-.]*$/.test(url.slice(0, i))) {
      scheme = url.slice(0, i).toLowerCase(); url = url.slice(i + 1);
    }
    if (url.slice(0, 2) === "//") {
      let delim = url.length;
      for (const c of "/?#") { const w = url.indexOf(c, 2); if (w >= 0) delim = Math.min(delim, w); }
      netloc = url.slice(2, delim); url = url.slice(delim);
      const open = netloc.indexOf("[") >= 0, close = netloc.indexOf("]") >= 0;
      if (open !== close) throw pyError("ValueError", "Invalid IPv6 URL");
      if (open && close) checkBracketedNetloc(netloc);
    }
    let k = url.indexOf("#");
    if (k >= 0) { fragment = url.slice(k + 1); url = url.slice(0, k); }
    k = url.indexOf("?");
    if (k >= 0) { query = url.slice(k + 1); url = url.slice(0, k); }
    checkNetloc(netloc);
    return { scheme: scheme, netloc: netloc, path: url, query: query, fragment: fragment };
  }
  function partition(s, sep) {
    const i = s.indexOf(sep);
    return i < 0 ? [s, "", ""] : [s.slice(0, i), sep, s.slice(i + sep.length)];
  }
  function checkBracketedNetloc(netloc) {
    const hostAndPort = netloc.slice(netloc.lastIndexOf("@") + 1);
    const p = partition(hostAndPort, "[");
    let hostname, port;
    if (p[1]) {
      if (p[0]) throw pyError("ValueError", "Invalid IPv6 URL");
      const q = partition(p[2], "]");
      hostname = q[0]; port = q[2];
      if (port && !port.startsWith(":")) throw pyError("ValueError", "Invalid IPv6 URL");
    } else {
      hostname = partition(hostAndPort, ":")[0];
    }
    if (hostname.startsWith("v")) {
      if (!/^v[a-fA-F0-9]+\.[^\n]+$/.test(hostname)) throw pyError("ValueError", "IPvFuture address is invalid");
    } else if (ipv4Int(hostname) !== null) {
      throw pyError("ValueError", "An IPv4 address cannot be in brackets");
    } else if (!isIpv6(hostname)) {
      throw pyError("ValueError", "does not appear to be an IPv4 or IPv6 address");
    }
  }
  function checkNetloc(netloc) {
    if (!netloc || /^[\x00-\x7f]*$/.test(netloc)) return;
    // looking for characters like ℀ that expand to 'a/c' under NFKC
    const prot = new Protector([netloc]);
    const n = prot.wrap(netloc.split("@").join("").split(":").join("").split("#").join("").split("?").join(""));
    const n2 = n.normalize("NFKC");
    if (n === n2) return;
    for (const c of "/?#@:") {
      if (n2.indexOf(c) >= 0) throw pyError("ValueError", "netloc '" + netloc + "' contains invalid characters under NFKC normalization");
    }
  }

  /** upi://pay?pa=…&pn=…&am=… -> its fields, or null if this is not a UPI payment code. */
  function parseUpi(payload) {
    if (!payload.toLowerCase().startsWith("upi://")) return null;
    const parts = urlsplit(payload);
    const q = new Map();
    parseQs(parts.query).forEach(function (v, k) { q.set(k.toLowerCase(), pyStrip(unquote(v[0]))); });
    const get = function (k, dflt) { return q.has(k) ? q.get(k) : dflt; };
    let amount = null;
    if (get("am", "")) {
      const f = pyFloat(q.get("am"));
      amount = f === null ? null : pyRound(f, 2);
    }
    return {
      action: parts.netloc.toLowerCase() || "pay", payee: get("pa", ""), name: get("pn", ""),
      amount: amount, currency: get("cu", "INR") || "INR", note: get("tn", ""),
      merchant_code: get("mc", ""),
    };
  }

  function truthy(x) { return x !== null && x !== 0; }  // Python bool() of a float or None (nan is true)

  function rupees(amount) {
    if (amount !== amount) throw pyError("ValueError", "cannot convert float NaN to integer");
    if (!isFinite(amount)) throw pyError("OverflowError", "cannot convert float infinity to integer");
    const whole = Math.trunc(amount);
    const digits = intString(whole);
    let s;
    if (whole >= 100000) {  // Indian grouping: 1,00,000
      const head = digits.slice(0, -3).replace(/(\d)(?=(\d{2})+$)/g, "$1,");
      s = head + "," + digits.slice(-3);
    } else {
      const neg = digits[0] === "-", d = neg ? digits.slice(1) : digits;
      s = (neg ? "-" : "") + d.replace(/\B(?=(\d{3})+$)/g, ",");
    }
    let frac = "";
    if (amount !== whole) {
      const cents = intString(pyRoundInt(amount * 100));
      const neg = cents[0] === "-";
      let mod = parseInt((neg ? cents.slice(1) : cents).slice(-2), 10);  // int(...) % 100, Python's sign rule
      if (neg && mod) mod = 100 - mod;
      frac = "." + String(mod).padStart(2, "0");
    }
    return "₹" + s + frac;
  }

  /** What the QR does, in words, and the text to run through the scam check. */
  function analyse(payload) {
    if (typeof payload !== "string") throw new TypeError("payload must be a string");
    const prot = new Protector([payload]);
    const upi = parseUpi(payload);
    if (upi === null) {
      return { kind: LINK_START.match(prot.wrap(payload), 0) ? "link" : "text", payload: cpSlice(payload, 0, 500),
        check_text: cpSlice(payload, 0, 4000), facts: [] };
    }
    const who = upi.name || upi.payee || "someone";
    const amount = truthy(upi.amount) ? rupees(upi.amount) : null;
    const facts = [{
      hi: "इस QR को स्कैन करके UPI PIN डालने पर पैसे आपके खाते से " + who + " को जाते हैं" + (amount ? " (" + amount + ")" : "") +
          "। QR से पैसे कभी आते नहीं।",
      en: "Scanning this QR and entering your UPI PIN sends money from your account to " + who +
          (amount ? " (" + amount + ")" : "") + ". A QR never brings money in.",
    }];
    const flags = [];
    const claim = [upi.note, upi.name].join(" ");
    const p2 = new Protector([claim]);
    if (RECEIVE_CLAIM.search(p2.wrap(claim))) flags.push("receive_claim");
    if (OFFICIAL_NAME.search(p2.wrap(upi.name)) && !upi.merchant_code) {
      flags.push("official_name");
      facts.push({
        hi: "नाम \"" + upi.name + "\" लिखा है, पर पैसे UPI ID " + upi.payee + " में जाएँगे। बैंक, पुलिस या सरकार QR से पैसे नहीं माँगते।",
        en: "It says \"" + upi.name + "\", but the money goes to the UPI ID " + upi.payee + ". Banks, police and the government do not collect money by QR.",
      });
    }
    if (truthy(upi.amount) && upi.amount >= 10000) flags.push("large_amount");
    // What the code claims, written out, so the same signals and categories decide the verdict.
    let text;
    if (flags.indexOf("receive_claim") >= 0) text = "Scan the QR and enter your UPI PIN to receive money. " + upi.note + " " + upi.name;
    else text = "Pay " + (amount || "money") + " to " + upi.name + " (" + upi.payee + "). " + upi.note;
    const out = { kind: "upi" };
    for (const k of Object.keys(upi)) out[k] = upi[k];
    out.amount_text = amount; out.facts = facts; out.flags = flags; out.check_text = pyStrip(text);
    return out;
  }

  // ======================================================================= pipeline.py

  const INPUT_TYPES = ["text", "voice", "ocr", "qr", "call"];
  const now = typeof performance !== "undefined" && performance.now ? function () { return performance.now(); } : Date.now;

  function randomId() {  // uuid.uuid4().hex[:12]
    const b = new Uint8Array(6);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (let i = 0; i < 6; i++) b[i] = Math.floor(Math.random() * 256);
    return Array.from(b, function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
  }

  /** Build a checker from the three packs (plain objects, as parsed from packs/*.json).
   *  options: fraud (required), patterns, model (optional, like the node without those packs),
   *  fraudSha256 (shown on the card), fused (default true: the arm64 node's arithmetic). */
  function create(options) {
    const pack = options.fraud;
    if (!pack || !pack.signals) throw new Error("SahayakChecker.create: the fraud pack is required");
    const fused = options.fused === undefined ? true : !!options.fused;
    const engine = new SignalEngine(pack);
    const pat = options.patterns;
    const matcher = pat && pat.patterns ? new PatternMatcher(pat.patterns, Number(pat.threshold === undefined ? 0.5 : pat.threshold), fused) : null;
    const clf = options.model && options.model.signal_ids ? new ScamClassifier(options.model) : null;
    const sha = String(options.fraudSha256 || "").slice(0, 12);
    const defs = pack.signals, cats = pack.categories;

    /** check_message(text, sender, input_type): the verdict card. opts.debug adds `_debug` with the
     *  unrounded model scores, the folded text and the fired signals (for tests). */
    function check(text, opts) {
      opts = opts || {};
      if (typeof text !== "string") throw new TypeError("text must be a string");
      const t0 = now();
      let inputType = opts.inputType === undefined ? "text" : opts.inputType;
      if (INPUT_TYPES.indexOf(inputType) < 0) inputType = "text";
      const sender = typeof opts.sender === "string" ? opts.sender : null;
      const prot = new Protector([text, sender]);
      const ctx = buildContext(text, sender, inputType, prot);
      const fired = engine.run(ctx);
      const tSignals = now();

      const scores = {}, raw = {};
      // sklearn lowercases before its analyzers (str.lower(), which JavaScript matches exactly)
      const lowered = prot.unwrap(ctx.norm.toLowerCase());
      if (matcher) {
        const best = matcher.best(lowered);
        scores.pattern_similarity = pyRound(best.score, 3);
        raw.pattern_similarity = best.score; raw.pattern_id = best.pattern_id;
        if (best.score >= matcher.threshold) {
          const name = cats[best.category].name;
          fired.push({ id: "pattern_match", weight: Number(defs.pattern_match.weight), hard: false,
            evidence: { name: name.en, name_hi: name.hi, _category: best.category } });
        }
      }
      if (clf) {
        const p = clf.probability(lowered, new Set(fired.map(function (f) { return f.id; })));
        scores.classifier_p = pyRound(p, 3);
        raw.classifier_p = p;
        if (p >= clf.threshold) fired.push({ id: "classifier_flag", weight: Number(defs.classifier_flag.weight), hard: false, evidence: {} });
      }

      const card = buildCard(fired, pack, ctx.unread);
      card.id = randomId();
      card.input_type = inputType;
      card.lang_detected = ctx.lang;
      card.explainer = "template";
      card.model_scores = scores;
      card.helplines = card.verdict === "scam" || card.verdict === "suspicious" ? copy(pack.helplines) : [];
      card.extracted = {
        links: ctx.urls.map(function (u) { return prot.unwrap(u.raw); }),
        mobiles: ctx.mobiles.slice(),
        upi_ids: ctx.upiIds.slice(),
        amounts: ctx.amounts.slice(),
        rupees_at_risk: card.verdict === "scam" ? rupeesAtRisk(ctx.t) : 0.0,
      };
      card.pack = { name: pack.pack, version: pack.version, sha256: sha };
      card.timing_ms = { signals: pyRound(tSignals - t0, 2), total: pyRound(now() - t0, 2) };
      if (opts.debug) {
        raw.norm = prot.unwrap(ctx.norm);
        raw.fired = fired.map(function (f) { return { id: f.id, evidence: f.evidence }; });
        Object.defineProperty(card, "_debug", { value: raw, enumerable: false });
      }
      return card;
    }

    return {
      check: check,
      analyseQR: analyse,
      fold: function (text) { const p = new Protector([text]); return p.unwrap(fold(p.wrap(text))); },
      unicodeVersion: UNICODE_VERSION,
    };
  }

  return {
    create: create,
    analyseQR: analyse,
    fold: function (text) { const p = new Protector([text]); return p.unwrap(fold(p.wrap(text))); },
    rupees: rupees,
    parseUpi: parseUpi,
    _internal: { crLog: crLog, crExp: crExp, PatternMatcher: PatternMatcher, ScamClassifier: ScamClassifier, pyRe: pyRe, pyRound: pyRound, fma: fma, murmur3: murmur3, casefold: casefold, pyFloat: pyFloat, unquote: unquote },
  };
});
