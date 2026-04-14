/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from '../crons.js';
import type * as http from '../http.js';
import type * as packages from '../packages.js';
import type * as polling from '../polling.js';
import type * as releaseChecks from '../releaseChecks.js';
import type * as slack_api from '../slack/api.js';
import type * as slack_bannerAsset from '../slack/bannerAsset.js';
import type * as slack_commands from '../slack/commands.js';
import type * as slack_events from '../slack/events.js';
import type * as slack_format from '../slack/format.js';
import type * as slack_interactions from '../slack/interactions.js';
import type * as slack_links from '../slack/links.js';
import type * as slack_oauth from '../slack/oauth.js';
import type * as slack_verify from '../slack/verify.js';
import type * as subscribers from '../subscribers.js';
import type * as subscriptions from '../subscriptions.js';

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from 'convex/server';

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  http: typeof http;
  packages: typeof packages;
  polling: typeof polling;
  releaseChecks: typeof releaseChecks;
  'slack/api': typeof slack_api;
  'slack/bannerAsset': typeof slack_bannerAsset;
  'slack/commands': typeof slack_commands;
  'slack/events': typeof slack_events;
  'slack/format': typeof slack_format;
  'slack/interactions': typeof slack_interactions;
  'slack/links': typeof slack_links;
  'slack/oauth': typeof slack_oauth;
  'slack/verify': typeof slack_verify;
  subscribers: typeof subscribers;
  subscriptions: typeof subscriptions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, 'public'>
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, 'internal'>
>;

export declare const components: {};
