import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getAll = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("packages").collect();
  },
});

export const getByName = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    return await ctx.db
      .query("packages")
      .withIndex("by_name", (q) => q.eq("name", name))
      .first();
  },
});

export const upsertVersion = internalMutation({
  args: {
    name: v.string(),
    version: v.string(),
    ecosystem: v.optional(v.string()),
  },
  handler: async (ctx, { name, version, ecosystem }) => {
    const existing = await ctx.db
      .query("packages")
      .withIndex("by_name", (q) => q.eq("name", name))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        currentVersion: version,
        lastChecked: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("packages", {
      name,
      currentVersion: version,
      ecosystem: ecosystem ?? "npm",
      lastChecked: Date.now(),
    });
  },
});

export const getByIds = internalQuery({
  args: { ids: v.array(v.id("packages")) },
  handler: async (ctx, { ids }) => {
    return await Promise.all(ids.map((id) => ctx.db.get(id)));
  },
});
