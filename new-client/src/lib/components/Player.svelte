<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { fade } from 'svelte/transition';
    import { init, command, getProperty, setProperty } from 'tauri-plugin-libmpv-api';
    import { listen } from '@tauri-apps/api/event';
    import { getCurrentWindow } from '@tauri-apps/api/window';
    import { invoke } from '@tauri-apps/api/core';
    import { player, closePlayer, openPlayer } from '$lib/stores/player';
    
    export let streamUrl: string;
    export let title: string | null = "Unknown";
    export let movieId: number | null = null;
    export let apiUrl: string = "http://localhost:3000";
    
    let isReady = false;
    let isHovering = false;
    let showControls = true;
    let controlsTimeout: any;
    
    // State
    let isPaused = false;
    let isFullscreen = false;
    let duration = 0;
    let position = 0;
    let volume = 100;
    
    // Tracks State
    let mediaTracks: any[] = [];
    
    // Menus State
    let activeMenu: 'audio' | 'subtitles' | 'quality' | null = null;
    
    // Transcoding State
    let quality = 'direct'; // 'direct', '1080', '720', '480'
    let transcodeOffset = 0;
    let isLoading = false;
    
    // Derived state for display
    $: displayPosition = quality === 'direct' ? position : transcodeOffset + position;
    let originalDuration = 0; 
    $: displayDuration = originalDuration > 0 ? originalDuration : duration;
    
    $: audioTracks = mediaTracks.filter(t => t.type === 'audio');
    $: subTracks = mediaTracks.filter(t => t.type === 'sub');
    
    let unlistenTime: () => void;
    let unlistenDuration: () => void;
    let unlistenTracks: () => void;
    let interval: any;

    // Episode Context (for TV Shows)
    let episodeContext: { next: any, prev: any, current: any, show_title: string } | null = null;
    let isEpisode = false;
    
    // Chapters (for Skip Intro)
    let chapters: any[] = [];
    $: currentChapter = chapters.find(c => displayPosition >= c.start_time && displayPosition < c.end_time);
    $: isIntro = currentChapter && (
        currentChapter.title?.toLowerCase().includes('intro') || 
        currentChapter.title?.toLowerCase().includes('opening') ||
        currentChapter.title?.toLowerCase().includes('générique')
    );
    $: isOutro = currentChapter && (
        currentChapter.title?.toLowerCase().includes('outro') || 
        currentChapter.title?.toLowerCase().includes('ending') ||
        currentChapter.title?.toLowerCase().includes('credits')
    );

    // Auto-play Next Episode State
    let autoPlayTimer: any;
    let autoPlayProgress = 0; // 0 to 100
    let isAutoPlaying = false;

    $: if (isOutro && isEpisode && episodeContext?.next && !showControls && !isPaused) {
        if (!isAutoPlaying) {
            startAutoPlay();
        }
    } else {
        cancelAutoPlay();
    }

    function startAutoPlay() {
        console.log("Starting AutoPlay...");
        isAutoPlaying = true;
        autoPlayProgress = 0;
        
        const duration = 5000; // 5 seconds
        const intervalTime = 50; // update every 50ms
        const step = (intervalTime / duration) * 100;
        
        autoPlayTimer = setInterval(() => {
            autoPlayProgress += step;
            if (autoPlayProgress >= 100) {
                cancelAutoPlay();
                playNextEpisode();
            }
        }, intervalTime);
    }

    function cancelAutoPlay() {
        if (isAutoPlaying) {
            console.log("Cancelling AutoPlay...");
            clearInterval(autoPlayTimer);
            isAutoPlaying = false;
            autoPlayProgress = 0;
        }
    }

    async function playNextEpisode() {
        if (!episodeContext?.next) return;
        
        const newUrl = `${apiUrl}/stream/${episodeContext.next.id}?type=episode`;
        const newTitle = `${episodeContext.show_title} - S${episodeContext.next.season_number.toString().padStart(2, '0')}E${episodeContext.next.episode_number.toString().padStart(2, '0')}`;
        const newId = episodeContext.next.id;
        
        console.log(`[PLAYER] Jumping to NEXT episode: ${newTitle}`);
        
        streamUrl = newUrl;
        title = newTitle;
        movieId = newId;
        quality = 'direct';
        transcodeOffset = 0;
        originalDuration = 0;
        position = 0;
        mediaTracks = [];
        chapters = [];
        episodeContext = null;
        
        try {
            await command('loadfile', [streamUrl]);
            await setProperty('pause', false);
            openPlayer(newUrl, newTitle, newId);
            
            const contextRes = await fetch(`${apiUrl}/tv/episode/${movieId}/context`);
            if (contextRes.ok) episodeContext = await contextRes.json();
            
            const tracksRes = await fetch(`${apiUrl}/movies/${movieId}/tracks?type=episode`);
            if (tracksRes.ok) {
                const info = await tracksRes.json();
                mediaTracks = info.tracks || [];
                chapters = info.chapters || [];
                if (info.duration && info.duration > 0) {
                    originalDuration = info.duration;
                    duration = info.duration;
                }
            }
        } catch (e) {
            console.error("Error loading next file:", e);
        }
    }

    async function playPrevEpisode() {
        if (!episodeContext?.prev) return;
        
        const newUrl = `${apiUrl}/stream/${episodeContext.prev.id}?type=episode`;
        const newTitle = `${episodeContext.show_title} - S${episodeContext.prev.season_number.toString().padStart(2, '0')}E${episodeContext.prev.episode_number.toString().padStart(2, '0')}`;
        const newId = episodeContext.prev.id;
        
        console.log(`[PLAYER] Jumping to PREV episode: ${newTitle}`);
        
        streamUrl = newUrl;
        title = newTitle;
        movieId = newId;
        quality = 'direct';
        transcodeOffset = 0;
        originalDuration = 0;
        position = 0;
        mediaTracks = [];
        chapters = [];
        episodeContext = null;
        
        try {
            await command('loadfile', [streamUrl]);
            await setProperty('pause', false);
            openPlayer(newUrl, newTitle, newId);
            
            const contextRes = await fetch(`${apiUrl}/tv/episode/${movieId}/context`);
            if (contextRes.ok) episodeContext = await contextRes.json();
            
            const tracksRes = await fetch(`${apiUrl}/movies/${movieId}/tracks?type=episode`);
            if (tracksRes.ok) {
                const info = await tracksRes.json();
                mediaTracks = info.tracks || [];
                chapters = info.chapters || [];
                if (info.duration && info.duration > 0) {
                    originalDuration = info.duration;
                    duration = info.duration;
                }
            }
        } catch (e) {
            console.error("Error loading prev file:", e);
        }
    }

    function formatTime(seconds: number) {
        if (!seconds || isNaN(seconds)) return "00:00";
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    // Timeline Interaction
    async function seekTo(newTime: number) {
        try {
            if (quality === 'direct') {
                await setProperty('time-pos', newTime);
                position = newTime;
            } else {
                // Transcoding seek
                console.log(`[SEEK] Transcoding seek to ${newTime}s`);
                isLoading = true;
                transcodeOffset = newTime;
                position = 0; // Reset MPV's internal time
                
                const newUrl = `${apiUrl}/transcode/${movieId}?quality=${quality}&start=${Math.floor(newTime)}`;
                await command('loadfile', [newUrl]);
                
                // Attendre un peu que le flux démarre
                setTimeout(() => {
                    isLoading = false;
                }, 2000);
            }
        } catch (e) {
            console.error("Seek Error:", e);
        }
    }

    async function handleSeek(event: MouseEvent) {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const x = event.clientX - rect.left;
        const percentage = Math.max(0, Math.min(1, x / rect.width));
        const newTime = percentage * displayDuration;
        await seekTo(newTime);
    }

    async function skip(seconds: number) {
        const currentTime = displayPosition;
        const newTime = Math.max(0, Math.min(displayDuration, currentTime + seconds));
        await seekTo(newTime);
    }

    function handleVolumeChange(e: Event) {
        const target = e.target as HTMLInputElement;
        const val = parseInt(target.value);
        volume = val;
        setProperty('volume', val);
    }

    async function toggleFullscreen() {
        console.log("Toggle Fullscreen triggered");
        try {
            const newState = !isFullscreen;
            isFullscreen = newState;
            
            const appWindow = getCurrentWindow();
            await appWindow.setFullscreen(newState);
        } catch (e) {
            console.error("Fullscreen Error:", e);
            isFullscreen = !isFullscreen;
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        console.log("Key pressed:", e.key);
        if (e.key === 'f' || e.key === 'F') {
            toggleFullscreen();
        } else if (e.key === 'Escape') {
            if (isFullscreen) {
                isFullscreen = false;
                getCurrentWindow().setFullscreen(false);
            }
        } else if (e.key === 'Enter' || e.key === ' ') {
             togglePlay();
        }
    }

    function handleMouseMove() {
        if (!showControls) {
            showControls = true;
        }
        
        clearTimeout(controlsTimeout);
        controlsTimeout = setTimeout(() => {
            if (!isPaused) {
                showControls = false;
                activeMenu = null;
            }
        }, 3000);
    }
    
    function handleVideoDblClick() {
        toggleFullscreen();
    }

    async function setTrack(type: 'sid' | 'aid', mpvId: string, trackId: number | string) {
        try {
            console.log(`Envoi de la commande à Rust : type=${type}, id=${mpvId} (File ID ${trackId})`);
            
            try {
                await invoke('set_mpv_track', { trackType: type, trackId: mpvId });
            } catch (err) {
                console.warn(`invoke set_mpv_track failed:`, err);
                try {
                    await command('set', [type, mpvId]);
                } catch (e2) {
                    console.warn(`Fallback command also failed.`);
                }
            }
            
            await new Promise(r => setTimeout(r, 100));
            
            mediaTracks = mediaTracks.map(track => {
                if ((type === 'sid' && track.type === 'sub') || (type === 'aid' && track.type === 'audio')) {
                    if (mpvId === 'no') {
                        track.selected = false;
                    } else {
                        track.selected = track.id.toString() === trackId.toString();
                    }
                }
                return track;
            });
            console.log("Piste changée avec succès !");
        } catch (e) {
            console.error(`Erreur Tauri lors du changement de ${type}:`, e);
        }
    }

    async function changeQuality(newQuality: string) {
        if (newQuality === quality) return;
        
        console.log(`Changing quality to ${newQuality}`);
        isLoading = true;
        
        try {
            const currentTimeToSeek = quality === 'direct' ? position : transcodeOffset + position;
            
            quality = newQuality;
            transcodeOffset = currentTimeToSeek;
            position = 0; 
            
            let loadUrl = streamUrl;
            if (newQuality !== 'direct') {
                loadUrl = `${apiUrl}/transcode/${movieId}?quality=${newQuality}&start=${Math.floor(currentTimeToSeek)}`;
            }
            
            await command('loadfile', [loadUrl]);
            
            setTimeout(() => {
                isLoading = false;
            }, 2000);
            
        } catch (e) {
            console.error("Quality change error:", e);
            isLoading = false;
        }
    }

    function toggleMenu(menuName: 'audio' | 'subtitles' | 'quality') {
        if (activeMenu === menuName) {
            activeMenu = null;
        } else {
            activeMenu = menuName;
        }
    }

    onMount(async () => {
        console.log("Initializing Player...");
        window.focus();
        
        document.documentElement.style.backgroundColor = 'transparent';
        document.body.style.backgroundColor = 'transparent';

        try {
            await init({
                initialOptions: {
                    'vo': 'gpu',
                    'gpu-context': 'auto',
                    'hwdec': 'auto',
                    'hwdec-codecs': 'all',
                    'input-default-bindings': 'yes',
                    'idle': 'yes',
                    'keep-open': 'yes',
                    'force-window': 'yes',
                    'ontop': 'yes',
                    'cache': 'yes',
                    'cache-pause': 'no', 
                    'demuxer-max-bytes': '500MiB', // Augmenté pour stocker plus de vidéo et les gros sous-titres en RAM
                    'demuxer-readahead-secs': '60', // Permet de lire plus loin en avance
                    'demuxer-max-back-bytes': '150MiB', // Garde plus de données en arrière pour éviter de recharger
                    'network-timeout': '120',
                    'sub-auto': 'all', 
                    'subs-with-matching-audio': 'no',
                    'demuxer-mkv-subtitle-preroll': 'yes',
                    'sub-ass-override': 'scale',
                }
            });
            
            isReady = true;
            if (streamUrl) {
                console.log(`Loading: ${streamUrl}`);
                await command('loadfile', [streamUrl]);
                await setProperty('pause', false); 
            }
            
            try {
                const vol = await getProperty('volume');
                if (typeof vol === 'number') volume = vol;
            } catch (e) {}
            
            if (movieId) {
                console.log(`Fetching info for media ${movieId}...`);
                try {
                    isEpisode = streamUrl.includes('type=episode');
                    
                    if (isEpisode) {
                        console.log(`[EPISODE CONTEXT] Fetching context for ID ${movieId}`);
                        const contextRes = await fetch(`${apiUrl}/tv/episode/${movieId}/context`);
                        if (contextRes.ok) {
                            episodeContext = await contextRes.json();
                            console.log(`[EPISODE CONTEXT] Received:`, episodeContext);
                        } else {
                            console.error(`[EPISODE CONTEXT] Failed to fetch: ${contextRes.status}`);
                        }
                    }

                    const apiEndpoint = isEpisode ? `${apiUrl}/movies/${movieId}/tracks?type=episode` : `${apiUrl}/movies/${movieId}/tracks`;
                    
                    const res = await fetch(apiEndpoint);
                    if (res.ok) {
                        const info = await res.json();
                        console.log("Info from ffprobe API:", info);
                        mediaTracks = info.tracks || [];
                        chapters = info.chapters || [];
                        if (info.duration && info.duration > 0) {
                            originalDuration = info.duration;
                            duration = info.duration;
                        }
                    }
                } catch (e) {
                    console.error("Failed to fetch info from API:", e);
                }
            }

            console.log("Setting up MPV event listeners...");
            
            unlistenTime = await listen<number>('mpv-time-update', (event) => {
                position = event.payload;
            });
            
            unlistenDuration = await listen<number>('mpv-duration', (event) => {
                if (originalDuration === 0 && event.payload > 10) {
                    originalDuration = event.payload;
                }
                
                if (quality === 'direct' && (originalDuration === 0 || Math.abs(event.payload - originalDuration) < originalDuration * 0.2)) {
                    duration = event.payload;
                }
            });

            unlistenTracks = await listen<any[]>('mpv-tracks-update', (event) => {});

            interval = setInterval(async () => {
                if (!isReady) return;
                try {
                    const pauseState = await getProperty('pause');
                    isPaused = pauseState === true;
                } catch (e) {}
            }, 1500); 

        } catch (e) {
            console.error("MPV Init Failed:", e);
        }
    });

    onDestroy(async () => {
        if (interval) clearInterval(interval);
        if (unlistenTime) unlistenTime();
        if (unlistenDuration) unlistenDuration();
        if (unlistenTracks) unlistenTracks();

        try {
            await command('stop', []);
            document.documentElement.style.backgroundColor = '#0f172a';
            document.body.style.backgroundColor = '#0f172a';
        } catch (e) {}
    });

    async function togglePlay() {
        try {
            const newPauseState = !isPaused;
            await setProperty('pause', newPauseState);
            isPaused = newPauseState;
        } catch (e) {
            console.error("Toggle Play Error:", e);
        }
    }

    async function stop() {
        if (isFullscreen) {
            try {
                isFullscreen = false;
                const appWindow = getCurrentWindow();
                await appWindow.setFullscreen(false);
            } catch (e) {
                console.error("Error exiting fullscreen on stop:", e);
            }
        }
        closePlayer();
    }
</script>

<svelte:window on:mousemove={handleMouseMove} on:keydown={handleKeydown} />

<!-- svelte-ignore a11y-no-static-element-interactions -->
<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="fixed inset-0 z-50 bg-transparent flex flex-col justify-between transition-colors duration-300 pointer-events-auto"
     class:cursor-none={!showControls}
     transition:fade={{ duration: 300 }}>
     
    <!-- Video Area -->
    <div 
        class="absolute inset-0 z-0" 
        style="background-color: rgba(0,0,0,0.01);" 
        on:click={togglePlay}
        on:dblclick={handleVideoDblClick}
        role="button"
        tabindex="0"
    ></div>

    <!-- Scrim Overlay -->
    {#if showControls}
    <div class="absolute inset-0 scrim-gradient z-10 pointer-events-none" transition:fade></div>
    {/if}

    <!-- Player Interface Container -->
    <div class="absolute inset-0 flex flex-col justify-between p-10 z-20 pointer-events-none">
        
        <!-- Top Controls -->
        <div class="flex justify-between items-start pointer-events-auto transition-opacity duration-300" class:opacity-0={!showControls}>
            <div class="flex flex-col gap-1.5">
                <span class="font-headline text-3xl font-extrabold tracking-tight text-white drop-shadow-lg">{title}</span>
                {#if isEpisode && episodeContext?.current}
                    <span class="font-body text-xs text-white/70 font-semibold uppercase tracking-[0.25em]">Saison {episodeContext.current.season_number} • Épisode {episodeContext.current.episode_number}</span>
                {/if}
            </div>
            <div class="flex items-center gap-3">
                <button on:click={stop} class="w-12 h-12 flex items-center justify-center rounded-full glass-panel hover:bg-white/15 transition-all active:scale-95" title="Fermer">
                    <span class="material-symbols-outlined text-white text-2xl">close</span>
                </button>
            </div>
        </div>

        <!-- Center Playback Controls -->
        <div class="flex items-center justify-center gap-12 sm:gap-16 pointer-events-auto transition-opacity duration-300" class:opacity-0={!showControls}>
            <!-- Prev Episode -->
            {#if isEpisode && episodeContext?.prev}
            <button class="flex items-center justify-center text-white/80 hover:text-white transition-all active:scale-90" title="Épisode précédent" on:click={playPrevEpisode}>
                <span class="material-symbols-outlined text-4xl">skip_previous</span>
            </button>
            {/if}

            <button class="flex items-center justify-center text-white/80 hover:text-white transition-all active:scale-90" title="-10s" on:click={() => skip(-10)}>
                <span class="material-symbols-outlined text-4xl">replay_10</span>
            </button>
            
            <button class="w-24 h-24 rounded-full bg-primary flex items-center justify-center shadow-[0_0_40px_rgba(255,142,128,0.3)] hover:scale-110 active:scale-95 transition-all group" on:click={togglePlay}>
                {#if isPaused}
                    <span class="material-symbols-outlined text-on-primary text-5xl ml-1.5 transition-transform" style="font-variation-settings: 'FILL' 1;">play_arrow</span>
                {:else}
                    <span class="material-symbols-outlined text-on-primary text-5xl transition-transform" style="font-variation-settings: 'FILL' 1;">pause</span>
                {/if}
            </button>

            <button class="flex items-center justify-center text-white/80 hover:text-white transition-all active:scale-90" title="+10s" on:click={() => skip(10)}>
                <span class="material-symbols-outlined text-4xl">forward_10</span>
            </button>

            <!-- Next Episode -->
            {#if isEpisode && episodeContext?.next}
            <button class="flex items-center justify-center text-white/80 hover:text-white transition-all active:scale-90" title="Épisode suivant" on:click={playNextEpisode}>
                <span class="material-symbols-outlined text-4xl" style="font-variation-settings: 'FILL' 1;">skip_next</span>
            </button>
            {/if}
        </div>

        <!-- Bottom Control Shell -->
        <div class="flex flex-col gap-6 w-full max-w-7xl mx-auto">
            
            <!-- Skip Intro / Outro Buttons -->
            <!-- Placed relatively above the controls so they don't block interaction -->
            <div class="absolute bottom-40 right-10 z-30 flex flex-col gap-4 pointer-events-auto">
                {#if isIntro}
                    <button 
                        on:click={() => seekTo(currentChapter.end_time)}
                        class="glass-panel hover:bg-white/10 text-white px-6 py-3 rounded-full font-bold flex items-center gap-2 transition-all hover:scale-105 shadow-xl"
                    >
                        <span class="material-symbols-outlined">skip_next</span>
                        Passer l'intro
                    </button>
                {:else if isOutro && isEpisode && episodeContext?.next}
                    <button 
                        on:click={playNextEpisode}
                        class="relative overflow-hidden glass-panel hover:bg-white/10 text-white px-6 py-3 rounded-full font-bold flex items-center gap-2 transition-all hover:scale-105 shadow-xl group"
                    >
                        {#if isAutoPlaying}
                            <div class="absolute inset-0 bg-primary/30 transition-all duration-75" style="width: {autoPlayProgress}%"></div>
                        {/if}
                        <div class="relative z-10 flex items-center gap-2">
                            <span class="material-symbols-outlined">skip_next</span>
                            <span>Épisode suivant {isAutoPlaying ? `(${Math.ceil(5 - (autoPlayProgress / 20))}s)` : ''}</span>
                        </div>
                    </button>
                {:else if isOutro}
                    <button 
                        on:click={() => seekTo(displayDuration - 1)}
                        class="glass-panel hover:bg-white/10 text-white px-6 py-3 rounded-full font-bold flex items-center gap-2 transition-all hover:scale-105 shadow-xl"
                    >
                        <span class="material-symbols-outlined">skip_next</span>
                        Passer le générique
                    </button>
                {/if}
            </div>

            <div class="pointer-events-auto w-full transition-opacity duration-300" class:opacity-0={!showControls}>
                <!-- Progress Rail -->
                <div class="relative w-full group/progress progress-hitbox py-4 cursor-pointer" on:click={handleSeek}>
                    <div class="h-1.5 w-full bg-white/20 rounded-full overflow-hidden relative">
                        <!-- Progress -->
                        <div class="h-full bg-primary relative" style="width: {(displayDuration > 0 ? (displayPosition / displayDuration) * 100 : 0)}%"></div>
                        <!-- Chapter Markers -->
                        {#each chapters as chapter}
                            {#if displayDuration > 0}
                            <div class="chapter-marker" style="left: {(chapter.start_time / displayDuration) * 100}%"></div>
                            {/if}
                        {/each}
                    </div>
                    <!-- Handle -->
                    <div class="progress-handle absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-primary rounded-full shadow-[0_0_15px_rgba(255,142,128,0.8)] opacity-0 transition-all duration-200 pointer-events-none" style="left: {(displayDuration > 0 ? (displayPosition / displayDuration) * 100 : 0)}%; transform: translateX(-50%);"></div>
                </div>

                <!-- Bottom Navigation Bar -->
                <div class="flex items-center justify-between relative">
                    <!-- Time & Volume -->
                    <div class="flex items-center gap-8">
                        <div class="flex items-baseline gap-2 font-body">
                            <span class="text-white text-lg font-bold">{formatTime(displayPosition)}</span>
                            <span class="text-white/50 text-sm font-medium">/ {formatTime(displayDuration)}</span>
                        </div>
                        
                        <div class="flex items-center gap-4 group/vol">
                            <button class="text-white/80 hover:text-white transition-colors" on:click={() => { volume = volume === 0 ? 100 : 0; setProperty('volume', volume); }}>
                                <span class="material-symbols-outlined text-2xl">{volume === 0 ? 'volume_off' : volume < 50 ? 'volume_down' : 'volume_up'}</span>
                            </button>
                            <input 
                                type="range" 
                                min="0" 
                                max="100" 
                                bind:value={volume} 
                                on:input={handleVolumeChange}
                                class="w-24 h-1 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:bg-primary transition-all relative overflow-hidden"
                                style="background: linear-gradient(to right, white {volume}%, rgba(255,255,255,0.2) {volume}%);"
                            />
                        </div>
                    </div>

                    <!-- Floating Central Nav -->
                    <nav class="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 p-1.5 glass-panel rounded-full shadow-2xl">
                        <button class="flex items-center gap-2 px-6 py-2.5 bg-primary text-on-primary rounded-full font-semibold text-sm transition-all shadow-lg active:scale-95" on:click={togglePlay}>
                            {#if isPaused}
                                <span class="material-symbols-outlined text-xl" style="font-variation-settings: 'FILL' 1;">play_arrow</span>
                                <span>LECTURE</span>
                            {:else}
                                <span class="material-symbols-outlined text-xl" style="font-variation-settings: 'FILL' 1;">pause</span>
                                <span>PAUSE</span>
                            {/if}
                        </button>
                        
                        <!-- Subtitles Menu -->
                        <div class="relative">
                            <button class="flex items-center gap-2 px-6 py-2.5 {activeMenu === 'subtitles' ? 'text-white bg-white/10' : 'text-white/70 hover:text-white hover:bg-white/10'} rounded-full font-semibold text-sm transition-all active:scale-95" on:click|stopPropagation={() => toggleMenu('subtitles')}>
                                <span class="material-symbols-outlined text-xl">subtitles</span>
                                <span>SOUS-TITRES</span>
                            </button>
                            {#if activeMenu === 'subtitles'}
                                <div class="absolute bottom-full mb-4 left-1/2 -translate-x-1/2 bg-background/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-4 z-50 min-w-[200px]" on:click|stopPropagation>
                                    <h3 class="text-white/50 text-xs uppercase font-bold tracking-wider mb-3 px-2">Sous-titres</h3>
                                    <div class="flex flex-col gap-1 max-h-[40vh] overflow-y-auto custom-scrollbar">
                                        <button class="text-left px-4 py-2 rounded-md text-sm transition-colors {!subTracks.find(t => t.selected) ? 'text-primary font-semibold' : 'text-white/70 hover:bg-white/10'}" on:click={() => { setTrack('sid', 'no', 'no'); activeMenu = null; }}>Désactivé</button>
                                        {#each subTracks as track, i}
                                            <button class="text-left px-4 py-2 rounded-md text-sm transition-colors {track.selected ? 'text-primary font-semibold' : 'text-white/70 hover:bg-white/10'}" on:click={() => { setTrack('sid', (i + 1).toString(), track.id); activeMenu = null; }}>{track.title || track.lang || `Piste ${i + 1}`}</button>
                                        {/each}
                                    </div>
                                </div>
                            {/if}
                        </div>

                        <!-- Audio Menu -->
                        <div class="relative">
                            <button class="flex items-center gap-2 px-6 py-2.5 {activeMenu === 'audio' ? 'text-white bg-white/10' : 'text-white/70 hover:text-white hover:bg-white/10'} rounded-full font-semibold text-sm transition-all active:scale-95" on:click|stopPropagation={() => toggleMenu('audio')}>
                                <span class="material-symbols-outlined text-xl">volume_up</span>
                                <span>AUDIO</span>
                            </button>
                            {#if activeMenu === 'audio'}
                                <div class="absolute bottom-full mb-4 left-1/2 -translate-x-1/2 bg-background/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-4 z-50 min-w-[200px]" on:click|stopPropagation>
                                    <h3 class="text-white/50 text-xs uppercase font-bold tracking-wider mb-3 px-2">Audio</h3>
                                    {#if audioTracks.length > 0}
                                        <div class="flex flex-col gap-1 max-h-[40vh] overflow-y-auto custom-scrollbar">
                                            {#each audioTracks as track, i}
                                                <button class="text-left px-4 py-2 rounded-md text-sm transition-colors {track.selected ? 'text-primary font-semibold' : 'text-white/70 hover:bg-white/10'}" on:click={() => { setTrack('aid', (i + 1).toString(), track.id); activeMenu = null; }}>{track.title || track.lang || `Piste ${i + 1}`}</button>
                                            {/each}
                                        </div>
                                    {:else}
                                        <p class="text-white/50 text-sm italic px-2">Aucune piste</p>
                                    {/if}
                                </div>
                            {/if}
                        </div>

                        <!-- Quality Menu -->
                        <div class="relative">
                            <button class="flex items-center gap-2 px-6 py-2.5 {activeMenu === 'quality' ? 'text-white bg-white/10' : 'text-white/70 hover:text-white hover:bg-white/10'} rounded-full font-semibold text-sm transition-all active:scale-95" on:click|stopPropagation={() => toggleMenu('quality')}>
                                <span class="material-symbols-outlined text-xl">high_quality</span>
                                <span>QUALITÉ</span>
                            </button>
                            {#if activeMenu === 'quality'}
                                <div class="absolute bottom-full mb-4 left-1/2 -translate-x-1/2 bg-background/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-4 z-50 min-w-[200px]" on:click|stopPropagation>
                                    <h3 class="text-white/50 text-xs uppercase font-bold tracking-wider mb-3 px-2">Qualité</h3>
                                    <div class="flex flex-col gap-1 max-h-[40vh] overflow-y-auto custom-scrollbar">
                                        <button class="text-left px-4 py-2 rounded-md text-sm transition-colors {quality === 'direct' ? 'text-primary font-semibold' : 'text-white/70 hover:bg-white/10'}" on:click={() => { changeQuality('direct'); activeMenu = null; }}>Direct Play</button>
                                        <button class="text-left px-4 py-2 rounded-md text-sm transition-colors {quality === '1080p_high' ? 'text-primary font-semibold' : 'text-white/70 hover:bg-white/10'}" on:click={() => { changeQuality('1080p_high'); activeMenu = null; }}>1080p (8 Mbps)</button>
                                        <button class="text-left px-4 py-2 rounded-md text-sm transition-colors {quality === '1080p_med' ? 'text-primary font-semibold' : 'text-white/70 hover:bg-white/10'}" on:click={() => { changeQuality('1080p_med'); activeMenu = null; }}>1080p (4 Mbps)</button>
                                        <button class="text-left px-4 py-2 rounded-md text-sm transition-colors {quality === '1080p_low' ? 'text-primary font-semibold' : 'text-white/70 hover:bg-white/10'}" on:click={() => { changeQuality('1080p_low'); activeMenu = null; }}>1080p (2 Mbps)</button>
                                        <div class="h-px bg-white/10 my-1"></div>
                                        <button class="text-left px-4 py-2 rounded-md text-sm transition-colors {quality === '720p_high' ? 'text-primary font-semibold' : 'text-white/70 hover:bg-white/10'}" on:click={() => { changeQuality('720p_high'); activeMenu = null; }}>720p (3 Mbps)</button>
                                        <button class="text-left px-4 py-2 rounded-md text-sm transition-colors {quality === '720p_low' ? 'text-primary font-semibold' : 'text-white/70 hover:bg-white/10'}" on:click={() => { changeQuality('720p_low'); activeMenu = null; }}>720p (1.5 Mbps)</button>
                                        <div class="h-px bg-white/10 my-1"></div>
                                        <button class="text-left px-4 py-2 rounded-md text-sm transition-colors {quality === '480p' ? 'text-primary font-semibold' : 'text-white/70 hover:bg-white/10'}" on:click={() => { changeQuality('480p'); activeMenu = null; }}>480p (800 kbps)</button>
                                    </div>
                                </div>
                            {/if}
                        </div>
                    </nav>

                    <!-- Actions -->
                    <div class="flex items-center gap-4">
                        <button class="w-10 h-10 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-all active:scale-90" title="Plein Écran" on:click={toggleFullscreen}>
                            {#if isFullscreen}
                                <span class="material-symbols-outlined text-2xl">fullscreen_exit</span>
                            {:else}
                                <span class="material-symbols-outlined text-2xl">fullscreen</span>
                            {/if}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<style>
    @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;700;800&family=Inter:wght@400;500;600&display=swap');
    @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');

    :global(.material-symbols-outlined) {
        font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24;
        display: inline-block;
        line-height: 1;
    }
    
    .font-headline {
        font-family: 'Manrope', sans-serif;
    }
    
    .font-body {
        font-family: 'Inter', sans-serif;
    }

    .scrim-gradient {
        background: linear-gradient(to top, rgba(14, 14, 14, 0.95) 0%, rgba(14, 14, 14, 0.4) 30%, transparent 60%, rgba(14, 14, 14, 0.4) 85%, rgba(14, 14, 14, 0.95) 100%);
    }
    .chapter-marker {
        width: 2px;
        height: 100%;
        background-color: rgba(255, 255, 255, 0.4);
        position: absolute;
        top: 0;
        z-index: 10;
    }
    .glass-panel {
        backdrop-filter: blur(24px);
        background: rgba(26, 25, 25, 0.55);
        border: 1px solid rgba(255, 255, 255, 0.05);
    }
    .progress-hitbox:hover .progress-handle {
        opacity: 1;
    }
    
    :global(.cursor-none) {
        cursor: none !important;
    }
    
    .custom-scrollbar::-webkit-scrollbar {
        width: 4px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
        background: transparent;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 4px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.4);
    }
</style>