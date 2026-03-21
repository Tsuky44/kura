<script lang="ts">
  import { getPosterUrl } from '$lib/api';
  import { playMedia } from '$lib/stores/player';
  import { Play } from 'lucide-svelte';

  export let movie: any;
  
  function play() {
      // Direct play
      playMedia(movie, `http://192.168.1.123:3089/stream/${movie.id}`);
  }
</script>

<div class="relative group w-full aspect-[2/3] rounded-xl overflow-hidden bg-surface cursor-pointer transition-transform hover:scale-105 hover:z-10 shadow-lg border border-surface/50">
    <img 
        src={getPosterUrl(movie.poster_path)} 
        alt={movie.title} 
        class="w-full h-full object-cover transition-opacity group-hover:opacity-60"
        loading="lazy"
    />
    
    <!-- Hover Overlay -->
    <div class="absolute inset-0 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-background/40 backdrop-blur-[2px]">
        <button on:click|stopPropagation={play} class="bg-primary text-white p-4 rounded-full hover:bg-primary/80 hover:scale-110 transition-all shadow-xl shadow-primary/30">
            <Play class="w-8 h-8 fill-current ml-1" />
        </button>
        
        <div class="absolute bottom-0 w-full p-4 bg-gradient-to-t from-background via-background/80 to-transparent">
            <h3 class="font-bold text-lg leading-tight line-clamp-2 text-text">{movie.title}</h3>
            <div class="flex items-center gap-2 mt-2 text-xs text-gray-300">
                <span class="bg-surface px-2 py-0.5 rounded text-text border border-surface">
                    {movie.release_date ? new Date(movie.release_date).getFullYear() : 'N/A'}
                </span>
                <span class="text-primary font-semibold">
                    {movie.vote_average ? movie.vote_average.toFixed(1) : '0.0'} ★
                </span>
            </div>
        </div>
    </div>
    
    <a href="/movie/{movie.id}" class="absolute inset-0 z-0" aria-label="View Details"></a>
</div>
