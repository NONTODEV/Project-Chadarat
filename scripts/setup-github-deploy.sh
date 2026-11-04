#!/usr/bin/env bash
# ตั้งค่าครั้งเดียวให้ GitHub Actions deploy ขึ้น Firebase ได้เองโดยไม่ต้องมีไฟล์กุญแจ
# วิธีใช้: เปิด Cloud Shell (ไอคอน >_ มุมขวาบนของ console.cloud.google.com) ด้วยบัญชีเจ้าของ
# โปรเจกต์ project-chadarat แล้ววางทั้งไฟล์นี้ลงไปรัน (รันซ้ำได้ ส่วนที่มีอยู่แล้วจะข้ามไป)
set -u

PROJECT=project-chadarat
PROJECT_NUMBER=144996454439
REPO=NONTODEV/Project-Chadarat
SA_NAME=github-deploy
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
POOL=github
PROVIDER=github-repo

gcloud config set project "$PROJECT"

echo "== เปิด API ที่ต้องใช้"
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  firebasehosting.googleapis.com firebaserules.googleapis.com

echo "== สร้าง service account สำหรับ deploy"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SA_NAME" --display-name="GitHub Actions deploy"

echo "== ให้สิทธิ์เฉพาะที่ deploy ต้องใช้ (hosting + firestore rules)"
for ROLE in roles/firebasehosting.admin roles/firebaserules.admin roles/serviceusage.serviceUsageConsumer roles/firebase.viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$SA" --role="$ROLE" --condition=None --quiet >/dev/null
done

echo "== สร้าง Workload Identity Pool/Provider ที่เชื่อถือเฉพาะ repo $REPO"
gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL" --display-name="Project-Chadarat repo" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='$REPO'"

echo "== อนุญาตให้ workflow ของ repo นี้ใช้ service account"
gcloud iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO" \
  --quiet >/dev/null

echo
echo "เสร็จแล้ว ✅ กลับไปบอก Claude ให้รัน deploy ได้เลย"
