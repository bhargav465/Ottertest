#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { OttertestStack } from "../lib/ottertest-stack";

const app = new cdk.App();

new OttertestStack(app, "OttertestStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description:
    "Ottertest — self-hosted meeting recorder, transcriber and summarizer",
});

app.synth();
