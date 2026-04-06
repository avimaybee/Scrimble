import {
  type AuthProvider,
  authSessionSchema,
} from '@scrimble/shared';

interface DeviceFlowAuthConfig {
  provider: AuthProvider;
  clientId: string;
  deviceCodeEndpoint: string;
  tokenEndpoint: string;
  scope?: string | undefined;
  audience?: string | undefined;
}

interface DeviceCodeStartResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function postForm(url: string, formData: URLSearchParams): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData,
  });

  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const error = asString(json['error']) ?? `HTTP ${response.status}`;
    const errorDescription = asString(json['error_description']);
    throw new Error(errorDescription ? `${error}: ${errorDescription}` : error);
  }
  return json;
}

function parseDeviceCodeResult(payload: Record<string, unknown>): DeviceCodeStartResult {
  const deviceCode = asString(payload['device_code']);
  const userCode = asString(payload['user_code']);
  const verificationUri = asString(payload['verification_uri']);
  const verificationUriComplete = asString(payload['verification_uri_complete']);
  const expiresIn = asNumber(payload['expires_in']);
  const interval = asNumber(payload['interval']) ?? 5;

  if (!deviceCode || !userCode || !verificationUri || !expiresIn) {
    throw new Error('Device code response was missing required fields.');
  }

  return {
    deviceCode,
    userCode,
    verificationUri,
    ...(verificationUriComplete ? { verificationUriComplete } : {}),
    expiresIn,
    interval,
  };
}

function buildTokenPollingForm(authConfig: DeviceFlowAuthConfig, deviceCode: string): URLSearchParams {
  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: authConfig.clientId,
    device_code: deviceCode,
  });
  if (authConfig.audience) {
    params.set('audience', authConfig.audience);
  }
  return params;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function startDeviceCode(authConfig: DeviceFlowAuthConfig): Promise<DeviceCodeStartResult> {
  const params = new URLSearchParams({
    client_id: authConfig.clientId,
  });
  if (authConfig.scope) {
    params.set('scope', authConfig.scope);
  }
  if (authConfig.audience) {
    params.set('audience', authConfig.audience);
  }

  const payload = await postForm(authConfig.deviceCodeEndpoint, params);
  return parseDeviceCodeResult(payload);
}

export async function pollDeviceCodeToken(
  authConfig: DeviceFlowAuthConfig,
  startResult: DeviceCodeStartResult,
) {
  const deadline = Date.now() + (startResult.expiresIn * 1000);
  let intervalSeconds = startResult.interval;

  while (Date.now() < deadline) {
    await sleep(intervalSeconds * 1000);

    const payload = await postForm(
      authConfig.tokenEndpoint,
      buildTokenPollingForm(authConfig, startResult.deviceCode),
    );

    const error = asString(payload['error']);
    if (error) {
      if (error === 'authorization_pending') {
        continue;
      }
      if (error === 'slow_down') {
        intervalSeconds += 5;
        continue;
      }
      if (error === 'expired_token') {
        throw new Error('Device code expired before authorization completed.');
      }

      const errorDescription = asString(payload['error_description']);
      throw new Error(errorDescription ? `${error}: ${errorDescription}` : error);
    }

    const accessToken = asString(payload['access_token']);
    if (!accessToken) {
      throw new Error('Token response did not contain access_token.');
    }

    const tokenType = asString(payload['token_type']) ?? 'Bearer';
    const refreshToken = asString(payload['refresh_token']);
    const scope = asString(payload['scope']);
    const expiresIn = asNumber(payload['expires_in']);
    const expiresAt = expiresIn ? new Date(Date.now() + (expiresIn * 1000)).toISOString() : undefined;

    return authSessionSchema.parse({
      provider: authConfig.provider,
      accessToken,
      tokenType,
      ...(scope ? { scope } : {}),
      ...(refreshToken ? { refreshToken } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      createdAt: new Date().toISOString(),
    });
  }

  throw new Error('Timed out waiting for device authorization.');
}
