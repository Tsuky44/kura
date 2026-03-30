<script lang="ts">
  import { Search, Bell, User } from 'lucide-svelte';
  
  export let searchQuery = '';
  let isSearchFocused = false;
</script>

<header class="fixed top-0 right-0 left-64 h-16 bg-gradient-to-b from-[#0a0a0f] to-transparent z-30 flex items-center justify-between px-8">
  <!-- Search Bar -->
  <div class="flex-1 max-w-xl">
    <div class="relative group">
      <Search class="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 transition-colors group-focus-within:text-primary" />
      <input
        type="text"
        placeholder="Rechercher des titres, personnes, genres..."
        bind:value={searchQuery}
        on:focus={() => isSearchFocused = true}
        on:blur={() => isSearchFocused = false}
        class="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-11 pr-4 text-sm text-white placeholder-gray-500 focus:outline-none focus:bg-white/10 focus:border-primary/50 transition-all"
      />
      {#if searchQuery}
        <button 
          class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
          on:click={() => searchQuery = ''}
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      {/if}
    </div>
  </div>
  
  <!-- Right Section -->
  <div class="flex items-center gap-4">
    <button class="relative p-2 text-gray-400 hover:text-white transition-colors">
      <Bell class="w-5 h-5" />
      <span class="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full"></span>
    </button>
    
    <div class="flex items-center gap-3 pl-4 border-l border-white/10">
      <div class="text-right hidden sm:block">
        <p class="text-sm font-medium text-white">Alex Curator</p>
        <p class="text-xs text-gray-500">Premium</p>
      </div>
      <button class="w-9 h-9 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center text-white font-medium text-sm border border-white/10 hover:border-primary/50 transition-all">
        <User class="w-4 h-4" />
      </button>
    </div>
  </div>
</header>
