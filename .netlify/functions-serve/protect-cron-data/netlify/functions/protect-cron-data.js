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

// netlify/functions/protect-cron-data.js
var protect_cron_data_exports = {};
__export(protect_cron_data_exports, {
  isCronProtected: () => isCronProtected,
  safeUpdateHistory: () => safeUpdateHistory
});
module.exports = __toCommonJS(protect_cron_data_exports);
function isCronProtected(history, dateKey) {
  if (!history || !history[dateKey]) {
    return false;
  }
  return history[dateKey].from_cron === true;
}
function safeUpdateHistory(history, dateKey, newData, isCronJob = false) {
  if (!history) {
    history = {};
  }
  if (isCronJob) {
    history[dateKey] = { ...newData, from_cron: true };
    return history;
  }
  if (isCronProtected(history, dateKey)) {
    console.log(`\u26A0\uFE0F Entry for ${dateKey} is protected (from cron job). Manual update skipped.`);
    return history;
  }
  history[dateKey] = { ...newData, from_cron: false };
  return history;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  isCronProtected,
  safeUpdateHistory
});
//# sourceMappingURL=protect-cron-data.js.map
