# Ottertest 🦦

An open-source, self-hosted alternative to [Otter.ai](https://otter.ai) that runs
entirely in **your own AWS account**. Record a meeting in your browser, and
Ottertest automatically:

1. **Stores** the audio securely in S3
2. **Transcribes** it with Amazon Transcribe (speaker-labelled)
3. **Summarizes** it with Amazon Bedrock (Claude) — TL;DR, key points, and
   decisions
4. **Extracts action items**, highlighting the ones assigned **to you**

Everything — code, infrastructure, and data — lives in your GitHub repo and your
AWS account. No third-party SaaS.

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
| 3. Summarize | Transcribe job `COMPLETED` (EventBridge) | `processTranscript` Lambda → Amazon Bedrock | summary + action items in DynamoDB |
| 4. Read | User opens app | React → HTTP API → DynamoDB | rendered meeting page |

---

## Tech choices (and how to change them)

| Concern | Choice | Where to change |
|---------|--------|-----------------|
| Infrastructure | **AWS CDK** (TypeScript) | `infra/lib/ottertest-stack.ts` |
| Speech-to-text | **Amazon Transcribe** | `infra/lambda/startTranscription.ts` |
| Summaries / actions | **Amazon Bedrock (Claude)** | `BEDROCK_MODEL_ID` env var / `infra/lambda/shared/bedrock.ts` |
| Auth | **Amazon Cognito** | `infra/lib/ottertest-stack.ts` |
| Audio storage | **S3** | `infra/lib/ottertest-stack.ts` |
| Metadata | **DynamoDB** | `infra/lib/ottertest-stack.ts` |
| Frontend | **React + Vite** | `frontend/` |

These defaults keep 100% of your data inside your AWS account. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) to swap any of them.

---

## Quick start

> Prerequisites: an AWS account, AWS CLI configured (`aws configure`), Node.js 20+,
> and **Amazon Bedrock model access enabled for Claude** in your region
> (Bedrock console → *Model access*).

```bash
# 1. Deploy the backend + infrastructure
cd infra
npm install
npm run bootstrap        # one-time per account/region
npm run deploy           # provisions S3, DynamoDB, Lambda, Cognito, API Gateway

# The deploy prints outputs: ApiUrl, UserPoolId, UserPoolClientId, Region, AudioBucket

# 2. Configure and run the frontend
cd ../frontend
cp .env.example .env      # paste the CDK outputs into this file
npm install
npm run dev               # http://localhost:5173
```

Full walkthrough (including production hosting on S3 + CloudFront) is in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

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
