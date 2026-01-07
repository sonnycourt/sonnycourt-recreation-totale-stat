// Netlify Function: Daily views collector for Instagram, TikTok, YouTube
// Called daily by cron-job.org to collect and store views data
// Uses manual Netlify Blobs configuration for external calls

import { getStore } from '@netlify/blobs';

// Fonction pour collecter les vues Instagram via RapidAPI
async function fetch_views_instagram(account, store) {
    try {
        const username = account.username || account.id;
        console.log(`Collecting Instagram views for account: ${username}`);

        if (!process.env.RAPIDAPI_KEY) {
            console.error('❌ RAPIDAPI_KEY not configured');
            return 0;
        }

        let totalViews = 0;
        let paginationToken = null;
        let reelCount = 0;
        let requestCount = 0;
        const MAX_REQUESTS = 20; // Limite de sécurité pour éviter les boucles infinies (20 requêtes × ~20 reels = 400 reels max)

        do {
            requestCount++;
            const url = new URL('https://instagram-scraper-api2.p.rapidapi.com/v1.2/reels');
            url.searchParams.set('username_or_id_or_url', username);
            if (paginationToken) {
                url.searchParams.set('pagination_token', paginationToken);
            }

            const response = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    'x-rapidapi-key': process.env.RAPIDAPI_KEY,
                    'x-rapidapi-host': 'instagram-scraper-api2.p.rapidapi.com'
                }
            });

            if (!response.ok) {
                console.error(`Instagram API error: ${response.status} ${response.statusText}`);
                break;
            }

            const data = await response.json();

            // Somme tous les video_play_count
            if (data.items && Array.isArray(data.items)) {
                for (const reel of data.items) {
                    if (reel.video_play_count) {
                        totalViews += parseInt(reel.video_play_count, 10) || 0;
                        reelCount++;
                    }
                }
            }

            // Récupérer le token de pagination pour la prochaine page
            paginationToken = data.pagination_token || data.paging?.cursors?.after || null;

            console.log(`Instagram: Collected ${reelCount} reels, total views so far: ${totalViews} (request ${requestCount})`);

            // Arrêter si pas de pagination token ou si on atteint la limite de sécurité
            if (!paginationToken || requestCount >= MAX_REQUESTS) {
                break;
            }

            // Petit délai entre les requêtes pour éviter les rate limits
            await new Promise(resolve => setTimeout(resolve, 500));

        } while (paginationToken && requestCount < MAX_REQUESTS);

        console.log(`✅ Instagram total views: ${totalViews} (from ${reelCount} reels)`);
        return totalViews;

    } catch (error) {
        console.error('Error fetching Instagram views:', error);
        return 0;
    }
}

