#!/usr/bin/env bash
# Build + deploy RingBack to Cloud Run.
# Usage: PROJECT_ID=my-project REGION=us-central1 APP_BASE_URL=https://... ./infra/deploy.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project)}"
REGION="${REGION:-us-central1}"
SERVICE="ringback-app"

echo "== Building container via Cloud Build"
gcloud builds submit --tag "gcr.io/${PROJECT_ID}/${SERVICE}" --project "${PROJECT_ID}" .

# Mount ONLY secrets that actually hold a value. Cloud Run refuses to start a
# revision that references a secret with no versions, and the app treats
# Twilio/Stripe/SendGrid as optional integrations that fail closed when absent —
# so a partially-configured project still deploys and serves.
ALL_SECRETS=(GEMINI_API_KEY TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_MESSAGING_SERVICE_SID
             STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET SENDGRID_API_KEY SESSION_SECRET PLACES_API_KEY)
SECRETS=""
echo "== Selecting secrets that have values"
for s in "${ALL_SECRETS[@]}"; do
  if gcloud secrets versions list "$s" --project "${PROJECT_ID}" \
       --filter='state=ENABLED' --format='value(name)' 2>/dev/null | grep -q .; then
    [ -n "${SECRETS}" ] && SECRETS+=","
    SECRETS+="$s=$s:latest"
    echo "   mount   $s"
  else
    echo "   skip    $s (no value — that integration stays disabled)"
  fi
done
if [ -z "${SECRETS}" ]; then
  echo "ERROR: no secrets have values. At minimum set GEMINI_API_KEY and SESSION_SECRET." >&2
  exit 1
fi

echo "== Deploying to Cloud Run"
gcloud run deploy "${SERVICE}" \
  --image "gcr.io/${PROJECT_ID}/${SERVICE}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --allow-unauthenticated \
  --cpu-boost \
  --no-cpu-throttling \
  --min-instances=0 \
  --max-instances=3 \
  --memory=512Mi \
  --set-env-vars "NODE_ENV=production,STORE=firestore,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},APP_BASE_URL=${APP_BASE_URL:-https://placeholder.run.app},FOUNDER_EMAIL=${FOUNDER_EMAIL:-},FOUNDER_PHONE=${FOUNDER_PHONE:-},EMAIL_FROM=${EMAIL_FROM:-}" \
  --set-secrets "${SECRETS}"

echo "== Deployed. If this was the first deploy, set APP_BASE_URL to the service URL and redeploy, then create scheduler jobs via setup.sh"
gcloud run services describe "${SERVICE}" --region "${REGION}" --project "${PROJECT_ID}" --format='value(status.url)'
