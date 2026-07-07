# Deploying Ottertest

This guide walks you from an empty AWS account to a working Ottertest instance.

## 1. Prerequisites

| Requirement | Notes |
|-------------|-------|
| AWS account | You'll deploy into your own account, so all data stays with you. |
| AWS CLI | Installed and configured (`aws configure`) with credentials that can create IAM roles, S3, DynamoDB, Lambda, Cognito, API Gateway, and EventBridge resources. |
| Node.js 20+ | For both the CDK app and the frontend. |
| Bedrock model access | **Optional.** Only needed if you enable AI summaries (`BEDROCK_ENABLED=true`). In the AWS console → **Bedrock → Model access**, enable a Claude model in your target region (e.g. *Claude 3.5 Sonnet*). |

> **Region choice.** Deploy in a region where **both** Amazon Transcribe and your
> chosen Bedrock model are available — e.g. `us-east-1`, `us-west-2`, or
> `eu-west-1`. Set it with `export AWS_REGION=us-east-1` (or `CDK_DEFAULT_REGION`).

## 2. Deploy the backend (AWS CDK)

```bash
cd infra
npm install

# One-time per account+region: prepares the CDK deployment bucket/roles.
npm run bootstrap

# Provision everything.
npm run deploy
```

When it finishes, CDK prints the outputs you need:

```
OttertestStack.ApiUrl            = https://abc123.execute-api.us-east-1.amazonaws.com
OttertestStack.UserPoolId        = us-east-1_ABC123
OttertestStack.UserPoolClientId  = 1a2b3c4d5e6f7g8h9i0j
OttertestStack.Region            = us-east-1
OttertestStack.MediaBucket       = otterteststack-mediabucketXXXX
OttertestStack.BedrockModelId    = anthropic.claude-3-5-sonnet-20240620-v1:0
```

### Enabling AI summaries (optional)

Summaries and action items are **off by default** — the app records to S3 and
transcribes without needing Bedrock. When you're ready, enable Bedrock model
access (see prerequisites) and redeploy with the flag on:

```bash
BEDROCK_ENABLED=true npm run deploy
```

New meetings recorded after this will get an AI summary and action items.
(Existing meetings keep whatever they had; re-record or re-run the pipeline to
backfill.)

#### Choosing / overriding the Bedrock model

Some models are only reachable through a **cross-region inference profile**. If
`InvokeModel` fails with an on-demand throughput error, deploy with a profile ID:

```bash
BEDROCK_ENABLED=true BEDROCK_MODEL_ID="us.anthropic.claude-3-5-sonnet-20241022-v2:0" npm run deploy
```

(The `us.` prefix denotes a US inference profile. Pick the one that matches your
region — `eu.`, `apac.`, etc.)

## 3. Run the frontend

```bash
cd ../frontend
cp .env.example .env
```

Edit `.env` with the CDK outputs:

```
VITE_AWS_REGION=us-east-1
VITE_API_URL=https://abc123.execute-api.us-east-1.amazonaws.com
VITE_USER_POOL_ID=us-east-1_ABC123
VITE_USER_POOL_CLIENT_ID=1a2b3c4d5e6f7g8h9i0j
```

Then:

```bash
npm install
npm run dev        # http://localhost:5173
```

Sign up with your email, confirm the code Cognito emails you, and record your
first meeting. Recording requires **HTTPS or localhost** (browser mic policy) —
`localhost` is fine for dev.

## 4. Host the frontend on AWS

The CDK stack already provisions the hosting infrastructure: a **private S3
bucket behind a CloudFront distribution** (HTTPS + CDN). `npm run deploy` prints
`SiteBucketName`, `DistributionId`, and `SiteUrl`. You just need to build the
site and upload it:

```bash
cd frontend
# .env must contain the CDK outputs (as in step 3)
npm run build                        # → frontend/dist/

# Upload and cache-bust (uses your AWS CLI credentials):
aws s3 sync dist "s3://<SiteBucketName>" --delete \
  --exclude index.html --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html "s3://<SiteBucketName>/index.html" --cache-control "no-cache"
aws cloudfront create-invalidation --distribution-id <DistributionId> --paths "/*"
```

Then open the **`SiteUrl`**. (First deploy: CloudFront takes a few minutes to
propagate.)

> **Prefer zero local steps?** The **GitHub Actions deploy workflow does all of
> the above automatically** — deploy backend, build the site, publish to
> CloudFront, and print the live URL. See
> [`AWS_OIDC_SETUP.md`](AWS_OIDC_SETUP.md).

For a locked-down setup, tighten the two `allowOrigins: ["*"]` values in the
stack (S3 CORS and API Gateway CORS) to your `SiteUrl`, and redeploy.

## 5. Tearing it down

```bash
cd infra
npm run destroy
```

The S3 bucket, DynamoDB table, and Cognito user pool use a **RETAIN** removal
policy, so your recordings and accounts survive a stack delete. Empty/delete them
manually in the console if you truly want everything gone.

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Summary never appears, status stuck at `SUMMARIZING` | Bedrock model access not enabled, or wrong model/region. Check the `ProcessTranscriptFn` CloudWatch logs. Try a `BEDROCK_MODEL_ID` inference profile. |
| Status stuck at `TRANSCRIBING` | Check `StartTranscriptionFn` and the Transcribe console. Very short/empty audio can fail. |
| Mic button does nothing | The browser blocks `getUserMedia` on insecure origins — use `localhost` or HTTPS. |
| `401` from the API | Token expired or `.env` IDs don't match the deployed pool. Re-check the CDK outputs. |
| CORS errors in the browser | Confirm `VITE_API_URL` has no trailing slash and matches the deployed API. |

## Where processing happens

```
createUploadUrl  (POST /uploads)     → reserves meeting, returns presigned S3 URL
startTranscription (S3 event)         → Amazon Transcribe job
processTranscript  (EventBridge)      → reads transcript, Amazon Bedrock summary
listMeetings / getMeeting / delete    → read/manage from DynamoDB
```

All Lambda source lives in `infra/lambda/` and is bundled automatically by CDK on
`npm run deploy`.
