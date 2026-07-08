# Deploy Ottertest from GitHub Actions (AWS OIDC)

This lets GitHub Actions deploy Ottertest into your AWS account **without storing
any long-lived AWS keys**. GitHub hands AWS a short-lived signed token (OIDC),
AWS trusts it only for *this* repository, and hands back temporary credentials
scoped to a deploy role you create once.

You do **two things once**, then deploy with a button.

---

## Step 1 — Create the deploy role (one time, ~2 min)

The repo ships a CloudFormation template that creates the GitHub OIDC provider
and an IAM role (`ottertest-github-deploy`) trusting only `bhargav465/Ottertest`.

### Option A — AWS Console (no CLI)

1. Open the **CloudFormation** console in the region you want to deploy to.
2. **Create stack → With new resources (standard)**.
3. **Upload a template file** → choose `infra/oidc-bootstrap.template.yaml` from
   this repo.
4. Stack name: `ottertest-oidc`. Leave the defaults
   (`GitHubOrg=bhargav465`, `RepoName=Ottertest`, `CreateOIDCProvider=true`).
   - If you already use GitHub OIDC in this account, set `CreateOIDCProvider`
     to `false`.
5. Check **"I acknowledge that AWS CloudFormation might create IAM resources
   with custom names"**, then **Submit**.
6. When it finishes, open the **Outputs** tab and copy **`DeployRoleArn`**
   (looks like `arn:aws:iam::123456789012:role/ottertest-github-deploy`).

### Option B — AWS CLI

```bash
aws cloudformation deploy \
  --template-file infra/oidc-bootstrap.template.yaml \
  --stack-name ottertest-oidc \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides GitHubOrg=bhargav465 RepoName=Ottertest CreateOIDCProvider=true

aws cloudformation describe-stacks --stack-name ottertest-oidc \
  --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'].OutputValue" --output text
```

> Already have the GitHub OIDC provider? Re-run with
> `CreateOIDCProvider=false`.

---

## Step 2 — Tell GitHub the role ARN (one time)

In the GitHub repo: **Settings → Secrets and variables → Actions → Variables
tab → New repository variable**:

| Name | Value |
|------|-------|
| `AWS_DEPLOY_ROLE_ARN` | the `DeployRoleArn` you copied |

(It's a **variable**, not a secret — a role ARN isn't sensitive.)

---

## Step 2b — Add the Deepgram API key (transcription)

Transcription uses **Deepgram** (Nova-2, with speaker labels) — cheap, fast, and
it avoids AWS service-activation issues. Get a key at
<https://console.deepgram.com> → *API Keys* (free credit to start). Then add it
as a **secret** (not a variable — it's sensitive):

**Settings → Secrets and variables → Actions → Secrets → New repository secret**

| Name | Value |
|------|-------|
| `DEEPGRAM_API_KEY` | your Deepgram API key |

## Step 3 — Deploy

1. Go to the repo's **Actions** tab → **Deploy to AWS** → **Run workflow**.
2. Pick your **region** (must match where you created the role) and whether to
   enable **Bedrock AI summaries** (leave off unless you've enabled Bedrock model
   access).
3. **Run workflow.**

The workflow will:

- assume the role via OIDC (no keys),
- `cdk bootstrap` (idempotent) and `cdk deploy` (backend **and** an S3 +
  CloudFront site),
- **smoke-test the live API** (expects `401` for an unauthenticated request),
- build the frontend with the right config and **publish it to CloudFront**,
- print all stack outputs (`ApiUrl`, `UserPoolId`, `SiteUrl`, …) to the run's
  **Summary**, including the **live web app URL**,
- attach `frontend-dist` as a downloadable artifact.

When it's done, open the **`SiteUrl`** from the run summary — that's your live
app. (First deploy: CloudFront may take a few minutes to propagate.) To enable AI
summaries later, just re-run with **Bedrock** checked (after enabling model
access in the Bedrock console).

---

## Tightening permissions later (optional)

The template attaches `AdministratorAccess` to keep first-time setup painless,
since `cdk bootstrap` + `cdk deploy` legitimately touch many services. Once
you've deployed successfully and want least privilege, replace the
`ManagedPolicyArns` in `infra/oidc-bootstrap.template.yaml` with a custom policy
limited to: CloudFormation, S3, IAM (role create/pass), Lambda, DynamoDB,
Cognito, API Gateway, EventBridge, ECR, SSM, and CloudWatch Logs — then update
the `ottertest-oidc` stack.

## Security properties

- **No static keys.** Nothing sensitive is stored in GitHub; the role is only
  assumable by workflows in `bhargav465/Ottertest` via GitHub's OIDC issuer.
- **Short-lived.** Sessions last at most 1 hour (`MaxSessionDuration`).
- **Scoped trust.** The `sub` condition (`repo:bhargav465/Ottertest:*`) blocks
  other repos/accounts from assuming the role. Narrow it further to a branch,
  e.g. `repo:bhargav465/Ottertest:ref:refs/heads/main`, if you want.
