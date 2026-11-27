# AirwayLab

[![CI](https://github.com/airwaylab-app/airwaylab/actions/workflows/ci.yml/badge.svg)](https://github.com/airwaylab-app/airwaylab/actions/workflows/ci.yml)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-blue.svg)](LICENSE)
[![Demo](https://img.shields.io/badge/Demo-airwaylab.app-brightgreen)](https://airwaylab.app)
[![Privacy](https://img.shields.io/badge/Privacy-Data%20Never%20Leaves%20Your%20Device-blueviolet)]()

Free, open-source airway analysis dashboard for PAP therapy users. See what your machine can't show you — flow limitation, breathing instability, oxygen patterns — all in your browser.

[Try the demo →](https://airwaylab.app/analyze?demo) · [Live site →](https://airwaylab.app)

## What it does

AirwayLab reads the raw flow waveform from your ResMed SD card and runs four independent analysis engines — entirely in your browser.

| Engine | What it measures |
|--------|-----------------|
| **Glasgow Index** | 9-component breath shape scoring (skew, flat top, spike, etc.) on a 0–9 scale |
| **WAT (Wobble Analysis Tool)** | FL Score, Regularity (Sample Entropy), Periodicity (FFT spectral analysis) |
| **NED Analysis** | Peak-to-mid inspiratory flow ratio with automated RERA detection |
| **Oximetry Pipeline** | 17-metric SpO2 and heart rate framework from Viatom/Checkme O2 Max CSV |

## Features

- Interactive dashboard with per-night drill-down
- Multi-night trend analysis with per-metric drill-down
- Night heatmap for visual pattern recognition
- Rule-based clinical insights with traffic light thresholds
- Export to CSV, JSON, PDF, and forum-ready text
- Built-in demo mode with realistic synthetic data
- localStorage persistence (30-day history)
- Therapy change date marker for before/after comparison

## Why AirwayLab exists

Your PAP machine collects detailed breath-by-breath data every night. Most of it goes unanalysed. Clinicians typically check AHI and move on, but AHI misses flow limitation, RERAs, and breathing pattern instability — the things that explain why you might still feel exhausted with an AHI under 5.

AirwayLab makes that data visible. It's free because we believe therapy insight should be accessible to everyone. It's open source because we believe you should be able to verify what happens with your medical data. It runs in your browser because your data is yours.

## Privacy first

- **All core analysis happens in your browser** — your sleep data never leaves your device by default
- No cookies, no fingerprinting, no tracking pixels
- Optional server features (AI insights, cloud storage, data contribution) require explicit opt-in consent
- Fully auditable open-source code (GPL-3.0)

## Supported devices

| Device | Status |
|--------|--------|
| ResMed AirSense 10 | ✅ Fully supported |
| ResMed AirCurve 10 (VPAP) | ✅ Fully supported |
| ResMed AirSense 11 | ⚠️ Experimental |

## How AirwayLab Compares

| Feature | AirwayLab | OSCAR | SleepHQ | myAir |
|---------|-----------|-------|---------|-------|
| Price | Free | Free | Free / $150yr Pro | Free |
| Platform | Web (any device) | Desktop | Web + Mobile | Mobile |
| Install required | No | Yes | No | Yes (app) |
| Data stays local | ✅ Yes | ✅ Yes | ❌ Cloud | ❌ Cloud |
| Flow limitation engines | 4 (Glasgow, WAT, NED, Oximetry) | 1 | Basic | None |
| Breath shape scoring | ✅ Glasgow Index | ❌ | ❌ | ❌ |
| RERA detection | ✅ Automated | Manual | ❌ | ❌ |
| Multi-manufacturer | ResMed only | Multi | ResMed focus | ResMed only |
| Open source | ✅ GPL-3.0 | ✅ GPL-3.0 | ❌ | ❌ |

*AirwayLab is designed to complement OSCAR, not replace it.*

## Getting started

### Hosted version

Visit [airwaylab.app](https://airwaylab.app) — no install needed.

### Local development

Use Node.js 20 (`20.19` or newer). From your AirwayLab checkout:

```bash
npm ci
npm run dev -- --hostname 127.0.0.1
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). SD card analysis and rule-based insights don’t need accounts or environment variables.

### Use a ChatGPT plan for local AI Insights (macOS)

**You need:** an eligible ChatGPT plan and OrbStack or Docker Desktop. You don’t need a Supabase.com account, a paid AirwayLab tier, or an OpenAI API key.

#### 1. Start Supabase

Open OrbStack or Docker Desktop. Set up a separate Supabase project for sign-in only. Don’t run `supabase start` from the AirwayLab repo: its full migration history doesn’t replay on a fresh database.

```bash
brew install supabase/tap/supabase
mkdir -p ~/airwaylab-local-auth
cd ~/airwaylab-local-auth
supabase init
```

In `supabase/config.jsonc` (or `config.toml`), set:

| Auth setting | Value |
| --- | --- |
| `auth.site_url` | `http://127.0.0.1:3000` |
| `auth.additional_redirect_urls` | `["http://127.0.0.1:3000/auth/**"]` |

Run `supabase start` in that directory. Copy the **Publishable** key (or **anon** on older CLI versions). Mailpit and Studio start automatically.

#### 2. Configure AirwayLab

In your AirwayLab checkout, add to `.env.local`:

```dotenv
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<local Publishable key>
```

Use only the local key. A service-role key isn’t needed. Start AirwayLab:

```bash
npm run dev -- --hostname 127.0.0.1
```

#### 3. Sign in and get your owner ID

1. Request a sign-in link on [local AirwayLab](http://127.0.0.1:3000).
2. In the same browser, open [Mailpit](http://127.0.0.1:54324) and click **Your sign-in link**. The email goes to Mailpit, not your regular inbox. If the link takes you to `localhost`, return to AirwayLab at `127.0.0.1`.
3. In [Supabase Studio](http://127.0.0.1:54323), go to **Authentication → Users** and copy the **UID** next to your email. The UID is in Studio, not in the email.

#### 4. Connect ChatGPT and choose a model

From your AirwayLab checkout, run `login` and approve access in your browser. Then run `models`:

```bash
node scripts/chatgpt.mjs login
node scripts/chatgpt.mjs models
```

Add both values to `.env.local`:

```dotenv
AIRWAYLAB_CHATGPT_OWNER_ID=<UID from Supabase Studio>
AIRWAYLAB_CHATGPT_MODEL=<model slug from the models command>
```

#### 5. Run insights

Restart AirwayLab with the command from step 2. Load a PAP night outside demo mode and open **Overview**.

- **Send to OpenAI & generate insights** sends nightly metrics, dates, settings, and trends.
- **Send to OpenAI & generate deep insights** also sends up to 1,000 per-breath metric summaries from the selected night.

Neither sends raw waveforms or night notes. OpenAI processes the approved data in the cloud. Keep this setup on your own Mac.

**Troubleshooting**

- Still signed out? Request a fresh link from `127.0.0.1:3000` and open it in the same browser. Don’t switch between `localhost` and `127.0.0.1`.
- Profile, night sync, and benchmark warnings are expected: this Supabase instance only handles sign-in and doesn’t store PAP data.
- To disconnect ChatGPT, run `node scripts/chatgpt.mjs logout`. To disable this mode, remove `AIRWAYLAB_CHATGPT_OWNER_ID` and restart AirwayLab.
- If interrupted sign-in leaves a stale lock, stop AirwayLab and the sign-in command, then run `rmdir ~/.config/airwaylab/chatgpt.json.lock`.

### Tests

```bash
npm test
```

## Tech stack

- **Framework:** Next.js 14, TypeScript (strict)
- **Styling:** Tailwind CSS + shadcn/ui (with @base-ui/react)
- **Charts:** Recharts 3.8
- **Processing:** Web Workers for non-blocking analysis
- **Testing:** Vitest + Testing Library
- **Fonts:** IBM Plex Sans + JetBrains Mono

## Contributing

Open an issue before submitting large PRs. We especially welcome help with:

- AirSense 11 parser improvements
- Philips Respironics device support
- Additional pulse oximeter formats
- Internationalisation (i18n)

## Support AirwayLab

If AirwayLab helps you understand your therapy data:

- ⭐ **Star this repo** — it helps others discover the project
- 🐛 **Report bugs** — [open an issue](https://github.com/airwaylab-app/airwaylab/issues)
- 💬 **Share your results** — post on [r/SleepApnea](https://reddit.com/r/SleepApnea) or [ApneaBoard](https://apneaboard.com)
- 🔧 **Contribute** — PRs welcome, especially for device support

## Community

- [ApneaBoard Forum](https://www.apneaboard.com/)
- [r/SleepApnea](https://www.reddit.com/r/SleepApnea/)
- [r/CPAP](https://www.reddit.com/r/CPAP/)

## License

GPL-3.0. See [LICENSE](LICENSE).

The Glasgow Index engine is based on [DaveSkvn's Glasgow Index](https://github.com/DaveSkvn/GlasgowIndex) (GPL-3.0).

## Disclaimer

AirwayLab is **not** a medical device. It is **not** FDA or CE cleared. All analysis is for **informational and educational purposes only**. Always discuss results with your sleep physician before making therapy changes.
