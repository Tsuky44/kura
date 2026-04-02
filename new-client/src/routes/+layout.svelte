<script lang="ts">
  import "../app.css";
  import { player } from '$lib/stores/player';
  import { apiUrl } from '$lib/api';
  import Player from '$lib/components/Player.svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import Header from '$lib/components/Header.svelte';
  
  let playerState: any;
  player.subscribe(v => playerState = v);

  $: isPlayerActive = playerState?.isActive;
  $: streamUrl = playerState?.streamUrl;
  $: movieTitle = playerState?.title;
  $: mediaId = playerState?.mediaId;
  $: resumeTime = playerState?.resumeTime || 0;
</script>

<div class="min-h-screen text-white font-sans selection:bg-primary/30" style="background-color: {playerState?.isActive ? 'transparent' : '#0a0a0f'}">
    <!-- Global Player Overlay -->
    {#if playerState.isActive}
        <div class="fixed inset-0 z-[100] bg-transparent">
            <Player 
                streamUrl={playerState.streamUrl} 
                title={playerState.title}
                movieId={mediaId} 
                apiUrl={$apiUrl || "http://localhost:3000"}
                resumeTime={resumeTime}
            />
        </div>
    {/if}

    <!-- Main Layout - Hide when playing -->
    {#if !playerState.isActive}
        <Sidebar />
        <div class="ml-64">
            <Header />
            <main class="pt-16 min-h-screen">
                <slot />
            </main>
        </div>
    {/if}
</div>
