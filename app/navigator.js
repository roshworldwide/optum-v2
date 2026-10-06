/* Benefits Navigator for the phone: the node's engine, in the browser, with no server.
 *
 * A line-for-line port of sahayak/navigator/engine.py plus the slip text of
 * sahayak/navigator/slip.py, so a phone that cannot reach a node asks the same questions and
 * shows the same results. tests/js/parity_nav.mjs replays thousands of answer sets through both
 * and requires every field to match, key order included.
 *
 *   const nav = SahayakNavigator.create(schemesPack);  // the parsed packs/schemes.v1.json
 *   nav.catalog()                                      // = GET  /api/navigator
 *   nav.next(answers)                                  // = POST /api/navigator/next
 *   nav.result(answers, already, today)                // = POST /api/navigator/result
 *
 * result() includes slip: {text, qr: null, date}; this file draws no QR. A bad answer throws
 * SahayakNavigator.AnswerError whose message is the node's (the node answers 422 with it).
 *
 * Answers are read the way the node reads them: off the wire, through JSON. So a number that
 * JSON.stringify writes as a whole number is a Python int (an exact age), any other number is a
 * float (not an age, and not a band id either), true/false are never ages, and keys whose value is
 * undefined are dropped. Error messages format values the way Python's str() and repr() do.
 *
 * Truth values, ordered F < U < L < T: T yes, L likely (the office wants proof), U not known,
 * F no. "all" takes the minimum, "any" the maximum; "not" swaps T and F and turns L into U.
 *
 * Plain ES2018, no dependencies. UMD: window.SahayakNavigator in a browser, module.exports in Node.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module && module.exports) module.exports = factory();
  else root.SahayakNavigator = factory();
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const F = 0, U = 1, L = 2, T = 3;
  const CODE = { F: F, U: U, L: L, T: T };
  const NAME = ["F", "U", "L", "T"];
  const STATUS = ["not_eligible", "check", "likely", "eligible"];
  const GROUPS = ["eligible", "likely", "check", "unlock", "have", "not_eligible"];
  const NOT = [T, U, U, F]; // indexed by truth value: F->T, U->U, L->U, T->F
  const AGE_MIN = 0, AGE_MAX = 120;
  const SLIP_LABELS = [["eligible", "ELIGIBLE"], ["likely", "LIKELY (needs proof)"], ["check", "CHECK AT OFFICE"],
    ["unlock", "AFTER OPENING A BANK ACCOUNT"], ["have", "ALREADY GETS"]];
  const YEARS_HI = "\u0938\u093e\u0932"; // the Hindi "years" in engine.py's profile()

  class AnswerError extends Error {
    constructor(message) {
      super(message);
      this.name = "AnswerError";
    }
  }

  const hasOwn = Object.prototype.hasOwnProperty;
  const has = (o, k) => o !== null && typeof o === "object" && hasOwn.call(o, k);
  const isPlainObject = (v) => Object.prototype.toString.call(v) === "[object Object]";
  const now = typeof performance !== "undefined" && performance && typeof performance.now === "function"
    ? () => performance.now() : () => Date.now();
  const jsonCopy = (v) => JSON.parse(JSON.stringify(v));

  // ------------------------------------------------------------------ Python semantics

  // JSON.stringify writes an integer below 1e21 without a fraction or an exponent, so the node's
  // JSON parser makes it a Python int; every other finite number reaches the node as a float.
  const isInt = (v) => typeof v === "number" && Number.isInteger(v) && Math.abs(v) < 1e21;

  // Python's repr(float): the shortest round-trip digits (as String() gives), laid out by
  // Python's rules: exponent form when the decimal point is 4+ places left or 16+ places right.
  function pyFloat(x) {
    if (Number.isNaN(x)) return "nan";
    if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
    if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
    const parts = String(Math.abs(x)).split("e");
    const mant = parts[0].split(".");
    let digits = mant[0] + (mant[1] || "");
    let decpt = mant[0].length + (parts.length > 1 ? Number(parts[1]) : 0);
    const lead = /^0*/.exec(digits)[0].length;
    digits = digits.slice(lead).replace(/0+$/, "");
    decpt -= lead;
    let s;
    if (decpt <= -4 || decpt > 16) {
      const e = decpt - 1;
      s = digits[0] + (digits.length > 1 ? "." + digits.slice(1) : "") + "e" + (e < 0 ? "-" : "+") +
        String(Math.abs(e)).padStart(2, "0");
    } else if (decpt <= 0) {
      s = "0." + "0".repeat(-decpt) + digits;
    } else if (decpt >= digits.length) {
      s = digits + "0".repeat(decpt - digits.length) + ".0";
    } else {
      s = digits.slice(0, decpt) + "." + digits.slice(decpt);
    }
    return (x < 0 ? "-" : "") + s;
  }

  // str.isprintable(): everything but categories Cc Cf Cs Co Cn Zl Zp Zs, except the ASCII space.
  // (Python and the browser may ship different Unicode versions; only characters assigned in
  // between can differ, and only inside error messages.)
  const NON_PRINTABLE = /^[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]$/u;
  const hex = (n, width) => n.toString(16).padStart(width, "0");

  function pyReprStr(s) {
    const quote = s.indexOf("'") >= 0 && s.indexOf('"') < 0 ? '"' : "'";
    let out = quote;
    for (const ch of s) { // code points; a lone surrogate comes through on its own
      const cp = ch.codePointAt(0);
      if (ch === quote || ch === "\\") out += "\\" + ch;
      else if (ch === "\t") out += "\\t";
      else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (cp < 0x20 || cp === 0x7f) out += "\\x" + hex(cp, 2);
      else if (cp < 0x7f) out += ch;
      else if (!NON_PRINTABLE.test(ch)) out += ch;
      else if (cp <= 0xff) out += "\\x" + hex(cp, 2);
      else if (cp <= 0xffff) out += "\\u" + hex(cp, 4);
      else out += "\\U" + hex(cp, 8);
    }
    return out + quote;
  }

  // repr() of a JSON value as Python holds it (None, bool, int, float, str, list, dict).
  function pyRepr(v) {
    if (v === null || v === undefined) return "None";
    if (v === true) return "True";
    if (v === false) return "False";
    if (typeof v === "number") return isInt(v) ? String(v) : pyFloat(v);
    if (typeof v === "string") return pyReprStr(v);
    if (Array.isArray(v)) return "[" + v.map(pyRepr).join(", ") + "]";
    return "{" + Object.keys(v).map((k) => pyReprStr(k) + ": " + pyRepr(v[k])).join(", ") + "}";
  }

  const pyStr = (v) => (typeof v === "string" ? v : pyRepr(v)); // str(), as f-strings use

  // Python ==: 1 == 1.0 == True, containers compare by content (dicts ignoring key order).
  function pyEq(a, b) {
    if (typeof a === "string" || typeof b === "string") return a === b;
    if (a === null || b === null) return a === b;
    const scalar = (v) => typeof v === "number" || typeof v === "boolean";
    if (scalar(a) || scalar(b)) return scalar(a) && scalar(b) && Number(a) === Number(b);
    if (Array.isArray(a) || Array.isArray(b)) {
      return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => pyEq(x, b[i]));
    }
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => hasOwn.call(b, k) && pyEq(a[k], b[k]));
  }

  // Python truthiness for JSON values.
  function pyTruthy(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string" || Array.isArray(v)) return v.length > 0;
    return Object.keys(v).length > 0;
  }

  // Python orders str by code point; JS's default sort uses UTF-16 units, which differ past U+FFFF.
  function cmpCodePoints(a, b) {
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      const x = a.codePointAt(i), y = b.codePointAt(j);
      if (x !== y) return x < y ? -1 : 1;
      i += x > 0xffff ? 2 : 1;
      j += y > 0xffff ? 2 : 1;
    }
    return i < a.length ? 1 : j < b.length ? -1 : 0;
  }

  // " ".join(text.split()): str.split() splits on Python's whitespace, which is not JS's \s.
  const PY_SPACE = /[\t\n\v\f\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;
  const collapseSpace = (text) => text.split(PY_SPACE).filter((w) => w.length > 0).join(" ");

  // template.format(n=value), for the pack's {n} placeholders ({{ and }} are literal braces).
  function formatN(template, value) {
    return template.replace(/\{\{|\}\}|\{([^{}]*)\}|[{}]/g, (m, field) => {
      if (m === "{{") return "{";
      if (m === "}}") return "}";
      if (field === "n") return pyStr(value);
      throw new Error("unsupported format field in pack text: " + m);
    });
  }

  function unhashable(v) {
    if (Array.isArray(v)) return "list";
    if (v !== null && typeof v === "object") return "dict";
    return null;
  }

  function deepFreeze(o) {
    if (o !== null && typeof o === "object" && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const k of Object.keys(o)) deepFreeze(o[k]);
    }
    return o;
  }

  // ------------------------------------------------------------------ rules

  class Facts {
    constructor(age, values) {
      this.age = age; // [lo, hi]
      this.values = values; // Map fact -> truth value
    }
    get(fact) {
      const v = this.values.get(fact);
      return v === undefined ? U : v;
    }
    withValues(changes) { // changes: [[fact, truth], ...]
      const values = new Map(this.values);
      for (const c of changes) values.set(c[0], c[1]);
      return new Facts(this.age, values);
    }
    withAge(age) {
      return new Facts(age, this.values);
    }
  }

  function ageTruth(cond, age) {
    const lo = cond[0], hi = cond[1] === null ? AGE_MAX : cond[1];
    if (lo <= age[0] && age[1] <= hi) return T;
    if (age[1] < lo || age[0] > hi) return F;
    return U; // an age range that straddles the limit
  }

  // Truth value of a rule node. Nodes carrying `say` go onto `trail` as [say, value], children
  // first, so a result can explain itself. Like engine.py, a "not" does not pass the trail down.
  function evaluate(node, facts, trail) {
    let value;
    if (has(node, "all")) {
      value = T;
      for (const n of node.all) {
        const v = evaluate(n, facts, trail);
        if (v < value) value = v;
      }
    } else if (has(node, "any")) {
      value = F;
      for (const n of node.any) {
        const v = evaluate(n, facts, trail);
        if (v > value) value = v;
      }
    } else if (has(node, "not")) {
      value = NOT[evaluate(node.not, facts, null)];
    } else if (has(node, "fact")) {
      value = facts.get(node.fact);
    } else if (has(node, "age")) {
      value = ageTruth(node.age, facts.age);
    } else {
      throw new Error("unknown rule node: " + pyRepr(Object.keys(node).sort(cmpCodePoints)));
    }
    if (trail && has(node, "say")) trail.push([node.say, value]);
    return value;
  }

  function walk(node, out) {
    out.push(node);
    for (const key of ["all", "any"]) {
      if (has(node, key)) for (const child of node[key]) walk(child, out);
    }
    if (has(node, "not")) walk(node.not, out);
    return out;
  }

  const codes = (sets) => Object.keys(sets).map((fact) => [fact, CODE[sets[fact]]]);

  // ------------------------------------------------------------------ pack checks

  function validate(d, questions, byId, schemes) {
    const facts = new Set(Object.keys(d.facts)), sources = new Set(Object.keys(d.sources));
    const problems = [];
    if (byId.size !== questions.length) problems.push("duplicate question ids");
    if (new Set(schemes.map((s) => s.id)).size !== schemes.length) problems.push("duplicate scheme ids");
    for (const q of questions) {
      if (["age", "single", "multi"].indexOf(q.kind) < 0) problems.push(`${pyStr(q.id)}: unknown kind ${pyStr(q.kind)}`);
      for (const o of has(q, "options") ? q.options : []) {
        const sets = has(o, "sets") ? o.sets : {};
        const used = new Set(Object.keys(sets));
        if (has(o, "fact")) used.add(o.fact);
        for (const f of used) {
          if (!facts.has(f)) problems.push(`${pyStr(q.id)}.${pyStr(o.id)}: undeclared fact '${pyStr(f)}'`);
        }
        for (const k of Object.keys(sets)) {
          const v = sets[k];
          if (!(typeof v === "string" && has(CODE, v))) problems.push(`${pyStr(q.id)}.${pyStr(o.id)}: bad truth value '${pyStr(v)}'`);
        }
      }
    }
    for (const s of schemes) {
      for (const node of walk(s.rule, [])) {
        if (has(node, "fact") && !facts.has(node.fact)) problems.push(`${pyStr(s.id)}: undeclared fact '${pyStr(node.fact)}'`);
      }
      for (const x of s.sources) if (!sources.has(x)) problems.push(`${pyStr(s.id)}: unknown source '${pyStr(x)}'`);
      for (const key of ["name", "what", "benefit", "documents", "where", "counter"]) {
        if (!pyTruthy(has(s, key) ? s[key] : null)) problems.push(`${pyStr(s.id)}: missing ${key}`);
      }
    }
    if (!byId.has("age")) problems.push("no age question");
    if (problems.length) throw new Error("schemes pack: " + problems.join("; "));
  }

  // ------------------------------------------------------------------ the navigator

  function create(packInput) {
    // Our own frozen copy: the caller's object can change or go away without touching the rules.
    const d = deepFreeze(typeof packInput === "string" ? JSON.parse(packInput) : jsonCopy(packInput));
    for (const key of ["pack", "version", "date"]) {
      if (!has(d, key)) throw new Error(`schemes pack: missing '${key}'`);
    }
    const questions = d.questions;
    const byId = new Map(questions.map((q) => [q.id, q]));
    const schemes = d.schemes;
    const schemeIds = new Set(schemes.map((s) => s.id));
    const maxQuestions = Math.trunc(Number(has(d, "max_questions") ? d.max_questions : 8));
    validate(d, questions, byId, schemes);
    const actionable = has(d, "actionable") ? Object.keys(d.actionable).map((f) => [f, d.actionable[f]]) : [];

    // Ages where some rule changes its answer: enough to test whether age still matters.
    const edges = new Set([AGE_MIN, AGE_MAX]);
    for (const s of schemes) {
      for (const node of walk(s.rule, [])) {
        if (has(node, "age")) {
          const lo = node.age[0], hi = node.age[1];
          edges.add(lo);
          if (hi !== null && hi < AGE_MAX) edges.add(hi + 1);
        }
      }
    }
    const ageProbes = Array.from(edges).sort((a, b) => a - b).map((a) => [a, a]);

    const packInfo = () => ({ name: d.pack, version: d.version, date: d.date });
    const notes = () => ({ amount: d.amount_note, fraud: d.fraud_note, decision: d.decision_note });

    // ---- answers -> facts

    // What the node would receive: the answers after a trip through JSON, in key order.
    function readAnswers(answers) {
      if (answers === undefined) answers = {};
      if (!isPlainObject(answers)) throw new TypeError("answers must be an object of question id -> answer");
      const wire = jsonCopy(answers);
      const entries = Object.keys(wire).map((k) => [k, wire[k]]);
      return { entries: entries, map: new Map(entries) };
    }

    function readAlready(already) {
      if (already === undefined) return [];
      if (already === null || typeof already === "string" || typeof already[Symbol.iterator] !== "function") {
        throw new TypeError("already must be a list of scheme ids");
      }
      const list = Array.from(already);
      for (const x of list) if (typeof x !== "string") throw new TypeError("already must be a list of scheme ids");
      return list;
    }

    function factsOf(ans) {
      if (ans.entries.length > questions.length) throw new AnswerError("too many answers");
      let age = [AGE_MIN, AGE_MAX];
      const values = new Map();
      for (const entry of ans.entries) {
        const qid = entry[0], a = entry[1];
        const q = byId.get(qid);
        if (q === undefined) throw new AnswerError(`unknown question '${qid}'`);
        if (q.kind === "age") {
          age = ageOf(q, a);
        } else if (q.kind === "single") {
          for (const c of codes(option(q, a).sets)) values.set(c[0], c[1]);
        } else { // multi: chosen options are T, the rest F
          const chosen = chosenOf(q, a);
          for (const o of q.options) values.set(o.fact, chosen.has(o.id) ? T : F);
        }
      }
      return new Facts(age, values);
    }

    function ageOf(q, a) {
      if (typeof a === "boolean") throw new AnswerError("age must be a whole number or an age band");
      if (isInt(a)) {
        if (!(AGE_MIN <= a && a <= AGE_MAX)) throw new AnswerError(`age must be ${AGE_MIN}-${AGE_MAX}`);
        return [a, a];
      }
      for (const band of q.bands) {
        if (pyEq(band.id, a)) return [band.range[0], band.range[1]];
      }
      throw new AnswerError(`unknown age band '${pyStr(a)}'`);
    }

    function option(q, a) {
      for (const o of q.options) if (pyEq(o.id, a)) return o;
      throw new AnswerError(`'${pyStr(a)}' is not an answer to '${pyStr(q.id)}'`);
    }

    function chosenOf(q, a) {
      if (!Array.isArray(a)) throw new AnswerError(`'${pyStr(q.id)}' takes a list of options`);
      const ids = q.options.map((o) => o.id);
      const bad = [];
      for (const x of a) {
        const kind = unhashable(x); // Python tests membership in a set: a list or dict cannot be hashed
        if (kind) throw new TypeError(`unhashable type: '${kind}'`);
        if (!ids.some((id) => pyEq(id, x))) bad.push(x);
      }
      if (bad.length) throw new AnswerError(`${pyRepr(bad)} are not answers to '${pyStr(q.id)}'`);
      return new Set(a);
    }

    // ---- evaluation

    function unlockOf(scheme, facts) {
      for (const entry of actionable) {
        const fact = entry[0], spec = entry[1];
        if (facts.get(fact) === F && evaluate(scheme.rule, facts.withValues([[fact, CODE[spec.to]]]), null) > F) {
          return { fact: fact, hint: spec.hint };
        }
      }
      return null;
    }

    // What the person would see for every scheme (its truth value and, for a "no", whether a bank
    // account would change it), as one string so the interview can compare outcomes cheaply.
    function outcomes(facts) {
      let key = "";
      for (const s of schemes) {
        const truth = evaluate(s.rule, facts, null);
        key += truth === F && unlockOf(s, facts) !== null ? "u" : NAME[truth];
      }
      return key;
    }

    // ---- interview

    function shownOptions(q, facts) {
      if (q.kind === "age") {
        const seen = new Set();
        for (const probe of ageProbes) {
          seen.add(outcomes(facts.withAge(probe)));
          if (seen.size > 1) return q.bands;
        }
        return null;
      }
      if (q.kind === "single") {
        const seen = new Set();
        for (const o of q.options) {
          seen.add(outcomes(facts.withValues(codes(o.sets))));
          if (seen.size > 1) return q.options;
        }
        return null;
      }
      const shown = q.options.filter((o) =>
        outcomes(facts.withValues([[o.fact, T]])) !== outcomes(facts.withValues([[o.fact, F]])));
      return shown.length ? shown : null;
    }

    function nextQuestion(ans) {
      const facts = factsOf(ans);
      if (ans.entries.length >= maxQuestions) return null;
      for (const q of questions) {
        if (ans.map.has(q.id)) continue;
        const shown = shownOptions(q, facts);
        if (shown === null) continue;
        const out = {
          id: q.id, kind: q.kind, short: q.short, text: q.text, help: has(q, "help") ? q.help : null,
          number: ans.entries.length + 1, max_questions: maxQuestions,
        };
        if (q.kind === "age") out.bands = shown.map((b) => ({ id: b.id, label: b.label }));
        else out.options = shown.map((o) => ({ id: o.id, label: o.label }));
        if (q.kind === "multi") out.none = q.none;
        return out;
      }
      return null;
    }

    // ---- result

    function benefitNow(s, facts) {
      for (const variant of has(s, "benefit_now") ? s.benefit_now : []) {
        if (!pyTruthy(variant.when) || evaluate(variant.when, facts, null) === T) return { hi: variant.hi, en: variant.en };
      }
      return null;
    }

    function agePhrase(ans, lang) {
      const age = ans.map.has("age") ? ans.map.get("age") : null;
      if (isInt(age)) return formatN(d.age_phrase.exact[lang], age);
      for (const band of byId.get("age").bands) {
        if (pyEq(band.id, age)) return band.phrase[lang];
      }
      return "";
    }

    const fill = (text, ans, lang) => collapseSpace(text.split("{age_phrase}").join(agePhrase(ans, lang)));

    function card(s, facts, ans, have) {
      const trail = [];
      const truth = evaluate(s.rule, facts, trail);
      let status = STATUS[truth];
      const unlock = truth === F ? unlockOf(s, facts) : null;
      if (unlock) status = "unlock";
      if (have) status = "have";
      let reasons = trail.map((t) => ({ text: t[0], truth: NAME[t[1]] }));
      if (truth === F && !unlock) reasons = reasons.filter((r) => r.truth === "F"); // say only what rules it out
      let counter = status === "check" && has(s.counter, "check") ? s.counter.check : null;
      if (!pyTruthy(counter)) counter = s.counter.default;
      const said = {};
      for (const lang of Object.keys(counter)) said[lang] = fill(counter[lang], ans, lang);
      const sources = d.sources;
      return {
        id: s.id, short: s.short, family: s.family, name: s.name,
        status: status, truth: NAME[truth],
        what: s.what, benefit: s.benefit, benefit_now: benefitNow(s, facts),
        reasons: reasons,
        documents: s.documents, where: s.where,
        counter: said,
        check_how: status === "check" && has(s, "check_how") ? s.check_how : null,
        notes: has(s, "notes") ? s.notes : [],
        unlock: unlock,
        sources: s.sources.map((sid) => Object.assign({ id: sid }, sources[sid])),
      };
    }

    // The answers in question order, in words (for the screen and the printed slip).
    function profile(ans) {
      const out = [];
      for (const q of questions) {
        if (!ans.map.has(q.id)) continue;
        const a = ans.map.get(q.id);
        let label, code;
        if (q.kind === "age") {
          if (isInt(a)) {
            label = { hi: `${pyStr(a)} ${YEARS_HI}`, en: `${pyStr(a)} years` };
            code = pyStr(a);
          } else {
            label = q.bands.find((b) => pyEq(b.id, a)).label;
            code = a;
          }
        } else if (q.kind === "single") {
          const o = option(q, a);
          label = o.label;
          code = o.id;
        } else {
          const chosen = q.options.filter((o) => a.some((x) => pyEq(o.id, x)));
          label = chosen.length
            ? { hi: chosen.map((o) => o.label.hi).join("; "), en: chosen.map((o) => o.label.en).join("; ") }
            : q.none;
          code = chosen.map((o) => o.id).join("+") || "none";
        }
        out.push({ id: q.id, short: q.short, answer: label, code: code });
      }
      return out;
    }

    // slip.py's slip_text: the printed slip, and the text its QR code holds.
    function slipText(r, date) {
      const lines = [`SAHAYAK SLIP | ${pyStr(r.pack.name)} pack ${pyStr(r.pack.version)} | ${date}`,
        r.profile.map((p) => `${pyStr(p.id)}=${pyStr(p.code)}`).join("; ")];
      const short = new Map(r.schemes.map((c) => [c.id, c.short]));
      for (const entry of SLIP_LABELS) {
        const ids = has(r.groups, entry[0]) ? r.groups[entry[0]] : [];
        if (ids.length) lines.push(`${entry[1]}: ` + ids.map((i) => short.get(i)).join(", "));
      }
      lines.push("No name stored. Guidance only; the office decides.");
      return lines.join("\n");
    }

    function isoDate(today) {
      if (today === undefined) today = new Date();
      if (typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today)) return today;
      if (Object.prototype.toString.call(today) !== "[object Date]" || Number.isNaN(today.getTime())) {
        throw new TypeError("today must be a Date or a 'YYYY-MM-DD' string");
      }
      // The local calendar date, as Python's date.today() gives on the node.
      return String(today.getFullYear()).padStart(4, "0") + "-" + String(today.getMonth() + 1).padStart(2, "0") +
        "-" + String(today.getDate()).padStart(2, "0");
    }

    // ---- the three endpoints

    function catalog() {
      return jsonCopy({
        pack: packInfo(),
        max_questions: maxQuestions,
        schemes: schemes.map((s) => ({ id: s.id, short: s.short, family: s.family, name: s.name, what: s.what })),
        demos: has(d, "demos") ? d.demos : [],
        notes: notes(),
      });
    }

    function next(answers) {
      const ans = readAnswers(answers);
      const question = nextQuestion(ans);
      return jsonCopy({ done: question === null, question: question, asked: ans.entries.length, max_questions: maxQuestions });
    }

    function result(answers, already, today) {
      const t0 = now();
      const ans = readAnswers(answers);
      const have = readAlready(already);
      const date = isoDate(today);
      const facts = factsOf(ans);
      const haveSet = new Set(have);
      const unknown = Array.from(haveSet).filter((id) => !schemeIds.has(id));
      if (unknown.length) throw new AnswerError(`unknown schemes ${pyRepr(unknown.sort(cmpCodePoints))}`);
      const cards = schemes.map((s) => card(s, facts, ans, haveSet.has(s.id)));
      const groups = {};
      for (const g of GROUPS) groups[g] = cards.filter((c) => c.status === g).map((c) => c.id);
      const out = {
        pack: packInfo(),
        asked: ans.entries.length,
        max_questions: maxQuestions,
        profile: profile(ans),
        schemes: cards,
        groups: groups,
        notes: notes(),
        timing_ms: 0,
      };
      out.timing_ms = Math.round((now() - t0) * 100) / 100;
      out.slip = { text: slipText(out, date), qr: null, date: date };
      // A fresh copy, as the node's JSON would be: the caller may change it without touching the pack.
      return jsonCopy(out);
    }

    return {
      catalog: catalog,
      next: next,
      result: result,
      // The raw engine call behind next(), for tools and tests: the question, or null when done.
      nextQuestion: (answers) => jsonCopy(nextQuestion(readAnswers(answers))),
      maxQuestions: maxQuestions,
      AnswerError: AnswerError,
    };
  }

  return { create: create, AnswerError: AnswerError, version: "1" };
});
