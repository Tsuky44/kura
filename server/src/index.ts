import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { db } from './db';
import { movies, tv_shows, tv_seasons, tv_episodes } from './db/schema';
import { scanMovies, scanTVShows } from './services/scanner';
import { eq } from 'drizzle-orm';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';

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
  .get('/scan', async () => {
    const movieDir = join(process.cwd(), 'movies');
    const tvDir = join(process.cwd(), 'tvshows');
    
    // Non-blocking scan
    scanMovies(movieDir).catch(e => console.error("Movie scan failed:", e));
    scanTVShows(tvDir).catch(e => console.error("TV scan failed:", e));
    
    return { success: true, message: 'Scan started in background', directories: [movieDir, tvDir] };
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
          const prev = episodesWithSeasonNum[currentIndex - 1];
          prevEpisode = {
              id: prev.id,
              title: prev.title,
              season_number: prev.season_number,
              episode_number: prev.episode_number
          };
      }
      
      if (currentIndex < episodesWithSeasonNum.length - 1) {
          const next = episodesWithSeasonNum[currentIndex + 1];
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
  .get('/movies/:id/tracks', async ({ params: { id }, query, set }) => {
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
        
        // Execute ffprobe
        const proc = Bun.spawn(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters", path]);
        const text = await new Response(proc.stdout).text();
        const data = JSON.parse(text);

        if (!data.streams) {
            return [];
        }

        const tracks = data.streams
            .filter((s: any) => s.codec_type === 'subtitle' || s.codec_type === 'audio')
            .map((s: any) => {
                const isSub = s.codec_type === 'subtitle';
                
                return {
                    id: s.index, // ID unique absolu pour la clé
                    type: isSub ? 'sub' : s.codec_type,
                    lang: s.tags?.language || s.tags?.LANGUAGE || 'und',
                    title: s.tags?.title || s.tags?.TITLE || '',
                    codec: s.codec_name,
                    selected: false // Managed by frontend
                };
            });

        // Extraction des chapitres pour la détection d'intro
        const chapters = (data.chapters || []).map((c: any) => ({
            id: c.id,
            start_time: parseFloat(c.start_time),
            end_time: parseFloat(c.end_time),
            title: c.tags?.title || c.tags?.TITLE || `Chapter ${c.id}`
        }));

        // Extraire la durée totale du fichier
        const duration = data.format?.duration ? parseFloat(data.format.duration) : 0;

        return {
            duration: duration,
            tracks: tracks,
            chapters: chapters
        };
    } catch (e: any) {
        console.error(`[FFPROBE] Error reading tracks for ID ${id}:`, e);
        set.status = 500;
        return { error: 'Failed to extract tracks', details: e.message };
    }
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

    return serveFile(file, headers, set, path, request.headers.get('x-forwarded-for') || "local");
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
            scale = "-2:480"; crf = "30"; maxrate = "800k"; bufsize = "1.5M"; break;
        default:
            scale = "-2:1080"; crf = "24"; maxrate = "4M"; bufsize = "8M"; break;
    }

    // FFmpeg command specifically crafted to scale video but COPY audio and subtitles
    const ffmpegArgs = [
        "ffmpeg",
        "-ss", start.toString(),
        "-i", path,
        "-map", "0:v:0", "-map", "0:a?", "-map", "0:s?",
        
        // Optimisations CPU extrêmes pour Xeon sans GPU + Contrôle du Bitrate (VBR Constrained)
        "-c:v", "libx264", 
        "-preset", "ultrafast", 
        "-crf", crf, 
        "-maxrate", maxrate, // Force FFmpeg à ne pas dépasser ce bitrate
        "-bufsize", bufsize, // Nécessaire quand on utilise maxrate
        "-threads", "4", 
        "-sws_flags", "fast_bilinear",
        "-vf", `scale=${scale}`,
        
        "-c:a", "copy", "-c:s", "copy",
        "-f", "matroska",
        "-flush_packets", "1", // OBLIGATOIRE : Force l'envoi immédiat des données dans le pipe
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

// Store active streaming sessions to track chunk progression
const streamSessions = new Map<string, { lastStart: number, lastEnd: number, time: number }>();

// Helper function to clean up old sessions
setInterval(() => {
    const now = Date.now();
    for (const [key, session] of streamSessions.entries()) {
        if (now - session.time > 120000) { // Clear if older than 2 minutes (120s)
            streamSessions.delete(key);
        }
    }
}, 30000);

// Helper function to serve file with range support
function serveFile(file: any, headers: any, set: any, path: string, ip: string = "unknown") {
    const size = file.size;
    const range = headers['range'];

    // Robust MIME type detection
    let mimeType = file.type;
    if (!mimeType || mimeType === 'application/octet-stream') {
        const ext = path.split('.').pop()?.toLowerCase();
        if (ext === 'mkv') mimeType = 'video/x-matroska';
        else if (ext === 'mp4') mimeType = 'video/mp4';
        else if (ext === 'avi') mimeType = 'video/x-msvideo';
        else if (ext === 'mov') mimeType = 'video/quicktime';
        else if (ext === 'webm') mimeType = 'video/webm';
        else mimeType = 'video/mp4'; // Fallback
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
    
    // NOTE: Système de Chunk Dynamique (Évolutif & Sensible au Seek)
    if (isOpenEnded) {
        let maxChunkSize = 2 * 1024 * 1024; // 2 MB par défaut (Démarrage ou Seek)
        
        const sessionKey = `${ip}-${path}`;
        const lastSession = streamSessions.get(sessionKey);
        
        // Si on a une session récente (moins de 2 minutes)
        if (lastSession && Date.now() - lastSession.time < 120000) {
            // Tolérance de 1MB car le client peut recouvrir légèrement les ranges
            // On vérifie si le nouveau start est juste après l'ancien end
            const isContinuation = Math.abs(start - lastSession.lastEnd) < 1 * 1024 * 1024;
            
            if (isContinuation) {
                maxChunkSize = 50 * 1024 * 1024; // 50 MB (Lecture de croisière)
            } else {
                console.log(`[STREAM] Seek détecté ! Réinitialisation du chunk à 2MB.`);
            }
        }
        
        if (end - start + 1 > maxChunkSize) {
            end = start + maxChunkSize - 1;
        }
        
        // Mettre à jour la session
        streamSessions.set(sessionKey, { lastStart: start, lastEnd: end, time: Date.now() });
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

console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
