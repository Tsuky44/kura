<script lang="ts">
  import { onMount } from 'svelte';
  import { getMovies, getContinueWatching, getStreamUrl, getPosterUrl, getBackdropUrl, apiUrl } from '$lib/api';
  import { playMedia, openPlayer } from '$lib/stores/player';
  import MovieCard from '$lib/components/MovieCard.svelte';
  import { fade } from 'svelte/transition';
  import { Play, Clock } from 'lucide-svelte';
  
  let movies: any[] = [];
  let continueWatching: any[] = [];
  let isLoading = true;
  
  onMount(async () => {
    try {
        const [moviesData, cwData] = await Promise.all([
            getMovies(),
            getContinueWatching()
        ]);
        movies = moviesData;
        continueWatching = cwData;
    } catch (e) {
        console.error("Error fetching data:", e);
    } finally {
        isLoading = false;
    }
  });
  
  function playContinueItem(item: any) {
      if (item.type === 'episode') {
          const streamUrl = `${$apiUrl}/stream/${item.id}?type=episode`;
          const label = `${item.show_title} - S${String(item.season_number).padStart(2, '0')}E${String(item.episode_number).padStart(2, '0')}`;
          openPlayer(streamUrl, label, item.id, item.progress || 0);
      } else {
          playMedia(item, getStreamUrl(item.id));
      }
  }
  
  function formatProgress(progress: number, duration: number): string {
      if (!duration || duration <= 0) return '';
      const pct = Math.round((progress / duration) * 100);
      return `${pct}%`;
  }
  
  function formatTime(seconds: number): string {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      if (h > 0) return `${h}h ${m}min`;
      return `${m}min`;
  }
</script>

{#if isLoading}
    <div class="flex items-center justify-center h-96">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
    </div>
{:else}
    <div class="space-y-12" in:fade>
        <!-- Hero Section -->
        {#if movies.length > 0}
        <div class="relative h-[50vh] w-full rounded-2xl overflow-hidden shadow-2xl group cursor-pointer border border-surface">
            <img 
                src={getBackdropUrl(movies[0].backdrop_path)} 
                alt="Hero" 
                class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <div class="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent flex flex-col justify-center p-12">
                <h1 class="text-5xl font-bold mb-4 max-w-2xl leading-tight text-text">{movies[0].title}</h1>
                <p class="text-gray-300 max-w-xl line-clamp-3 mb-8 text-lg">{movies[0].overview}</p>
                <div class="flex gap-4">
                    <button 
                        on:click={() => playMedia(movies[0], getStreamUrl(movies[0].id))}
                        class="bg-primary hover:bg-primary/80 text-white px-8 py-3 rounded-lg font-bold flex items-center gap-2 transition-transform hover:scale-105 shadow-lg shadow-primary/20"
                    >
                        <Play class="w-6 h-6 fill-current" />
                        {movies[0].progress > 0 ? 'Reprendre' : 'Lecture'}
                    </button>
                    <a href="/movie/{movies[0].id}" class="bg-surface/80 hover:bg-surface text-text px-8 py-3 rounded-lg font-bold backdrop-blur-sm transition-colors border border-surface">
                        Plus d'infos
                    </a>
                </div>
            </div>
        </div>
        {/if}

        <!-- Continue Watching Section -->
        {#if continueWatching.length > 0}
        <section>
            <div class="flex items-center justify-between mb-6">
                <h2 class="text-2xl font-bold text-text flex items-center gap-2">
                    <span class="w-1 h-6 bg-primary rounded-full block"></span>
                    Reprendre la lecture
                </h2>
            </div>
            
            <div class="flex gap-4 overflow-x-auto pb-4">
                {#each continueWatching as item}
                <button 
                    on:click={() => playContinueItem(item)}
                    class="flex-shrink-0 w-72 bg-surface/40 rounded-xl overflow-hidden border border-surface hover:bg-surface/70 transition-all group cursor-pointer text-left"
                >
                    <!-- Thumbnail -->
                    <div class="relative w-full aspect-video bg-surface">
                        {#if item.backdrop_path || item.show_poster || item.poster_path}
                            <img 
                                src={getPosterUrl(item.backdrop_path || item.show_poster || item.poster_path)} 
                                alt={item.title || item.show_title} 
                                class="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                            />
                        {/if}
                        <div class="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                            <div class="bg-primary p-3 rounded-full shadow-lg">
                                <Play class="w-6 h-6 fill-current text-white" />
                            </div>
                        </div>
                        <!-- Progress Bar -->
                        {#if item.progress > 0 && item.duration > 0}
                        <div class="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                            <div class="h-full bg-primary" style="width: {Math.min((item.progress / item.duration) * 100, 100)}%"></div>
                        </div>
                        {/if}
                    </div>
                    
                    <!-- Info -->
                    <div class="p-3">
                        <h3 class="font-bold text-text text-sm line-clamp-1 group-hover:text-primary transition-colors">
                            {#if item.type === 'episode'}
                                {item.show_title}
                            {:else}
                                {item.title}
                            {/if}
                        </h3>
                        {#if item.type === 'episode'}
                            <p class="text-xs text-gray-400 mt-1">
                                S{String(item.season_number).padStart(2, '0')}E{String(item.episode_number).padStart(2, '0')} · {item.title}
                            </p>
                        {/if}
                        <div class="flex items-center gap-2 mt-2 text-xs text-gray-500">
                            <Clock class="w-3 h-3" />
                            {#if item.duration && item.duration > 0}
                                <span>{formatTime(item.duration - item.progress)} restant</span>
                            {:else}
                                <span>{formatTime(item.progress)} vu</span>
                            {/if}
                        </div>
                    </div>
                </button>
                {/each}
            </div>
        </section>
        {/if}

        <!-- All Movies -->
        <section>
            <div class="flex items-center justify-between mb-6">
                <h2 class="text-2xl font-bold text-text flex items-center gap-2">
                    <span class="w-1 h-6 bg-primary rounded-full block"></span>
                    Films
                </h2>
            </div>
            
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                {#each movies as movie}
                    <MovieCard {movie} />
                {/each}
            </div>
        </section>
    </div>
{/if}
