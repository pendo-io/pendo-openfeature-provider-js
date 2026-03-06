# @pendo/openfeature-web-provider

OpenFeature provider for [Pendo](https://www.pendo.io/) feature flags in web browsers.

## Installation

```bash
npm install @pendo/openfeature-web-provider @openfeature/web-sdk
```

## Prerequisites

The Pendo Web SDK must be installed and initialized on your page with `requestSegmentFlags: true` enabled.

```javascript
// Initialize Pendo with segment flags enabled
pendo.initialize({
  visitor: { id: 'user-123' },
  account: { id: 'account-456' },
  requestSegmentFlags: true  // Required for feature flags
});
```

## Usage

### Basic Setup

```typescript
import { OpenFeature } from '@openfeature/web-sdk';
import { PendoProvider } from '@pendo/openfeature-web-provider';

// Initialize the provider (waits for Pendo to be ready)
await OpenFeature.setProviderAndWait(new PendoProvider());

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

### Event Tracking

Track custom events to Pendo:

```typescript
const client = OpenFeature.getClient();

// Track an event (delegates to pendo.track)
client.track('checkout_started', { cartValue: '99.99' });
```

### Configuration Options

```typescript
const provider = new PendoProvider({
  // Timeout waiting for the Pendo Web SDK to be ready (default: 5000ms)
  readyTimeout: 10000,
});
```

## How It Works

1. The provider waits for the Pendo Web SDK to be ready
2. Flag evaluation checks if the flag key exists in `pendo.segmentFlags`
3. When Pendo updates flags (on metadata/identity changes), the provider emits `ConfigurationChanged`
4. React/Angular OpenFeature SDKs automatically re-render when flags change

## Automatic Flag Updates

The provider subscribes to Pendo's `Events.segmentFlagsUpdated` event to detect when flags are updated. This happens automatically when:

- Pendo initializes and loads initial flags
- Visitor metadata changes
- Visitor identity changes (via `pendo.identify()`)

When flags update, the provider emits a `ConfigurationChanged` event, which triggers re-renders in React/Angular SDKs.

## Resolution Details

| Scenario | Reason | Variant |
|----------|--------|---------|
| Flag key in segmentFlags | `TARGETING_MATCH` | `on` |
| Flag key not in segmentFlags | `DEFAULT` | `off` |
| Pendo not ready / no flags | `DEFAULT` | `default` |

## Telemetry Hook

Automatically track all flag evaluations to Pendo using the telemetry hook:

```typescript
import { OpenFeature } from '@openfeature/web-sdk';
import { PendoProvider, PendoTelemetryHook } from '@pendo/openfeature-web-provider';

const provider = new PendoProvider();
const telemetryHook = new PendoTelemetryHook();

await OpenFeature.setProviderAndWait(provider);
OpenFeature.addHooks(telemetryHook);
```

### Telemetry Hook Options

```typescript
const telemetryHook = new PendoTelemetryHook({
  // Optional: Custom event name (default: "flag_evaluated")
  eventName: 'feature_flag_evaluated',

  // Optional: Filter which flags to track
  flagFilter: (flagKey) => flagKey.startsWith('feature_'),
});
```

## Troubleshooting

### Flags always return default values

1. Ensure `requestSegmentFlags: true` is set in your Pendo initialization
2. Check that Pendo is properly initialized before the provider
3. Verify the visitor is in a segment with the flag enabled
4. Check browser console for `[PendoProvider]` warnings

### Provider times out

Increase the `readyTimeout` option:

```typescript
new PendoProvider({ readyTimeout: 15000 });
```

### Flags not updating

The provider automatically detects flag changes. If flags aren't updating:

1. Verify Pendo is receiving metadata/identity updates
2. Check that `requestSegmentFlags: true` is enabled
3. Ensure your segments are configured correctly in Pendo

## License

MIT
