"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// netlify/functions/youtube.js
var youtube_exports = {};
__export(youtube_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(youtube_exports);
async function handler(event) {
  try {
    const params = event.queryStringParameters || {};
    const action = params.action;
    const apiKey = process.env.YOUTUBE_API_KEY;
    const channelId = params.channelId || process.env.YOUTUBE_CHANNEL_ID;
    const maxResults = params.maxResults || "50";
    if (!apiKey) {
      return json(500, { error: "Missing YOUTUBE_API_KEY env var" });
    }
    if (action === "search") {
      const url = new URL("https://www.googleapis.com/youtube/v3/search");
      url.searchParams.set("key", apiKey);
      if (channelId) url.searchParams.set("channelId", channelId);
      url.searchParams.set("part", "snippet,id");
      url.searchParams.set("order", "date");
      url.searchParams.set("maxResults", String(maxResults));
      url.searchParams.set("type", "video");
      const res = await fetch(url.toString());
      const data = await res.json();
      return json(res.status, data);
    }
    if (action === "videos") {
      const ids = params.ids || "";
      if (!ids) {
        return json(400, { error: "Missing ids parameter" });
      }
      const url = new URL("https://www.googleapis.com/youtube/v3/videos");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("id", ids);
      url.searchParams.set("part", "contentDetails,snippet");
      const res = await fetch(url.toString());
      const data = await res.json();
      return json(res.status, data);
    }
    return json(400, { error: "Unsupported action" });
  } catch (error) {
    return json(500, { error: error.message });
  }
}
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify(body)
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=youtube.js.map
