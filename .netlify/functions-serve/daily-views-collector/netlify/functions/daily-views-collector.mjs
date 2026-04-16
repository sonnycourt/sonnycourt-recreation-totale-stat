
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


// netlify/functions/daily-views-collector.js
import { getStore } from "@netlify/blobs";
async function fetch_views_instagram(account, store) {
  try {
    const username = account.username || account.id;
    console.log(`Collecting Instagram views for account: ${username}`);
    if (!process.env.RAPIDAPI_KEY) {
      console.error("\u274C RAPIDAPI_KEY not configured");
      return 0;
    }
    let totalViews = 0;
    let paginationToken = null;
    let reelCount = 0;
    let requestCount = 0;
    const MAX_REQUESTS = 20;
    do {
      requestCount++;
      const url = new URL("https://instagram-scraper-api2.p.rapidapi.com/v1.2/reels");
      url.searchParams.set("username_or_id_or_url", username);
      if (paginationToken) {
        url.searchParams.set("pagination_token", paginationToken);
      }
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "x-rapidapi-key": process.env.RAPIDAPI_KEY,
          "x-rapidapi-host": "instagram-scraper-api2.p.rapidapi.com"
        }
      });
      if (!response.ok) {
        console.error(`Instagram API error: ${response.status} ${response.statusText}`);
        break;
      }
      const data = await response.json();
      if (data.items && Array.isArray(data.items)) {
        for (const reel of data.items) {
          if (reel.video_play_count) {
            totalViews += parseInt(reel.video_play_count, 10) || 0;
            reelCount++;
          }
        }
      }
      paginationToken = data.pagination_token || data.paging?.cursors?.after || null;
      console.log(`Instagram: Collected ${reelCount} reels, total views so far: ${totalViews} (request ${requestCount})`);
      if (!paginationToken || requestCount >= MAX_REQUESTS) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    } while (paginationToken && requestCount < MAX_REQUESTS);
    console.log(`\u2705 Instagram total views: ${totalViews} (from ${reelCount} reels)`);
    return totalViews;
  } catch (error) {
    console.error("Error fetching Instagram views:", error);
    return 0;
  }
}
async function fetch_views_tiktok(account, store) {
  try {
    const username = account.username || account.id;
    console.log(`Collecting TikTok views for account: ${username}`);
    if (!process.env.RAPIDAPI_KEY) {
      console.error("\u274C RAPIDAPI_KEY not configured");
      return 0;
    }
    const userInfoUrl = new URL("https://tiktok-api23.p.rapidapi.com/api/user/info");
    userInfoUrl.searchParams.set("uniqueId", username);
    const userInfoResponse = await fetch(userInfoUrl.toString(), {
      method: "GET",
      headers: {
        "x-rapidapi-key": process.env.RAPIDAPI_KEY,
        "x-rapidapi-host": "tiktok-api23.p.rapidapi.com"
      }
    });
    if (!userInfoResponse.ok) {
      console.error(`TikTok user info API error: ${userInfoResponse.status} ${userInfoResponse.statusText}`);
      return 0;
    }
    const userInfoData = await userInfoResponse.json();
    const secUid = userInfoData?.data?.userInfo?.user?.secUid || userInfoData?.data?.secUid;
    if (!secUid) {
      console.error("\u274C Could not get secUid from TikTok API");
      return 0;
    }
    console.log(`TikTok secUid retrieved: ${secUid}`);
    let totalViews = 0;
    let cursor = null;
    let videoCount = 0;
    let requestCount = 0;
    const MAX_REQUESTS = 15;
    do {
      requestCount++;
      const postsUrl = new URL("https://tiktok-api23.p.rapidapi.com/api/user/posts");
      postsUrl.searchParams.set("secUid", secUid);
      postsUrl.searchParams.set("count", "35");
      if (cursor) {
        postsUrl.searchParams.set("cursor", cursor);
      }
      const postsResponse = await fetch(postsUrl.toString(), {
        method: "GET",
        headers: {
          "x-rapidapi-key": process.env.RAPIDAPI_KEY,
          "x-rapidapi-host": "tiktok-api23.p.rapidapi.com"
        }
      });
      if (!postsResponse.ok) {
        console.error(`TikTok posts API error: ${postsResponse.status} ${postsResponse.statusText}`);
        break;
      }
      const postsData = await postsResponse.json();
      const videos = postsData?.data?.itemList || postsData?.data?.videos || [];
      for (const video of videos) {
        if (video.stats?.playCount || video.playCount) {
          const playCount = parseInt(video.stats?.playCount || video.playCount, 10) || 0;
          totalViews += playCount;
          videoCount++;
        }
      }
      const nextCursor = postsData?.data?.cursor;
      const hasMore = postsData?.data?.hasMore;
      if (nextCursor && nextCursor !== cursor && hasMore !== false) {
        cursor = nextCursor;
      } else {
        cursor = null;
      }
      console.log(`TikTok: Collected ${videoCount} videos, total views so far: ${totalViews} (request ${requestCount})`);
      if (!cursor || requestCount >= MAX_REQUESTS) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    } while (cursor && requestCount < MAX_REQUESTS);
    console.log(`\u2705 TikTok total views: ${totalViews} (from ${videoCount} videos)`);
    return totalViews;
  } catch (error) {
    console.error("Error fetching TikTok views:", error);
    return 0;
  }
}
async function fetch_views_youtube(account, store) {
  try {
    const channelId = account.channelId || account.id || "MINE";
    console.log(`Collecting YouTube views for channel: ${channelId}`);
    if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET || !process.env.YOUTUBE_REFRESH_TOKEN) {
      console.error("\u274C YouTube OAuth credentials not configured");
      return 0;
    }
    const tokenUrl = "https://oauth2.googleapis.com/token";
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: process.env.YOUTUBE_CLIENT_ID,
        client_secret: process.env.YOUTUBE_CLIENT_SECRET,
        refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
        grant_type: "refresh_token"
      })
    });
    if (!tokenResponse.ok) {
      console.error(`YouTube token refresh error: ${tokenResponse.status} ${tokenResponse.statusText}`);
      return 0;
    }
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      console.error("\u274C Could not get access token from YouTube OAuth");
      return 0;
    }
    console.log("\u2705 YouTube access token refreshed");
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const analyticsUrl = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
    analyticsUrl.searchParams.set("ids", `channel==${channelId === "MINE" ? "MINE" : channelId}`);
    analyticsUrl.searchParams.set("startDate", "2020-01-01");
    analyticsUrl.searchParams.set("endDate", today);
    analyticsUrl.searchParams.set("metrics", "views");
    const analyticsResponse = await fetch(analyticsUrl.toString(), {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`
      }
    });
    if (!analyticsResponse.ok) {
      console.error(`YouTube Analytics API error: ${analyticsResponse.status} ${analyticsResponse.statusText}`);
      const errorText = await analyticsResponse.text();
      console.error("Error details:", errorText);
      return 0;
    }
    const analyticsData = await analyticsResponse.json();
    let totalViews = 0;
    if (analyticsData.rows && Array.isArray(analyticsData.rows)) {
      for (const row of analyticsData.rows) {
        if (row[0]) {
          totalViews += parseInt(row[0], 10) || 0;
        }
      }
    } else if (analyticsData.rows && analyticsData.rows.length > 0 && analyticsData.rows[0].length > 0) {
      totalViews = parseInt(analyticsData.rows[0][0], 10) || 0;
    }
    console.log(`\u2705 YouTube total views: ${totalViews}`);
    return totalViews;
  } catch (error) {
    console.error("Error fetching YouTube views:", error);
    return 0;
  }
}
var daily_views_collector_default = async (req) => {
  try {
    const store = getStore({
      name: "stats-data",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_API_TOKEN
    });
    if (!process.env.NETLIFY_SITE_ID || !process.env.NETLIFY_API_TOKEN) {
      console.error("\u274C Missing NETLIFY_SITE_ID or NETLIFY_API_TOKEN environment variables");
      return new Response(JSON.stringify({
        error: "Missing required environment variables",
        required: ["NETLIFY_SITE_ID", "NETLIFY_API_TOKEN"]
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    let accounts = [];
    try {
      const accountsString = await store.get("accounts");
      if (accountsString) {
        accounts = JSON.parse(accountsString);
        console.log(`\u2705 Loaded ${accounts.length} accounts from blob`);
      } else {
        console.log("\u26A0\uFE0F No accounts found in blob, using empty array");
      }
    } catch (getError) {
      console.error("\u274C Error loading accounts from blob:", getError);
      return new Response(JSON.stringify({
        error: "Failed to load accounts from blob",
        message: getError.message
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    const viewsData = {
      date: today,
      instagram_total_views: 0,
      tiktok_total_views: 0,
      youtube_total_views: 0,
      collectedAt: (/* @__PURE__ */ new Date()).toISOString(),
      from_cron: true
      // Marquer comme venant du cron job
    };
    for (const account of accounts) {
      try {
        switch (account.platform?.toLowerCase()) {
          case "instagram":
            const instagramViews = await fetch_views_instagram(account, store);
            viewsData.instagram_total_views += instagramViews;
            console.log(`\u2705 Instagram views collected: ${instagramViews} (total: ${viewsData.instagram_total_views})`);
            break;
          case "tiktok":
            const tiktokViews = await fetch_views_tiktok(account, store);
            viewsData.tiktok_total_views += tiktokViews;
            console.log(`\u2705 TikTok views collected: ${tiktokViews} (total: ${viewsData.tiktok_total_views})`);
            break;
          case "youtube":
            const youtubeViews = await fetch_views_youtube(account, store);
            viewsData.youtube_total_views += youtubeViews;
            console.log(`\u2705 YouTube views collected: ${youtubeViews} (total: ${viewsData.youtube_total_views})`);
            break;
          default:
            console.warn(`\u26A0\uFE0F Unknown platform: ${account.platform}`);
        }
      } catch (accountError) {
        console.error(`\u274C Error collecting views for ${account.platform} account ${account.username || account.id}:`, accountError);
      }
    }
    let viewsHistory = {};
    try {
      const historyString = await store.get("views-history");
      if (historyString) {
        viewsHistory = JSON.parse(historyString);
      }
    } catch (getError) {
      console.log("No existing views history found, starting fresh");
    }
    viewsHistory[today] = viewsData;
    await store.set("views-history", JSON.stringify(viewsHistory));
    console.log("\u2705 Views history updated in blob");
    return new Response(JSON.stringify({
      success: true,
      date: today,
      data: viewsData,
      accountsProcessed: accounts.length
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("\u274C Error in daily-views-collector:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    return new Response(JSON.stringify({
      error: "Failed to collect views data",
      message: error.message
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
};
export {
  daily_views_collector_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9mdW5jdGlvbnMvZGFpbHktdmlld3MtY29sbGVjdG9yLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBOZXRsaWZ5IEZ1bmN0aW9uOiBEYWlseSB2aWV3cyBjb2xsZWN0b3IgZm9yIEluc3RhZ3JhbSwgVGlrVG9rLCBZb3VUdWJlXG4vLyBDYWxsZWQgZGFpbHkgYnkgY3Jvbi1qb2Iub3JnIHRvIGNvbGxlY3QgYW5kIHN0b3JlIHZpZXdzIGRhdGFcbi8vIFVzZXMgbWFudWFsIE5ldGxpZnkgQmxvYnMgY29uZmlndXJhdGlvbiBmb3IgZXh0ZXJuYWwgY2FsbHNcblxuaW1wb3J0IHsgZ2V0U3RvcmUgfSBmcm9tICdAbmV0bGlmeS9ibG9icyc7XG5cbi8vIEZvbmN0aW9uIHBvdXIgY29sbGVjdGVyIGxlcyB2dWVzIEluc3RhZ3JhbSB2aWEgUmFwaWRBUElcbmFzeW5jIGZ1bmN0aW9uIGZldGNoX3ZpZXdzX2luc3RhZ3JhbShhY2NvdW50LCBzdG9yZSkge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHVzZXJuYW1lID0gYWNjb3VudC51c2VybmFtZSB8fCBhY2NvdW50LmlkO1xuICAgICAgICBjb25zb2xlLmxvZyhgQ29sbGVjdGluZyBJbnN0YWdyYW0gdmlld3MgZm9yIGFjY291bnQ6ICR7dXNlcm5hbWV9YCk7XG5cbiAgICAgICAgaWYgKCFwcm9jZXNzLmVudi5SQVBJREFQSV9LRVkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1x1Mjc0QyBSQVBJREFQSV9LRVkgbm90IGNvbmZpZ3VyZWQnKTtcbiAgICAgICAgICAgIHJldHVybiAwO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHRvdGFsVmlld3MgPSAwO1xuICAgICAgICBsZXQgcGFnaW5hdGlvblRva2VuID0gbnVsbDtcbiAgICAgICAgbGV0IHJlZWxDb3VudCA9IDA7XG4gICAgICAgIGxldCByZXF1ZXN0Q291bnQgPSAwO1xuICAgICAgICBjb25zdCBNQVhfUkVRVUVTVFMgPSAyMDsgLy8gTGltaXRlIGRlIHNcdTAwRTljdXJpdFx1MDBFOSBwb3VyIFx1MDBFOXZpdGVyIGxlcyBib3VjbGVzIGluZmluaWVzICgyMCByZXF1XHUwMEVBdGVzIFx1MDBENyB+MjAgcmVlbHMgPSA0MDAgcmVlbHMgbWF4KVxuXG4gICAgICAgIGRvIHtcbiAgICAgICAgICAgIHJlcXVlc3RDb3VudCsrO1xuICAgICAgICAgICAgY29uc3QgdXJsID0gbmV3IFVSTCgnaHR0cHM6Ly9pbnN0YWdyYW0tc2NyYXBlci1hcGkyLnAucmFwaWRhcGkuY29tL3YxLjIvcmVlbHMnKTtcbiAgICAgICAgICAgIHVybC5zZWFyY2hQYXJhbXMuc2V0KCd1c2VybmFtZV9vcl9pZF9vcl91cmwnLCB1c2VybmFtZSk7XG4gICAgICAgICAgICBpZiAocGFnaW5hdGlvblRva2VuKSB7XG4gICAgICAgICAgICAgICAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ3BhZ2luYXRpb25fdG9rZW4nLCBwYWdpbmF0aW9uVG9rZW4pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKHVybC50b1N0cmluZygpLCB7XG4gICAgICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgICd4LXJhcGlkYXBpLWtleSc6IHByb2Nlc3MuZW52LlJBUElEQVBJX0tFWSxcbiAgICAgICAgICAgICAgICAgICAgJ3gtcmFwaWRhcGktaG9zdCc6ICdpbnN0YWdyYW0tc2NyYXBlci1hcGkyLnAucmFwaWRhcGkuY29tJ1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgSW5zdGFncmFtIEFQSSBlcnJvcjogJHtyZXNwb25zZS5zdGF0dXN9ICR7cmVzcG9uc2Uuc3RhdHVzVGV4dH1gKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKTtcblxuICAgICAgICAgICAgLy8gU29tbWUgdG91cyBsZXMgdmlkZW9fcGxheV9jb3VudFxuICAgICAgICAgICAgaWYgKGRhdGEuaXRlbXMgJiYgQXJyYXkuaXNBcnJheShkYXRhLml0ZW1zKSkge1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcmVlbCBvZiBkYXRhLml0ZW1zKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChyZWVsLnZpZGVvX3BsYXlfY291bnQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRvdGFsVmlld3MgKz0gcGFyc2VJbnQocmVlbC52aWRlb19wbGF5X2NvdW50LCAxMCkgfHwgMDtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZWxDb3VudCsrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBSXHUwMEU5Y3VwXHUwMEU5cmVyIGxlIHRva2VuIGRlIHBhZ2luYXRpb24gcG91ciBsYSBwcm9jaGFpbmUgcGFnZVxuICAgICAgICAgICAgcGFnaW5hdGlvblRva2VuID0gZGF0YS5wYWdpbmF0aW9uX3Rva2VuIHx8IGRhdGEucGFnaW5nPy5jdXJzb3JzPy5hZnRlciB8fCBudWxsO1xuXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgSW5zdGFncmFtOiBDb2xsZWN0ZWQgJHtyZWVsQ291bnR9IHJlZWxzLCB0b3RhbCB2aWV3cyBzbyBmYXI6ICR7dG90YWxWaWV3c30gKHJlcXVlc3QgJHtyZXF1ZXN0Q291bnR9KWApO1xuXG4gICAgICAgICAgICAvLyBBcnJcdTAwRUF0ZXIgc2kgcGFzIGRlIHBhZ2luYXRpb24gdG9rZW4gb3Ugc2kgb24gYXR0ZWludCBsYSBsaW1pdGUgZGUgc1x1MDBFOWN1cml0XHUwMEU5XG4gICAgICAgICAgICBpZiAoIXBhZ2luYXRpb25Ub2tlbiB8fCByZXF1ZXN0Q291bnQgPj0gTUFYX1JFUVVFU1RTKSB7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFBldGl0IGRcdTAwRTlsYWkgZW50cmUgbGVzIHJlcXVcdTAwRUF0ZXMgcG91ciBcdTAwRTl2aXRlciBsZXMgcmF0ZSBsaW1pdHNcbiAgICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCA1MDApKTtcblxuICAgICAgICB9IHdoaWxlIChwYWdpbmF0aW9uVG9rZW4gJiYgcmVxdWVzdENvdW50IDwgTUFYX1JFUVVFU1RTKTtcblxuICAgICAgICBjb25zb2xlLmxvZyhgXHUyNzA1IEluc3RhZ3JhbSB0b3RhbCB2aWV3czogJHt0b3RhbFZpZXdzfSAoZnJvbSAke3JlZWxDb3VudH0gcmVlbHMpYCk7XG4gICAgICAgIHJldHVybiB0b3RhbFZpZXdzO1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZmV0Y2hpbmcgSW5zdGFncmFtIHZpZXdzOicsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgfVxufVxuXG4vLyBGb25jdGlvbiBwb3VyIGNvbGxlY3RlciBsZXMgdnVlcyBUaWtUb2sgdmlhIFJhcGlkQVBJXG5hc3luYyBmdW5jdGlvbiBmZXRjaF92aWV3c190aWt0b2soYWNjb3VudCwgc3RvcmUpIHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCB1c2VybmFtZSA9IGFjY291bnQudXNlcm5hbWUgfHwgYWNjb3VudC5pZDtcbiAgICAgICAgY29uc29sZS5sb2coYENvbGxlY3RpbmcgVGlrVG9rIHZpZXdzIGZvciBhY2NvdW50OiAke3VzZXJuYW1lfWApO1xuXG4gICAgICAgIGlmICghcHJvY2Vzcy5lbnYuUkFQSURBUElfS0VZKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdcdTI3NEMgUkFQSURBUElfS0VZIG5vdCBjb25maWd1cmVkJyk7XG4gICAgICAgICAgICByZXR1cm4gMDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIDEuIFJcdTAwRTljdXBcdTAwRTlyZXIgbGUgc2VjVWlkXG4gICAgICAgIGNvbnN0IHVzZXJJbmZvVXJsID0gbmV3IFVSTCgnaHR0cHM6Ly90aWt0b2stYXBpMjMucC5yYXBpZGFwaS5jb20vYXBpL3VzZXIvaW5mbycpO1xuICAgICAgICB1c2VySW5mb1VybC5zZWFyY2hQYXJhbXMuc2V0KCd1bmlxdWVJZCcsIHVzZXJuYW1lKTtcblxuICAgICAgICBjb25zdCB1c2VySW5mb1Jlc3BvbnNlID0gYXdhaXQgZmV0Y2godXNlckluZm9VcmwudG9TdHJpbmcoKSwge1xuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAneC1yYXBpZGFwaS1rZXknOiBwcm9jZXNzLmVudi5SQVBJREFQSV9LRVksXG4gICAgICAgICAgICAgICAgJ3gtcmFwaWRhcGktaG9zdCc6ICd0aWt0b2stYXBpMjMucC5yYXBpZGFwaS5jb20nXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmICghdXNlckluZm9SZXNwb25zZS5vaykge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgVGlrVG9rIHVzZXIgaW5mbyBBUEkgZXJyb3I6ICR7dXNlckluZm9SZXNwb25zZS5zdGF0dXN9ICR7dXNlckluZm9SZXNwb25zZS5zdGF0dXNUZXh0fWApO1xuICAgICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB1c2VySW5mb0RhdGEgPSBhd2FpdCB1c2VySW5mb1Jlc3BvbnNlLmpzb24oKTtcbiAgICAgICAgY29uc3Qgc2VjVWlkID0gdXNlckluZm9EYXRhPy5kYXRhPy51c2VySW5mbz8udXNlcj8uc2VjVWlkIHx8IHVzZXJJbmZvRGF0YT8uZGF0YT8uc2VjVWlkO1xuXG4gICAgICAgIGlmICghc2VjVWlkKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdcdTI3NEMgQ291bGQgbm90IGdldCBzZWNVaWQgZnJvbSBUaWtUb2sgQVBJJyk7XG4gICAgICAgICAgICByZXR1cm4gMDtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUubG9nKGBUaWtUb2sgc2VjVWlkIHJldHJpZXZlZDogJHtzZWNVaWR9YCk7XG5cbiAgICAgICAgLy8gMi4gUlx1MDBFOWN1cFx1MDBFOXJlciBsZXMgdmlkXHUwMEU5b3MgYXZlYyBwYWdpbmF0aW9uXG4gICAgICAgIGxldCB0b3RhbFZpZXdzID0gMDtcbiAgICAgICAgbGV0IGN1cnNvciA9IG51bGw7XG4gICAgICAgIGxldCB2aWRlb0NvdW50ID0gMDtcbiAgICAgICAgbGV0IHJlcXVlc3RDb3VudCA9IDA7XG4gICAgICAgIGNvbnN0IE1BWF9SRVFVRVNUUyA9IDE1OyAvLyBMaW1pdGUgZGUgc1x1MDBFOWN1cml0XHUwMEU5ICgxNSByZXF1XHUwMEVBdGVzIFx1MDBENyB+MzUgdmlkXHUwMEU5b3MgPSA1MjUgdmlkXHUwMEU5b3MgbWF4KVxuXG4gICAgICAgIGRvIHtcbiAgICAgICAgICAgIHJlcXVlc3RDb3VudCsrO1xuICAgICAgICAgICAgY29uc3QgcG9zdHNVcmwgPSBuZXcgVVJMKCdodHRwczovL3Rpa3Rvay1hcGkyMy5wLnJhcGlkYXBpLmNvbS9hcGkvdXNlci9wb3N0cycpO1xuICAgICAgICAgICAgcG9zdHNVcmwuc2VhcmNoUGFyYW1zLnNldCgnc2VjVWlkJywgc2VjVWlkKTtcbiAgICAgICAgICAgIHBvc3RzVXJsLnNlYXJjaFBhcmFtcy5zZXQoJ2NvdW50JywgJzM1Jyk7XG4gICAgICAgICAgICBpZiAoY3Vyc29yKSB7XG4gICAgICAgICAgICAgICAgcG9zdHNVcmwuc2VhcmNoUGFyYW1zLnNldCgnY3Vyc29yJywgY3Vyc29yKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgcG9zdHNSZXNwb25zZSA9IGF3YWl0IGZldGNoKHBvc3RzVXJsLnRvU3RyaW5nKCksIHtcbiAgICAgICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgJ3gtcmFwaWRhcGkta2V5JzogcHJvY2Vzcy5lbnYuUkFQSURBUElfS0VZLFxuICAgICAgICAgICAgICAgICAgICAneC1yYXBpZGFwaS1ob3N0JzogJ3Rpa3Rvay1hcGkyMy5wLnJhcGlkYXBpLmNvbSdcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgaWYgKCFwb3N0c1Jlc3BvbnNlLm9rKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgVGlrVG9rIHBvc3RzIEFQSSBlcnJvcjogJHtwb3N0c1Jlc3BvbnNlLnN0YXR1c30gJHtwb3N0c1Jlc3BvbnNlLnN0YXR1c1RleHR9YCk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHBvc3RzRGF0YSA9IGF3YWl0IHBvc3RzUmVzcG9uc2UuanNvbigpO1xuXG4gICAgICAgICAgICAvLyBTb21tZSB0b3VzIGxlcyBwbGF5Q291bnRcbiAgICAgICAgICAgIGNvbnN0IHZpZGVvcyA9IHBvc3RzRGF0YT8uZGF0YT8uaXRlbUxpc3QgfHwgcG9zdHNEYXRhPy5kYXRhPy52aWRlb3MgfHwgW107XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHZpZGVvIG9mIHZpZGVvcykge1xuICAgICAgICAgICAgICAgIGlmICh2aWRlby5zdGF0cz8ucGxheUNvdW50IHx8IHZpZGVvLnBsYXlDb3VudCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBwbGF5Q291bnQgPSBwYXJzZUludCh2aWRlby5zdGF0cz8ucGxheUNvdW50IHx8IHZpZGVvLnBsYXlDb3VudCwgMTApIHx8IDA7XG4gICAgICAgICAgICAgICAgICAgIHRvdGFsVmlld3MgKz0gcGxheUNvdW50O1xuICAgICAgICAgICAgICAgICAgICB2aWRlb0NvdW50Kys7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBSXHUwMEU5Y3VwXHUwMEU5cmVyIGxlIGN1cnNvciBwb3VyIGxhIHBhZ2luYXRpb25cbiAgICAgICAgICAgIGNvbnN0IG5leHRDdXJzb3IgPSBwb3N0c0RhdGE/LmRhdGE/LmN1cnNvcjtcbiAgICAgICAgICAgIGNvbnN0IGhhc01vcmUgPSBwb3N0c0RhdGE/LmRhdGE/Lmhhc01vcmU7XG5cbiAgICAgICAgICAgIC8vIE1ldHRyZSBcdTAwRTAgam91ciBsZSBjdXJzb3Igc2V1bGVtZW50IHMnaWwgeSBhIHVuZSB2YWxldXIgdmFsaWRlXG4gICAgICAgICAgICBpZiAobmV4dEN1cnNvciAmJiBuZXh0Q3Vyc29yICE9PSBjdXJzb3IgJiYgaGFzTW9yZSAhPT0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgICBjdXJzb3IgPSBuZXh0Q3Vyc29yO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjdXJzb3IgPSBudWxsOyAvLyBBcnJcdTAwRUF0ZXIgbGEgcGFnaW5hdGlvblxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgVGlrVG9rOiBDb2xsZWN0ZWQgJHt2aWRlb0NvdW50fSB2aWRlb3MsIHRvdGFsIHZpZXdzIHNvIGZhcjogJHt0b3RhbFZpZXdzfSAocmVxdWVzdCAke3JlcXVlc3RDb3VudH0pYCk7XG5cbiAgICAgICAgICAgIC8vIEFyclx1MDBFQXRlciBzaSBwYXMgZGUgY3Vyc29yIG91IHNpIG9uIGF0dGVpbnQgbGEgbGltaXRlIGRlIHNcdTAwRTljdXJpdFx1MDBFOVxuICAgICAgICAgICAgaWYgKCFjdXJzb3IgfHwgcmVxdWVzdENvdW50ID49IE1BWF9SRVFVRVNUUykge1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBQZXRpdCBkXHUwMEU5bGFpIGVudHJlIGxlcyByZXF1XHUwMEVBdGVzIHBvdXIgXHUwMEU5dml0ZXIgbGVzIHJhdGUgbGltaXRzXG4gICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgNTAwKSk7XG5cbiAgICAgICAgfSB3aGlsZSAoY3Vyc29yICYmIHJlcXVlc3RDb3VudCA8IE1BWF9SRVFVRVNUUyk7XG5cbiAgICAgICAgY29uc29sZS5sb2coYFx1MjcwNSBUaWtUb2sgdG90YWwgdmlld3M6ICR7dG90YWxWaWV3c30gKGZyb20gJHt2aWRlb0NvdW50fSB2aWRlb3MpYCk7XG4gICAgICAgIHJldHVybiB0b3RhbFZpZXdzO1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZmV0Y2hpbmcgVGlrVG9rIHZpZXdzOicsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgfVxufVxuXG4vLyBGb25jdGlvbiBwb3VyIGNvbGxlY3RlciBsZXMgdnVlcyBZb3VUdWJlIHZpYSBPQXV0aCBldCBBbmFseXRpY3MgQVBJXG5hc3luYyBmdW5jdGlvbiBmZXRjaF92aWV3c195b3V0dWJlKGFjY291bnQsIHN0b3JlKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgY2hhbm5lbElkID0gYWNjb3VudC5jaGFubmVsSWQgfHwgYWNjb3VudC5pZCB8fCAnTUlORSc7XG4gICAgICAgIGNvbnNvbGUubG9nKGBDb2xsZWN0aW5nIFlvdVR1YmUgdmlld3MgZm9yIGNoYW5uZWw6ICR7Y2hhbm5lbElkfWApO1xuXG4gICAgICAgIGlmICghcHJvY2Vzcy5lbnYuWU9VVFVCRV9DTElFTlRfSUQgfHwgIXByb2Nlc3MuZW52LllPVVRVQkVfQ0xJRU5UX1NFQ1JFVCB8fCAhcHJvY2Vzcy5lbnYuWU9VVFVCRV9SRUZSRVNIX1RPS0VOKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdcdTI3NEMgWW91VHViZSBPQXV0aCBjcmVkZW50aWFscyBub3QgY29uZmlndXJlZCcpO1xuICAgICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgIH1cblxuICAgICAgICAvLyAxLiBSZWZyZXNoIGxlIHRva2VuIE9BdXRoXG4gICAgICAgIGNvbnN0IHRva2VuVXJsID0gJ2h0dHBzOi8vb2F1dGgyLmdvb2dsZWFwaXMuY29tL3Rva2VuJztcbiAgICAgICAgY29uc3QgdG9rZW5SZXNwb25zZSA9IGF3YWl0IGZldGNoKHRva2VuVXJsLCB7XG4gICAgICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCdcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBib2R5OiBuZXcgVVJMU2VhcmNoUGFyYW1zKHtcbiAgICAgICAgICAgICAgICBjbGllbnRfaWQ6IHByb2Nlc3MuZW52LllPVVRVQkVfQ0xJRU5UX0lELFxuICAgICAgICAgICAgICAgIGNsaWVudF9zZWNyZXQ6IHByb2Nlc3MuZW52LllPVVRVQkVfQ0xJRU5UX1NFQ1JFVCxcbiAgICAgICAgICAgICAgICByZWZyZXNoX3Rva2VuOiBwcm9jZXNzLmVudi5ZT1VUVUJFX1JFRlJFU0hfVE9LRU4sXG4gICAgICAgICAgICAgICAgZ3JhbnRfdHlwZTogJ3JlZnJlc2hfdG9rZW4nXG4gICAgICAgICAgICB9KVxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoIXRva2VuUmVzcG9uc2Uub2spIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFlvdVR1YmUgdG9rZW4gcmVmcmVzaCBlcnJvcjogJHt0b2tlblJlc3BvbnNlLnN0YXR1c30gJHt0b2tlblJlc3BvbnNlLnN0YXR1c1RleHR9YCk7XG4gICAgICAgICAgICByZXR1cm4gMDtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHRva2VuRGF0YSA9IGF3YWl0IHRva2VuUmVzcG9uc2UuanNvbigpO1xuICAgICAgICBjb25zdCBhY2Nlc3NUb2tlbiA9IHRva2VuRGF0YS5hY2Nlc3NfdG9rZW47XG5cbiAgICAgICAgaWYgKCFhY2Nlc3NUb2tlbikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignXHUyNzRDIENvdWxkIG5vdCBnZXQgYWNjZXNzIHRva2VuIGZyb20gWW91VHViZSBPQXV0aCcpO1xuICAgICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmxvZygnXHUyNzA1IFlvdVR1YmUgYWNjZXNzIHRva2VuIHJlZnJlc2hlZCcpO1xuXG4gICAgICAgIC8vIDIuIEFwcGVsIEFuYWx5dGljcyBBUEkgcG91ciByXHUwMEU5Y3VwXHUwMEU5cmVyIGxlcyB2dWVzIHRvdGFsZXNcbiAgICAgICAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXTtcbiAgICAgICAgY29uc3QgYW5hbHl0aWNzVXJsID0gbmV3IFVSTCgnaHR0cHM6Ly95b3V0dWJlYW5hbHl0aWNzLmdvb2dsZWFwaXMuY29tL3YyL3JlcG9ydHMnKTtcbiAgICAgICAgYW5hbHl0aWNzVXJsLnNlYXJjaFBhcmFtcy5zZXQoJ2lkcycsIGBjaGFubmVsPT0ke2NoYW5uZWxJZCA9PT0gJ01JTkUnID8gJ01JTkUnIDogY2hhbm5lbElkfWApO1xuICAgICAgICBhbmFseXRpY3NVcmwuc2VhcmNoUGFyYW1zLnNldCgnc3RhcnREYXRlJywgJzIwMjAtMDEtMDEnKTtcbiAgICAgICAgYW5hbHl0aWNzVXJsLnNlYXJjaFBhcmFtcy5zZXQoJ2VuZERhdGUnLCB0b2RheSk7XG4gICAgICAgIGFuYWx5dGljc1VybC5zZWFyY2hQYXJhbXMuc2V0KCdtZXRyaWNzJywgJ3ZpZXdzJyk7XG5cbiAgICAgICAgY29uc3QgYW5hbHl0aWNzUmVzcG9uc2UgPSBhd2FpdCBmZXRjaChhbmFseXRpY3NVcmwudG9TdHJpbmcoKSwge1xuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAnQXV0aG9yaXphdGlvbic6IGBCZWFyZXIgJHthY2Nlc3NUb2tlbn1gXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmICghYW5hbHl0aWNzUmVzcG9uc2Uub2spIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFlvdVR1YmUgQW5hbHl0aWNzIEFQSSBlcnJvcjogJHthbmFseXRpY3NSZXNwb25zZS5zdGF0dXN9ICR7YW5hbHl0aWNzUmVzcG9uc2Uuc3RhdHVzVGV4dH1gKTtcbiAgICAgICAgICAgIGNvbnN0IGVycm9yVGV4dCA9IGF3YWl0IGFuYWx5dGljc1Jlc3BvbnNlLnRleHQoKTtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGRldGFpbHM6JywgZXJyb3JUZXh0KTtcbiAgICAgICAgICAgIHJldHVybiAwO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYW5hbHl0aWNzRGF0YSA9IGF3YWl0IGFuYWx5dGljc1Jlc3BvbnNlLmpzb24oKTtcblxuICAgICAgICAvLyBFeHRyYWlyZSBsZSB0b3RhbCBkZXMgdnVlc1xuICAgICAgICBsZXQgdG90YWxWaWV3cyA9IDA7XG4gICAgICAgIGlmIChhbmFseXRpY3NEYXRhLnJvd3MgJiYgQXJyYXkuaXNBcnJheShhbmFseXRpY3NEYXRhLnJvd3MpKSB7XG4gICAgICAgICAgICAvLyBMZXMgcm93cyBjb250aWVubmVudCBsZXMgZG9ublx1MDBFOWVzIHBhciBwXHUwMEU5cmlvZGUsIG9uIHNvbW1lIHRvdXRcbiAgICAgICAgICAgIGZvciAoY29uc3Qgcm93IG9mIGFuYWx5dGljc0RhdGEucm93cykge1xuICAgICAgICAgICAgICAgIGlmIChyb3dbMF0pIHtcbiAgICAgICAgICAgICAgICAgICAgdG90YWxWaWV3cyArPSBwYXJzZUludChyb3dbMF0sIDEwKSB8fCAwO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChhbmFseXRpY3NEYXRhLnJvd3MgJiYgYW5hbHl0aWNzRGF0YS5yb3dzLmxlbmd0aCA+IDAgJiYgYW5hbHl0aWNzRGF0YS5yb3dzWzBdLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIC8vIFNpIGMnZXN0IHVuIHRhYmxlYXUgc2ltcGxlXG4gICAgICAgICAgICB0b3RhbFZpZXdzID0gcGFyc2VJbnQoYW5hbHl0aWNzRGF0YS5yb3dzWzBdWzBdLCAxMCkgfHwgMDtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUubG9nKGBcdTI3MDUgWW91VHViZSB0b3RhbCB2aWV3czogJHt0b3RhbFZpZXdzfWApO1xuICAgICAgICByZXR1cm4gdG90YWxWaWV3cztcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGZldGNoaW5nIFlvdVR1YmUgdmlld3M6JywgZXJyb3IpO1xuICAgICAgICByZXR1cm4gMDtcbiAgICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IGFzeW5jIChyZXEpID0+IHtcbiAgICB0cnkge1xuICAgICAgICAvLyBDb25maWd1cmF0aW9uIG1hbnVlbGxlIGR1IHN0b3JlIE5ldGxpZnkgQmxvYnMgcG91ciBsZXMgYXBwZWxzIGV4dGVybmVzXG4gICAgICAgIGNvbnN0IHN0b3JlID0gZ2V0U3RvcmUoe1xuICAgICAgICAgICAgbmFtZTogJ3N0YXRzLWRhdGEnLFxuICAgICAgICAgICAgc2l0ZUlEOiBwcm9jZXNzLmVudi5ORVRMSUZZX1NJVEVfSUQsXG4gICAgICAgICAgICB0b2tlbjogcHJvY2Vzcy5lbnYuTkVUTElGWV9BUElfVE9LRU4sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFZcdTAwRTlyaWZpZXIgcXVlIGxlcyB2YXJpYWJsZXMgZCdlbnZpcm9ubmVtZW50IHNvbnQgY29uZmlndXJcdTAwRTllc1xuICAgICAgICBpZiAoIXByb2Nlc3MuZW52Lk5FVExJRllfU0lURV9JRCB8fCAhcHJvY2Vzcy5lbnYuTkVUTElGWV9BUElfVE9LRU4pIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1x1Mjc0QyBNaXNzaW5nIE5FVExJRllfU0lURV9JRCBvciBORVRMSUZZX0FQSV9UT0tFTiBlbnZpcm9ubWVudCB2YXJpYWJsZXMnKTtcbiAgICAgICAgICAgIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBcbiAgICAgICAgICAgICAgICBlcnJvcjogJ01pc3NpbmcgcmVxdWlyZWQgZW52aXJvbm1lbnQgdmFyaWFibGVzJyxcbiAgICAgICAgICAgICAgICByZXF1aXJlZDogWydORVRMSUZZX1NJVEVfSUQnLCAnTkVUTElGWV9BUElfVE9LRU4nXVxuICAgICAgICAgICAgfSksIHtcbiAgICAgICAgICAgICAgICBzdGF0dXM6IDUwMCxcbiAgICAgICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0b2RheSA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zcGxpdCgnVCcpWzBdOyAvLyBZWVlZLU1NLUREXG5cbiAgICAgICAgLy8gMS4gQ2hhcmdlciBsZXMgY29tcHRlcyBkZXB1aXMgbGUgYmxvYiBcInN0YXRzLWRhdGFcIiBzb3VzIGxhIGNsXHUwMEU5IFwiYWNjb3VudHNcIlxuICAgICAgICBsZXQgYWNjb3VudHMgPSBbXTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGFjY291bnRzU3RyaW5nID0gYXdhaXQgc3RvcmUuZ2V0KCdhY2NvdW50cycpO1xuICAgICAgICAgICAgaWYgKGFjY291bnRzU3RyaW5nKSB7XG4gICAgICAgICAgICAgICAgYWNjb3VudHMgPSBKU09OLnBhcnNlKGFjY291bnRzU3RyaW5nKTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgXHUyNzA1IExvYWRlZCAke2FjY291bnRzLmxlbmd0aH0gYWNjb3VudHMgZnJvbSBibG9iYCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdcdTI2QTBcdUZFMEYgTm8gYWNjb3VudHMgZm91bmQgaW4gYmxvYiwgdXNpbmcgZW1wdHkgYXJyYXknKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZ2V0RXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1x1Mjc0QyBFcnJvciBsb2FkaW5nIGFjY291bnRzIGZyb20gYmxvYjonLCBnZXRFcnJvcik7XG4gICAgICAgICAgICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgXG4gICAgICAgICAgICAgICAgZXJyb3I6ICdGYWlsZWQgdG8gbG9hZCBhY2NvdW50cyBmcm9tIGJsb2InLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGdldEVycm9yLm1lc3NhZ2VcbiAgICAgICAgICAgIH0pLCB7XG4gICAgICAgICAgICAgICAgc3RhdHVzOiA1MDAsXG4gICAgICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gMi4gQ29sbGVjdGVyIGxlcyB2dWVzIHBvdXIgY2hhcXVlIHBsYXRlZm9ybWVcbiAgICAgICAgY29uc3Qgdmlld3NEYXRhID0ge1xuICAgICAgICAgICAgZGF0ZTogdG9kYXksXG4gICAgICAgICAgICBpbnN0YWdyYW1fdG90YWxfdmlld3M6IDAsXG4gICAgICAgICAgICB0aWt0b2tfdG90YWxfdmlld3M6IDAsXG4gICAgICAgICAgICB5b3V0dWJlX3RvdGFsX3ZpZXdzOiAwLFxuICAgICAgICAgICAgY29sbGVjdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIGZyb21fY3JvbjogdHJ1ZSAgLy8gTWFycXVlciBjb21tZSB2ZW5hbnQgZHUgY3JvbiBqb2JcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBDb2xsZWN0ZXIgbGVzIHZ1ZXMgcG91ciBjaGFxdWUgY29tcHRlXG4gICAgICAgIGZvciAoY29uc3QgYWNjb3VudCBvZiBhY2NvdW50cykge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBzd2l0Y2ggKGFjY291bnQucGxhdGZvcm0/LnRvTG93ZXJDYXNlKCkpIHtcbiAgICAgICAgICAgICAgICAgICAgY2FzZSAnaW5zdGFncmFtJzpcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGluc3RhZ3JhbVZpZXdzID0gYXdhaXQgZmV0Y2hfdmlld3NfaW5zdGFncmFtKGFjY291bnQsIHN0b3JlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZpZXdzRGF0YS5pbnN0YWdyYW1fdG90YWxfdmlld3MgKz0gaW5zdGFncmFtVmlld3M7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgXHUyNzA1IEluc3RhZ3JhbSB2aWV3cyBjb2xsZWN0ZWQ6ICR7aW5zdGFncmFtVmlld3N9ICh0b3RhbDogJHt2aWV3c0RhdGEuaW5zdGFncmFtX3RvdGFsX3ZpZXdzfSlgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgY2FzZSAndGlrdG9rJzpcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRpa3Rva1ZpZXdzID0gYXdhaXQgZmV0Y2hfdmlld3NfdGlrdG9rKGFjY291bnQsIHN0b3JlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZpZXdzRGF0YS50aWt0b2tfdG90YWxfdmlld3MgKz0gdGlrdG9rVmlld3M7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgXHUyNzA1IFRpa1RvayB2aWV3cyBjb2xsZWN0ZWQ6ICR7dGlrdG9rVmlld3N9ICh0b3RhbDogJHt2aWV3c0RhdGEudGlrdG9rX3RvdGFsX3ZpZXdzfSlgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgY2FzZSAneW91dHViZSc6XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB5b3V0dWJlVmlld3MgPSBhd2FpdCBmZXRjaF92aWV3c195b3V0dWJlKGFjY291bnQsIHN0b3JlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZpZXdzRGF0YS55b3V0dWJlX3RvdGFsX3ZpZXdzICs9IHlvdXR1YmVWaWV3cztcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBcdTI3MDUgWW91VHViZSB2aWV3cyBjb2xsZWN0ZWQ6ICR7eW91dHViZVZpZXdzfSAodG90YWw6ICR7dmlld3NEYXRhLnlvdXR1YmVfdG90YWxfdmlld3N9KWApO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS53YXJuKGBcdTI2QTBcdUZFMEYgVW5rbm93biBwbGF0Zm9ybTogJHthY2NvdW50LnBsYXRmb3JtfWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gY2F0Y2ggKGFjY291bnRFcnJvcikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFx1Mjc0QyBFcnJvciBjb2xsZWN0aW5nIHZpZXdzIGZvciAke2FjY291bnQucGxhdGZvcm19IGFjY291bnQgJHthY2NvdW50LnVzZXJuYW1lIHx8IGFjY291bnQuaWR9OmAsIGFjY291bnRFcnJvcik7XG4gICAgICAgICAgICAgICAgLy8gQ29udGludWUgYXZlYyBsZXMgYXV0cmVzIGNvbXB0ZXMgbVx1MDBFQW1lIGVuIGNhcyBkJ2VycmV1clxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gMy4gU2F1dmVnYXJkZXIgbGVzIHRvdGF1eCBkYW5zIGwnaGlzdG9yaXF1ZSBkZXMgdnVlc1xuICAgICAgICBsZXQgdmlld3NIaXN0b3J5ID0ge307XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBoaXN0b3J5U3RyaW5nID0gYXdhaXQgc3RvcmUuZ2V0KCd2aWV3cy1oaXN0b3J5Jyk7XG4gICAgICAgICAgICBpZiAoaGlzdG9yeVN0cmluZykge1xuICAgICAgICAgICAgICAgIHZpZXdzSGlzdG9yeSA9IEpTT04ucGFyc2UoaGlzdG9yeVN0cmluZyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGdldEVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnTm8gZXhpc3Rpbmcgdmlld3MgaGlzdG9yeSBmb3VuZCwgc3RhcnRpbmcgZnJlc2gnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIExlIGNyb24gam9iIFx1MDBFOWNyYXNlIHRvdWpvdXJzIHNlcyBwcm9wcmVzIGRvbm5cdTAwRTllcyAocHJpb3JpdFx1MDBFOSBhYnNvbHVlKVxuICAgICAgICAvLyBBam91dGVyIGxlcyBub3V2ZWxsZXMgZG9ublx1MDBFOWVzIGR1IGpvdXJcbiAgICAgICAgdmlld3NIaXN0b3J5W3RvZGF5XSA9IHZpZXdzRGF0YTtcblxuICAgICAgICAvLyBTYXV2ZWdhcmRlciBsJ2hpc3RvcmlxdWUgbWlzIFx1MDBFMCBqb3VyXG4gICAgICAgIGF3YWl0IHN0b3JlLnNldCgndmlld3MtaGlzdG9yeScsIEpTT04uc3RyaW5naWZ5KHZpZXdzSGlzdG9yeSkpO1xuICAgICAgICBjb25zb2xlLmxvZygnXHUyNzA1IFZpZXdzIGhpc3RvcnkgdXBkYXRlZCBpbiBibG9iJyk7XG5cbiAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgICAgZGF0ZTogdG9kYXksXG4gICAgICAgICAgICBkYXRhOiB2aWV3c0RhdGEsXG4gICAgICAgICAgICBhY2NvdW50c1Byb2Nlc3NlZDogYWNjb3VudHMubGVuZ3RoXG4gICAgICAgIH0pLCB7XG4gICAgICAgICAgICBzdGF0dXM6IDIwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1x1Mjc0QyBFcnJvciBpbiBkYWlseS12aWV3cy1jb2xsZWN0b3I6JywgZXJyb3IpO1xuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBkZXRhaWxzOicsIHtcbiAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXG4gICAgICAgICAgICBzdGFjazogZXJyb3Iuc3RhY2ssXG4gICAgICAgICAgICBuYW1lOiBlcnJvci5uYW1lXG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IFxuICAgICAgICAgICAgZXJyb3I6ICdGYWlsZWQgdG8gY29sbGVjdCB2aWV3cyBkYXRhJyxcbiAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2VcbiAgICAgICAgfSksIHtcbiAgICAgICAgICAgIHN0YXR1czogNTAwLFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cbn07XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7O0FBSUEsU0FBUyxnQkFBZ0I7QUFHekIsZUFB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
