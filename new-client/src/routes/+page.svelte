<script lang="ts">
  import { onMount } from 'svelte';
  import { getMovies } from '$lib/api';
  import MovieCard from '$lib/components/MovieCard.svelte';
  import { fade } from 'svelte/transition';
  
  let movies: any[] = [];
  let isLoading = true;
  
  onMount(async () => {
    try {
        console.log("Fetching movies from home...");
        movies = await getMovies();
        console.log("Movies fetched:", movies);
    } catch (e) {
        console.error("Error fetching movies:", e);
    } finally {
        isLoading = false;
    }
  });
</script>

{#if isLoading}
    <div class="flex items-center justify-center h-96">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
    </div>
{:else}
    <div class="space-y-12" in:fade>
        <!-- Hero Section Placeholder (Could pick a random movie) -->
        {#if movies.length > 0}
        <div class="relative h-[50vh] w-full rounded-2xl overflow-hidden shadow-2xl group cursor-pointer border border-surface">
            <img 
                src={`https://image.tmdb.org/t/p/original${movies[0].backdrop_path}`} 
                alt="Hero" 
                class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <div class="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent flex flex-col justify-center p-12">
                <h1 class="text-5xl font-bold mb-4 max-w-2xl leading-tight text-text">{movies[0].title}</h1>
                <p class="text-gray-300 max-w-xl line-clamp-3 mb-8 text-lg">{movies[0].overview}</p>
                <div class="flex gap-4">
                    <button class="bg-primary hover:bg-primary/80 text-white px-8 py-3 rounded-lg font-bold flex items-center gap-2 transition-transform hover:scale-105 shadow-lg shadow-primary/20">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
                        </svg>
                        Play Now
                    </button>
                    <button class="bg-surface/80 hover:bg-surface text-text px-8 py-3 rounded-lg font-bold backdrop-blur-sm transition-colors border border-surface">
                        More Info
                    </button>
                </div>
            </div>
        </div>
        {/if}

        <section>
            <div class="flex items-center justify-between mb-6">
                <h2 class="text-2xl font-bold text-text flex items-center gap-2">
                    <span class="w-1 h-6 bg-primary rounded-full block"></span>
                    Recently Added
                </h2>
                <button class="text-gray-400 hover:text-primary text-sm font-medium transition-colors">View All</button>
            </div>
            
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                {#each movies as movie}
                    <MovieCard {movie} />
                {/each}
            </div>
        </section>
    </div>
{/if}
