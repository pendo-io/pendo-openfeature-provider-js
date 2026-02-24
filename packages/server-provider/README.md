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
| API error | `ERROR` | - |

## Troubleshooting

### Flags always return default values

1. Verify the API key is correct
2. Check that `targetingKey` is provided in the context
3. Confirm the visitor/account is in a segment with the flag enabled
4. Check server logs for `[PendoProvider]` warnings

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
