<script lang="ts">
  import { Home, Tv, Film, Settings, User, Search } from 'lucide-svelte';
  
  export let active = 'home';
</script>

<div class="fixed left-0 top-0 h-full w-20 bg-background border-r border-surface flex flex-col items-center py-8 gap-8 z-40">
    <div class="mb-4">
        <div class="w-10 h-10 bg-primary rounded-lg flex items-center justify-center font-bold text-xl text-white">K</div>
    </div>
    
    <a href="/" class="p-3 rounded-xl hover:bg-surface transition-colors {active === 'home' ? 'text-primary bg-surface' : 'text-gray-400'}">
        <Home size={24} />
    </a>
    
    <a href="/movies" class="p-3 rounded-xl hover:bg-surface transition-colors {active === 'movies' ? 'text-primary bg-surface' : 'text-gray-400'}">
        <Film size={24} />
    </a>
    
    <a href="/tv" class="p-3 rounded-xl hover:bg-surface transition-colors {active === 'tv' ? 'text-primary bg-surface' : 'text-gray-400'}">
        <Tv size={24} />
    </a>
    
    <div class="mt-auto flex flex-col gap-4">
        <button class="p-3 rounded-xl hover:bg-surface text-gray-400 transition-colors">
            <Search size={24} />
        </button>
        <a href="/settings" class="p-3 rounded-xl hover:bg-surface transition-colors {active === 'settings' ? 'text-primary bg-surface' : 'text-gray-400'}">
            <Settings size={24} />
        </a>
        <button class="p-3 rounded-xl hover:bg-surface text-gray-400 transition-colors">
            <User size={24} />
        </button>
    </div>
</div>
