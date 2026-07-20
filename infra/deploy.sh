#!/usr/bin/env bash
# Build + deploy RingBack to Cloud Run.
# Usage: PROJECT_ID=my-project REGION=us-central1 APP_BASE_URL=https://... ./infra/deploy.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project)}"
REGION="${REGION:-us-central1}"
SERVICE="ringback-app"

echo "== Building container via Cloud Build"
gcloud builds submit --tag "gcr.io/${PROJECT_ID}/${SERVICE}" --project "${PROJECT_ID}" .

SECRETS="GEMINI_API_KEY=GEMINI_API_KEY:latest"
SECRETS+=",TWILIO_ACCOUNT_SID=TWILIO_ACCOUNT_SID:latest"
SECRETS+=",TWILIO_AUTH_TOKEN=TWILIO_AUTH_TOKEN:latest"
SECRETS+=",TWILIO_MESSAGING_SERVICE_SID=TWILIO_MESSAGING_SERVICE_SID:latest"
SECRETS+=",STRIPE_SECRET_KEY=STRIPE_SECRET_KEY:latest"
SECRETS+=",STRIPE_WEBHOOK_SECRET=STRIPE_WEBHOOK_SECRET:latest"
SECRETS+=",SENDGRID_API_KEY=SENDGRID_API_KEY:latest"
SECRETS+=",SESSION_SECRET=SESSION_SECRET:latest"

echo "== Deploying to Cloud Run"
gcloud run deploy "${SERVICE}" \
  --image "gcr.io/${PROJECT_ID}/${SERVICE}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --allow-unauthenticated \
  --cpu-boost \
  --min-instances=0 \
  --max-instances=3 \
  --memory=512Mi \
  --set-env-vars "NODE_ENV=production,STORE=firestore,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},APP_BASE_URL=${APP_BASE_URL:-https://placeholder.run.app},FOUNDER_EMAIL=${FOUNDER_EMAIL:-},FOUNDER_PHONE=${FOUNDER_PHONE:-},EMAIL_FROM=${EMAIL_FROM:-}" \
  --set-secrets "${SECRETS}"

echo "== Deployed. If this was the first deploy, set APP_BASE_URL to the service URL and redeploy, then create scheduler jobs via setup.sh"
gcloud run services describe "${SERVICE}" --region "${REGION}" --project "${PROJECT_ID}" --format='value(status.url)'
