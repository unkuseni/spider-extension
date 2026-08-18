// Example plugin: onLead hook that streams leads to a webhook.
// Set WEBHOOK_URL (e.g. https://your-app.com/api/new-lead) to enable.
import type { Plugin, PluginOnLeadContext } from "../../src/types.ts";

const url = typeof process !== "undefined" && process.env ? process.env.WEBHOOK_URL ?? "" : "";

const plugin: Partial<Plugin> = {
  hooks: {
    async onLead(ctx: PluginOnLeadContext) {
      if (!url) return; // disabled unless WEBHOOK_URL is set
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "lead", outcome: ctx.outcome, lead: ctx.lead }),
      });
    },
  },
};

export default plugin;
