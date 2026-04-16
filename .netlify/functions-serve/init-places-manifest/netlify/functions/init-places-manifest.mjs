
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


// netlify/functions/init-places-manifest.js
import { getStore } from "@netlify/blobs";
var init_places_manifest_default = async (req, context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      }
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      }
    });
  }
  try {
    const { token, email } = await req.json();
    if (!token || !email) {
      return new Response(JSON.stringify({ error: "Token et email requis" }), {
        status: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        }
      });
    }
    console.log("Initializing places system for Manifest token:", token, "email:", email);
    const store = getStore("manifest-places-tokens");
    const startTime = Math.floor(Date.now() / 1e3);
    const expiresAt = startTime + 7 * 24 * 60 * 60;
    const tokenData = {
      token,
      email,
      startTime,
      expiresAt,
      initialPlaces: 27,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    try {
      await store.set(token, JSON.stringify(tokenData), {
        metadata: {
          email,
          expiresAt: expiresAt.toString(),
          initialPlaces: "27"
        }
      });
      console.log("\u2705 Token stored successfully in Blobs:", token);
    } catch (storeError) {
      console.error("\u274C Error storing token in Blobs:", storeError);
      console.error("Store error details:", {
        message: storeError.message,
        stack: storeError.stack,
        name: storeError.name
      });
      throw storeError;
    }
    return new Response(JSON.stringify({
      success: true,
      token,
      startTime,
      expiresAt,
      initialPlaces: 27
    }), {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("\u274C Error in init-places-manifest:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    return new Response(JSON.stringify({
      error: "Erreur serveur",
      details: process.env.NETLIFY_DEV ? error.message : void 0
    }), {
      status: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      }
    });
  }
};
export {
  init_places_manifest_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9mdW5jdGlvbnMvaW5pdC1wbGFjZXMtbWFuaWZlc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEZvbmN0aW9uIE5ldGxpZnkgcG91ciBpbml0aWFsaXNlciBsZSBzeXN0XHUwMEU4bWUgZGUgcGxhY2VzIGxpbWl0XHUwMEU5ZXMgcG91ciBNYW5pZmVzdFxuLy8gVXRpbGlzZSBOZXRsaWZ5IEJsb2JzIHBvdXIgc3RvY2tlciBsZXMgZG9ublx1MDBFOWVzXG4vLyBTeXN0XHUwMEU4bWUgZGUgMjcgcGxhY2VzIHF1aSBkaW1pbnVlbnQgc3VyIDcgam91cnMgc2Vsb24gZGVzIHBhbGllcnNcblxuaW1wb3J0IHsgZ2V0U3RvcmUgfSBmcm9tICdAbmV0bGlmeS9ibG9icyc7XG5cbmV4cG9ydCBkZWZhdWx0IGFzeW5jIChyZXEsIGNvbnRleHQpID0+IHtcbiAgICAvLyBHXHUwMEU5cmVyIGxlcyByZXF1XHUwMEVBdGVzIE9QVElPTlMgcG91ciBDT1JTXG4gICAgaWYgKHJlcS5tZXRob2QgPT09ICdPUFRJT05TJykge1xuICAgICAgICByZXR1cm4gbmV3IFJlc3BvbnNlKG51bGwsIHtcbiAgICAgICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAgICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnQ29udGVudC1UeXBlJyxcbiAgICAgICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdQT1NULCBPUFRJT05TJ1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAocmVxLm1ldGhvZCAhPT0gJ1BPU1QnKSB7XG4gICAgICAgIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ01ldGhvZCBub3QgYWxsb3dlZCcgfSksIHtcbiAgICAgICAgICAgIHN0YXR1czogNDA1LFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zdCB7IHRva2VuLCBlbWFpbCB9ID0gYXdhaXQgcmVxLmpzb24oKTtcblxuICAgICAgICBpZiAoIXRva2VuIHx8ICFlbWFpbCkge1xuICAgICAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnVG9rZW4gZXQgZW1haWwgcmVxdWlzJyB9KSwge1xuICAgICAgICAgICAgICAgIHN0YXR1czogNDAwLFxuICAgICAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICAgICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc29sZS5sb2coJ0luaXRpYWxpemluZyBwbGFjZXMgc3lzdGVtIGZvciBNYW5pZmVzdCB0b2tlbjonLCB0b2tlbiwgJ2VtYWlsOicsIGVtYWlsKTtcblxuICAgICAgICAvLyBPYnRlbmlyIGxlIHN0b3JlIE5ldGxpZnkgQmxvYnMgYXZlYyBsZSBjb250ZXh0ZSBhdXRvbWF0aXF1ZVxuICAgICAgICBjb25zdCBzdG9yZSA9IGdldFN0b3JlKCdtYW5pZmVzdC1wbGFjZXMtdG9rZW5zJyk7XG5cbiAgICAgICAgLy8gQ2FsY3VsZXIgbGVzIHRpbWVzdGFtcHNcbiAgICAgICAgY29uc3Qgc3RhcnRUaW1lID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7IC8vIFRpbWVzdGFtcCBVbml4IGVuIHNlY29uZGVzXG4gICAgICAgIGNvbnN0IGV4cGlyZXNBdCA9IHN0YXJ0VGltZSArICg3ICogMjQgKiA2MCAqIDYwKTsgLy8gNyBqb3VycyBlbiBzZWNvbmRlcyAoMTY4IGhldXJlcylcblxuICAgICAgICAvLyBQclx1MDBFOXBhcmVyIGxlcyBkb25uXHUwMEU5ZXMgXHUwMEUwIHN0b2NrZXJcbiAgICAgICAgY29uc3QgdG9rZW5EYXRhID0ge1xuICAgICAgICAgICAgdG9rZW46IHRva2VuLFxuICAgICAgICAgICAgZW1haWw6IGVtYWlsLFxuICAgICAgICAgICAgc3RhcnRUaW1lOiBzdGFydFRpbWUsXG4gICAgICAgICAgICBleHBpcmVzQXQ6IGV4cGlyZXNBdCxcbiAgICAgICAgICAgIGluaXRpYWxQbGFjZXM6IDI3LFxuICAgICAgICAgICAgY3JlYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBTdG9ja2VyIGRhbnMgTmV0bGlmeSBCbG9icyAobGEgY2xcdTAwRTkgZXN0IGxlIHRva2VuKVxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgc3RvcmUuc2V0KHRva2VuLCBKU09OLnN0cmluZ2lmeSh0b2tlbkRhdGEpLCB7XG4gICAgICAgICAgICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgZW1haWw6IGVtYWlsLFxuICAgICAgICAgICAgICAgICAgICBleHBpcmVzQXQ6IGV4cGlyZXNBdC50b1N0cmluZygpLFxuICAgICAgICAgICAgICAgICAgICBpbml0aWFsUGxhY2VzOiAnMjcnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnXHUyNzA1IFRva2VuIHN0b3JlZCBzdWNjZXNzZnVsbHkgaW4gQmxvYnM6JywgdG9rZW4pO1xuICAgICAgICB9IGNhdGNoIChzdG9yZUVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdcdTI3NEMgRXJyb3Igc3RvcmluZyB0b2tlbiBpbiBCbG9iczonLCBzdG9yZUVycm9yKTtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1N0b3JlIGVycm9yIGRldGFpbHM6Jywge1xuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IHN0b3JlRXJyb3IubWVzc2FnZSxcbiAgICAgICAgICAgICAgICBzdGFjazogc3RvcmVFcnJvci5zdGFjayxcbiAgICAgICAgICAgICAgICBuYW1lOiBzdG9yZUVycm9yLm5hbWVcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhyb3cgc3RvcmVFcnJvcjtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICAgIHRva2VuOiB0b2tlbixcbiAgICAgICAgICAgIHN0YXJ0VGltZTogc3RhcnRUaW1lLFxuICAgICAgICAgICAgZXhwaXJlc0F0OiBleHBpcmVzQXQsXG4gICAgICAgICAgICBpbml0aWFsUGxhY2VzOiAyN1xuICAgICAgICB9KSwge1xuICAgICAgICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignXHUyNzRDIEVycm9yIGluIGluaXQtcGxhY2VzLW1hbmlmZXN0OicsIGVycm9yKTtcbiAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZGV0YWlsczonLCB7XG4gICAgICAgICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxuICAgICAgICAgICAgc3RhY2s6IGVycm9yLnN0YWNrLFxuICAgICAgICAgICAgbmFtZTogZXJyb3IubmFtZVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IFxuICAgICAgICAgICAgZXJyb3I6ICdFcnJldXIgc2VydmV1cicsXG4gICAgICAgICAgICBkZXRhaWxzOiBwcm9jZXNzLmVudi5ORVRMSUZZX0RFViA/IGVycm9yLm1lc3NhZ2UgOiB1bmRlZmluZWRcbiAgICAgICAgfSksIHtcbiAgICAgICAgICAgIHN0YXR1czogNTAwLFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG59O1xuXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7O0FBSUEsU0FBUyxnQkFBZ0I7QUFFekIsSUFBTywrQkFBUSxPQUFPLEtBQUssWUFBWTtBQUVuQyxNQUFJLElBQUksV0FBVyxXQUFXO0FBQzFCLFdBQU8sSUFBSSxTQUFTLE1BQU07QUFBQSxNQUN0QixRQUFRO0FBQUEsTUFDUixTQUFTO0FBQUEsUUFDTCwrQkFBK0I7QUFBQSxRQUMvQixnQ0FBZ0M7QUFBQSxRQUNoQyxnQ0FBZ0M7QUFBQSxNQUNwQztBQUFBLElBQ0osQ0FBQztBQUFBLEVBQ0w7QUFFQSxNQUFJLElBQUksV0FBVyxRQUFRO0FBQ3ZCLFdBQU8sSUFBSSxTQUFTLEtBQUssVUFBVSxFQUFFLE9BQU8scUJBQXFCLENBQUMsR0FBRztBQUFBLE1BQ2pFLFFBQVE7QUFBQSxNQUNSLFNBQVM7QUFBQSxRQUNMLCtCQUErQjtBQUFBLFFBQy9CLGdCQUFnQjtBQUFBLE1BQ3BCO0FBQUEsSUFDSixDQUFDO0FBQUEsRUFDTDtBQUVBLE1BQUk7QUFDQSxVQUFNLEVBQUUsT0FBTyxNQUFNLElBQUksTUFBTSxJQUFJLEtBQUs7QUFFeEMsUUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPO0FBQ2xCLGFBQU8sSUFBSSxTQUFTLEtBQUssVUFBVSxFQUFFLE9BQU8sd0JBQXdCLENBQUMsR0FBRztBQUFBLFFBQ3BFLFFBQVE7QUFBQSxRQUNSLFNBQVM7QUFBQSxVQUNMLCtCQUErQjtBQUFBLFVBQy9CLGdCQUFnQjtBQUFBLFFBQ3BCO0FBQUEsTUFDSixDQUFDO0FBQUEsSUFDTDtBQUVBLFlBQVEsSUFBSSxrREFBa0QsT0FBTyxVQUFVLEtBQUs7QUFHcEYsVUFBTSxRQUFRLFNBQVMsd0JBQXdCO0FBRy9DLFVBQU0sWUFBWSxLQUFLLE1BQU0sS0FBSyxJQUFJLElBQUksR0FBSTtBQUM5QyxVQUFNLFlBQVksWUFBYSxJQUFJLEtBQUssS0FBSztBQUc3QyxVQUFNLFlBQVk7QUFBQSxNQUNkO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQSxlQUFlO0FBQUEsTUFDZixZQUFXLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQUEsSUFDdEM7QUFHQSxRQUFJO0FBQ0EsWUFBTSxNQUFNLElBQUksT0FBTyxLQUFLLFVBQVUsU0FBUyxHQUFHO0FBQUEsUUFDOUMsVUFBVTtBQUFBLFVBQ047QUFBQSxVQUNBLFdBQVcsVUFBVSxTQUFTO0FBQUEsVUFDOUIsZUFBZTtBQUFBLFFBQ25CO0FBQUEsTUFDSixDQUFDO0FBQ0QsY0FBUSxJQUFJLDhDQUF5QyxLQUFLO0FBQUEsSUFDOUQsU0FBUyxZQUFZO0FBQ2pCLGNBQVEsTUFBTSx3Q0FBbUMsVUFBVTtBQUMzRCxjQUFRLE1BQU0sd0JBQXdCO0FBQUEsUUFDbEMsU0FBUyxXQUFXO0FBQUEsUUFDcEIsT0FBTyxXQUFXO0FBQUEsUUFDbEIsTUFBTSxXQUFXO0FBQUEsTUFDckIsQ0FBQztBQUNELFlBQU07QUFBQSxJQUNWO0FBRUEsV0FBTyxJQUFJLFNBQVMsS0FBSyxVQUFVO0FBQUEsTUFDL0IsU0FBUztBQUFBLE1BQ1Q7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0EsZUFBZTtBQUFBLElBQ25CLENBQUMsR0FBRztBQUFBLE1BQ0EsUUFBUTtBQUFBLE1BQ1IsU0FBUztBQUFBLFFBQ0wsK0JBQStCO0FBQUEsUUFDL0IsZ0JBQWdCO0FBQUEsTUFDcEI7QUFBQSxJQUNKLENBQUM7QUFBQSxFQUVMLFNBQVMsT0FBTztBQUNaLFlBQVEsTUFBTSx5Q0FBb0MsS0FBSztBQUN2RCxZQUFRLE1BQU0sa0JBQWtCO0FBQUEsTUFDNUIsU0FBUyxNQUFNO0FBQUEsTUFDZixPQUFPLE1BQU07QUFBQSxNQUNiLE1BQU0sTUFBTTtBQUFBLElBQ2hCLENBQUM7QUFDRCxXQUFPLElBQUksU0FBUyxLQUFLLFVBQVU7QUFBQSxNQUMvQixPQUFPO0FBQUEsTUFDUCxTQUFTLFFBQVEsSUFBSSxjQUFjLE1BQU0sVUFBVTtBQUFBLElBQ3ZELENBQUMsR0FBRztBQUFBLE1BQ0EsUUFBUTtBQUFBLE1BQ1IsU0FBUztBQUFBLFFBQ0wsK0JBQStCO0FBQUEsUUFDL0IsZ0JBQWdCO0FBQUEsTUFDcEI7QUFBQSxJQUNKLENBQUM7QUFBQSxFQUNMO0FBQ0o7IiwKICAibmFtZXMiOiBbXQp9Cg==
