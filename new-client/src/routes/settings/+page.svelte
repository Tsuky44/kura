<script lang="ts">
  import { onMount } from 'svelte';
  import { apiUrl } from '$lib/api';
  import { fade } from 'svelte/transition';
  import { Save, Server, CheckCircle, XCircle, RefreshCw } from 'lucide-svelte';

  let currentUrl = '';
  let status: 'idle' | 'checking' | 'success' | 'error' = 'idle';
  let message = '';
  
  let scanStatus: 'idle' | 'scanning' | 'success' | 'error' = 'idle';
  let scanMessage = '';

  onMount(() => {
      apiUrl.subscribe(u => currentUrl = u)();
  });

  async function saveAndTest() {
      status = 'checking';
      message = 'Checking connection...';
      
      // Normalize URL (remove trailing slash)
      let urlToTest = currentUrl.replace(/\/$/, '');
      if (!urlToTest.startsWith('http')) {
          urlToTest = 'http://' + urlToTest;
      }
      
      try {
          const res = await fetch(`${urlToTest}/movies`);
          if (res.ok) {
              status = 'success';
              message = 'Connected successfully!';
              apiUrl.set(urlToTest);
              // Force reload after delay
              setTimeout(() => {
                  window.location.href = '/';
              }, 1000);
          } else {
              throw new Error('Server reachable but returned error');
          }
      } catch (e) {
          status = 'error';
          message = 'Connection failed. Check URL and ensure server is running.';
      }
  }

  async function scanLibrary() {
      scanStatus = 'scanning';
      scanMessage = 'Démarrage du scan...';
      
      try {
          const res = await fetch(`${currentUrl}/scan`);
          if (res.ok) {
              const data = await res.json();
              scanStatus = 'success';
              scanMessage = 'Scan démarré en arrière-plan ! Vos films et séries apparaîtront bientôt.';
              setTimeout(() => scanStatus = 'idle', 5000);
          } else {
              throw new Error('Server returned error');
          }
      } catch (e) {
          scanStatus = 'error';
          scanMessage = 'Erreur lors du lancement du scan. Vérifiez la connexion au serveur.';
      }
  }
</script>

<div class="max-w-2xl mx-auto py-12" in:fade>
    <h1 class="text-3xl font-bold mb-8 flex items-center gap-3 text-text">
        <Server class="w-8 h-8 text-primary" />
        Paramètres du Serveur
    </h1>

    <div class="bg-surface/50 p-8 rounded-2xl border border-surface shadow-xl backdrop-blur-sm mb-8">
        <h2 class="text-xl font-bold mb-6 text-text">Connexion</h2>
        <div class="mb-6">
            <label for="server-url" class="block text-sm font-medium text-gray-400 mb-2">URL de l'API du Serveur</label>
            <div class="relative">
                <input 
                    id="server-url"
                    type="text" 
                    bind:value={currentUrl}
                    placeholder="http://192.168.1.123:3089"
                    class="w-full bg-background border border-surface rounded-xl px-4 py-3 text-text focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                />
            </div>
            <p class="mt-2 text-sm text-gray-500">
                Entrez l'adresse IP et le port de votre serveur MyFlix (ex: http://localhost:3089)
            </p>
        </div>

        <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
                {#if status === 'checking'}
                    <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-text"></div>
                {:else if status === 'success'}
                    <CheckCircle class="text-green-500 w-6 h-6" />
                {:else if status === 'error'}
                    <XCircle class="text-red-500 w-6 h-6" />
                {/if}
                
                {#if message}
                    <span class:text-green-400={status === 'success'} class:text-red-400={status === 'error'} class="text-sm font-medium">
                        {message}
                    </span>
                {/if}
            </div>

            <button 
                on:click={saveAndTest}
                disabled={status === 'checking'}
                class="bg-primary hover:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-primary/20"
            >
                <Save class="w-5 h-5" />
                Sauvegarder
            </button>
        </div>
    </div>

    <div class="bg-surface/50 p-8 rounded-2xl border border-surface shadow-xl backdrop-blur-sm">
        <h2 class="text-xl font-bold mb-2 text-text">Gestion de la Bibliothèque</h2>
        <p class="text-sm text-gray-400 mb-6">
            Forcer le serveur à scanner vos dossiers de films et séries pour détecter les nouveaux ajouts ou les fichiers supprimés.
        </p>

        <div class="flex items-center justify-between">
            <div class="flex items-center gap-3 flex-1 mr-4">
                {#if scanStatus === 'scanning'}
                    <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
                {:else if scanStatus === 'success'}
                    <CheckCircle class="text-green-500 w-6 h-6 shrink-0" />
                {:else if scanStatus === 'error'}
                    <XCircle class="text-red-500 w-6 h-6 shrink-0" />
                {/if}
                
                {#if scanMessage}
                    <span class:text-green-400={scanStatus === 'success'} class:text-red-400={scanStatus === 'error'} class="text-sm font-medium">
                        {scanMessage}
                    </span>
                {/if}
            </div>

            <button 
                on:click={scanLibrary}
                disabled={scanStatus === 'scanning' || !currentUrl}
                class="bg-surface hover:bg-surface/80 border border-surface disabled:opacity-50 disabled:cursor-not-allowed text-text px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shrink-0"
            >
                <RefreshCw class="w-5 h-5 {scanStatus === 'scanning' ? 'animate-spin' : ''}" />
                Scanner la bibliothèque
            </button>
        </div>
    </div>
</div>
