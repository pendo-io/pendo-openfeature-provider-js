# @pendo/openfeature-web-provider

OpenFeature provider for [Pendo](https://www.pendo.io/) feature flags in web browsers.

## Installation

```bash
npm install @pendo/openfeature-web-provider @openfeature/web-sdk
```

## Usage

### Basic Setup

```typescript
import { OpenFeature } from '@openfeature/web-sdk';
import { PendoProvider } from '@pendo/openfeature-web-provider';

// Set context first (required for API call)
await OpenFeature.setContext({
  targetingKey: user.id,    // visitorId (required)
  accountId: org.id,        // accountId (optional)
});

// Initialize provider with API key
await OpenFeature.setProviderAndWait(new PendoProvider({
  apiKey: 'YOUR_PENDO_API_KEY',
}));

// Get a client
const client = OpenFeature.getClient();
```

### Evaluating Flags

```typescript
// Boolean flag
const showNewFeature = client.getBooleanValue('new-checkout-flow', false);

// String flag (returns "on" or "off")
const variant = client.getStringValue('checkout-variant', 'control');

// Number flag (returns 1 or 0)
const flagValue = client.getNumberValue('feature-score', 0);

// Object flag (returns { enabled: true/false })
const config = client.getObjectValue('feature-config', { enabled: false });
```

### Context Changes

When the user changes (e.g., login/logout), update the context:

```typescript
// User logs in
await OpenFeature.setContext({
  targetingKey: newUser.id,
  accountId: newUser.accountId,
});

// The provider automatically:
// 1. Fetches new flags for the new user
// 2. Emits ConfigurationChanged event
// 3. React/Angular SDKs re-render components using flags
```

### Configuration Options

```typescript
const provider = new PendoProvider({
  // Required: Pendo API key
  apiKey: 'YOUR_API_KEY',

  // Optional: Custom Pendo data host (default: https://data.pendo.io)
  baseUrl: 'https://custom.pendo.io',

  // Optional: Cache TTL in milliseconds (default: 60000 = 1 minute)
  cacheTtl: 30000,
});
```

## How It Works

1. The provider calls Pendo's `segmentflag.json` API directly with visitor/account context
2. Flag evaluation checks if the flag key exists in the returned segment flags
3. Results are cached for performance (configurable TTL)
4. Context changes trigger automatic re-fetch of flags

## Context

The web provider requires context to be set before initialization:

```typescript
await OpenFeature.setContext({
  targetingKey: 'user-123',   // Required: Visitor ID
  accountId: 'account-456',   // Optional: Account ID
});
```

## Resolution Details

| Scenario | Reason | Variant |
|----------|--------|---------|
| Flag key in segment flags | `TARGETING_MATCH` | `on` |
| Flag key not in segment flags | `DEFAULT` | `off` |
| No flags fetched / no context | `DEFAULT` | `default` |

## API Response Handling

The provider handles Pendo-specific HTTP status codes:

| Status | Behavior |
|--------|----------|
| 200 | Success - use returned flags |
| 202 | Visitor not yet known - return empty flags |
| 429 | Rate limited - log error, use defaults |
| 451 | Visitor opted out - return empty flags |

## Event Tracking

The web provider doesn't support server-side event tracking. If you need to track events, use the Pendo Web SDK directly:

```typescript
// If you have the Pendo agent loaded on your page
window.pendo?.track('event-name', { property: 'value' });
```

## Troubleshooting

### Flags always return default values

1. Ensure `targetingKey` (visitor ID) is set in the context
2. Verify your API key is correct
3. Check browser console for `[PendoProvider]` warnings
4. Confirm the visitor is in a segment with the flag enabled

### API calls failing

1. Check if your API key has the correct permissions
2. Verify the `baseUrl` is correct for your Pendo environment
3. Check for CORS issues if using a custom domain

### Flags not updating on context change

The provider automatically fetches new flags when `OpenFeature.setContext()` is called. Ensure you're awaiting the setContext call:

```typescript
await OpenFeature.setContext({ targetingKey: newUserId });
```

## License

MIT
