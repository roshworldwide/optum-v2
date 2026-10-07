/* Sahayak phone app. Talks only to the node it was served from (CSP enforces this).
   All message and model text is inserted with textContent, never as HTML. */
(() => {
  "use strict";

  const T = {
    hi: {
      node_pill: "बिना इंटरनेट", node_pill_phone: "फ़ोन पर · बिना इंटरनेट",
      foot_phone: "सहायक इसी फ़ोन पर चल रहा है। आप जो लिखते हैं, वह फ़ोन से बाहर नहीं जाता।",
      phone_mode_note: "अभी नोड से नहीं जुड़े: जाँच इसी फ़ोन पर होती है और कुछ भी बाहर नहीं जाता। बोलकर पूछने और एजेंट से मदद के लिए CSC के Wi-Fi पर आएँ।",
      checked_phone: "इस फ़ोन पर जाँच", pack_old: "जाँच के नियम {days} दिन पुराने हैं; CSC पर फ़ोन अपडेट कराएँ", qr_no_detector: "यह फ़ोन नोड के बिना QR नहीं पढ़ सकता। CSC पर आकर जाँचें, या QR के साथ आया मैसेज लिखकर जाँचें।",
      home_title: "नमस्ते! मैं सहायक हूँ।",
      home_sub: "मेरी मदद से आप मैसेज में ठगी की जाँच कर सकते हैं और जान सकते हैं कि आपका हक क्या है, बिना इंटरनेट के।",
      tile_check: "मैसेज जाँचें", tile_check_sub: "क्या यह ठगी है?",
      tile_benefits: "मेरा हक क्या है?", tile_benefits_sub: "पेंशन, बीमा, योजनाएँ",
      tile_help: "मदद अभी: 1930", tile_help_sub: "पैसे गए? तुरंत कॉल करें",
      check_title: "मैसेज जाँचें", check_label: "मैसेज यहाँ चिपकाएँ या लिखें",
      sender_add: "भेजने वाले का नाम या नंबर जोड़ें", sender_label: "भेजने वाला या कॉल करने वाला",
      itype_sms: "SMS / मैसेज", itype_call: "फ़ोन कॉल",
      check_btn: "जाँचें", checking: "जाँच हो रही है…", try_examples: "या एक उदाहरण आज़माएँ:",
      in_simple_words: "आसान शब्दों में", explaining: "सहायक समझा रहा है…",
      why: "क्यों?", what_to_do: "अब क्या करें?",
      call_1930: "पैसे गए? 1930 पर कॉल करें", speak_btn: "सुनें", complaint_btn: "शिकायत का ड्राफ़्ट", check_another: "दूसरा मैसेज जाँचें",
      safety_ok: "यह जवाब कैसे जाँचा गया", safety_checks: "ये जाँचें हुईं:",
      complaint_title: "1930 शिकायत का ड्राफ़्ट",
      complaint_note: "यह ड्राफ़्ट इसी फ़ोन पर रहता है। 1930 पर कॉल करते समय या cybercrime.gov.in पर शिकायत करते समय इसका इस्तेमाल करें।",
      c_when: "कब हुआ", c_channel: "कैसे आया (SMS, कॉल, WhatsApp)", c_number: "ठग का नंबर", c_upi: "UPI ID (अगर हो)",
      c_link: "लिंक (अगर हो)", c_lost: "कितने पैसे गए (₹)", c_txn: "ट्रांज़ैक्शन ID (अगर हो)", c_message: "मैसेज",
      print_btn: "प्रिंट करें", back: "वापस",
      foot: "सहायक इसी नोड पर चलता है। आप जो लिखते हैं, वह इंटरनेट पर नहीं जाता।",
      err_empty: "पहले मैसेज चिपकाएँ या लिखें।", err_network: "नोड से नहीं जुड़ पाए। Wi-Fi जाँचें।",
      no_voice: "इस फ़ोन में आवाज़ नहीं मिली।",
      checked_in: "इस नोड पर जाँच", ms: "मि.से.", pack: "पैक", model_text: "मॉडल", template_text: "जाँचे-परखे वाक्य",
      channel_sms: "SMS", channel_call: "फ़ोन कॉल",
      real_benefits: "असली योजनाएँ यहाँ सुरक्षित जाँचें: मेरा हक क्या है?",
      mode_text: "मैसेज", mode_call: "फ़ोन कॉल", mode_qr: "QR कोड", mode_ocr: "स्क्रीनशॉट",
      call_label: "कॉल पर क्या कहा गया? बोलकर या लिखकर बताएँ",
      qr_label: "जिस QR को स्कैन करने को कहा गया, उसकी फ़ोटो लें", qr_btn: "QR की फ़ोटो लें या चुनें",
      qr_reading: "QR पढ़ रहा हूँ…", qr_none: "फ़ोटो में QR नहीं मिला। पास से, सीधी फ़ोटो लें।", qr_try: "उदाहरण QR:",
      qr_pays: "पैसे किसको जाएँगे", qr_upi: "UPI ID", qr_amount: "रकम",
      ocr_label: "मैसेज का स्क्रीनशॉट या फ़ोटो चुनें", ocr_btn: "स्क्रीनशॉट चुनें",
      ocr_reading: "स्क्रीनशॉट पढ़ रहा हूँ… (कुछ सेकंड)", ocr_none: "स्क्रीनशॉट में कुछ लिखा हुआ नहीं मिला।", ocr_off: "इस नोड पर स्क्रीनशॉट पढ़ना चालू नहीं है। मैसेज लिखकर या बोलकर जाँचें।",
      ocr_review: "स्क्रीनशॉट से यह पढ़ा गया। गलती हो तो ठीक करें, फिर जाँचें।",
      ask_agent: "एजेंट से पूछें (काउंटर पर)", ticket_title: "आपका नंबर", ticket_sub: "काउंटर पर एजेंट आपका नंबर बुलाएँगे। तब तक यह स्क्रीन खुली रखें।",
      ticket_ok: "ठीक है", agent_offline: "अभी कोई एजेंट नहीं जुड़ा। काउंटर पर जाकर पूछें।",
      voice_settings: "आवाज़ की सेटिंग", voice_female: "महिला आवाज़", voice_male: "पुरुष आवाज़",
      speed_normal: "सामान्य गति", speed_slow: "धीमी गति", sound_on: "स्क्रीन पढ़कर सुनाना चालू", sound_off: "स्क्रीन पढ़कर सुनाना बंद",
      voice_ready: "आवाज़ इसी नोड पर चलती है: सुनना और बोलना, बिना इंटरनेट।",
      voice_phone: "नोड की आवाज़ नहीं मिली; फ़ोन की अपनी आवाज़ इस्तेमाल हो रही है।",
      mic_dictate: "बोलकर लिखें (दबाकर रखें)", mic_answer: "बोलकर जवाब दें (दबाकर रखें)",
      mic_dictate_upload: "फ़ोन के रिकॉर्डर से बोलकर लिखें", mic_answer_upload: "फ़ोन के रिकॉर्डर से बोलकर जवाब दें",
      mic_listening: "सुन रहा हूँ… बोलकर छोड़ें", mic_thinking: "समझ रहा हूँ…",
      mic_short: "बटन दबाकर रखें, बोलें, फिर छोड़ें।", mic_none: "कुछ सुनाई नहीं दिया। फिर से बोलें।",
      mic_secure: "यहाँ बोलने के लिए फ़ोन का रिकॉर्डर खुलेगा; दबाकर बोलने के लिए नोड का सुरक्षित (https) पता खोलें।", mic_denied: "माइक की अनुमति नहीं मिली।",
      heard: "मैंने सुना", heard_as: "जवाब", is_right: "क्या यह सही है?", yes_right: "हाँ, सही है", say_again: "नहीं, फिर से",
      not_understood: "समझ नहीं आया। फिर से बोलें, या नीचे से चुनें।", check_low_conf: "देख लें कि मैसेज ठीक लिखा गया है।",
      years_word: "साल",
      nav_intro: "कुछ छोटे सवालों के जवाब दें। फिर पता चलेगा कि 12 सरकारी योजनाओं में से आपको क्या मिल सकता है, कहाँ जाना है और कौन-से कागज़ ले जाने हैं।",
      nav_promise_1: "ज़्यादा से ज़्यादा 8 सवाल",
      nav_promise_2: "आपका नाम नहीं पूछा जाएगा",
      nav_promise_3: "जवाब इंटरनेट पर नहीं जाते, नोड कुछ सेव नहीं करता",
      nav_start: "शुरू करें", nav_try: "या एक उदाहरण देखें:", nav_covers: "योजनाएँ:",
      q_count: "सवाल {n} · ज़्यादा से ज़्यादा {max}", next: "आगे",
      age_label: "उम्र (साल)", age_unsure: "ठीक उम्र नहीं पता? यहाँ से चुनें:", age_err: "0 से 120 के बीच उम्र लिखें।",
      g_eligible: "आपको मिल सकता है", g_likely: "शायद मिल सकता है — सबूत साथ ले जाएँ", g_check: "दफ़्तर में पूछें",
      g_unlock: "बैंक खाता खुलने के बाद", g_have: "पहले से मिल रहा है", g_not_eligible: "आपके लिए नहीं",
      st_eligible: "मिल सकता है", st_likely: "शायद — सबूत लगेगा", st_check: "पूछें", st_unlock: "खाता खुलने के बाद",
      st_have: "पहले से मिल रहा है", st_not_eligible: "नहीं",
      nav_summary: "{total} योजनाओं में से {n} आपके काम की", nav_summary_none: "इन योजनाओं में से अभी कोई आप पर लागू नहीं दिखती।",
      details: "कागज़, जगह और कारण", why_label: "क्यों", benefit_label: "क्या मिलता है", docs_label: "कौन-से कागज़ ले जाएँ",
      where_label: "कहाँ जाएँ", say_label: "काउंटर पर ऐसे कहें", how_label: "कैसे पता करें", source_label: "स्रोत", checked_label: "जाँचा",
      have_label: "मुझे यह पहले से मिल रहा है",
      health_title: "पहले सेहत: मुफ़्त इलाज", nav_slip: "पर्ची बनाएँ (CSC के लिए)", nav_change: "पिछला जवाब बदलें", nav_restart: "फिर से शुरू करें",
      questions_asked: "सवाल",
      slip_title: "सहायक — योजना पर्ची", slip_answers: "जवाब", slip_schemes: "योजनाएँ", slip_date: "तारीख",
      slip_no_name: "नाम नहीं रखा गया", slip_qr: "QR कोड, जिसमें ये जवाब हैं",
      slip_operator: "CSC ऑपरेटर: QR में यही जवाब हैं, दोबारा पूछने की ज़रूरत नहीं।",
    },
    en: {
      node_pill: "Offline", node_pill_phone: "On phone · offline",
      foot_phone: "Sahayak is running on this phone. Nothing you type leaves it.",
      phone_mode_note: "Not connected to the node: checks run on this phone and nothing leaves it. For voice and help from the agent, come to the CSC's Wi-Fi.",
      checked_phone: "Checked on this phone in", pack_old: "scam patterns are {days} days old; update this phone at the CSC", qr_no_detector: "This phone cannot read QR codes without the node. Check it at the CSC, or type the message that came with the QR.",
      home_title: "Namaste! I am Sahayak.",
      home_sub: "I can check a message for fraud and tell you what you are owed, without internet.",
      tile_check: "Check a message", tile_check_sub: "Is it a scam?",
      tile_benefits: "What am I owed?", tile_benefits_sub: "Pensions, insurance, schemes",
      tile_help: "Help now: 1930", tile_help_sub: "Lost money? Call right away",
      check_title: "Check a message", check_label: "Paste or type the message here",
      sender_add: "Add the sender's name or number", sender_label: "Sender or caller",
      itype_sms: "SMS / message", itype_call: "Phone call",
      check_btn: "Check", checking: "Checking…", try_examples: "Or try an example:",
      in_simple_words: "In simple words", explaining: "Sahayak is explaining…",
      why: "Why?", what_to_do: "What to do now",
      call_1930: "Lost money? Call 1930", speak_btn: "Listen", complaint_btn: "Complaint draft", check_another: "Check another",
      safety_ok: "How this answer was checked", safety_checks: "Checks that ran:",
      complaint_title: "1930 complaint draft",
      complaint_note: "This draft stays on this device. Use it when you call 1930 or file at cybercrime.gov.in.",
      c_when: "When did it happen", c_channel: "How it came (SMS, call, WhatsApp)", c_number: "Fraudster's number",
      c_upi: "UPI ID (if any)", c_link: "Link (if any)", c_lost: "Money lost (₹)", c_txn: "Transaction ID (if any)", c_message: "Message",
      print_btn: "Print", back: "Back",
      foot: "Sahayak runs on this node. Nothing you type goes to the internet.",
      err_empty: "Paste or type a message first.", err_network: "Could not reach the node. Check the Wi-Fi.",
      no_voice: "No voice found on this phone.",
      checked_in: "Checked on this node in", ms: "ms", pack: "pack", model_text: "model", template_text: "vetted sentences",
      channel_sms: "SMS", channel_call: "Phone call",
      real_benefits: "Check the real schemes safely here: What am I owed?",
      mode_text: "Message", mode_call: "Phone call", mode_qr: "QR code", mode_ocr: "Screenshot",
      call_label: "What did the caller say? Speak or type it",
      qr_label: "Take a photo of the QR you were asked to scan", qr_btn: "Take or choose a photo of the QR",
      qr_reading: "Reading the QR…", qr_none: "No QR code found. Take a closer, straight photo.", qr_try: "Example QR codes:",
      qr_pays: "Money goes to", qr_upi: "UPI ID", qr_amount: "Amount",
      ocr_label: "Choose a screenshot or photo of the message", ocr_btn: "Choose a screenshot",
      ocr_reading: "Reading the screenshot… (a few seconds)", ocr_none: "No text found in the screenshot.", ocr_off: "Screenshot reading is not set up on this node. Type or say the message instead.",
      ocr_review: "This is what I read from the screenshot. Fix any mistakes, then check.",
      ask_agent: "Ask the agent (at the counter)", ticket_title: "Your number", ticket_sub: "The agent at the counter will call your number. Keep this screen open until then.",
      ticket_ok: "OK", agent_offline: "No agent is connected right now. Please ask at the counter.",
      voice_settings: "Voice settings", voice_female: "Female voice", voice_male: "Male voice",
      speed_normal: "Normal speed", speed_slow: "Slower", sound_on: "Reading screens aloud: on", sound_off: "Reading screens aloud: off",
      voice_ready: "Voice runs on this node: listening and speaking, without internet.",
      voice_phone: "No voice on the node; using the phone's own voice.",
      mic_dictate: "Speak the message (hold)", mic_answer: "Answer by speaking (hold)",
      mic_dictate_upload: "Speak the message with the phone's recorder", mic_answer_upload: "Answer with the phone's recorder",
      mic_listening: "Listening… let go when done", mic_thinking: "Working it out…",
      mic_short: "Hold the button, speak, then let go.", mic_none: "I didn't catch anything. Please try again.",
      mic_secure: "Here, speaking opens the phone's recorder; for hold-to-talk, open the node's secure (https) address.", mic_denied: "Microphone permission was not given.",
      heard: "I heard", heard_as: "Answer", is_right: "Is that right?", yes_right: "Yes, that's right", say_again: "No, again",
      not_understood: "I could not match that. Say it again, or pick below.", check_low_conf: "Check that the message was written down correctly.",
      years_word: "years",
      nav_intro: "Answer a few short questions and I will tell you which of 12 government schemes you can get, where to go and which papers to take.",
      nav_promise_1: "At most 8 questions",
      nav_promise_2: "I will not ask your name",
      nav_promise_3: "Answers never go to the internet; the node saves nothing",
      nav_start: "Start", nav_try: "Or see an example:", nav_covers: "Schemes:",
      q_count: "Question {n} · at most {max}", next: "Next",
      age_label: "Age (years)", age_unsure: "Not sure of your exact age? Pick a range:", age_err: "Enter an age between 0 and 120.",
      g_eligible: "You can get", g_likely: "Likely — take proof", g_check: "Ask at the office",
      g_unlock: "After you open a bank account", g_have: "Already getting", g_not_eligible: "Not for you",
      st_eligible: "You can get", st_likely: "Likely — needs proof", st_check: "Ask", st_unlock: "After an account",
      st_have: "Already getting", st_not_eligible: "No",
      nav_summary: "{n} of {total} schemes are worth a visit", nav_summary_none: "None of these schemes seems to apply right now.",
      details: "Papers, place and reasons", why_label: "Why", benefit_label: "What you get", docs_label: "Papers to take",
      where_label: "Where to go", say_label: "Say this at the counter", how_label: "How to check", source_label: "Source", checked_label: "checked",
      have_label: "I already get this",
      health_title: "Health first: free treatment", nav_slip: "Make a slip (for the CSC)", nav_change: "Change last answer", nav_restart: "Start again",
      questions_asked: "questions",
      slip_title: "Sahayak scheme slip", slip_answers: "Answers", slip_schemes: "Schemes", slip_date: "Date",
      slip_no_name: "No name kept", slip_qr: "QR code holding these answers",
      slip_operator: "CSC operator: the QR holds these answers, so there is no need to ask again.",
    },
  };

  const ICONS = {
    scam: '<svg viewBox="0 0 52 52" aria-hidden="true"><path d="M26 3 6 10v14c0 13 9 22 20 26 11-4 20-13 20-26V10L26 3Z" fill="currentColor" opacity=".15" stroke="currentColor" stroke-width="2.5"/><path d="M19 19l14 14M33 19 19 33" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>',
    suspicious: '<svg viewBox="0 0 52 52" aria-hidden="true"><path d="M26 5 3 46h46L26 5Z" fill="currentColor" opacity=".15" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M26 20v13" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="26" cy="39" r="2.6" fill="currentColor"/></svg>',
    no_signs: '<svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="22" fill="currentColor" opacity=".15" stroke="currentColor" stroke-width="2.5"/><path d="M16 26.5l7 7 13-14" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    unreadable: '<svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="22" fill="currentColor" opacity=".12" stroke="currentColor" stroke-width="2.5"/><path d="M20 20.5a6 6 0 1 1 8.6 5.4c-1.7.8-2.6 2-2.6 3.8V31" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="26" cy="37.5" r="2.6" fill="currentColor"/></svg>',
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const state = { lang: loadLang(), check: null, message: "", explanation: null, health: null, nodeless: false };

  function loadLang() {
    try { return localStorage.getItem("sahayak.lang") || "hi"; } catch { return "hi"; }
  }
  function saveLang(lang) {
    try { localStorage.setItem("sahayak.lang", lang); } catch { /* private mode */ }
  }
  const other = (lang) => (lang === "hi" ? "en" : "hi");
  const t = (key) => T[state.lang][key] ?? T.en[key] ?? key;

  function applyI18n() {
    document.documentElement.lang = state.lang;
    $$("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $("#lang-toggle").textContent = state.lang === "hi" ? "EN" : "हिं";
    if (state.check) renderResult(state.check);
    renderExamples();
    renderNavIntro();
    if (nav.question) renderQuestion();
    if (nav.result) { renderNavResult(); renderSlip(); }
    setupMessageMic();
    renderVoiceStatus();
    if (state.mode) setMode(state.mode);
    if (state.check) renderQRBox(state.check);
  }

  // ---------------------------------------------------------------- navigation
  function go(screen) {
    $$(".screen").forEach((s) => { s.hidden = s.dataset.screen !== screen; });
    window.scrollTo({ top: 0 });
    if (screen === "check") setTimeout(() => $("#msg").focus(), 50);
    if (voice.auto) speakScreen(screen);
  }

  // What each screen says when it opens (the scam verdict speaks itself in runCheck).
  function speakScreen(screen) {
    const say = {
      home: () => joinSpoken([t("home_title"), t("home_sub")]),
      check: () => joinSpoken([t("check_title"), t("check_label")]),
      benefits: () => joinSpoken([t("tile_benefits"), t("nav_intro")]),
      question: spokenQuestion,
      "benefits-result": spokenResult,
    }[screen];
    if (say) speak(say());
  }
  document.addEventListener("click", (e) => {
    const target = e.target.closest("[data-go]");
    if (target) { e.preventDefault(); go(target.dataset.go); }
  });

  // ---------------------------------------------------------------- toast
  let toastTimer;
  function toast(msg) {
    let el = $(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.append(el); }
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 3500);
  }
  function hideToast() {  // a "reading..." notice goes as soon as the answer is in
    clearTimeout(toastTimer);
    const el = $(".toast");
    if (el) el.remove();
  }

  // ---------------------------------------------------------------- the node, or this phone on its own
  // On the CSC's Wi-Fi every answer comes from the node. Away from it (at home, where the scam message
  // or call actually arrives) the scam check and the benefits interview run in this browser instead, from
  // the same packs the node verified and served, which the service worker keeps (web/checker.js,
  // web/navigator.js). Nothing leaves the phone either way. The stand-alone build has no node at all.
  // The stand-alone build marks its page with <meta name="sahayak-standalone"> (scripts/build_tryit.py).
  const STANDALONE = Boolean(document.querySelector('meta[name="sahayak-standalone"]'));
  const ROOT = STANDALONE ? "" : "/";  // static files: relative in the stand-alone build
  const local = { ready: null, checker: null, nav: null, demo: null, packs: [] };
  let nodeRetryAt = 0;  // after a failed call, go straight to the phone for a while instead of waiting again

  class NodeUnreachable extends Error {}

  function loadLocal() {
    if (!local.ready) {
      local.ready = (async () => {
        const get = async (name) => {
          const res = await fetch(`${ROOT}phone-packs/${name}.json`);
          if (!res.ok) throw new Error(`pack ${name}: HTTP ${res.status}`);
          return res.json();
        };
        const [fraud, patterns, model, schemes, demo] = await Promise.all(
          ["fraud", "scam_patterns", "fraud_model", "schemes", "demo"].map(get));
        local.checker = window.SahayakChecker.create({ fraud: fraud.data, patterns: patterns.data, model: model.data,
          fraudSha256: fraud.sha256 });
        local.nav = window.SahayakNavigator.create(schemes.data);
        local.demo = demo.data;
        local.packs = [fraud, patterns, model, schemes, demo].map(({ name, version, date, sha256, signed_by }) =>
          ({ name, version, date, sha256, signed_by }));
      })();
      local.ready.catch(() => { local.ready = null; });  // try again next time
    }
    return local.ready;
  }

  async function nodeApi(path, body) {
    if (STANDALONE || Date.now() < nodeRetryAt) throw new NodeUnreachable(path);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    let res;
    try {
      res = await fetch(path, {
        signal: ctl.signal,
        ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new NodeUnreachable(path);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    setNodeless(false);
    return res.json();
  }

  // What this phone can answer by itself, in the same shape as the node's API.
  const LOCAL_API = {
    "/api/check": (b) => ({ ...local.checker.check(b.text, { sender: b.sender, inputType: b.input_type }), where: "phone" }),
    "/api/examples": () => local.demo,
    "/api/navigator": () => local.nav.catalog(),
    "/api/navigator/next": (b) => local.nav.next(b.answers || {}),
    "/api/navigator/result": (b) => local.nav.result(b.answers || {}, b.already || []),
  };

  async function api(path, body) {
    try {
      return await nodeApi(path, body);
    } catch (e) {
      if (!(e instanceof NodeUnreachable) || !LOCAL_API[path]) throw e;
      setNodeless(true);
      await loadLocal();
      return LOCAL_API[path](body || {});
    }
  }

  // Without the node: no voice input (recognition runs on the node), no screenshot reading, no agent
  // queue; QR codes only where the browser can read them itself.
  function setNodeless(on) {
    if (STANDALONE) on = true;
    if (on) nodeRetryAt = Date.now() + 30000;
    if (state.nodeless === on) return;
    state.nodeless = on;
    if (on) {
      state.health = null;
      voice.nodeOk = false;  // the phone's own voice reads the screens
    } else {
      loadHealth();
    }
    renderNodeMode();
  }

  function renderNodeMode() {
    const off = Boolean(state.nodeless);
    for (const [sel, key] of [["#node-pill [data-i18n]", "node_pill"], [".foot [data-i18n]", "foot"]]) {
      const node = $(sel);
      node.dataset.i18n = off ? `${key}_phone` : key;  // applyI18n keeps it on a language switch
      node.textContent = t(node.dataset.i18n);
    }
    $("#phone-mode-note").hidden = !off;
    $('input[name="mode"][value="ocr"]').closest("label").hidden = off;
    $("#btn-agent-check").hidden = off;
    $("#btn-agent-nav").hidden = off;
    if (off && state.mode === "ocr") setMode("text");
    setupMessageMic();
    if (nav.question) renderQuestionMic();
    renderVoiceStatus();
  }

  // ---------------------------------------------------------------- four ways in
  // A typed or spoken message, a description of a call, a photo of a QR code, or a screenshot.
  state.mode = "text";
  function setMode(mode) {
    state.mode = mode;
    $$('input[name="mode"]').forEach((r) => { r.checked = r.value === mode; });
    const image = mode === "qr" || mode === "ocr";
    $("#mode-text").hidden = image;
    $("#mode-image").hidden = !image;
    $("#msg-label").textContent = t(mode === "call" ? "call_label" : "check_label");
    $("#ocr-review").hidden = mode !== "ocr" || !$("#msg").value;
    $("#image-label").textContent = t(mode === "qr" ? "qr_label" : "ocr_label");
    $("#image-btn-label").textContent = t(mode === "qr" ? "qr_btn" : "ocr_btn");
    const input = $("#image-input");
    if (mode === "qr") input.setAttribute("capture", "environment"); else input.removeAttribute("capture");
    $("#qr-try-label").hidden = mode !== "qr";
    $("#qr-examples").hidden = mode !== "qr";
  }
  $$('input[name="mode"]').forEach((r) => r.addEventListener("change", () => {
    if (r.value === "ocr" && state.mode !== "ocr") $("#msg").value = "";
    setMode(r.value);
  }));

  // Phone cameras make photos of 3 to 12 MB; the node reads QR codes and text at under 2,000 pixels
  // anyway, so a large photo is shrunk here first: a much quicker upload on a busy Wi-Fi.
  async function shrinkPhoto(blob, longest = 2000) {
    try {
      if (blob.size < 1500000 || !("createImageBitmap" in window)) return blob;
      const bmp = await createImageBitmap(blob);
      const scale = longest / Math.max(bmp.width, bmp.height);
      if (scale >= 1) { bmp.close(); return blob; }
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close();
      const out = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      return out || blob;
    } catch {
      return blob;  // the node shrinks it too, and refuses only what no camera makes
    }
  }

  async function postImage(path, blob) {
    if (STANDALONE || Date.now() < nodeRetryAt) throw new NodeUnreachable(path);
    const body = await shrinkPhoto(blob);
    let res;
    try {
      res = await fetch(path, { method: "POST", headers: { "Content-Type": body.type || "application/octet-stream" }, body });
    } catch {
      throw new NodeUnreachable(path);
    }
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return res.json();
  }

  // Without the node: the browser's own QR reader (Chrome on Android has one), then the same UPI
  // analysis and scam check as the node, on this phone. A demo card's payload needs no reader.
  async function qrOnPhone(blob, payload) {
    await loadLocal();
    let text = payload;
    if (!text) {
      if (!("BarcodeDetector" in window)) throw Object.assign(new Error("no QR reader"), { status: 501 });
      const codes = await new window.BarcodeDetector({ formats: ["qr_code"] }).detect(await createImageBitmap(blob));
      if (!codes.length) throw Object.assign(new Error("no QR code"), { status: 422 });
      text = codes[0].rawValue;
    }
    const { check_text: checkText, ...qr } = local.checker.analyseQR(text);
    return { ...local.checker.check(checkText, { inputType: "qr" }), qr, where: "phone" };
  }

  async function checkQR(blob, payload) {
    toast(t("qr_reading"));
    try {
      let card;
      try {
        if (!blob) throw new NodeUnreachable("qr");
        card = await postImage(`/api/qr?lang=${state.lang}`, blob);
      } catch (e) {
        if (!(e instanceof NodeUnreachable)) throw e;
        if (blob) setNodeless(true);
        card = await qrOnPhone(blob, payload);
      }
      hideToast();
      state.check = card; state.message = ""; state.explanation = null;
      renderResult(card);
      go("result");
      $("#headline").focus();
      if (voice.auto) speak(joinSpoken([card.label[state.lang], ...(card.qr.facts || []).map((f) => f[state.lang])]));
    } catch (e) {
      toast(t(e.status === 422 ? "qr_none" : e.status === 501 ? "qr_no_detector" : "err_network"));
    }
  }

  async function readScreenshot(blob) {
    toast(t("ocr_reading"));
    try {
      const out = await postImage("/api/ocr", blob);
      hideToast();
      if (!out.text) { toast(t("ocr_none")); return; }
      $("#msg").value = out.text;
      setMode("ocr");
      $("#mode-text").hidden = false;
      $("#mode-image").hidden = true;
      $("#ocr-review").hidden = false;
      $("#msg").focus();
      if (voice.auto) speak(t("ocr_review"));
    } catch (e) {
      toast(t(e.status === 422 ? "ocr_none" : e.status === 503 || e instanceof NodeUnreachable ? "ocr_off" : "err_network"));
    }
  }

  $("#image-input").addEventListener("change", () => {
    const file = $("#image-input").files && $("#image-input").files[0];
    $("#image-input").value = "";
    if (!file) return;
    if (state.mode === "qr") checkQR(file); else readScreenshot(file);
  });

  async function loadQRExamples() {
    let list = [];
    try { list = (await api("/api/examples")).qr_examples || []; } catch { list = []; }
    $("#qr-examples").replaceChildren(...list.map((ex) => el("button", { type: "button", class: "chip", onclick: async () => {
      if (state.nodeless) { checkQR(null, ex.payload); return; }
      const res = await fetch(`/api/demo/qr/${ex.id}`).catch(() => null);
      if (res && res.ok) checkQR(await res.blob()); else checkQR(null, ex.payload);
    } }, tr(ex.label))));
  }

  function renderQRBox(card) {
    const box = $("#qr-box");
    const q = card.qr;
    if (!q) { box.hidden = true; return; }
    const rows = [];
    if (q.kind === "upi") {
      if (q.name || q.payee) rows.push(el("div", {}, el("b", {}, `${t("qr_pays")}: `), q.name || q.payee));
      if (q.payee) rows.push(el("div", {}, el("b", {}, `${t("qr_upi")}: `), q.payee));
      if (q.amount_text) rows.push(el("div", { class: "qr-amount" }, el("b", {}, `${t("qr_amount")}: `), q.amount_text));
    }
    box.replaceChildren(...rows, ...(q.facts || []).map((f) => el("p", { class: "qr-fact" }, f[state.lang])));
    box.hidden = !rows.length && !(q.facts || []).length;
  }

  // ---------------------------------------------------------------- examples
  let examples = [];
  async function loadExamples() {
    try { examples = (await api("/api/examples")).examples || []; } catch { examples = []; }
    renderExamples();
  }
  function useExample(ex) {
    setMode(ex.input_type === "call" ? "call" : "text");
    $("#msg").value = ex.text;
    $("#sender").value = ex.sender || "";
    if (ex.sender) $("details.extra").open = true;
    return runCheck();
  }
  function renderExamples() {
    const root = $("#examples");
    root.replaceChildren(...examples.map((ex) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.textContent = ex.label[state.lang] || ex.label.en;
      b.addEventListener("click", () => useExample(ex));
      return b;
    }));
  }

  // ---------------------------------------------------------------- check
  async function runCheck() {
    const text = $("#msg").value.trim();
    if (!text) { toast(t("err_empty")); $("#msg").focus(); return; }
    const btn = $("#btn-check");
    btn.disabled = true; btn.textContent = t("checking");
    const sender = $("#sender").value.trim() || null;
    const input_type = state.mode === "call" ? "call" : state.mode === "ocr" ? "ocr" : "text";
    try {
      const card = await api("/api/check", { text, sender, input_type, lang: state.lang });
      state.check = card; state.message = text; state.explanation = null;
      renderResult(card);
      go("result");
      $("#headline").focus();
      if (voice.auto) speak(spokenSummary(card), state.lang);
      if (card.where !== "phone") explain(card.id);  // the vetted reasons already explain a phone check
    } catch {
      toast(t("err_network"));
    } finally {
      btn.disabled = false; btn.textContent = t("check_btn");
    }
  }
  $("#btn-check").addEventListener("click", runCheck);

  async function explain(id) {
    const box = $("#explain");
    box.classList.add("loading");
    $("#explain-text").textContent = t("explaining");
    try {
      const out = await api("/api/explain", { id });
      if (!state.check || state.check.id !== id) return; // user moved on
      state.explanation = out;
      if (out.card && out.card.verdict !== state.check.verdict) {  // model raised "no signs" to "suspicious"
        state.check = out.card;
        renderResult(out.card);
      } else {
        renderExplanation();
      }
    } catch {
      state.explanation = null;
      renderExplanation();
    }
  }

  // ---------------------------------------------------------------- result
  function bilingualItem(textByLang, extraClass) {
    const li = document.createElement("li");
    if (extraClass) li.className = extraClass;
    const main = document.createElement("span");
    main.textContent = textByLang[state.lang];
    const sub = document.createElement("span");
    sub.className = "en"; sub.lang = other(state.lang); sub.textContent = textByLang[other(state.lang)];
    li.append(main, sub);
    return li;
  }

  function renderResult(card) {
    const v = $("#verdict");
    v.className = `verdict ${card.verdict}`;
    v.innerHTML = ICONS[card.verdict];  // static, trusted SVG only
    const words = document.createElement("div");
    const l1 = document.createElement("div"); l1.className = "v-label"; l1.textContent = card.label[state.lang];
    const l2 = document.createElement("div"); l2.className = "v-label-2"; l2.textContent = card.label[other(state.lang)];
    words.append(l1, l2);
    v.append(words);

    $("#headline").textContent = card.headline[state.lang];
    renderQRBox(card);
    $("#reasons").replaceChildren(...card.reasons.map((r) => bilingualItem(r.text, r.hard ? "hard" : "")));
    $("#actions").replaceChildren(...card.actions[state.lang].map((a, i) =>
      bilingualItem({ [state.lang]: a, [other(state.lang)]: card.actions[other(state.lang)][i] })));
    // 1930 is for money already lost, and a complaint needs a message Sahayak could read and found signs in.
    const nothingFound = card.verdict === "no_signs" || card.verdict === "unreadable";
    $("#btn-1930").hidden = nothingFound;
    $("#btn-complaint").hidden = nothingFound;
    // A fake scheme message: offer the real thing, checked safely on this node.
    const schemeBait = card.signals.some((s) => s.id === "govt_scheme_bait")
      || ["govt_scheme", "govt_payment"].includes(card.category && card.category.id);
    $("#btn-real-benefits").hidden = !(schemeBait && card.verdict !== "no_signs");
    renderExplanation();
    renderMeta();
  }

  // The model writes only in languages it has been cleared for; elsewhere the reasons
  // below already say everything, so the "In simple words" box stays hidden.
  function modelWrote(out, lang) {
    return Boolean(out && out.source !== "template" && out.safety && out.safety.langs && out.safety.langs[lang]);
  }
  function modelExpected(lang) {
    if (state.nodeless || (state.check && state.check.where === "phone")) return false;
    const llm = state.health && state.health.llm;
    return Boolean(llm && llm.available && (state.health.llm_langs || []).includes(lang));
  }

  function renderExplanation() {
    const box = $("#explain");
    const out = state.explanation;
    const card = state.check;
    if (!card) return;
    if (!out) {
      $("#safety-badge").hidden = true;  // nothing to vouch for until an explanation arrives (never, for a QR card)
      $("#safety-detail").hidden = true;
      $("#safety-badge").setAttribute("aria-expanded", "false");
      box.hidden = !modelExpected(state.lang);
      box.classList.add("loading");
      $("#explain-text").textContent = t("explaining");
      return;
    }
    box.classList.remove("loading");
    box.hidden = !modelWrote(out, state.lang);
    $("#explain-text").textContent = out.explanation[state.lang];
    renderSafety(out);
    renderMeta();
  }

  function renderSafety(out) {
    const badge = $("#safety-badge");
    const detail = $("#safety-detail");
    badge.textContent = t("safety_ok");
    badge.hidden = false;
    const checks = (out.safety && out.safety.checks) || [];
    const lines = checks.filter((c) => c.lang === state.lang).map((c) => `${c.passed ? "✓" : "✗"} ${c.id.replace(/_/g, " ")}`);
    const src = out.source === "template" ? t("template_text") : `${t("model_text")}: ${out.model || ""}`;
    detail.replaceChildren();
    const p = document.createElement("div"); p.textContent = `${t("safety_checks")} (${src})`;
    const ul = document.createElement("ul");
    (lines.length ? lines : ["✓ vetted template"]).forEach((line) => { const li = document.createElement("li"); li.textContent = line; ul.append(li); });
    detail.append(p, ul);
  }
  $("#safety-badge").addEventListener("click", () => {
    const d = $("#safety-detail");
    d.hidden = !d.hidden;
    $("#safety-badge").setAttribute("aria-expanded", String(!d.hidden));
  });

  function renderMeta() {
    const card = state.check;
    if (!card) return;
    const parts = [`${t(card.where === "phone" ? "checked_phone" : "checked_in")} ${card.timing_ms.total} ${t("ms")}`,
      `${t("pack")} ${card.pack.version}`];
    // Away from the node the phone checks with the patterns it last fetched; say when they are getting old.
    const fraud = card.where === "phone" ? local.packs.find((p) => p.name === "fraud") : null;
    const days = fraud && fraud.date ? Math.floor((Date.now() - Date.parse(fraud.date)) / 86400000) : 0;
    if (days > 45) parts.push(fmt(t("pack_old"), { days }));
    const out = state.explanation;
    if (modelWrote(out, state.lang) && out.tokens_per_s) parts.push(`${out.model} · ${out.tokens_per_s} tok/s`);
    $("#meta").textContent = parts.join(" · ");
  }

  function spokenSummary(card) {
    const first = card.actions[state.lang][0] || "";
    return `${card.label[state.lang]}. ${card.headline[state.lang]} ${first}`;
  }

  // ---------------------------------------------------------------- voice: speech out
  // The node speaks with offline Hindi and English voices; the phone's own voice is the
  // fallback. Amounts, helplines and acronyms are turned into words on the node.
  function loadPref(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
  function savePref(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } }
  const voice = {
    auto: loadPref("sahayak.voice.auto", "1") === "1",
    gender: loadPref("sahayak.voice.gender", "female"),
    slow: loadPref("sahayak.voice.slow", "0") === "1",
    nodeOk: true,  // false once the node says it has no voice installed
    token: 0,
    audio: null,
  };

  function stopSpeaking() {
    voice.token += 1;
    if (voice.audio) { voice.audio.pause(); voice.audio = null; }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  function splitSentences(text) {
    return text.split(/(?<=[।.?!])\s+/).map((s) => s.trim()).filter(Boolean)
      .flatMap((s) => (s.length > 480 ? s.match(/[\s\S]{1,460}(\s|$)/g) : [s]));
  }

  // A node speaking for many phones at once can take seconds over a sentence it has not said before.
  // If the first sentence of a screen is not back in time, this phone reads the screen in its own voice.
  const FIRST_SENTENCE_MS = 4000;

  async function ttsBlob(text, lang, ms = 0) {
    const ctrl = "AbortController" in window ? new AbortController() : null;
    const timer = ms && ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
    try {
      const res = await fetch("/api/tts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang, voice: voice.gender, speed: voice.slow ? 0.75 : 0.9 }),
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (res.status === 503) voice.nodeOk = false;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.blob();
    } finally {
      clearTimeout(timer);
    }
  }

  function phoneVoice(lang) {
    if (!("speechSynthesis" in window)) return null;
    const want = lang === "hi" ? "hi" : "en";
    return window.speechSynthesis.getVoices().find((vo) => vo.lang && vo.lang.toLowerCase().startsWith(want)) || null;
  }

  function playBlob(blob, token) {
    return new Promise((resolve, reject) => {
      if (token !== voice.token) { resolve(); return; }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      voice.audio = audio;
      const finish = (err) => { URL.revokeObjectURL(url); if (err) reject(err); else resolve(); };
      audio.onended = () => finish();
      audio.onerror = () => finish(new Error("audio"));
      // Browsers refuse sound before the first tap; that is not an error worth a fallback.
      audio.play().catch((e) => (e && e.name === "NotAllowedError" ? finish() : finish(e)));
    });
  }

  function phoneSpeak(text, lang) {
    if (!("speechSynthesis" in window) || !text) return false;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === "hi" ? "hi-IN" : "en-IN";
    const v = phoneVoice(lang);
    if (v) u.voice = v;
    u.rate = voice.slow ? 0.75 : 0.92;
    synth.speak(u);
    return Boolean(v);
  }

  // Sentence by sentence: the next sentence is fetched while the current one plays, so the
  // first words come quickly even for a long screen. Returns false only if no voice exists.
  function speak(text, lang = state.lang) {
    stopSpeaking();
    if (!text) return false;
    if (!voice.nodeOk) return phoneSpeak(text, lang);
    const token = voice.token;
    const parts = splitSentences(text);
    // Only the first sentence has a deadline (later ones are fetched while the one before plays), and
    // only when the phone has a voice of its own for this language to take over with.
    const fetchPart = (i) => {
      const p = ttsBlob(parts[i], lang, i === 0 && phoneVoice(lang) ? FIRST_SENTENCE_MS : 0);
      p.catch(() => {});
      return p;
    };
    (async () => {
      let next = fetchPart(0);
      for (let i = 0; i < parts.length; i += 1) {
        let blob;
        try { blob = await next; } catch { if (token === voice.token) phoneSpeak(parts.slice(i).join(" "), lang); return; }
        if (token !== voice.token) return;
        if (i + 1 < parts.length) next = fetchPart(i + 1);
        try { await playBlob(blob, token); } catch { if (token === voice.token) phoneSpeak(parts.slice(i).join(" "), lang); return; }
        if (token !== voice.token) return;
      }
    })();
    return true;
  }

  function renderSoundToggle() {
    const b = $("#sound-toggle");
    b.setAttribute("aria-pressed", String(voice.auto));
    b.setAttribute("aria-label", t(voice.auto ? "sound_on" : "sound_off"));
    b.title = t(voice.auto ? "sound_on" : "sound_off");
  }
  $("#sound-toggle").addEventListener("click", () => {
    voice.auto = !voice.auto;
    savePref("sahayak.voice.auto", voice.auto ? "1" : "0");
    renderSoundToggle();
    if (voice.auto) speak(t("sound_on")); else stopSpeaking();
  });
  $$('input[name="vgender"]').forEach((r) => {
    r.checked = r.value === voice.gender;
    r.addEventListener("change", () => { voice.gender = r.value; savePref("sahayak.voice.gender", r.value); speak(t(`voice_${r.value}`)); });
  });
  $$('input[name="vspeed"]').forEach((r) => {
    r.checked = r.value === (voice.slow ? "slow" : "normal");
    r.addEventListener("change", () => { voice.slow = r.value === "slow"; savePref("sahayak.voice.slow", voice.slow ? "1" : "0"); speak(t(`speed_${r.value}`)); });
  });

  function renderVoiceStatus() {
    const h = state.health;
    const nodeVoice = Boolean(h && h.voice && h.voice.tts && (h.voice.tts[state.lang] || []).length);
    const lines = [t(nodeVoice ? "voice_ready" : "voice_phone")];
    if (!canListen) lines.push(t("mic_secure"));
    $("#voice-status").textContent = lines.join(" ");
    renderSoundToggle();
  }

  // ---------------------------------------------------------------- voice: speech in
  // Hold to talk. web/mic.js records 16 kHz mono audio and the node recognises it offline.
  // Browsers open the mic only on a secure origin: localhost on the node, or HTTPS (Phase 6).
  const Mic = window.SahayakMic || { canListen: false, start: async () => {}, stop: () => null };
  const canListen = Mic.canListen;
  let micBusy = false;
  const MIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M8.5 21h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  async function asr(wav, params) {
    const q = new URLSearchParams({ lang: state.lang, ...params });
    const res = await fetch(`/api/asr?${q}`, { method: "POST", headers: { "Content-Type": wav.type || "application/octet-stream" }, body: wav });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Where the browser will not open the mic (a plain-HTTP address), the phone's own recorder
  // app still can: the file it returns (m4a, amr, ogg…) goes to the same recognition on the node.
  function recorderButton(labelKey, onAudio) {
    const label = el("span", { class: "mic-label" }, t(`${labelKey}_upload`));
    const input = el("input", { type: "file", accept: "audio/*", capture: true, hidden: true });
    const btn = el("button", { type: "button", class: "mic upload" }, label, input);
    btn.insertAdjacentHTML("afterbegin", MIC_SVG);  // static, trusted SVG only
    btn.addEventListener("click", (e) => { if (e.target !== input) input.click(); });
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.value = "";
      if (!file || micBusy) return;
      label.textContent = t("mic_thinking");
      micBusy = true;
      try { await onAudio(file); } finally { micBusy = false; label.textContent = t(`${labelKey}_upload`); }
    });
    return btn;
  }

  // A big hold-to-talk button with a level bar. `onAudio(wav)` gets the finished recording.
  function micButton(labelKey, onAudio) {
    const bar = el("span", { class: "mic-bar" });
    const label = el("span", { class: "mic-label" }, t(labelKey));
    const btn = el("button", { type: "button", class: "mic", "aria-label": t(labelKey) }, label, el("span", { class: "mic-meter" }, bar));
    btn.insertAdjacentHTML("afterbegin", MIC_SVG);  // static, trusted SVG only
    if (!canListen) return recorderButton(labelKey, onAudio);
    let starting = null;
    const reset = () => { btn.classList.remove("on"); label.textContent = t(labelKey); bar.style.transform = "scaleX(0)"; };
    const start = (e) => {
      if (starting || micBusy) return;
      if (e && e.pointerId !== undefined) btn.setPointerCapture(e.pointerId);
      btn.classList.add("on");
      label.textContent = t("mic_listening");
      stopSpeaking();
      starting = Mic.start(bar).catch((err) => {
        reset();
        toast(t(err && err.name === "NotAllowedError" ? "mic_denied" : "mic_none"));
        throw err;
      });
    };
    const end = async () => {
      if (!starting) return;
      const pending = starting;
      starting = null;
      try { await pending; } catch { return; }
      const wav = Mic.stop();
      reset();
      if (!wav) { toast(t("mic_short")); return; }
      label.textContent = t("mic_thinking");
      micBusy = true;
      try { await onAudio(wav); } finally { micBusy = false; label.textContent = t(labelKey); }
    };
    btn.addEventListener("pointerdown", (e) => { e.preventDefault(); start(e); });
    btn.addEventListener("pointerup", end);
    btn.addEventListener("pointercancel", end);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
    btn.addEventListener("keydown", (e) => {  // keyboard: Space or Enter starts, again stops
      if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); if (starting) end(); else start(); }
    });
    return btn;
  }

  function setupMessageMic() {
    if (state.nodeless) { $("#mic-msg").replaceChildren(); return; }  // speech is recognised on the node
    $("#mic-msg").replaceChildren(micButton("mic_dictate", async (wav) => {
      try {
        const out = await asr(wav, {});
        if (!out.text) { toast(t("mic_none")); return; }
        const box = $("#msg");
        box.value = (box.value.trim() ? `${box.value.trimEnd()} ` : "") + out.text;
        if (out.confidence < 0.6) toast(t("check_low_conf"));
      } catch {
        toast(t("err_network"));
      }
    }));
  }
  $("#btn-speak").addEventListener("click", () => {
    const card = state.check;
    if (!card) return;
    const expl = state.explanation ? state.explanation.explanation[state.lang] : "";
    const text = [card.label[state.lang], expl || card.headline[state.lang], ...card.actions[state.lang]].join(". ");
    if (!speak(text, state.lang)) toast(t("no_voice"));
  });

  // ---------------------------------------------------------------- complaint draft
  $("#btn-complaint").addEventListener("click", () => {
    const card = state.check;
    if (!card) return;
    const f = $("#complaint-form");
    const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    f.when.value = now;
    f.channel.value = card.input_type === "call" ? t("channel_call") : t("channel_sms");
    f.number.value = (card.extracted.mobiles[0] || $("#sender").value || "");
    f.upi.value = card.extracted.upi_ids[0] || "";
    f.link.value = card.extracted.links[0] || "";
    f.lost.value = "";
    f.txn.value = "";
    f.message.value = state.message;
    go("complaint");
  });
  $("#btn-print").addEventListener("click", () => {
    const s = $('[data-screen="complaint"]');
    s.classList.add("printing");
    window.print();
    s.classList.remove("printing");
    api("/api/counters/slip", { kind: "fraud" }).catch(() => {});
  });

  // ---------------------------------------------------------------- "Ask the agent"
  // Puts the case in the console's queue and shows the person a big ticket number. The agent
  // sees the verdict or the scheme results; message text never leaves the node's memory.
  async function askAgent(body) {
    try {
      const out = await api("/api/queue", { ...body, lang: state.lang });
      $("#ticket-no").textContent = out.ticket;
      $("#ticket").hidden = false;
      $("#ticket-ok").focus();
      if (voice.auto) speak(`${t("ticket_title")}: ${out.ticket.replace("-", " ")}. ${t("ticket_sub")}`);
    } catch {
      toast(t("agent_offline"));
    }
  }
  $("#btn-agent-check").addEventListener("click", () => { if (state.check) askAgent({ kind: "check", check_id: state.check.id }); });
  $("#btn-agent-nav").addEventListener("click", () => askAgent({ kind: "benefits", answers: nav.answers }));
  $("#ticket-ok").addEventListener("click", () => { $("#ticket").hidden = true; });

  // ---------------------------------------------------------------- benefits navigator
  // The node decides everything (rules live in the schemes pack); the phone only asks the
  // question it is given and shows the result. All text goes in through textContent.
  const NAV_GROUPS = ["eligible", "likely", "check", "unlock", "have", "not_eligible"];
  const USEFUL = ["eligible", "likely", "check", "unlock", "have"];
  const TRUTH_ICON = { T: "✓", L: "≈", U: "?", F: "✗" };
  const SLIP_MARK = { eligible: "✓", likely: "≈", check: "?", unlock: "→" };
  const nav = { catalog: null, answers: {}, order: [], question: null, result: null, already: new Set(), session: null };
  const newSession = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).replace(/-/g, "").slice(0, 24);

  function el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    node.append(...kids.flat(2).filter((kid) => kid != null && kid !== false));
    return node;
  }
  const tr = (obj) => (obj ? obj[state.lang] ?? obj.en : "");
  const fmt = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
  const hostOf = (url) => { try { return new URL(url).host.replace(/^www\./, ""); } catch { return ""; } };

  async function loadNavigator() {
    try { nav.catalog = await api("/api/navigator"); } catch { nav.catalog = null; }
    renderNavIntro();
  }

  function renderNavIntro() {
    const c = nav.catalog;
    $("#nav-demos").replaceChildren(...(c ? c.demos : []).map((d) =>
      el("button", { type: "button", class: "chip", onclick: () => navDemo(d) }, tr(d.label))));
    $("#nav-covers").textContent = c ? `${t("nav_covers")} ${c.schemes.map((s) => s.short).join(" · ")}` : "";
  }

  function navReset() {
    Object.assign(nav, { answers: {}, order: [], question: null, result: null, already: new Set(), session: newSession() });
  }

  async function navNext() {
    try {
      const out = await api("/api/navigator/next", { answers: nav.answers });
      if (out.done) { await navResult(); return; }
      nav.question = out.question;
      renderQuestion();
      go("question");
      $("#q-text").focus();
    } catch {
      toast(t("err_network"));
    }
  }

  function navAnswer(value) {
    nav.answers[nav.question.id] = value;
    nav.order.push(nav.question.id);
    navNext();
  }

  function navBack() {
    if (!nav.order.length) { go("benefits"); return; }
    delete nav.answers[nav.order.pop()];
    nav.result = null;
    navNext();
  }

  async function fetchNavResult() {
    nav.result = await api("/api/navigator/result", { answers: nav.answers, already: [...nav.already], session: nav.session, lang: state.lang });
    renderNavResult();
  }

  async function navResult() {
    try {
      await fetchNavResult();
      go("benefits-result");
      $("#nav-summary").focus();
    } catch {
      toast(t("err_network"));
    }
  }

  function navDemo(demo) {
    navReset();
    nav.answers = { ...demo.answers };
    nav.order = Object.keys(demo.answers);
    return navResult();
  }

  // ---- one question per screen
  function renderQuestion() {
    const q = nav.question;
    if (!q) return;
    $("#q-count").textContent = fmt(t("q_count"), { n: q.number, max: q.max_questions });
    $("#q-bar").style.width = `${Math.round((100 * q.number) / q.max_questions)}%`;
    $("#q-text").textContent = tr(q.text);
    $("#q-help").textContent = tr(q.help);
    let body;
    if (q.kind === "age") body = ageInput(q);
    else if (q.kind === "multi") body = multiInput(q);
    else body = [el("div", { class: "opts" }, q.options.map((o) =>
      el("button", { type: "button", class: "opt", onclick: () => navAnswer(o.id) }, tr(o.label))))];
    $("#q-body").replaceChildren(...body);
    renderQuestionMic();
  }

  // ---- answering by voice: the node recognises and matches; the person confirms
  function renderQuestionMic() {
    const q = nav.question;
    $("#q-confirm").hidden = true;
    if (state.nodeless) { $("#q-mic").replaceChildren(); return; }
    $("#q-mic").replaceChildren(micButton("mic_answer", async (wav) => {
      const params = { question: q.id };
      if (q.options) params.options = q.options.map((o) => o.id).join(",");
      try {
        const out = await asr(wav, params);
        if (nav.question !== q) return;  // the person moved on
        if (!out.text) { toast(t("mic_none")); return; }
        confirmHeard(q, out);
      } catch {
        toast(t("err_network"));
      }
    }));
  }

  function answerLabel(q, answer) {
    if (q.kind === "age") return `${answer} ${t("years_word")}`;
    if (q.kind === "multi") {
      return answer.length ? q.options.filter((o) => answer.includes(o.id)).map((o) => tr(o.label)).join("; ") : tr(q.none);
    }
    const o = q.options.find((x) => x.id === answer);
    return o ? tr(o.label) : String(answer);
  }

  function confirmHeard(q, out) {
    const box = $("#q-confirm");
    const understood = out.answer !== null && out.answer !== undefined;
    const kids = [el("p", { class: "heard" }, `${t("heard")}: “${out.text}”`)];
    if (understood) {
      kids.push(
        el("p", { class: "heard-as" }, `${t("heard_as")}: `, el("b", {}, answerLabel(q, out.answer))),
        el("p", { class: "heard-q" }, t("is_right")),
        el("div", { class: "cta-row" },
          el("button", { type: "button", class: "primary", onclick: () => { box.hidden = true; navAnswer(out.answer); } }, t("yes_right")),
          el("button", { type: "button", class: "secondary", onclick: () => { box.hidden = true; stopSpeaking(); } }, t("say_again"))));
    } else {
      kids.push(el("p", {}, t("not_understood")));
    }
    box.replaceChildren(...kids);
    box.hidden = false;
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (voice.auto) speak(understood ? `${t("heard_as")}: ${answerLabel(q, out.answer)}. ${t("is_right")}` : t("not_understood"));
  }

  function ageInput(q) {
    const input = el("input", { type: "number", inputmode: "numeric", min: "0", max: "120", "aria-label": t("age_label"),
      placeholder: t("age_label"), class: "age-input" });
    const submit = () => {
      const n = Number(input.value);
      if (input.value === "" || !Number.isInteger(n) || n < 0 || n > 120) { toast(t("age_err")); input.focus(); return; }
      navAnswer(n);
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    return [
      el("div", { class: "age-row" }, input, el("button", { type: "button", class: "primary", onclick: submit }, t("next"))),
      el("p", { class: "try" }, t("age_unsure")),
      el("div", { class: "bands" }, q.bands.map((b) =>
        el("button", { type: "button", class: "opt", onclick: () => navAnswer(b.id) }, tr(b.label)))),
    ];
  }

  function multiInput(q) {
    const chosen = new Set();
    const nextBtn = el("button", { type: "button", class: "primary", disabled: true, onclick: () => navAnswer([...chosen]) }, t("next"));
    const toggles = q.options.map((o) => {
      const b = el("button", { type: "button", class: "opt toggle", "aria-pressed": "false" },
        el("span", { class: "tick", "aria-hidden": "true" }), el("span", {}, tr(o.label)));
      b.addEventListener("click", () => {
        if (chosen.has(o.id)) chosen.delete(o.id); else chosen.add(o.id);
        b.setAttribute("aria-pressed", String(chosen.has(o.id)));
        nextBtn.disabled = chosen.size === 0;
      });
      return b;
    });
    return [
      el("div", { class: "opts" }, toggles),
      el("div", { class: "cta-row" },
        el("button", { type: "button", class: "secondary", onclick: () => navAnswer([]) }, tr(q.none)), nextBtn),
    ];
  }

  // Join spoken parts so each one stays its own sentence: the node then finds each part
  // ready-made in its speech cache instead of synthesising a new combination.
  function joinSpoken(parts) {
    const stop = state.lang === "hi" ? "।" : ".";
    return parts.map((p) => (p || "").trim()).filter(Boolean).map((p) => (/[।.?!]$/.test(p) ? p : p + stop)).join(" ");
  }

  function spokenQuestion() {
    const q = nav.question;
    if (!q) return "";
    const choices = q.kind === "age" ? [] : q.options.map((o) => tr(o.label));
    if (q.kind === "multi") choices.push(tr(q.none));
    return joinSpoken([tr(q.text), tr(q.help), ...choices]);
  }

  // ---- result
  function renderNavResult() {
    const r = nav.result;
    if (!r) return;
    const byId = Object.fromEntries(r.schemes.map((s) => [s.id, s]));
    const useful = USEFUL.reduce((n, g) => n + r.groups[g].length, 0);
    $("#nav-summary").replaceChildren(
      el("div", { class: "big" }, useful ? fmt(t("nav_summary"), { n: useful, total: r.schemes.length }) : t("nav_summary_none")),
      el("div", { class: "profile" }, r.profile.map((p) => el("span", { class: "pchip" }, `${tr(p.short)}: ${tr(p.answer)}`))));
    // Health cover first: free hospital treatment is often the most valuable line on the page, and the
    // card is made at this very counter. Every word and amount here comes from the signed schemes pack.
    const health = r.schemes.filter((s) => s.family === "health" && ["eligible", "likely", "check"].includes(s.status));
    $("#nav-health").replaceChildren(...(health.length ? [el("section", { class: "health-callout" },
      el("div", { class: "hc-title" }, t("health_title")),
      health.map((s) => el("div", { class: "hc-item" },
        el("div", { class: "hc-name" }, `${tr(s.name)} · ${t(`st_${s.status}`)}`),
        s.benefit_now ? el("div", { class: "hc-now" }, tr(s.benefit_now)) : null,
        el("p", { class: "hc-say" }, `${t("say_label")}: “${s.counter[state.lang]}”`))))] : []));
    const blocks = NAV_GROUPS.filter((g) => r.groups[g].length).map((g) => {
      const cards = r.groups[g].map((id) => schemeCard(byId[id]));
      if (g === "not_eligible") {
        return el("details", { class: "group g-not_eligible" }, el("summary", {}, `${t("g_not_eligible")} (${cards.length})`), cards);
      }
      return el("section", { class: `group g-${g}` }, el("h3", {}, t(`g_${g}`), el("span", { class: "count" }, String(cards.length))), cards);
    });
    $("#nav-groups").replaceChildren(...blocks);
    $("#nav-amount-note").textContent = tr(r.notes.amount);
    $("#nav-fraud-note").textContent = tr(r.notes.fraud);
    $("#nav-meta").textContent = `${r.asked} ${t("questions_asked")} · ${t("pack")} ${r.pack.name} v${r.pack.version} · ${r.timing_ms} ${t("ms")}`;
  }

  function schemeCard(s) {
    const head = el("div", { class: "s-head" },
      el("span", { class: `st st-${s.status}` }, t(`st_${s.status}`)),
      el("h4", {}, tr(s.name)),
      s.benefit_now && s.status !== "not_eligible" ? el("div", { class: "s-now" }, tr(s.benefit_now)) : null,
      el("p", { class: "s-what" }, tr(s.what)));
    const why = el("ul", { class: "why" }, s.reasons.map((r) =>
      el("li", { class: `t-${r.truth}` }, el("span", { class: "ti", "aria-hidden": "true" }, TRUTH_ICON[r.truth]), tr(r.text))));
    if (s.status === "not_eligible") return el("article", { class: `scheme s-${s.status}` }, head, why);
    const sources = s.sources.map((x) => `${x.publisher}${x.page_date ? `, ${x.page_date}` : ""} (${hostOf(x.url)})`).join(" · ");
    const details = el("details", {}, el("summary", {}, t("details")),
      el("h5", {}, t("why_label")), why,
      s.unlock ? el("p", { class: "unlock" }, tr(s.unlock.hint)) : null,
      s.check_how ? [el("h5", {}, t("how_label")), el("p", {}, tr(s.check_how))] : null,
      el("h5", {}, t("benefit_label")), el("p", {}, tr(s.benefit)),
      el("h5", {}, t("docs_label")), el("ul", { class: "docs" }, s.documents.map((d) => el("li", {}, tr(d)))),
      el("h5", {}, t("where_label")), el("p", {}, tr(s.where)),
      el("h5", {}, t("say_label")), el("blockquote", { class: "say" }, s.counter[state.lang]),
      el("button", { type: "button", class: "chip", onclick: () => { if (!speak(s.counter[state.lang], state.lang)) toast(t("no_voice")); } },
        t("speak_btn")),
      s.notes.length ? el("ul", { class: "s-notes" }, s.notes.map((n) => el("li", {}, tr(n)))) : null,
      el("p", { class: "src" }, `${t("source_label")}: ${sources} · ${t("checked_label")} ${s.sources[0].checked}`));
    // "I already get this" makes no sense for a scheme that first needs a bank account.
    const have = s.status === "unlock" ? null : el("label", { class: "have" },
      el("input", { type: "checkbox", checked: nav.already.has(s.id), onchange: (e) => toggleHave(s.id, e.target.checked) }),
      t("have_label"));
    return el("article", { class: `scheme s-${s.status}` }, head, details, have);
  }

  async function toggleHave(id, on) {
    if (on) nav.already.add(id); else nav.already.delete(id);
    try { await fetchNavResult(); } catch { toast(t("err_network")); }
  }

  function spokenResult() {
    const r = nav.result;
    if (!r) return "";
    const byId = Object.fromEntries(r.schemes.map((s) => [s.id, s]));
    const parts = [$("#nav-summary .big").textContent];
    for (const g of ["eligible", "likely", "check", "unlock"]) {
      for (const id of r.groups[g]) {
        const s = byId[id];
        parts.push(tr(s.name), t(`st_${s.status}`), s.benefit_now ? tr(s.benefit_now) : "");
      }
    }
    return joinSpoken(parts);
  }

  // ---- printable slip
  function renderSlip() {
    const r = nav.result;
    if (!r) return;
    const byId = Object.fromEntries(r.schemes.map((s) => [s.id, s]));
    const ids = ["eligible", "likely", "check", "unlock"].flatMap((g) => r.groups[g]);
    const items = ids.map((id) => {
      const s = byId[id];
      return el("li", {},
        el("div", { class: "slip-sname" }, `${SLIP_MARK[s.status]} ${tr(s.name)} — ${t(`st_${s.status}`)}${s.benefit_now ? ` · ${tr(s.benefit_now)}` : ""}`),
        el("div", {}, el("b", {}, `${t("where_label")}: `), tr(s.where)),
        el("div", { class: "slip-docs" }, el("b", {}, `${t("docs_label")}: `), s.documents.map((d) => el("span", { class: "doc" }, `☐ ${tr(d)}`))),
        el("div", { class: "slip-say" }, `“${s.counter[state.lang]}”`));
    });
    $("#slip-sheet").replaceChildren(
      el("div", { class: "slip-head" },
        r.slip.qr ? el("img", { class: "slip-qr", src: r.slip.qr, alt: t("slip_qr"), width: "128", height: "128" }) : null,
        el("div", {},
          el("h2", {}, t("slip_title")),
          el("p", {}, `${t("slip_date")}: ${r.slip.date} · ${t("slip_no_name")}`),
          r.slip.qr ? el("p", { class: "slip-op" }, t("slip_operator")) : null)),
      el("h3", {}, t("slip_answers")),
      el("ul", { class: "slip-answers" }, r.profile.map((p) => el("li", {}, el("b", {}, `${tr(p.short)}: `), tr(p.answer)))),
      el("h3", {}, t("slip_schemes")),
      items.length ? el("ol", { class: "slip-schemes" }, items) : el("p", {}, t("nav_summary_none")),
      el("p", { class: "slip-note" }, tr(r.notes.amount)),
      el("p", { class: "slip-note" }, tr(r.notes.fraud)),
      el("p", { class: "slip-note" }, tr(r.notes.decision)),
      el("p", { class: "slip-foot" }, `${t("pack")} ${r.pack.name} v${r.pack.version} (${r.pack.date})`));
  }

  $("#btn-nav-start").addEventListener("click", () => { navReset(); navNext(); });
  $("#btn-q-back").addEventListener("click", navBack);
  $("#btn-q-listen").addEventListener("click", () => { if (!speak(spokenQuestion(), state.lang)) toast(t("no_voice")); });
  $("#btn-nav-listen").addEventListener("click", () => { if (!speak(spokenResult(), state.lang)) toast(t("no_voice")); });
  $("#btn-nav-change").addEventListener("click", navBack);
  $("#btn-nav-restart").addEventListener("click", () => { navReset(); go("benefits"); });
  $("#btn-slip").addEventListener("click", () => { renderSlip(); go("slip"); });
  $("#btn-slip-print").addEventListener("click", () => {
    const s = $('[data-screen="slip"]');
    s.classList.add("printing");
    window.print();
    s.classList.remove("printing");
    api("/api/counters/slip", { kind: "scheme" }).catch(() => {});
  });

  // ---------------------------------------------------------------- language, health, offline cache
  $("#lang-toggle").addEventListener("click", () => {
    state.lang = other(state.lang);
    saveLang(state.lang);
    applyI18n();
  });

  async function loadHealth() {
    try {
      const h = await api("/api/health");
      state.health = h;
      const fraud = (h.packs || []).find((p) => p.name === "fraud");
      $("#pack-version").textContent = fraud ? `· fraud pack v${fraud.version}` : "";
      $("#node-pill").title = `Sahayak node ${h.version}`;
      voice.nodeOk = Boolean(h.voice && h.voice.tts && (h.voice.tts.hi || []).length);
      renderVoiceStatus();
    } catch (e) {
      if (!(e instanceof NodeUnreachable)) return;
      setNodeless(true);  // away from the node: say so, and show the packs this phone checks with
      loadLocal().then(() => {
        const fraud = local.packs.find((p) => p.name === "fraud");
        $("#pack-version").textContent = fraud ? `· fraud pack v${fraud.version}` : "";
      }).catch(() => {});
    }
  }

  // The service worker keeps the app, the on-phone checker and its packs (browsers allow it only on a
  // secure page: the node's HTTPS address, or the stand-alone build on an HTTPS site).
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register(`${ROOT}sw.js`).catch(() => {});
    // Ask the browser to keep the offline copy when the phone runs short of space. Chrome and Safari decide
    // quietly; Firefox would ask the person, so it is not asked there.
    if (navigator.storage && navigator.storage.persist && !/Firefox\//.test(navigator.userAgent)) {
      navigator.storage.persisted().then((kept) => kept || navigator.storage.persist()).catch(() => {});
    }
  }

  // Deep links: ?lang=en, ?screen=check|benefits, ?demo=<example id>, ?nav=start|<persona id>.
  // A QR code printed on a demo card can open straight to its verdict or benefits result.
  const params = new URLSearchParams(location.search);
  if (T[params.get("lang")]) state.lang = params.get("lang");
  applyI18n();
  setMode("text");
  loadQRExamples();
  Promise.all([loadExamples(), loadNavigator()]).then(() => {
    const demo = examples.find((ex) => ex.id === params.get("demo"));
    const persona = nav.catalog && nav.catalog.demos.find((d) => d.id === params.get("nav"));
    // "Share to Sahayak" from the SMS app (Web Share Target): the shared text opens as a check
    const shared = [params.get("text"), params.get("url")].filter(Boolean).join(" ").trim();
    if (shared) {
      go("check");
      setMode("text");
      $("#msg").value = shared.slice(0, 4000);
      runCheck();
    } else if (demo) useExample(demo);
    else if (persona) navDemo(persona);
    else if (params.get("qr")) {  // ?qr=<example id>: a printed demo card's QR opens its check
      setMode("qr");
      const ex = ((local.demo || {}).qr_examples || []).find((x) => x.id === params.get("qr"));
      if (state.nodeless) { if (ex) checkQR(null, ex.payload); } else {
        fetch(`/api/demo/qr/${encodeURIComponent(params.get("qr"))}`).then((r) => (r.ok ? r.blob() : null)).then((b) => b && checkQR(b));
      }
    }
    else if (params.get("answers")) {
      try {
        const raw = params.get("answers").replace(/-/g, "+").replace(/_/g, "/");
        navDemo({ answers: JSON.parse(decodeURIComponent(escape(atob(raw)))) });
      } catch { go("benefits"); }
    }
    else if (params.get("nav") === "start") { navReset(); navNext(); }
    else if (params.get("screen")) go(params.get("screen"));
  });
  if (STANDALONE) setNodeless(true); else loadHealth();
  // Load the on-phone checker in the background, so it is ready (and kept by the service worker) before
  // the person walks away from the node.
  setTimeout(() => loadLocal().catch(() => {}), 1500);
  if ("speechSynthesis" in window) window.speechSynthesis.getVoices();  // warm the voice list
})();
