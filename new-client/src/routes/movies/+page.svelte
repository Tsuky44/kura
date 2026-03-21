<script lang="ts">
  import { onMount } from 'svelte';
  import { getMovies } from '$lib/api';
  import MovieCard from '$lib/components/MovieCard.svelte';
  import { fade } from 'svelte/transition';
  
  let movies: any[] = [];
  let isLoading = true;
  
  onMount(async () => {
    try {
        movies = await getMovies();
    } catch (e) {
        console.error(e);
    } finally {
        isLoading = false;
    }
  });
</script>

<div class="container mx-auto" in:fade>
    <h1 class="text-3xl font-bold mb-8 flex items-center gap-3 text-text">
        <span class="w-1.5 h-8 bg-primary rounded-full block"></span>
        All Movies
    </h1>

    {#if isLoading}
        <div class="flex justify-center py-20">
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
    {:else if movies.length === 0}
        <div class="text-center py-20 text-gray-500">
            <p>No movies found.</p>
        </div>
    {:else}
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {#each movies as movie}
                <MovieCard {movie} />
            {/each}
        </div>
    {/if}
</div>
