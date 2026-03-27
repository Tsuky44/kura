import { readdir, stat } from 'node:fs/promises';
import { join, parse, basename } from 'node:path';
import { db } from '../db';
import { movies, tv_shows, tv_seasons, tv_episodes } from '../db/schema';
import { eq } from 'drizzle-orm';
import { searchMovie, searchTVShow, getTVSeasonDetails } from './tmdb';

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm'];

async function getFiles(dir: string): Promise<string[]> {
    let results: string[] = [];
    try {
        const list = await readdir(dir, { withFileTypes: true });
        for (const file of list) {
            const fullPath = join(dir, file.name);
            if (file.isDirectory()) {
                results = results.concat(await getFiles(fullPath));
            } else {
                const ext = parse(file.name).ext.toLowerCase();
                if (VIDEO_EXTENSIONS.includes(ext)) {
                    results.push(fullPath);
                }
            }
        }
    } catch (e) {
        console.log(`Skipping directory ${dir}: ${(e as Error).message}`);
    }
    return results;
}

async function addMovie(filePath: string) {
    const fileName = parse(filePath).name;
    const match = fileName.match(/(.+?)[\.\s\(](\d{4})[\.\s\)]?/);
    const title = match ? match[1]!.replace(/\./g, ' ').trim() : fileName.replace(/\./g, ' ').trim();
    const year = match ? parseInt(match[2]!) : undefined;

    console.log(`Found new movie: ${title} (${year || 'Unknown'})`);

    let metadata = {
        tmdb_id: null as number | null,
        summary: null as string | null,
        poster_path: null as string | null,
    };

    try {
        const tmdbResult = await searchMovie(title, year);
        if (tmdbResult) {
            metadata = {
                tmdb_id: tmdbResult.id,
                summary: tmdbResult.overview,
                poster_path: tmdbResult.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbResult.poster_path}` : null,
            };
        }
    } catch (e) {
        console.error(`Failed to fetch metadata for ${title}:`, e);
    }

    try {
        await db.insert(movies).values({
            title,
            file_path: filePath,
            year,
            ...metadata
        });
    } catch (e) {
        console.error(`Failed to insert movie ${title}:`, e);
    }
}

export async function scanMovies(dir: string) {
    console.log(`Starting movie scan in: ${dir}`);
    const diskFiles = await getFiles(dir);
    const diskFilesSet = new Set(diskFiles);
    
    const dbMovies = await db.select().from(movies).all();
    const dbFilesSet = new Set(dbMovies.map(m => m.file_path));

    for (const dbFile of dbFilesSet) {
        if (!diskFilesSet.has(dbFile)) {
            await db.delete(movies).where(eq(movies.file_path, dbFile));
        }
    }

    for (const diskFile of diskFilesSet) {
        if (!dbFilesSet.has(diskFile)) {
            await addMovie(diskFile);
        }
    }
    console.log(`Movie scan complete.`);
}

export async function scanTVShows(dir: string) {
    console.log(`Starting TV Show scan in: ${dir}`);
    
    try {
        const shows = await readdir(dir, { withFileTypes: true });
        
        for (const showDir of shows) {
            if (!showDir.isDirectory()) continue;
            
            const showPath = join(dir, showDir.name);
            const showNameMatch = showDir.name.match(/(.+?)[\.\s\(](\d{4})[\.\s\)]?/);
            const showTitle = showNameMatch ? showNameMatch[1]!.replace(/\./g, ' ').trim() : showDir.name.replace(/\./g, ' ').trim();
            const showYear = showNameMatch ? parseInt(showNameMatch[2]!) : undefined;
            
            // Check if show exists
            let show = await db.select().from(tv_shows).where(eq(tv_shows.folder_path, showPath)).get();
            
            if (!show) {
                console.log(`Adding new TV Show: ${showTitle}`);
                let metadata = {
                    tmdb_id: null as number | null,
                    summary: null as string | null,
                    poster_path: null as string | null,
                    backdrop_path: null as string | null,
                };

                const tmdbResult = await searchTVShow(showTitle, showYear);
                if (tmdbResult) {
                    metadata = {
                        tmdb_id: tmdbResult.id,
                        summary: tmdbResult.overview,
                        poster_path: tmdbResult.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbResult.poster_path}` : null,
                        backdrop_path: tmdbResult.backdrop_path ? `https://image.tmdb.org/t/p/original${tmdbResult.backdrop_path}` : null,
                    };
                }

                const [inserted] = await db.insert(tv_shows).values({
                    title: showTitle,
                    folder_path: showPath,
                    year: showYear,
                    ...metadata
                }).returning();
                show = inserted;
            }

            // Scan episodes in show folder
            const videoFiles = await getFiles(showPath);
            
            for (const file of videoFiles) {
                const fileName = basename(file);
                // Regex to match S01E01, 1x01, etc.
                const epMatch = fileName.match(/[sS](\d+)[eE](\d+)|(\d+)x(\d+)/);
                
                if (epMatch) {
                    const seasonNum = parseInt(epMatch[1]! || epMatch[3]!);
                    const episodeNum = parseInt(epMatch[2]! || epMatch[4]!);
                    
                    // Ensure Season exists
                    let season = await db.select().from(tv_seasons)
                        .where(eq(tv_seasons.show_id, show!.id))
                        .get();
                        
                    // Need a better way to check specific season, but SQLite driver might not support AND easily without setup
                    // Doing it manually for now
                    const seasons = await db.select().from(tv_seasons).where(eq(tv_seasons.show_id, show!.id)).all();
                    season = seasons.find(s => s.season_number === seasonNum);
                    
                    if (!season) {
                        let seasonMeta = { title: `Season ${seasonNum}`, summary: null as string | null, poster_path: null as string | null };
                        let tmdbEpisodes: any[] = [];
                        if (show!.tmdb_id) {
                            const tmdbSeason: any = await getTVSeasonDetails(show!.tmdb_id, seasonNum);
                            if (tmdbSeason) {
                                seasonMeta.title = tmdbSeason.name || seasonMeta.title;
                                seasonMeta.summary = tmdbSeason.overview || null;
                                seasonMeta.poster_path = tmdbSeason.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbSeason.poster_path}` : null;
                                tmdbEpisodes = tmdbSeason.episodes || [];
                            }
                        }
                        
                        const [inserted] = await db.insert(tv_seasons).values({
                            show_id: show!.id,
                            season_number: seasonNum,
                            ...seasonMeta
                        }).returning();
                        season = inserted;
                        
                        // Cache TMDB episode data on the season object for reuse
                        (season as any)._tmdbEpisodes = tmdbEpisodes;
                    }

                    // Check if episode exists
                    const existingEp = await db.select().from(tv_episodes).where(eq(tv_episodes.file_path, file)).get();
                    
                    if (!existingEp) {
                        // Try to enrich from TMDB season episode data
                        let epTitle = `Episode ${episodeNum}`;
                        let epSummary: string | null = null;
                        let epStillPath: string | null = null;
                        let epTmdbId: number | null = null;
                        
                        // Retrieve cached TMDB episodes or fetch if not cached
                        let tmdbEps = (season as any)._tmdbEpisodes;
                        if (!tmdbEps && show!.tmdb_id) {
                            const tmdbSeason: any = await getTVSeasonDetails(show!.tmdb_id, seasonNum);
                            tmdbEps = tmdbSeason?.episodes || [];
                            (season as any)._tmdbEpisodes = tmdbEps;
                        }
                        
                        if (tmdbEps) {
                            const tmdbEp = tmdbEps.find((e: any) => e.episode_number === episodeNum);
                            if (tmdbEp) {
                                epTitle = tmdbEp.name || epTitle;
                                epSummary = tmdbEp.overview || null;
                                epStillPath = tmdbEp.still_path ? `https://image.tmdb.org/t/p/w500${tmdbEp.still_path}` : null;
                                epTmdbId = tmdbEp.id || null;
                            }
                        }
                        
                        console.log(`Adding episode S${seasonNum}E${episodeNum} "${epTitle}" to ${showTitle}`);
                        await db.insert(tv_episodes).values({
                            show_id: show!.id,
                            season_id: season!.id,
                            episode_number: episodeNum,
                            title: epTitle,
                            summary: epSummary,
                            still_path: epStillPath,
                            tmdb_id: epTmdbId,
                            file_path: file
                        });
                    }
                }
            }
        }
        console.log('TV Show scan complete.');
    } catch (e) {
        console.error('Error scanning TV shows:', e);
    }
}
