// Example plugin: an exporter used by: spider-leads export leads.jsonl --exporter jsonl
import type { Plugin } from "../../src/types.ts";

const plugin: Partial<Plugin> = {
  exporters: [
    {
      id: "jsonl",
      label: "JSON Lines",
      export(rows: unknown[]) {
        return {
          content: rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
          filename: "leads.jsonl",
          mime: "application/x-ndjson",
        };
      },
    },
  ],
};

export default plugin;
