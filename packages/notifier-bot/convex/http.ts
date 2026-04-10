import { httpRouter } from "convex/server";
import {
  slackBannerImage,
  slackInstall,
  slackOAuthCallback,
  slackOAuthPreview,
} from "./slack/oauth";
import { npmTrack, npmUntrack, listPackages, help } from "./slack/commands";
import { slackEvents } from "./slack/events";
import { slackInteractions } from "./slack/interactions";

const http = httpRouter();

http.route({
  path: "/slack/install",
  method: "GET",
  handler: slackInstall,
});

http.route({
  path: "/slack/oauth-callback",
  method: "GET",
  handler: slackOAuthCallback,
});

http.route({
  path: "/slack/oauth-preview",
  method: "GET",
  handler: slackOAuthPreview,
});

http.route({
  path: "/slack/banner.png",
  method: "GET",
  handler: slackBannerImage,
});

http.route({
  path: "/slack/npmtrack",
  method: "POST",
  handler: npmTrack,
});

http.route({
  path: "/slack/npmuntrack",
  method: "POST",
  handler: npmUntrack,
});

http.route({
  path: "/slack/list",
  method: "POST",
  handler: listPackages,
});

http.route({
  path: "/slack/help",
  method: "POST",
  handler: help,
});

http.route({
  path: "/slack/events",
  method: "POST",
  handler: slackEvents,
});

http.route({
  path: "/slack/interactions",
  method: "POST",
  handler: slackInteractions,
});

export default http;
