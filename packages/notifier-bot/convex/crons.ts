import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.cron(
  "poll npm packages",
  "0 * * * *",
  internal.polling.checkForUpdates,
  {},
);

export default crons;
