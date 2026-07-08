# Ottertest 🦦

An open-source, self-hosted alternative to [Otter.ai](https://otter.ai) that runs
entirely in **your own AWS account**. Record a meeting in your browser, and
Ottertest automatically:

1. **Stores** the audio securely in an S3 storage bucket
2. **Transcribes** it with Amazon Transcribe (speaker-labelled)
3. *(optional)* **Summarizes** it with Amazon Bedrock (Claude) — TL;DR, key
   points, and decisions
4. *(optional)* **Extracts action items**, highlighting the ones assigned **to you**

> **AI summaries are optional and OFF by default.** Out of the box the app
> records to S3 and transcribes with Amazon Transcribe — no Bedrock access
> required. Flip on summaries whenever you're ready with
> `BEDROCK_ENABLED=true npm run deploy` (see below).

Everything — code, infrastructure, and data — lives in your GitHub repo and your
AWS account.

**📱 Installable app (PWA).** Open the site on your phone or desktop and choose
*Add to Home Screen* / *Install* — it runs full-screen like a native app.

**🌍 Multi-language.** Transcription auto-detects the spoken language (Hindi,
Spanish, French, German, and many more), and summaries come back in that same
language. Force one with the `DEEPGRAM_LANGUAGE` env var (e.g. `hi`, `es`, or
`multi` for code-switching on `nova-3`).

---

## Architecture

```
 Browser (React)                  AWS (your account)
┌────────────────┐   presigned   ┌──────────────────────────────────────────┐
│  Record audio  │──── PUT ──────▶│  S3  audio/{userId}/{meetingId}.webm     │
│  (MediaRecorder)│               │        │ (ObjectCreated event)           │
│                │                │        ▼                                 │
│  Sign in       │  Cognito JWT   │  Lambda: startTranscription              │
│  (Cognito)     │◀──────────────▶│        │  Amazon Transcribe job          │
│                │                │        ▼ (job state → EventBridge)       │
│  View meetings │   HTTP API     │  Lambda: processTranscript               │
│  summaries &   │◀──────────────▶│        │  Amazon Bedrock (Claude)        │
│  action items  │  (API Gateway) │        ▼                                 │
└────────────────┘                │  DynamoDB  meetings table                │
                                  └──────────────────────────────────────────┘
```

### Data & processing flow

| Step | Trigger | Service | Result |
|------|---------|---------|--------|
| 1. Upload | User clicks *Stop* | Browser → S3 (presigned PUT) | `audio/{userId}/{meetingId}.webm` |
| 2. Transcribe | S3 `ObjectCreated` | `startTranscription` Lambda → Amazon Transcribe | `transcripts/{meetingId}.json` |
| 3. Store transcript | Transcribe job `COMPLETED` (EventBridge) | `processTranscript` Lambda | transcript saved to DynamoDB |
| 3b. Summarize *(optional)* | same, when `BEDROCK_ENABLED=true` | `processTranscript` Lambda → Amazon Bedrock | summary + action items in DynamoDB |
| 4. Read | User opens app | React → HTTP API → DynamoDB | rendered meeting page |

---

## Tech choices (and how to change them)

| Concern | Choice | Where to change |
|---------|--------|-----------------|
| Infrastructure | **AWS CDK** (TypeScript) | `infra/lib/ottertest-stack.ts` |
| Audio + transcript storage | **S3** (private, encrypted, versioned) | `infra/lib/ottertest-stack.ts` |
| Speech-to-text | **Deepgram** (Nova-2, speaker-labelled) — cheap + fast, needs a `DEEPGRAM_API_KEY` | `infra/lambda/transcribeMeeting.ts` |
| Summaries / actions | **Groq (Llama)** — *optional; on when `GROQ_API_KEY` is set* | `GROQ_API_KEY` / `GROQ_LLM_MODEL` env vars |
| Auth | **Amazon Cognito** | `infra/lib/ottertest-stack.ts` |
| Metadata | **DynamoDB** | `infra/lib/ottertest-stack.ts` |
| Frontend | **React + Vite** | `frontend/` |

These defaults keep 100% of your data inside your AWS account. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) to swap any of them.

---

## Quick start

> Prerequisites: an AWS account, AWS CLI configured (`aws configure`),
> Node.js 20+, and a **Deepgram API key** (from <https://console.deepgram.com>)
> for transcription — set it as `DEEPGRAM_API_KEY` (GitHub secret, or `export`
> before `cdk deploy`). **No Bedrock access needed** unless you turn on AI
> summaries.

```bash
# 1. Deploy the backend + infrastructure
cd infra
npm install
npm run bootstrap        # one-time per account/region
npm run deploy           # provisions the S3 storage bucket, DynamoDB, Lambda, Cognito, API Gateway

# The deploy prints outputs: ApiUrl, UserPoolId, UserPoolClientId, Region, MediaBucketName,
#                            SiteBucketName, DistributionId, SiteUrl (CloudFront web app)

# Later, to enable AI summaries + action items (needs Bedrock model access):
#   BEDROCK_ENABLED=true npm run deploy

# 2. Configure and run the frontend
cd ../frontend
cp .env.example .env      # paste the CDK outputs into this file
npm install
npm run dev               # http://localhost:5173
```

Full walkthrough (including production hosting on S3 + CloudFront) is in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

### Or deploy straight from GitHub (no local AWS setup)

Prefer not to run anything locally? Ottertest ships a **GitHub Actions deploy
workflow** that provisions the stack via **AWS OIDC** — no long-lived keys stored
anywhere. You create one IAM role from the included CloudFormation template, add
its ARN as a repo variable, then click **Actions → Deploy to AWS → Run
workflow**. The run deploys the backend **and** the frontend (S3 + CloudFront),
smoke-tests the live API, and prints your **live app URL** in the run summary —
no local tooling required. Step-by-step:
[`docs/AWS_OIDC_SETUP.md`](docs/AWS_OIDC_SETUP.md).

---

## Repository layout

```
Ottertest/
├── infra/                 # AWS CDK app — all cloud resources
│   ├── bin/app.ts
│   ├── lib/ottertest-stack.ts
│   └── lambda/            # Lambda handler source (bundled by CDK)
│       ├── createUploadUrl.ts
│       ├── startTranscription.ts
│       ├── processTranscript.ts
│       ├── listMeetings.ts
│       ├── getMeeting.ts
│       ├── deleteMeeting.ts
│       └── shared/        # dynamo, bedrock, http helpers, types
├── frontend/              # React + Vite web app
│   └── src/
│       ├── components/    # Recorder, MeetingList, MeetingDetail, ...
│       └── lib/           # auth (Cognito) + api client
└── docs/DEPLOYMENT.md
```

---

## Estimated cost

Ottertest is serverless and pay-per-use — idle cost is ~\$0. A rough estimate for
**20 one-hour meetings/month**:

| Service | Approx. monthly |
|---------|-----------------|
| Amazon Transcribe (~20 hrs @ \$0.024/min) | ~\$29 |
| Amazon Bedrock (Claude, ~20 summaries) | ~\$1–3 |
| S3 + DynamoDB + Lambda + API Gateway | < \$1 |

Prices vary by region — check current AWS pricing. Delete the stack anytime with
`cd infra && npm run destroy`.

---

## Security notes

- Audio is stored in a **private, encrypted** S3 bucket (no public access).
- API endpoints are protected by a **Cognito JWT authorizer** — users only ever
  see their own meetings (partitioned by `userId` in DynamoDB).
- Presigned upload URLs are short-lived and scoped to a single object key.
- No secrets are committed — the frontend only needs public Cognito IDs.

## License

MIT — see [`LICENSE`](LICENSE).
