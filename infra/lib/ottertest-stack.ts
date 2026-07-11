import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwAuth from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as apigwInt from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as path from "path";

export class OttertestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---------------------------------------------------------------------
    // S3 storage bucket — the single source of truth for all media.
    //   audio/{userId}/{meetingId}.{ext}   raw recordings
    //   transcripts/{meetingId}.json       Amazon Transcribe output
    // Private, encrypted, versioned, and RETAINed on stack teardown.
    // ---------------------------------------------------------------------
    const mediaBucket = new s3.Bucket(this, "MediaBucket", {
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // don't delete recordings on stack teardown
      cors: [
        {
          // Allow the browser to PUT audio directly via presigned URLs.
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ["*"], // tighten to your frontend origin in production
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          // Keep costs low: expire raw transcribe output after 90 days.
          prefix: "transcripts/",
          expiration: cdk.Duration.days(90),
        },
      ],
    });

    // ---------------------------------------------------------------------
    // Metadata: DynamoDB. PK = userId, SK = meetingId → users only see own data
    // ---------------------------------------------------------------------
    const meetingsTable = new dynamodb.Table(this, "MeetingsTable", {
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "meetingId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // Global secondary index so a Transcribe callback can find a meeting by its
    // transcription job name without knowing the userId.
    meetingsTable.addGlobalSecondaryIndex({
      indexName: "byMeetingId",
      partitionKey: { name: "meetingId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ---------------------------------------------------------------------
    // Auth: Cognito user pool
    // ---------------------------------------------------------------------
    const userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userPoolClient = userPool.addClient("WebClient", {
      authFlows: { userSrp: true, userPassword: true },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(8),
      idTokenValidity: cdk.Duration.hours(8),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // ---------------------------------------------------------------------
    // Lambda functions
    // ---------------------------------------------------------------------
    const lambdaDir = path.join(__dirname, "..", "lambda");

    const commonEnv = {
      MEDIA_BUCKET: mediaBucket.bucketName,
      MEETINGS_TABLE: meetingsTable.tableName,
      MEETINGS_GSI: "byMeetingId",
      // Transcription via Deepgram (Nova-2 + speaker diarization). Supply
      // DEEPGRAM_API_KEY at deploy (from a GitHub secret). DEEPGRAM_MODEL
      // overrides the default model.
      DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY ?? "",
      // nova-3 keeps speaker diarization working alongside multilingual audio
      // (nova-2 auto-detect collapses everyone onto one speaker).
      DEEPGRAM_MODEL: process.env.DEEPGRAM_MODEL ?? "nova-3",
      // "multi" → nova-3 multilingual code-switching (keeps speaker labels).
      // Or force a code like "en", "hi", "es".
      DEEPGRAM_LANGUAGE: process.env.DEEPGRAM_LANGUAGE ?? "multi",
      // AI summaries + action items via Groq (Llama). Set GROQ_API_KEY (GitHub
      // secret) to enable them; leave unset for transcription-only.
      GROQ_API_KEY: process.env.GROQ_API_KEY ?? "",
      GROQ_LLM_MODEL: process.env.GROQ_LLM_MODEL ?? "llama-3.3-70b-versatile",
    };

    const commonFnProps: Partial<cdk.aws_lambda_nodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      bundling: {
        // The AWS SDK v3 clients are provided by the Node 20 runtime — don't bundle them.
        externalModules: [
          "@aws-sdk/client-s3",
          "@aws-sdk/s3-request-presigner",
          "@aws-sdk/client-dynamodb",
          "@aws-sdk/lib-dynamodb",
        ],
        minify: true,
        sourceMap: true,
        target: "node20",
      },
    };

    const makeFn = (
      name: string,
      entry: string,
      overrides: Partial<cdk.aws_lambda_nodejs.NodejsFunctionProps> = {}
    ) =>
      new NodejsFunction(this, name, {
        ...commonFnProps,
        entry: path.join(lambdaDir, entry),
        handler: "handler",
        environment: { ...commonEnv, ...(overrides.environment ?? {}) },
        ...overrides,
      });

    // -- API handlers --------------------------------------------------------
    const createUploadUrlFn = makeFn("CreateUploadUrlFn", "createUploadUrl.ts");
    const listMeetingsFn = makeFn("ListMeetingsFn", "listMeetings.ts");
    const getMeetingFn = makeFn("GetMeetingFn", "getMeeting.ts");
    const getAudioUrlFn = makeFn("GetAudioUrlFn", "getAudioUrl.ts");
    const updateMeetingFn = makeFn("UpdateMeetingFn", "updateMeeting.ts");
    const deleteMeetingFn = makeFn("DeleteMeetingFn", "deleteMeeting.ts");

    // -- Async pipeline handler --------------------------------------------
    // Single Groq-based Lambda: downloads the audio, transcribes it (Whisper),
    // and (optionally) summarizes it. Groq is synchronous, so there's no
    // separate poll/callback step. Generous timeout for longer recordings.
    const transcribeFn = makeFn("TranscribeFn", "transcribeMeeting.ts", {
      timeout: cdk.Duration.minutes(3),
      memorySize: 1024,
    });

    // ---------------------------------------------------------------------
    // Permissions
    // ---------------------------------------------------------------------
    mediaBucket.grantReadWrite(createUploadUrlFn);
    mediaBucket.grantRead(getMeetingFn);
    mediaBucket.grantRead(getAudioUrlFn);
    mediaBucket.grantRead(transcribeFn);
    mediaBucket.grantDelete(deleteMeetingFn);

    meetingsTable.grantReadWriteData(createUploadUrlFn);
    meetingsTable.grantReadData(listMeetingsFn);
    meetingsTable.grantReadData(getMeetingFn);
    meetingsTable.grantReadData(getAudioUrlFn);
    meetingsTable.grantReadWriteData(updateMeetingFn);
    meetingsTable.grantReadWriteData(deleteMeetingFn);
    meetingsTable.grantReadWriteData(transcribeFn);

    // Summaries run via Groq (external HTTPS) — no extra AWS permissions needed.

    // ---------------------------------------------------------------------
    // Event wiring: new audio object in S3 → transcribe + summarize.
    // ---------------------------------------------------------------------
    mediaBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(transcribeFn),
      { prefix: "audio/" }
    );

    // ---------------------------------------------------------------------
    // HTTP API + Cognito JWT authorizer
    // ---------------------------------------------------------------------
    const authorizer = new apigwAuth.HttpUserPoolAuthorizer(
      "JwtAuthorizer",
      userPool,
      { userPoolClients: [userPoolClient] }
    );

    const httpApi = new apigw.HttpApi(this, "HttpApi", {
      apiName: "ottertest-api",
      corsPreflight: {
        allowHeaders: ["authorization", "content-type"],
        allowMethods: [
          apigw.CorsHttpMethod.GET,
          apigw.CorsHttpMethod.POST,
          apigw.CorsHttpMethod.PATCH,
          apigw.CorsHttpMethod.DELETE,
          apigw.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: ["*"], // tighten to your frontend origin in production
        maxAge: cdk.Duration.days(1),
      },
    });

    const addRoute = (
      method: apigw.HttpMethod,
      route: string,
      fn: lambda.IFunction
    ) => {
      httpApi.addRoutes({
        path: route,
        methods: [method],
        integration: new apigwInt.HttpLambdaIntegration(
          `${fn.node.id}Int`,
          fn
        ),
        authorizer,
      });
    };

    addRoute(apigw.HttpMethod.POST, "/uploads", createUploadUrlFn);
    addRoute(apigw.HttpMethod.GET, "/meetings", listMeetingsFn);
    addRoute(apigw.HttpMethod.GET, "/meetings/{meetingId}", getMeetingFn);
    addRoute(
      apigw.HttpMethod.GET,
      "/meetings/{meetingId}/audio",
      getAudioUrlFn
    );
    addRoute(apigw.HttpMethod.PATCH, "/meetings/{meetingId}", updateMeetingFn);
    addRoute(apigw.HttpMethod.DELETE, "/meetings/{meetingId}", deleteMeetingFn);

    // ---------------------------------------------------------------------
    // Frontend hosting: private S3 bucket behind CloudFront (HTTPS + CDN).
    // The deploy workflow builds the site and syncs it into SiteBucket.
    // ---------------------------------------------------------------------
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Site content is a regenerable build artifact — safe to drop on teardown.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, "SiteDistribution", {
      comment: "Ottertest web app",
      defaultRootObject: "index.html",
      defaultBehavior: {
        // Origin Access Control keeps the bucket private; only CloudFront reads it.
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      // Single-page app: route client-side paths back to index.html.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(10),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(10),
        },
      ],
    });

    // ---------------------------------------------------------------------
    // Outputs (paste these into frontend/.env)
    // ---------------------------------------------------------------------
    new cdk.CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: userPoolClient.userPoolClientId,
    });
    new cdk.CfnOutput(this, "Region", { value: this.region });
    new cdk.CfnOutput(this, "MediaBucketName", {
      value: mediaBucket.bucketName,
    });
    new cdk.CfnOutput(this, "SiteBucketName", {
      value: siteBucket.bucketName,
    });
    new cdk.CfnOutput(this, "DistributionId", {
      value: distribution.distributionId,
    });
    new cdk.CfnOutput(this, "SiteUrl", {
      value: `https://${distribution.distributionDomainName}`,
    });
  }
}
