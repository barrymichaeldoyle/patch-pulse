import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "poll npm packages",
  { hours: 1 },
  internal.polling.checkForUpdates,
  {},
);

export default crons;
