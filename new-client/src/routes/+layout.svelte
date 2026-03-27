<script lang="ts">
  import "../app.css";
  import { player } from '$lib/stores/player';
  import { apiUrl } from '$lib/api';
  import { page } from '$app/stores';
  import Player from '$lib/components/Player.svelte';
  import Navbar from '$lib/components/Navbar.svelte';
  
  let playerState: any;
  player.subscribe(v => playerState = v);

  $: isPlayerActive = playerState?.isActive;
  $: streamUrl = playerState?.streamUrl;
  $: movieTitle = playerState?.title;
  $: mediaId = playerState?.mediaId;
  $: resumeTime = playerState?.resumeTime || 0;
</script>

<div class="min-h-screen text-text font-sans selection:bg-primary/30" class:bg-transparent={playerState.isActive} class:bg-background={!playerState.isActive}>
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

    <!-- Main Layout - Hide when playing to ensure full transparency -->
    {#if !playerState.isActive}
        <div class="flex">
            <Navbar />
            <main class="ml-20 flex-1 p-8 min-h-screen">
                <slot />
            </main>
        </div>
    {/if}
</div>
