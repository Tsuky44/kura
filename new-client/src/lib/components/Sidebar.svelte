<script lang="ts">
  import { Home, Tv, Film, Settings, Search, Compass, Heart, Clock } from 'lucide-svelte';
  import { page } from '$app/stores';
  
  $: currentPath = $page.url.pathname;
  
  const navItems = [
    { icon: Home, label: 'Accueil', href: '/' },
    { icon: Compass, label: 'Explorer', href: '/movies' },
    { icon: Tv, label: 'Séries', href: '/tv' },
    { icon: Film, label: 'Films', href: '/movies' },
    { icon: Heart, label: 'Favoris', href: '#' },
    { icon: Clock, label: 'Récent', href: '#' },
  ];
</script>

<div class="fixed left-0 top-0 h-full w-64 bg-[#0a0a0f]/95 backdrop-blur-xl border-r border-white/5 flex flex-col z-40">
  <!-- Logo Section -->
  <div class="p-6 mb-2">
    <a href="/" class="flex items-center gap-3 group">
      <div class="w-10 h-10 bg-gradient-to-br from-primary to-primary/60 rounded-xl flex items-center justify-center font-bold text-xl text-white shadow-lg shadow-primary/20 group-hover:shadow-primary/40 transition-all">
        <Film class="w-5 h-5" />
      </div>
      <div class="flex flex-col">
        <span class="font-bold text-lg text-white tracking-tight">MyFlix</span>
        <span class="text-[10px] text-gray-500 uppercase tracking-widest">Premium</span>
      </div>
    </a>
  </div>
  
  <!-- Main Navigation -->
  <nav class="flex-1 px-4">
    <p class="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3 px-3">Menu</p>
    <div class="space-y-1">
      {#each navItems as item}
        <a 
          href={item.href}
          class="flex items-center gap-3 px-3 py-3 rounded-xl transition-all group {currentPath === item.href ? 'bg-primary/10 text-primary' : 'text-gray-400 hover:bg-white/5 hover:text-white'}"
        >
          <item.icon class="w-5 h-5 transition-transform group-hover:scale-110" />
          <span class="font-medium text-sm">{item.label}</span>
          {#if currentPath === item.href}
            <div class="ml-auto w-1.5 h-1.5 rounded-full bg-primary"></div>
          {/if}
        </a>
      {/each}
    </div>
  </nav>
  
  <!-- Bottom Section -->
  <div class="p-4 border-t border-white/5">
    <a 
      href="/settings" 
      class="flex items-center gap-3 px-3 py-3 rounded-xl text-gray-400 hover:bg-white/5 hover:text-white transition-all group"
    >
      <Settings class="w-5 h-5 transition-transform group-hover:rotate-45" />
      <span class="font-medium text-sm">Paramètres</span>
    </a>
  </div>
</div>

<style>
  .bg-\[\#0a0a0f\] {
    background-color: #0a0a0f;
  }
</style>
