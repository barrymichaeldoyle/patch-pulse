/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as migration from "../migration.js";
import type * as packages from "../packages.js";
import type * as polling from "../polling.js";
import type * as slack_commands from "../slack/commands.js";
import type * as slack_events from "../slack/events.js";
import type * as slack_links from "../slack/links.js";
import type * as slack_oauth from "../slack/oauth.js";
import type * as subscribers from "../subscribers.js";
import type * as subscriptions from "../subscriptions.js";
import type * as testNotification from "../testNotification.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  http: typeof http;
  migration: typeof migration;
  packages: typeof packages;
  polling: typeof polling;
  "slack/commands": typeof slack_commands;
  "slack/events": typeof slack_events;
  "slack/links": typeof slack_links;
  "slack/oauth": typeof slack_oauth;
  subscribers: typeof subscribers;
  subscriptions: typeof subscriptions;
  testNotification: typeof testNotification;
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
  FunctionReference<any, "public">
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
  FunctionReference<any, "internal">
>;

export declare const components: {};
