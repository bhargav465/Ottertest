# Publishing Ottertest to the Google Play Store

Ottertest is a PWA. Google Play accepts it as a **Trusted Web Activity (TWA)** — a
thin native wrapper that loads your live site full-screen. This guide takes you
from the deployed web app to a published Play listing.

**What's already done in this repo**
- ✅ Installable PWA (manifest, service worker, icons)
- ✅ Privacy policy page at `/privacy.html`
- ✅ Digital Asset Links file at `/.well-known/assetlinks.json` (fingerprint is a
  placeholder — you fill it in below)
- ✅ Bubblewrap config at `android/twa-manifest.json`
- ✅ CI build workflow (`.github/workflows/android-build.yml`) that outputs an `.aab`

**What only you can do** (needs your Google account + money): create the Play
Console account ($25 one-time), upload the build, and fill the store listing /
Data Safety forms.

---

## 0. Prerequisites
- The site is deployed and live (`https://d1m9ye1xrz6czt.cloudfront.net`).
- Fill in the privacy policy contact: edit `frontend/public/privacy.html`, replace
  `CONTACT_EMAIL_PLACEHOLDER` with a real support email, and redeploy.
- A Play Console account: https://play.google.com/console/signup ($25 one-time).

---

## 1. Build the Android app bundle (`.aab`)

### Option A — locally with Bubblewrap (recommended, ~5 min)
```bash
npm install -g @bubblewrap/cli        # needs Node 18+ and a JDK
cd android
bubblewrap build                       # first run downloads the Android SDK/JDK,
                                        # creates a keystore, and prompts you
```
On first run Bubblewrap creates an **upload keystore** — keep `android.keystore`
and the passwords safe; you need the *same* key for every future update.
Output: `app-release-bundle.aab` (upload this) and `app-release-signed.apk`
(sideload to test on a device).

### Option B — in CI
Actions → **Build Android app (TWA)** → Run workflow. Download the
`ottertest-android` artifact. For a Play-uploadable build, first add these repo
secrets (otherwise CI makes a throwaway preview key):
- `ANDROID_KEYSTORE_BASE64` — `base64 -w0 android.keystore`
- `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`

---

## 2. Wire up Digital Asset Links (removes the URL bar)

The TWA only runs full-screen if your site vouches for the app.

1. Get your app's **SHA-256 signing fingerprint**:
   - If you use **Play App Signing** (recommended), it's in Play Console →
     your app → *Setup → App integrity → App signing key certificate*.
   - Or from your keystore:
     ```bash
     keytool -list -v -keystore android.keystore -alias ottertest | grep SHA256
     ```
2. Edit `frontend/public/.well-known/assetlinks.json`: replace
   `REPLACE_WITH_YOUR_APP_SIGNING_SHA256_FINGERPRINT` with that value (and the
   `package_name` if you changed it from `com.ottertest.twa`).
3. Redeploy the site (Actions → Deploy to AWS). Verify:
   ```bash
   curl https://d1m9ye1xrz6czt.cloudfront.net/.well-known/assetlinks.json
   ```

> Use **Play App Signing** — then the fingerprint that matters is Google's final
> signing key (from step 1), not your local upload key.

---

## 3. Create the Play listing
Play Console → **Create app**, then complete:
- **Store listing**: name, short + full description, a 512×512 icon (use
  `pwa-512.png`), a 1024×500 feature graphic, and ≥2 phone screenshots.
- **Privacy policy URL**: `https://d1m9ye1xrz6czt.cloudfront.net/privacy.html`
- **Data safety**: declare that you collect **Audio** (voice recordings), a user
  **email**, and app content (transcripts); state it's encrypted in transit and
  users can request deletion.
- **Content rating** questionnaire and **target audience** (not for children).
- **App access**: sign-in is required — provide test credentials so reviewers can
  log in.

---

## 4. Upload & release
1. **Release → Testing → Internal testing** → create release → upload the `.aab`.
2. Add your email as a tester, install via the opt-in link, confirm it opens
   full-screen (no browser bar). If you see a URL bar, assetlinks isn't matching
   (recheck step 2 — the fingerprint must be the *final* signing key).
3. When happy, promote to **Production**.

---

## Notes
- **Microphone**: the TWA inherits the web mic permission; Android prompts on
  first record. No extra native permission config needed.
- **Custom domain**: if you later move off the CloudFront URL, update `host` /
  URLs in `android/twa-manifest.json`, `assetlinks.json`, and rebuild.
- **Updates**: bump `appVersionCode` (and `appVersionName`) each upload — the
  CI workflow takes them as inputs.
