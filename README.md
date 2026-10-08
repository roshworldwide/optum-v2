# Sahayak · सहायक: try it on your phone

**▶ https://roshworldwide.github.io/optum-v2/**

This is the working Sahayak app, built for Ideas for India 2026 (Inclusive Innovation for Bharat): an offline scam
check and benefits guide for people new to digital money, in Hindi and English.

- **"Is this a scam?"** Copy a message and tap **Paste and check**, or type it, describe a call, or check a UPI QR
  code. You get a verdict, what to do first, the reasons and a ready 1930 complaint. On a scam, **Warn your family**
  shares the verdict and the advice (never the message itself).
- **"What am I owed?"** A short interview across 12 central schemes, health cover first, with one list of every
  paper to carry and what to say at the counter.

Bigger text: open **Voice and text size** on the home screen. On Android, Chrome may offer **Keep Sahayak on your
home screen**; once added, it opens without internet. Tap **EN** for English.

Everything runs in your phone's browser from signed content packs. Nothing you type is sent anywhere. After the
first visit it keeps working with the internet off (try airplane mode). The answers are the same as on the
Sahayak node at a CSC counter, case for case.

This stand-alone build leaves out what needs the node: voice input, reading screenshots and the "Ask the agent"
queue. QR photos use your browser's own QR reader where it has one, and screens are read aloud by your phone's
voice.

- Source, tests and evidence: https://github.com/roshworldwide/Sahayak (made with `python scripts/build_tryit.py`)
- Design: Rosh 27. Fonts and icons ship with the site (Geist, SIL OFL 1.1; Material Symbols, Apache-2.0; see
  `app/fonts/LICENSE.txt`), so it works and looks the same offline.
- Team: Roshan Raj, Ishmiit Singh
- The round-1 clickable mock that used to be here is in this repository's history (commit 540d658).
