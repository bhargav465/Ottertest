function required(name: string, value: string | undefined): string {
  if (!value) {
    // Surface a clear message instead of a cryptic failure deep in the app.
    console.error(
      `Missing ${name}. Copy frontend/.env.example to frontend/.env and fill in the CDK deploy outputs.`
    );
  }
  return value ?? "";
}

export const config = {
  region: required("VITE_AWS_REGION", import.meta.env.VITE_AWS_REGION),
  apiUrl: required("VITE_API_URL", import.meta.env.VITE_API_URL)?.replace(
    /\/$/,
    ""
  ),
  userPoolId: required("VITE_USER_POOL_ID", import.meta.env.VITE_USER_POOL_ID),
  userPoolClientId: required(
    "VITE_USER_POOL_CLIENT_ID",
    import.meta.env.VITE_USER_POOL_CLIENT_ID
  ),
};
