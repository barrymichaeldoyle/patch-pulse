import { httpRouter } from "convex/server";
import { slackOAuthCallback } from "./slack/oauth";
import { npmTrack, npmUntrack, listPackages } from "./slack/commands";
import { slackEvents } from "./slack/events";

const http = httpRouter();

http.route({
  path: "/slack/oauth-callback",
  method: "GET",
  handler: slackOAuthCallback,
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
  path: "/slack/events",
  method: "POST",
  handler: slackEvents,
});

export default http;
