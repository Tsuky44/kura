import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { db } from './db';
import { movies, tv_shows, tv_seasons, tv_episodes } from './db/schema';
import { scanMovies, scanTVShows } from './services/scanner';
import { getMKVIndex, findByteOffsetForTime } from './services/mkvIndex';
import { eq, desc, or, gt } from 'drizzle-orm';
import { join, parse as pathParse, dirname } from 'node:path';
import { sql } from 'drizzle-orm';
import { readdir } from 'node:fs/promises';

// ── Streaming session tracking (TCP Slow Start Adaptive Chunking) ──
const streamSessions = new Map<string, { lastStart: number, lastEnd: number, time: number, chunkSize: number }>();

const CHUNK_INITIAL = 3  * 1024 * 1024;  // 3MB — first request or after any seek
const CHUNK_MAX     = 50 * 1024 * 1024;  // 50MB — cruise cap

// Clean up stale sessions every 30s
setInterval(() => {
    const now = Date.now();
    for (const [key, session] of streamSessions.entries()) {
        if (now - session.time > 120000) {
            streamSessions.delete(key);
        }
    }
}, 30000);

// ── Scan mutex ──
let isScanning = false;

// ── Subtitle file extensions ──
const SUBTITLE_EXTENSIONS = ['.srt', '.ass', '.ssa', '.sub', '.vtt'];

// Ensure table exists (simple migration for MVP)
try {
    db.run(sql`
    CREATE TABLE IF NOT EXISTS movies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        tmdb_id INTEGER,
        summary TEXT,
        poster_path TEXT,
        file_path TEXT NOT NULL UNIQUE,
        resolution TEXT,
        duration INTEGER,
        year INTEGER,
        created_at INTEGER,
        progress INTEGER DEFAULT 0,
        last_watched INTEGER
    )
    `);

    // Attempt to add columns if they don't exist (Migration for existing DB)
    try { db.run(sql`ALTER TABLE movies ADD COLUMN progress INTEGER DEFAULT 0`); } catch (e) { /* Column likely exists */ }
    try { db.run(sql`ALTER TABLE movies ADD COLUMN last_watched INTEGER`); } catch (e) { /* Column likely exists */ }

    // Create TV Show tables
    db.run(sql`
    CREATE TABLE IF NOT EXISTS tv_shows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        tmdb_id INTEGER,
        summary TEXT,
        poster_path TEXT,
        backdrop_path TEXT,
        folder_path TEXT NOT NULL UNIQUE,
        year INTEGER,
        created_at INTEGER
    )
    `);

    db.run(sql`
    CREATE TABLE IF NOT EXISTS tv_seasons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        show_id INTEGER NOT NULL REFERENCES tv_shows(id) ON DELETE CASCADE,
        season_number INTEGER NOT NULL,
        title TEXT,
        summary TEXT,
        poster_path TEXT,
        created_at INTEGER
    )
    `);

    db.run(sql`
    CREATE TABLE IF NOT EXISTS tv_episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        season_id INTEGER NOT NULL REFERENCES tv_seasons(id) ON DELETE CASCADE,
        show_id INTEGER NOT NULL REFERENCES tv_shows(id) ON DELETE CASCADE,
        episode_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        tmdb_id INTEGER,
        summary TEXT,
        still_path TEXT,
        file_path TEXT NOT NULL UNIQUE,
        duration INTEGER,
        created_at INTEGER,
        progress INTEGER DEFAULT 0,
        last_watched INTEGER
    )
    `);
} catch (e) {
    console.error("Migration error:", e);
}

