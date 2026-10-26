#!/usr/bin/env bash
#
# Adds the Celestia Inn booking secrets to Vercel.
#
# Values are read straight from your keyboard into Vercel. They are never
# echoed to the screen, never written to a file, and never stored in shell
# history. Press Enter on any prompt to skip that one.
#
#   ./setup-secrets.sh
#
set -uo pipefail

command -v vercel >/dev/null || { echo "Vercel CLI not found. Run: npm i -g vercel"; exit 1; }

push() {
  local name="$1" value="$2" ok=1
  for env in production preview development; do
    # Replace any existing value so re-running this script is safe.
    vercel env rm "$name" "$env" --yes >/dev/null 2>&1
    printf '%s' "$value" | vercel env add "$name" "$env" >/dev/null 2>&1 || ok=0
  done
  [ "$ok" = 1 ] && echo "  ✓ $name set for production, preview, development" \
                || echo "  ✗ $name failed — check 'vercel whoami' and your project link"
}

ask() {
  local name="$1" hint="$2" expect="$3" value
  echo
  echo "$name"
  echo "  $hint"
  printf '  paste value (hidden, Enter to skip): '
  read -rs value
  echo
  [ -z "$value" ] && { echo "  — skipped"; return; }
  if [ -n "$expect" ] && [[ "$value" != $expect ]]; then
    printf '  ⚠️  that does not look like the expected format. use it anyway? [y/N] '
    read -r confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { echo "  — skipped"; return; }
  fi
  push "$name" "$value"
}

echo "Celestia Inn — booking secrets"
echo "=============================="

ask SUPABASE_SERVICE_ROLE_KEY \
    "Supabase → Project Settings → API Keys → service_role (starts with 'eyJ' or 'sb_secret_')" \
    ""

ask RAZORPAY_KEY_ID \
    "Razorpay → Account & Settings → API Keys (starts with 'rzp_')" \
    "rzp_*"

ask RAZORPAY_KEY_SECRET \
    "Razorpay → shown ONCE when the key is generated" \
    ""

ask RAZORPAY_WEBHOOK_SECRET \
    "Razorpay → Settings → Webhooks → the secret you chose when adding the webhook" \
    ""

echo
echo "Optional — guest confirmation emails (Enter twice to skip both):"
ask RESEND_API_KEY "resend.com → API Keys (starts with 're_')" "re_*"
ask BOOKING_FROM_EMAIL "e.g. bookings@celestiainn.in — must be a domain verified in Resend" ""

echo
echo "Current variables:"
vercel env ls 2>/dev/null | sed -n '/name/,/^$/p'
echo
echo "Next: redeploy so the functions pick these up →  vercel --prod"
