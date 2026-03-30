<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getMovies, getContinueWatching, getStreamUrl, getPosterUrl, getBackdropUrl, apiUrl } from '$lib/api';
  import { playMedia, openPlayer } from '$lib/stores/player';
  import { generateRecommendations, getHeroRecommendations, analyzeViewingPatterns, categorizeRecommendations, getPersonalizedMessage, type ScoredContent, type ViewingPattern } from '$lib/recommendations';
  import { fade, fly } from 'svelte/transition';
  import { Play, Info, ChevronRight, Clock, Star, TrendingUp, ChevronLeft, Plus, Sparkles, Eye, ThumbsUp } from 'lucide-svelte';
  import { get } from 'svelte/store';
  
  let allMovies: any[] = [];
  let allTvShows: any[] = [];
  let continueWatching: any[] = [];
  let isLoading = true;
  
  // Personalized recommendations
  let recommendations: ScoredContent[] = [];
  let viewingPatterns: ViewingPattern | null = null;
  let personalizedMessage = '';
  let becauseYouWatched: ScoredContent[] = [];
  let trendingForYou: ScoredContent[] = [];
  let hiddenGems: ScoredContent[] = [];
  
  // Hero Carousel
  let featuredMovies: any[] = [];
  let currentHeroIndex = 0;
  let heroInterval: ReturnType<typeof setInterval>;
  let isHeroPaused = false;
  let progressInterval: ReturnType<typeof setInterval>;
  let heroProgress = 0;
  const HERO_SLIDE_DURATION = 8000;
  
  let continueScroll: HTMLElement;
  
  onMount(async () => {
    try {
      const [moviesData, cwData] = await Promise.all([
        getMovies(),
        getContinueWatching()
      ]);
      
      // Store all data
      allMovies = moviesData.filter(m => m.type !== 'episode' && !m.show_title);
      allTvShows = moviesData.filter(m => m.type === 'episode' || m.show_title);
      continueWatching = cwData;
      
      // Analyze viewing patterns and generate personalized recommendations
      if (continueWatching.length > 0) {
        viewingPatterns = analyzeViewingPatterns(continueWatching);
        personalizedMessage = getPersonalizedMessage(viewingPatterns);
        
        // Generate recommendations from all content
        const allContent = [...allMovies, ...allTvShows];
        recommendations = generateRecommendations(allContent, continueWatching, 30);
        
        // Categorize recommendations
        const categorized = categorizeRecommendations(recommendations);
        becauseYouWatched = categorized.becauseYouWatched;
        trendingForYou = categorized.trending;
        hiddenGems = categorized.hiddenGems;
        
        // Get personalized hero content
        featuredMovies = getHeroRecommendations(allContent, continueWatching);
      } else {
        // Fallback: no history, show popular content
        allMovies = moviesData.slice(0, 30);
        featuredMovies = moviesData.filter(m => m.backdrop_path).slice(0, 5);
      }
      
      // Start auto-rotation
      if (featuredMovies.length > 0) {
        startHeroRotation();
      }
        
    } catch (e) {
      console.error("Error fetching data:", e);
    } finally {
      isLoading = false;
    }
  });
  
  onDestroy(() => {
    if (heroInterval) clearInterval(heroInterval);
    if (progressInterval) clearInterval(progressInterval);
  });
  
  function startHeroRotation() {
    // Progress bar animation
    heroProgress = 0;
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = setInterval(() => {
      if (!isHeroPaused) {
        heroProgress += 100 / (HERO_SLIDE_DURATION / 50); // Update every 50ms
        if (heroProgress >= 100) heroProgress = 100;
      }
    }, 50);
    
    // Slide change
    if (heroInterval) clearInterval(heroInterval);
    heroInterval = setInterval(() => {
      if (!isHeroPaused) {
        nextHeroSlide();
      }
    }, HERO_SLIDE_DURATION);
  }
  
  function nextHeroSlide() {
    currentHeroIndex = (currentHeroIndex + 1) % featuredMovies.length;
    heroProgress = 0;
  }
  
  function prevHeroSlide() {
    currentHeroIndex = (currentHeroIndex - 1 + featuredMovies.length) % featuredMovies.length;
    heroProgress = 0;
    startHeroRotation(); // Reset timer
  }
  
  function goToHeroSlide(index: number) {
    currentHeroIndex = index;
    heroProgress = 0;
    startHeroRotation(); // Reset timer
  }
  
  function pauseHero() {
    isHeroPaused = true;
  }
  
  function resumeHero() {
    isHeroPaused = false;
  }
  
  function playContinueItem(item: any) {
    const baseUrl = get(apiUrl);
    if (item.type === 'episode') {
      const streamUrl = `${baseUrl}/stream/${item.id}?type=episode`;
      const label = `${item.show_title} - S${String(item.season_number).padStart(2, '0')}E${String(item.episode_number).padStart(2, '0')}`;
      openPlayer(streamUrl, label, item.id, item.progress || 0);
    } else {
      playMedia(item, getStreamUrl(item.id));
    }
  }
  
  function formatProgress(progress: number, duration: number): number {
    if (!duration || duration <= 0) return 0;
    return Math.min((progress / duration) * 100, 100);
  }
  
  function formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}min`;
    return `${m}min`;
  }
  
  function scrollCarousel(element: HTMLElement, direction: 'left' | 'right') {
    const scrollAmount = 400;
    element.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    });
  }
</script>

{#if isLoading}
  <div class="flex items-center justify-center h-[80vh]">
    <div class="relative">
      <div class="animate-spin rounded-full h-16 w-16 border-2 border-primary/20 border-t-primary"></div>
      <div class="absolute inset-0 flex items-center justify-center">
        <Play class="w-6 h-6 text-primary/50" />
      </div>
    </div>
  </div>
{:else}
  <div class="pb-12" in:fade={{ duration: 400 }}>
    
    <!-- ========== HERO CAROUSEL (Netflix Style) ========== -->
    {#if featuredMovies.length > 0}
    <section 
      class="relative h-[75vh] w-full overflow-hidden"
      on:mouseenter={pauseHero}
      on:mouseleave={resumeHero}
    >
      <!-- Slides -->
      {#each featuredMovies as movie, i}
        {#if i === currentHeroIndex}
        <div 
          class="absolute inset-0 transition-opacity duration-1000"
          in:fade={{ duration: 800 }}
          out:fade={{ duration: 800 }}
        >
          <!-- Background Image -->
          <div class="absolute inset-0">
            <img 
              src={getBackdropUrl(movie.backdrop_path || movie.poster_path)} 
              alt={movie.title}
              class="w-full h-full object-cover scale-105"
              style="animation: kenBurns 20s ease-out forwards;"
            />
            <div class="absolute inset-0 bg-gradient-to-r from-[#0a0a0f] via-[#0a0a0f]/60 to-transparent"></div>
            <div class="absolute inset-0 bg-gradient-to-t from-[#0a0a0f] via-transparent to-[#0a0a0f]/40"></div>
            <div class="absolute inset-0 bg-[#0a0a0f]/20"></div>
          </div>
          
          <!-- Content -->
          <div class="relative h-full flex items-end pb-20 px-8">
            <div class="max-w-2xl space-y-5" in:fly={{ y: 40, duration: 800, delay: 300 }}>
              <!-- Badge Row -->
              <div class="flex items-center gap-3">
                <span class="px-3 py-1 bg-primary/20 text-primary text-xs font-semibold rounded-full border border-primary/30">
                  {i === 0 ? 'Nouveauté' : 'Tendance'}
                </span>
                <span class="text-gray-400 text-sm flex items-center gap-2">
                  <span>{movie.release_date?.split('-')[0] || '2024'}</span>
                  <span class="w-1 h-1 rounded-full bg-gray-500"></span>
                  <span>{movie.genres?.[0] || 'Drama'}</span>
                  <span class="w-1 h-1 rounded-full bg-gray-500"></span>
                  <span>{Math.floor((movie.runtime || 134) / 60)}h {(movie.runtime || 134) % 60}min</span>
                </span>
              </div>
              
              <!-- Title -->
              <h1 class="text-5xl md:text-7xl font-bold text-white leading-tight tracking-tight drop-shadow-2xl">
                {movie.title}
              </h1>
              
              <!-- Overview -->
              <p class="text-gray-300 text-lg leading-relaxed line-clamp-3 max-w-xl drop-shadow-lg">
                {movie.overview || 'Une histoire captivante qui vous tiendra en haleine.'}
              </p>
              
              <!-- Rating -->
              <div class="flex items-center gap-4">
                <div class="flex items-center gap-1 text-yellow-500">
                  <Star class="w-5 h-5 fill-current" />
                  <span class="font-semibold text-white text-lg">{(movie.vote_average || 8.5).toFixed(1)}</span>
                </div>
                <div class="flex items-center gap-1 text-gray-400">
                  <span class="text-sm">{Math.floor((movie.vote_count || 1250) / 1000)}K avis</span>
                </div>
              </div>
              
              <!-- Actions -->
              <div class="flex items-center gap-4 pt-2">
                <button 
                  on:click={() => playMedia(movie, getStreamUrl(movie.id))}
                  class="group flex items-center gap-3 bg-primary hover:bg-primary/90 text-white px-8 py-4 rounded-xl font-semibold transition-all hover:scale-105 shadow-xl shadow-primary/30"
                >
                  <Play class="w-5 h-5 fill-current group-hover:scale-110 transition-transform" />
                  <span>{movie.progress > 0 ? 'Reprendre' : 'Lire'}</span>
                </button>
                
                <a 
                  href="/movie/{movie.id}"
                  class="group flex items-center gap-3 bg-white/10 hover:bg-white/20 text-white px-8 py-4 rounded-xl font-semibold backdrop-blur-sm transition-all border border-white/10 hover:border-white/30"
                >
                  <Info class="w-5 h-5" />
                  <span>Plus d'infos</span>
                </a>
                
                <button class="p-4 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all border border-white/10">
                  <Plus class="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
        {/if}
      {/each}
      
      <!-- Navigation Arrows -->
      <button 
        on:click={prevHeroSlide}
        class="absolute left-4 top-1/2 -translate-y-1/2 z-20 w-12 h-12 bg-black/40 hover:bg-black/60 backdrop-blur rounded-full flex items-center justify-center text-white transition-all opacity-0 hover:opacity-100 focus:opacity-100 group-hover:opacity-100"
        style="opacity: 0;"
        on:mouseenter={(e) => e.currentTarget.style.opacity = '1'}
        on:mouseleave={(e) => e.currentTarget.style.opacity = '0'}
      >
        <ChevronLeft class="w-6 h-6" />
      </button>
      
      <button 
        on:click={nextHeroSlide}
        class="absolute right-4 top-1/2 -translate-y-1/2 z-20 w-12 h-12 bg-black/40 hover:bg-black/60 backdrop-blur rounded-full flex items-center justify-center text-white transition-all"
        style="opacity: 0;"
        on:mouseenter={(e) => e.currentTarget.style.opacity = '1'}
        on:mouseleave={(e) => e.currentTarget.style.opacity = '0'}
      >
        <ChevronRight class="w-6 h-6" />
      </button>
      
      <!-- Bottom Indicators with Progress -->
      <div class="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3">
        {#each featuredMovies as _, i}
          <button 
            on:click={() => goToHeroSlide(i)}
            class="group relative h-1 rounded-full overflow-hidden transition-all {i === currentHeroIndex ? 'w-8 bg-white/30' : 'w-2 bg-white'}"
          >
            {#if i === currentHeroIndex}
              <div 
                class="absolute inset-0 bg-white rounded-full transition-none"
                style="width: {heroProgress}%"
              ></div>
            {/if}
          </button>
        {/each}
      </div>
      
      <!-- Bottom Fade -->
      <div class="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-[#0a0a0f] via-[#0a0a0f]/50 to-transparent"></div>
    </section>
    {/if}
    
    <!-- ========== CONTINUE WATCHING ========== -->
    {#if continueWatching.length > 0}
    <section class="px-8 -mt-8 relative z-10">
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-3">
          <h2 class="text-xl font-bold text-white">Continuer à regarder</h2>
          <span class="px-2 py-0.5 bg-white/10 text-gray-400 text-xs rounded-full">{continueWatching.length}</span>
        </div>
        <a href="#" class="text-sm text-primary hover:text-primary/80 flex items-center gap-1 transition-colors">
          Tout voir <ChevronRight class="w-4 h-4" />
        </a>
      </div>
      
      <div class="relative group">
        <button 
          on:click={() => scrollCarousel(continueScroll, 'left')}
          class="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-black/50 hover:bg-black/80 backdrop-blur rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all -translate-x-1/2"
        >
          <ChevronLeft class="w-5 h-5" />
        </button>
        
        <div 
          bind:this={continueScroll}
          class="flex gap-4 overflow-x-auto scrollbar-hide scroll-smooth pb-4"
          style="scrollbar-width: none; -ms-overflow-style: none;"
        >
          {#each continueWatching as item, i}
          <button 
            on:click={() => playContinueItem(item)}
            class="flex-shrink-0 w-72 group/card"
            style="animation-delay: {i * 50}ms"
          >
            <div class="relative aspect-video rounded-2xl overflow-hidden bg-gray-800 mb-3 border border-white/5 group-hover/card:border-primary/30 transition-all group-hover/card:shadow-2xl group-hover/card:shadow-primary/10">
              <img 
                src={getPosterUrl(item.backdrop_path || item.show_poster || item.poster_path)} 
                alt={item.title || item.show_title}
                class="w-full h-full object-cover transition-transform duration-500 group-hover/card:scale-110"
              />
              <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
              <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-all">
                <div class="w-14 h-14 bg-primary rounded-full flex items-center justify-center shadow-lg transform scale-75 group-hover/card:scale-100 transition-transform">
                  <Play class="w-6 h-6 text-white fill-current ml-1" />
                </div>
              </div>
              
              {#if item.progress > 0 && item.duration > 0}
              <div class="absolute bottom-0 left-0 right-0 h-1.5 bg-white/20">
                <div 
                  class="h-full bg-primary rounded-r"
                  style="width: {formatProgress(item.progress, item.duration)}%"
                ></div>
              </div>
              {/if}
              
              {#if item.duration && item.progress}
              <div class="absolute bottom-3 right-3 px-2 py-1 bg-black/60 backdrop-blur rounded-md text-xs text-white">
                {formatTime(item.duration - item.progress)} restant
              </div>
              {/if}
            </div>
            
            <div class="text-left">
              <h3 class="font-semibold text-white text-sm line-clamp-1 group-hover/card:text-primary transition-colors">
                {#if item.type === 'episode'}
                  {item.show_title}
                {:else}
                  {item.title}
                {/if}
              </h3>
              {#if item.type === 'episode'}
                <p class="text-xs text-gray-500 mt-1">
                  S{String(item.season_number).padStart(2, '0')}E{String(item.episode_number).padStart(2, '0')} · {item.title}
                </p>
              {:else}
                <p class="text-xs text-gray-500 mt-1">
                  Film • {item.release_date?.split('-')[0] || '2024'}
                </p>
              {/if}
            </div>
          </button>
          {/each}
        </div>
        
        <button 
          on:click={() => scrollCarousel(continueScroll, 'right')}
          class="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-black/50 hover:bg-black/80 backdrop-blur rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all translate-x-1/2"
        >
          <ChevronRight class="w-5 h-5" />
        </button>
      </div>
    </section>
    {/if}
    
    <!-- ========== PERSONALIZED MESSAGE BANNER ========== -->
    {#if viewingPatterns && personalizedMessage}
    <section class="px-8 mt-8 mb-4">
      <div class="flex items-center gap-3 p-4 bg-gradient-to-r from-primary/10 to-transparent rounded-xl border border-primary/20">
        <div class="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
          <Sparkles class="w-5 h-5 text-primary" />
        </div>
        <div>
          <p class="text-white font-medium">{personalizedMessage}</p>
          {#if viewingPatterns.preferredContentType === 'movie'}
            <p class="text-sm text-gray-400">Vous avez regardé {viewingPatterns.movieCount} films · {Math.round(viewingPatterns.totalWatchTime / 60)}h regardées</p>
          {:else if viewingPatterns.preferredContentType === 'tv'}
            <p class="text-sm text-gray-400">Vous avez regardé {viewingPatterns.tvCount} séries · {Math.round(viewingPatterns.totalWatchTime / 60)}h regardées</p>
          {/if}
        </div>
      </div>
    </section>
    {/if}
    
    <!-- ========== BECAUSE YOU WATCHED ========== -->
    {#if becauseYouWatched.length > 0}
    <section class="px-8 mt-8">
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
            <Eye class="w-4 h-4 text-white" />
          </div>
          <h2 class="text-xl font-bold text-white">Sélectionné pour vous</h2>
        </div>
      </div>
      
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
        {#each becauseYouWatched.slice(0, 6) as scored}
        {@const movie = scored.item}
        <a 
          href="/movie/{movie.id}"
          class="group/card relative"
        >
          <div class="relative aspect-[2/3] rounded-xl overflow-hidden bg-gray-800 border border-white/5 group-hover/card:border-primary/30 transition-all group-hover/card:shadow-2xl group-hover/card:shadow-primary/10 group-hover/card:-translate-y-2">
            <img 
              src={getPosterUrl(movie.poster_path)}
              alt={movie.title}
              class="w-full h-full object-cover"
            />
            
            <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent opacity-0 group-hover/card:opacity-100 transition-all">
              <div class="absolute inset-0 flex items-center justify-center">
                <div class="w-12 h-12 bg-primary rounded-full flex items-center justify-center shadow-lg transform scale-75 group-hover/card:scale-100 transition-all">
                  <Play class="w-5 h-5 text-white fill-current ml-0.5" />
                </div>
              </div>
              
              <div class="absolute bottom-0 left-0 right-0 p-4">
                <p class="text-white font-semibold text-sm line-clamp-1">{movie.title}</p>
                <p class="text-xs text-primary mt-1">{scored.reason}</p>
              </div>
            </div>
          </div>
          
          <h3 class="font-medium text-white text-sm line-clamp-1 group-hover/card:text-primary transition-colors mt-2">
            {movie.title}
          </h3>
        </a>
        {/each}
      </div>
    </section>
    {/if}
    
    <!-- ========== TRENDING FOR YOU ========== -->
    <section class="px-8 mt-12">
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
            <TrendingUp class="w-4 h-4 text-white" />
          </div>
          <h2 class="text-xl font-bold text-white">
            {#if viewingPatterns?.preferredContentType === 'movie'}
              Films Tendance
            {:else if viewingPatterns?.preferredContentType === 'tv'}
              Séries Tendance
            {:else}
              Tendance Actuelle
            {/if}
          </h2>
        </div>
      </div>
      
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
        {#each (trendingForYou.length > 0 ? trendingForYou : recommendations.slice(0, 12)) as scored, i}
        {@const movie = scored.item}
        <a 
          href="/movie/{movie.id}"
          class="group/card relative"
        >
          <div class="relative aspect-[2/3] rounded-xl overflow-hidden bg-gray-800 border border-white/5 group-hover/card:border-primary/30 transition-all group-hover/card:shadow-2xl group-hover/card:shadow-primary/10 group-hover/card:-translate-y-2">
            <img 
              src={getPosterUrl(movie.poster_path)}
              alt={movie.title}
              class="w-full h-full object-cover"
            />
            
            <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent opacity-0 group-hover/card:opacity-100 transition-all">
              <div class="absolute inset-0 flex items-center justify-center">
                <div class="w-12 h-12 bg-primary rounded-full flex items-center justify-center shadow-lg transform scale-75 group-hover/card:scale-100 transition-all">
                  <Play class="w-5 h-5 text-white fill-current ml-0.5" />
                </div>
              </div>
              
              <div class="absolute bottom-0 left-0 right-0 p-4">
                <p class="text-white font-semibold text-sm line-clamp-1">{movie.title}</p>
                <div class="flex items-center gap-2 mt-1">
                  <span class="text-xs text-gray-400">{movie.release_date?.split('-')[0] || '2024'}</span>
                  <span class="text-xs text-primary">★ {(movie.vote_average || 8.0).toFixed(1)}</span>
                </div>
              </div>
            </div>
            
            <div class="absolute top-2 left-2 w-8 h-8 bg-black/60 backdrop-blur rounded-lg flex items-center justify-center">
              <span class="text-white font-bold text-sm">{i + 1}</span>
            </div>
          </div>
          
          <div class="mt-2 h-1 bg-white/10 rounded-full overflow-hidden">
            <div 
              class="h-full rounded-full"
              style="width: {(movie.vote_average / 10) * 100}%; background: linear-gradient(90deg, #6366F1, #8B5CF6);"
            ></div>
          </div>
        </a>
        {/each}
      </div>
    </section>
    
    <!-- ========== HIDDEN GEMS ========== -->
    {#if hiddenGems.length > 0}
    <section class="px-8 mt-12">
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-lg flex items-center justify-center">
            <ThumbsUp class="w-4 h-4 text-white" />
          </div>
          <h2 class="text-xl font-bold text-white">Trésors Cachés Pour Vous</h2>
        </div>
      </div>
      
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
        {#each hiddenGems.slice(0, 6) as scored}
        {@const movie = scored.item}
        <a 
          href="/movie/{movie.id}"
          class="group/card"
        >
          <div class="relative aspect-[2/3] rounded-xl overflow-hidden bg-gray-800 mb-3 border border-white/5 group-hover/card:border-primary/30 transition-all group-hover/card:shadow-2xl group-hover/card:shadow-primary/10 group-hover/card:-translate-y-1">
            <img 
              src={getPosterUrl(movie.poster_path)}
              alt={movie.title}
              class="w-full h-full object-cover transition-transform duration-500 group-hover/card:scale-110"
            />
            
            <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover/card:opacity-100 transition-all">
              <div class="absolute bottom-0 left-0 right-0 p-3">
                <p class="text-white font-semibold text-xs line-clamp-2">{movie.title}</p>
                <div class="flex items-center gap-1 mt-1">
                  <Star class="w-3 h-3 text-yellow-500 fill-current" />
                  <span class="text-xs text-gray-300">{(movie.vote_average || 0).toFixed(1)}</span>
                </div>
              </div>
            </div>
          </div>
          
          <h3 class="font-medium text-white text-sm line-clamp-1 group-hover/card:text-primary transition-colors">
            {movie.title}
          </h3>
          <p class="text-xs text-gray-500 mt-0.5">{movie.release_date?.split('-')[0] || '2024'}</p>
        </a>
        {/each}
      </div>
    </section>
    {/if}
    
    <!-- ========== MORE RECOMMENDATIONS ========== -->
    <section class="px-8 mt-12">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-xl font-bold text-white">
          {#if viewingPatterns?.preferredContentType === 'movie'}
            Plus de Films Pour Vous
          {:else if viewingPatterns?.preferredContentType === 'tv'}
            Plus de Séries Pour Vous
          {:else}
            Recommandé Pour Vous
          {/if}
        </h2>
        <a href="/movies" class="text-sm text-primary hover:text-primary/80 flex items-center gap-1 transition-colors">
          Parcourir Tout <ChevronRight class="w-4 h-4" />
        </a>
      </div>
      
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
        {#each recommendations.slice(6, 24) as scored}
        {@const movie = scored.item}
        <a 
          href="/movie/{movie.id}"
          class="group/card"
        >
          <div class="relative aspect-[2/3] rounded-xl overflow-hidden bg-gray-800 mb-3 border border-white/5 group-hover/card:border-primary/30 transition-all group-hover/card:shadow-2xl group-hover/card:shadow-primary/10 group-hover/card:-translate-y-1">
            <img 
              src={getPosterUrl(movie.poster_path)}
              alt={movie.title}
              class="w-full h-full object-cover transition-transform duration-500 group-hover/card:scale-110"
            />
            
            <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover/card:opacity-100 transition-all">
              <div class="absolute bottom-0 left-0 right-0 p-3">
                <p class="text-white font-semibold text-xs line-clamp-2">{movie.title}</p>
                <div class="flex items-center gap-1 mt-1">
                  <Star class="w-3 h-3 text-yellow-500 fill-current" />
                  <span class="text-xs text-gray-300">{(movie.vote_average || 0).toFixed(1)}</span>
                </div>
              </div>
            </div>
          </div>
          
          <h3 class="font-medium text-white text-sm line-clamp-1 group-hover/card:text-primary transition-colors">
            {movie.title}
          </h3>
          <p class="text-xs text-gray-500 mt-0.5">{movie.release_date?.split('-')[0] || '2024'}</p>
        </a>
        {/each}
      </div>
    </section>
    
  </div>
{/if}

<style>
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
  
  .line-clamp-1 {
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  
  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  
  .line-clamp-3 {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  
  /* Ken Burns zoom effect for hero backgrounds */
  @keyframes kenBurns {
    0% {
      transform: scale(1.05) translate(0, 0);
    }
    100% {
      transform: scale(1.15) translate(-1%, -1%);
    }
  }
</style>
