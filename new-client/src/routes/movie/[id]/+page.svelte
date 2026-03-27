<script lang="ts">
    import { page } from '$app/stores';
    import { getMovies, getStreamUrl, getBackdropUrl, getPosterUrl, getMovieDetails, apiUrl } from '$lib/api';
    import { openPlayer } from '$lib/stores/player';
    import { Play, ArrowLeft, RotateCcw, Star, Clock, Calendar } from 'lucide-svelte';
    import { fade } from 'svelte/transition';
    import { get } from 'svelte/store';

    let movie: any;
    let movieDuration = 0;
    let isLoading = true;
    let error: string | null = null;

    $: id = $page.params.id;
    $: if (id) loadMovie(parseInt(id));

    // true when progress > 1min and not in the last 5% of the film
    $: canResume = movie && movie.progress > 60 && movieDuration > 0 && movie.progress < movieDuration * 0.95;

    async function loadMovie(movieId: number) {
        isLoading = true;
        error = null;
        try {
            const movies = await getMovies();
            movie = movies.find((m: any) => m.id === movieId);
            if (!movie) { error = "Film introuvable"; return; }

            // Fetch TMDB metadata
            if (movie.tmdb_id) {
                try {
                    const tmdbDetails = await getMovieDetails(movie.tmdb_id);
                    if (tmdbDetails) {
                        movie = {
                            ...movie,
                            overview: tmdbDetails.overview || movie.overview,
                            vote_average: tmdbDetails.vote_average || movie.vote_average,
                            release_date: tmdbDetails.release_date || movie.release_date,
                            backdrop_path: tmdbDetails.backdrop_path || movie.backdrop_path,
                            poster_path: tmdbDetails.poster_path || movie.poster_path
                        };
                    }
                } catch (_) {}
            }

            // Fetch duration from tracks API (needed for 95% threshold)
            try {
                const tracksRes = await fetch(`${get(apiUrl)}/movies/${movieId}/tracks`);
                if (tracksRes.ok) {
                    const info = await tracksRes.json();
                    movieDuration = info.duration || movie.duration || 0;
                }
            } catch (_) {
                movieDuration = movie.duration || 0;
            }

        } catch (e) {
            error = "Impossible de charger le film";
        } finally {
            isLoading = false;
        }
    }

    function formatTime(seconds: number): string {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    function resume() {
        if (!movie) return;
        openPlayer(getStreamUrl(movie.id), movie.title, movie.id, movie.progress || 0);
    }

    function playFromStart() {
        if (!movie) return;
        openPlayer(getStreamUrl(movie.id), movie.title, movie.id, 0);
    }
</script>

{#if isLoading}
    <div class="flex items-center justify-center h-screen">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
    </div>
{:else if error || !movie}
    <div class="flex flex-col items-center justify-center h-screen text-center">
        <h1 class="text-2xl font-bold mb-4 text-text">Error</h1>
        <p class="text-gray-400">{error || "Movie not found"}</p>
        <a href="/" class="mt-4 text-primary hover:underline">Go Home</a>
    </div>
{:else}
    <div class="relative min-h-screen" in:fade>
        <!-- Backdrop -->
        <div class="absolute inset-0 z-0">
            <img 
                src={getBackdropUrl(movie.backdrop_path)} 
                alt="Backdrop" 
                class="w-full h-full object-cover opacity-40"
            />
            <div class="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent"></div>
            <div class="absolute inset-0 bg-gradient-to-r from-background via-background/50 to-transparent"></div>
        </div>

        <!-- Content -->
        <div class="relative z-10 container mx-auto px-8 pt-20">
            <a href="/" class="inline-flex items-center text-gray-400 hover:text-text mb-8 transition-colors">
                <ArrowLeft class="w-5 h-5 mr-2" />
                Back to Browse
            </a>

            <div class="flex flex-col md:flex-row gap-12">
                <!-- Poster -->
                <div class="w-72 shrink-0 rounded-xl overflow-hidden shadow-2xl rotate-1 hover:rotate-0 transition-transform duration-500 border border-surface">
                    <img 
                        src={getPosterUrl(movie.poster_path)} 
                        alt={movie.title} 
                        class="w-full h-auto"
                    />
                </div>

                <!-- Info -->
                <div class="flex-1 pt-4">
                    <h1 class="text-5xl font-bold mb-4 leading-tight text-text">{movie.title}</h1>
                    
                    <div class="flex items-center gap-6 text-gray-300 mb-8">
                        <div class="flex items-center gap-2">
                            <Star class="w-5 h-5 text-primary fill-current" />
                            <span class="font-bold text-text">
                                {movie.vote_average ? movie.vote_average.toFixed(1) : '0.0'}
                            </span>
                        </div>
                        <div class="flex items-center gap-2">
                            <Calendar class="w-5 h-5 text-primary" />
                            <span>
                                {movie.release_date ? new Date(movie.release_date).getFullYear() : 'Unknown'}
                            </span>
                        </div>
                        <!-- Duration would be here if available -->
                    </div>

                    <p class="text-lg text-gray-300 leading-relaxed max-w-3xl mb-10">
                        {movie.overview}
                    </p>

                    <div class="flex gap-4 flex-wrap">
                        {#if canResume}
                            <button on:click={resume} class="bg-primary hover:bg-primary/80 text-white px-8 py-4 rounded-xl font-bold flex items-center gap-3 transition-transform hover:scale-105 shadow-lg shadow-primary/20 text-lg">
                                <Play class="w-6 h-6 fill-current" />
                                Reprendre à {formatTime(movie.progress)}
                            </button>
                            <button on:click={playFromStart} class="bg-surface/60 hover:bg-surface border border-surface text-gray-300 hover:text-white px-6 py-4 rounded-xl font-semibold flex items-center gap-2 transition-colors text-base">
                                <RotateCcw class="w-5 h-5" />
                                Recommencer
                            </button>
                        {:else}
                            <button on:click={playFromStart} class="bg-primary hover:bg-primary/80 text-white px-8 py-4 rounded-xl font-bold flex items-center gap-3 transition-transform hover:scale-105 shadow-lg shadow-primary/20 text-lg">
                                <Play class="w-6 h-6 fill-current" />
                                Lecture
                            </button>
                        {/if}
                    </div>
                </div>
            </div>
        </div>
    </div>
{/if}
