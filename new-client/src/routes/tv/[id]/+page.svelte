<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { Play, ArrowLeft, Star, Calendar, ChevronDown, MonitorPlay, RotateCcw } from 'lucide-svelte';
  import { apiUrl } from '$lib/api';
  import { player, openPlayer } from '$lib/stores/player';

  let show: any = null;
  let isLoading = true;
  let error: string | null = null;
  
  let selectedSeasonIndex = 0;

  onMount(async () => {
      try {
          const res = await fetch(`${$apiUrl}/tv/${$page.params.id}`);
          if (!res.ok) throw new Error('TV Show not found');
          show = await res.json();
      } catch (e: any) {
          error = e.message;
      } finally {
          isLoading = false;
      }
  });

  function getPosterUrl(path: string | null) {
      if (path && path.startsWith('http')) return path;
      if (path) return `https://image.tmdb.org/t/p/w500${path}`;
      return 'https://via.placeholder.com/500x750?text=No+Poster';
  }

  function getBackdropUrl(path: string | null) {
      if (path && path.startsWith('http')) return path;
      if (path) return `https://image.tmdb.org/t/p/original${path}`;
      return 'https://via.placeholder.com/1920x1080?text=No+Backdrop';
  }
  
  function getStillUrl(path: string | null) {
      if (path && path.startsWith('http')) return path;
      if (path) return `https://image.tmdb.org/t/p/w500${path}`;
      return 'https://via.placeholder.com/500x281?text=No+Image';
  }

  function playEpisode(episode: any, startTime?: number) {
      const streamUrl = `${$apiUrl}/stream/${episode.id}?type=episode`;
      const label = `${show.title} - S${show.seasons[selectedSeasonIndex].season_number.toString().padStart(2, '0')}E${episode.episode_number.toString().padStart(2, '0')}`;
      const resume = startTime !== undefined ? startTime : (episode.progress || 0);
      openPlayer(streamUrl, label, episode.id, resume);
  }

  function canResume(episode: any): boolean {
      return episode.progress > 60 && episode.duration > 0 && episode.progress < episode.duration * 0.95;
  }

  function formatTime(seconds: number): string {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
</script>

{#if isLoading}
  <div class="flex items-center justify-center h-screen">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
  </div>
{:else if error || !show}
  <div class="flex flex-col items-center justify-center h-screen text-center">
      <h1 class="text-2xl font-bold mb-4 text-text">Erreur</h1>
      <p class="text-gray-400">{error || "Série introuvable"}</p>
      <a href="/tv" class="mt-4 text-primary hover:underline">Retour aux séries</a>
  </div>
{:else}
  <div class="relative min-h-screen pb-20" in:fade>
      <!-- Backdrop -->
      <div class="absolute inset-0 z-0 h-[70vh]">
          <img 
              src={getBackdropUrl(show.backdrop_path)} 
              alt="Backdrop" 
              class="w-full h-full object-cover opacity-30"
          />
          <div class="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent"></div>
          <div class="absolute inset-0 bg-gradient-to-r from-background via-background/50 to-transparent"></div>
      </div>

      <!-- Content -->
      <div class="relative z-10 container mx-auto px-4 sm:px-8 pt-20">
          <a href="/tv" class="inline-flex items-center text-gray-400 hover:text-text mb-8 transition-colors">
              <ArrowLeft class="w-5 h-5 mr-2" />
              Retour aux séries
          </a>

          <div class="flex flex-col md:flex-row gap-8 md:gap-12 mb-16">
              <!-- Poster -->
              <div class="w-64 sm:w-72 shrink-0 rounded-xl overflow-hidden shadow-2xl border border-surface">
                  <img 
                      src={getPosterUrl(show.poster_path)} 
                      alt={show.title} 
                      class="w-full h-auto"
                  />
              </div>

              <!-- Info -->
              <div class="flex-1 pt-4">
                  <h1 class="text-4xl sm:text-5xl font-bold mb-4 leading-tight text-text">{show.title}</h1>
                  
                  <div class="flex items-center gap-6 text-gray-300 mb-8">
                      <div class="flex items-center gap-2">
                          <Calendar class="w-5 h-5 text-primary" />
                          <span>{show.year || 'Inconnu'}</span>
                      </div>
                      <div class="flex items-center gap-2">
                          <MonitorPlay class="w-5 h-5 text-primary" />
                          <span>{show.seasons.length} Saison{show.seasons.length > 1 ? 's' : ''}</span>
                      </div>
                  </div>

                  <p class="text-lg text-gray-300 leading-relaxed max-w-3xl">
                      {show.summary || "Aucun résumé disponible."}
                  </p>
              </div>
          </div>

          <!-- Seasons and Episodes Section -->
          {#if show.seasons && show.seasons.length > 0}
              <div class="mt-12">
                  <!-- Season Selector -->
                  <div class="flex overflow-x-auto gap-4 mb-8 pb-4 custom-scrollbar">
                      {#each show.seasons as season, index}
                          <button 
                              class="px-6 py-3 rounded-lg font-bold whitespace-nowrap transition-colors border {selectedSeasonIndex === index ? 'bg-primary text-white border-primary shadow-lg shadow-primary/20' : 'bg-surface/50 text-gray-400 border-surface hover:text-text hover:bg-surface'}"
                              on:click={() => selectedSeasonIndex = index}
                          >
                              {season.title || `Saison ${season.season_number}`}
                          </button>
                      {/each}
                  </div>

                  <!-- Episodes Grid -->
                  {#if show.seasons[selectedSeasonIndex].episodes && show.seasons[selectedSeasonIndex].episodes.length > 0}
                      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                          {#each show.seasons[selectedSeasonIndex].episodes as episode}
                              <div class="bg-surface/30 border border-surface rounded-xl overflow-hidden hover:bg-surface/60 transition-colors group flex flex-col">
                                  <!-- Thumbnail row -->
                                  <div class="flex">
                                      <!-- Thumbnail -->
                                      <button
                                          class="w-1/3 aspect-video bg-surface relative shrink-0 cursor-pointer"
                                          on:click={() => playEpisode(episode)}
                                      >
                                          {#if episode.still_path}
                                              <img src={getStillUrl(episode.still_path)} alt={episode.title} class="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                                          {:else}
                                              <div class="w-full h-full flex items-center justify-center text-gray-600 bg-surface">
                                                  <MonitorPlay class="w-8 h-8" />
                                              </div>
                                          {/if}
                                          <div class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                                              <Play class="w-10 h-10 text-white fill-current" />
                                          </div>
                                          <!-- Progress Bar -->
                                          {#if episode.progress > 0 && episode.duration > 0}
                                              <div class="absolute bottom-0 left-0 h-1 bg-primary" style="width: {Math.min((episode.progress / episode.duration) * 100, 100)}%"></div>
                                          {/if}
                                      </button>

                                      <!-- Episode Info -->
                                      <div class="p-4 flex flex-col justify-center w-2/3">
                                          <div class="text-primary text-sm font-bold mb-1">Épisode {episode.episode_number}</div>
                                          <h3 class="font-bold text-text line-clamp-1">{episode.title}</h3>
                                          {#if episode.duration}
                                              <div class="text-xs text-gray-400 mt-1">{Math.floor(episode.duration / 60)} min</div>
                                          {/if}
                                      </div>
                                  </div>

                                  <!-- Action buttons -->
                                  <div class="px-3 pb-3 flex gap-2">
                                      {#if canResume(episode)}
                                          <button
                                              on:click={() => playEpisode(episode, episode.progress)}
                                              class="flex-1 bg-primary hover:bg-primary/80 text-white text-xs font-bold px-3 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                                          >
                                              <Play class="w-3.5 h-3.5 fill-current" />
                                              Reprendre à {formatTime(episode.progress)}
                                          </button>
                                          <button
                                              on:click={() => playEpisode(episode, 0)}
                                              class="bg-surface hover:bg-surface/80 border border-surface text-gray-400 hover:text-white text-xs px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors"
                                              title="Recommencer depuis le début"
                                          >
                                              <RotateCcw class="w-3.5 h-3.5" />
                                          </button>
                                      {:else}
                                          <button
                                              on:click={() => playEpisode(episode, 0)}
                                              class="flex-1 bg-surface hover:bg-surface/80 border border-surface text-gray-300 hover:text-white text-xs font-semibold px-3 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                                          >
                                              <Play class="w-3.5 h-3.5 fill-current" />
                                              Lecture
                                          </button>
                                      {/if}
                                  </div>
                              </div>
                          {/each}
                      </div>
                  {:else}
                      <div class="text-center py-12 text-gray-500 bg-surface/30 rounded-xl border border-surface">
                          Aucun épisode trouvé pour cette saison.
                      </div>
                  {/if}
              </div>
          {/if}
      </div>
  </div>
{/if}