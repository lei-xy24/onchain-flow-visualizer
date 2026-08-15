import { TOPIC_TYPES, WATCH_METRIC_REFS } from "./social-radar-lib.mjs";

export const radarOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["figures"],
  properties: {
    figures: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["figureId", "topics"],
        properties: {
          figureId: { type: "string" },
          topics: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["topicType", "name", "category", "confidence", "summary", "why", "keywords", "sourceIds", "evidenceSummaries", "story"],
              properties: {
                topicType: { type: "string", enum: TOPIC_TYPES },
                name: { type: "string" },
                category: { type: "string" },
                confidence: { type: "string", enum: ["高", "中", "低"] },
                summary: { type: "string" },
                why: { type: "string" },
                keywords: { type: "array", minItems: 3, maxItems: 8, items: { type: "string" } },
                sourceIds: { type: "array", minItems: 2, maxItems: 8, items: { type: "string" } },
                evidenceSummaries: {
                  type: "array",
                  minItems: 2,
                  maxItems: 8,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["sourceId", "summary", "keywords"],
                    properties: {
                      sourceId: { type: "string" },
                      summary: { type: "string" },
                      keywords: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } }
                    }
                  }
                },
                story: {
                  type: "object",
                  additionalProperties: false,
                  required: ["headline", "lead", "chapters", "watch"],
                  properties: {
                    headline: { type: "string" },
                    lead: { type: "string" },
                    chapters: {
                      type: "array",
                      minItems: 4,
                      maxItems: 4,
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["title", "kicker", "body", "view"],
                        properties: {
                          title: { type: "string" },
                          kicker: { type: "string" },
                          body: { type: "string" },
                          view: { type: "string", enum: ["signal", "trend", "ranking", "watch"] }
                        }
                      }
                    },
                    watch: {
                      type: "array",
                      minItems: 3,
                      maxItems: 3,
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["title", "metricRef", "detail", "tone"],
                        properties: {
                          title: { type: "string" },
                          metricRef: { type: "string", enum: WATCH_METRIC_REFS },
                          detail: { type: "string" },
                          tone: { type: "string", enum: ["teal", "amber", "violet"] }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};