// Fonction pour collecter les vues TikTok via RapidAPI
async function fetch_views_tiktok(account, store) {
    try {
        const username = account.username || account.id;
        console.log(`Collecting TikTok views for account: ${username}`);

        if (!process.env.RAPIDAPI_KEY) {
            console.error('❌ RAPIDAPI_KEY not configured');
            return 0;
        }

        // 1. Récupérer le secUid
        const userInfoUrl = new URL('https://tiktok-api23.p.rapidapi.com/api/user/info');
        userInfoUrl.searchParams.set('uniqueId', username);

        const userInfoResponse = await fetch(userInfoUrl.toString(), {
            method: 'GET',
            headers: {
                'x-rapidapi-key': process.env.RAPIDAPI_KEY,
                'x-rapidapi-host': 'tiktok-api23.p.rapidapi.com'
            }
        });

        if (!userInfoResponse.ok) {
            console.error(`TikTok user info API error: ${userInfoResponse.status} ${userInfoResponse.statusText}`);
            return 0;
        }

        const userInfoData = await userInfoResponse.json();
        const secUid = userInfoData?.data?.userInfo?.user?.secUid || userInfoData?.data?.secUid;

        if (!secUid) {
            console.error('❌ Could not get secUid from TikTok API');
            return 0;
        }

        console.log(`TikTok secUid retrieved: ${secUid}`);

        // 2. Récupérer les vidéos avec pagination
        let totalViews = 0;
        let cursor = null;
        let videoCount = 0;
        let requestCount = 0;
        const MAX_REQUESTS = 15; // Limite de sécurité (15 requêtes × ~35 vidéos = 525 vidéos max)

        do {
            requestCount++;
            const postsUrl = new URL('https://tiktok-api23.p.rapidapi.com/api/user/posts');
            postsUrl.searchParams.set('secUid', secUid);
            postsUrl.searchParams.set('count', '35');
            if (cursor) {
                postsUrl.searchParams.set('cursor', cursor);
            }

            const postsResponse = await fetch(postsUrl.toString(), {
                method: 'GET',
                headers: {
                    'x-rapidapi-key': process.env.RAPIDAPI_KEY,
                    'x-rapidapi-host': 'tiktok-api23.p.rapidapi.com'
                }
            });

            if (!postsResponse.ok) {
                console.error(`TikTok posts API error: ${postsResponse.status} ${postsResponse.statusText}`);
                break;
            }

            const postsData = await postsResponse.json();

            // Somme tous les playCount
            const videos = postsData?.data?.itemList || postsData?.data?.videos || [];
            for (const video of videos) {
                if (video.stats?.playCount || video.playCount) {
                    const playCount = parseInt(video.stats?.playCount || video.playCount, 10) || 0;
                    totalViews += playCount;
                    videoCount++;
                }
            }

            // Récupérer le cursor pour la pagination
            const nextCursor = postsData?.data?.cursor;
            const hasMore = postsData?.data?.hasMore;

            // Mettre à jour le cursor seulement s'il y a une valeur valide
            if (nextCursor && nextCursor !== cursor && hasMore !== false) {
                cursor = nextCursor;
            } else {
                cursor = null; // Arrêter la pagination
            }

            console.log(`TikTok: Collected ${videoCount} videos, total views so far: ${totalViews} (request ${requestCount})`);

            // Arrêter si pas de cursor ou si on atteint la limite de sécurité
            if (!cursor || requestCount >= MAX_REQUESTS) {
                break;
            }

            // Petit délai entre les requêtes pour éviter les rate limits
            await new Promise(resolve => setTimeout(resolve, 500));

        } while (cursor && requestCount < MAX_REQUESTS);

        console.log(`✅ TikTok total views: ${totalViews} (from ${videoCount} videos)`);
        return totalViews;

    } catch (error) {
        console.error('Error fetching TikTok views:', error);
        return 0;
    }
}

// Fonction pour collecter les vues YouTube via OAuth et Analytics API
async function fetch_views_youtube(account, store) {
    try {
        const channelId = account.channelId || account.id || 'MINE';
        console.log(`Collecting YouTube views for channel: ${channelId}`);

        if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET || !process.env.YOUTUBE_REFRESH_TOKEN) {
            console.error('❌ YouTube OAuth credentials not configured');
            return 0;
        }

        // 1. Refresh le token OAuth
        const tokenUrl = 'https://oauth2.googleapis.com/token';
        const tokenResponse = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                client_id: process.env.YOUTUBE_CLIENT_ID,
                client_secret: process.env.YOUTUBE_CLIENT_SECRET,
                refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
                grant_type: 'refresh_token'
            })
        });

        if (!tokenResponse.ok) {
            console.error(`YouTube token refresh error: ${tokenResponse.status} ${tokenResponse.statusText}`);
            return 0;
        }

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        if (!accessToken) {
            console.error('❌ Could not get access token from YouTube OAuth');
            return 0;
        }

        console.log('✅ YouTube access token refreshed');

        // 2. Appel Analytics API pour récupérer les vues totales
        const today = new Date().toISOString().split('T')[0];
        const analyticsUrl = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
        analyticsUrl.searchParams.set('ids', `channel==${channelId === 'MINE' ? 'MINE' : channelId}`);
        analyticsUrl.searchParams.set('startDate', '2020-01-01');
        analyticsUrl.searchParams.set('endDate', today);
        analyticsUrl.searchParams.set('metrics', 'views');

        const analyticsResponse = await fetch(analyticsUrl.toString(), {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!analyticsResponse.ok) {
            console.error(`YouTube Analytics API error: ${analyticsResponse.status} ${analyticsResponse.statusText}`);
            const errorText = await analyticsResponse.text();
            console.error('Error details:', errorText);
            return 0;
        }

        const analyticsData = await analyticsResponse.json();

        // Extraire le total des vues
        let totalViews = 0;
        if (analyticsData.rows && Array.isArray(analyticsData.rows)) {
            // Les rows contiennent les données par période, on somme tout
            for (const row of analyticsData.rows) {
                if (row[0]) {
                    totalViews += parseInt(row[0], 10) || 0;
                }
            }
        } else if (analyticsData.rows && analyticsData.rows.length > 0 && analyticsData.rows[0].length > 0) {
            // Si c'est un tableau simple
            totalViews = parseInt(analyticsData.rows[0][0], 10) || 0;
        }

        console.log(`✅ YouTube total views: ${totalViews}`);
        return totalViews;

    } catch (error) {
        console.error('Error fetching YouTube views:', error);
        return 0;
    }
}

