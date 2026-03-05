/**
 * Browser-based live test for Pendo OpenFeature Web Provider
 */

import { OpenFeature } from '@openfeature/web-sdk';
import { PendoProvider } from '../../packages/web-provider/src';

// Globals for the HTML page
declare global {
  interface Window {
    initializePendo: () => Promise<void>;
    testFlags: () => Promise<void>;
    refreshFlags: () => void;
    pendo?: {
      initialize?: (options: unknown) => void;
      isReady?: () => boolean;
      segmentFlags?: string[];
      getVisitorId?: () => string;
      getAccountId?: () => string;
    };
  }
}

// UI Helper functions
function log(message: string, level: 'info' | 'success' | 'warn' | 'error' = 'info') {
  const logEl = document.getElementById('log');
  if (logEl) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${level}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
  }
  console[level === 'success' ? 'log' : level](`[PendoTest] ${message}`);
}

function updateStatus(elementId: string, message: string, status: 'pending' | 'ready' | 'error') {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = message;
    el.className = `status ${status}`;
  }
}

function getInputValue(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement;
  return el?.value?.trim() || '';
}

function setButtonEnabled(id: string, enabled: boolean) {
  const btn = document.getElementById(id) as HTMLButtonElement;
  if (btn) btn.disabled = !enabled;
}

// Load Pendo snippet dynamically
function loadPendoSnippet(apiKey: string, host?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if already loaded
    if (window.pendo?.initialize) {
      log('Pendo snippet already loaded', 'info');
      resolve();
      return;
    }

    const script = document.createElement('script');

    // Build the Pendo snippet URL
    const pendoHost = host || 'cdn.pendo.io';
    script.src = `https://${pendoHost}/agent/static/${apiKey}/pendo.js`;
    script.async = true;

    script.onload = () => {
      log(`Pendo snippet loaded from ${pendoHost}`, 'success');
      resolve();
    };

    script.onerror = () => {
      log(`Failed to load Pendo snippet from ${pendoHost}`, 'error');
      reject(new Error('Failed to load Pendo snippet'));
    };

    document.head.appendChild(script);
  });
}

// Initialize Pendo with visitor/account
async function initializePendo() {
  const apiKey = getInputValue('apiKey');
  const pendoHost = getInputValue('pendoHost');
  const visitorId = getInputValue('visitorId');
  const accountId = getInputValue('accountId');

  if (!apiKey) {
    log('API key is required', 'error');
    return;
  }

  if (!visitorId) {
    log('Visitor ID is required', 'error');
    return;
  }

  setButtonEnabled('initBtn', false);
  log('Loading Pendo snippet...', 'info');
  updateStatus('pendoStatus', 'Loading Pendo agent...', 'pending');

  try {
    // Load the Pendo script
    await loadPendoSnippet(apiKey, pendoHost || undefined);

    // Initialize Pendo with visitor/account
    log(`Initializing Pendo with visitor: ${visitorId}, account: ${accountId || '(none)'}`, 'info');

    if (window.pendo?.initialize) {
      window.pendo.initialize({
        visitor: { id: visitorId },
        account: accountId ? { id: accountId } : undefined,
      });
    } else {
      throw new Error('Pendo initialize function not found');
    }

    // Wait for Pendo to be ready
    log('Waiting for Pendo to be ready...', 'info');
    await waitForPendoReady(10000);

    updateStatus('pendoStatus', 'Pendo agent ready', 'ready');
    log('Pendo agent is ready', 'success');

    // Initialize OpenFeature provider
    log('Initializing OpenFeature with Pendo provider...', 'info');
    updateStatus('providerStatus', 'Initializing provider...', 'pending');

    const provider = new PendoProvider({ readyTimeout: 5000 });
    await OpenFeature.setProviderAndWait(provider);

    updateStatus('providerStatus', `Provider ready (status: ${provider.status})`, 'ready');
    log('OpenFeature provider initialized', 'success');

    // Enable test button
    setButtonEnabled('testBtn', true);

    // Update debug info
    refreshFlags();

  } catch (error) {
    log(`Initialization failed: ${error}`, 'error');
    updateStatus('pendoStatus', `Error: ${error}`, 'error');
    setButtonEnabled('initBtn', true);
  }
}

function waitForPendoReady(timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      if (window.pendo?.isReady?.()) {
        resolve();
        return;
      }

      if (Date.now() - startTime > timeout) {
        reject(new Error('Pendo ready timeout'));
        return;
      }

      setTimeout(check, 100);
    };

    // Also listen for the ready event
    document.addEventListener('pendo_ready', () => resolve(), { once: true });
    check();
  });
}

// Test flags
async function testFlags() {
  const flagNamesInput = getInputValue('flagNames');
  const flagNames = flagNamesInput
    .split(',')
    .map(f => f.trim())
    .filter(f => f.length > 0);

  if (flagNames.length === 0) {
    log('Enter at least one flag name to test', 'warn');
    return;
  }

  log(`Testing ${flagNames.length} flag(s): ${flagNames.join(', ')}`, 'info');

  const client = OpenFeature.getClient();
  const resultsEl = document.getElementById('flagResults');
  if (!resultsEl) return;

  resultsEl.innerHTML = '';

  for (const flagName of flagNames) {
    try {
      const result = await client.getBooleanDetails(flagName, false);

      const div = document.createElement('div');
      div.className = `flag-result ${result.value ? 'enabled' : 'disabled'}`;
      div.innerHTML = `
        <span class="icon">${result.value ? '✅' : '⬜'}</span>
        <span class="name">${flagName}</span>
        <span class="value">${result.value} (${result.reason})</span>
      `;
      resultsEl.appendChild(div);

      log(`Flag "${flagName}": ${result.value} (reason: ${result.reason}, variant: ${result.variant})`,
          result.value ? 'success' : 'info');
    } catch (error) {
      log(`Error evaluating flag "${flagName}": ${error}`, 'error');
    }
  }
}

// Refresh Pendo state display
function refreshFlags() {
  const debugEl = document.getElementById('pendoDebug');
  if (!debugEl) return;

  if (!window.pendo) {
    debugEl.textContent = 'Pendo not loaded';
    return;
  }

  const info = {
    isReady: window.pendo.isReady?.() ?? false,
    visitorId: window.pendo.getVisitorId?.() ?? '(unknown)',
    accountId: window.pendo.getAccountId?.() ?? '(none)',
    segmentFlags: window.pendo.segmentFlags ?? [],
  };

  debugEl.textContent = JSON.stringify(info, null, 2);
  log(`Pendo state refreshed: ${info.segmentFlags.length} segment flag(s) found`, 'info');
}

// Expose functions to window for HTML onclick handlers
window.initializePendo = initializePendo;
window.testFlags = testFlags;
window.refreshFlags = refreshFlags;

// Auto-fill from URL params if present
const params = new URLSearchParams(window.location.search);
if (params.get('apiKey')) {
  (document.getElementById('apiKey') as HTMLInputElement).value = params.get('apiKey')!;
}
if (params.get('host')) {
  (document.getElementById('pendoHost') as HTMLInputElement).value = params.get('host')!;
}
if (params.get('visitorId')) {
  (document.getElementById('visitorId') as HTMLInputElement).value = params.get('visitorId')!;
}
if (params.get('accountId')) {
  (document.getElementById('accountId') as HTMLInputElement).value = params.get('accountId')!;
}
if (params.get('flags')) {
  (document.getElementById('flagNames') as HTMLInputElement).value = params.get('flags')!;
}

log('Test page loaded. Enter your configuration and click "Initialize Pendo"', 'info');
