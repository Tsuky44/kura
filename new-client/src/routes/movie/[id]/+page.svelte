<script lang="ts">
    import { page } from '$app/stores';
    import { getMovies, getStreamUrl, getBackdropUrl, getPosterUrl, getMovieDetails } from '$lib/api';
    import { playMedia } from '$lib/stores/player';
    import { Play, ArrowLeft, Star, Clock, Calendar } from 'lucide-svelte';
    import { fade } from 'svelte/transition';
    import { onMount } from 'svelte';

    let movie: any;
    let isLoading = true;
    let error: string | null = null;

    // Use reactive statement to load when ID changes
    $: id = $page.params.id;
    $: if (id) loadMovie(parseInt(id));

    async function loadMovie(movieId: number) {
        isLoading = true;
        try {
            // 1. Get local movie info
            const movies = await getMovies();
            movie = movies.find((m: any) => m.id === movieId);
            
            if (!movie) {
                error = "Movie not found";
                return;
            }

            // 2. Fetch TMDB details if TMDB ID exists
            if (movie.tmdb_id) {
                try {
                    const tmdbDetails = await getMovieDetails(movie.tmdb_id);
                    if (tmdbDetails) {
                        // Merge details (TMDB takes precedence for metadata)
                        movie = {
                            ...movie,
                            overview: tmdbDetails.overview || movie.overview,
                            vote_average: tmdbDetails.vote_average || movie.vote_average,
                            release_date: tmdbDetails.release_date || movie.release_date,
                            backdrop_path: tmdbDetails.backdrop_path || movie.backdrop_path,
                            poster_path: tmdbDetails.poster_path || movie.poster_path
                        };
                    }
                } catch (tmdbError) {
                    console.warn("Failed to fetch TMDB details:", tmdbError);
                }
            }

        } catch (e) {
            error = "Failed to load movie";
        } finally {
            isLoading = false;
        }
    }

    function play() {
        if (movie) {
            playMedia(movie, getStreamUrl(movie.id));
        }
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

                    <div class="flex gap-4">
                        <button on:click={play} class="bg-primary hover:bg-primary/80 text-white px-8 py-4 rounded-xl font-bold flex items-center gap-3 transition-transform hover:scale-105 shadow-lg shadow-primary/20 text-lg">
                            <Play class="w-6 h-6 fill-current" />
                            Play Movie
                        </button>
                        <!-- Trailer button, etc -->
                    </div>
                </div>
            </div>
        </div>
    </div>
{/if}