const app = new Elysia()
  .use(cors({
    origin: '*', // Be more restrictive in production
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'Accept-Ranges'],
    exposeHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type']
  }))
  .ws('/ws/player', {
    open(ws) {
        console.log(`[WS] Client connected`);
    },
    message(ws, message) {
        try {
            const data = typeof message === 'string' ? JSON.parse(message) : message as any;
            
            if (data.action === 'SYNC_TIME') {
                const { movieId, episodeId, time } = data;
                if (movieId && time !== undefined) {
                    db.update(movies)
                      .set({ progress: Math.floor(time), last_watched: new Date() })
                      .where(eq(movies.id, movieId))
                      .run();
                } else if (episodeId && time !== undefined) {
                    db.update(tv_episodes)
                      .set({ progress: Math.floor(time), last_watched: new Date() })
                      .where(eq(tv_episodes.id, episodeId))
                      .run();
                }
            } else if (data.action === 'PAUSE') {
                console.log(`[WS] User paused playback`);
            }
        } catch (e) {
            console.error('[WS] Message error:', e);
        }
    },
    close(ws) {
        console.log(`[WS] Client disconnected`);
    }
  })
  .onRequest(({ request }) => {
    console.log(`[${new Date().toISOString()}] ${request.method} ${request.url}`);
  })
  .onError(({ error, request }) => {
    console.error(`[ERROR] ${request.method} ${request.url}:`, error);
  })
  // Route racine pour vérifier que le serveur est en vie
  .get('/', () => {
    return "MyFlix Server is running! 🍿";
  })
  .get('/scan', async ({ set }) => {
    if (isScanning) {
        set.status = 429;
        return { success: false, message: 'A scan is already in progress' };
    }
    
    const movieDir = join(process.cwd(), 'movies');
    const tvDir = join(process.cwd(), 'tvshows');
    
    isScanning = true;
    
    // Non-blocking scan with mutex release
    Promise.all([
        scanMovies(movieDir).catch(e => console.error("Movie scan failed:", e)),
        scanTVShows(tvDir).catch(e => console.error("TV scan failed:", e))
    ]).finally(() => {
        isScanning = false;
        console.log('[SCAN] Scan completed.');
    });
    
    return { success: true, message: 'Scan started in background', directories: [movieDir, tvDir] };
  })
  .get('/continue-watching', async () => {
    // Movies with progress > 0, sorted by last_watched desc
    const recentMovies = await db.select().from(movies)
        .where(gt(movies.progress, 0))
        .orderBy(desc(movies.last_watched))
        .limit(20)
        .all();
    
    // Episodes with progress > 0, sorted by last_watched desc
    // Fetch more than needed so we can deduplicate by show
    const recentEpisodes = await db.select().from(tv_episodes)
        .where(gt(tv_episodes.progress, 0))
        .orderBy(desc(tv_episodes.last_watched))
        .limit(100)
        .all();
    
    // Enrich episodes with show info
    const enrichedEpisodes = await Promise.all(recentEpisodes.map(async (ep) => {
        const show = await db.select().from(tv_shows).where(eq(tv_shows.id, ep.show_id)).get();
        const season = await db.select().from(tv_seasons).where(eq(tv_seasons.id, ep.season_id)).get();
        return {
            ...ep,
            show_title: show?.title || 'Unknown',
            show_poster: show?.poster_path || null,
            season_number: season?.season_number || 0,
            type: 'episode' as const
        };
    }));

    // Deduplicate: keep only the most recently watched episode per show
    // (episodes are already sorted by last_watched DESC, so first occurrence = most recent)
    const seenShows = new Set<number>();
    const deduplicatedEpisodes = enrichedEpisodes.filter(ep => {
        if (seenShows.has(ep.show_id)) return false;
        seenShows.add(ep.show_id);
        return true;
    });
    
    // Merge and sort by last_watched
    const all = [
        ...recentMovies.map(m => ({ ...m, type: 'movie' as const })),
        ...deduplicatedEpisodes
    ].sort((a, b) => {
        const aTime = a.last_watched ? new Date(a.last_watched).getTime() : 0;
        const bTime = b.last_watched ? new Date(b.last_watched).getTime() : 0;
        return bTime - aTime;
    });
    
    return all.slice(0, 20);
  })
  .get('/tmdb/movie/:tmdbId', async ({ params: { tmdbId }, set }) => {
    const TMDB_API_KEY = '7f43cb4adbc635ccad5c04412b284d34';
    try {
        const res = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=fr-FR&append_to_response=credits,videos,release_dates,recommendations,similar`);
        if (!res.ok) {
            set.status = res.status;
            return { error: 'TMDB request failed' };
        }
        return await res.json();
    } catch (e: any) {
        set.status = 500;
        return { error: 'TMDB proxy error', details: e.message };
    }
  })
  .get('/movies', async () => {
    return await db.select().from(movies).all();
  })
  .get('/movies/:id', async ({ params: { id } }) => {
    const movie = await db.select().from(movies).where(eq(movies.id, parseInt(id))).get();
    if (!movie) throw new Error('Movie not found');
    return movie;
  })
  .get('/tv', async () => {
    return await db.select().from(tv_shows).all();
  })
  .get('/tv/:id', async ({ params: { id }, set }) => {
    try {
      const show = await db.select().from(tv_shows).where(eq(tv_shows.id, parseInt(id))).get();
      if (!show) {
        set.status = 404;
        return { error: 'TV Show not found' };
      }
      
      const seasons = await db.select().from(tv_seasons).where(eq(tv_seasons.show_id, show.id)).all();
      const episodes = await db.select().from(tv_episodes).where(eq(tv_episodes.show_id, show.id)).all();
      
      // Format response
      const formattedSeasons = seasons.map(s => {
          return {
              ...s,
              episodes: episodes.filter(e => e.season_id === s.id).sort((a, b) => a.episode_number - b.episode_number)
          }
      }).sort((a, b) => a.season_number - b.season_number);
      
      return {
          ...show,
          seasons: formattedSeasons
      };
    } catch (error) {
      console.error('Error fetching TV show:', error);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })
  .get('/tv/episode/:id/context', async ({ params: { id }, set }) => {
    try {
      const episodeId = parseInt(id);
      const currentEpisode = await db.select().from(tv_episodes).where(eq(tv_episodes.id, episodeId)).get();
      
      if (!currentEpisode) {
        console.log(`[CONTEXT] Episode ${episodeId} not found in DB`);
        set.status = 404;
        return { error: 'Episode not found' };
      }
      
      console.log(`[CONTEXT] Found episode ${episodeId} (Show: ${currentEpisode.show_id}, Season: ${currentEpisode.season_id})`);
      
      // Récupérer la saison actuelle pour connaître le numéro de la saison
      const currentSeason = await db.select().from(tv_seasons).where(eq(tv_seasons.id, currentEpisode.season_id)).get();
      if (!currentSeason) {
          console.log(`[CONTEXT] Season ${currentEpisode.season_id} not found`);
          return { next: null, prev: null };
      }
      
      // Récupérer tous les épisodes de la série
      const allEpisodes = await db.select().from(tv_episodes).where(eq(tv_episodes.show_id, currentEpisode.show_id)).all();
      const allSeasons = await db.select().from(tv_seasons).where(eq(tv_seasons.show_id, currentEpisode.show_id)).all();
      
      // Organiser les épisodes par saison_number et episode_number
      const episodesWithSeasonNum = allEpisodes.map(ep => {
          const season = allSeasons.find(s => s.id === ep.season_id);
          return {
              ...ep,
              season_number: season ? season.season_number : 0
          };
      });
      
      // Trier par saison puis par épisode
      episodesWithSeasonNum.sort((a, b) => {
          if (a.season_number !== b.season_number) {
              return a.season_number - b.season_number;
          }
          return a.episode_number - b.episode_number;
      });
      
      // Trouver l'index de l'épisode actuel
      const currentIndex = episodesWithSeasonNum.findIndex(ep => ep.id === episodeId);
      
      let nextEpisode = null;
      let prevEpisode = null;
      
      if (currentIndex > 0) {
          const prev = episodesWithSeasonNum[currentIndex - 1]!;
          prevEpisode = {
              id: prev.id,
              title: prev.title,
              season_number: prev.season_number,
              episode_number: prev.episode_number
          };
      }
      
      if (currentIndex < episodesWithSeasonNum.length - 1) {
          const next = episodesWithSeasonNum[currentIndex + 1]!;
          nextEpisode = {
              id: next.id,
              title: next.title,
              season_number: next.season_number,
              episode_number: next.episode_number
          };
      }
      
      const show = await db.select().from(tv_shows).where(eq(tv_shows.id, currentEpisode.show_id)).get();
      
      return {
          show_title: show ? show.title : 'Série',
          current: {
              id: currentEpisode.id,
              season_number: currentSeason.season_number,
              episode_number: currentEpisode.episode_number
          },
          next: nextEpisode,
          prev: prevEpisode
      };
    } catch (error) {
      console.error('Error fetching episode context:', error);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })
  .head('/stream/:id', async ({ params: { id }, query, set }) => {
    const isEpisode = query.type === 'episode';
    let media;
    
    if (isEpisode) {
        media = await db.select().from(tv_episodes).where(eq(tv_episodes.id, parseInt(id))).get();
    } else {
        media = await db.select().from(movies).where(eq(movies.id, parseInt(id))).get();
    }
    
    if (!media) {
        set.status = 404;
        return;
    }
    const file = Bun.file(media.file_path);
    set.headers["Accept-Ranges"] = "bytes";
    set.headers["Content-Type"] = file.type || "video/mp4";
    set.headers["Content-Length"] = String(file.size);
  })
  .get('/media/:id/tracks', async ({ params: { id }, query, set }) => {
    const isEpisode = query.type === 'episode';
    let media;
    
    if (isEpisode) {
        media = await db.select().from(tv_episodes).where(eq(tv_episodes.id, parseInt(id))).get();
    } else {
        media = await db.select().from(movies).where(eq(movies.id, parseInt(id))).get();
    }
    
    if (!media) {
        set.status = 404;
        return { error: 'Media not found' };
    }

    try {
        const path = media.file_path;
        
        // Execute ffprobe with timeout (10s)
        const proc = Bun.spawn(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters", path]);
        
        const timeoutPromise = new Promise<never>((_, reject) => 
            setTimeout(() => { proc.kill(); reject(new Error('ffprobe timeout after 10s')); }, 10000)
        );
        
        const text = await Promise.race([
            new Response(proc.stdout).text(),
            timeoutPromise
        ]);
        const data = JSON.parse(text);

        if (!data.streams) {
            return { duration: 0, tracks: [], chapters: [], externalSubs: [] };
        }

        const tracks = data.streams
            .filter((s: any) => s.codec_type === 'subtitle' || s.codec_type === 'audio')
            .map((s: any) => {
                const isSub = s.codec_type === 'subtitle';
                
                return {
                    id: s.index,
                    type: isSub ? 'sub' : s.codec_type,
                    lang: s.tags?.language || s.tags?.LANGUAGE || 'und',
                    title: s.tags?.title || s.tags?.TITLE || '',
                    codec: s.codec_name,
                    selected: false
                };
            });

        const chapters = (data.chapters || []).map((c: any) => ({
            id: c.id,
            start_time: parseFloat(c.start_time),
            end_time: parseFloat(c.end_time),
            title: c.tags?.title || c.tags?.TITLE || `Chapter ${c.id}`
        }));

        const duration = data.format?.duration ? parseFloat(data.format.duration) : 0;

        // Scan for external subtitle files adjacent to the video
        const externalSubs = await findExternalSubtitles(path);

        return {
            duration,
            tracks,
            chapters,
            externalSubs
        };
    } catch (e: any) {
        console.error(`[FFPROBE] Error reading tracks for ID ${id}:`, e);
        set.status = 500;
        return { error: 'Failed to extract tracks', details: e.message };
    }
  })
  // Keep old route as alias for backward compatibility
  .get('/movies/:id/tracks', async ({ params: { id }, query, set }) => {
    // Redirect to the canonical route
    const isEpisode = query.type === 'episode';
    let media;
    if (isEpisode) {
        media = await db.select().from(tv_episodes).where(eq(tv_episodes.id, parseInt(id))).get();
    } else {
        media = await db.select().from(movies).where(eq(movies.id, parseInt(id))).get();
    }
    if (!media) { set.status = 404; return { error: 'Media not found' }; }

    try {
        const path = media.file_path;
        const proc = Bun.spawn(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters", path]);
        const timeoutPromise = new Promise<never>((_, reject) => 
            setTimeout(() => { proc.kill(); reject(new Error('ffprobe timeout')); }, 10000)
        );
        const text = await Promise.race([new Response(proc.stdout).text(), timeoutPromise]);
        const data = JSON.parse(text);
        if (!data.streams) return { duration: 0, tracks: [], chapters: [], externalSubs: [] };
        const tracks = data.streams.filter((s: any) => s.codec_type === 'subtitle' || s.codec_type === 'audio').map((s: any) => ({
            id: s.index, type: s.codec_type === 'subtitle' ? 'sub' : s.codec_type,
            lang: s.tags?.language || s.tags?.LANGUAGE || 'und',
            title: s.tags?.title || s.tags?.TITLE || '', codec: s.codec_name, selected: false
        }));
        const chapters = (data.chapters || []).map((c: any) => ({ id: c.id, start_time: parseFloat(c.start_time), end_time: parseFloat(c.end_time), title: c.tags?.title || c.tags?.TITLE || `Chapter ${c.id}` }));
        const duration = data.format?.duration ? parseFloat(data.format.duration) : 0;
        const externalSubs = await findExternalSubtitles(path);
        return { duration, tracks, chapters, externalSubs };
    } catch (e: any) {
        set.status = 500;
        return { error: 'Failed to extract tracks', details: e.message };
    }
  })
  .get('/subtitles/:filename', async ({ params: { filename }, query, set }) => {
    // Serve an external subtitle file by providing the directory path and filename
    const dir = query.dir;
    if (!dir) {
        set.status = 400;
        return 'Missing dir parameter';
    }
    
    const filePath = join(dir, filename);
    const file = Bun.file(filePath);
    
    if (!await file.exists()) {
        set.status = 404;
        return 'Subtitle file not found';
    }
    
    const ext = filePath.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
        'srt': 'text/srt',
        'ass': 'text/x-ssa',
        'ssa': 'text/x-ssa',
        'vtt': 'text/vtt',
        'sub': 'text/plain'
    };
    
    set.headers['Content-Type'] = mimeTypes[ext || ''] || 'text/plain';
    set.headers['Access-Control-Allow-Origin'] = '*';
    return file;
  })
  .get('/stream/:id', async ({ request, params: { id }, query, headers, set }) => {
    const isEpisode = query.type === 'episode';
    let media;
    
    if (isEpisode) {
        media = await db.select().from(tv_episodes).where(eq(tv_episodes.id, parseInt(id))).get();
    } else {
        media = await db.select().from(movies).where(eq(movies.id, parseInt(id))).get();
    }
    
    if (!media) {
        return 'Media not found';
    }

    const path = media.file_path;
    const file = Bun.file(path);
    
    // VERBOSE LOGGING FOR DEBUGGING
    console.log(`[STREAM] Request for ID: ${id} (type: ${query.type || 'movie'})`);
    console.log(`[STREAM] DB Path: ${path}`);
    
    let exists = false;
    try {
        exists = await file.exists();
    } catch (e) {
        console.error(`[STREAM] Error checking file existence: ${e}`);
    }

    if (!exists) {
        console.error(`[STREAM] File NOT FOUND: ${path}`);
        // Try to decode path just in case
        const decodedPath = decodeURIComponent(path);
        if (decodedPath !== path) {
             console.log(`[STREAM] Trying decoded path: ${decodedPath}`);
             const fileDecoded = Bun.file(decodedPath);
             if (await fileDecoded.exists()) {
                 console.log(`[STREAM] Found file at decoded path!`);
                 return serveFile(fileDecoded, headers, set, decodedPath, request.headers.get('x-forwarded-for') || "local");
             }
        }
        set.status = 404;
        return 'File not found on server disk';
    }

    return serveFile(file, headers, set, path, request.headers.get('x-forwarded-for') || "local", query.start ? parseFloat(query.start as string) : undefined);
  })
  .get('/transcode/:id', async ({ request, params: { id }, query, set }) => {
    const isEpisode = query.type === 'episode';
    let media;
    
    if (isEpisode) {
        media = await db.select().from(tv_episodes).where(eq(tv_episodes.id, parseInt(id))).get();
    } else {
        media = await db.select().from(movies).where(eq(movies.id, parseInt(id))).get();
    }
    
    if (!media) {
        set.status = 404;
        return 'Media not found';
    }

    const path = media.file_path;
    const start = query.start || "0";
    
    // Le paramètre quality combine la résolution et le bitrate ciblé
    // Format attendu: "1080p_high", "1080p_low", "720p", etc.
    const quality = query.quality || "1080p_high"; 

    console.log(`[TRANSCODE] Starting for ID ${id} at ${start}s, quality: ${quality}`);

    // Paramètres dynamiques basés sur la qualité choisie
    let scale = "-2:1080";
    let crf = "23"; // Qualité visuelle (plus bas = meilleur, mais plus gros)
    let maxrate = "8M"; // Bitrate maximum
    let bufsize = "16M"; // Taille du buffer pour le contrôle du bitrate

    let audioCodec = "copy";  // Par défaut on copie l'audio
    let audioBitrate = "";

    switch(quality) {
        case "1080p_high": // ~ 8 Mbps (Excellente qualité 1080p)
            scale = "-2:1080"; crf = "21"; maxrate = "8M"; bufsize = "16M"; break;
        case "1080p_med": // ~ 4 Mbps (Bon compromis 1080p)
            scale = "-2:1080"; crf = "24"; maxrate = "4M"; bufsize = "8M"; break;
        case "1080p_low": // ~ 2 Mbps (1080p compressé pour petite connexion)
            scale = "-2:1080"; crf = "28"; maxrate = "2M"; bufsize = "4M"; break;
        case "720p_high": // ~ 3 Mbps (Excellent 720p)
            scale = "-2:720"; crf = "23"; maxrate = "3M"; bufsize = "6M"; break;
        case "720p_low": // ~ 1.5 Mbps (720p très compressé)
            scale = "-2:720"; crf = "28"; maxrate = "1.5M"; bufsize = "3M"; break;
        case "480p": // ~ 800 kbps (Qualité DVD / Mobile)
            scale = "-2:480"; crf = "30"; maxrate = "800k"; bufsize = "1.5M";
            audioCodec = "aac"; audioBitrate = "128k"; break;
        case "360p": // ~ 400 kbps (Connexion très lente)
            scale = "-2:360"; crf = "32"; maxrate = "400k"; bufsize = "800k";
            audioCodec = "aac"; audioBitrate = "96k"; break;
        default:
            scale = "-2:1080"; crf = "24"; maxrate = "4M"; bufsize = "8M"; break;
    }

    // Build audio args based on whether we copy or transcode
    const audioArgs = audioCodec === "copy" 
        ? ["-c:a", "copy"]
        : ["-c:a", audioCodec, "-b:a", audioBitrate, "-ac", "2"]; // Stereo downmix for low quality

    // FFmpeg command: scale video, handle audio, copy subs
    const ffmpegArgs = [
        "ffmpeg",
        "-ss", start.toString(),
        "-i", path,
        "-map", "0:v:0", "-map", "0:a?", "-map", "0:s?",
        
        // Video: libx264 ultrafast + constrained VBR
        "-c:v", "libx264", 
        "-preset", "ultrafast", 
        "-crf", crf, 
        "-maxrate", maxrate,
        "-bufsize", bufsize,
        "-threads", "4", 
        "-sws_flags", "fast_bilinear",
        "-vf", `scale=${scale}`,
        
        ...audioArgs,
        "-c:s", "copy",
        "-f", "matroska",
        "-flush_packets", "1",
        "pipe:1"
    ];

    try {
        const proc = Bun.spawn(ffmpegArgs, {
            stdout: "pipe",
            stderr: "ignore", // On ignore les logs ffmpeg pour ne pas bloquer le pipe
        });

        // CRITIQUE : Tuer FFmpeg si MPV ferme la connexion (changement de qualité, seek, fermeture du client)
        request.signal.addEventListener("abort", () => {
            console.log(`[TRANSCODE] Client disconnected. Killing FFmpeg for ID ${id}`);
            proc.kill();
        });

        // Retourner le flux brut avec les bons headers
        return new Response(proc.stdout, {
            headers: {
                "Content-Type": "video/x-matroska",
                "Cache-Control": "no-store, no-cache, must-revalidate",
                "Connection": "keep-alive"
            }
        });
    } catch (e: any) {
        console.error("[TRANSCODE] Error starting ffmpeg:", e);
        set.status = 500;
        return "Transcoding failed";
    }
  })
  .listen({
    port: 3089,
    hostname: "0.0.0.0"
  });

// ── Periodic Auto-Scan: Run every 30 minutes to keep library in sync ──
const AUTO_SCAN_INTERVAL = 30 * 60 * 1000; // 30 minutes in milliseconds

setInterval(async () => {
    if (isScanning) {
        console.log('[AUTO-SCAN] Skipping: scan already in progress');
        return;
    }
    
    console.log('[AUTO-SCAN] Starting periodic library scan...');
    isScanning = true;
    
    const movieDir = join(process.cwd(), 'movies');
    const tvDir = join(process.cwd(), 'tvshows');
    
    try {
        await Promise.all([
            scanMovies(movieDir).catch(e => console.error('[AUTO-SCAN] Movie scan failed:', e)),
            scanTVShows(tvDir).catch(e => console.error('[AUTO-SCAN] TV scan failed:', e))
        ]);
        console.log('[AUTO-SCAN] Library scan completed successfully');
    } catch (e) {
        console.error('[AUTO-SCAN] Error during auto-scan:', e);
    } finally {
        isScanning = false;
    }
}, AUTO_SCAN_INTERVAL);

console.log(`[AUTO-SCAN] Periodic scan enabled: every ${AUTO_SCAN_INTERVAL / 60000} minutes`);

// Helper function to find external subtitle files next to a video file
async function findExternalSubtitles(videoPath: string): Promise<Array<{ filename: string, lang: string, dir: string }>> {
    try {
        const dir = dirname(videoPath);
        const videoName = pathParse(videoPath).name;
        const files = await readdir(dir);
        
        return files
            .filter(f => {
                const ext = pathParse(f).ext.toLowerCase();
                return SUBTITLE_EXTENSIONS.includes(ext) && f.startsWith(videoName);
            })
            .map(f => {
                // Try to extract language from filename pattern: Movie.en.srt, Movie.french.ass
                const withoutExt = pathParse(f).name;
                const parts = withoutExt.replace(videoName, '').split('.');
                const lang = parts.filter(p => p.length > 0).pop() || 'und';
                
                return {
                    filename: f,
                    lang,
                    dir
                };
            });
    } catch (e) {
        return [];
    }
}

// Helper function to serve file with range support and MKV-aware seeking
async function serveFile(file: any, headers: any, set: any, path: string, ip: string = "unknown", startTime?: number) {
    const size = file.size;
    const range = headers['range'];
    const isMKV = path.toLowerCase().endsWith('.mkv');

    // For MKV with startTime: use index to map timestamp → byte offset
    let mkvOffset = 0;
    if (isMKV && startTime && startTime > 0 && range) {
        const index = await getMKVIndex(path);
        if (index) {
            mkvOffset = findByteOffsetForTime(index, startTime);
            console.log(`[STREAM] MKV resume: ${startTime}s → byte offset ${mkvOffset} (~${(mkvOffset/1024/1024).toFixed(1)}MB)`);
        }
    }

    // ROBUST MIME type detection (moved up to use before potential redirect)
    let mimeType = file.type;
    if (!mimeType || mimeType === 'application/octet-stream') {
        const ext = path.split('.').pop()?.toLowerCase();
        if (ext === 'mkv') mimeType = 'video/x-matroska';
        else if (ext === 'mp4') mimeType = 'video/mp4';
        else if (ext === 'avi') mimeType = 'video/x-msvideo';
        else if (ext === 'mov') mimeType = 'video/quicktime';
        else if (ext === 'webm') mimeType = 'video/webm';
        else mimeType = 'video/mp4';
    }

    // AGGRESSIVE SEEK: When ?start= is present and requesting byte 0,
    // immediately redirect to the correct byte offset using 302
    // This forces MPV to start downloading from the resume position, not from 0
    if (isMKV && mkvOffset > 0 && range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const requestedStart = parseInt(parts[0], 10);

        // If MPV requests from beginning (0-100KB range) but we want to resume further,
        // send a 302 redirect to force it to request from the correct offset
        if (!isNaN(requestedStart) && requestedStart < 100 * 1024) {
            // Build redirect URL without ?start= (to avoid loops), keeping other params
            const redirectUrl = `/stream/direct/${encodeURIComponent(path)}?offset=${mkvOffset}&mime=${encodeURIComponent(mimeType)}`;
            console.log(`[STREAM] 302 Redirect for resume: ${range} → offset ${mkvOffset}`);
            set.status = 302;
            set.headers["Location"] = redirectUrl;
            return "Redirecting to resume position";
        }
    }

    if (!range) {
        // Fallback if no range is requested
        console.log(`[STREAM] Serving full file for ${path}`);
        set.headers["Accept-Ranges"] = "bytes";
        set.headers["Content-Type"] = mimeType;
        set.headers["Content-Length"] = size.toString();
        return file;
    }

    const parts = range.replace(/bytes=/, "").split("-");
    let start = parseInt(parts[0], 10);
    let end = parts[1] ? parseInt(parts[1], 10) : NaN;

    // Apply MKV offset for resume: if range starts near 0 and we have a startTime offset
    if (mkvOffset > 0 && start < 100 * 1024) {
        // MKV header is ~100KB, if request is in header area, adjust to actual data position
        start = mkvOffset;
        console.log(`[STREAM] Adjusted range start to ${start} for resume`);
    }

    // Handle suffix range (e.g. bytes=-500)
    if (isNaN(start) && !isNaN(end)) {
        start = size - end;
        end = size - 1;
    }

    // Handle open-ended range (e.g. bytes=0-)
    let isOpenEnded = false;
    if (!isNaN(start) && isNaN(end)) {
        end = size - 1;
        isOpenEnded = true;
    }

    // Validate range
    if (isNaN(start) || isNaN(end) || start >= size || end >= size || start > end) {
        console.error(`[STREAM] Invalid Range: ${range} (Start: ${start}, End: ${end}, Size: ${size})`);
        set.status = 416;
        set.headers["Content-Range"] = `bytes */${size}`;
        return "Requested Range Not Satisfiable";
    }
    
    // TCP Slow Start: 3MB on seek/first request, doubles each continuation up to 50MB
    if (isOpenEnded) {
        const sessionKey = `${ip}-${path}`;
        const lastSession = streamSessions.get(sessionKey);
        let chunkSize = CHUNK_INITIAL;

        if (lastSession && Date.now() - lastSession.time < 120000) {
            const isContinuation = Math.abs(start - lastSession.lastEnd) < 1 * 1024 * 1024;
            if (isContinuation) {
                // Sequential read — double the window (TCP Slow Start)
                chunkSize = Math.min(lastSession.chunkSize * 2, CHUNK_MAX);
            }
            // else: seek detected → reset to CHUNK_INITIAL (already set above)
        }

        if (end - start + 1 > chunkSize) {
            end = start + chunkSize - 1;
        }

        streamSessions.set(sessionKey, { lastStart: start, lastEnd: end, time: Date.now(), chunkSize });
    }
    
    const chunkLength = end - start + 1;

    console.log(`[STREAM] ${range} | ${start}-${end}/${size} | Len: ${(chunkLength / 1024 / 1024).toFixed(2)}MB | Type: ${mimeType}`);

    set.status = 206;
    set.headers["Accept-Ranges"] = "bytes";
    set.headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    set.headers["Content-Length"] = chunkLength.toString();
    set.headers["Content-Type"] = mimeType;
    set.headers["Connection"] = "keep-alive"; 

    return file.slice(start, end + 1);
}

// ── Direct stream endpoint for MKV resume redirects ──
// This endpoint serves from a specific byte offset without requiring ?start=
// It's used internally for 302 redirects when resuming MKV playback
app.get('/stream/direct/:path', async ({ params, query, headers, set }) => {
    try {
        const filePath = decodeURIComponent(params.path);
        const offset = parseInt(query.offset as string, 10) || 0;
        const mimeType = decodeURIComponent(query.mime as string) || 'video/x-matroska';

        const file = Bun.file(filePath);
        if (!(await file.exists())) {
            set.status = 404;
            return 'File not found';
        }

        const size = file.size;
        const range = headers['range'];

        if (!range) {
            // No range - serve from offset with TCP Slow Start
            const chunkSize = CHUNK_INITIAL;
            const end = Math.min(offset + chunkSize - 1, size - 1);

            console.log(`[DIRECT] Resume from ${offset}-${end}/${size} (~${((end-offset+1)/1024/1024).toFixed(2)}MB)`);

            set.status = 206;
            set.headers["Accept-Ranges"] = "bytes";
            set.headers["Content-Range"] = `bytes ${offset}-${end}/${size}`;
            set.headers["Content-Length"] = (end - offset + 1).toString();
            set.headers["Content-Type"] = mimeType;

            return file.slice(offset, end + 1);
        }

        // Has range - adjust relative to offset
        const rangeStr = range || 'bytes=0-';
        const parts = rangeStr.replace(/bytes=/, "").split("-");
        let start = parseInt(parts[0] ?? '0', 10) + offset;
        let end = parts[1] ? parseInt(parts[1], 10) + offset : size - 1;

        // Validate
        if (start >= size) start = size - 1;
        if (end >= size) end = size - 1;

        const chunkLength = end - start + 1;
        console.log(`[DIRECT] Range ${range} → ${start}-${end}/${size} (~${(chunkLength/1024/1024).toFixed(2)}MB)`);

        set.status = 206;
        set.headers["Accept-Ranges"] = "bytes";
        set.headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
        set.headers["Content-Length"] = chunkLength.toString();
        set.headers["Content-Type"] = mimeType;

        return file.slice(start, end + 1);

    } catch (e) {
        console.error('[DIRECT] Error:', e);
        set.status = 500;
        return 'Server error';
    }
});
