# @pendo/openfeature-server-provider

OpenFeature provider for [Pendo](https://www.pendo.io/) feature flags in Node.js server environments.

## Installation

```bash
npm install @pendo/openfeature-server-provider @openfeature/server-sdk
```

## Usage

### Basic Setup

```typescript
import { OpenFeature } from '@openfeature/server-sdk';
import { PendoProvider } from '@pendo/openfeature-server-provider';

const pendoProvider = new PendoProvider({
  apiKey: process.env.PENDO_API_KEY!,
  defaultUrl: 'https://myapp.example.com',
});

await OpenFeature.setProviderAndWait(pendoProvider);

const client = OpenFeature.getClient();
```

### Evaluating Flags

Context is required for server-side evaluation. At minimum, provide `targetingKey` (visitor ID):

```typescript
const context = {
  targetingKey: 'user-123',
  accountId: 'account-456',  // Optional
};

// Boolean flag
const showNewFeature = await client.getBooleanValue('new-checkout-flow', false, context);

// String flag (returns "on" or "off")
const variant = await client.getStringValue('checkout-variant', 'control', context);

// Number flag (returns 1 or 0)
const flagValue = await client.getNumberValue('feature-score', 0, context);

// Object flag (returns { enabled: true/false })
const config = await client.getObjectValue('feature-config', { enabled: false }, context);
```

### Event Tracking

Track custom events to Pendo. Requires `trackEventSecret` configuration:

```typescript
const pendoProvider = new PendoProvider({
  apiKey: process.env.PENDO_API_KEY!,
  defaultUrl: 'https://myapp.example.com',
  trackEventSecret: process.env.PENDO_TRACK_SECRET!,
});

// Track an event (fire-and-forget)
pendoProvider.track('checkout_started', { targetingKey: 'user-123' }, {
  cartValue: '99.99',
  itemCount: 3,
});
```

### Telemetry Hook

Automatically track all flag evaluations to Pendo using the telemetry hook:

```typescript
import { OpenFeature } from '@openfeature/server-sdk';
import { PendoProvider, PendoTelemetryHook } from '@pendo/openfeature-server-provider';

const provider = new PendoProvider({
  apiKey: process.env.PENDO_API_KEY!,
  defaultUrl: 'https://myapp.example.com',
});

const telemetryHook = new PendoTelemetryHook({
  trackEventSecret: process.env.PENDO_TRACK_SECRET!,
});

await OpenFeature.setProviderAndWait(provider);
OpenFeature.addHooks(telemetryHook);
```

#### Telemetry Hook Options

```typescript
const telemetryHook = new PendoTelemetryHook({
  // Required: Track event secret for server-side tracking
  trackEventSecret: 'YOUR_TRACK_SECRET',

  // Optional: Custom event name (default: "flag_evaluated")
  eventName: 'feature_flag_evaluated',

  // Optional: Filter which flags to track
  flagFilter: (flagKey) => flagKey.startsWith('feature_'),

  // Optional: Pendo data host URL (default: https://data.pendo.io)
  baseUrl: 'https://data.pendo.io',
});
```

#### Event Payload

Each flag evaluation sends a track event with these properties:

| Property | Description |
|----------|-------------|
| `flag_key` | The flag that was evaluated |
| `flag_variant` | "on", "off", or variant name |
| `flag_reason` | "TARGETING_MATCH", "DEFAULT", or "ERROR" |
| `flag_value` | Stringified value |
| `provider_name` | "pendo-server-provider" |

### Configuration Options

```typescript
const provider = new PendoProvider({
  // Required: Pendo API key
  apiKey: 'YOUR_API_KEY',

  // Required: Default URL for segment evaluation (no browser context on server)
  defaultUrl: 'https://myapp.example.com',

  // Optional: Pendo data host URL (default: https://data.pendo.io)
  baseUrl: 'https://data.pendo.io',

  // Optional: Cache TTL in milliseconds (default: 60000 = 1 minute)
  cacheTtl: 60000,

  // Optional: Track event secret (required for track() method)
  trackEventSecret: 'YOUR_TRACK_SECRET',

  // Optional: receive runtime failures instead of console.error (see Error Handling)
  onError: (error) => logger.warn('pendo failure', { source: error.source }),
});
```

## Regional Data Centers

Pendo operates multiple regional data centers. Configure `baseUrl` based on your subscription:

| Region | Base URL |
|--------|----------|
| US (default) | `https://data.pendo.io` |
| EU | `https://data.eu.pendo.io` |
| US1 | `https://us1.data.pendo.io` |
| Japan | `https://data.jpn.pendo.io` |

```typescript
// EU data center example
const provider = new PendoProvider({
  apiKey: process.env.PENDO_API_KEY!,
  defaultUrl: 'https://myapp.example.com',
  baseUrl: 'https://data.eu.pendo.io',
});
```

## How It Works

1. The provider encodes visitor context using JZB (JSON → Zlib → Base64)
2. Makes a GET request to `/data/segmentflag.json/:apiKey?jzb=...`
3. Pendo returns the list of segment flags the visitor matches
4. Results are cached per visitor/account for the configured TTL

## Context Mapping

| OpenFeature Context | Pendo Concept | Required |
|---------------------|---------------|----------|
| `targetingKey` | Visitor ID | Yes |
| `accountId` | Account ID | No |

## Response Handling

| HTTP Status | Behavior |
|-------------|----------|
| 200 | Parse segmentFlags from response |
| 202 | Visitor not yet known, return empty flags |
| 429 | Rate limit exceeded, throw error |
| 451 | Visitor opted out/blocked, return empty flags |

## Caching

The provider caches segment flags per visitor/account combination:

```typescript
// Configure cache TTL
const provider = new PendoProvider({
  apiKey: 'YOUR_API_KEY',
  defaultUrl: 'https://myapp.example.com',
  cacheTtl: 300000,  // 5 minutes
});

// Manually clear cache if needed
provider.clearCache();
```

## Resolution Details

| Scenario | Reason | Variant |
|----------|--------|---------|
| Flag key in segmentFlags | `TARGETING_MATCH` | `on` |
| Flag key not in segmentFlags | `DEFAULT` | `off` |
| No targetingKey provided | `DEFAULT` | `default` |
| API error (HTTP error, network failure, unparseable response) | `ERROR` | - |

## Error Handling

The provider separates two kinds of problems:

- **Configuration mistakes** (for example a missing `trackEventSecret` or
  `targetingKey`) are durable and the caller's to fix. They are always written
  with `console.warn`, whether or not `onError` is set.
- **Runtime failures** (network errors, HTTP errors, timeouts, unparseable
  responses) are environmental. If you pass an `onError` handler, it receives a
  `PendoRuntimeError` and nothing is written to the console, so you own logging
  and severity. If you do not pass one, they are written with `console.error`.

`PendoRuntimeError` fields:

| Field | Meaning |
|-------|---------|
| `source` | `"segmentflag"`, `"track"`, `"telemetry"` or `"sdk-ready"` |
| `status` | HTTP status; `undefined` for a network failure or timeout |
| `transient` | `true` for 5xx, 429, network failure and timeout; `false` for other 4xx and unparseable responses |
| `cause` | The underlying error, if any |

```typescript
import { PendoProvider, PendoTelemetryHook, PendoRuntimeError } from '@pendo/openfeature-server-provider';

const onError = (e: PendoRuntimeError) =>
  e.transient && !isProduction
    ? logger.warn('pendo flags degraded', { source: e.source, status: e.status })
    : logger.error('pendo flags failed', e);

const provider = new PendoProvider({ apiKey, defaultUrl, onError });
const hook = new PendoTelemetryHook({ trackEventSecret, onError });
```

If `onError` throws or returns a rejected promise, the handler's error and the
original error are both written with `console.error`, and flag evaluation is not
affected. A failed evaluation still returns the default value with reason `ERROR`.

Reporting channels:

- **Evaluation failures** (`source: "segmentflag"`) reach both `onError` and
  OpenFeature `error` hooks. The `error` hook receives only the error code and
  message, with no status.
- **Track and telemetry failures** (`source: "track"`, `"telemetry"`) reach only
  `onError`, or `console.error` when no handler is set.

Passing `onError` is what turns off console output, so always pass one in a
server context. To report evaluation failures from an OpenFeature `error` hook
instead, skip them in `onError`:

```typescript
const onError = (e: PendoRuntimeError) => {
  if (e.source === 'segmentflag') return; // reported by the error hook
  logger.warn('pendo request failed', { source: e.source, status: e.status });
};
```

## Troubleshooting

### Flags always return default values

1. Verify the API key is correct
2. Check that `targetingKey` is provided in the context
3. Confirm the visitor/account is in a segment with the flag enabled
4. If you pass `onError`, check your handler's output for runtime failures; if you do not, check server logs for `[PendoProvider]` `console.error` lines

### Rate limit errors

The Pendo API has rate limits. If you're hitting them:
- Increase `cacheTtl` to reduce API calls
- Implement request queuing in your application

### Track events not working

1. Ensure `trackEventSecret` is configured
2. Verify the track secret is valid
3. Check that `targetingKey` is provided in the context

## License

MIT
