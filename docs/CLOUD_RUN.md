# ☁️ Deploying Squarespace MCP to Google Cloud Run

> **A quick, beginner-friendly guide to hosting your Squarespace MCP server on Google Cloud Run for Gemini Spark and web-based AI assistants.**

---

## 🎯 Why Deploy to Cloud Run?

If you use **Gemini Spark** on the web ([gemini.google.com](https://gemini.google.com)), Google's cloud servers need a secure public HTTPS address to communicate with your Squarespace store. Unlike desktop apps (like Claude Desktop or Cursor), web-based AI cannot run commands on your personal computer.

Deploying to **Google Cloud Run** gives you:

- 🌐 **A dedicated, secure HTTPS web address** for Gemini Spark.
- 💰 **Near-zero cost**: Cloud Run scales to zero when not in use. For typical personal or small business store usage, it usually stays comfortably within [Google Cloud's Free Tier](https://cloud.google.com/free).
- 🛡️ **Enterprise-grade security**: Credentials are encrypted with AES-256-GCM tokens. Your Squarespace key is never stored in a database and never logged.
- ⚡ **Zero server maintenance**: Fully managed by Google—no virtual machines to patch or update.

---

## 🧭 How It Works

```text
1. Gemini Spark                2. Cloud Run Service                 3. Squarespace API
   (Google Web App)               (squarespace-mcp)
          │                              │                                  │
          ├── Connects via HTTPS ───────>│                                  │
          │   (OAuth 2.1 Discovery)      │                                  │
          │                              │                                  │
          │<── Opens Login Screen ───────┤ (You enter Squarespace API key)  │
          │                              ├── Verifies key directly ────────>│
          │                              │<── Confirms store access ────────┤
          │<── Grants Encrypted Token ───┤                                  │
          │                              │                                  │
          ├── "What are recent orders?" ─>│── Queries store securely ───────>│
          │<── Shows order answers ──────│<── Returns live order data ──────┤
```

---

## 📋 Prerequisites Checklist

Before you begin, make sure you have:

1. **A Google Cloud account** with billing enabled ([cloud.google.com](https://cloud.google.com)).
2. **The `gcloud` CLI installed** on your computer ([installation guide](https://cloud.google.com/sdk/docs/install)).
3. **Your Squarespace API Key** (from **Settings** → **Developer Tools** → **Developer API Keys** in your Squarespace dashboard).

---

## 🚀 Quick Step-by-Step Deployment (5 Minutes)

### Step 1: Initialize Your Google Cloud Environment

Open your terminal and set your Google Cloud project variables:

```bash
# Replace with your actual Google Cloud project ID
export PROJECT_ID="your-project-id"
export REGION="us-central1"
export SERVICE="squarespace-mcp"

# Set your active project
gcloud config set project "$PROJECT_ID"

# Enable required Google Cloud services (takes ~30 seconds)
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com
```

---

### Step 2: Store Your Token Secret Safely

Squarespace MCP uses an encryption key (`MCP_TOKEN_SECRET`) to protect session tokens. We store this key securely in Google Secret Manager:

```bash
# 1. Generate a random 32-character secret and store it in Secret Manager
openssl rand -base64 32 | \
  gcloud secrets create squarespace-mcp-token-secret \
    --data-file=-

# 2. Allow your Cloud Run service to read this secret
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

gcloud secrets add-iam-policy-binding squarespace-mcp-token-secret \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

---

### Step 3: Deploy to Cloud Run

You can deploy using the official prebuilt container from GitHub Container Registry:

```bash
gcloud run deploy "$SERVICE" \
  --image "ghcr.io/florasync/squarespace-mcp:0.1.0" \
  --region "$REGION" \
  --allow-unauthenticated \
  --port 3000 \
  --cpu 1 \
  --memory 512Mi \
  --min-instances 0 \
  --max-instances 3 \
  --set-env-vars "MCP_PUBLIC_URL=https://placeholder.invalid/mcp,SQUARESPACE_MCP_READ_ONLY=true" \
  --set-secrets "MCP_TOKEN_SECRET=squarespace-mcp-token-secret:latest"
```

> [!NOTE]
> **Why `--allow-unauthenticated`?**
> Cloud Run's outer network layer allows public ingress so Gemini Spark can reach the service. The service itself strictly secures the `/mcp` endpoint with OAuth 2.1 authentication.

---

### Step 4: Link Your Public Service URL

Because Cloud Run assigns a unique HTTPS URL to your service, we now set `MCP_PUBLIC_URL` to match that exact URL:

```bash
# 1. Fetch your assigned Cloud Run HTTPS URL
SERVICE_URL=$(gcloud run services describe "$SERVICE" \
  --region "$REGION" \
  --format='value(status.url)')

echo "Your service is running at: $SERVICE_URL"

# 2. Update the service with its public MCP endpoint
gcloud run services update "$SERVICE" \
  --region "$REGION" \
  --update-env-vars "MCP_PUBLIC_URL=${SERVICE_URL}/mcp"
```

---

### Step 5: Test the Deployment

Verify everything is working with these two quick terminal commands:

```bash
# 1. Check health (should output: OK or 200)
curl -i "$SERVICE_URL/healthz"

# 2. Check OAuth metadata (should return JSON describing the MCP endpoint)
curl -s "$SERVICE_URL/.well-known/oauth-protected-resource/mcp"
```

🎉 **Congratulations! Your server is live and ready to connect!**

---

## 🔗 Step 6: Connect Gemini Spark

Now bring your Squarespace store into Gemini Spark:

1. Open [Gemini](https://gemini.google.com) in your web browser.
2. Click **Settings & help** (gear icon or menu) → **Connected Apps**.
3. Scroll to **Custom apps for Spark** and click **Add custom app** (or **+**).
4. In the URL field, paste your full MCP address:
   ```text
   https://YOUR-SERVICE-URL.run.app/mcp
   ```
5. Click **Connect**. Gemini Spark will discover the server and open the secure FloraSync authorization screen.
6. Paste your **Squarespace API Key** into the box and click **Authorize**.
7. The server verifies your key directly with Squarespace and redirects back to Gemini.

You're done! You can now ask Gemini questions like:

- _"What products do we have in our store?"_
- _"Are any items out of stock?"_
- _"Show me recent orders and customer names."_

---

## 🛡️ Security & Production Highlights

- **Safe Read-Only Default**: By default, the server cannot modify or delete anything. To enable write operations (like creating discounts or updating stock), update the environment variable:
  ```bash
  gcloud run services update "$SERVICE" \
    --region "$REGION" \
    --update-env-vars "SQUARESPACE_MCP_READ_ONLY=false"
  ```
- **Zero Database Storage**: Your Squarespace key is never saved to a database or disk. It exists only in encrypted session tokens and in-memory during active requests.
- **Immediate Global Revocation**: Need to revoke all active sessions immediately? Just rotate the secret in Secret Manager:
  ```bash
  openssl rand -base64 32 | \
    gcloud secrets versions add squarespace-mcp-token-secret --data-file=-
  ```
- **Redacted Error Logs**: The server automatically scrubs credentials from error responses and logs.

---

## ❓ Frequently Asked Questions & Troubleshooting

### How do I update to a newer version of the server?

Simply re-run the `gcloud run deploy` command with the updated image tag:

```bash
gcloud run deploy "$SERVICE" \
  --image "ghcr.io/florasync/squarespace-mcp:latest" \
  --region "$REGION"
```

### Why does the health check return an error?

Ensure your service deployed successfully and that Cloud Run port `3000` is mapped. You can view real-time logs using:

```bash
gcloud run services logs tail "$SERVICE" --region "$REGION"
```

### Can I build from source instead of using the GHCR image?

Yes! If you cloned the repository locally, you can build directly with Cloud Build:

```bash
gcloud artifacts repositories create mcp \
  --repository-format=docker \
  --location="$REGION"

gcloud builds submit \
  --tag "$REGION-docker.pkg.dev/$PROJECT_ID/mcp/squarespace-mcp:0.1.0" .

gcloud run deploy "$SERVICE" \
  --image "$REGION-docker.pkg.dev/$PROJECT_ID/mcp/squarespace-mcp:0.1.0" \
  --region "$REGION"
```

---

## 📚 Helpful Links

- [Squarespace Developer API Keys](https://developers.squarespace.com/commerce-apis/authentication-and-permissions)
- [Google Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Gemini Spark Connected Apps Guide](https://support.google.com/gemini/answer/17209137)
