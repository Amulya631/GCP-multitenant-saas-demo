# 🏢 GCP Multi-Tenant SaaS Demo

A production-grade multi-tenant SaaS platform built on Google Cloud Platform, demonstrating tenant isolation, per-tenant encryption, JWT-based authentication, and quota enforcement using **Cloud Run**, **Firebase Identity Platform**, **Firestore**, and **Cloud KMS**.

---

## 🏗️ Architecture Overview

```
User (Tenant A / Tenant B)
        │
        ▼
Firebase Identity Platform
(Multi-tenancy enabled)
        │
        ▼ JWT with tenant ID
Cloud Run — saas-app
  ├── verifyJWT middleware   ← validates Firebase JWT via JWKS
  ├── checkQuota middleware  ← 100 req/min per tenant
  └── Tenant-scoped routing ← /tenants/{tenantId}/data
        │
        ▼
Firestore (Security Rules)
  └── /tenants/{tenantId}/data/{docId}
        │
        ▼
Cloud KMS (per-tenant key)
  ├── tenant-acme-key
  └── tenant-beta-key
```

---

## 🚀 Features

| Feature | Implementation |
|---|---|
| Multi-tenancy | Firebase Identity Platform with tenant namespaces |
| JWT Verification | Firebase JWKS endpoint (`securetoken@system.gserviceaccount.com`) |
| Tenant Isolation | Firestore rules scoped to `request.auth.token.firebase.tenant` |
| Quota Enforcement | 100 requests/min per tenant (in-memory, single Cloud Run instance) |
| Per-Tenant Encryption | Cloud KMS CMEK with 90-day auto-rotation |
| Containerization | Docker + Artifact Registry |
| Deployment | Google Cloud Run (serverless) |

---

## 🧩 Tech Stack

- **Google Cloud Run** — serverless container hosting
- **Firebase Identity Platform** — multi-tenant authentication
- **Cloud Firestore** — tenant-isolated NoSQL database
- **Cloud KMS** — customer-managed encryption keys (CMEK)
- **Artifact Registry** — Docker image storage
- **Cloud Build** — CI/CD container builds
- **Node.js + Express** — application runtime

---

## 📁 Project Structure

```
saas-app/
├── app.js          # Main app — JWT verification, quota, tenant routing
├── Dockerfile      # Container definition
├── package.json    # Node.js dependencies
└── .gitignore      # Excludes node_modules, .env, keys
```

---

## ⚙️ Setup & Deployment

### Prerequisites
- Google Cloud project with billing enabled
- `gcloud` CLI authenticated
- `jq` installed in your shell

### 1. Set environment variables
```bash
export PROJECT_ID=your-gcp-project-id
export REGION=us-central1
```

### 2. Enable required APIs
```bash
gcloud services enable \
  identitytoolkit.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudkms.googleapis.com \
  firestore.googleapis.com \
  --project=$PROJECT_ID
```

### 3. Enable multi-tenancy
```bash
ACCESS_TOKEN=$(gcloud auth print-access-token)

curl -X PATCH \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT_ID/config?updateMask=multiTenant" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Goog-User-Project: $PROJECT_ID" \
  -d '{"multiTenant":{"allowTenants":true}}'
```

### 4. Create tenants
```bash
# Acme Corp
curl -X POST \
  "https://identitytoolkit.googleapis.com/v2/projects/$PROJECT_ID/tenants" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Goog-User-Project: $PROJECT_ID" \
  -d '{"displayName":"Acme-Corp","allowPasswordSignup":true}'

# Beta Inc
curl -X POST \
  "https://identitytoolkit.googleapis.com/v2/projects/$PROJECT_ID/tenants" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Goog-User-Project: $PROJECT_ID" \
  -d '{"displayName":"Beta-Inc","allowPasswordSignup":true}'
```

### 5. Build and deploy
```bash
# Create Artifact Registry repo
gcloud artifacts repositories create saas-repo \
  --repository-format=docker \
  --location=$REGION

# Build and push image
gcloud builds submit \
  --tag $REGION-docker.pkg.dev/$PROJECT_ID/saas-repo/saas-app:v1

# Deploy to Cloud Run
gcloud run deploy saas-app \
  --image $REGION-docker.pkg.dev/$PROJECT_ID/saas-repo/saas-app:v1 \
  --region=$REGION \
  --allow-unauthenticated \
  --max-instances=1 \
  --set-env-vars PROJECT_ID=$PROJECT_ID
```

### 6. Set up Cloud KMS (per-tenant encryption)
```bash
gcloud kms keyrings create saas-keyring --location=$REGION

gcloud kms keys create tenant-acme-key \
  --keyring=saas-keyring \
  --location=$REGION \
  --purpose=encryption \
  --rotation-period=90d

gcloud kms keys create tenant-beta-key \
  --keyring=saas-keyring \
  --location=$REGION \
  --purpose=encryption \
  --rotation-period=90d
```

---

## 🔒 Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /tenants/{tenantId}/{document=**} {
      allow read, write: if request.auth != null
        && request.auth.token.firebase.tenant == tenantId;
    }
  }
}
```

---

## 🧪 Testing Isolation

```bash
# Get API key
export API_KEY=your-firebase-api-key
export ACME_TENANT_ID=your-acme-tenant-id

# Create test user
curl -X POST \
  "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"user@acme.com\",\"password\":\"test123\",\"returnSecureToken\":true,\"tenantId\":\"$ACME_TENANT_ID\"}"

# Get token
export ACME_TOKEN=$(curl -sX POST \
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"user@acme.com\",\"password\":\"test123\",\"returnSecureToken\":true,\"tenantId\":\"$ACME_TENANT_ID\"}" \
  | jq -r '.idToken')

# Test — should return tenant-scoped response
curl -H "Authorization: Bearer $ACME_TOKEN" https://your-cloud-run-url/

# Quota test — 101st request returns 429
for i in $(seq 1 110); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $ACME_TOKEN" \
    https://your-cloud-run-url/)
  echo "Request $i: $STATUS"
done
```

### Expected Results
```
Request 1-100:  200 ✅ allowed
Request 101-110: 429 🚫 quota exceeded
```

---

## ⚠️ Notes

- **Apigee X** was part of the original design for JWT validation and quota policies but requires a paid GCP account. Both features are implemented directly in `app.js` as a free-tier equivalent.
- **Quota** is in-memory per Cloud Run instance. For production, use Redis or Firestore-backed quota tracking.
- **`--max-instances=1`** is set for quota demo purposes only. Remove for production scaling.

---

## 📄 License

MIT
