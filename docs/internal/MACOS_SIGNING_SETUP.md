# macOS Code Signing & Notarization Setup

This guide walks through getting all 6 GitHub secrets needed to sign and notarize the Nuclei macOS .dmg, eliminating the Gatekeeper "could not verify" warning.

**Prerequisites:** Apple Developer Program membership ($99/year). You already have this.

## What you'll end up with

6 GitHub repository secrets that the release workflow uses:

| Secret | What it is |
|--------|------------|
| `APPLE_CERTIFICATE` | Base64-encoded .p12 export of your Developer ID Application cert |
| `APPLE_CERTIFICATE_PASSWORD` | Password you chose when exporting the .p12 |
| `APPLE_SIGNING_IDENTITY` | The exact name of the cert, like `Developer ID Application: Cale Lamb (ABCD1234EF)` |
| `APPLE_ID` | Your Apple ID email address |
| `APPLE_PASSWORD` | An **app-specific password** (not your real Apple ID password) |
| `APPLE_TEAM_ID` | Your 10-character Apple Developer Team ID |

## Step 1 — Create the Developer ID Application certificate

1. Go to [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates/list)
2. Click the **+** button to add a new certificate
3. Under **Software**, select **Developer ID Application**
4. Click **Continue**
5. Follow the instructions to create a Certificate Signing Request (CSR) using Keychain Access:
   - Open **Keychain Access** → menu **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority**
   - User email: your Apple ID email
   - Common name: your name
   - CA email: leave blank
   - Select **Saved to disk**
   - Click **Continue**, save the .certSigningRequest file
6. Back on the Apple page, upload the .certSigningRequest file
7. Download the resulting `developerID_application.cer` file
8. Double-click it to install it into your Keychain

## Step 2 — Export the cert as .p12

1. Open **Keychain Access**
2. Select **login** keychain → **My Certificates**
3. Find **Developer ID Application: Your Name (TEAMID)**
4. Right-click → **Export...**
5. File format: **Personal Information Exchange (.p12)**
6. Save as `nuclei-signing.p12`
7. Set a password (you'll use this as `APPLE_CERTIFICATE_PASSWORD`)

## Step 3 — Base64 encode the .p12

```bash
base64 -i nuclei-signing.p12 | pbcopy
```

This copies the base64 string to your clipboard. That's `APPLE_CERTIFICATE`.

## Step 4 — Find the signing identity name

```bash
security find-identity -v -p codesigning
```

Look for a line like:

```
1) ABC123... "Developer ID Application: Cale Lamb (ABCD1234EF)"
```

The full quoted string is `APPLE_SIGNING_IDENTITY`. Copy everything between the quotes.

## Step 5 — Find your Team ID

1. Go to [developer.apple.com/account](https://developer.apple.com/account)
2. Click **Membership details** in the sidebar
3. Copy the **Team ID** (10 characters, all caps)

That's `APPLE_TEAM_ID`.

## Step 6 — Generate an app-specific password

macOS notarization requires an **app-specific password**, not your real Apple ID password.

1. Go to [appleid.apple.com](https://appleid.apple.com)
2. Sign in
3. **Sign-In and Security → App-Specific Passwords**
4. Click **+** to generate one
5. Label it `nuclei-notarization`
6. Copy the password shown (format: `abcd-efgh-ijkl-mnop`)

That's `APPLE_PASSWORD`.

Your Apple ID email is `APPLE_ID`.

## Step 7 — Add all 6 secrets to GitHub

```bash
# From the repo root
gh secret set APPLE_CERTIFICATE < /dev/stdin  # paste the base64 string, Ctrl+D
gh secret set APPLE_CERTIFICATE_PASSWORD      # enter the .p12 password
gh secret set APPLE_SIGNING_IDENTITY           # enter the full "Developer ID Application: ..." string
gh secret set APPLE_ID                          # enter your Apple ID email
gh secret set APPLE_PASSWORD                    # enter the app-specific password
gh secret set APPLE_TEAM_ID                     # enter the 10-char team ID
```

Or use the GitHub web UI: repo → **Settings → Secrets and variables → Actions → New repository secret**.

## Step 8 — Tag a new release to test

```bash
# Bump version in package.json, Cargo.toml, tauri.conf.json, CHANGELOG.md
git add -A && git commit -m "chore: release v0.1.2"
git tag v0.1.2
git push && git push --tags
```

The release workflow will:
1. Decode `APPLE_CERTIFICATE` and import the .p12 into a temporary keychain
2. Sign the .app with `APPLE_SIGNING_IDENTITY`
3. Package it into a .dmg
4. Submit the .dmg to Apple's notary service
5. Wait for notarization (usually 2-10 minutes)
6. Staple the notarization ticket to the .dmg
7. Upload the signed + notarized .dmg to the GitHub Release

## Verifying the signed build

After the release lands, download the .dmg and run:

```bash
# Verify signature
codesign -dv --verbose=4 /Applications/nuclei.app

# Verify notarization
spctl -a -vvv -t install /Applications/nuclei.app
```

You should see `source=Notarized Developer ID` for a successful notarization.

## Troubleshooting

**"No identity found"** — The keychain didn't import the cert. Check the `APPLE_CERTIFICATE` secret is the base64 of the .p12 file (no line breaks, no extra whitespace).

**"Certificate expired"** — Developer ID certs last 5 years. Generate a new one and re-export.

**Notarization fails with "Invalid credentials"** — You used your real Apple ID password instead of an app-specific one. Generate an app-specific password at appleid.apple.com.

**Notarization fails with "The signature does not include a secure timestamp"** — Tauri handles this automatically; if you see it, the signing command is misconfigured. Re-check the workflow env vars.

**Notarization hangs** — Apple's notary service can occasionally be slow. Check [developer.apple.com/system-status](https://developer.apple.com/system-status).
