
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


// netlify/functions/init-countdown.js
import { getStore } from "@netlify/blobs";
var init_countdown_default = async (req, context) => {
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
    console.log("Initializing countdown for token:", token, "email:", email);
    const store = getStore("countdown-tokens");
    const startTime = Math.floor(Date.now() / 1e3);
    const expiresAt = startTime + 7 * 24 * 60 * 60;
    const tokenData = {
      token,
      email,
      startTime,
      expiresAt,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    try {
      await store.set(token, JSON.stringify(tokenData), {
        metadata: {
          email,
          expiresAt: expiresAt.toString()
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
      expiresAt
    }), {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("\u274C Error in init-countdown:", error);
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
  init_countdown_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9mdW5jdGlvbnMvaW5pdC1jb3VudGRvd24uanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEZvbmN0aW9uIE5ldGxpZnkgcG91ciBpbml0aWFsaXNlciBsZSBjb3VudGRvd24gZGUgNyBqb3Vyc1xuLy8gVXRpbGlzZSBOZXRsaWZ5IEJsb2JzIHBvdXIgc3RvY2tlciBsZXMgZG9ublx1MDBFOWVzXG5cbmltcG9ydCB7IGdldFN0b3JlIH0gZnJvbSAnQG5ldGxpZnkvYmxvYnMnO1xuXG5leHBvcnQgZGVmYXVsdCBhc3luYyAocmVxLCBjb250ZXh0KSA9PiB7XG4gICAgLy8gR1x1MDBFOXJlciBsZXMgcmVxdVx1MDBFQXRlcyBPUFRJT05TIHBvdXIgQ09SU1xuICAgIGlmIChyZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShudWxsLCB7XG4gICAgICAgICAgICBzdGF0dXM6IDIwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJ0NvbnRlbnQtVHlwZScsXG4gICAgICAgICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnUE9TVCwgT1BUSU9OUydcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKHJlcS5tZXRob2QgIT09ICdQT1NUJykge1xuICAgICAgICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdNZXRob2Qgbm90IGFsbG93ZWQnIH0pLCB7XG4gICAgICAgICAgICBzdGF0dXM6IDQwNSxcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgeyB0b2tlbiwgZW1haWwgfSA9IGF3YWl0IHJlcS5qc29uKCk7XG5cbiAgICAgICAgaWYgKCF0b2tlbiB8fCAhZW1haWwpIHtcbiAgICAgICAgICAgIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1Rva2VuIGV0IGVtYWlsIHJlcXVpcycgfSksIHtcbiAgICAgICAgICAgICAgICBzdGF0dXM6IDQwMCxcbiAgICAgICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAgICAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUubG9nKCdJbml0aWFsaXppbmcgY291bnRkb3duIGZvciB0b2tlbjonLCB0b2tlbiwgJ2VtYWlsOicsIGVtYWlsKTtcblxuICAgICAgICAvLyBPYnRlbmlyIGxlIHN0b3JlIE5ldGxpZnkgQmxvYnMgYXZlYyBsZSBjb250ZXh0ZSBhdXRvbWF0aXF1ZVxuICAgICAgICBjb25zdCBzdG9yZSA9IGdldFN0b3JlKCdjb3VudGRvd24tdG9rZW5zJyk7XG5cbiAgICAgICAgLy8gQ2FsY3VsZXIgbGVzIHRpbWVzdGFtcHNcbiAgICAgICAgY29uc3Qgc3RhcnRUaW1lID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7IC8vIFRpbWVzdGFtcCBVbml4IGVuIHNlY29uZGVzXG4gICAgICAgIGNvbnN0IGV4cGlyZXNBdCA9IHN0YXJ0VGltZSArICg3ICogMjQgKiA2MCAqIDYwKTsgLy8gNyBqb3VycyBlbiBzZWNvbmRlc1xuXG4gICAgICAgIC8vIFByXHUwMEU5cGFyZXIgbGVzIGRvbm5cdTAwRTllcyBcdTAwRTAgc3RvY2tlclxuICAgICAgICBjb25zdCB0b2tlbkRhdGEgPSB7XG4gICAgICAgICAgICB0b2tlbjogdG9rZW4sXG4gICAgICAgICAgICBlbWFpbDogZW1haWwsXG4gICAgICAgICAgICBzdGFydFRpbWU6IHN0YXJ0VGltZSxcbiAgICAgICAgICAgIGV4cGlyZXNBdDogZXhwaXJlc0F0LFxuICAgICAgICAgICAgY3JlYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBTdG9ja2VyIGRhbnMgTmV0bGlmeSBCbG9icyAobGEgY2xcdTAwRTkgZXN0IGxlIHRva2VuKVxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgc3RvcmUuc2V0KHRva2VuLCBKU09OLnN0cmluZ2lmeSh0b2tlbkRhdGEpLCB7XG4gICAgICAgICAgICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgZW1haWw6IGVtYWlsLFxuICAgICAgICAgICAgICAgICAgICBleHBpcmVzQXQ6IGV4cGlyZXNBdC50b1N0cmluZygpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnXHUyNzA1IFRva2VuIHN0b3JlZCBzdWNjZXNzZnVsbHkgaW4gQmxvYnM6JywgdG9rZW4pO1xuICAgICAgICB9IGNhdGNoIChzdG9yZUVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdcdTI3NEMgRXJyb3Igc3RvcmluZyB0b2tlbiBpbiBCbG9iczonLCBzdG9yZUVycm9yKTtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1N0b3JlIGVycm9yIGRldGFpbHM6Jywge1xuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IHN0b3JlRXJyb3IubWVzc2FnZSxcbiAgICAgICAgICAgICAgICBzdGFjazogc3RvcmVFcnJvci5zdGFjayxcbiAgICAgICAgICAgICAgICBuYW1lOiBzdG9yZUVycm9yLm5hbWVcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhyb3cgc3RvcmVFcnJvcjtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICAgIHRva2VuOiB0b2tlbixcbiAgICAgICAgICAgIHN0YXJ0VGltZTogc3RhcnRUaW1lLFxuICAgICAgICAgICAgZXhwaXJlc0F0OiBleHBpcmVzQXRcbiAgICAgICAgfSksIHtcbiAgICAgICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1x1Mjc0QyBFcnJvciBpbiBpbml0LWNvdW50ZG93bjonLCBlcnJvcik7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGRldGFpbHM6Jywge1xuICAgICAgICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcbiAgICAgICAgICAgIHN0YWNrOiBlcnJvci5zdGFjayxcbiAgICAgICAgICAgIG5hbWU6IGVycm9yLm5hbWVcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBcbiAgICAgICAgICAgIGVycm9yOiAnRXJyZXVyIHNlcnZldXInLFxuICAgICAgICAgICAgZGV0YWlsczogcHJvY2Vzcy5lbnYuTkVUTElGWV9ERVYgPyBlcnJvci5tZXNzYWdlIDogdW5kZWZpbmVkXG4gICAgICAgIH0pLCB7XG4gICAgICAgICAgICBzdGF0dXM6IDUwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7QUFHQSxTQUFTLGdCQUFnQjtBQUV6QixJQUFPLHlCQUFRLE9BQU8sS0FBSyxZQUFZO0FBRW5DLE1BQUksSUFBSSxXQUFXLFdBQVc7QUFDMUIsV0FBTyxJQUFJLFNBQVMsTUFBTTtBQUFBLE1BQ3RCLFFBQVE7QUFBQSxNQUNSLFNBQVM7QUFBQSxRQUNMLCtCQUErQjtBQUFBLFFBQy9CLGdDQUFnQztBQUFBLFFBQ2hDLGdDQUFnQztBQUFBLE1BQ3BDO0FBQUEsSUFDSixDQUFDO0FBQUEsRUFDTDtBQUVBLE1BQUksSUFBSSxXQUFXLFFBQVE7QUFDdkIsV0FBTyxJQUFJLFNBQVMsS0FBSyxVQUFVLEVBQUUsT0FBTyxxQkFBcUIsQ0FBQyxHQUFHO0FBQUEsTUFDakUsUUFBUTtBQUFBLE1BQ1IsU0FBUztBQUFBLFFBQ0wsK0JBQStCO0FBQUEsUUFDL0IsZ0JBQWdCO0FBQUEsTUFDcEI7QUFBQSxJQUNKLENBQUM7QUFBQSxFQUNMO0FBRUEsTUFBSTtBQUNBLFVBQU0sRUFBRSxPQUFPLE1BQU0sSUFBSSxNQUFNLElBQUksS0FBSztBQUV4QyxRQUFJLENBQUMsU0FBUyxDQUFDLE9BQU87QUFDbEIsYUFBTyxJQUFJLFNBQVMsS0FBSyxVQUFVLEVBQUUsT0FBTyx3QkFBd0IsQ0FBQyxHQUFHO0FBQUEsUUFDcEUsUUFBUTtBQUFBLFFBQ1IsU0FBUztBQUFBLFVBQ0wsK0JBQStCO0FBQUEsVUFDL0IsZ0JBQWdCO0FBQUEsUUFDcEI7QUFBQSxNQUNKLENBQUM7QUFBQSxJQUNMO0FBRUEsWUFBUSxJQUFJLHFDQUFxQyxPQUFPLFVBQVUsS0FBSztBQUd2RSxVQUFNLFFBQVEsU0FBUyxrQkFBa0I7QUFHekMsVUFBTSxZQUFZLEtBQUssTUFBTSxLQUFLLElBQUksSUFBSSxHQUFJO0FBQzlDLFVBQU0sWUFBWSxZQUFhLElBQUksS0FBSyxLQUFLO0FBRzdDLFVBQU0sWUFBWTtBQUFBLE1BQ2Q7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBLFlBQVcsb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFBQSxJQUN0QztBQUdBLFFBQUk7QUFDQSxZQUFNLE1BQU0sSUFBSSxPQUFPLEtBQUssVUFBVSxTQUFTLEdBQUc7QUFBQSxRQUM5QyxVQUFVO0FBQUEsVUFDTjtBQUFBLFVBQ0EsV0FBVyxVQUFVLFNBQVM7QUFBQSxRQUNsQztBQUFBLE1BQ0osQ0FBQztBQUNELGNBQVEsSUFBSSw4Q0FBeUMsS0FBSztBQUFBLElBQzlELFNBQVMsWUFBWTtBQUNqQixjQUFRLE1BQU0sd0NBQW1DLFVBQVU7QUFDM0QsY0FBUSxNQUFNLHdCQUF3QjtBQUFBLFFBQ2xDLFNBQVMsV0FBVztBQUFBLFFBQ3BCLE9BQU8sV0FBVztBQUFBLFFBQ2xCLE1BQU0sV0FBVztBQUFBLE1BQ3JCLENBQUM7QUFDRCxZQUFNO0FBQUEsSUFDVjtBQUVBLFdBQU8sSUFBSSxTQUFTLEtBQUssVUFBVTtBQUFBLE1BQy9CLFNBQVM7QUFBQSxNQUNUO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxJQUNKLENBQUMsR0FBRztBQUFBLE1BQ0EsUUFBUTtBQUFBLE1BQ1IsU0FBUztBQUFBLFFBQ0wsK0JBQStCO0FBQUEsUUFDL0IsZ0JBQWdCO0FBQUEsTUFDcEI7QUFBQSxJQUNKLENBQUM7QUFBQSxFQUVMLFNBQVMsT0FBTztBQUNaLFlBQVEsTUFBTSxtQ0FBOEIsS0FBSztBQUNqRCxZQUFRLE1BQU0sa0JBQWtCO0FBQUEsTUFDNUIsU0FBUyxNQUFNO0FBQUEsTUFDZixPQUFPLE1BQU07QUFBQSxNQUNiLE1BQU0sTUFBTTtBQUFBLElBQ2hCLENBQUM7QUFDRCxXQUFPLElBQUksU0FBUyxLQUFLLFVBQVU7QUFBQSxNQUMvQixPQUFPO0FBQUEsTUFDUCxTQUFTLFFBQVEsSUFBSSxjQUFjLE1BQU0sVUFBVTtBQUFBLElBQ3ZELENBQUMsR0FBRztBQUFBLE1BQ0EsUUFBUTtBQUFBLE1BQ1IsU0FBUztBQUFBLFFBQ0wsK0JBQStCO0FBQUEsUUFDL0IsZ0JBQWdCO0FBQUEsTUFDcEI7QUFBQSxJQUNKLENBQUM7QUFBQSxFQUNMO0FBQ0o7IiwKICAibmFtZXMiOiBbXQp9Cg==
