<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { apiUrl } from '$lib/api';
  
  let shows: any[] = [];
  let isLoading = true;

  onMount(async () => {
    try {
      const res = await fetch(`${$apiUrl}/tv`);
      if (res.ok) {
        shows = await res.json();
      }
    } catch (e) {
      console.error("Failed to fetch tv shows:", e);
    } finally {
      isLoading = false;
    }
  });

  function getPosterUrl(path: string | null) {
      if (path && path.startsWith('http')) return path;
      if (path) return `https://image.tmdb.org/t/p/w500${path}`;
      return 'https://via.placeholder.com/500x750?text=No+Poster';
  }
</script>

<div class="container mx-auto" in:fade>
    <h1 class="text-3xl font-bold mb-8 flex items-center gap-3 text-text">
        <span class="w-1.5 h-8 bg-primary rounded-full block"></span>
        Séries TV
    </h1>

    {#if isLoading}
        <div class="flex justify-center py-20">
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
    {:else if shows.length === 0}
        <div class="text-center py-20 text-gray-500">
            <p>Aucune série trouvée. Assurez-vous de scanner votre bibliothèque.</p>
        </div>
    {:else}
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {#each shows as show}
                <a href="/tv/{show.id}" class="relative group w-full aspect-[2/3] rounded-xl overflow-hidden bg-surface cursor-pointer transition-transform hover:scale-105 hover:z-10 shadow-lg border border-surface/50 block">
                    <img 
                        src={getPosterUrl(show.poster_path)} 
                        alt={show.title} 
                        class="w-full h-full object-cover transition-opacity group-hover:opacity-60"
                        loading="lazy"
                    />
                    
                    <div class="absolute inset-0 flex flex-col justify-end opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-background via-background/80 to-transparent p-4">
                        <h3 class="font-bold text-lg leading-tight line-clamp-2 text-text">{show.title}</h3>
                        <div class="flex items-center gap-2 mt-2 text-xs text-gray-300">
                            <span class="bg-surface px-2 py-0.5 rounded text-text border border-surface">
                                {show.year || 'N/A'}
                            </span>
                        </div>
                    </div>
                </a>
            {/each}
        </div>
    {/if}
</div>