export default async (req) => {
    try {
        // Configuration manuelle du store Netlify Blobs pour les appels externes
        const store = getStore({
            name: 'stats-data',
            siteID: process.env.NETLIFY_SITE_ID,
            token: process.env.NETLIFY_API_TOKEN,
        });

        // Vérifier que les variables d'environnement sont configurées
        if (!process.env.NETLIFY_SITE_ID || !process.env.NETLIFY_API_TOKEN) {
            console.error('❌ Missing NETLIFY_SITE_ID or NETLIFY_API_TOKEN environment variables');
            return new Response(JSON.stringify({ 
                error: 'Missing required environment variables',
                required: ['NETLIFY_SITE_ID', 'NETLIFY_API_TOKEN']
            }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                }
            });
        }

        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        // 1. Charger les comptes depuis le blob "stats-data" sous la clé "accounts"
        let accounts = [];
        try {
            const accountsString = await store.get('accounts');
            if (accountsString) {
                accounts = JSON.parse(accountsString);
                console.log(`✅ Loaded ${accounts.length} accounts from blob`);
            } else {
                console.log('⚠️ No accounts found in blob, using empty array');
            }
        } catch (getError) {
            console.error('❌ Error loading accounts from blob:', getError);
            return new Response(JSON.stringify({ 
                error: 'Failed to load accounts from blob',
                message: getError.message
            }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                }
            });
        }

        // 2. Collecter les vues pour chaque plateforme
        const viewsData = {
            date: today,
            instagram_total_views: 0,
            tiktok_total_views: 0,
            youtube_total_views: 0,
            collectedAt: new Date().toISOString(),
            from_cron: true  // Marquer comme venant du cron job
        };

        // Collecter les vues pour chaque compte
        for (const account of accounts) {
            try {
                switch (account.platform?.toLowerCase()) {
                    case 'instagram':
                        const instagramViews = await fetch_views_instagram(account, store);
                        viewsData.instagram_total_views += instagramViews;
                        console.log(`✅ Instagram views collected: ${instagramViews} (total: ${viewsData.instagram_total_views})`);
                        break;
                    
                    case 'tiktok':
                        const tiktokViews = await fetch_views_tiktok(account, store);
                        viewsData.tiktok_total_views += tiktokViews;
                        console.log(`✅ TikTok views collected: ${tiktokViews} (total: ${viewsData.tiktok_total_views})`);
                        break;
                    
                    case 'youtube':
                        const youtubeViews = await fetch_views_youtube(account, store);
                        viewsData.youtube_total_views += youtubeViews;
                        console.log(`✅ YouTube views collected: ${youtubeViews} (total: ${viewsData.youtube_total_views})`);
                        break;
                    
                    default:
                        console.warn(`⚠️ Unknown platform: ${account.platform}`);
                }
            } catch (accountError) {
                console.error(`❌ Error collecting views for ${account.platform} account ${account.username || account.id}:`, accountError);
                // Continue avec les autres comptes même en cas d'erreur
            }
        }

        // 3. Sauvegarder les totaux dans l'historique des vues
        let viewsHistory = {};
        try {
            const historyString = await store.get('views-history');
            if (historyString) {
                viewsHistory = JSON.parse(historyString);
            }
        } catch (getError) {
            console.log('No existing views history found, starting fresh');
        }

        // Le cron job écrase toujours ses propres données (priorité absolue)
        // Ajouter les nouvelles données du jour
        viewsHistory[today] = viewsData;

        // Sauvegarder l'historique mis à jour
        await store.set('views-history', JSON.stringify(viewsHistory));
        console.log('✅ Views history updated in blob');

        return new Response(JSON.stringify({
            success: true,
            date: today,
            data: viewsData,
            accountsProcessed: accounts.length
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
            }
        });

    } catch (error) {
        console.error('❌ Error in daily-views-collector:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        
        return new Response(JSON.stringify({ 
            error: 'Failed to collect views data',
            message: error.message
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
            }
        });
    }
};
