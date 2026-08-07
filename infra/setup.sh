#!/usr/bin/env bash
# One-shot GCP provisioning for RingBack.
# Prereqs: gcloud authenticated, billing enabled on the project.
# Usage: PROJECT_ID=my-project REGION=us-central1 ./infra/setup.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project)}"
REGION="${REGION:-us-central1}"
SERVICE="ringback-app"
SCHEDULER_SA="scheduler-invoker@${PROJECT_ID}.iam.gserviceaccount.com"

echo "== RingBack GCP setup: project=${PROJECT_ID} region=${REGION}"

echo "== 1/6 Enabling APIs"
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  bigquery.googleapis.com \
  logging.googleapis.com \
  --project "${PROJECT_ID}"

echo "== 2/6 Firestore (native mode)"
gcloud firestore databases create --location="${REGION}" --project "${PROJECT_ID}" 2>/dev/null \
  || echo "   Firestore database already exists — OK"

echo "== 2b/6 Firestore composite indexes (REQUIRED — the SMS path fails without them)"
create_index() { gcloud firestore indexes composite create --collection-group="$1" --query-scope=COLLECTION "${@:2}" --project "${PROJECT_ID}" --quiet 2>/dev/null || echo "   index on $1 exists or is building — OK"; }
create_index appointments --field-config field-path=status,order=ascending --field-config field-path=startsAt,order=ascending
create_index sms_out --field-config field-path=tenantId,order=ascending --field-config field-path=createdAt,order=ascending
create_index agent_runs --field-config field-path=status,order=ascending --field-config field-path=startedAt,order=descending
create_index agent_runs --field-config field-path=trigger.detail,order=ascending --field-config field-path=startedAt,order=ascending
create_index tenants --field-config field-path=ownerEmail,order=ascending --field-config field-path=createdAt,order=descending
create_index prospects --field-config field-path=status,order=ascending --field-config field-path=createdAt,order=descending
echo "   (canonical list also in firestore.indexes.json for firebase-cli users)"

echo "== 3/6 Secrets (creates empty secrets; add values with 'gcloud secrets versions add')"
for s in GEMINI_API_KEY TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_MESSAGING_SERVICE_SID \
         STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET SENDGRID_API_KEY SESSION_SECRET PLACES_API_KEY; do
  gcloud secrets create "$s" --replication-policy=automatic --project "${PROJECT_ID}" 2>/dev/null \
    || echo "   secret $s exists — OK"
done

echo "== 4/6 Scheduler service account"
gcloud iam service-accounts create scheduler-invoker \
  --display-name "Cloud Scheduler → RingBack agents" --project "${PROJECT_ID}" 2>/dev/null \
  || echo "   SA exists — OK"

echo "== 5/6 BigQuery log sink (agent evidence, no message bodies)"
bq --project_id="${PROJECT_ID}" mk --dataset "${PROJECT_ID}:ringback_logs" 2>/dev/null || echo "   dataset exists — OK"
gcloud logging sinks create ringback-to-bq \
  "bigquery.googleapis.com/projects/${PROJECT_ID}/datasets/ringback_logs" \
  --log-filter='resource.type="cloud_run_revision" resource.labels.service_name="'"${SERVICE}"'"' \
  --project "${PROJECT_ID}" 2>/dev/null || echo "   sink exists — OK"

echo "== 6/6 Cloud Scheduler jobs (created after first deploy; needs APP_URL)"
APP_URL="${APP_URL:-}"
if [[ -z "${APP_URL}" ]]; then
  echo "   APP_URL not set — deploy first, then re-run: APP_URL=https://... ./infra/setup.sh"
else
  create_job() { # name schedule path
    gcloud scheduler jobs create http "$1" \
      --schedule="$2" --uri="${APP_URL}$3" --http-method=POST \
      --oidc-service-account-email="${SCHEDULER_SA}" \
      --oidc-token-audience="${APP_URL}" \
      --location="${REGION}" --project "${PROJECT_ID}" 2>/dev/null \
      || gcloud scheduler jobs update http "$1" \
      --schedule="$2" --uri="${APP_URL}$3" --http-method=POST \
      --oidc-service-account-email="${SCHEDULER_SA}" \
      --oidc-token-audience="${APP_URL}" \
      --location="${REGION}" --project "${PROJECT_ID}"
  }
  create_job watchdog-15min     "*/15 * * * *" /agents/watchdog
  create_job qa-nightly         "0 9 * * *"    /agents/qa
  create_job prospector-daily   "0 13 * * 1-5" /agents/prospector
  create_job cfo-weekly         "0 15 * * 1"   /agents/cfo
  create_job onboarding-checkin "0 16 * * *"   /agents/onboarding
  # Cloud Run: allow the scheduler SA to invoke
  gcloud run services add-iam-policy-binding "${SERVICE}" \
    --member="serviceAccount:${SCHEDULER_SA}" --role="roles/run.invoker" \
    --region="${REGION}" --project "${PROJECT_ID}" || true
fi

cat <<EOF

Done. Next steps:
  1. Add secret values:  echo -n 'VALUE' | gcloud secrets versions add GEMINI_API_KEY --data-file=-
  2. Deploy:             ./infra/deploy.sh
  3. Re-run this script with APP_URL=<cloud run url> to create scheduler jobs.
EOF
