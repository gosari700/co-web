import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const VERCEL_CLI_CLIENT_ID = 'cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp';

function getAuthPath() {
  const dataHome = process.env.XDG_DATA_HOME;
  if (!dataHome) {
    throw new Error('XDG_DATA_HOME is required.');
  }
  return join(dataHome, 'com.vercel.cli', 'auth.json');
}

async function refreshAuth() {
  const authPath = getAuthPath();
  const auth = JSON.parse(await readFile(authPath, 'utf8'));
  if (!auth.refreshToken) {
    throw new Error('Vercel auth refreshToken is missing.');
  }

  const metadataResponse = await fetch('https://vercel.com/.well-known/openid-configuration');
  if (!metadataResponse.ok) {
    throw new Error(`Failed to read Vercel OAuth metadata: ${metadataResponse.status}`);
  }
  const metadata = await metadataResponse.json();
  const tokenEndpoint = metadata.token_endpoint;
  if (!tokenEndpoint) {
    throw new Error('Vercel OAuth token endpoint is missing.');
  }

  const tokenResponse = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'user-agent': `co-web-actions node-${process.version}`,
    },
    body: new URLSearchParams({
      client_id: VERCEL_CLI_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken,
    }),
  });

  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok || !tokens.access_token) {
    throw new Error(`Failed to refresh Vercel auth: ${tokens.error || tokenResponse.status}`);
  }

  auth.token = tokens.access_token;
  auth.expiresAt = Date.now() + Math.max(0, Number(tokens.expires_in || 0)) * 1000;
  if (tokens.refresh_token) {
    auth.refreshToken = tokens.refresh_token;
  }

  await writeFile(authPath, `${JSON.stringify(auth, null, 2)}\n`);
  console.log('Vercel CLI auth refreshed.');
}

await refreshAuth();
