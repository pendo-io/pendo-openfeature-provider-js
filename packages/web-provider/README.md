# @pendo/openfeature-web-provider

OpenFeature provider for [Pendo](https://www.pendo.io/) feature flags in web browsers.

## Installation

```bash
npm install @pendo/openfeature-web-provider @openfeature/web-sdk
```

## Prerequisites

The Pendo agent must be installed on your page. The provider reads flags from `window.pendo.segmentFlags` which is populated by the agent.

```html
<script>
  (function(apiKey){
    // Pendo agent snippet
    // ...
  })('YOUR_PENDO_API_KEY');
</script>
```

## Usage

### Basic Setup

```typescript
import { OpenFeature } from '@openfeature/web-sdk';
import { PendoProvider } from '@pendo/openfeature-web-provider';

// Initialize the provider (waits for Pendo agent to be ready)
await OpenFeature.setProviderAndWait(new PendoProvider());

// Get a client
const client = OpenFeature.getClient();
```

### Evaluating Flags

```typescript
// Boolean flag
const showNewFeature = await client.getBooleanValue('new-checkout-flow', false);

// String flag (returns "on" or "off")
const variant = await client.getStringValue('checkout-variant', 'control');

// Number flag (returns 1 or 0)
const flagValue = await client.getNumberValue('feature-score', 0);

// Object flag (returns { enabled: true/false })
const config = await client.getObjectValue('feature-config', { enabled: false });
```

### Event Tracking

Track custom events to Pendo:

```typescript
const provider = new PendoProvider();
await OpenFeature.setProviderAndWait(provider);

// Track an event
provider.track('checkout_started', undefined, { cartValue: '99.99' });

// The context parameter is ignored in the web provider
// since the Pendo agent already knows the current visitor
provider.track('feature_used');
```

### Telemetry Hook

Automatically track all flag evaluations to Pendo using the telemetry hook:

```typescript
import { OpenFeature } from '@openfeature/web-sdk';
import { PendoProvider, PendoTelemetryHook } from '@pendo/openfeature-web-provider';

const provider = new PendoProvider();
const telemetryHook = new PendoTelemetryHook();

await OpenFeature.setProviderAndWait(provider);
OpenFeature.addHooks(telemetryHook);
```

#### Telemetry Hook Options

```typescript
const telemetryHook = new PendoTelemetryHook({
  // Optional: Custom event name (default: "flag_evaluated")
  eventName: 'feature_flag_evaluated',

  // Optional: Filter which flags to track
  flagFilter: (flagKey) => flagKey.startsWith('feature_'),
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
| `provider_name` | "pendo-provider" |

### Configuration Options

```typescript
const provider = new PendoProvider({
  // API key for Pendo initialization (optional if already initialized)
  apiKey: 'YOUR_API_KEY',

  // Timeout waiting for Pendo agent to be ready (default: 5000ms)
  readyTimeout: 10000,
});
```

## How It Works

1. The provider waits for the Pendo agent to initialize
2. Flag evaluation checks if the flag key exists in `window.pendo.segmentFlags`
3. If the flag key is present, the flag is enabled; otherwise, it returns the default value

## Context

The web provider does not require explicit context for flag evaluation since the Pendo agent maintains visitor/account identity automatically. However, you can pass context for consistency with the OpenFeature API:

```typescript
const enabled = await client.getBooleanValue('my-flag', false, {
  targetingKey: 'user-123',  // Ignored by web provider
  accountId: 'account-456',  // Ignored by web provider
});
```

## Resolution Details

| Scenario | Reason | Variant |
|----------|--------|---------|
| Flag key in segmentFlags | `TARGETING_MATCH` | `on` |
| Flag key not in segmentFlags | `DEFAULT` | `off` |
| Pendo not ready | `DEFAULT` | `default` |

## Troubleshooting

### Flags always return default values

1. Check that the Pendo agent is properly installed and initialized
2. Verify the visitor is in a segment that has the flag enabled
3. Check browser console for `[PendoProvider]` warnings

### Provider times out

Increase the `readyTimeout` option:

```typescript
new PendoProvider({ readyTimeout: 15000 });
```

### Track events not appearing

Ensure the Pendo agent's `track` function is available:

```typescript
if (window.pendo?.track) {
  provider.track('my-event');
}
```

## License

MIT
